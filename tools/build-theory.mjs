// Сборка data/theory.json из текстовых файлов content/theory/<id-темы>.md.
// В файле два раздела: «=== brief ===» (кратко) и «=== detailed ===» (подробно).
// Запуск: npm run build:theory        — пересобрать data/theory.json
//         npm run build:theory -- --check — только проверить, что файл актуален (для тестов и CI)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defaultTopics } from '../js/store.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECTION = /^===\s*(brief|detailed)\s*===\s*$/;

/** Разобрать один файл темы. Бросает понятную ошибку, если разметка не та. */
export function parseTheoryFile(name, text) {
  const out = { brief: '', detailed: '' };
  let cur = null;
  const buf = { brief: [], detailed: [] };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const m = line.match(SECTION);
    if (m) { cur = m[1]; continue; }
    if (cur) buf[cur].push(line);
    else if (line.trim()) throw new Error(`${name}: текст до первого «=== brief ===» или «=== detailed ===»`);
  }
  for (const k of ['brief', 'detailed']) {
    out[k] = buf[k].join('\n').trim();
    if (!out[k]) throw new Error(`${name}: нет раздела «${k === 'brief' ? 'кратко' : 'подробно'}» (=== ${k} ===)`);
  }
  return out;
}

/** Собрать весь файл теории; проверяет, что id тем существуют. */
export function buildTheory(dir = join(root, 'content/theory')) {
  const known = new Set(defaultTopics().map((t) => t.id));
  const topics = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    const id = file.slice(0, -3);
    if (!known.has(id)) throw new Error(`${file}: темы «${id}» нет в js/config.js (DEFAULT_DATA.topics)`);
    topics[id] = parseTheoryFile(file, readFileSync(join(dir, file), 'utf8'));
  }
  return `${JSON.stringify({ version: 1, topics }, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = join(root, 'data/theory.json');
  const next = buildTheory();
  if (process.argv.includes('--check')) {
    const now = (() => { try { return readFileSync(target, 'utf8'); } catch { return ''; } })();
    if (now !== next) {
      console.error('data/theory.json устарел: запусти npm run build:theory');
      process.exit(1);
    }
    console.log('data/theory.json актуален');
  } else {
    writeFileSync(target, next);
    console.log(`Теория: тем — ${Object.keys(JSON.parse(next).topics).length} → data/theory.json`);
  }
}
