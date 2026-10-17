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

/** Темы из DEFAULT_DATA: строка — примерная тема, объект — настоящая тема с курса. */
export function defaultTopics(onlySubject = null) {
  return clone(DEFAULT_DATA.topics)
    .filter(([subject]) => !onlySubject || subject === onlySubject)
    .flatMap(([subject, list]) => list.map((t, i) => (typeof t === 'string'
      ? { id: `${subject}-${i + 1}`, subject, name: t, status: 'new', note: '', example: true }
      : { subject, status: 'new', note: '', example: false, ...t })));
}

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
    topics: defaultTopics(),
    dayOverrides: d.dayOverrides || {}, // 'дата' → правки дня: wake, leave, classStart, classEnd, home, sleep, morningStudy, noClasses, study, noGame, energy, hot (id события или список id по важности)
    plans: {},        // 'дата' → сохранённый план дня (только сегодня и прошлые дни)
    done: {},         // 'дата' → { blockId: { status: 'done'|'skipped', min, itemKey, type, at } }
    progress: {},     // 'eventId:light|heavy', 'c:subject:kind' (догоняю), 'm:subject:monday:kind' → сделано минут
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
  const from = Number(raw.version) || 1;
  if (from < 2) upgradeTo2(st);
  if (from < 3) upgradeTo3(st);
  if (from < 4) upgradeTo4(st);
  if (from < 5) upgradeTo5(st);
  if (from < 6) upgradeTo6(st);
  if (from < 7) upgradeTo7(st);
  st.version = CONFIG.dataVersion;
  st.app = 'ramki';
  return st;
}

/**
 * Версия 2 (17.10): отставание по предметам, темы истории по докладам, воскресенье — линал.
 * Дописываем только то, чего у пользователя ещё нет: его правки и отметки не трогаем.
 */
function upgradeTo2(st) {
  const d = DEFAULT_DATA;
  for (const ds of d.subjects) {
    const s = st.subjects.find((x) => x.id === ds.id);
    if (!s) continue;
    for (const k of ['behindDays', 'behindSince', 'catchUpWeeks', 'catchUpMin', 'catchUpLight', 'catchUpByTopic', 'noStudy']) {
      if (s[k] === undefined && ds[k] !== undefined) s[k] = ds[k];
    }
    if (ds.id === 'hist') {
      if (Number(s.level) === 2) s.level = ds.level; // «вообще не учил» — уровень 1
      if (!s.note) s.note = ds.note;
    }
  }
  // История: примерные темы → темы докладов. Если примерные темы уже правили — новые просто добавляем.
  const untouched = (t) => t.example && t.status === 'new' && !t.note;
  const histNow = st.topics.filter((t) => t.subject === 'hist');
  if (histNow.every(untouched)) st.topics = st.topics.filter((t) => t.subject !== 'hist');
  const have = new Set(st.topics.map((t) => t.id));
  st.topics.push(...defaultTopics('hist').filter((t) => !have.has(t.id)));
  // КР по линалу подтверждена, готовимся с воскресенья.
  const kr = st.events.find((e) => e.id === 'ev-linal-kr');
  const krNew = d.events.find((e) => e.id === 'ev-linal-kr');
  if (kr && kr.prepFrom === undefined) {
    kr.prepFrom = krNew.prepFrom;
    kr.confirmed = true;
    if (!kr.note || kr.note.startsWith('Точно не известно')) kr.note = krNew.note;
  }
  for (const [day, ov] of Object.entries(d.dayOverrides || {})) {
    st.dayOverrides[day] = { ...ov, ...(st.dayOverrides[day] || {}) };
  }
  st.settings.updateSeen = 1; // показать заметку «что нового»
}

/** Версия 3 (17.10): сессия — в конце декабря, а не 1 декабря. Если дату уже правили руками — не трогаем. */
function upgradeTo3(st) {
  const d = DEFAULT_DATA;
  const ev = st.events.find((e) => e.id === 'ev-session');
  const evNew = d.events.find((e) => e.id === 'ev-session');
  if (ev && ev.date === '2026-12-01' && !ev.confirmed) {
    ev.date = evNew.date;
    ev.title = evNew.title;
    ev.note = evNew.note;
  }
  if (st.settings.sessionStart === '2026-12-01' && st.settings.sessionApprox !== false) st.settings.sessionStart = d.settings.sessionStart;
}

/** Версия 4 (17.10): историю растянули с 6 до 8 недель — сессия в конце декабря. Если срок меняли сами — не трогаем. */
function upgradeTo4(st) {
  const hist = st.subjects.find((s) => s.id === 'hist');
  const dh = DEFAULT_DATA.subjects.find((s) => s.id === 'hist');
  if (hist?.catchUpByTopic && Number(hist.catchUpWeeks) === 6 && Number(hist.catchUpMin) === Number(dh.catchUpMin)) hist.catchUpWeeks = dh.catchUpWeeks;
}

/** Версия 5 (17.10): к лабам не готовятся — дома доделывают прошлую (расчёты и контрольные вопросы). Свои заметки не трогаем. */
const OLD_LAB_NOTES = {
  'ev-phys-lab1': 'Допуск и подготовка — уточнить.',
  'ev-phys-lab2': 'Каждые 4 недели после 20 октября.',
  'ev-phys-lab3': '',
  'ev-phys-lab4': '',
};

function upgradeTo5(st) {
  for (const fresh of DEFAULT_DATA.events.filter((e) => e.type === 'lab')) {
    const ev = st.events.find((e) => e.id === fresh.id);
    if (ev && (ev.note || '') === (OLD_LAB_NOTES[ev.id] ?? '')) ev.note = fresh.note;
  }
}

/** Версия 6 (17.10): контрольная по информатике в пятницу 23.10. Если такое событие уже есть (добавил сам) — не дублируем. */
function upgradeTo6(st) {
  const fresh = DEFAULT_DATA.events.find((e) => e.id === 'ev-inf-kr');
  const has = st.events.some((e) => e.id === fresh.id || (e.subject === fresh.subject && e.type === fresh.type && e.date === fresh.date));
  if (!has) st.events.push(clone(fresh));
}

/** Версия 7 (17.10): воскресенье 18.10 — до обеда информатика (КР в пятницу), после — линал. Если день правили руками — не трогаем. */
function upgradeTo7(st) {
  const ov = st.dayOverrides['2026-10-18'];
  const fresh = DEFAULT_DATA.dayOverrides['2026-10-18'];
  if (ov && ov.study === true && Number(ov.studyMin) === 180 && ov.hot === 'ev-linal-kr') {
    st.dayOverrides['2026-10-18'] = { ...ov, studyMin: fresh.studyMin, hot: [...fresh.hot] };
  }
}

export const store = {
  state: null,
  rev: 0,          // растёт при каждом изменении — для кэша расчётов
  storageOk: true,
  firstRun: false,
  migratedFrom: null, // данные обновились с этой версии при запуске
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
      if (raw) {
        const parsed = JSON.parse(raw);
        const v = Number(parsed.version) || 1;
        if (v < CONFIG.dataVersion) store.migratedFrom = v; // приложение пересоберёт сегодняшний план
        st = migrate(parsed);
      }
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
