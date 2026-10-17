/* =====================================================================
   «Настройки»: режим недели, сон, пары, предметы, посещаемость, контроль,
   игра и привычки, напоминания (.ics), данные, банк заданий, внешний вид,
   «честно про ИИ».
   ===================================================================== */

import { CONFIG, EVENT_TYPES } from '../config.js';
import { commit, defaultState, exportPayload, parseBackup, replaceState, store } from '../store.js';
import { buildTodayPlan, catchUpDone, catchUpTotal, subjectOf } from '../planner.js';
import { classOccurs } from '../schedule.js';
import { buildIcs } from '../ics.js';
import { addDays, esc, fmtDur, humanDate, plural, toMin, uid, WD_LONG, WD_SHORT } from '../util.js';
import { closeSheet, confirmSheet, copyText, icon, isPreview, openSheet, shareOrSave, textFallbackSheet, toast } from '../ui.js';
import { go } from '../nav.js';
import { bank } from '../bank.js';
import { KIND_LABEL, getSim, levelDots, nowMin, subjShort, today } from './shared.js';
import { segButtons, segValue, switchBtn, switchValue, wireControls } from './events.js';

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const EVERY_LABEL = { 1: 'каждую неделю', 2: 'через неделю', 4: 'раз в 4 недели' };

/** Пересобрать сегодняшний план после изменения настроек. */
function replan(st) {
  const t = today();
  if (st.plans[t]) st.plans[t] = buildTodayPlan(st, t, nowMin());
}

const row = (act, title, sub, extra = '') => `<li><button class="li" type="button" data-act="${act}" ${extra}>
  <span class="grow"><span class="t">${esc(title)}</span><span class="m">${esc(sub)}</span></span>${icon('chev', 'chev s')}</button></li>`;

/* ---------- Главный экран настроек ---------- */

export function renderSettings() {
  const st = store.state;
  const s = st.settings;
  const weak = st.subjects.filter((x) => Number(x.level) <= CONFIG.weakLevelMax).map((x) => x.short).join(', ');
  const session = st.events.find((e) => e.type === 'session');
  return `
    <header class="head">
      <span class="eyebrow">${CONFIG.appName} · данные хранятся на этом телефоне</span>
      <h1 class="display">Настройки</h1>
    </header>

    <section><div class="sec-row"><h2 class="sec">Режим</h2></div><ul class="list">
      ${row('set-week', 'Шаблон недели', 'Подъём, выход, пары, дом, отбой — по дням')}
      ${row('set-sleep', 'Сон', `минимум ${String(s.minSleepHours).replace('.', ',')} ч${s.fridayException ? ' · ночь Пт→Сб — 6 ч + дневной сон' : ''}`)}
      ${row('go', 'Пары', `${st.classes.length} ${plural(st.classes.length, 'пара', 'пары', 'пар')} в шаблоне · чередование и «раз в 4 недели»`, 'data-to="classes"')}
      ${row('set-session', 'Сессия', session ? `${humanDate(session.date)}${session.confirmed ? '' : ' · примерно'}` : 'дата не задана')}
    </ul></section>

    <section><div class="sec-row"><h2 class="sec">Учёба</h2></div><ul class="list">
      ${row('go', 'Предметы', `${st.subjects.length} · слабые: ${weak || 'нет'}`, 'data-to="subjects"')}
      ${row('go', 'Посещаемость', 'пропуски по предметам и лимиты', 'data-to="attendance"')}
    </ul></section>

    <section><div class="sec-row"><h2 class="sec">Контроль</h2></div><ul class="list">
      ${row('set-control', 'Строгость и договорённость', `${{ soft: 'мягко', medium: 'средне', strict: 'строго' }[s.strictness]}${s.agreement ? ' · утром договорились, вечером отчёт' : ''}`)}
      ${row('set-habits', 'Игра и привычки', `${s.gameMinutes ? `Counter-Strike ${s.gameMinutes} мин после учёбы` : 'без игры'}${s.duolingo ? ' · Duolingo' : ''}${s.sport ? ' · зарядка' : ''}`)}
      ${row('set-reminders', 'Напоминания', 'Календарь iPhone (.ics) — сейчас; Telegram-бот — второй этап')}
    </ul></section>

    <section><div class="sec-row"><h2 class="sec">Данные</h2></div><ul class="list">
      ${row('set-data', 'Копия и восстановление', s.lastBackupAt ? `последняя копия: ${new Date(s.lastBackupAt).toLocaleDateString('ru-RU')}` : 'копии ещё не было')}
      ${row('set-bank', 'Банк заданий', `${bank.data.tasks.length} в файле · ${st.customTasks.length} своих`)}
    </ul></section>

    <section><div class="sec-row"><h2 class="sec">Прочее</h2></div><ul class="list">
      ${row('set-look', 'Внешний вид', `${{ auto: 'как на iPhone', light: 'светлая', dark: 'тёмная' }[s.theme]} · ${s.motion === 'none' ? 'без анимаций' : 'лёгкие анимации'}`)}
      ${row('set-ai', 'Честно про ИИ', 'что приложение умеет само, а что — нет')}
    </ul></section>
    <p class="tiny muted">Версия данных ${CONFIG.dataVersion}. Работает без интернета после первого открытия.</p>`;
}

