/* =====================================================================
   Расписание дня: пары, подъём/выход/возвращение/отбой, серые блоки
   (время, когда я не учусь) и свободные окна, в которые планировщик
   ставит учёбу. Чистые функции — без DOM.
   ===================================================================== */

import { CONFIG } from './config.js';
import { addDays, daysBetween, fmtTime, toMin, weekdayOf } from './util.js';

/** Проходит ли пара в эту дату: «каждую неделю», «через неделю», «раз в 4 недели». */
export function classOccurs(c, key) {
  if (c.from && key < c.from) return false;
  if (c.until && key > c.until) return false;
  const every = Number(c.every) || 1;
  if (every === 1 || !c.anchor) return true;
  const weeks = Math.floor(daysBetween(c.anchor, key) / 7);
  return ((weeks % every) + every) % every === 0;
}

/** Пары на дату, по времени начала. */
export function classesOn(state, key) {
  const ov = state.dayOverrides?.[key];
  if (ov?.noClasses) return [];
  const wd = weekdayOf(key);
  return state.classes
    .filter((c) => Number(c.weekday) === wd && classOccurs(c, key))
    .map((c) => ({ ...c, startMin: toMin(c.start), endMin: toMin(c.end) }))
    .filter((c) => c.startMin != null && c.endMin != null && c.endMin > c.startMin)
    .sort((a, b) => a.startMin - b.startMin);
}

/**
 * Базовые времена дня: шаблон недели + правки конкретного дня.
 * Если пары в этот день начинаются/кончаются не как обычно (лаба во вторник),
 * выход и возвращение сдвигаются на ту же разницу.
 */
export function baseTimes(state, key) {
  const wd = weekdayOf(key);
  const tpl = state.week?.[wd] || {};
  const ov = state.dayOverrides?.[key] || {};
  const classes = classesOn(state, key);
  const tplWake = toMin(tpl.wake) ?? 7 * 60;
  let wake = toMin(ov.wake) ?? tplWake;
  let leave = null;
  let classStart = null;
  let classEnd = null;
  let home = null;

  if (classes.length) {
    classStart = toMin(ov.classStart) ?? classes[0].startMin;
    classEnd = toMin(ov.classEnd) ?? Math.max(...classes.map((c) => c.endMin));
    const tplCS = toMin(tpl.classStart) ?? classStart;
    const tplCE = toMin(tpl.classEnd) ?? classEnd;
    const tplLeave = toMin(tpl.leave) ?? tplCS - CONFIG.defaultLeaveBeforeClassMin;
    const tplHome = toMin(tpl.home) ?? tplCE + CONFIG.defaultHomeAfterClassMin;
    leave = toMin(ov.leave) ?? tplLeave + (classStart - tplCS);
    home = toMin(ov.home) ?? tplHome + (classEnd - tplCE);
    if (ov.homeShift) home += Number(ov.homeShift);
    if (toMin(ov.wake) == null) {
      // выходить раньше обычного → вставать раньше; позже — не трогаем
      wake = tplWake + Math.min(0, leave - tplLeave);
    }
    wake = Math.min(wake, leave - 15);
    home = Math.max(home, classEnd + 30);
  }

  let sleep = toMin(ov.sleep) ?? toMin(tpl.sleep) ?? 23 * 60;
  if (sleep < 12 * 60) sleep += 1440; // '00:00' → 24:00, '00:30' → 24:30
  return { key, wd, tpl, ov, classes, wake, leave, classStart, classEnd, home, sleep };
}

/** Минимум сна (в минутах) для ночи, которая начинается вечером дня wd. */
export function minSleepMinutes(state, wd) {
  const base = (Number(state.settings?.minSleepHours) || CONFIG.minSleepHours) * 60;
  const ex = CONFIG.sleepExceptions[wd];
  if (state.settings?.fridayException && ex != null) return Math.min(base, ex * 60);
  return base;
}

/** Самое раннее, когда реально лечь: доехать и хотя бы быстро поесть. */
const earliestBedOf = (b) => (b.home != null ? b.home + 20 : b.wake + 60);

/** Во сколько лечь, чтобы ночь была не короче минимума. */
function bedFor(state, b, nextWake) {
  const latest = nextWake + 1440 - minSleepMinutes(state, b.wd);
  return Math.max(Math.min(b.sleep, latest), earliestBedOf(b));
}

/**
 * Полная информация о дне: времена, отбой с учётом минимума сна,
 * длина ночи до следующего подъёма, длина прошлой ночи.
 */
