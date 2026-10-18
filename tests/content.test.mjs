// Тесты теории и модулей (игр). Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { CONFIG } from '../js/config.js';
import { autoMode, renderMd } from '../js/theory.js';
import { MODULES, modulesFor, seedModules, startedTopics } from '../js/modules.js';
import { buildTheory, parseTheoryFile } from '../tools/build-theory.mjs';
import { defaultState, defaultTopics, migrate } from '../js/store.js';
import { recordDone, simulate, undoRecord } from '../js/planner.js';

const TODAY = '2026-10-17'; // суббота
const file = (p) => new URL(`../${p}`, import.meta.url);

/** Подменить localStorage на время теста. */
function withStorage(init, fn) {
  const mem = new Map(Object.entries(init));
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  const done = () => { globalThis.localStorage = prev; };
  try {
    const r = fn(mem);
    if (r && typeof r.then === 'function') return r.finally(done);
    done();
    return r;
  } catch (e) {
    done();
    throw e;
  }
}

/* ---------- разметка теории ---------- */

test('разметка: HTML экранируется, жирный, код и формулы', () => {
  const html = renderMd('Текст <script>alert(1)</script> и **жирный**, `a < b **не жирный**`, {v = s/t}.');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<b>жирный</b>'));
  assert.ok(html.includes('<code>a &lt; b **не жирный**</code>'), 'внутри `кода` разметка не работает');
  assert.ok(html.includes('<span class="fm">v = s/t</span>'));
});

test('разметка: заголовки, списки, заметки, таблицы, код', () => {
  const html = renderMd([
    '## Заголовок', '', '- раз', '- два', '', '1. первый', '2. второй', '',
    '> заметка', '> вторая строка', '', '| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |', '',
    '```', 'x = 1 < 2', '```', 'абзац', 'продолжение абзаца',
  ].join('\n'));
  assert.ok(html.includes('<h3 class="md-h">Заголовок</h3>'));
  assert.ok(html.includes('<ul class="md-ul"><li>раз</li><li>два</li></ul>'));
  assert.ok(html.includes('<ol class="md-ol"><li>первый</li><li>второй</li></ol>'));
  assert.ok(html.includes('<div class="md-note">заметка<br>вторая строка</div>'));
  assert.ok(html.includes('<thead><tr><th>A</th><th>B</th></tr></thead>'));
  assert.equal((html.match(/<tr>/g) || []).length, 3, 'строка-разделитель не попадает в таблицу');
  assert.ok(html.includes('<pre class="md-code"><code>x = 1 &lt; 2</code></pre>'));
  assert.ok(html.includes('<p>абзац продолжение абзаца</p>'));
});

test('разметка: странные строки не зацикливают разбор', () => {
  for (const src of ['## ', '#', '|', '```', '>', '-', '1.', '', null, undefined]) assert.equal(typeof renderMd(src), 'string');
});

test('кратко или подробно: по статусу темы и близости контрольной', () => {
  assert.equal(autoMode('new', null), 'detailed');
  assert.equal(autoMode('learning', 5), 'detailed');
  assert.equal(autoMode('learning', null), 'detailed');
  assert.equal(autoMode('learning', 2), 'brief', 'контрольная через 2 дня — повторить кратко');
  assert.equal(autoMode('understood', 30), 'brief');
  assert.equal(autoMode('reviewed', null), 'brief');
});

/* ---------- файлы теории ---------- */

test('data/theory.json собран из content/theory и актуален', () => {
  const built = buildTheory();
  assert.equal(readFileSync(file('data/theory.json'), 'utf8'), built, 'запусти npm run build:theory');
  const { topics } = JSON.parse(built);
  const known = new Set(defaultTopics().map((t) => t.id));
  assert.ok(Object.keys(topics).length >= 3);
  for (const [id, t] of Object.entries(topics)) {
    assert.ok(known.has(id), id);
    assert.ok(t.brief.length > 200 && t.detailed.length > t.brief.length, `${id}: «подробно» длиннее «кратко»`);
  }
  assert.ok(topics['phys-1'], 'теория по кинематике есть');
});

test('файл теории: понятные ошибки разметки', () => {
  assert.deepEqual(parseTheoryFile('a.md', '=== brief ===\nкратко\n=== detailed ===\nподробно\n'), { brief: 'кратко', detailed: 'подробно' });
  assert.throws(() => parseTheoryFile('a.md', 'текст без разделов'), /до первого/);
  assert.throws(() => parseTheoryFile('a.md', '=== brief ===\nкратко\n'), /подробно/);
  assert.throws(() => parseTheoryFile('a.md', '=== detailed ===\nподробно\n'), /кратко/);
});

/* ---------- модули ---------- */

test('модули: файлы на месте, предмет и темы существуют', () => {
  const subjects = new Set(defaultState().subjects.map((s) => s.id));
  const topics = new Set(defaultTopics().map((t) => t.id));
  const sw = readFileSync(file('sw.js'), 'utf8');
  for (const m of MODULES) {
    assert.ok(existsSync(file(m.href)), m.href);
    assert.ok(subjects.has(m.subject), m.subject);
    for (const t of m.topics) assert.ok(topics.has(t), t);
    assert.ok(sw.includes(`'${m.href}'`), `${m.href} — в кэше для офлайна`);
    if (m.seed) {
      assert.ok(existsSync(file(m.seed)), m.seed);
      assert.ok(sw.includes(`'${m.seed}'`), `${m.seed} — в кэше для офлайна`);
    }
    const html = readFileSync(file(m.href), 'utf8');
    assert.ok(html.includes(`../../#subject/${m.subject}`), 'из игры есть ссылка назад в «Рамки» — на страницу предмета');
    assert.ok(html.includes(`'${m.storageKey}'`), 'игра хранит прогресс под тем ключом, который читают «Рамки»');
  }
  assert.deepEqual(modulesFor({ topic: 'phys-1' }).map((m) => m.id), ['kinematics']);
  assert.deepEqual(modulesFor({ subject: 'inf' }), []);
});

