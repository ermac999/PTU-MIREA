/* =====================================================================
   «Сегодня»: чек-ины в 2 тапа, максимум 3 задачи, привычки, таймер 25/5,
   серия дней. «Горит»: ближайшие дедлайны, нехватка времени, что делать первым.
   ===================================================================== */

import { CONFIG, EVENT_TYPES } from '../config.js';
import { commit, store } from '../store.js';
import {
  buildTodayPlan, catchUpDone, catchUpTotal, catchUpWindow, eventById, eventProgress, plannedByEvent, plannedCatchUp, streakInfo, subjectOf,
} from '../planner.js';
import { addDays, daysBetween, esc, fmtDur, fmtHours, fmtTime, humanDate, mondayOf, pad2, plural, relDays, WD_LONG } from '../util.js';
import { icon, toast } from '../ui.js';
import { bank } from '../bank.js';
import {
  KIND_LABEL, PLACE_LABEL, eventRow, eventTitle, getSim, nowMin, planFor, statusOf, subjShort, today, topicLinks, upcoming,
} from './shared.js';

/* ---------- Таймер фокуса 25/5 ---------- */

const WORK = CONFIG.focus.work * 60000;
const REST = CONFIG.focus.rest * 60000;
let tick = null;
let audio = null;

const timerState = () => store.state.timer || { phase: 'work', running: false, remaining: WORK, endsAt: null };
const totalOf = (ph) => (ph === 'work' ? WORK : REST);
const leftMs = (ts) => (ts.running ? Math.max(0, ts.endsAt - Date.now()) : ts.remaining);
const mmss = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
};

function beep() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.7);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.75);
  } catch { /* без звука — не страшно */ }
}

function addFocus(min) {
  if (min <= 0) return;
  const t = today();
  commit((st) => { st.focus[t] = (st.focus[t] || 0) + min; }, { silent: true });
}

/** Обновить цифры таймера без перерисовки экрана. */
export function paintTimer() {
  const ts = timerState();
  const left = leftMs(ts);
  const total = totalOf(ts.phase);
  document.querySelectorAll('[data-timer-text]').forEach((el) => { el.textContent = mmss(left); });
  document.querySelectorAll('[data-timer-ring]').forEach((el) => {
    const c = Number(el.getAttribute('data-c'));
    el.style.strokeDashoffset = String(c * (left / total));
  });
  const strip = document.getElementById('strip-timer');
  if (strip) {
    strip.hidden = !ts.running;
    strip.textContent = ts.running ? `${ts.phase === 'work' ? 'Фокус' : 'Перерыв'} ${mmss(left)}` : '';
  }
  if (ts.running && left <= 0) phaseDone(ts);
}

function phaseDone(ts) {
  beep();
  if (ts.phase === 'work') {
    addFocus(CONFIG.focus.work);
    commit((st) => { st.timer = { phase: 'rest', running: true, endsAt: Date.now() + REST, remaining: REST }; });
    toast(`${CONFIG.focus.work} минут готово. Перерыв ${CONFIG.focus.rest} минут — встань, вода, окно.`);
  } else {
    commit((st) => { st.timer = { phase: 'work', running: false, remaining: WORK, endsAt: null }; });
    toast('Перерыв закончился. Следующий помидор — когда будешь готов.');
  }
}

export function ensureTicker() {
  if (tick) return;
  tick = setInterval(() => {
    if (timerState().running) paintTimer();
  }, 1000);
}

