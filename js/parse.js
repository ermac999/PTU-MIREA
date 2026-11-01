/* =====================================================================
   Разбор вставленного текста — без ИИ, по простым правилам.
   • Дедлайны: строки вида «19.10 | линал | контрольная | на бумаге | телефон нельзя».
     Разделитель «|» не обязателен — дата, тип и предмет ищутся по словам.
   • Задания: шаблон «Предмет: / Тема: / Вопрос: / Ответ: / Разбор:», задачи
     разделяются строкой «---» или новым «Вопрос:».
   • Карточки: «вопрос :: ответ» (или через « — », « | », Tab) — по строке на карточку.
   ===================================================================== */

import { addDays, pad2 } from './util.js';
import { normalize, parseNumber } from './practice.js';

/* ---------- Предмет по слову ---------- */

const SUBJECT_ALIASES = {
  linal: ['линал', 'линейн', 'лин ал', 'лин. ал', 'лааг', 'аналитическ', 'геометри'],
  matan: ['матан', 'мат ан', 'мат. ан', 'математический анализ', 'матанализ'],
  matlog: ['матлог', 'мат лог', 'мат. лог', 'логик', 'дискретн'],
  inf: ['информат', 'инфа', 'инф ', 'программир'],
  phys: ['физика', 'физике', 'физики', 'физику', 'физ '],
  hist: ['истори'],
  intro: ['введени', 'проф деят', 'профдеят', 'впд'],
  de: ['немец', 'нем ', 'нем.', 'иностран', 'ин. яз', 'ин яз', 'иняз', 'deutsch'],
  pe: ['физкульт', 'физра', 'физ-ра', 'спорт'],
};

/** Найти предмет по тексту. Возвращает id или null. */
export function matchSubject(text, state) {
  const low = ` ${String(text).toLowerCase()} `;
  let best = null;
  let bestLen = 0;
  for (const s of state.subjects) {
    const aliases = [...(SUBJECT_ALIASES[s.id] || []), s.short?.toLowerCase(), s.name?.toLowerCase()].filter(Boolean);
    for (const a of aliases) {
      if (a.length > bestLen && low.includes(a)) {
        best = s.id;
        bestLen = a.length;
      }
    }
  }
  return best;
}

/* ---------- Дедлайны ---------- */

const TYPE_RULES = [
  ['exam', /экзам/],
  ['zachet', /зач[её]т/],
  ['lab', /лаб/],
  ['session', /сесси/],
  ['kr', /контрол|(^|[^а-я])кр([^а-я]|$)|самостоят|тест/],
  ['dz', /дз|домашн|презент|доклад|реферат|эссе|отч[её]т|сдат|сдач|проект|курсов/],
];

const TITLE_BY_TYPE = {
  kr: 'Контрольная', lab: 'Лабораторная', zachet: 'Зачёт', exam: 'Экзамен', session: 'Сессия', dz: 'Сдача',
};

