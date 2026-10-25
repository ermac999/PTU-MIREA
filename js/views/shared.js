/* =====================================================================
   Общее для экранов: расчёт плана (с кэшем), план на сегодня,
   отметки «готово» / «не успел», лента дня, строки событий.
   ===================================================================== */

import { EVENT_TYPES } from '../config.js';
import { commit, store } from '../store.js';
import {
  buildItems, buildTodayPlan, pastDay, planDay, recordDone, simulate, streakInfo, subjectOf, undoRecord,
} from '../planner.js';
import { addDays, clamp, dateOf, esc, fmtDur, fmtTime, minutesNow, relDays, todayKey, WD_SHORT } from '../util.js';
import { hasTheory } from '../theory.js';
import { moduleHref, modulesFor } from '../modules.js';
import { icon, toast } from '../ui.js';

export const today = () => todayKey();
export const nowMin = () => minutesNow();
export const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* ---------- План ---------- */

let simCache = { key: '', sim: null };

/** Расчёт на 3 недели вперёд; пересчитывается при изменениях и раз в 5 минут. */
export function getSim() {
  const t = today();
  const m = Math.floor(nowMin() / 5) * 5;
  const key = `${store.rev}|${t}|${m}`;
  if (simCache.key !== key) simCache = { key, sim: simulate(store.state, t, m) };
  return simCache.sim;
}

/** План на сегодня собирается один раз и хранится — чтобы отметки не терялись. */
export function ensureTodayPlan() {
  const t = today();
  if (!store.state.plans[t]) {
    commit((st) => { st.plans[t] = buildTodayPlan(st, t, nowMin()); }, { silent: true });
  }
}

/** Пересобрать остаток сегодняшнего дня (от текущей минуты). */
export function rebuildToday(answers = {}) {
  const t = today();
  commit((st) => { st.plans[t] = buildTodayPlan(st, t, nowMin(), answers); });
}

export function planFor(key) {
  const t = today();
  if (key < t) return pastDay(store.state, key);
  const sim = getSim();
  return sim.plans[key] || planDay(store.state, key, buildItems(store.state, t));
}

export const findBlock = (key, id) => planFor(key)?.blocks.find((b) => b.id === id) || null;
export const statusOf = (key, id) => store.state.done?.[key]?.[id]?.status || null;

/* ---------- Отметки: спокойно, без упрёков ---------- */

const DONE_MSG = ['Готово, засчитано.', 'Отмечено. Минуты добавлены к подготовке.', 'Есть. Следующий шаг уже в плане.'];
const SKIP_MSG = ['Перенёс. Остаток дня собран заново.', 'Бывает. Блок переехал, план уже обновлён.', 'Сдвинул. Ничего не сгорело — всё в плане.'];
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function markDone(key, b) {
  commit((st) => {
    if (!recordDone(st, key, b)) return;
    const s = streakInfo(st, today());
    if (s.streak > (st.bestStreak || 0)) st.bestStreak = s.streak;
  });
  toast(pick(DONE_MSG));
}

export function markSkipped(key, b) {
  commit((st) => {
    (st.done[key] ||= {})[b.id] = { status: 'skipped', min: b.min || 0, itemKey: b.progressKey || b.itemKey || null, type: b.type, at: Date.now() };
    if (key === today()) {
      // блок идёт прямо сейчас — обрезаем его до текущей минуты, чтобы остаток окна достался новому плану
      const now = nowMin();
      const stored = st.plans[key]?.blocks.find((x) => x.id === b.id);
      if (stored && stored.start < now && now < stored.end) stored.end = Math.max(stored.start + 5, now);
      st.plans[key] = buildTodayPlan(st, key, now);
    }
  });
  toast(pick(SKIP_MSG));
}

export function undoMark(key, b) {
  commit((st) => {
    const rec = undoRecord(st, key, b.id);
    if (rec?.status === 'skipped' && key === today()) st.plans[key] = buildTodayPlan(st, key, nowMin());
  });
}

/* ---------- Подписи ---------- */

export const KIND_LABEL = { lecture: 'лекция', practice: 'практика', lab: 'лабораторная' };
export const PLACE_LABEL = { train: 'электричка', home: 'дома', am: 'утренняя дорога', gap: 'окно между парами' };
const BLOCK_LABEL = {
  sleep: 'Сон', morning: 'Утро', commute: 'Дорога', class: 'Пара', break: 'Перерыв', meal: 'Еда',
  transfer: 'Дорога', ride: 'Дорога', study: 'Учёба', review: 'Повторение', plan: 'План',
  game: 'Отдых', habit: 'Привычка', nap: 'Сон днём', free: 'Свободно', gym: 'Тренировка',
};
const MARKABLE = new Set(['study', 'habit', 'review', 'plan']);

export const subjShort = (id) => subjectOf(store.state, id)?.short || '';
export const subjName = (id) => subjectOf(store.state, id)?.name || '';

export const typeDot = (type) => `<i class="dot t-${esc(type)}" aria-hidden="true"></i>`;
export const typeChip = (type) => `<span class="chip">${typeDot(type)}${esc(EVENT_TYPES[type]?.short ?? type)}</span>`;