function timerCard() {
  const ts = timerState();
  const left = leftMs(ts);
  const r = 58;
  const c = Math.round(2 * Math.PI * r * 100) / 100;
  const t = today();
  const weekStart = mondayOf(t);
  let week = 0;
  for (let k = weekStart; k <= t; k = addDays(k, 1)) week += store.state.focus[k] || 0;
  return `<section>
    <div class="sec-row"><h2 class="sec">Фокус 25/5</h2><span class="small muted num">сегодня ${fmtDur(store.state.focus[t] || 0)} · неделя ${fmtHours(week)}</span></div>
    <div class="timer">
      <div class="ring">
        <svg viewBox="0 0 132 132" aria-hidden="true">
          <circle class="trk" cx="66" cy="66" r="${r}"></circle>
          <circle class="bar ${ts.phase === 'rest' ? 'rest' : ''}" cx="66" cy="66" r="${r}" stroke-dasharray="${c}" data-c="${c}" data-timer-ring style="stroke-dashoffset:${c * (left / totalOf(ts.phase))}"></circle>
        </svg>
        <div class="ring-label"><span class="tm" data-timer-text role="timer" aria-live="off">${mmss(left)}</span><span class="ph">${ts.phase === 'work' ? 'фокус' : 'перерыв'}</span></div>
      </div>
      <div class="stack">
        ${ts.running
          ? `<button class="btn" type="button" data-act="timer-pause">${icon('pause', 's')}Пауза</button>`
          : `<button class="btn" type="button" data-act="timer-start">${icon('play', 's')}${ts.remaining < totalOf(ts.phase) ? 'Дальше' : 'Старт'}</button>`}
        <button class="btn ghost small" type="button" data-act="timer-reset">${icon('reset', 's')}Сброс</button>
        <span class="tiny muted">Телефон экраном вниз. Минуты фокуса засчитываются после каждого помидора.</span>
      </div>
    </div>
  </section>`;
}

/* ---------- Чек-ины ---------- */

const EVENING_REPLY = {
  all: 'Сильный день. Отдыхай — завтрашний план уже собран.',
  part: 'Часть — тоже результат. Несделанное перенесено на ближайшие дни.',
  none: 'Бывает. Ничего не потеряно: план пересобран, завтра начнём с короткого шага.',
};
const REASON = {
  tired: ['Устал', 'Завтра первый блок будет коротким и лёгким. Если так часто — отметь «мало сил» утром.'],
  phone: ['Телефон', 'Попробуй таймер 25 минут, а телефон — экраном вниз в другом конце комнаты.'],
  start: ['Не знал, с чего начать', 'В каждой задаче есть «С чего начать» — шаг на 15 минут. Начни только с него.'],
  other: ['Другое', 'Принято. Если что-то мешает постоянно — поправь режим в «Настройках».'],
};