function realDate(y, m, d) {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Одна строка → черновик события. */
export function parseDeadlineLine(line, state, today) {
  const low = line.toLowerCase();
  const warnings = [];

  let date = null;
  const dm = /(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/.exec(low);
  if (dm) {
    const d = Number(dm[1]);
    const m = Number(dm[2]);
    let y = dm[3] ? Number(dm[3].length === 2 ? `20${dm[3]}` : dm[3]) : Number(today.slice(0, 4));
    if (!dm[3] && `${y}-${pad2(m)}-${pad2(d)}` < addDays(today, -60)) y += 1; // «12.01» в октябре — следующий год
    if (realDate(y, m, d)) date = `${y}-${pad2(m)}-${pad2(d)}`;
  } else if (/послезавтра/.test(low)) date = addDays(today, 2);
  else if (/завтра/.test(low)) date = addDays(today, 1);
  else if (/сегодня/.test(low)) date = today;
  if (!date) warnings.push('не нашёл дату');

  const tm = /(?:^|[^\d])(\d{1,2}):(\d{2})/.exec(low);
  const time = tm && Number(tm[1]) < 24 ? `${pad2(Number(tm[1]))}:${tm[2]}` : null;

  const type = (TYPE_RULES.find(([, re]) => re.test(low)) || ['dz'])[0];

  const formats = [];
  if (/бумаг|письменн/.test(low)) formats.push('на бумаге');
  if (/компьют|\bпк\b|онлайн/.test(low)) formats.push('на компьютере');
  if (/устн/.test(low)) formats.push('устно');
  if (/флеш|флэш/.test(low)) formats.push('на флешке');
  if (/сдо|moodle|мудл/.test(low)) formats.push('в СДО');

  let phone = '?';
  if (/без телефон|телефон\S*\s*(нельзя|запрещ)/.test(low)) phone = 'no';
  else if (/с телефоном|телефон\S*\s*(можно|разреш)/.test(low)) phone = 'yes';

  const confirmed = !/(точно не знаю|не точно|неточно|возможно|кажется|\?)/.test(low);

  const subject = matchSubject(low, state);
  if (!subject && type !== 'session') warnings.push('не узнал предмет — выбери вручную');

  // Название: третья часть «| … |», без пометок в скобках.
  const parts = line.split('|').map((p) => p.trim());
  let title = parts.length >= 3 ? parts[2].replace(/\(.*?\)/g, '').trim() : '';
  if (!title || title.length > 60) title = TITLE_BY_TYPE[type];
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { ok: !!date, date, time, type, subject, title, format: formats.join(' или '), phone, confirmed, source: line, warnings };
}

export function parseDeadlines(text, state, today) {
  return String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => parseDeadlineLine(l, state, today));
}

/* ---------- Задания по шаблону ---------- */

const FIELD = /^(предмет|тема|вопрос|задача|ответ|ответы|разбор|решение|пояснение|варианты|точность)\s*[:：]\s*(.*)$/i;
const FIELD_KEY = {
  предмет: 'subject', тема: 'topic', вопрос: 'q', задача: 'q', ответ: 'a', ответы: 'a',
  разбор: 'explain', решение: 'explain', пояснение: 'explain', варианты: 'options', точность: 'tolerance',
};

const splitList = (s) => String(s).split(/\s*(?:\||;|\sили\s)\s*/i).map((x) => x.trim()).filter(Boolean);

// Единицы, которые могут стоять после числа в ответе («6 м/с», «1380 год»).
const UNITS = new Set([
  'м', 'см', 'мм', 'км', 'с', 'сек', 'мин', 'ч', 'кг', 'г', 'т', 'н', 'кн', 'дж', 'кдж', 'вт', 'квт',
  'па', 'кпа', 'в', 'а', 'ом', 'гц', 'год', 'года', 'лет', 'бит', 'байт', 'байта', 'байтов', 'кб', 'мб', 'гб',
  'шт', 'раз', 'град', 'рад', '%', '°',
]);

/** «6», «0,25», «1/4», «6 м/с» — число; «2x4», «3x^2» — нет. После числа — только единицы. */
function looksNumeric(a) {
  if (Number.isNaN(parseNumber(a))) return false;
  const s = String(a).trim().toLowerCase().replace(/[−–]/g, '-').replace(',', '.');
  const m = /^-?\d+(?:\.\d+)?(?:\/-?\d+(?:\.\d+)?)?/.exec(s);
  if (!m) return false;
  const tail = s.slice(m[0].length).replace(/[²³]|\^[23]/g, '');
  const tokens = tail.split(/[\s/·*.]+/).filter(Boolean);
  return tokens.every((t) => UNITS.has(t));
}

/**
 * Текст → черновики заданий. Предмет и тема «запоминаются» и действуют
 * на следующие задания, пока их не поменяют.
 */
export function parseTasks(text, state) {
  const drafts = [];
  let cur = null;
  let ctx = { subject: '', topic: '' };
  let lastField = null;

  const flush = () => {
    if (cur && (cur.q || cur.a)) drafts.push(cur);
    cur = null;
    lastField = null;
  };

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^-{3,}$/.test(line)) { flush(); continue; }
    if (!line) continue;
    const m = FIELD.exec(line);
    if (m) {
      const key = FIELD_KEY[m[1].toLowerCase()];
      const val = m[2].trim();
      if (key === 'subject' || key === 'topic') {
        ctx = { ...ctx, [key]: val };
        if (cur && !cur.q) cur[key] = val;
        lastField = null;
        continue;
      }
      if (key === 'q') flush();
      if (!cur) cur = { subject: ctx.subject, topic: ctx.topic, q: '', a: '', explain: '', options: '', tolerance: '' };
      cur[key] = val;
      lastField = key;
    } else if (cur && lastField) {
      cur[lastField] += `\n${line}`; // продолжение многострочного поля
    }
  }
  flush();

  return drafts.map((d, i) => toTask(d, state, i));
}