export function mountSettings(params) {
  if (params?.[0] === 'week') openWeek();
}

/* ---------- Шаблон недели ---------- */

function weekSummary(d) {
  if (!d) return '—';
  if (!d.leave) return `подъём ${d.wake || '—'} · отбой ${d.sleep || '—'} · без пар`;
  return `${d.wake} · выход ${d.leave} · пары ${d.classStart}–${d.classEnd} · дома ${d.home} · отбой ${d.sleep}`;
}

function openWeek() {
  const st = store.state;
  openSheet({
    title: 'Шаблон недели',
    body: `<p class="small muted">Из шаблона каждая неделя собирается сама; отдельный день правится на его экране («Править день»). Звёздочка — время, которое я предположил, а ты не подтверждал.</p>
      <ul class="list">${WEEK_ORDER.map((wd) => {
        const d = st.week[wd];
        return `<li><button class="li" type="button" data-act="week-day" data-wd="${wd}"><span class="grow"><span class="t">${WD_LONG[wd]}${d?.assumed?.length ? ' *' : ''}</span><span class="m">${esc(weekSummary(d))}</span></span>${icon('chev', 'chev s')}</button></li>`;
      }).join('')}</ul>`,
  });
}

const DAY_FIELDS = [['wake', 'Подъём'], ['leave', 'Выхожу из дома'], ['classStart', 'Пары с'], ['classEnd', 'Пары до'], ['home', 'Дома в'], ['sleep', 'Отбой']];

function openWeekDay(wd) {
  const st = store.state;
  const d = st.week[wd] || {};
  const hasClasses = !!d.leave || st.classes.some((c) => Number(c.weekday) === wd);
  openSheet({
    title: WD_LONG[wd],
    body: `<div class="times">${DAY_FIELDS.filter(([f]) => hasClasses || f === 'wake' || f === 'sleep').map(([f, label]) => `
        <div class="field"><label for="wk-${f}">${label}${d.assumed?.includes(f) ? ' *' : ''}</label><input class="inp" type="time" id="wk-${f}" value="${esc(d[f] || '')}"></div>`).join('')}</div>
      <p class="small muted">Время «пары с/до» берётся из расписания пар, если в этот день пары есть, — здесь оно нужно, чтобы считать дорогу.</p>
      <button class="btn block" type="button" id="wk-save">Сохранить</button>`,
    onMount: (body) => body.querySelector('#wk-save').addEventListener('click', () => {
      const next = {};
      for (const [f] of DAY_FIELDS) {
        const v = body.querySelector(`#wk-${f}`)?.value;
        if (v) next[f] = v;
      }
      if (!next.wake || !next.sleep) {
        toast('Нужны хотя бы подъём и отбой.');
        return;
      }
      commit((s) => {
        s.week[wd] = next; // правка снимает пометки «предположил»
        replan(s);
      });
      closeSheet(true);
      toast('Шаблон обновлён. План пересчитан.');
    }),
  });
}

/* ---------- Сон ---------- */

function openSleep() {
  const s = store.state.settings;
  openSheet({
    title: 'Сон',
    body: `<div class="field"><span class="eyebrow">Минимум сна ночью — план его никогда не нарушает</span>
        ${segButtons('min', [[6, '6 ч'], [6.5, '6,5'], [7, '7 ч'], [7.5, '7,5'], [8, '8 ч']], s.minSleepHours)}</div>
      ${switchBtn('fri', 'Исключение: ночь Пт→Сб — 6 ч + дневной сон в субботу', s.fridayException)}
      <p class="small muted">Без исключения пятничная ночь всё равно не дотягивает до минимума: дома в 22:30, подъём в 05:00. Приложение просто честно это покажет и уберёт из вечера учёбу и игры.</p>
      <button class="btn block" type="button" id="sl-save">Сохранить</button>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#sl-save').addEventListener('click', () => {
        commit((st) => {
          st.settings.minSleepHours = Number(segValue(body, 'min') || 7);
          st.settings.fridayException = switchValue(body, 'fri');
          replan(st);
        });
        closeSheet(true);
        toast('Сохранено.');
      });
    },
  });
}

/* ---------- Сессия ---------- */

function openSession() {
  const ev = store.state.events.find((e) => e.type === 'session');
  openSheet({
    title: 'Сессия',
    body: `<div class="field"><label for="ss-date">Начало сессии</label><input class="inp" type="date" id="ss-date" value="${esc(ev?.date || store.state.settings.sessionStart)}"></div>
      ${switchBtn('exact', 'Дата точная', ev ? ev.confirmed : false)}
      <p class="small muted">Экзамены и зачёты добавляй отдельными событиями — к ним приложение посчитает часы подготовки.</p>
      <button class="btn block" type="button" id="ss-save">Сохранить</button>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#ss-save').addEventListener('click', () => {
        const date = body.querySelector('#ss-date').value;
        if (!date) return toast('Нужна дата.');
        const exact = switchValue(body, 'exact');
        commit((st) => {
          st.settings.sessionStart = date;
          st.settings.sessionApprox = !exact;
          const e = st.events.find((x) => x.type === 'session');
          const upd = { date, confirmed: exact, title: exact ? 'Начало сессии' : 'Начало сессии (примерно)', note: exact ? '' : 'Точной даты нет — поменяй, когда узнаешь.' };
          if (e) Object.assign(e, upd);
          else st.events.push({ id: uid('ev'), subject: null, type: 'session', time: null, format: '', phone: '?', ...upd });
        });
        closeSheet(true);
        toast('Сохранено.');
      });
    },
  });
}

