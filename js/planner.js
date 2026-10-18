/* =====================================================================
   Планировщик. Никакого «ИИ»: обычные правила, которые можно прочитать.

   1. Каждое событие (КР, лаба, зачёт…) превращается в часы подготовки:
      часы по типу × множитель уровня предмета. Часть — «лёгкая»
      (карточки, теория — годится для электрички), часть — «тяжёлая»
      (задачи в тетради, отчёт, презентация — только дома).
   2. Слабые предметы (уровень 1–2) получают немного времени каждую неделю,
      если остаётся место после дедлайнов.
   3. День за днём свободные окна заполняются по правилу «ближайший
      дедлайн — первым». Сон не трогаем никогда, игра — после учёбы,
      максимум 3 задачи в день.
   4. Если до дедлайна не хватает времени, это видно сразу, вместе с
      вариантами, что сократить.
   ===================================================================== */

import { CONFIG, PREP, EVENT_TYPES } from './config.js';
import { baseTimes, classOccurs, classesOn, daySkeleton } from './schedule.js';
import { addDays, daysBetween, floor5, fmtTime, mondayOf, plural, round5, shortDate, toMin, weekdayOf } from './util.js';

export const subjectOf = (state, id) => state.subjects.find((s) => s.id === id) || null;
export const isWeak = (s) => !!s && !s.noStudy && Number(s.level) <= CONFIG.weakLevelMax;
export const eventById = (state, id) => state.events.find((e) => e.id === id) || null;

/* ---------- Помидоры: 25 минут работы, 5 отдыха ---------- */

/** Сколько займёт по часам блок с net минутами чистой работы (с перерывами 25/5). */
export function wallFor(net) {
  const { work, rest } = CONFIG.pomodoro;
  return net + rest * Math.floor(Math.max(0, net - 1) / work);
}

/** Сколько чистой работы влезает в wall минут. */
export function netFor(wall) {
  let n = floor5(wall);
  while (n > 0 && wallFor(n) > wall) n -= 5;
  return Math.max(0, n);
}

/* ---------- Сколько готовиться к событию ---------- */

export function defaultNeedMin(state, ev) {
  const p = PREP[ev?.type];
  if (!p || !p.hours) return 0;
  const lvl = Number(subjectOf(state, ev.subject)?.level) || 3;
  return round5(p.hours * 60 * (CONFIG.levelFactor[lvl] ?? 1));
}

export function eventNeedMin(state, ev) {
  const custom = ev?.prepMin;
  if (custom != null && custom !== '' && !Number.isNaN(Number(custom))) return Math.max(0, round5(Number(custom)));
  return defaultNeedMin(state, ev);
}

/** Минимальная подготовка «только самое нужное» — половина обычной. */
export function minimalNeedMin(state, ev) {
  const base = defaultNeedMin(state, ev);
  return base ? Math.max(30, Math.round((base * 0.5) / 15) * 15) : 0;
}

export function splitNeed(state, ev) {
  const need = eventNeedMin(state, ev);
  const light = round5(need * (PREP[ev.type]?.lightShare ?? 0));
  return { need, light, heavy: need - light };
}

export function eventProgress(state, ev) {
  const { need, light, heavy } = splitNeed(state, ev);
  const doneL = Math.min(light, state.progress?.[`${ev.id}:light`] || 0);
  const doneH = Math.min(heavy, state.progress?.[`${ev.id}:heavy`] || 0);
  return { need, light, heavy, done: doneL + doneH };
}

/** Следующая тема предмета для отработки: сначала «учу», потом «не начал». */
export function nextTopicFor(state, subjectId) {
  const ts = state.topics.filter((t) => t.subject === subjectId);
  return ts.find((t) => t.status === 'learning') || ts.find((t) => t.status === 'new') || ts[0] || null;
}

/* ---------- Догнать отставание ---------- */

/** Сколько минут в неделю идут пары предмета (с учётом «через неделю» и «раз в 4 недели»). */
export function weeklyClassMin(state, subjectId) {
  return state.classes
    .filter((c) => c.subject === subjectId)
    .reduce((sum, c) => sum + Math.max(0, (toMin(c.end) - toMin(c.start)) / (Number(c.every) || 1)), 0);
}

/** Сколько минут нужно, чтобы догнать: задано напрямую или «отстаю на N дней». */
export function catchUpTotal(state, s) {
  if (!s || s.noStudy) return 0;
  if (s.catchUpMin != null && s.catchUpMin !== '' && !Number.isNaN(Number(s.catchUpMin))) {
    return Math.max(0, round5(Number(s.catchUpMin)));
  }
  const days = Number(s.behindDays) || 0;
  if (days <= 0) return 0;
  const lvl = Number(s.level) || 3;
  const min = days * (weeklyClassMin(state, s.id) / 7) * CONFIG.catchUp.factor * (CONFIG.levelFactor[lvl] ?? 1);
  return Math.max(CONFIG.catchUp.minTotal, round5(min));
}

export const catchUpDone = (state, s) => (state.progress?.[`c:${s.id}:light`] || 0) + (state.progress?.[`c:${s.id}:heavy`] || 0);

/** Слабые предметы на поддержке: кого сейчас догоняем, тем поддержка не нужна. */
export const maintSubjects = (state) => state.subjects.filter((s) => isWeak(s) && catchUpTotal(state, s) - catchUpDone(state, s) <= 0);

/** Окно догоняния: с какого дня и до какого. */
export function catchUpWindow(s, today) {
  const from = s.behindSince || today;
  const weeks = Math.max(1, Number(s.catchUpWeeks) || CONFIG.catchUp.weeks);
  return { from, until: addDays(from, weeks * 7 - 1) };
}

/** Темы предмета, пройденные в блоках «догнать» с отметкой «готово». */
export function coveredTopics(state, subjectId) {
  const ids = new Set(state.topics.filter((t) => t.subject === subjectId).map((t) => t.id));
  const out = new Set();
  for (const day of Object.values(state.done || {})) {
    for (const rec of Object.values(day || {})) {
      if (rec?.status !== 'done' || !Array.isArray(rec.topics)) continue;
      for (const id of rec.topics) if (ids.has(id)) out.add(id);
    }
  }
  return out;
}