function checkinCard(t, plan) {
  const st = store.state;
  if (!st.settings.agreement) return '';
  const ci = st.checkins[t] || {};
  const nm = nowMin();
  const tasks = plan.blocks.filter((b) => b.type === 'study');
  const eveningFrom = Math.max(18 * 60, plan.info.bed - 180);

  if (nm < eveningFrom) {
    if (!ci.morning) {
      return `<section class="card check" aria-label="Утренний чек-ин">
        <span class="eyebrow">Утро · 2 тапа</span>
        <p class="q">Как сегодня с силами?</p>
        <div class="seg" role="group">
          <button type="button" data-act="ci-energy" data-v="low">Мало</button>
          <button type="button" data-act="ci-energy" data-v="mid">Нормально</button>
          <button type="button" data-act="ci-energy" data-v="high">Много</button>
        </div>
      </section>`;
    }
    if (!ci.morning.agreed) {
      return `<section class="card check" aria-label="Договорённость на день">
        <span class="eyebrow">Договоримся</span>
        <p class="q">${tasks.length ? `Сегодня ${tasks.length} ${plural(tasks.length, 'задача', 'задачи', 'задач')}. Берёшь?` : 'Сегодня учебных задач нет — отдых по плану.'}</p>
        ${tasks.length ? `<ul class="list">${tasks.map((b) => `<li class="li"><span class="grow"><span class="t">${esc(b.title)}</span><span class="m">${fmtTime(b.start)} · ${esc(PLACE_LABEL[b.place] || '')} · ${fmtDur(b.min || 0)}</span></span></li>`).join('')}</ul>` : ''}
        <button class="btn block" type="button" data-act="ci-agree">${tasks.length ? 'Договорились' : 'Хорошо'}</button>
      </section>`;
    }
    return `<p class="note">Договорились: ${ci.morning.agreed.length} ${plural(ci.morning.agreed.length, 'задача', 'задачи', 'задач')}. Вечером спрошу, как прошло.</p>`;
  }

  // Вечер
  const agreed = ci.morning?.agreed || tasks.map((b) => b.id);
  const doneN = agreed.filter((id) => statusOf(t, id) === 'done').length;
  if (!ci.evening) {
    return `<section class="card check" aria-label="Вечерний чек-ин">
      <span class="eyebrow">Вечер · 2 тапа</span>
      <p class="q">Как прошёл день?</p>
      ${agreed.length ? `<p class="small muted">Договаривались: ${agreed.length} · отмечено сделанным: ${doneN}</p>` : ''}
      <div class="seg" role="group">
        <button type="button" data-act="ci-evening" data-v="all">Всё сделал</button>
        <button type="button" data-act="ci-evening" data-v="part">Часть</button>
        <button type="button" data-act="ci-evening" data-v="none">Не вышло</button>
      </div>
    </section>`;
  }
  if (ci.evening.result !== 'all' && !ci.evening.reason) {
    return `<section class="card check" aria-label="Что помешало">
      <span class="eyebrow">Без оценок</span>
      <p class="q">Что помешало? Можно пропустить.</p>
      <div class="seg col" role="group">
        ${Object.entries(REASON).map(([k, [label]]) => `<button type="button" data-act="ci-reason" data-v="${k}">${label}</button>`).join('')}
        <button type="button" data-act="ci-reason" data-v="skip">Пропустить</button>
      </div>
    </section>`;
  }
  const tip = ci.evening.reason && REASON[ci.evening.reason] ? ` ${REASON[ci.evening.reason][1]}` : '';
  return `<p class="note">${EVENING_REPLY[ci.evening.result]}${esc(tip)}</p>`;
}

/* ---------- Экран «Сегодня» ---------- */

function backupDue() {
  const s = store.state.settings;
  if (s.backupSnoozeUntil && Date.now() < s.backupSnoozeUntil) return false;
  if (!s.lastBackupAt) return Date.now() - (store.state.createdAt || Date.now()) > 2 * 86400000;
  return Date.now() - s.lastBackupAt > CONFIG.backupEveryDays * 86400000;
}

function taskItem(t, b, i) {
  const status = statusOf(t, b.id);
  const started = b.start <= nowMin();
  const link = b.kind === 'light'
    ? `<button class="btn small quiet" type="button" data-act="go" data-to="drill/s:${esc(b.subject)}">Карточки →</button>`
    : `<button class="btn small quiet" type="button" data-act="go" data-to="${b.topicId ? `practice/t:${esc(b.topicId)}` : `practice/s:${esc(b.subject)}`}">Отработка →</button>`;
  return `<li class="task ${status || ''}">
    <span class="task-n" aria-hidden="true">${pad2(i + 1)}</span>
    <div class="task-body">
      <span class="eyebrow">${fmtTime(b.start)}–${fmtTime(b.end)} · ${esc(PLACE_LABEL[b.place] || '')} · ${fmtDur(b.min || 0)}</span>
      <span class="t">${esc(b.title)}</span>
      ${b.detail ? `<span class="small muted">${esc(b.detail)}</span>` : ''}
      ${!status && b.first ? `<span class="small"><b>С чего начать:</b> ${esc(b.first)}</span>` : ''}
      <div class="blk-acts">
        ${status
          ? `<span class="chip ${status === 'done' ? 'ok' : ''}">${status === 'done' ? 'сделано' : 'перенесено'}</span><button class="btn quiet small" type="button" data-act="block-undo" data-key="${t}" data-id="${esc(b.id)}">Отменить</button>`
          : `<button class="btn small" type="button" data-act="block-done" data-key="${t}" data-id="${esc(b.id)}">${icon('check', 's')}Готово</button>
             ${started ? `<button class="btn small ghost" type="button" data-act="block-skip" data-key="${t}" data-id="${esc(b.id)}">Не успел</button>` : ''}
             <button class="btn small ghost" type="button" data-act="timer-start">${icon('clock', 's')}25:00</button>${link}${topicLinks(b)}`}
      </div>
    </div>
  </li>`;
}

