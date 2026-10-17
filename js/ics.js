/* =====================================================================
   Экспорт в календарь (.ics) с будильниками — работает на iPhone без
   сервера: файл открывается, «Добавить все», и напоминания приходят
   системными уведомлениями календаря.
   • Дедлайны: напоминание накануне в 18:00 (и за 3 дня для КР/лаб/зачётов).
   • Учебные блоки на неделю вперёд: напоминание к началу.
   • Строгий режим: утренний и вечерний чек-ин.
   Ничего не звенит на парах, в игре и в утренней дороге — там блоков нет.
   ===================================================================== */

import { CONFIG, EVENT_TYPES } from './config.js';
import { subjectOf } from './planner.js';
import { addDays, fmtTime, pad2 } from './util.js';

const CRLF = '\r\n';

/** Экранирование текста по RFC 5545. */
export function escText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Перенос длинных строк: не больше 75 байт, продолжение начинается с пробела. */
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let len = 0;
  for (const ch of line) {
    const l = enc.encode(ch).length;
    const max = parts.length ? 74 : 75;
    if (len + l > max) {
      parts.push(cur);
      cur = ch;
      len = l;
    } else {
      cur += ch;
      len += l;
    }
  }
  if (cur) parts.push(cur);
  return parts.join(`${CRLF} `);
}

/** Дата + минуты от полуночи → 20261019T090000 (местное время телефона). */
function localStamp(key, min) {
  let k = key;
  let m = Math.round(min);
  while (m >= 1440) {
    k = addDays(k, 1);
    m -= 1440;
  }
  return `${k.replace(/-/g, '')}T${pad2(Math.floor(m / 60))}${pad2(m % 60)}00`;
}

const utcStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const safeUid = (s) => String(s).replace(/[^A-Za-z0-9-]/g, '-');

function alarm(trigger, text) {
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(text)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
}

/**
 * Собрать .ics. sim — результат simulate(): из него берутся блоки на неделю.
 * Мягкий режим — только дедлайны; средний — плюс учебные блоки; строгий — плюс чек-ины.
 */
export function buildIcs({ state, sim, today, nowMin = 0, now = new Date(), days = CONFIG.icsDaysAhead }) {
  const strictness = state.settings.strictness || 'strict';
  const stamp = utcStamp(now);
  const L = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Ramki//Study planner//RU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText('Рамки — учёба')}`,
  ];

  // 1. Дедлайны — события на весь день.
  for (const ev of state.events) {
    if (ev.done || ev.date < today) continue;
    const subj = subjectOf(state, ev.subject);
    const type = EVENT_TYPES[ev.type];
    const name = [type?.short, subj?.short].filter(Boolean).join(' · ');
    const summary = `${name}: ${ev.title}`;
    const desc = [
      ev.time ? `Время: ${ev.time}${ev.timeAssumed ? ' (предположительно)' : ''}` : '',
      ev.format ? `Формат: ${ev.format}` : '',
      ev.phone === 'no' ? 'Телефон: нельзя' : ev.phone === 'yes' ? 'Телефон: можно' : '',
      ev.confirmed ? '' : 'Не подтверждено — уточнить',
      ev.note || '',
    ].filter(Boolean).join('\n');
    L.push('BEGIN:VEVENT', `UID:event-${safeUid(ev.id)}@ramki`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${ev.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(ev.date, 1).replace(/-/g, '')}`,
      `SUMMARY:${escText(summary)}`, `DESCRIPTION:${escText(desc)}`, 'TRANSP:TRANSPARENT');
    if (ev.type !== 'session') L.push(...alarm('-PT6H', `Завтра: ${summary}`));
    if (['kr', 'lab', 'zachet', 'exam'].includes(ev.type)) L.push(...alarm('-P2DT6H', `Через 3 дня: ${summary}`));
    L.push('END:VEVENT');
  }

  // 2. Учебные блоки на неделю вперёд.
  if (strictness !== 'soft') {
    for (let d = 0; d < days; d++) {
      const key = addDays(today, d);
      const plan = sim?.plans?.[key];
      if (!plan) continue;
      const done = state.done?.[key] || {};
      for (const b of plan.blocks) {
        const wanted = b.type === 'study' || (strictness === 'strict' && (b.type === 'plan' || b.type === 'habit'));
        if (!wanted || done[b.id]?.status) continue;
        if (key === today && b.start <= nowMin) continue;
        L.push('BEGIN:VEVENT', `UID:${safeUid(b.id)}@ramki`, `DTSTAMP:${stamp}`,
          `DTSTART:${localStamp(key, b.start)}`, `DTEND:${localStamp(key, b.end)}`,
          `SUMMARY:${escText(b.title)}`, `DESCRIPTION:${escText([b.detail, b.first ? `С чего начать: ${b.first}` : ''].filter(Boolean).join('\n'))}`,
          ...alarm(strictness === 'strict' ? '-PT5M' : 'PT0M', b.title), 'END:VEVENT');
      }
    }
  }

  // 3. Чек-ины (строгий режим + договорённость): утром после подъёма и вечером перед сном.
  if (strictness === 'strict' && state.settings.agreement) {
    for (let d = 0; d < days; d++) {
      const key = addDays(today, d);
      const plan = sim?.plans?.[key];
      if (!plan) continue;
      const morning = plan.info.wake + 15;
      const review = plan.blocks.find((b) => b.type === 'review');
      const evening = review ? review.start : plan.info.bed - 15;
      const items = [
        ['am', morning, 'Утро: договориться о дне', 'Два тапа: силы и что берёшь сегодня.'],
        ['pm', evening, 'Вечер: короткий отчёт', 'Два тапа: как прошло. Несделанное перенесётся само.'],
      ];
      for (const [id, min, title, desc] of items) {
        if (key === today && min <= nowMin) continue;
        L.push('BEGIN:VEVENT', `UID:checkin-${id}-${key}@ramki`, `DTSTAMP:${stamp}`,
          `DTSTART:${localStamp(key, min)}`, `DTEND:${localStamp(key, min + 5)}`,
          `SUMMARY:${escText(title)}`, `DESCRIPTION:${escText(`${desc} (${fmtTime(min)})`)}`,
          ...alarm('PT0M', title), 'END:VEVENT');
      }
    }
  }

  L.push('END:VCALENDAR');
  return L.map(fold).join(CRLF) + CRLF;
}