/**
 * Очередь тем при догонянии по темам — общая на весь расчёт (дни планируются по очереди):
 * taken — пройденные и уже стоящие в плане, minLeft — сколько минут догоняния ещё не расписано.
 */
function topicCursor(state, items, subjectId) {
  const cur = (items.cursor ||= {});
  if (!cur[subjectId]) {
    const s = subjectOf(state, subjectId);
    const taken = coveredTopics(state, subjectId);
    for (const t of state.topics) if (t.subject === subjectId && (t.status === 'understood' || t.status === 'reviewed')) taken.add(t.id);
    cur[subjectId] = { taken, minLeft: Math.max(0, catchUpTotal(state, s) - catchUpDone(state, s)) };
  }
  return cur[subjectId];
}

/** Блок сегодняшнего плана ещё впереди — его темы и минуты уже заняты. */
function reserveTopics(state, items, b) {
  if (!b.catchUp || !b.topicIds?.length) return;
  const c = topicCursor(state, items, b.subject);
  for (const id of b.topicIds) c.taken.add(id);
  c.minLeft = Math.max(0, c.minLeft - (b.min || 0));
}

/* ---------- С какого дня можно готовиться ---------- */

/**
 * Лаба — это сдача отчёта по прошлой лабе: раньше, чем та состоялась, отчёт не сделать.
 * Возвращает следующий день после предыдущей лабы предмета (если такая была в расписании).
 */
function labReportFrom(state, ev) {
  if (ev.type !== 'lab') return null;
  const labs = state.classes.filter((c) => c.subject === ev.subject && c.kind === 'lab');
  if (!labs.length) return null;
  for (let k = addDays(ev.date, -1), n = 0; n < 70; k = addDays(k, -1), n += 1) {
    if (labs.some((c) => c.weekday === weekdayOf(k) && classOccurs(c, k))) return addDays(k, 1);
  }
  return null;
}

/** «Готовиться не раньше»: дата, заданная вручную, иначе — после прошлой лабы (для лаб), иначе без ограничений. */
export const prepStartOf = (state, ev) => ev.prepFrom || labReportFrom(state, ev) || null;

/* ---------- Пул задач ---------- */

/** Сколько осталось сделать; хвост меньше 10 минут не считаем — это погрешность округления, а не отдельный блок. */
const restMin = (total, done) => (total - done < 10 ? 0 : total - done);

/** Всё, к чему нужно готовиться, с остатком минут. */
export function buildItems(state, today) {
  const items = [];
  items.cursor = {}; // какая тема следующая — для предметов, которые догоняем по темам
  for (const ev of state.events) {
    if (ev.done || ev.date < today) continue;
    const { light, heavy } = splitNeed(state, ev);
    for (const [kind, total] of [['light', light], ['heavy', heavy]]) {
      if (total <= 0) continue;
      const key = `${ev.id}:${kind}`;
      items.push({
        key, kind, total,
        remaining: restMin(total, state.progress?.[key] || 0),
        eventId: ev.id, subject: ev.subject, type: ev.type,
        deadline: ev.date, deadlineMin: toMin(ev.time),
        from: prepStartOf(state, ev), // «готовиться не раньше»
        activeFrom: addDays(ev.date, -(PREP[ev.type]?.leadDays ?? 10)),
        weight: EVENT_TYPES[ev.type]?.weight ?? 1, maint: false,
      });
    }
  }

  // Догнать отставание: остаток делится поровну по неделям до конца окна.
  // Неделя — порция со своим сроком; недоделанное остаётся в работе до конца окна.
  for (const s of state.subjects) {
    const total = catchUpTotal(state, s);
    const left = total - catchUpDone(state, s);
    if (total <= 0 || left <= 0) continue;
    const win = catchUpWindow(s, today);
    const end = win.until < today ? addDays(mondayOf(today), 6) : win.until; // срок прошёл — догоняем на этой неделе
    // Остались сб–вс текущей недели — порцию за неё не выделяем: она слилась бы с порцией следующей недели.
    const thisMonday = mondayOf(today);
    const lateInWeek = daysBetween(today, addDays(thisMonday, 6)) < CONFIG.catchUp.skipWeekIfDaysLeft;
    const allWeeks = [];
    for (let m = lateInWeek ? addDays(thisMonday, 7) : thisMonday; m <= end; m = addDays(m, 7)) allWeeks.push(m);
    if (!allWeeks.length) allWeeks.push(thisMonday); // окно короткое — догоняем на этой неделе
    // Мелкие порции дробят день: неделя — не меньше часа, иначе догоняем в первые недели.
    const weeks = allWeeks.slice(0, Math.max(1, Math.min(allWeeks.length, Math.floor(left / 60))));
    const share = Number(s.catchUpLight ?? CONFIG.catchUp.lightShare);
    let rest = left;
    weeks.forEach((monday, j) => {
      const portion = j === weeks.length - 1 ? rest : Math.min(rest, round5(left / weeks.length));
      rest -= portion;
      if (portion <= 0) return;
      const weekEnd = addDays(monday, 6) < end ? addDays(monday, 6) : end;
      let light = round5(portion * share);
      // теорию и задачи делим, только если обе части — осмысленный блок (от 20 минут)
      if (light < CONFIG.minChunkMin || portion - light < CONFIG.minChunkMin) light = share >= 0.5 ? portion : 0;
      for (const [kind, amt] of [['light', light], ['heavy', portion - light]]) {
        if (amt <= 0) continue;
        items.push({
          key: `c:${s.id}:${kind}#${monday}`, progressKey: `c:${s.id}:${kind}`, kind, total: amt, remaining: amt,
          subject: s.id, catchUp: true, maint: false,
          from: j === 0 ? today : monday, until: end, deadline: weekEnd, deadlineMin: null, weight: 0, activeFrom: today,
        });
      }
    });
  }

  // Поддержка слабых предметов: недельная квота на 4 недели вперёд (кроме тех, что догоняем).
  if (!state.settings.pauseMaintenance) {
    const weak = maintSubjects(state);
    for (let w = 0; w < 4; w++) {
      const monday = addDays(mondayOf(today), 7 * w);
      for (const sj of weak) {
        for (const kind of ['light', 'heavy']) {
          const total = CONFIG.weakWeekly[kind];
          const key = `m:${sj.id}:${monday}:${kind}`;
          items.push({
            key, kind, total,
            remaining: Math.max(0, total - (state.progress?.[key] || 0)),
            subject: sj.id, maint: true, from: monday, until: addDays(monday, 6),
            deadline: addDays(monday, 6), deadlineMin: null, weight: 0, activeFrom: monday,
          });
        }
      }
    }
  }
  return items;
}

