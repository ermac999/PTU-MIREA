/* =====================================================================
   Отработка и карточки.
   • Проверка ответа: число (с допуском), текст (несколько вариантов),
     выбор из вариантов. Пробелы, регистр, «ё», запятая/точка,
     x² и x^2, русская «х» вместо латинской — не считаются ошибкой.
   • Очередь: сначала ошибки, которым пора вернуться, потом новые,
     потом повторение. Ошибка возвращается через 3 задачи в этой же
     сессии и ещё раз — завтра.
   • Статус темы меняется по результатам: не начал → учу → понял → повторил.
   • Карточки — система Лейтнера: «не помню» — карточка в начало,
     «помню» — следующая коробка и повтор реже.
   ===================================================================== */

import { CONFIG } from './config.js';

const DAY = 86400000;

export const STATUS = {
  new: 'не начал',
  learning: 'учу',
  understood: 'понял',
  reviewed: 'повторил',
};
export const STATUS_ORDER = ['new', 'learning', 'understood', 'reviewed'];

// Похожие кириллические и латинские буквы — частая опечатка в формулах (х/x, у/y, е/e…)
const LOOKALIKE = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k' };

/** Привести ответ к сравнимому виду. Одинаково для ответа и эталона. */
export function normalize(s) {
  let t = String(s ?? '').toLowerCase().trim();
  t = t.replace(/ё/g, 'е')
    .replace(/[−–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/·/g, '*')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/\*\*/g, '^')
    .replace(/\*/g, '')
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/[«»"'`]/g, '')
    .replace(/\.+$/, '');
  return t.replace(/[аеорсухк]/g, (c) => LOOKALIKE[c] || c);
}

/** Число из ответа: «-2», «0,25», «1/4», «6 м/с» → 6. Иначе NaN. */
export function parseNumber(s) {
  const t = normalize(s);
  const m = /^(-?\d+(?:\.\d+)?)(?:\/(-?\d+(?:\.\d+)?))?(.*)$/.exec(t);
  if (!m) return NaN;
  const tail = m[3];
  if (tail && /^[\d.]/.test(tail)) return NaN; // «1.2.3» — не число
  const a = Number(m[1]);
  if (m[2] === undefined) return a;
  const b = Number(m[2]);
  return b ? a / b : NaN;
}

/** Проверить ответ. Для выбора input — индекс варианта. */
export function checkAnswer(task, input) {
  if (task.type === 'choice') {
    const idx = Number(input);
    return { ok: idx === Number(task.answer), correctText: task.options?.[task.answer] ?? '' };
  }
  const raw = String(input ?? '').trim();
  const correctText = task.answers?.[0] ?? '';
  if (!raw) return { ok: false, empty: true, correctText };
  if (task.type === 'number') {
    const v = parseNumber(raw);
    if (Number.isNaN(v)) return { ok: false, notNumber: true, correctText };
    const tol = Math.abs(Number(task.tolerance) || 0) + 1e-9;
    const ok = (task.answers || []).some((a) => {
      const x = parseNumber(a);
      return !Number.isNaN(x) && Math.abs(x - v) <= tol;
    });
    return { ok, correctText };
  }
  const n = normalize(raw);
  return { ok: (task.answers || []).some((a) => normalize(a) === n), correctText };
}

/* ---------- Банк заданий ---------- */

/** Банк из JSON-файла + задания, добавленные в приложении. */
export function allTasks(bank, state) {
  return [...(bank?.tasks || []), ...(state.customTasks || [])];
}

export function tasksForScope(tasks, scope, state) {
  if (!scope) return tasks;
  if (scope.topic) return tasks.filter((t) => t.topic === scope.topic);
  if (scope.subject) return tasks.filter((t) => t.subject === scope.subject);
  if (scope.weak) {
    const weak = new Set(state.subjects.filter((s) => Number(s.level) <= CONFIG.weakLevelMax).map((s) => s.id));
    return tasks.filter((t) => weak.has(t.subject));
  }
  return tasks;
}

/** Очередь отработки: ошибки → новые → повторение → давно не виденные. */
export function buildQueue(tasks, practice, now = Date.now(), size = CONFIG.practiceSessionSize) {
  const wrongDue = [];
  const fresh = [];
  const reviewDue = [];
  const rest = [];
  for (const t of tasks) {
    const p = practice[t.id];
    if (!p || !p.seen) fresh.push(t);
    else if (p.streak === 0 && (p.due ?? 0) <= now) wrongDue.push(t);
    else if ((p.due ?? 0) <= now) reviewDue.push(t);
    else rest.push(t);
  }
  const byDue = (a, b) => (practice[a.id].due ?? 0) - (practice[b.id].due ?? 0);
  wrongDue.sort(byDue);
  reviewDue.sort(byDue);
  rest.sort((a, b) => (practice[a.id].lastAt ?? 0) - (practice[b.id].lastAt ?? 0));
  return [...wrongDue, ...fresh, ...reviewDue, ...rest].slice(0, size).map((t) => t.id);
}

/** Вставить ошибку обратно в очередь через N задач (если её там ещё нет дальше). */
export function requeue(queue, pos, id, after = CONFIG.retryAfter) {
  if (queue.slice(pos + 1).includes(id)) return queue;
  const q = [...queue];
  q.splice(Math.min(q.length, pos + 1 + after), 0, id);
  return q;
}

function pushTopicHist(state, topicId, ok, now) {
  const h = state.topicHist[topicId] || [];
  h.push({ at: now, ok });
  state.topicHist[topicId] = h.slice(-20);
}

/** Новый статус темы по истории ответов. */
export function nextTopicStatus(topic, hist, now = Date.now()) {
  if (!hist.length) return { status: topic.status };
  let status = topic.status === 'new' ? 'learning' : topic.status;
  let understoodAt = topic.understoodAt;
  const last5 = hist.slice(-5);
  const last3 = hist.slice(-3);
  const lastOk = hist[hist.length - 1].ok;
  if ((status === 'understood' || status === 'reviewed') && last3.length === 3 && last3.filter((h) => !h.ok).length >= 2) {
    status = 'learning';
  } else if (status === 'learning' && last5.length >= 4 && last5.filter((h) => h.ok).length >= CONFIG.understoodNeed && lastOk) {
    status = 'understood';
    understoodAt = now;
  } else if (status === 'understood' && understoodAt && now - understoodAt >= CONFIG.reviewGapDays * DAY && lastOk && last3.every((h) => h.ok)) {
    status = 'reviewed';
  }
  return { status, understoodAt };
}

function applyTopic(state, topicId, ok, now) {
  if (!topicId) return null;
  pushTopicHist(state, topicId, ok, now);
  const topic = state.topics.find((t) => t.id === topicId);
  if (!topic) return null;
  const before = topic.status;
  const res = nextTopicStatus(topic, state.topicHist[topicId], now);
  topic.status = res.status;
  if (res.understoodAt) topic.understoodAt = res.understoodAt;
  return before !== topic.status ? { from: before, to: topic.status, topic } : null;
}

/** Записать ответ на задачу: интервальное повторение + статус темы. */
export function recordAnswer(state, task, ok, now = Date.now()) {
  const p = state.practice[task.id] || { seen: 0, correct: 0, wrong: 0, streak: 0 };
  p.seen += 1;
  p.lastAt = now;
  p.lastOk = ok;
  if (ok) {
    p.correct += 1;
    p.streak += 1;
    p.due = now + CONFIG.srsDays[Math.min(p.streak - 1, CONFIG.srsDays.length - 1)] * DAY;
  } else {
    p.wrong += 1;
    p.streak = 0;
    p.due = now + DAY; // ошибку вернём завтра; в этой сессии — через 3 задачи
  }
  state.practice[task.id] = p;
  return applyTopic(state, task.topic, ok, now);
}

/** Сводка по теме: сколько заданий, решено, точность, ошибки к повтору. */
export function topicStats(tasks, state, topicId, now = Date.now()) {
  const ts = tasks.filter((t) => t.topic === topicId);
  let seen = 0;
  let correct = 0;
  let wrongDue = 0;
  for (const t of ts) {
    const p = state.practice[t.id];
    if (!p) continue;
    seen += p.seen;
    correct += p.correct;
    if (p.streak === 0 && (p.due ?? 0) <= now) wrongDue += 1;
  }
  return { total: ts.length, seen, correct, accuracy: seen ? correct / seen : null, wrongDue };
}

/* ---------- Карточки ---------- */

/** Все карточки: примеры из банка + колоды пользователя. */
export function allCards(bank, state) {
  const ex = (bank?.cards || []).map((c) => ({ ...c, deckId: `ex-${c.subject}`, example: true }));
  const own = state.decks.flatMap((d) => d.cards.map((c) => ({ ...c, deckId: d.id, subject: d.subject, topic: d.topicId || null })));
  return [...ex, ...own];
}

/** Список колод для экрана «Карточки». */
export function deckList(bank, state) {
  const cards = allCards(bank, state);
  const decks = new Map();
  for (const d of state.decks) decks.set(d.id, { id: d.id, name: d.name, subject: d.subject, own: true });
  for (const c of cards) {
    if (!decks.has(c.deckId)) decks.set(c.deckId, { id: c.deckId, subject: c.subject, example: true });
  }
  return [...decks.values()].map((d) => ({ ...d, cards: cards.filter((c) => c.deckId === d.id) }));
}

/** Очередь карточек: сначала «не помню» (коробка 0), потом те, кому пора. */
export function cardQueue(cards, stats, now = Date.now(), size = CONFIG.cardSessionSize) {
  const due = cards.filter((c) => (stats[c.id]?.due ?? 0) <= now);
  due.sort((a, b) => (stats[a.id]?.box ?? 0) - (stats[b.id]?.box ?? 0) || (stats[a.id]?.due ?? 0) - (stats[b.id]?.due ?? 0));
  return due.slice(0, size).map((c) => c.id);
}

/** Самые слабые карточки — если повторять пока нечего. */
export function weakCards(cards, stats, size = CONFIG.cardSessionSize) {
  return [...cards]
    .sort((a, b) => (stats[a.id]?.box ?? 0) - (stats[b.id]?.box ?? 0) || (stats[b.id]?.wrong ?? 0) - (stats[a.id]?.wrong ?? 0))
    .slice(0, size)
    .map((c) => c.id);
}

export function gradeCard(state, card, known, now = Date.now()) {
  const s = state.cardStats[card.id] || { box: 0, due: 0, seen: 0, wrong: 0 };
  s.seen += 1;
  if (known) {
    s.box = Math.min(s.box + 1, CONFIG.cardDays.length - 1);
    s.due = now + CONFIG.cardDays[s.box] * DAY;
  } else {
    s.box = 0;
    s.wrong += 1;
    s.due = now + 10 * 60 * 1000;
  }
  state.cardStats[card.id] = s;
  return applyTopic(state, card.topic, known, now);
}
