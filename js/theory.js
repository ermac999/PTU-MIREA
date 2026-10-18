/* =====================================================================
   Теория по темам лежит отдельно в data/theory.json — его собирает скрипт
   tools/build-theory.mjs из обычных текстовых файлов content/theory/<тема>.md.
   У каждой темы два текста: «кратко» (повторить перед контрольной) и
   «подробно» (разобраться с нуля).
   Разметка простая: ## заголовок, - списки, 1. нумерация, **жирный**, `код`,
   {формула}, > заметка, таблицы через |, блоки кода через ```.
   ===================================================================== */

import { esc } from './util.js';

export const theory = { data: {}, loaded: false, error: null };

export async function loadTheory() {
  if (globalThis.__RAMKI_THEORY__) {
    theory.data = globalThis.__RAMKI_THEORY__.topics || {};
    theory.loaded = true;
    return theory;
  }
  try {
    const res = await fetch('data/theory.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    theory.data = json && json.topics && typeof json.topics === 'object' ? json.topics : {};
  } catch {
    theory.error = 'Теория не загрузилась — нужен интернет при первом открытии.';
  }
  theory.loaded = true;
  return theory;
}

export const theoryOf = (topicId) => theory.data[topicId] || null;
export const hasTheory = (topicId) => !!(theory.data[topicId] && (theory.data[topicId].brief || theory.data[topicId].detailed));

/**
 * Какой текст открыть, если сам не выбирал: тему уже понял — «кратко» (повторить),
 * учишь и до контрольной ≤ 2 дней — тоже «кратко», иначе — «подробно» (разобраться).
 */
export function autoMode(status, daysToEvent) {
  if (status === 'understood' || status === 'reviewed') return 'brief';
  if (status === 'learning' && daysToEvent != null && daysToEvent <= 2) return 'brief';
  return 'detailed';
}

/* ---------- Разметка → безопасный HTML ---------- */

/** Внутри строки: `код`, **жирный**, {формула}. Всё остальное экранируется. */
function inline(s) {
  return String(s).split(/(`[^`]+`)/g).map((part, k) => {
    if (k % 2) return `<code>${esc(part.slice(1, -1))}</code>`;
    return esc(part).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\{([^{}]+)\}/g, '<span class="fm">$1</span>');
  }).join('');
}

const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export function renderMd(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (line.trim().startsWith('```')) { // блок кода
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { code.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre class="md-code"><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{2,3})\s+(.+)$/);
    if (h) { out.push(`<h3 class="md-h">${inline(h[2])}</h3>`); i += 1; continue; }

    if (/^\s*>/.test(line)) { // заметка
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      out.push(`<div class="md-note">${buf.map(inline).join('<br>')}</div>`);
      continue;
    }
    if (/^\s*\|/.test(line)) { // таблица: заголовок, разделитель, строки
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i += 1; }
      const head = cells(rows[0]);
      const body = rows.slice(/^\s*\|?\s*:?-{2,}/.test(rows[1] || '') ? 2 : 1).map(cells);
      out.push(`<div class="md-scroll"><table class="md-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*])\s+/.test(line)) { // маркированный список
      const buf = [];
      while (i < lines.length && /^\s*([-*])\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*[-*]\s+/, '')); i += 1; }
      out.push(`<ul class="md-ul">${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) { // нумерованный список
      const buf = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { buf.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i += 1; }
      out.push(`<ol class="md-ol">${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }
    const para = [line.trim()]; // первая строка — всегда в абзаце, иначе странная строка вроде «## » зациклила бы разбор
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*>|\s*\||\s*[-*]\s+|\s*\d+[.)]\s+|\s*```)/.test(lines[i])) { para.push(lines[i].trim()); i += 1; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