/** Можно ли делать задачу в этот день и в окно, которое кончается в slotEnd. */
function eligible(it, key, slotEnd) {
  if (it.remaining <= 0) return false;
  if (it.maint || it.catchUp) return key >= it.from && key <= it.until;
  if (it.from && key < it.from) return false; // «готовиться не раньше»
  if (it.deadline > key) return true;
  // в день события — только если окно заканчивается минимум за 30 минут до него
  return it.deadline === key && it.deadlineMin != null && slotEnd <= it.deadlineMin - 30;
}

/**
 * Ранг задачи в этот день: 0 — событие уже в «окне подготовки», 1 — догнать отставание,
 * 2 — поддержка слабого предмета, 3 — событие ещё далеко (делаем, если есть место).
 */
const rankOf = (it, key) => (it.catchUp ? 1 : it.maint ? 2 : key < it.activeFrom ? 3 : 0);

/** «Горит» на день — одно событие или список по важности (первое — самое важное). */
export const hotList = (hot) => (Array.isArray(hot) ? hot : hot ? [hot] : []);

/** Порядок: ранг → «горит» → ближайший дедлайн → тяжёлое дома → вес → слабый предмет. */
function compareItems(a, b, ctx) {
  const ra = rankOf(a, ctx.key);
  const rb = rankOf(b, ctx.key);
  if (ra !== rb) return ra - rb;
  const hl = hotList(ctx.hot);
  if (hl.length) {
    const ai = hl.indexOf(a.eventId);
    const bi = hl.indexOf(b.eventId);
    const ah = ai < 0 ? hl.length : ai;
    const bh = bi < 0 ? hl.length : bi;
    if (ah !== bh) return ah - bh;
  }
  if (a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1;
  const am = a.deadlineMin ?? 9999;
  const bm = b.deadlineMin ?? 9999;
  if (am !== bm) return am - bm;
  if (ctx.preferHeavy && a.kind !== b.kind) return a.kind === 'heavy' ? -1 : 1;
  if (ra === 1 || ra === 2) {
    // догоняем по очереди: первым тот предмет, у кого недельная порция сделана меньше
    const fa = a.remaining / a.total;
    const fb = b.remaining / b.total;
    if (fa !== fb) return fb - fa;
  }
  if (a.weight !== b.weight) return b.weight - a.weight;
  const lv = ctx.levelOf(a.subject) - ctx.levelOf(b.subject);
  if (lv) return lv;
  return b.remaining - a.remaining;
}

/** Выбрать задачу и её объём для окна с лимитом capNet минут. */
function pickChunk(items, ctx, kindFilter, slotEnd, capNet) {
  if (ctx.tasksLeft <= 0 || capNet < 10) return null;
  const cands = items.filter((it) => (kindFilter === 'any' || it.kind === kindFilter) && eligible(it, ctx.key, slotEnd));
  if (!cands.length) return null;
  cands.sort((a, b) => compareItems(a, b, ctx));
  const it = cands[0];
  let take = Math.min(it.remaining, capNet, CONFIG.maxChunkMin);
  const rest = it.remaining - take;
  if (rest > 0 && rest <= 20 && take + rest <= Math.min(capNet + 10, CONFIG.maxChunkMin + 20)) take = it.remaining; // без хвостиков
  if (take < it.remaining) take = floor5(take);
  if (take < CONFIG.minChunkMin && take < it.remaining) return null; // осмысленный кусок не влезает
  if (take <= 0) return null;
  return { item: it, min: take };
}

function commit(chunk, ctx) {
  chunk.item.remaining -= chunk.min;
  ctx.tasksLeft -= 1;
}

/* ---------- Тексты для учебных блоков ---------- */

const quoted = (topics) => topics.map((t) => `«${t.name}»`).join(', ');

export function chunkTitle(state, it, topics = []) {
  const subj = subjectOf(state, it.subject);
  const name = subj?.short || 'Предмет';
  const topic = topics[0];
  if (it.catchUp) {
    if (subj?.catchUpByTopic && topic) {
      const more = topics.length - 1;
      const what = `«${topic.name}»${more ? ` и ещё ${more} ${plural(more, 'тема', 'темы', 'тем')}` : ''}`;
      return it.kind === 'light' ? `${name}: ${what} — прочитать и карточки` : `${name}: ${what} — конспект`;
    }
    return it.kind === 'light' ? `${name}: догнать пропущенное — теория` : `${name}: догнать пропущенное — задачи`;
  }
  if (it.maint) return it.kind === 'light' ? `${name}: карточки и теория` : `${name}: отработка — ${topic?.name ?? 'слабая тема'}`;
  const ev = eventById(state, it.eventId);
  const weak = isWeak(subj) ? PREP[ev?.type]?.weak : null; // «с нуля»
  return `${name}: ${weak?.[it.kind] || PREP[ev?.type]?.[it.kind] || 'подготовка'}`;
}

export function chunkDetail(state, it) {
  if (it.catchUp) {
    const subj = subjectOf(state, it.subject);
    return subj?.catchUpByTopic ? 'Догоняю: с нуля, по темам докладов' : `Догоняю отставание${subj?.behindDays ? ` (${subj.behindDays} дн.)` : ''}`;
  }
  if (it.maint) return 'Поддержка слабого предмета';
  const ev = eventById(state, it.eventId);
  if (!ev) return '';
  return `${EVENT_TYPES[ev.type]?.label ?? 'Событие'} · ${shortDate(ev.date)}`;
}

export function firstStep(state, it, topics = []) {
  const topic = topics[0];
  if (it.catchUp) {
    if (subjectOf(state, it.subject)?.catchUpByTopic) {
      const list = topics.length ? quoted(topics) : '«тема»';
      const each = topics.length > 1 ? ' по каждой теме' : '';
      return it.kind === 'light'
        ? `Прочитай про ${list} (лекция, учебник или презентация доклада) и выпиши${each} 3 даты и 3 имени.`
        : `Конспект ${list} — на полстраницы${each}: даты, люди, итоги. Из него — 5 карточек.`;
    }
    return it.kind === 'light'
      ? 'Найди конспект пропущенной лекции (одногруппник, СДО, чат группы) и прочитай первые 2 страницы.'
      : 'Возьми задачи с последней пропущенной практики и реши первую. Застрял на 10 минут — смотри разбор и иди дальше.';
  }
  if (it.maint) {
    return it.kind === 'light'
      ? 'Открой карточки по предмету и пройди 10 штук.'
      : `Открой «Отработку» по теме «${topic?.name ?? 'первая тема'}» и реши 3 задачи.`;
  }
  const ev = eventById(state, it.eventId);
  const weak = isWeak(subjectOf(state, it.subject)) ? PREP[ev?.type]?.weak : null; // «с нуля»
  return weak?.first?.[it.kind] || PREP[ev?.type]?.first?.[it.kind] || 'Начни с самого простого шага на 15 минут.';
}

/**
 * Темы для блока. Догоняем по темам — следующие непройденные по порядку,
 * сколько влезает в минуты блока (минуты догоняния делятся поровну на оставшиеся темы).
 * Иначе — первая незакрытая тема предмета.
 */
function topicsForChunk(state, it, items, min) {
  if (!it.maint && !it.catchUp) return [];
  if (!(it.catchUp && subjectOf(state, it.subject)?.catchUpByTopic)) {
    const t = nextTopicFor(state, it.subject);
    return t ? [t] : [];
  }
  const all = state.topics.filter((t) => t.subject === it.subject);
  if (!all.length) return [];
  const c = topicCursor(state, items, it.subject);
  let open = all.filter((t) => !c.taken.has(t.id));
  if (!open.length) { // все темы пройдены — второй круг, уже как повторение
    c.taken.clear();
    open = all;
  }
  const per = c.minLeft > 0 ? c.minLeft / open.length : CONFIG.catchUp.perTopicMin;
  const k = Math.min(CONFIG.catchUp.maxTopicsPerBlock, open.length, Math.max(1, Math.round(min / per)));
  c.minLeft = Math.max(0, c.minLeft - min);
  const pick = open.slice(0, k);
  for (const t of pick) c.taken.add(t.id);
  return pick;
}

function studyBlock(state, chunk, place, start, end, mk, items) {
  const it = chunk.item;
  const topics = topicsForChunk(state, it, items, chunk.min);
  return mk('study', start, end, {
    place, itemKey: it.key, progressKey: it.progressKey || it.key, eventId: it.eventId || null, subject: it.subject, kind: it.kind,
    min: chunk.min, maint: !!it.maint, catchUp: !!it.catchUp, topicId: topics[0]?.id || null,
    ...(it.catchUp && topics.length ? { topicIds: topics.map((t) => t.id) } : {}),
    title: chunkTitle(state, it, topics), detail: chunkDetail(state, it), first: firstStep(state, it, topics),
  });
}

/* ---------- Раскладка окон ---------- */

/** Сколько учиться дома в этот день: правка дня («учёба в этот выходной») → воскресенье → обычный день. */
const homeCapFor = (state, info) => {
  if (info.ov?.study) return Number(info.ov.studyMin) || CONFIG.sundayExtraMin;
  if (info.wd === 0) return state.settings.sundayExtra ? CONFIG.sundayExtraMin : 0;
  return CONFIG.homeCapByWeekday[info.wd] ?? 150;
};

const gameMinutesOf = (state) => Number(state.settings.gameMinutes ?? CONFIG.game.minutes) || 0;

function layoutTrain(state, info, w, start, items, ctx, mk, ef) {
  const out = [];
  let t = start;
  const settle = start <= w.start + 2 ? CONFIG.trainSettleMin : 0;
  const duo = state.settings.duolingo ? CONFIG.habits.duolingoMin : 0;
  const classMin = info.classes.reduce((s, c) => s + c.endMin - c.startMin, 0);
  const fatigue = classMin >= CONFIG.fatigueClassMin ? CONFIG.fatigueFactor : 1;
  const tired = ef < 1 ? 0.75 : 1;
  const capNet = floor5(Math.min(CONFIG.trainStudyMin * fatigue * tired, w.end - t - settle - duo));
  if (settle) {
    out.push(mk('ride', t, t + settle, { title: 'Сесть, выдохнуть', place: 'train' }));
    t += settle;
  }
  const chunk = pickChunk(items, ctx, 'light', w.end, capNet);
  if (chunk) {
    commit(chunk, ctx);
    out.push(studyBlock(state, chunk, 'train', t, t + chunk.min, mk, items));
    t += chunk.min;
  }
  if (duo && w.end - t >= duo) {
    out.push(mk('habit', t, t + duo, { habit: 'duolingo', title: 'Немецкий в Duolingo', detail: `${duo} минут, пока едешь`, place: 'train' }));
    t += duo;
  }
  if (w.end - t >= 5) {
    out.push(mk('ride', t, w.end, { title: 'Дорога: отдых', detail: fatigue < 1 ? 'Длинный день — просто отдохни, можно аудио' : 'Музыка, аудио или просто окно', place: 'train' }));
  }
  return out;
}

function layoutHome(state, info, w, start, items, ctx, mk, ef, flags) {
  const out = [];
  let t = start;
  const bed = w.end;
  const short = bed - w.start < 70;

  if (flags.fresh) {
    // ужин считается от прихода домой: если план собрали через 20 минут — остаток ужина
    const dEnd = Math.min(bed, w.start + CONFIG.dinnerMin);
    if (dEnd - t >= 10 || short) {
      out.push(mk('meal', t, Math.max(t, dEnd), {
        title: short ? 'Ужин — и спать' : 'Ужин и душ',
        detail: short
          ? (info.isException ? 'Короткая ночь: сегодня без учёбы и игр' : 'Поздно вернулся — сегодня только отдых')
          : 'Без телефона, просто выдохнуть',
      }));
    }
    t = Math.max(t, dEnd);
  }
  if (short || bed - t < 25) {
    if (!info.isException && !info.sleepShort && bed - t >= CONFIG.reviewMin) {
      out.push(mk('review', bed - CONFIG.reviewMin, bed, { title: 'Повторение перед сном', detail: '10 минут карточек — и спать' }));
    }
    return out;
  }

  // Дневной сон после короткой ночи (суббота после пятницы).
  if (flags.fresh && info.prevNight < CONFIG.napAfterNightBelowMin && bed - t > 240) {
    const h = Math.floor(info.prevNight / 60);
    const m = info.prevNight % 60;
    out.push(mk('nap', t, t + CONFIG.napMin, { title: 'Дневной сон', detail: `Ночь была ${h} ч${m ? ` ${m} мин` : ''} — добираем ${CONFIG.napMin} минут` }));
    t += CONFIG.napMin;
  }
  // Зарядка в дни с длинным вечером, если есть силы.
  if (flags.fresh && state.settings.sport && CONFIG.habits.sportDays.includes(info.wd) && ef >= 1 && bed - t >= 150) {
    out.push(mk('habit', t, t + CONFIG.habits.sportMin, { habit: 'sport', title: 'Зарядка', detail: '15 минут — разогнаться перед учёбой' }));
    t += CONFIG.habits.sportMin;
  }

  const gameOn = !flags.keptGame && gameMinutesOf(state) > 0 && !info.ov.noGame;
  const gameEndMax = bed - CONFIG.game.endBeforeSleepMin;
  const studyEndMax = gameOn
    ? gameEndMax - CONFIG.game.minMinutes - CONFIG.breakBeforeGameMin
    : bed - CONFIG.reviewMin - 5;
  let netLeft = floor5(homeCapFor(state, info) * ef) - (flags.keptStudyMin || 0);
  let chunks = flags.keptHomeChunks || 0;
  let studied = 0;

  ctx.preferHeavy = true;
  while (chunks < CONFIG.maxHomeChunks) {
    // между блоками — перерыв; после уже идущего блока — остаток перерыва, если новый встаёт вплотную
    const sinceKept = flags.keptHomeChunks ? t - (flags.keptEnd ?? 0) : Infinity;
    const gapBefore = studied ? CONFIG.breakBetweenChunksMin : Math.max(0, CONFIG.breakBetweenChunksMin - sinceKept);
    const capNet = Math.min(netLeft, netFor(studyEndMax - t - gapBefore));
    const chunk = pickChunk(items, ctx, 'any', studyEndMax, capNet);
    if (!chunk) break;
    commit(chunk, ctx);
    if (gapBefore) {
      out.push(mk('break', t, t + gapBefore, { title: 'Перерыв', detail: 'Встать, вода, окно' }));
      t += gapBefore;
    }
    const wall = wallFor(chunk.min);
    out.push(studyBlock(state, chunk, 'home', t, t + wall, mk, items));
    t += wall;
    netLeft -= chunk.min;
    chunks += 1;
    studied += 1;
  }
  ctx.preferHeavy = false;

  if (gameOn) {
    const gStart = t + (studied ? CONFIG.breakBeforeGameMin : 0);
    const gMin = Math.min(gameMinutesOf(state), gameEndMax - gStart);
    if (gMin >= CONFIG.game.minMinutes) {
      if (studied) out.push(mk('break', t, gStart, { title: 'Перерыв', detail: 'Отложить тетрадь' }));
      out.push(mk('game', gStart, gStart + gMin, {
        title: 'Counter-Strike',
        detail: studied || flags.keptHomeChunks ? 'Награда после учебных блоков' : 'Свободное время, можно играть',
        reward: !!(studied || flags.keptHomeChunks),
      }));
      t = gStart + gMin;
    }
  }

  const rStart = bed - CONFIG.reviewMin;
  if (rStart - t >= 10) {
    out.push(mk('free', t, rStart, { title: 'Свободно', detail: t >= gameEndMax - 1 ? 'Умыться, приглушить свет' : 'Отдых без плана' }));
  }
  const rs = Math.max(t, rStart);
  if (bed - rs >= 10) out.push(mk('review', rs, bed, { title: 'Повторение перед сном', detail: '10–15 минут карточек, потом телефон в сторону' }));
  return out;
}

/** Первое свободное место длиной dur начиная с from, не пересекающее occ, с концом не позже limit. */
function firstFree(occ, from, dur, limit) {
  let s = from;
  const sorted = [...occ].sort((a, b) => a.start - b.start);
  for (const o of sorted) {
    if (s + dur <= o.start) break;
    if (o.end > s && o.start < s + dur) s = Math.max(s, o.end);
  }
  return s + dur <= limit ? s : null;
}

/** День без пар (воскресенье или выходной): якоря — еда, план недели, повторение. */
function layoutRest(state, info, w, start, items, ctx, mk, ef) {
  const out = [];
  const bed = w.end;
  const M = CONFIG.weekendMeals;
  const anchors = [
    { type: 'meal', start: w.start, end: w.start + M.breakfast, title: 'Завтрак', detail: 'Спокойное утро' },
    ...(info.wd === 0 ? [{
      type: 'plan', start: toMin(CONFIG.sundayPlanAt), end: toMin(CONFIG.sundayPlanAt) + CONFIG.sundayPlanMin,
      title: 'План на неделю', detail: 'Открыть «Горит» и календарь, проверить дедлайны. 30 минут — и свободен.',
    }] : []),
    { type: 'meal', start: toMin(M.lunchAt), end: toMin(M.lunchAt) + M.lunch, title: 'Обед' },
    { type: 'meal', start: toMin(M.dinnerAt), end: toMin(M.dinnerAt) + M.dinner, title: 'Ужин' },
    { type: 'review', start: bed - CONFIG.reviewMin, end: bed, title: 'Повторение перед сном', detail: '10–15 минут карточек' },
  ].filter((a) => a.start >= w.start && a.end <= bed && a.end > start);

  for (const a of anchors) out.push(mk(a.type, Math.max(a.start, start), a.end, { title: a.title, detail: a.detail }));
  const occ = out.map((b) => ({ start: b.start, end: b.end }));

  // Учёба — после обеда, если в этот день она вообще есть.
  let netLeft = floor5(homeCapFor(state, info) * ef);
  const lunch = anchors.find((a) => a.title === 'Обед');
  const dinner = anchors.find((a) => a.title === 'Ужин');
  let t = Math.max(start, (lunch ? lunch.end : w.start + 60) + 15);
  const studyLimit = dinner ? dinner.start - 15 : bed - 60;
  let studied = 0;
  ctx.preferHeavy = true;
  while (netLeft >= CONFIG.minChunkMin && studied < CONFIG.maxHomeChunks) {
    const gapBefore = studied ? CONFIG.breakBetweenChunksMin : 0;
    const capNet = Math.min(netLeft, netFor(studyLimit - t - gapBefore));
    const chunk = pickChunk(items, ctx, 'any', studyLimit, capNet);
    if (!chunk) break;
    const s = firstFree(occ, t + gapBefore, wallFor(chunk.min), studyLimit);
    if (s == null) break;
    commit(chunk, ctx);
    const b = studyBlock(state, chunk, 'home', s, s + wallFor(chunk.min), mk, items);
    out.push(b);
    occ.push({ start: b.start, end: b.end });
    t = b.end;
    netLeft -= chunk.min;
    studied += 1;
  }
  // Учебный выходной с большим лимитом: после обеда влезает не всё — добавляем окно до обеда
  // (после плана на неделю). Важнее всего идёт в послеобеденные блоки, следующее по важности — утром.
  let morning = 0;
  if (info.ov?.study && netLeft >= CONFIG.minChunkMin) {
    const planBlock = out.find((b) => b.type === 'plan');
    const mEnd = (lunch ? lunch.start : toMin(M.lunchAt)) - 10;
    let mt = Math.max(start, (planBlock ? planBlock.end : w.start + M.breakfast) + 10);
    while (netLeft >= CONFIG.minChunkMin && morning < CONFIG.restMorningChunks) {
      const capNet = Math.min(netLeft, netFor(mEnd - mt));
      const chunk = pickChunk(items, ctx, 'any', mEnd, capNet);
      if (!chunk) break;
      const s = firstFree(occ, mt, wallFor(chunk.min), mEnd);
      if (s == null) break;
      commit(chunk, ctx);
      const b = studyBlock(state, chunk, 'home', s, s + wallFor(chunk.min), mk, items);
      out.push(b);
      occ.push({ start: b.start, end: b.end });
      mt = b.end + CONFIG.breakBetweenChunksMin;
      netLeft -= chunk.min;
      morning += 1;
    }
  }
  ctx.preferHeavy = false;

  // Игра: после плана недели или учёбы, не позже чем за 30 минут до сна.
  const gm = gameMinutesOf(state);
  if (gm > 0 && !info.ov.noGame) {
    const planBlock = out.find((b) => b.type === 'plan');
    const after = Math.max(start, studied ? t + CONFIG.breakBeforeGameMin : (planBlock ? planBlock.end + 15 : w.start + M.breakfast + 30));
    const s = firstFree(occ, after, gm, bed - CONFIG.game.endBeforeSleepMin);
    if (s != null) {
      out.push(mk('game', s, s + gm, { title: 'Counter-Strike', detail: studied ? 'Награда после учебных блоков' : 'Выходной — можно играть', reward: studied > 0 }));
      occ.push({ start: s, end: s + gm });
    }
  }

  // Всё остальное — «свободно».
  out.sort((a, b) => a.start - b.start);
  const filled = [];
  let cur = start;
  for (const b of out) {
    if (b.start - cur >= 10) filled.push(mk('free', cur, b.start, { title: 'Свободно', detail: info.wd === 0 ? 'Выходной: отдых' : 'Без плана' }));
    filled.push(b);
    cur = Math.max(cur, b.end);
  }
  if (bed - cur >= 10) filled.push(mk('free', cur, bed, { title: 'Свободно' }));
  return filled;
}

/** Утренняя дорога (если сделать учебной) или окно между парами. */
function layoutSmall(state, info, w, start, items, ctx, mk) {
  const out = [];
  let t = start;
  const isAm = w.kind === 'am';
  const lead = start <= w.start + 2 ? (isAm ? 15 : 5) : 0;
  const cap = floor5(Math.min(isAm ? CONFIG.morningStudyMin : 50, w.end - t - lead - 5));
  if (lead) {
    out.push(mk(isAm ? 'ride' : 'free', t, t + lead, { title: isAm ? 'Сесть, проснуться' : 'Перейти, устроиться', place: w.kind }));
    t += lead;
  }
  const chunk = pickChunk(items, ctx, isAm ? 'light' : 'any', w.end, cap);
  if (chunk) {
    commit(chunk, ctx);
    const end = t + (isAm ? chunk.min : wallFor(chunk.min));
    out.push(studyBlock(state, chunk, w.kind, t, end, mk, items));
    t = end;
  }
  if (w.end - t >= 5) out.push(mk(isAm ? 'ride' : 'free', t, w.end, { title: isAm ? 'Дорога: отдых' : 'Свободно', place: w.kind }));
  return out;
}

/* ---------- План дня ---------- */

const WIN_ORDER = { train: 0, home: 1, rest: 1, am: 2, gap: 3 };

/**
 * Собрать план дня. items — общий пул (минуты расходуются — так дни
 * планируются по очереди). from — с какой минуты планировать (для сегодня — «сейчас»).
 * keep — блоки, которые оставляем как есть (сделанные, пропущенные, прошедшие).
 */
export function planDay(state, key, items, opts = {}) {
  const from = opts.from ?? 0;
  const keep = opts.keep ?? [];
  const build = opts.build ?? 0;
  const sk = daySkeleton(state, key);
  const { info } = sk;
  const energy = opts.energy ?? info.ov.energy ?? 'mid';
  const hot = opts.hot ?? info.ov.hot ?? null;
  const ef = CONFIG.energyFactor[energy] ?? 1;
  const keptStudy = keep.filter((b) => b.type === 'study' && b.status !== 'skipped');
  const ctx = {
    key, hot, preferHeavy: false,
    tasksLeft: CONFIG.maxTasksPerDay - keptStudy.length,
    levelOf: (id) => Number(subjectOf(state, id)?.level) || 3,
  };
  let n = 0;
  const mk = (type, start, end, extra = {}) => ({ id: `${key}:${build}:${n++}`, type, start, end, ...extra });
  const inWin = (b, w) => b.start < w.end && b.end > w.start;

  const out = [];
  const wins = [...sk.windows].sort((a, b) => WIN_ORDER[a.kind] - WIN_ORDER[b.kind]);
  for (const w of wins) {
    const keptIn = keep.filter((b) => inWin(b, w));
    const keptEnd = keptIn.reduce((m, b) => Math.max(m, b.end), 0);
    const start = Math.max(w.start, from, keptEnd);
    if (w.end - start < 10) continue;
    if (w.kind === 'train') {
      out.push(...layoutTrain(state, info, w, start, items, ctx, mk, ef));
    } else if (w.kind === 'home') {
      const keptHome = keptIn.filter((b) => b.type === 'study' && b.status !== 'skipped');
      out.push(...layoutHome(state, info, w, start, items, ctx, mk, ef, {
        fresh: !keptIn.length && start < w.start + 60,
        keptGame: keptIn.some((b) => b.type === 'game'),
        keptHomeChunks: keptHome.length,
        keptStudyMin: keptHome.reduce((s, b) => s + (b.min || 0), 0),
        keptEnd,
      }));
    } else if (w.kind === 'rest') {
      out.push(...layoutRest(state, info, w, start, items, ctx, mk, ef));
    } else {
      out.push(...layoutSmall(state, info, w, start, items, ctx, mk));
    }
  }
  const blocks = [...keep, ...out].sort((a, b) => a.start - b.start || a.end - b.end);
  return { key, info, fixed: sk.fixed, windows: sk.windows, blocks, energy, hot };
}

/** Какие блоки сегодняшнего плана оставить при пересборке. */
function keptForRebuild(state, today, blocks, now) {
  const done = state.done?.[today] || {};
  return blocks
    .filter((b) => done[b.id]?.status || b.end <= now || b.start < now)
    .map((b) => ({ ...b, status: done[b.id]?.status }));
}

/**
 * План на сегодня — собирается один раз и хранится, чтобы отметки
 * «готово» / «не успел» не терялись. Пересборка — от текущей минуты.
 */
export function buildTodayPlan(state, today, now, answers = {}) {
  const prev = state.plans?.[today];
  const build = (prev?.build ?? -1) + 1;
  const keep = prev ? keptForRebuild(state, today, prev.blocks, now) : [];
  const items = buildItems(state, today);
  for (const b of keep) {
    // блок идёт прямо сейчас и не отмечен — его минуты и темы заняты
    if (b.type === 'study' && b.itemKey && !b.status && b.end > now) {
      const it = items.find((i) => i.key === b.itemKey);
      if (it) it.remaining = restMin(it.remaining, b.min || 0);
      reserveTopics(state, items, b);
    }
  }
  const energy = answers.energy ?? prev?.energy;
  const hot = answers.hot !== undefined ? answers.hot : prev?.hot;
  const plan = planDay(state, today, items, { from: now, keep, energy, hot, build });
  return {
    builtAt: Date.now(), build, energy: plan.energy, hot: plan.hot,
    blocks: plan.blocks.map(({ status, ...b }) => b),
  };
}

/**
 * Симуляция на N дней вперёд: сегодня — сохранённый план, дальше — живой
 * расчёт от текущего прогресса. Отсюда же — нехватка времени.
 */
export function simulate(state, today, now, days = CONFIG.horizonDays) {
  const items = buildItems(state, today);
  const byKey = new Map(items.map((i) => [i.key, i]));
  const plans = {};
  const stored = state.plans?.[today];
  for (let d = 0; d < days; d++) {
    const key = addDays(today, d);
    if (d === 0 && stored) {
      const doneToday = state.done?.[today] || {};
      for (const b of stored.blocks) {
        if (b.type !== 'study' || !b.itemKey || doneToday[b.id]?.status || b.end <= now) continue;
        const it = byKey.get(b.itemKey);
        if (it) it.remaining = restMin(it.remaining, b.min || 0);
        reserveTopics(state, items, b);
      }
      const sk = daySkeleton(state, key);
      plans[key] = { key, info: sk.info, fixed: sk.fixed, windows: sk.windows, blocks: stored.blocks, energy: stored.energy, hot: stored.hot, stored: true };
      continue;
    }
    plans[key] = planDay(state, key, items, { from: d === 0 ? now : 0 });
  }
  const horizonEnd = addDays(today, days - 1);
  const shortages = findShortages(state, items, today, horizonEnd);
  // Вариант «без игры» в дни перед дедлайном — решает пользователь, сам план игру не убирает.
  for (const s of shortages) {
    const gameDays = [];
    let gain = 0;
    for (const [key, plan] of Object.entries(plans)) {
      if (key >= s.deadline || plan.info.ov.noGame) continue;
      const g = plan.blocks.find((b) => b.type === 'game' && !(key === today && b.end <= now));
      if (g) {
        gameDays.push(key);
        gain += g.end - g.start;
      }
    }
    if (gameDays.length) s.options.splice(s.options[0]?.kind === 'shrink' ? 1 : 0, 0, { kind: 'nogame', days: gameDays, gain });
  }
  // Отставание, которое не догоняется к сроку при нынешнем режиме.
  const catchUpShort = [];
  for (const subj of state.subjects) {
    const left = items.filter((i) => i.catchUp && i.subject === subj.id && i.until <= horizonEnd).reduce((a, i) => a + i.remaining, 0);
    if (left >= 15) catchUpShort.push({ subject: subj.id, short: left, until: items.find((i) => i.catchUp && i.subject === subj.id).until });
  }
  return { today, now, plans, items, horizonEnd, shortages, catchUpShort };
}

/** Сколько минут «догнать» по каждому предмету уже стоит в плане (без сделанного). */
export function plannedCatchUp(sim, state) {
  const res = {};
  for (const [key, plan] of Object.entries(sim.plans)) {
    const done = state.done?.[key] || {};
    for (const b of plan.blocks) {
      if (b.type !== 'study' || !b.catchUp || done[b.id]?.status) continue;
      if (key === sim.today && b.end <= sim.now) continue;
      res[b.subject] = (res[b.subject] || 0) + (b.min || 0);
    }
  }
  return res;
}

/* ---------- Отметки «готово» ---------- */

/** Подготовка к КР, зачёту или экзамену по предмету, который догоняем, — это и есть догоняние: минуты засчитываются и туда. */
const CREDIT_TYPES = new Set(['kr', 'zachet', 'exam']);

/** «Готово»: минуты идут в прогресс, темы блока «догнать» — пройдены («не начал» → «учу»). */
export function recordDone(state, key, b, at = Date.now()) {
  const day = (state.done[key] ||= {});
  if (day[b.id]?.status === 'done') return false;
  const pk = b.progressKey || b.itemKey || null; // у «догнать» прогресс общий на предмет, а не на неделю
  const rec = { status: 'done', min: b.min || 0, itemKey: pk, type: b.type, at };
  if (pk && b.min) state.progress[pk] = (state.progress[pk] || 0) + b.min;
  if (b.catchUp && b.topicIds?.length) {
    const fresh = state.topics.filter((t) => b.topicIds.includes(t.id) && t.status === 'new');
    for (const t of fresh) t.status = 'learning';
    Object.assign(rec, { topics: b.topicIds, wasNew: fresh.map((t) => t.id) });
  }
  const ev = b.eventId ? eventById(state, b.eventId) : null;
  const subj = ev && CREDIT_TYPES.has(ev.type) ? subjectOf(state, ev.subject) : null;
  if (subj && b.min) {
    const credit = Math.min(b.min, Math.max(0, catchUpTotal(state, subj) - catchUpDone(state, subj)));
    if (credit > 0) {
      const ck = `c:${subj.id}:${b.kind === 'light' ? 'light' : 'heavy'}`;
      state.progress[ck] = (state.progress[ck] || 0) + credit;
      rec.credit = { key: ck, min: credit };
    }
  }
  day[b.id] = rec;
  return true;
}

/** Снять отметку: вернуть минуты и статусы тем. Возвращает снятую запись. */
export function undoRecord(state, key, id) {
  const rec = state.done[key]?.[id];
  if (!rec) return null;
  if (rec.status === 'done' && rec.itemKey && rec.min) {
    state.progress[rec.itemKey] = Math.max(0, (state.progress[rec.itemKey] || 0) - rec.min);
  }
  for (const t of state.topics) if (rec.wasNew?.includes(t.id) && t.status === 'learning') t.status = 'new';
  if (rec.credit) state.progress[rec.credit.key] = Math.max(0, (state.progress[rec.credit.key] || 0) - rec.credit.min);
  delete state.done[key][id];
  return rec;
}

/** День в прошлом: каркас + сохранённый план (если был). */
export function pastDay(state, key) {
  const sk = daySkeleton(state, key);
  return { key, info: sk.info, fixed: sk.fixed, windows: sk.windows, blocks: state.plans?.[key]?.blocks || [], past: true };
}

/* ---------- Нехватка времени и что сократить ---------- */

function findShortages(state, items, today, horizonEnd) {
  const by = new Map();
  for (const it of items) {
    if (it.maint || it.catchUp || it.remaining <= 0 || it.deadline > horizonEnd) continue;
    const s = by.get(it.eventId) || { eventId: it.eventId, short: 0, light: 0, heavy: 0, deadline: it.deadline };
    s.short += it.remaining;
    s[it.kind] += it.remaining;
    by.set(it.eventId, s);
  }
  return [...by.values()]
    .filter((s) => s.short >= 15)
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1))
    .map((s) => ({ ...s, options: shortageOptions(state, s, today) }));
}