/* ---------- Предметы ---------- */

export function renderSubjects() {
  const st = store.state;
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="settings">${icon('back', 's')}Настройки</button>
      <span class="eyebrow">Уровень, отставание, отметки, лимит пропусков</span>
      <h1 class="display m">Предметы</h1>
    </header>
    <ul class="list">${st.subjects.map((s) => `<li><button class="li" type="button" data-act="subj-edit" data-id="${esc(s.id)}">
      <span class="grow"><span class="t">${esc(s.name)}</span><span class="m">${levelDots(s.level)} ${Number(s.level) <= CONFIG.weakLevelMax && !s.noStudy ? '· слабый' : ''}${s.noStudy ? '· только посещаемость' : ''}${(() => { const tot = catchUpTotal(st, s); const left = Math.max(0, tot - catchUpDone(st, s)); return left ? ` · догнать ещё ${fmtDur(left)}` : ''; })()}${s.marked === true ? ' · отмечают' : ''}${s.missLimit != null && s.missLimit !== '' ? ` · лимит ${s.missLimit}` : ''}${s.note ? ` · ${esc(s.note)}` : ''}</span></span>${icon('chev', 'chev s')}</button></li>`).join('')}</ul>
    <button class="btn ghost block" type="button" data-act="subj-edit" data-id="">${icon('plus', 's')}Предмет</button>`;
}

function openSubject(id) {
  const st = store.state;
  const s = id ? subjectOf(st, id) : { id: uid('subj'), name: '', short: '', level: 3, marked: null, missLimit: null };
  const total = catchUpTotal(st, s);
  const done = Math.min(total, catchUpDone(st, s));
  openSheet({
    title: id ? s.short || 'Предмет' : 'Новый предмет',
    body: `<div class="field"><label for="sj-name">Название</label><input class="inp" id="sj-name" value="${esc(s.name)}"></div>
      <div class="field"><label for="sj-short">Коротко</label><input class="inp" id="sj-short" value="${esc(s.short)}" placeholder="Матан, Линал…"></div>
      <div class="field"><span class="eyebrow">Уровень: 1 — плаваю, 5 — уверенно</span>${segButtons('lvl', [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']], s.level)}</div>
      <p class="small muted" style="margin:0">Уровень 1–2 — «слабый»: больше часов на подготовку и немного времени каждую неделю.</p>

      <div class="field"><label for="sj-behind">Отстаю на (дней материала)</label><input class="inp" id="sj-behind" inputmode="numeric" value="${esc(s.behindDays ?? '')}" placeholder="0 — не отстаю"></div>
      <div class="field"><span class="eyebrow">Догнать за</span>${segButtons('weeks', [[1, '1 нед.'], [2, '2'], [3, '3'], [4, '4'], [6, '6'], [8, '8'], [10, '10']], s.catchUpWeeks || CONFIG.catchUp.weeks)}</div>
      <div class="field"><label for="sj-cmin">Или часов на догоняние (если знаешь точнее)</label><input class="inp" id="sj-cmin" inputmode="decimal" value="${s.catchUpMin != null && s.catchUpMin !== '' ? esc(String(Math.round((s.catchUpMin / 60) * 10) / 10).replace('.', ',')) : ''}" placeholder="пусто — посчитаю по дням"></div>
      ${total ? `<p class="small muted" style="margin:0">Догнать: ${fmtDur(total)}, сделано ${fmtDur(done)}${s.behindSince ? ` · с ${esc(humanDate(s.behindSince))}` : ''}. Если поменять отставание, отсчёт начнётся заново с сегодняшнего дня.</p>` : ''}

      <div class="field"><span class="eyebrow">Отмечают посещаемость?</span>${segButtons('marked', [['yes', 'да'], ['no', 'нет'], ['?', 'не знаю']], s.marked === true ? 'yes' : s.marked === false ? 'no' : '?')}</div>
      <div class="field"><label for="sj-limit">Сколько пропусков допускается (пар)</label><input class="inp" id="sj-limit" inputmode="numeric" value="${esc(s.missLimit ?? '')}" placeholder="пусто — лимита нет"></div>
      ${switchBtn('nostudy', 'Без учёбы — только посещаемость (как физкультура)', !!s.noStudy)}
      <div class="row"><button class="btn" type="button" id="sj-save">Сохранить</button>${id ? `<button class="btn danger" type="button" id="sj-del">${icon('trash', 's')}Удалить</button>` : ''}</div>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#sj-save').addEventListener('click', () => {
        const name = body.querySelector('#sj-name').value.trim();
        if (!name) return toast('Нужно название.');
        const lim = body.querySelector('#sj-limit').value.trim();
        if (lim && !/^\d+$/.test(lim)) return toast('Лимит — целое число пар или пусто.');
        const behindRaw = body.querySelector('#sj-behind').value.trim();
        if (behindRaw && !/^\d+$/.test(behindRaw)) return toast('Отставание — целое число дней или пусто.');
        const cminRaw = body.querySelector('#sj-cmin').value.trim().replace(',', '.');
        const cminH = cminRaw === '' ? null : Number(cminRaw);
        if (cminRaw !== '' && (Number.isNaN(cminH) || cminH < 0 || cminH > 200)) return toast('Часы на догоняние — число, например 4,5.');
        const m = segValue(body, 'marked');
        const next = {
          ...s, name, short: body.querySelector('#sj-short').value.trim() || name.split(' ')[0],
          level: Number(segValue(body, 'lvl') || 3), marked: m === 'yes' ? true : m === 'no' ? false : null,
          missLimit: lim === '' ? null : Number(lim),
          behindDays: behindRaw === '' ? 0 : Number(behindRaw),
          catchUpWeeks: Number(segValue(body, 'weeks') || CONFIG.catchUp.weeks),
          catchUpMin: cminH == null ? null : Math.round(cminH * 60),
          noStudy: switchValue(body, 'nostudy'),
        };
        // отставание поменяли — отсчитываем заново с сегодняшнего дня
        const changed = Number(next.behindDays || 0) !== Number(s.behindDays || 0) || (next.catchUpMin ?? null) !== (s.catchUpMin ?? null);
        commit((st2) => {
          if (changed) {
            next.behindSince = today();
            delete st2.progress[`c:${next.id}:light`];
            delete st2.progress[`c:${next.id}:heavy`];
          }
          const i = st2.subjects.findIndex((x) => x.id === next.id);
          if (i >= 0) st2.subjects[i] = next;
          else st2.subjects.push(next);
          replan(st2);
        });
        closeSheet(true);
        toast('Сохранено. План пересчитан.');
      });
      body.querySelector('#sj-del')?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Удалить предмет?', text: 'Удалятся его пары и темы. События останутся без предмета.', ok: 'Удалить', danger: true });
        if (!ok) return;
        commit((st2) => {
          st2.subjects = st2.subjects.filter((x) => x.id !== id);
          st2.classes = st2.classes.filter((c) => c.subject !== id);
          st2.topics = st2.topics.filter((t) => t.subject !== id);
          for (const e of st2.events) if (e.subject === id) e.subject = null;
          replan(st2);
        });
        toast('Удалено.');
      });
    },
  });
}