export function renderToday() {
  const st = store.state;
  const t = today();
  const plan = planFor(t);
  const sim = getSim();
  const tasks = plan.blocks.filter((b) => b.type === 'study').slice(0, CONFIG.maxTasksPerDay);
  const habits = plan.blocks.filter((b) => ['habit', 'review', 'plan'].includes(b.type));
  const game = plan.blocks.find((b) => b.type === 'game');
  const gym = (plan.fixed || []).find((b) => b.type === 'gym');
  const streak = streakInfo(st, t);
  const next = upcoming(14).filter((e) => e.type !== 'session').slice(0, 3);
  const importantClasses = plan.info.classes.filter((c) => c.kind === 'lab' || subjectOf(st, c.subject)?.marked
    || st.events.some((e) => e.date === t && e.subject === c.subject && e.type !== 'session'));
  const pendingStudy = tasks.filter((b) => !statusOf(t, b.id)).length;

  return `
    <header class="head">
      <span class="eyebrow">${WD_LONG[plan.info.wd]} · ${humanDate(t)}</span>
      <h1 class="display">Сегодня</h1>
    </header>

    ${store.lastError ? `<div class="note danger">${esc(store.lastError)} <button class="btn quiet small" type="button" data-act="error-dismiss">Понятно</button></div>` : ''}
    ${!store.storageOk ? '<div class="note warn">Браузер запретил сохранять данные (приватный режим?). Всё работает, но после закрытия пропадёт. Открой сайт в обычном режиме или добавь на экран «Домой».</div>' : ''}
    ${backupDue() ? `<div class="note"><b>Раз в неделю: копия данных.</b> Отправь файл себе в Telegram «Избранное» — если браузер что-то сотрёт, всё восстановится.
      <div class="row"><button class="btn small" type="button" data-act="backup-share">${icon('share', 's')}Сохранить копию</button><button class="btn small ghost" type="button" data-act="backup-snooze">Завтра</button></div></div>` : ''}

    ${checkinCard(t, plan)}

    <div class="grid2">
      <div class="stat"><span class="big">${streak.streak}</span><span class="lbl">${streak.streak ? `${plural(streak.streak, 'день', 'дня', 'дней')} подряд${streak.todayCounted ? '' : ' · сегодня ещё не отмечен'}` : 'серия начнётся с первого блока'}</span></div>
      <div class="stat"><span class="big">${Math.round((st.focus[t] || 0))}</span><span class="lbl">минут фокуса сегодня</span></div>
    </div>
    ${!streak.streak && streak.best ? `<p class="small muted">Лучшая серия — ${streak.best}. Новая начнётся с одного блока.</p>` : ''}

    <section>
      <div class="sec-row"><h2 class="sec">Задачи дня</h2><span class="small muted">не больше ${CONFIG.maxTasksPerDay}</span></div>
      ${tasks.length
        ? `<ol class="list">${tasks.map((b, i) => taskItem(t, b, i)).join('')}</ol>`
        : `<p class="lead">${plan.info.wd === 0 && !st.settings.sundayExtra ? 'Сегодня выходной: учебных задач нет. Лёгкий план недели — по желанию.' : 'На сегодня учебных задач больше нет. Остальное — отдых по плану.'}</p>`}
    </section>

    ${habits.length ? `<section>
      <div class="sec-row"><h2 class="sec">Привычки</h2></div>
      <div class="habits">${habits.map((b) => {
        const s = statusOf(t, b.id);
        return `<button class="hbt" type="button" data-act="${s === 'done' ? 'block-undo' : 'block-done'}" data-key="${t}" data-id="${esc(b.id)}" aria-pressed="${s === 'done'}">
          <span class="box">${s === 'done' ? icon('check', 's') : ''}</span><span><b>${esc(b.title)}</b><br><span class="small muted">${fmtTime(b.start)} · ${fmtDur(b.end - b.start)}</span></span></button>`;
      }).join('')}</div>
    </section>` : ''}

    ${gym ? `<p class="note">${icon('dumbbell', 's')}<span>Зал ${fmtTime(gym.start)}–${fmtTime(gym.end)}. Тренировка и питание — в приложении <a href="modules/podhod/index.html">«Подход»</a>.</span></p>` : ''}

    ${game ? `<p class="note">${icon('game', 's')} Counter-Strike ${fmtTime(game.start)}–${fmtTime(game.end)}. ${pendingStudy ? `Сначала ${pendingStudy} ${plural(pendingStudy, 'учебный блок', 'учебных блока', 'учебных блоков')} — потом игра как награда.` : game.reward ? 'Блоки сделаны — игра заслужена.' : 'Свободное время.'} Закончить за ${CONFIG.game.endBeforeSleepMin} минут до отбоя (${fmtTime(plan.info.bed)}).</p>` : ''}

    ${timerCard()}

    <section class="band" aria-label="Горит">
      <div class="sec-row"><h2 class="sec">Горит</h2><span class="small muted">${sim.shortages.length ? `не хватает времени: ${sim.shortages.length}` : 'по плану успеваешь'}</span></div>
      ${next.length ? next.map((e) => {
        const p = eventProgress(st, e);
        return `<div class="stack" style="gap:6px"><span class="eyebrow">${relDays(t, e.date)} · ${esc(EVENT_TYPES[e.type].label)}</span><b>${esc(eventTitle(e))}</b>
          ${p.need ? `<div class="progress" style="background:var(--band-line)"><i style="width:${Math.min(100, Math.round((p.done / p.need) * 100))}%;background:var(--band-ink)"></i></div>` : ''}</div>`;
      }).join('') : '<p>Две недели без дедлайнов.</p>'}
      <button class="btn block" type="button" data-act="go" data-to="burning">Открыть «Горит»</button>
    </section>

    ${importantClasses.length ? `<section>
      <div class="sec-row"><h2 class="sec">Важные пары</h2></div>
      <ul class="list">${importantClasses.map((c) => {
        const k = `${t}|${c.id}`;
        const a = st.attendance[k];
        return `<li class="li"><span class="grow"><span class="t">${esc(subjShort(c.subject))} · ${esc(KIND_LABEL[c.kind] || '')}</span><span class="m">${fmtTime(c.startMin)}–${fmtTime(c.endMin)}${c.kind === 'lab' ? ' · пропуск лабы обычно нужно отрабатывать' : ''}</span></span>
          <span class="row"><button class="btn small ${a === 'present' ? '' : 'ghost'}" type="button" data-act="att" data-k="${esc(k)}" data-v="present" aria-pressed="${a === 'present'}">Был</button></span></li>`;
      }).join('')}</ul>
    </section>` : ''}

    ${bank.error ? `<p class="small muted">${esc(bank.error)}</p>` : ''}
    <button class="btn ghost block" type="button" data-act="go" data-to="day/${t}">Весь день по часам</button>`;
}