export function levelDots(level) {
  const n = Number(level) || 3;
  return `<span class="lvl" role="img" aria-label="уровень ${n} из 5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}

/** События с сегодняшнего дня на N дней вперёд, по дате и времени. */
export function upcoming(days = 60, from = today()) {
  const until = addDays(from, days);
  return store.state.events
    .filter((e) => !e.done && e.date >= from && e.date <= until)
    .sort((a, b) => `${a.date}${a.time || '99'}`.localeCompare(`${b.date}${b.time || '99'}`));
}

export function eventTitle(ev) {
  const s = subjShort(ev.subject);
  return s ? `${s}: ${ev.title}` : ev.title;
}

export function eventRow(ev, extra = '') {
  const d = dateOf(ev.date);
  return `<button class="ev" type="button" data-act="event-open" data-id="${esc(ev.id)}">
    <span class="ev-date"><span class="n">${d.getDate()}</span><span class="w">${MONTH_SHORT[d.getMonth()]} · ${WD_SHORT[d.getDay()]}</span></span>
    <span class="ev-body">
      <span class="t">${esc(eventTitle(ev))}</span>
      <span class="m">${typeChip(ev.type)}${ev.time ? `<span>${esc(ev.time)}${ev.timeAssumed ? '?' : ''}</span>` : ''}<span>${relDays(today(), ev.date)}</span>${ev.confirmed ? '' : '<span class="chip warn">уточнить</span>'}${extra}</span>
    </span>
    ${icon('chev', 'chev s')}
  </button>`;
}

/* ---------- Лента дня ---------- */

function blockClass(b) {
  if (b.fixed) return b.type === 'sleep' ? 'g sleep' : b.type === 'gym' ? 'habit' : 'g';
  if (b.type === 'study') return b.place === 'train' || b.place === 'am' ? 'train' : 'study';
  return { review: 'review', plan: 'plan', game: 'game', habit: 'habit', nap: 'nap', free: 'free', ride: 'ride', break: 'break' }[b.type] || 'g';
}

function practiceLink(b) {
  if (b.kind === 'light') return `<button class="btn small quiet" type="button" data-act="go" data-to="drill/s:${esc(b.subject)}">Карточки →</button>`;
  const to = b.topicId ? `practice/t:${b.topicId}` : `practice/s:${b.subject}`;
  return `<button class="btn small quiet" type="button" data-act="go" data-to="${esc(to)}">Отработка →</button>`;
}

/** «Теория →» и «Игра →» по темам учебного блока (первая тема с теорией, первая игра). */
export function topicLinks(b) {
  const ids = b.topicIds?.length ? b.topicIds : b.topicId ? [b.topicId] : [];
  const parts = [];
  const th = ids.find(hasTheory);
  if (th) parts.push(`<button class="btn small quiet" type="button" data-act="go" data-to="topic/${esc(th)}">Теория →</button>`);
  const mod = ids.flatMap((id) => modulesFor({ topic: id }))[0];
  if (mod) {
    const href = moduleHref(mod);
    parts.push(`<a class="btn small quiet" href="${esc(href)}"${href === mod.href ? '' : ' target="_blank" rel="noopener"'}>Игра →</a>`);
  }
  return parts.join('');
}

function blockActions(key, b, ctx, status) {
  if (b.type === 'class' && (ctx.isToday || ctx.isPast)) {
    const k = `${key}|${b.classId}`;
    const a = store.state.attendance[k];
    return `<div class="blk-acts">
      <button class="btn small ${a === 'present' ? '' : 'ghost'}" type="button" data-act="att" data-k="${esc(k)}" data-v="present" aria-pressed="${a === 'present'}">Был</button>
      <button class="btn small ${a === 'absent' ? '' : 'ghost'}" type="button" data-act="att" data-k="${esc(k)}" data-v="absent" aria-pressed="${a === 'absent'}">Пропуск</button>
    </div>`;
  }
  if (b.type === 'commute' && b.toggle && !ctx.isPast) {
    return `<div class="blk-acts"><button class="btn small ghost" type="button" data-act="morning-study" data-key="${key}">Сделать учебной</button></div>`;
  }
  if (!MARKABLE.has(b.type) || !(ctx.isToday || ctx.isPast)) return '';
  const id = esc(b.id);
  if (status) {
    return `<div class="blk-acts"><span class="chip ${status === 'done' ? 'ok' : ''}">${status === 'done' ? 'сделано' : 'перенесено'}</span>
      <button class="btn quiet small" type="button" data-act="block-undo" data-key="${key}" data-id="${id}">Отменить</button></div>`;
  }
  const started = ctx.isPast || b.start <= ctx.nm;
  const parts = [`<button class="btn small" type="button" data-act="block-done" data-key="${key}" data-id="${id}">${icon('check', 's')}Готово</button>`];
  if (started) parts.push(`<button class="btn small ghost" type="button" data-act="block-skip" data-key="${key}" data-id="${id}">Не успел</button>`);
  if (b.type === 'study' && ctx.isToday) parts.push(`<button class="btn small ghost" type="button" data-act="timer-start" aria-label="Таймер фокуса 25 минут">${icon('clock', 's')}25:00</button>`);
  if (b.type === 'study') parts.push(practiceLink(b), topicLinks(b));
  return `<div class="blk-acts">${parts.join('')}</div>`;
}

function blockRow(key, b, ctx) {
  const st = store.state;
  const dur = b.end - b.start;
  const status = b.fixed ? null : statusOf(key, b.id);
  const isNow = ctx.isToday && b.start <= ctx.nm && ctx.nm < b.end;
  let cls = blockClass(b);
  let label = BLOCK_LABEL[b.type] || '';
  let { title } = b;
  const chips = [];

  if (b.type === 'class') {
    title = subjName(b.subject);
    label = `Пара · ${KIND_LABEL[b.kind] || ''}`;
    if (b.kind === 'lab') chips.push('<span class="chip solid">лаба</span>');
    const evs = st.events.filter((e) => e.date === key && e.subject === b.subject && e.type !== 'session' && (!e.time || e.time === fmtTime(b.start)));
    for (const e of evs) if (!(e.type === 'lab' && b.kind === 'lab')) chips.push(`<span class="chip danger">${esc(EVENT_TYPES[e.type]?.short ?? '')}</span>`);
    if (subjectOf(st, b.subject)?.marked) chips.push('<span class="chip">отмечают</span>');
  }
  if (b.type === 'study') label = `${b.catchUp ? 'Догоняю' : 'Учёба'} · ${PLACE_LABEL[b.place] || ''}`;
  if (b.type === 'sleep') title = b.start === 0 ? `Сон до ${fmtTime(b.end)}` : `Отбой в ${fmtTime(b.start)}`;
  if (b.type === 'game' && ctx.isToday && !status) {
    const pending = ctx.plan.blocks.filter((s) => s.type === 'study' && s.start < b.start && !statusOf(key, s.id));
    if (pending.length) chips.push('<span class="chip">после учебных блоков</span>');
    else if (b.reward) chips.push('<span class="chip ok">заслужено</span>');
  }
  if (status) cls += ` ${status}`;
  if (isNow) cls += ' now';
  const compact = dur < 25 || b.type === 'sleep';
  if (compact) cls += ' compact';
  const h = b.type === 'sleep' ? 44 : clamp(Math.round(dur * 0.9), 48, 230);
  const first = b.type === 'study' && !status && b.first ? `<div class="blk-first"><b>С чего начать:</b> ${esc(b.first)}</div>` : '';
  const timeLabel = b.type === 'sleep' && b.start === 0 ? '' : fmtTime(b.start);

  return `<div class="tl-row ${isNow ? 'now' : ''}" ${isNow ? 'id="tl-now"' : ''}>
    <div class="tl-time">${timeLabel}</div>
    <div class="blk ${cls}" style="min-height:${h}px">
      <div class="blk-top"><span>${esc(label)}</span>${b.type === 'sleep' ? '' : `<span>${fmtDur(dur)}</span>`}${chips.join('')}</div>
      <div class="blk-title">${esc(title || '')}</div>
      ${b.detail && !compact ? `<div class="blk-detail">${esc(b.detail)}</div>` : ''}
      ${first}
      ${blockActions(key, b, ctx, status)}
    </div>
  </div>`;
}

export function renderTimeline(key, plan) {
  const t = today();
  const ctx = { isToday: key === t, isPast: key < t, nm: nowMin(), plan };
  const items = [...plan.fixed.map((f) => ({ ...f, fixed: true })), ...plan.blocks]
    .sort((a, b) => a.start - b.start || a.end - b.end);
  return `<div class="tl">${items.map((b) => blockRow(key, b, ctx)).join('')}</div>`;
}

/** Действия, общие для ленты дня (используются на экранах «День» и «Сегодня»). */
export const blockActionHandlers = {
  'block-done': (el) => {
    const b = findBlock(el.dataset.key, el.dataset.id);
    if (b) markDone(el.dataset.key, b);
  },
  'block-skip': (el) => {
    const b = findBlock(el.dataset.key, el.dataset.id);
    if (b) markSkipped(el.dataset.key, b);
  },
  'block-undo': (el) => {
    const b = findBlock(el.dataset.key, el.dataset.id);
    if (b) undoMark(el.dataset.key, b);
  },
  att: (el) => {
    const { k, v } = el.dataset;
    commit((st) => {
      if (st.attendance[k] === v) delete st.attendance[k];
      else st.attendance[k] = v;
    });
  },
  'morning-study': (el) => {
    const key = el.dataset.key;
    commit((st) => {
      st.dayOverrides[key] = { ...(st.dayOverrides[key] || {}), morningStudy: true };
      if (key === today()) st.plans[key] = buildTodayPlan(st, key, nowMin());
    });
    toast('Утренняя дорога теперь учебная. Вернуть сон — в «Править день».');
  },
};