/* ---------- Пары ---------- */

export function renderClasses() {
  const st = store.state;
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="settings">${icon('back', 's')}Настройки</button>
      <span class="eyebrow">Расписание пар</span>
      <h1 class="display m">Пары</h1>
    </header>
    <p class="small muted">«Через неделю» и «раз в 4 недели» считаются от даты одного из занятий. Так сделаны чередование вторника и лабы по физике.</p>
    ${WEEK_ORDER.map((wd) => {
      const list = st.classes.filter((c) => Number(c.weekday) === wd).sort((a, b) => toMin(a.start) - toMin(b.start));
      if (!list.length) return '';
      return `<section><div class="sec-row"><h2 class="sec">${WD_LONG[wd]}</h2></div><ul class="list">${list.map((c) => `
        <li><button class="li" type="button" data-act="class-edit" data-id="${esc(c.id)}"><span class="grow"><span class="t">${esc(c.start)}–${esc(c.end)} · ${esc(subjShort(c.subject))}</span>
        <span class="m">${esc(KIND_LABEL[c.kind] || '')} · ${EVERY_LABEL[c.every || 1] || ''}${c.anchor && (c.every || 1) > 1 ? ` с ${esc(humanDate(c.anchor))}` : ''}</span></span>${icon('chev', 'chev s')}</button></li>`).join('')}</ul></section>`;
    }).join('')}
    <button class="btn ghost block" type="button" data-act="class-edit" data-id="">${icon('plus', 's')}Пара</button>`;
}

function openClass(id) {
  const st = store.state;
  const c = id ? st.classes.find((x) => x.id === id) : { id: uid('cl'), subject: st.subjects[0]?.id, weekday: 1, start: '09:00', end: '10:30', kind: 'practice', every: 1, anchor: today() };
  openSheet({
    title: id ? 'Пара' : 'Новая пара',
    body: `<div class="field"><label for="cl-subj">Предмет</label><select class="inp" id="cl-subj">${st.subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === c.subject ? 'selected' : ''}>${esc(s.short)}</option>`).join('')}</select></div>
      <div class="field"><span class="eyebrow">День</span>${segButtons('wd', WEEK_ORDER.map((w) => [w, WD_SHORT[w]]), c.weekday)}</div>
      <div class="times"><div class="field"><label for="cl-start">Начало</label><input class="inp" type="time" id="cl-start" value="${esc(c.start)}"></div>
        <div class="field"><label for="cl-end">Конец</label><input class="inp" type="time" id="cl-end" value="${esc(c.end)}"></div></div>
      <div class="field"><span class="eyebrow">Тип</span>${segButtons('kind', [['lecture', 'лекция'], ['practice', 'практика'], ['lab', 'лаба']], c.kind)}</div>
      <div class="field"><span class="eyebrow">Как часто</span>${segButtons('every', [[1, 'каждую'], [2, 'через нед.'], [4, 'раз в 4 нед.']], c.every || 1)}</div>
      <div class="field"><label for="cl-anchor">Дата одного из занятий (для «через неделю» и «раз в 4»)</label><input class="inp" type="date" id="cl-anchor" value="${esc(c.anchor || today())}"></div>
      <div class="row"><button class="btn" type="button" id="cl-save">Сохранить</button>${id ? `<button class="btn danger" type="button" id="cl-del">${icon('trash', 's')}Удалить</button>` : ''}</div>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#cl-save').addEventListener('click', () => {
        const start = body.querySelector('#cl-start').value;
        const end = body.querySelector('#cl-end').value;
        if (!start || !end || toMin(end) <= toMin(start)) return toast('Конец пары должен быть позже начала.');
        const every = Number(segValue(body, 'every') || 1);
        const next = {
          ...c, subject: body.querySelector('#cl-subj').value, weekday: Number(segValue(body, 'wd') ?? 1), start, end,
          kind: segValue(body, 'kind') || 'practice', every, anchor: every > 1 ? body.querySelector('#cl-anchor').value || today() : undefined,
        };
        if (next.anchor && new Date(`${next.anchor}T12:00`).getDay() !== next.weekday) {
          return toast(`Дата занятия должна приходиться на ${WD_LONG[next.weekday]}.`);
        }
        commit((s) => {
          const i = s.classes.findIndex((x) => x.id === next.id);
          if (i >= 0) s.classes[i] = next;
          else s.classes.push(next);
          replan(s);
        });
        closeSheet(true);
        toast('Сохранено. План пересчитан.');
      });
      body.querySelector('#cl-del')?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Удалить пару?', text: 'Она пропадёт из всех недель.', ok: 'Удалить', danger: true });
        if (!ok) return;
        commit((s) => {
          s.classes = s.classes.filter((x) => x.id !== id);
          replan(s);
        });
        toast('Удалено.');
      });
    },
  });
}

/* ---------- Посещаемость ---------- */

export function renderAttendance() {
  const st = store.state;
  const t = today();
  const byClass = new Map(st.classes.map((c) => [c.id, c]));
  const stats = new Map(st.subjects.map((s) => [s.id, { absent: [], present: 0 }]));
  for (const [k, v] of Object.entries(st.attendance)) {
    const [date, classId] = k.split('|');
    const c = byClass.get(classId);
    if (!c || !stats.has(c.subject)) continue;
    if (v === 'absent') stats.get(c.subject).absent.push({ date, kind: c.kind });
    if (v === 'present') stats.get(c.subject).present += 1;
  }
  // важные пары на 14 дней вперёд: лабы, пары с КР, пары с отметками
  const important = [];
  for (let d = 0; d < 14; d++) {
    const k = addDays(t, d);
    const wd = new Date(`${k}T12:00`).getDay();
    for (const c of st.classes.filter((x) => Number(x.weekday) === wd && classOccurs(x, k))) {
      const ev = st.events.find((e) => e.date === k && e.subject === c.subject && e.type !== 'session' && (!e.time || e.time === c.start));
      const marked = subjectOf(st, c.subject)?.marked === true;
      if (c.kind === 'lab' || ev || marked) important.push({ k, c, why: c.kind === 'lab' ? 'лабораторная' : ev ? EVENT_TYPES[ev.type].label.toLowerCase() : 'отмечают' });
    }
  }
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="settings">${icon('back', 's')}Настройки</button>
      <span class="eyebrow">Честный учёт</span>
      <h1 class="display m">Посещаемость</h1>
    </header>
    <p class="lead small">Отмечай «Был» / «Пропуск» на экране дня. Лимиты вводишь ты — по правилам своего вуза. Приложение ничего не меняет в журналах и не помогает обходить правила: это просто твой счётчик.</p>
    <section><div class="sec-row"><h2 class="sec">Важные пары · 14 дней</h2></div>
      ${important.length ? `<ul class="list">${important.slice(0, 12).map(({ k, c, why }) => `<li class="li"><span class="grow"><span class="t">${esc(subjShort(c.subject))} · ${esc(why)}</span><span class="m">${esc(humanDate(k))}, ${esc(c.start)}</span></span></li>`).join('')}</ul>` : '<p class="small muted">Лаб и отмечаемых пар в ближайшие две недели нет.</p>'}
      <p class="small muted" style="margin:0">Пропуск лабы обычно приходится отрабатывать, а на КР — переписывать. Обычную лекцию без отметок пропустить дешевле, но решать тебе.</p>
    </section>
    <section><div class="sec-row"><h2 class="sec">По предметам</h2></div>
      <ul class="list">${st.subjects.map((s) => {
        const x = stats.get(s.id);
        const lim = s.missLimit;
        const left = lim != null && lim !== '' ? Number(lim) - x.absent.length : null;
        const warn = left != null && (left <= 1 || x.absent.length >= Number(lim) * 0.8);
        return `<li class="li"><span class="grow"><span class="t">${esc(s.short)}</span>
          <span class="m">пропусков: ${x.absent.length}${lim != null && lim !== '' ? ` из ${lim} · можно ещё ${Math.max(0, left)}` : ' · лимит не задан'}${s.marked === true ? ' · отмечают' : s.marked === false ? ' · не отмечают' : ''}</span>
          ${x.absent.length ? `<span class="m">${x.absent.slice(-4).map((a) => esc(humanDate(a.date))).join(', ')}</span>` : ''}
          ${warn ? `<span class="m" style="color:var(--warn)">${left <= 0 ? 'Лимит исчерпан. Узнай у преподавателя, как отработать.' : 'Близко к лимиту — следующие пары лучше не пропускать.'}</span>` : ''}
        </span><button class="btn small ghost" type="button" data-act="subj-edit" data-id="${esc(s.id)}">Лимит</button></li>`;
      }).join('')}</ul>
    </section>`;
}

