/* =====================================================================
   Хранилище: всё состояние приложения — один объект в localStorage.
   • Если localStorage недоступен (приватный режим, запрет сайта) —
     работаем в памяти и честно предупреждаем, что данные не сохранятся.
   • Если сохранённые данные испорчены — откладываем копию и начинаем заново.
   • Если память переполнена — чистим старые планы и пробуем ещё раз.
   • Экспорт/импорт — обычный JSON-файл.
   ===================================================================== */

import { CONFIG, DEFAULT_DATA } from './config.js';
import { addDays, clone, todayKey } from './util.js';

/** Состояние «с нуля» — данные из опроса. */
export function defaultState() {
  const d = clone(DEFAULT_DATA);
  return {
    app: 'ramki',
    version: CONFIG.dataVersion,
    createdAt: Date.now(),
    settings: d.settings,
    week: d.week,
    subjects: d.subjects,
    classes: d.classes,
    events: d.events,
    topics: d.topics.flatMap(([subject, names]) => names.map((name, i) => ({
      id: `${subject}-${i + 1}`, subject, name, status: 'new', note: '', example: true,
    }))),
    dayOverrides: {}, // 'дата' → правки дня: wake, leave, classStart, classEnd, home, sleep, morningStudy, noClasses, energy, hot
    plans: {},        // 'дата' → сохранённый план дня (только сегодня и прошлые дни)
    done: {},         // 'дата' → { blockId: { status: 'done'|'skipped', min, itemKey, type, at } }
    progress: {},     // 'eventId:light|heavy' или 'm:subject:monday:kind' → сделано минут
    practice: {},     // taskId → { seen, correct, wrong, streak, due, lastAt, lastOk }
    topicHist: {},    // topicId → последние ответы [{ at, ok }]
    cardStats: {},    // cardId → { box, due, seen, wrong }
    decks: [],        // колоды пользователя: { id, name, subject, topicId, cards: [{ id, q, a }] }
    customTasks: [],  // задания, добавленные текстом в приложении
    attendance: {},   // 'дата|classId' → 'present' | 'absent'
    focus: {},        // 'дата' → минут фокуса
    checkins: {},     // 'дата' → { morning: {...}, evening: {...} }
    bestStreak: 0,
    timer: null,      // таймер фокуса, чтобы пережить перезагрузку
  };
}

/** Дополнить старые/импортированные данные недостающими полями. */
export function migrate(raw) {
  const base = defaultState();
  const st = { ...base, ...raw };
  st.settings = { ...base.settings, ...(raw.settings || {}) };
  st.settings.quiet = { ...base.settings.quiet, ...(raw.settings?.quiet || {}) };
  for (const k of ['dayOverrides', 'plans', 'done', 'progress', 'practice', 'topicHist', 'cardStats', 'attendance', 'focus', 'checkins']) {
    if (!st[k] || typeof st[k] !== 'object' || Array.isArray(st[k])) st[k] = {};
  }
  for (const k of ['subjects', 'classes', 'events', 'topics', 'decks', 'customTasks']) {
    if (!Array.isArray(st[k])) st[k] = base[k];
  }
  if (!st.week || typeof st.week !== 'object') st.week = base.week;
  st.version = CONFIG.dataVersion;
  st.app = 'ramki';
  return st;
}

export const store = {
  state: null,
  rev: 0,          // растёт при каждом изменении — для кэша расчётов
  storageOk: true,
  firstRun: false,
  lastError: null,
  listeners: new Set(),
};

function safeStorage() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const k = '__ramki_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

export function loadState() {
  const ls = safeStorage();
  store.storageOk = !!ls;
  let st = null;
  if (ls) {
    let raw = null;
    try {
      raw = ls.getItem(CONFIG.storageKey);
      if (raw) st = migrate(JSON.parse(raw));
    } catch {
      try { ls.setItem(`${CONFIG.storageKey}.broken.${Date.now()}`, raw || ''); } catch { /* места нет — ничего страшного */ }
      store.lastError = 'Сохранённые данные оказались повреждены. Я начал с чистого листа, а старую копию отложил. Если есть файл копии — импортируй его в настройках.';
      st = null;
    }
  }
  store.firstRun = !st;
  store.state = st || defaultState();
  return store.state;
}

const isQuota = (e) => e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);

/** Удалить старые планы (больше 60 дней) и отметки (больше 400 дней). */
export function pruneOld(st, today = todayKey()) {
  const plansBefore = addDays(today, -60);
  const doneBefore = addDays(today, -400);
  for (const k of Object.keys(st.plans)) if (k < plansBefore) delete st.plans[k];
  for (const k of Object.keys(st.done)) if (k < doneBefore) delete st.done[k];
  for (const k of Object.keys(st.dayOverrides)) if (k < plansBefore) delete st.dayOverrides[k];
}

let saveTimer = null;

export function persistNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!store.storageOk) return false;
  const write = () => globalThis.localStorage.setItem(CONFIG.storageKey, JSON.stringify(store.state));
  try {
    write();
    return true;
  } catch (e) {
    if (isQuota(e)) {
      pruneOld(store.state);
      try {
        write();
        return true;
      } catch { /* ниже — сообщение */ }
    }
    store.lastError = 'Не получилось сохранить: память браузера заполнена. Сделай копию в настройках («Данные»), потом удали старые колоды или задания.';
    emit();
    return false;
  }
}

function emit() {
  for (const fn of store.listeners) {
    try { fn(store); } catch (e) { console.error(e); }
  }
}

/**
 * Изменить состояние: mutator получает state и правит его на месте.
 * silent — сохранить без перерисовки экрана (например, пока печатаешь конспект).
 */
export function commit(mutator, { silent = false } = {}) {
  mutator(store.state);
  store.rev += 1;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 250);
  if (!silent) emit();
}

export const onChange = (fn) => store.listeners.add(fn);

/* ---------- Экспорт / импорт ---------- */

export function exportPayload() {
  return { app: 'ramki', version: CONFIG.dataVersion, exportedAt: new Date().toISOString(), state: store.state };
}

/** Проверить файл копии. Бросает понятную ошибку, если что-то не так. */
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Файл не читается как JSON. Возможно, это не копия «Рамок» или файл обрезан.');
  }
  const st = obj?.state ?? obj;
  if (!st || (obj.app && obj.app !== 'ramki')) throw new Error('Это не файл копии «Рамок».');
  if (!Array.isArray(st.subjects) || !Array.isArray(st.events) || typeof st.week !== 'object') {
    throw new Error('В файле не хватает разделов (предметы, события, режим недели). Нужен файл, сделанный кнопкой «Сохранить копию».');
  }
  return migrate(st);
}

export function replaceState(next) {
  store.state = next;
  store.rev += 1;
  persistNow();
  emit();
}