/* ---------- «Горит» ---------- */

function catchUpSection(st, sim) {
  const planned = plannedCatchUp(sim, st);
  const rows = st.subjects.map((s) => ({ s, total: catchUpTotal(st, s), done: catchUpDone(st, s) })).filter((x) => x.total > 0);
  if (!rows.length) return '';
  const left = rows.filter((x) => x.done < x.total).length;
  return `<section>
    <div class="sec-row"><h2 class="sec">Догоняю</h2><span class="small muted">${left ? `${left} ${plural(left, 'предмет', 'предмета', 'предметов')}` : 'всё догнано'}</span></div>
    ${rows.map(({ s, total, done }) => {
      const d = Math.min(total, done);
      const pct = Math.round((d / total) * 100);
      const short = sim.catchUpShort.find((x) => x.subject === s.id);
      const until = catchUpWindow(s, sim.today).until;
      return `<div class="stack" style="gap:6px;padding-block:10px;border-bottom:1px solid var(--line-soft)">
        <div class="row" style="justify-content:space-between"><b>${esc(s.short)}</b><span class="small muted">${d >= total ? 'догнано' : `осталось ${fmtDur(total - d)} · до ${esc(humanDate(until))}`}</span></div>
        <div class="progress ${pct >= 100 ? 'ok' : ''}"><i style="width:${pct}%"></i></div>
        ${d < total ? `<span class="tiny muted">${s.catchUpByTopic ? 'по темам докладов · ' : s.behindDays ? `отставание ${s.behindDays} ${plural(s.behindDays, 'день', 'дня', 'дней')} · ` : ''}в плане на 3 недели: ${fmtDur(planned[s.id] || 0)}${short ? ` · <b style="color:var(--danger)">к сроку не хватает ~${fmtDur(short.short)}</b>` : ''}</span>
          ${short ? `<button class="btn small ghost" type="button" data-act="catchup-extend" data-id="${esc(s.id)}">Дать ещё неделю</button>` : ''}` : ''}
      </div>`;
    }).join('')}
    <p class="small muted" style="margin:0">Блоки «Догоняю» идут сразу после ближайших дедлайнов. Отставание меняется в «Настройках → Предметы».</p>
  </section>`;
}