/* ---------- Контроль, игра, привычки ---------- */

function openControl() {
  const s = store.state.settings;
  openSheet({
    title: 'Строгость',
    body: `${segButtons('strict', [['soft', 'мягко'], ['medium', 'средне'], ['strict', 'строго']], s.strictness)}
      <ul class="small" style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li><b>Мягко</b> — в календарь уходят только дедлайны.</li>
        <li><b>Средне</b> — плюс напоминание к началу каждого учебного блока.</li>
        <li><b>Строго</b> — плюс за 5 минут до блока, утренний и вечерний чек-ин.</li>
      </ul>
      ${switchBtn('agree', 'Договорённость: утром беру задачи, вечером отчёт', s.agreement)}
      <p class="small muted">Тихие часы: напоминаний не бывает во сне, на парах, в игре и в утренней электричке — в эти часы в плане просто нет учебных блоков.</p>
      <button class="btn block" type="button" id="ct-save">Сохранить</button>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#ct-save').addEventListener('click', () => {
        commit((st) => {
          st.settings.strictness = segValue(body, 'strict') || 'strict';
          st.settings.agreement = switchValue(body, 'agree');
        });
        closeSheet(true);
        toast('Сохранено. Не забудь обновить файл календаря.');
      });
    },
  });
}

function openHabits() {
  const s = store.state.settings;
  openSheet({
    title: 'Игра и привычки',
    body: `<div class="field"><span class="eyebrow">Counter-Strike — награда после учебных блоков</span>
        ${segButtons('game', [[0, 'без игры'], [45, '45 мин'], [60, '1 ч'], [75, '1 ч 15'], [90, '1,5 ч']], s.gameMinutes)}</div>
      <p class="small muted" style="margin:0">Игра всегда заканчивается за ${CONFIG.game.endBeforeSleepMin} минут до отбоя. Если вечер короткий — игры нет, сон важнее.</p>
      ${switchBtn('duo', 'Немецкий в Duolingo — 15 минут в электричке', s.duolingo)}
      ${switchBtn('sport', 'Зарядка 15 минут — вт, ср, сб, вс', s.sport)}
      ${switchBtn('sunday', 'Воскресенье по необходимости — 2 ч учёбы', s.sundayExtra)}
      ${switchBtn('pause', 'Пауза поддержки слабых предметов', s.pauseMaintenance)}
      <button class="btn block" type="button" id="hb-save">Сохранить</button>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#hb-save').addEventListener('click', () => {
        commit((st) => {
          st.settings.gameMinutes = Number(segValue(body, 'game') ?? 75);
          st.settings.duolingo = switchValue(body, 'duo');
          st.settings.sport = switchValue(body, 'sport');
          st.settings.sundayExtra = switchValue(body, 'sunday');
          st.settings.pauseMaintenance = switchValue(body, 'pause');
          replan(st);
        });
        closeSheet(true);
        toast('Сохранено. План пересчитан.');
      });
    },
  });
}