export function dayInfo(state, key) {
  const b = baseTimes(state, key);
  const next = baseTimes(state, addDays(key, 1));
  const prev = baseTimes(state, addDays(key, -1));
  const minSleep = minSleepMinutes(state, b.wd);
  const latestBed = next.wake + 1440 - minSleep;
  const bed = bedFor(state, b, next.wake);
  const nightMin = next.wake + 1440 - bed;
  const prevNight = b.wake + 1440 - bedFor(state, prev, b.wake);

  const notes = [];
  if (bed < b.sleep && bed <= latestBed) {
    notes.push({ kind: 'bedEarlier', text: `Отбой в ${fmtTime(bed)}, а не в ${fmtTime(b.sleep)}: иначе сна будет меньше ${minSleep / 60} ч.` });
  }
  const sleepShort = nightMin < minSleep;
  if (sleepShort) {
    notes.push({ kind: 'sleepShort', text: `Даже если лечь сразу после дороги, ночь будет ${Math.floor(nightMin / 60)} ч ${nightMin % 60} мин — меньше минимума. Так устроено расписание: вечером без учёбы и игр.` });
  }
  const isException = minSleep < (Number(state.settings?.minSleepHours) || CONFIG.minSleepHours) * 60;
  if (isException && !sleepShort) {
    notes.push({ kind: 'exception', text: `Короткая ночь (исключение): около ${Math.round(nightMin / 6) / 10} ч. Ужин — и спать, завтра добираем днём.` });
  }
  return { ...b, next, bed, nightMin, prevNight, minSleep, latestBed, sleepShort, isException, notes };
}

/**
 * Скелет дня: серые блоки и окна для учёбы.
 * Окна: am — утренняя дорога (если сделать её учебной), gap — окно между парами
 * от часа, train — дорога домой, home — вечер дома, rest — день без пар.
 */
export function daySkeleton(state, key) {
  const info = dayInfo(state, key);
  const fixed = [];
  const windows = [];
  const push = (type, start, end, extra = {}) => {
    if (end - start >= 1) fixed.push({ type, start, end, ...extra });
  };

  push('sleep', 0, Math.min(info.wake, 1440), { title: 'Сон', id: `${key}:sleep-am` });

  if (info.classes.length) {
    push('morning', info.wake, info.leave, { title: 'Утро', detail: 'Подъём, сборы, завтрак', id: `${key}:morning` });
    if (info.ov.morningStudy) {
      windows.push({ id: 'am', kind: 'am', start: info.leave, end: info.classStart });
    } else {
      push('commute', info.leave, info.classStart, {
        title: 'Дорога в универ', detail: 'Досыпаю в электричке', toggle: 'morningStudy', id: `${key}:commute`,
      });
    }
    info.classes.forEach((c, i) => {
      push('class', c.startMin, c.endMin, { classId: c.id, subject: c.subject, kind: c.kind, id: `${key}:class:${c.id}` });
      const nxt = info.classes[i + 1];
      if (!nxt) return;
      const gap = nxt.startMin - c.endMin;
      if (gap >= 60) windows.push({ id: `gap${i}`, kind: 'gap', start: c.endMin, end: nxt.startMin });
      else if (gap >= 20) push('meal', c.endMin, nxt.startMin, { title: 'Перерыв', detail: 'Поесть, пройтись', id: `${key}:gap${i}` });
      else if (gap > 0) push('break', c.endMin, nxt.startMin, { title: 'Перемена', id: `${key}:brk${i}` });
    });
    const trainStart = Math.max(info.classEnd, info.home - CONFIG.trainMin);
    push('transfer', info.classEnd, trainStart, { title: 'Обед и дорога до электрички', id: `${key}:transfer` });
    windows.push({ id: 'train', kind: 'train', start: trainStart, end: info.home });
    // Зал: сразу после прихода домой; нет, если вечер после него слишком короткий (сон важнее)
    const gymEnd = info.home + CONFIG.gym.minutes;
    const gymOn = state.settings?.gym && (state.settings.gymDays || []).includes(info.wd) && !info.ov?.noGym
      && info.bed - gymEnd >= CONFIG.gym.minEveningLeftMin;
    if (gymOn) {
      push('gym', info.home, gymEnd, { title: 'Зал', detail: 'Дорога и тренировка, около 2,5 ч. Ужин — после', id: `${key}:gym` });
      info.gym = true;
    }
    windows.push({ id: 'home', kind: 'home', start: gymOn ? gymEnd : info.home, end: info.bed });
  } else {
    // Зал в выходной — утром, после завтрака; учёба, обед и игра встают вокруг
    const gymAt = info.wake + CONFIG.weekendMeals.breakfast;
    if (state.settings?.gym && (state.settings.gymDays || []).includes(info.wd) && !info.ov?.noGym
      && info.bed - (gymAt + CONFIG.gym.minutes) >= CONFIG.gym.minEveningLeftMin) {
      push('gym', gymAt, gymAt + CONFIG.gym.minutes, { title: 'Зал', detail: 'Дорога и тренировка, около 2,5 ч. Завтрак — до, обед — после', id: `${key}:gym` });
      info.gym = true;
      info.gymEnd = gymAt + CONFIG.gym.minutes;
    }
    windows.push({ id: 'rest', kind: 'rest', start: info.wake, end: info.bed });
  }

  if (info.bed < 1440) push('sleep', info.bed, 1440, { title: 'Сон', id: `${key}:sleep-pm` });
  return { info, fixed, windows };
}