const OPTION_TEXT = {
  shrink: (o) => [`Сократить до минимума (−${fmtDur(o.gain)})`, 'Только типовые задачи и главные формулы.'],
  nogame: (o) => [`Без игры до дедлайна (+${fmtDur(o.gain)})`, `${o.days.length} ${plural(o.days.length, 'вечер', 'вечера', 'вечеров')}. Решаешь ты — сам план игру не убирает.`],
  sunday: (o) => [`Взять воскресенье (+${fmtDur(o.gain)})`, 'Пара часов после обеда, остальное — выходной.'],
  morning: (o) => [`Учиться в утренней дороге (+${fmtDur(o.gain)})`, `${o.days.map((k) => WD_LONG[new Date(`${k}T12:00`).getDay()]).join(', ')}: в эти дни встаёшь позже и, возможно, не досыпаешь в поезде.`],
  pause: (o) => ['Пауза поддержки слабых предметов', `${o.subjects.join(', ')} — ${o.subjects.length > 1 ? 'подождут' : 'подождёт'} до конца завала.`],
};

export function renderBurning() {
  const st = store.state;
  const t = today();
  const sim = getSim();
  const planned = plannedByEvent(sim, st);
  const list = upcoming(14);
  const nm = nowMin();
  // Что делать первым — ближайший несделанный учебный блок
  let first = null;
  for (let d = 0; d < 7 && !first; d++) {
    const k = addDays(t, d);
    const p = sim.plans[k];
    if (!p) continue;
    first = p.blocks.find((b) => b.type === 'study' && !statusOf(k, b.id) && (d > 0 || b.end > nm));
    if (first) first = { ...first, day: k };
  }
  const openTopics = st.subjects.map((s) => {
    const ts = st.topics.filter((x) => x.subject === s.id);
    return { s, total: ts.length, open: ts.filter((x) => x.status === 'new' || x.status === 'learning').length };
  }).filter((x) => x.total);
  const session = st.events.find((e) => e.type === 'session' && !e.done);

  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="calendar">${icon('back', 's')}Календарь</button>
      <span class="eyebrow">Ближайшие 14 дней</span>
      <h1 class="display">Горит</h1>
    </header>

    <section class="band">
      <span class="eyebrow">Что делать первым</span>
      ${first ? `<b class="serif" style="font-size:24px;line-height:1.2">${esc(first.title)}</b>
        <span class="muted small">${first.day === t ? 'сегодня' : esc(humanDate(first.day))}, ${fmtTime(first.start)} · ${esc(PLACE_LABEL[first.place] || '')} · ${fmtDur(first.min || 0)}</span>
        ${first.first ? `<span>С чего начать: ${esc(first.first)}</span>` : ''}
        <button class="btn" type="button" data-act="go" data-to="day/${first.day}">Открыть день</button>`
        : '<span>Учебных блоков на неделю нет — можно подтянуть слабые темы на экране «Темы».</span>'}
    </section>

    ${sim.shortages.map((s) => {
      const ev = eventById(st, s.eventId);
      if (!ev) return '';
      return `<section class="card">
        <span class="eyebrow" style="color:var(--danger)">Не хватает ~${fmtDur(s.short)}</span>
        <b>${esc(eventTitle(ev))} · ${esc(humanDate(ev.date))}</b>
        <p class="small muted" style="margin:0">Честно: при нынешнем режиме до этого события не успеть всё. Сон не трогаю. Что можно сделать:</p>
        <div class="stack">${s.options.map((o, i) => {
          const [title, desc] = OPTION_TEXT[o.kind](o);
          return `<button class="li" type="button" data-act="short-apply" data-ev="${esc(ev.id)}" data-i="${i}"><span class="grow"><span class="t">${esc(title)}</span><span class="m">${esc(desc)}</span></span>${icon('chev', 'chev s')}</button>`;
        }).join('')}</div>
      </section>`;
    }).join('')}

    ${catchUpSection(st, sim)}

    <section>
      <div class="sec-row"><h2 class="sec">Дедлайны</h2><span class="small muted">${list.length}</span></div>
      ${list.length ? list.map((e) => {
        const p = eventProgress(st, e);
        const short = sim.shortages.find((s) => s.eventId === e.id);
        const pct = p.need ? Math.min(100, Math.round((p.done / p.need) * 100)) : 0;
        return `<div>${eventRow(e)}
          ${p.need ? `<div class="stack" style="gap:4px;padding:0 0 12px 70px">
            <div class="progress ${pct >= 100 ? 'ok' : ''}"><i style="width:${pct}%"></i></div>
            <span class="tiny muted">сделано ${fmtDur(p.done)} из ${fmtDur(p.need)} · в плане ${fmtDur(planned[e.id] || 0)}${short ? ` · <b style="color:var(--danger)">не хватает ${fmtDur(short.short)}</b>` : ' · успеваешь'}</span></div>` : ''}</div>`;
      }).join('') : '<p class="lead">Две недели без дедлайнов. Хорошее время подтянуть слабые темы.</p>'}
    </section>

    <section>
      <div class="sec-row"><h2 class="sec">Темы не закрыты</h2><button class="btn quiet small" type="button" data-act="go" data-to="topics">Темы →</button></div>
      <ul class="list">${openTopics.map((x) => `<li class="li"><span class="grow"><span class="t">${esc(x.s.short)}</span><span class="m">${x.open} из ${x.total} — «не начал» или «учу»</span></span>${Number(x.s.level) <= CONFIG.weakLevelMax ? '<span class="chip warn">слабый</span>' : ''}</li>`).join('')}</ul>
    </section>

    ${session ? `<p class="note">До сессии ${daysBetween(t, session.date)} ${plural(daysBetween(t, session.date), 'день', 'дня', 'дней')}${session.confirmed ? '' : ' (дата примерная — поправь, когда узнаешь)'}.</p>` : ''}`;
}

/* ---------- Действия ---------- */

function applyShortage(evId, i) {
  const s = getSim().shortages.find((x) => x.eventId === evId);
  const o = s?.options[Number(i)];
  if (!o) return;
  const t = today();
  commit((st) => {
    if (o.kind === 'shrink') {
      const ev = st.events.find((e) => e.id === evId);
      if (ev) ev.prepMin = o.to;
    } else if (o.kind === 'sunday') st.settings.sundayExtra = true;
    else if (o.kind === 'pause') st.settings.pauseMaintenance = true;
    else if (o.kind === 'nogame' || o.kind === 'morning') {
      for (const k of o.days) st.dayOverrides[k] = { ...(st.dayOverrides[k] || {}), [o.kind === 'nogame' ? 'noGame' : 'morningStudy']: true };
    }
    if (st.plans[t]) st.plans[t] = buildTodayPlan(st, t, nowMin());
  });
  toast('Готово, план пересчитан. Отменить можно в «Настройках» или в «Править день».');
}

export const todayActions = {
  'timer-start': () => {
    const ts = timerState();
    try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { /* без звука */ }
    commit((st) => { st.timer = { ...ts, running: true, endsAt: Date.now() + ts.remaining }; });
    ensureTicker();
    toast(`Таймер: ${mmss(ts.remaining)}. Телефон экраном вниз.`);
  },
  'timer-pause': () => {
    const ts = timerState();
    commit((st) => { st.timer = { ...ts, running: false, remaining: leftMs(ts), endsAt: null }; });
  },
  'timer-reset': () => {
    const ts = timerState();
    if (ts.phase === 'work') addFocus(Math.floor((WORK - leftMs(ts)) / 60000));
    commit((st) => { st.timer = { phase: 'work', running: false, remaining: WORK, endsAt: null }; });
  },
  'ci-energy': (el) => {
    const energy = el.dataset.v;
    const t = today();
    commit((st) => {
      st.checkins[t] = { ...(st.checkins[t] || {}), morning: { energy, at: Date.now() } };
      st.dayOverrides[t] = { ...(st.dayOverrides[t] || {}), energy };
      if (energy !== (st.plans[t]?.energy || 'mid')) st.plans[t] = buildTodayPlan(st, t, nowMin(), { energy });
    });
    if (energy === 'low') toast('Понял. Сегодня полегче — план ужат, сон и отдых на месте.');
  },
  'ci-agree': () => {
    const t = today();
    const ids = planFor(t).blocks.filter((b) => b.type === 'study').map((b) => b.id);
    commit((st) => { st.checkins[t].morning.agreed = ids; });
  },
  'ci-evening': (el) => {
    const t = today();
    commit((st) => { st.checkins[t] = { ...(st.checkins[t] || {}), evening: { result: el.dataset.v, at: Date.now() } }; });
  },
  'ci-reason': (el) => {
    const t = today();
    commit((st) => { st.checkins[t].evening.reason = el.dataset.v === 'skip' ? 'none' : el.dataset.v; });
  },
  'short-apply': (el) => applyShortage(el.dataset.ev, el.dataset.i),
  'catchup-extend': (el) => {
    const t = today();
    commit((st) => {
      const s = st.subjects.find((x) => x.id === el.dataset.id);
      if (s) s.catchUpWeeks = (Number(s.catchUpWeeks) || CONFIG.catchUp.weeks) + 1;
      if (st.plans[t]) st.plans[t] = buildTodayPlan(st, t, nowMin());
    });
    toast('Срок продлён на неделю, план пересчитан.');
  },
  'backup-snooze': () => {
    commit((st) => { st.settings.backupSnoozeUntil = Date.now() + 86400000; });
  },
  'error-dismiss': () => {
    store.lastError = null;
    commit(() => {});
  },
};