/* ---------- Напоминания ---------- */

async function downloadIcs(share) {
  const st = store.state;
  const text = buildIcs({ state: st, sim: getSim(), today: today(), nowMin: nowMin() });
  const r = await shareOrSave({ filename: `ramki-${today()}.ics`, mime: 'text/calendar', text, title: 'Рамки — календарь', preferDownload: !share });
  if (r === 'failed') textFallbackSheet('Файл календаря', text, isPreview() ? 'В превью файлы не скачиваются. В версии на GitHub Pages это кнопка открывает календарь сразу.' : 'Файл не сохранился. Скопируй текст в файл с расширением .ics.');
  else if (r !== 'cancelled') toast('Открой файл и нажми «Добавить все». Обновляй раз в неделю или после большой пересборки.');
}

function openReminders() {
  openSheet({
    title: 'Напоминания',
    body: `<p class="lead small">Честно про iPhone: сайт с экрана «Домой» <b>не может сам будить уведомлениями, когда закрыт</b> — для этого нужен сервер. Поэтому сейчас:</p>
      <ul class="small" style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li><b>Календарь iPhone (.ics)</b> — работает без сервера. Дедлайны, учебные блоки на неделю и чек-ины уходят в календарь с будильниками, iPhone напоминает сам. Минус: после пересборки плана файл нужно открыть заново (раз в неделю — нормально).</li>
        <li><b>Внутри приложения</b> — таймер, подсказки и чек-ины, пока приложение открыто.</li>
        <li><b>Telegram-бот</b> — второй этап: самый надёжный вариант, но нужен маленький сервер (есть бесплатные). Описание — в docs/REMINDERS.md.</li>
      </ul>
      <p class="small muted">Совет: при импорте выбери отдельный календарь «Учёба», чтобы при обновлении просто удалить его и импортировать заново — без дублей.</p>
      <button class="btn block" type="button" id="ics-dl">${icon('download', 's')}Файл календаря на 7 дней</button>
      <button class="btn ghost block" type="button" id="ics-share">${icon('share', 's')}Поделиться файлом</button>`,
    onMount: (body) => {
      body.querySelector('#ics-dl').addEventListener('click', () => downloadIcs(false));
      body.querySelector('#ics-share').addEventListener('click', () => downloadIcs(true));
    },
  });
}