export function shortageOptions(state, s, today) {
  const ev = eventById(state, s.eventId);
  if (!ev) return [];
  const opts = [];
  const current = eventNeedMin(state, ev);
  const minimal = minimalNeedMin(state, ev);
  if (current > minimal) opts.push({ kind: 'shrink', eventId: ev.id, to: minimal, gain: current - minimal });

  if (!state.settings.sundayExtra) {
    let sundays = 0;
    for (let k = today; k < ev.date; k = addDays(k, 1)) if (baseTimes(state, k).wd === 0 && !state.dayOverrides?.[k]?.study) sundays += 1;
    if (sundays) opts.push({ kind: 'sunday', gain: sundays * CONFIG.sundayExtraMin });
  }

  // Утренняя дорога в дни, когда встаёшь поздно и, возможно, не нужно досыпать.
  const days = [];
  for (let k = today; k <= ev.date; k = addDays(k, 1)) {
    const b = baseTimes(state, k);
    if (!b.classes.length || b.ov.morningStudy || b.wake < 7 * 60 + 30) continue;
    if (k === ev.date && !(toMin(ev.time) != null && b.classStart <= toMin(ev.time) - 30)) continue;
    days.push(k);
  }
  if (days.length) opts.push({ kind: 'morning', days, gain: days.length * CONFIG.morningStudyMin });

  const maint = state.settings.pauseMaintenance ? [] : maintSubjects(state);
  if (maint.length) opts.push({ kind: 'pause', subjects: maint.map((x) => x.short) });
  return opts;
}