test('кинематика: перенесённый прогресс — 25 звёзд, пройдено 11 уровней', () => {
  const seed = JSON.parse(readFileSync(file('modules/kinematics/seed.json'), 'utf8'));
  assert.equal(seed.v, 1);
  assert.ok(!('uid' in seed), 'без чужих идентификаторов');
  const m = MODULES.find((x) => x.id === 'kinematics');
  withStorage({ [m.storageKey]: JSON.stringify(seed) }, () => {
    const p = m.progress();
    assert.deepEqual([p.stars, p.maxStars, p.done, p.total], [25, 48, 11, 16]);
    assert.equal(p.label, '25/48 ★ · пройдено 11 из 16');
  });
  withStorage({ [m.storageKey]: JSON.stringify(seed) }, () => {
    const st = defaultState();
    assert.deepEqual(startedTopics(st), ['phys-1'], 'игра начата — «Кинематику» пора отметить «учу»');
    st.topics.find((t) => t.id === 'phys-1').status = 'understood';
    assert.deepEqual(startedTopics(st), [], 'свой статус не понижаем');
  });
  withStorage({}, () => {
    assert.equal(m.progress().stars, 0, 'игру ещё не открывали — ноль, без ошибок');
    assert.deepEqual(startedTopics(defaultState()), []);
  });
  withStorage({ [m.storageKey]: '{битый json' }, () => assert.equal(m.progress().stars, 0));
});

test('перенос прогресса: кладётся, только если игру на устройстве ещё не открывали', async () => {
  const seed = readFileSync(file('modules/kinematics/seed.json'), 'utf8');
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(file(String(url)), 'utf8')) });
  try {
    await withStorage({}, async (mem) => {
      await seedModules();
      assert.deepEqual(JSON.parse(mem.get('kin-zachet-v1')), JSON.parse(seed));
    });
    const mine = JSON.stringify({ v: 1, levels: { l1: { stars: 3 } } });
    await withStorage({ 'kin-zachet-v1': mine }, async (mem) => {
      await seedModules();
      assert.equal(mem.get('kin-zachet-v1'), mine, 'свой прогресс не затирается');
    });
  } finally {
    globalThis.fetch = prevFetch;
  }
});

/* ---------- темы контрольной в плане ---------- */

test('темы контрольной: блоки подготовки идут по ним по порядку, «готово» отмечает пройденные', () => {
  const st = defaultState();
  const ev = st.events.find((e) => e.id === 'ev-inf-kr');
  ev.topics = ['inf-1', 'inf-3'];
  const blocks = (s) => Object.entries(simulate(s, TODAY, 7 * 60, 7).plans)
    .flatMap(([k, p]) => p.blocks.filter((b) => b.eventId === 'ev-inf-kr').map((b) => ({ ...b, key: k })));
  const all = blocks(st);
  assert.ok(all.length, 'подготовка к КР в плане есть');
  for (const b of all) {
    assert.ok(b.topicIds?.length, `${b.key}: у блока есть темы`);
    for (const id of b.topicIds) assert.ok(ev.topics.includes(id));
    assert.equal(b.topicId, b.topicIds[0]);
  }
  const first = all.find((b) => b.kind === 'heavy') || all[0];
  assert.equal(first.topicIds[0], 'inf-1', 'начинаем с первой темы');

  // отметили блок — темы пройдены, статус «не начал» → «учу»; отмена возвращает как было
  assert.ok(recordDone(st, first.key, first));
  const rec = st.done[first.key][first.id];
  assert.deepEqual(rec.topics, first.topicIds);
  assert.equal(rec.kind, first.kind);
  for (const id of first.topicIds) assert.equal(st.topics.find((t) => t.id === id).status, 'learning');
  undoRecord(st, first.key, first.id);
  for (const id of first.topicIds) assert.equal(st.topics.find((t) => t.id === id).status, 'new');
  assert.ok(CONFIG.dataVersion >= 8);
});

test('обновление до версии 9: «Кинематика» — настоящая тема, заметка «что нового» покажется', () => {
  const v8 = defaultState();
  v8.version = 8;
  v8.settings.updateSeen = 6;
  v8.topics.find((t) => t.id === 'phys-1').example = true; // как было в версии 8
  const m = migrate(JSON.parse(JSON.stringify(v8)));
  assert.equal(m.topics.find((t) => t.id === 'phys-1').example, false);
  assert.equal(m.settings.updateSeen, 6);
  assert.ok(CONFIG.noteVersion > m.settings.updateSeen, 'покажется заметка про теорию и игры');
  v8.topics.find((t) => t.id === 'phys-1').name = 'Кинематика точки';
  assert.equal(migrate(JSON.parse(JSON.stringify(v8))).topics.find((t) => t.id === 'phys-1').example, true, 'свою правку не трогаем');
  const fresh = defaultState().topics.filter((t) => t.subject === 'phys');
  assert.deepEqual(fresh.map((t) => t.id), ['phys-1', 'phys-2', 'phys-3', 'phys-4', 'phys-5'], 'id тем физики прежние');
  assert.deepEqual(fresh.map((t) => t.example), [false, true, true, true, true]);
});