/* ---------- Данные ---------- */

export async function backupNow() {
  const text = JSON.stringify(exportPayload());
  const r = await shareOrSave({ filename: `ramki-backup-${today()}.json`, mime: 'application/json', text, title: 'Копия «Рамок»' });
  if (r === 'shared' || r === 'downloaded') {
    commit((st) => {
      st.settings.lastBackupAt = Date.now();
      st.settings.backupSnoozeUntil = null;
    });
    toast(r === 'shared' ? 'Копия отправлена. Храни её в «Избранном».' : 'Файл копии сохранён.');
  } else if (r === 'failed') {
    commit((st) => { st.settings.lastBackupAt = Date.now(); }, { silent: true });
    textFallbackSheet('Копия данных', text, 'Файлом здесь не отдать. Скопируй текст и отправь себе в Telegram «Избранное». Восстановить — «Восстановить из текста».');
  }
}

async function restoreFrom(text) {
  let next;
  try {
    next = parseBackup(text);
  } catch (e) {
    toast(e.message, 6000);
    return;
  }
  const ok = await confirmSheet({ title: 'Восстановить копию?', text: 'Текущие данные на этом телефоне заменятся данными из копии.', ok: 'Восстановить', danger: true });
  if (!ok) return;
  replaceState(next);
  toast('Данные восстановлены.');
  go('today');
}

function openData() {
  openSheet({
    title: 'Копия и восстановление',
    body: `<p class="lead small">Всё хранится только в этом браузере. Раз в неделю приложение напомнит сохранить копию — проще всего отправить файл себе в Telegram «Избранное».</p>
      <button class="btn block" type="button" id="dt-backup">${icon('share', 's')}Сохранить копию</button>
      <button class="btn ghost block" type="button" id="dt-copy">${icon('copy', 's')}Скопировать копию текстом</button>
      <label class="btn ghost block" for="dt-file">${icon('upload', 's')}Восстановить из файла</label>
      <input class="vh" type="file" id="dt-file" accept="application/json,.json">
      <button class="btn ghost block" type="button" id="dt-paste">Восстановить из текста</button>
      <button class="btn danger block" type="button" id="dt-reset">${icon('trash', 's')}Сбросить всё</button>`,
    onMount: (body) => {
      body.querySelector('#dt-backup').addEventListener('click', backupNow);
      body.querySelector('#dt-copy').addEventListener('click', async () => {
        const text = JSON.stringify(exportPayload());
        const ok = await copyText(text);
        if (ok) {
          commit((st) => { st.settings.lastBackupAt = Date.now(); }, { silent: true });
          toast('Скопировано. Вставь в Telegram «Избранное».');
        } else textFallbackSheet('Копия данных', text, 'Скопируй текст вручную.');
      });
      body.querySelector('#dt-file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (f) restoreFrom(await f.text());
      });
      body.querySelector('#dt-paste').addEventListener('click', () => openSheet({
        title: 'Восстановить из текста',
        body: '<textarea class="inp" id="rs-text" placeholder="Вставь текст копии"></textarea><button class="btn block" type="button" id="rs-go">Восстановить</button>',
        onMount: (b) => b.querySelector('#rs-go').addEventListener('click', () => restoreFrom(b.querySelector('#rs-text').value)),
      }));
      body.querySelector('#dt-reset').addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Сбросить всё?', text: 'Отметки, конспекты, свои задания и правки удалятся. Останутся только данные из опроса. Сначала лучше сохранить копию.', ok: 'Сбросить', danger: true });
        if (!ok) return;
        replaceState(defaultState());
        toast('Начали с чистого листа.');
        go('today');
      });
    },
  });
}

