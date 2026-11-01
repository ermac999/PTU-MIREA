/* =====================================================================
   Мелкие помощники: даты, время, форматирование. Без доступа к DOM —
   поэтому их можно проверять тестами в Node.
   ===================================================================== */

export const pad2 = (n) => String(n).padStart(2, '0');

/** Date → 'ГГГГ-ММ-ДД' по местному времени телефона. */
export function keyOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'ГГГГ-ММ-ДД' → Date (полночь по местному времени). */
export function dateOf(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = dateOf(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

/** 0 — воскресенье … 6 — суббота. */
export const weekdayOf = (key) => dateOf(key).getDay();

/** Сколько дней от a до b (b − a). */
export function daysBetween(a, b) {
  return Math.round((dateOf(b) - dateOf(a)) / 86400000);
}

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(key) {
  const wd = weekdayOf(key);
  return addDays(key, wd === 0 ? -6 : 1 - wd);
}

export const todayKey = (now = new Date()) => keyOf(now);
export const minutesNow = (now = new Date()) => now.getHours() * 60 + now.getMinutes();

/** 'ЧЧ:ММ' → минуты от полуночи. Пустое значение → null. */
export function toMin(hm) {
  if (hm == null || hm === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Минуты → 'ЧЧ:ММ' (после полуночи снова с 00:00). */
export function fmtTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 135 → '2 ч 15 мин'. */
export function fmtDur(min) {
  const t = Math.max(0, Math.round(min));
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (!h) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** 135 → '2,3 ч' — для сводок. */
export function fmtHours(min) {
  const h = Math.round((min / 60) * 10) / 10;
  return `${String(h).replace('.', ',')} ч`;
}

export const round5 = (x) => Math.round(x / 5) * 5;
export const floor5 = (x) => Math.floor(x / 5) * 5;
export const ceil5 = (x) => Math.ceil(x / 5) * 5;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export const WD_SHORT = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
export const WD_LONG = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

/** '2026-10-17' → '17 октября'. */
export function humanDate(key) {
  const d = dateOf(key);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** '2026-10-17' → 'сб, 17.10'. */
export function shortDate(key) {
  const d = dateOf(key);
  return `${WD_SHORT[d.getDay()].toLowerCase()}, ${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

export const monthName = (monthIndex) => MONTHS_NOM[monthIndex];

/** Русское склонение: plural(5, 'день', 'дня', 'дней') → 'дней'. */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** «через 3 дня», «завтра», «сегодня», «вчера». */
export function relDays(fromKey, toKey) {
  const n = daysBetween(fromKey, toKey);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === 2) return 'послезавтра';
  if (n === -1) return 'вчера';
  if (n < 0) return `${-n} ${plural(-n, 'день', 'дня', 'дней')} назад`;
  return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

let uidCounter = 0;
/** Короткий уникальный id для записей пользователя. */
export function uid(prefix = 'id') {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Экранирование текста для вставки в HTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Глубокая копия простых данных (JSON-совместимых). */
export const clone = (x) => JSON.parse(JSON.stringify(x));