/* ---------- Нагрузка дня (для календаря) ---------- */

export function dayLoad(state, key, shortageDates = new Set()) {
  const evs = state.events.filter((e) => e.date === key);
  let score = evs.reduce((s, e) => s + (EVENT_TYPES[e.type]?.weight ?? 0), 0);
  const classMin = classesOn(state, key).reduce((s, c) => s + (c.endMin - c.startMin), 0);
  score += classMin / 180;
  if (shortageDates.has(key)) score += 2;
  const level = score >= 4 ? 3 : score >= 2.5 ? 2 : score > 0 ? 1 : 0;
  return { score, level, evs, classMin };
}

/** Сколько минут запланировано на каждое событие в симуляции (без сделанного). */
export function plannedByEvent(sim, state) {
  const res = {};
  for (const [key, plan] of Object.entries(sim.plans)) {
    const done = state.done?.[key] || {};
    for (const b of plan.blocks) {
      if (b.type !== 'study' || !b.eventId || done[b.id]?.status) continue;
      if (key === sim.today && b.end <= sim.now) continue;
      res[b.eventId] = (res[b.eventId] || 0) + (b.min || 0);
    }
  }
  return res;
}

/* ---------- Серия дней ---------- */

export function dayCounted(state, key) {
  const d = state.done?.[key];
  return !!d && Object.values(d).some((x) => x.status === 'done' && x.type !== 'game');
}

export function streakInfo(state, today) {
  const todayCounted = dayCounted(state, today);
  let k = todayCounted ? today : addDays(today, -1);
  let n = 0;
  while (dayCounted(state, k) && n < 3650) {
    n += 1;
    k = addDays(k, -1);
  }
  return { streak: n, todayCounted, best: Math.max(Number(state.bestStreak) || 0, n) };
}

/** Короткая подпись времени блока. */
export const blockTime = (b) => `${fmtTime(b.start)}–${fmtTime(b.end)}`;