function openBank() {
  const st = store.state;
  openSheet({
    title: 'Банк заданий',
    body: `<p class="lead small">В файле <b>data/bank.json</b> — ${bank.data.tasks.length} заданий и ${bank.data.cards.length} карточек (все — примеры). Своих заданий: ${st.customTasks.length}, колод: ${st.decks.length}.</p>
      <button class="btn block" type="button" data-act="go" data-to="import">${icon('paste', 's')}Добавить задания текстом</button>
      <label class="btn ghost block" for="bk-file">${icon('upload', 's')}Импорт заданий из JSON</label>
      <input class="vh" type="file" id="bk-file" accept="application/json,.json">
      <button class="btn ghost block" type="button" id="bk-export">${icon('download', 's')}Экспорт своих заданий в JSON</button>
      <p class="small muted">Экспорт пригодится, чтобы положить свои задания в data/bank.json на GitHub — тогда они будут на любом устройстве.</p>`,
    onMount: (body) => {
      body.querySelector('#bk-file').addEventListener('change', async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          const json = JSON.parse(await f.text());
          const tasks = (json.tasks || []).filter((t) => t && t.id && t.q && t.subject && (t.answers?.length || t.options?.length));
          const cards = (json.cards || []).filter((c) => c && c.q);
          commit((s) => {
            const have = new Set([...s.customTasks.map((t) => t.id), ...bank.data.tasks.map((t) => t.id)]);
            for (const t of tasks) if (!have.has(t.id)) s.customTasks.push({ ...t, example: false });
            if (cards.length) s.decks.push({ id: uid('deck'), name: `Импорт ${new Date().toLocaleDateString('ru-RU')}`, subject: cards[0].subject || s.subjects[0]?.id, topicId: null, cards: cards.map((c) => ({ id: uid('c'), q: c.q, a: c.a || '' })) });
          });
          closeSheet(true);
          toast(`Импортировано: ${tasks.length} заданий${cards.length ? `, ${cards.length} карточек` : ''}.`);
        } catch {
          toast('Файл не читается как JSON с заданиями.', 5000);
        }
      });
      body.querySelector('#bk-export').addEventListener('click', async () => {
        const text = JSON.stringify({ app: 'ramki', kind: 'bank', version: 1, tasks: st.customTasks, cards: [] }, null, 2);
        const r = await shareOrSave({ filename: 'ramki-my-tasks.json', mime: 'application/json', text, title: 'Мои задания' });
        if (r === 'failed') textFallbackSheet('Мои задания', text, 'Скопируй текст и сохрани как .json.');
      });
    },
  });
}

/* ---------- Внешний вид и честность ---------- */

export function applyLook() {
  const { theme, motion } = store.state.settings;
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
  if (motion === 'none') root.dataset.motion = 'none';
  else delete root.dataset.motion;
}

function openLook() {
  const s = store.state.settings;
  openSheet({
    title: 'Внешний вид',
    body: `<div class="field"><span class="eyebrow">Тема</span>${segButtons('theme', [['auto', 'как iPhone'], ['light', 'светлая'], ['dark', 'тёмная']], s.theme)}</div>
      <div class="field"><span class="eyebrow">Анимации</span>${segButtons('motion', [['light', 'лёгкие'], ['none', 'без анимаций']], s.motion)}</div>
      <p class="small muted">Если на iPhone включено «Уменьшение движения», анимаций не будет в любом случае.</p>
      <button class="btn block" type="button" id="lk-save">Сохранить</button>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#lk-save').addEventListener('click', () => {
        commit((st) => {
          st.settings.theme = segValue(body, 'theme') || 'auto';
          st.settings.motion = segValue(body, 'motion') || 'light';
        });
        applyLook();
        closeSheet(true);
      });
    },
  });
}

function openAi() {
  openSheet({
    title: 'Честно про ИИ',
    body: `<p class="lead small">Внутри приложения <b>нет искусственного интеллекта</b>. Это статический сайт: он не может вызывать ИИ без ключа и сервера, и делать вид, что «думает», было бы нечестно.</p>
      <ul class="small" style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li>План собирается по понятным правилам: дедлайны, часы по типу события, уровень предмета, свободные окна, минимум сна.</li>
        <li>Отработка проверяет ответ по эталону из банка заданий, без «понимания».</li>
        <li>Пополнять банк удобно через чат: присылаешь конспект, фото тетради или список вопросов — получаешь задания в формате для вставки.</li>
      </ul>
      <p class="small muted">Как добавить ИИ-подсказки позже и сколько это стоит — в docs/AI.md в репозитории.</p>`,
  });
}

/* ---------- Действия ---------- */

export const settingsActions = {
  'set-week': openWeek,
  'week-day': (el) => openWeekDay(Number(el.dataset.wd)),
  'set-sleep': openSleep,
  'set-session': openSession,
  'set-control': openControl,
  'set-habits': openHabits,
  'set-reminders': openReminders,
  'set-data': openData,
  'set-bank': openBank,
  'set-look': openLook,
  'set-ai': openAi,
  'subj-edit': (el) => openSubject(el.dataset.id || null),
  'class-edit': (el) => openClass(el.dataset.id || null),
  'backup-share': backupNow,
};