function toTask(d, state, i) {
  const errors = [];
  const subject = matchSubject(d.subject || '', state) || null;
  if (!d.q.trim()) errors.push('нет вопроса');
  if (!d.a.trim()) errors.push('нет ответа');
  if (!subject) errors.push(d.subject ? `не узнал предмет «${d.subject}»` : 'не указан предмет');

  const topicName = (d.topic || '').trim();
  const topic = subject && topicName
    ? state.topics.find((t) => t.subject === subject && t.name.toLowerCase() === topicName.toLowerCase())
    : null;

  const answers = splitList(d.a);
  const options = d.options ? splitList(d.options) : [];
  let type = 'text';
  let answer;
  if (options.length >= 2) {
    type = 'choice';
    const a = (answers[0] || '').trim();
    const letters = ['а', 'б', 'в', 'г', 'д', 'е'];
    const latin = ['a', 'b', 'c', 'd', 'e', 'f'];
    let idx = options.findIndex((o) => normalize(o) === normalize(a));
    if (idx < 0 && /^[1-6]$/.test(a)) idx = Number(a) - 1;
    if (idx < 0 && letters.includes(a.toLowerCase())) idx = letters.indexOf(a.toLowerCase());
    if (idx < 0 && latin.includes(a.toLowerCase())) idx = latin.indexOf(a.toLowerCase());
    if (idx < 0 || idx >= options.length) errors.push('ответ не совпадает ни с одним вариантом');
    answer = idx;
  } else if (answers.length && answers.every(looksNumeric)) {
    type = 'number';
  }

  return {
    ok: errors.length === 0,
    errors,
    task: {
      id: `u-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      subject,
      topic: topic?.id || null,
      topicName: topic ? null : topicName || null, // новая тема — создадим при сохранении
      type,
      q: d.q.trim(),
      ...(type === 'choice' ? { options, answer } : { answers }),
      ...(d.tolerance ? { tolerance: Math.abs(parseNumber(d.tolerance)) || 0 } : {}),
      explain: d.explain.trim(),
    },
  };
}

/* ---------- Карточки ---------- */

const SEPARATORS = ['::', '\t', ' | ', ' — ', ' – ', ' - '];

/** Текст → карточки { q, a }. Строка без разделителя — вопрос без ответа (сверишь с конспектом). */
export function parseCards(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\d+[.)]\s+/, ''); // «1. вопрос» → «вопрос»
    // формат «В: … / О: …» на двух строках
    const qm = /^(в|q|вопрос)\s*[:：]\s*(.+)$/i.exec(line);
    if (qm && i + 1 < lines.length) {
      const am = /^(о|a|ответ)\s*[:：]\s*(.+)$/i.exec(lines[i + 1]);
      if (am) {
        out.push({ q: qm[2].trim(), a: am[2].trim() });
        i += 1;
        continue;
      }
    }
    const sep = SEPARATORS.find((s) => line.includes(s));
    if (sep) {
      const at = line.indexOf(sep);
      const q = line.slice(0, at).trim();
      const a = line.slice(at + sep.length).trim();
      if (q) out.push({ q, a });
    } else {
      line = line.replace(/^[-•*]\s+/, '');
      if (line) out.push({ q: line, a: '' });
    }
  }
  return out;
}
