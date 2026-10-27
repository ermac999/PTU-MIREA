// Тесты теории и модулей (игр). Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { CONFIG } from '../js/config.js';
import { autoMode, renderMd } from '../js/theory.js';
import { MODULES, modulesFor, seedModules, startedTopics } from '../js/modules.js';
import { allCards, buildQueue, deckList } from '../js/practice.js';
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
  for (let n = 1; n <= 8; n += 1) assert.ok(topics[`inf-p${n}`], `теория к практике ${n} по информатике`);
  for (let n = 1; n <= 6; n += 1) assert.ok(topics[`linal-p${n}`], `теория к практике ${n} по линалу`);
  assert.ok(/ненулевых/.test(topics['linal-p5'].detailed) && /Осторожно/.test(topics['linal-p3'].detailed), 'пометки об ошибках в тетради на месте');
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
    assert.ok(html.includes(`../../#spiral/${m.subject}`), 'из игры есть ссылка назад — в мир «Спирали»');
    assert.ok(html.includes(`'${m.storageKey}'`), 'игра хранит прогресс под тем ключом, который читают «Рамки»');
  }
  assert.deepEqual(modulesFor({ topic: 'phys-1' }).map((m) => m.id), ['kinematics']);
  assert.deepEqual(modulesFor({ subject: 'inf' }).map((m) => m.id), ['bits']);
  assert.deepEqual(modulesFor({ topic: 'inf-p6' }).map((m) => m.id), ['bits']);
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
  ev.topics = ['inf-p1', 'inf-p3'];
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
  assert.equal(first.topicIds[0], 'inf-p1', 'начинаем с первой темы');

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

test('бит за битом: прогресс по всей игре и по практике, уровни совпадают с игрой', () => {
  const m = MODULES.find((x) => x.id === 'bits');
  const html = readFileSync(file(m.href), 'utf8');
  const perWorld = {};
  for (const [, w] of html.matchAll(/\{ id: 'w(\d)(?:l\d+|b)'/g)) perWorld[w] = (perWorld[w] || 0) + 1;
  const seed = JSON.parse(readFileSync(file(m.seed), 'utf8'));
  assert.ok(!JSON.stringify(seed).includes('u_'), 'без идентификатора аккаунта');
  withStorage({ [m.storageKey]: JSON.stringify(seed) }, () => {
    for (let n = 1; n <= 8; n += 1) assert.equal(m.progress(`inf-p${n}`).total, perWorld[n], `модуль ${n}: уровней как в игре`);
    const all = m.progress();
    assert.deepEqual([all.stars, all.done, all.total, all.maxStars], [1, 1, 52, 156]);
    assert.equal(m.progress('inf-p1').label, 'модуль 1: 1/18 ★ · пройдено 1 из 6');
    assert.equal(m.progress('inf-p2').done, 0);
    const st = defaultState();
    assert.deepEqual(startedTopics(st).filter((id) => id.startsWith('inf')), ['inf-p1'], 'начата только первая практика');
  });
});

test('обновление до версии 10: темы информатики — 8 практик, ссылки на старые темы переезжают', () => {
  const v9 = defaultState();
  v9.version = 9;
  v9.settings.updateSeen = 7; // заметку версии 9 уже видел
  v9.topics = v9.topics.filter((t) => t.subject !== 'inf');
  const old = ['Системы счисления', 'Кодирование информации', 'Логические операции', 'Алгоритмы и программы']
    .map((name, i) => ({ id: `inf-${i + 1}`, subject: 'inf', name, status: 'new', note: '', example: true }));
  v9.topics.splice(10, 0, ...old);
  v9.events.find((e) => e.id === 'ev-inf-kr').topics = ['inf-1', 'inf-3'];
  v9.customTasks.push({ id: 'my1', subject: 'inf', topic: 'inf-2', type: 'number', q: '?', answers: ['1'] });
  const m = migrate(JSON.parse(JSON.stringify(v9)));
  const inf = m.topics.filter((t) => t.subject === 'inf');
  assert.deepEqual(inf.map((t) => t.id), ['inf-p1', 'inf-p2', 'inf-p3', 'inf-p4', 'inf-p5', 'inf-p6', 'inf-p7', 'inf-p8']);
  assert.ok(inf.every((t) => t.numLabel === 'практика' && !t.example));
  assert.deepEqual(m.events.find((e) => e.id === 'ev-inf-kr').topics, ['inf-p4'], 'системы счисления → практика 4, логика — убрана');
  assert.equal(m.customTasks.find((t) => t.id === 'my1').topic, 'inf-p2');
  assert.ok(m.settings.updateSeen < CONFIG.noteVersion, 'покажется заметка');

  // свою тему (с конспектом) не трогаем — практики встают рядом
  v9.topics.find((t) => t.id === 'inf-3').note = 'мой конспект';
  const m2 = migrate(JSON.parse(JSON.stringify(v9)));
  assert.ok(m2.topics.some((t) => t.id === 'inf-3' && t.note === 'мой конспект'));
  assert.equal(m2.topics.filter((t) => t.subject === 'inf').length, 9);
  assert.deepEqual(m2.events.find((e) => e.id === 'ev-inf-kr').topics, ['inf-p4', 'inf-3']);
});

test('обновление до версии 11: линал — 6 практик, КР завтра по практикам 1–5', () => {
  const v10 = defaultState();
  v10.version = 10;
  v10.settings.updateSeen = 8;
  v10.topics = v10.topics.filter((t) => t.subject !== 'linal');
  const old = ['Матрицы и действия с ними', 'Определители', 'Обратная матрица', 'СЛАУ: метод Гаусса и Крамера', 'Векторы и скалярное произведение', 'Прямая и плоскость']
    .map((name, i) => ({ id: `linal-${i + 1}`, subject: 'linal', name, status: 'new', note: '', example: true }));
  v10.topics.unshift(...old);
  delete v10.events.find((e) => e.id === 'ev-linal-kr').topics;
  v10.decks.push({ id: 'd1', name: 'мои', subject: 'linal', topicId: 'linal-4', cards: [] });
  const m = migrate(JSON.parse(JSON.stringify(v10)));
  assert.deepEqual(m.topics.filter((t) => t.subject === 'linal').map((t) => t.id), ['linal-p1', 'linal-p2', 'linal-p3', 'linal-p4', 'linal-p5', 'linal-p6']);
  assert.deepEqual(m.events.find((e) => e.id === 'ev-linal-kr').topics, ['linal-p1', 'linal-p2', 'linal-p3', 'linal-p4', 'linal-p5']);
  assert.equal(m.decks[0].topicId, 'linal-p3', 'СЛАУ (Крамер) → практика 3');
  assert.ok(m.settings.updateSeen < CONFIG.noteVersion);

  // темы КР уже отмечены сам — не трогаем (только переводим на новые id)
  v10.events.find((e) => e.id === 'ev-linal-kr').topics = ['linal-2'];
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(v10))).events.find((e) => e.id === 'ev-linal-kr').topics, ['linal-p2']);
});

test('карточки по практикам — своя колода предмета, примеры — отдельно', () => {
  const bank = JSON.parse(readFileSync(file('data/bank.json'), 'utf8'));
  const st = defaultState();
  const decks = deckList(bank, st);
  const lin = decks.find((d) => d.id === 'bank-linal');
  assert.ok(lin && lin.name === 'Линал: по твоим практикам' && !lin.example && lin.cards.length >= 20);
  assert.ok(decks.find((d) => d.id === 'ex-inf').example, 'примеры остаются примерами');
  assert.ok(allCards(bank, st).filter((c) => c.subject === 'linal').every((c) => !c.example));
});

test('отработка: новые задачи из практик идут раньше примеров', () => {
  const tasks = [{ id: 'e1', example: true }, { id: 'p1', from: 'Практика №1' }, { id: 'e2', example: true }, { id: 'p2', from: 'Практика №2' }];
  assert.deepEqual(buildQueue(tasks, {}, 0), ['p1', 'p2', 'e1', 'e2']);
  assert.deepEqual(buildQueue(tasks, { e2: { seen: 1, correct: 0, wrong: 1, streak: 0, due: 0 } }, 1), ['e2', 'p1', 'p2', 'e1'], 'ошибки, которым пора, — всё равно первыми');
});

test('зал: среда и суббота сразу после пар, воскресенье утром, остальные дни — без зала, сон не страдает', () => {
  const st = defaultState();
  const days = { '2026-10-26': 1, '2026-10-27': 2, '2026-10-28': 3, '2026-10-29': 4, '2026-10-30': 5, '2026-10-31': 6, '2026-11-01': 0 };
  const sim = simulate(st, '2026-10-26', 7 * 60, 7);
  const gym = (k) => sim.plans[k].fixed.find((f) => f.type === 'gym');
  for (const [k, wd] of Object.entries(days)) {
    if (wd === 0) {
      const g = gym(k);
      assert.ok(g, 'вс: зал утром');
      const info = sim.plans[k].info;
      assert.equal(g.start, info.wake + CONFIG.weekendMeals.breakfast, 'после завтрака');
      assert.ok(sim.plans[k].blocks.every((b) => b.start >= g.end || b.end <= g.start), 'вс: ничего не пересекается с залом');
      assert.ok(sim.plans[k].blocks.some((b) => b.type === 'meal' && b.title === 'Обед'), 'обед на месте');
    } else if (wd === 3 || wd === 6) {
      const g = gym(k);
      assert.ok(g, `${k}: зал есть`);
      assert.equal(g.end - g.start, CONFIG.gym.minutes);
      const info = sim.plans[k].info;
      assert.equal(g.start, info.home, 'сразу после прихода домой');
      assert.ok(info.bed - g.end >= CONFIG.gym.minEveningLeftMin, 'вечер после зала остаётся');
      assert.ok(sim.plans[k].blocks.every((b) => b.start >= g.end || b.end <= g.start), 'учёба не пересекается с залом');
      assert.ok(!sim.plans[k].blocks.some((b) => b.habit === 'sport'), 'зарядка в день зала не нужна');
    } else assert.ok(!gym(k), `${k}: без зала`);
  }
  // свои дни и «сегодня без зала»
  st.settings.gymDays = [1, 3];
  assert.ok(simulate(st, '2026-10-26', 7 * 60, 1).plans['2026-10-26'].fixed.some((f) => f.type === 'gym') === false, 'пн: вечер слишком короткий, зала нет');
  st.settings.gymDays = [3];
  st.dayOverrides['2026-10-28'] = { noGym: true };
  assert.ok(!simulate(st, '2026-10-26', 7 * 60, 3).plans['2026-10-28'].fixed.some((f) => f.type === 'gym'));
  st.settings.gym = false;
  st.dayOverrides = {};
  assert.ok(!simulate(st, '2026-10-26', 7 * 60, 3).plans['2026-10-28'].fixed.some((f) => f.type === 'gym'), 'зал выключен в настройках');
});

test('обновление до версии 12: зал появляется у старых данных, заметка покажется', () => {
  const v11 = defaultState();
  v11.version = 11;
  v11.settings.updateSeen = 9;
  delete v11.settings.gym;
  delete v11.settings.gymDays;
  const m = migrate(JSON.parse(JSON.stringify(v11)));
  assert.equal(m.settings.gym, true);
  assert.deepEqual(m.settings.gymDays, [3, 6, 0]);
  assert.ok(m.settings.updateSeen < CONFIG.noteVersion);
});

test('обновление до версии 13: у тех, кто зал не трогал (ср, сб), добавляется воскресенье; свои дни остаются', () => {
  const v12 = defaultState();
  v12.version = 12;
  v12.settings.gymDays = [3, 6];
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(v12))).settings.gymDays, [3, 6, 0]);
  v12.settings.gymDays = [2, 6];
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(v12))).settings.gymDays, [2, 6], 'свои дни не трогаем');
});

test('зал в воскресенье: учебное воскресенье — зал утром, учёба после обеда, план недели после зала', () => {
  const st = defaultState();
  const sim = simulate(st, '2026-10-25', 7 * 60, 1);
  const p = sim.plans['2026-10-25'];
  const g = p.fixed.find((f) => f.type === 'gym');
  const plan = p.blocks.find((b) => b.type === 'plan');
  assert.ok(g && plan && plan.start >= g.end, 'план недели не наезжает на зал');
  const st2 = defaultState();
  st2.settings.sundayExtra = true;
  const p2 = simulate(st2, '2026-10-25', 7 * 60, 1).plans['2026-10-25'];
  const g2 = p2.fixed.find((f) => f.type === 'gym');
  assert.ok(p2.blocks.filter((b) => b.type === 'study').length >= 1);
  assert.ok(p2.blocks.every((b) => b.start >= g2.end || b.end <= g2.start), 'учёба не пересекается с залом');
});

test('главная: артефакты разложены по разделам, ссылки на claude.ai, без дублей с перенесёнными играми', async () => {
  const { ARTIFACTS, artifactsIn } = await import('../js/portal.js');
  const ids = new Set();
  for (const a of ARTIFACTS) {
    assert.ok(!ids.has(a.id), a.id);
    ids.add(a.id);
    assert.equal(a.area, 'project', a.id);
    assert.match(a.url, /^https:\/\/claude\.ai\/artifact\/[A-Za-z0-9]+$/);
    assert.ok(!MODULES.some((m) => m.title === a.title), `${a.title} уже перенесён в предметы`);
  }
  assert.deepEqual(artifactsIn('chess'), [], 'шахматы перенесены на сайт — ссылки на Claude больше нет');
  const sw = readFileSync(file('sw.js'), 'utf8');
  for (const f of ['js/portal.js', 'js/views/home.js']) assert.ok(sw.includes(`'${f}'`), `${f} в кэше`);
});

test('шахматы на сайте: страница, своя chess.js, база чемпионов, прогресс из Claude; вид: 16 досок, 10 наборов фигур, эффекты, звуки', async () => {
  const { SITE_APPS } = await import('../js/portal.js');
  const app = SITE_APPS.find((a) => a.id === 'chess');
  assert.equal(app.href, 'modules/chess/index.html');
  const html = readFileSync(file(app.href), 'utf8');
  assert.ok(html.includes('href="../../#fun"'), 'из шахмат — назад в «Развлечения»');
  assert.ok(html.includes('<script src="chess.min.js"></script>'), 'chess.js своя, без CDN');
  for (const st of ['spiral', 'club', 'neon']) assert.ok(html.includes(`:root[data-style="${st}"]`), `стиль ${st}`);
  const boards = [...html.matchAll(/:root\[data-board="([a-z]+)"\] \.board,\.lk-b\[data-b="\1"\]\{--sq-l/g)].map((m) => m[1]);
  assert.equal(new Set(boards).size, 16, 'шестнадцать досок');
  const sets = new Set([...html.matchAll(/:root\[data-pieces="([a-z]+)"\] \.board /g)].map((m) => m[1]));
  for (const id of ['gold', 'marble', 'glass', 'neon', 'wood', 'gloss', 'modern', 'pixel', 'letters']) assert.ok(sets.has(id), `набор фигур ${id}`);
  const PIECES = JSON.parse(html.match(/const PIECE_SETS = (\[.*?\]);/)[1]);
  assert.equal(PIECES.length, 10, 'десять наборов фигур в окне «Вид»');
  assert.ok(PIECES.every(([id]) => id === 'classic' || sets.has(id)), 'у каждого набора есть стили');
  assert.ok(html.includes('<span class="pc ${p.color} t-${p.type}">'), 'фигура знает свой тип — для рисованных наборов');
  assert.ok(html.includes("if (!o.silent && typeof moveFx === 'function') moveFx(this, mv, dragged);"), 'эффект хода — из Board.set');
  for (const fx of ['ripple', 'sparks', 'comet', 'flash', 'shatter', 'fire', 'stars']) assert.ok(html.includes(`  ${fx}(e, m) {`), `эффект ${fx}`);
  for (const snd of ['stone', 'glass', 'soft', 'retro', 'space', 'arena']) assert.ok(html.includes(`  ${snd}: {\n    move(c, t)`), `звук ${snd}`);
  assert.ok(html.includes("r.dataset.pieces=l.pieces||'classic'"), 'набор фигур ставится до отрисовки');
  // «Любой ход»: популярные ходы соперника до 8-го хода по моим четырём дебютам (партии Lichess + Stockfish)
  const POPD = JSON.parse(html.match(/<script>const POP_DATA = (\{.*?\});<\/script>/)[1]);
  for (const id of ['london', 'italian']) assert.ok(POPD[id], `дерево для ${id}`);
  for (const [id, p] of Object.entries(POPD)) {
    let depth = 0, n = 0;
    const walk = (rows, d) => rows.forEach((r) => { n += 1; depth = Math.max(depth, d); assert.equal(r.length, 8, `${id}: строка дерева`); walk(r[7], d + 1); });
    walk(p.rows, 1);
    assert.ok(depth >= 7, `${id}: соперник ходит до 7–8-го хода (сейчас ${depth})`);
    assert.ok(n >= 150, `${id}: популярных позиций много (сейчас ${n})`);
  }
  assert.ok(html.includes("if (AT.mode === 'pop') return popRound();"), 'тренировка «как угодно» — партия по дереву до 8-го хода');
  assert.ok(html.includes('function favAliases(k)'), 'избранное общее для «Тренировки» и «Все дебюты»');
  // разбор партии как на chess.com: типы ходов, переход к ним, «зачем этот ход»
  assert.ok(html.includes('try { revClassify(plies, fens, moves, an); }'), 'разбор размечает каждый ход');
  for (const c of ['Блестящий', 'Замечательный', 'Лучший', 'Отличный', 'Хороший', 'Книжный', 'Неточность', 'Упущено', 'Ошибка', 'Зевок']) assert.ok(html.includes(`['${c}', `), `тип хода «${c}»`);
  assert.ok(html.includes('ACT.revCat = d =>'), 'нажатие на число — к ходам этого типа');
  assert.ok(html.includes("if (ENG.next && route.v === 'live' && !REV)"), 'разбор не зависает, когда догружается Stockfish');
  const pros = [...html.matchAll(/fetch\('pro\/' \+ id \+ '\.json'\)/g)];
  assert.equal(pros.length, 1);
  const seed = JSON.parse(readFileSync(file('modules/chess/seed.json'), 'utf8'));
  assert.ok(Array.isArray(seed.games) && seed.games.every((g) => g.id), 'партии из Claude с id');
  assert.ok(Array.isArray(seed.myPuz), 'задачи из ошибок');
  const sw = readFileSync(file('sw.js'), 'utf8');
  for (const f of ['modules/chess/index.html', 'modules/chess/seed.json', 'modules/chess/chess.min.js']) assert.ok(sw.includes(`'${f}'`), `${f} в кэше`);
});

test('«Спираль»: миры — предметы, игры физики и информатики внутри, история пока пустая', async () => {
  const { WORLDS, gamesOf, worldProgress, gameTotals } = await import('../js/game.js');
  const subjects = new Set(defaultState().subjects.map((s) => s.id));
  for (const w of WORLDS) assert.ok(subjects.has(w.subject), w.id);
  assert.ok(!WORLDS.some((w) => w.subject === 'de'), 'немецкий — без мира');
  assert.deepEqual(gamesOf(WORLDS.find((w) => w.id === 'phys')).map((m) => m.id), ['kinematics']);
  assert.deepEqual(gamesOf(WORLDS.find((w) => w.id === 'inf')).map((m) => m.id), ['bits']);
  assert.equal(worldProgress(WORLDS.find((w) => w.id === 'hist')), null, 'история — мир строится');
  const kin = JSON.parse(readFileSync(file('modules/kinematics/seed.json'), 'utf8'));
  const bits = JSON.parse(readFileSync(file('modules/bits/seed.json'), 'utf8'));
  withStorage({ 'kin-zachet-v1': JSON.stringify(kin), 'bzb.progress.v1': JSON.stringify(bits) }, () => {
    const t = gameTotals();
    assert.equal(t.stars, 26);
    assert.equal(t.maxStars, 48 + 156);
    assert.equal(t.rank, 'Ученик');
  });
});

test('«Подход» на сайте: своё хранилище вместо облака Claude, шрифт рядом, данные из Claude в seed, ссылка из зала', async () => {
  const { SITE_APPS, appsIn, ARTIFACTS } = await import('../js/portal.js');
  const app = SITE_APPS.find((a) => a.id === 'podhod');
  assert.equal(app.area, 'project');
  assert.equal(app.href, 'modules/podhod/index.html');
  assert.ok(!ARTIFACTS.some((a) => a.id === 'podhod'), 'ссылка на артефакт убрана — приложение внутри сайта');
  assert.deepEqual(appsIn('project').map((a) => a.id), ['podhod']);
  const html = readFileSync(file(app.href), 'utf8');
  assert.ok(html.includes('href="../../#projects"'), 'из «Подхода» — назад в «Проекты»');
  assert.ok(!/TelegramAdapter|ClaudeAdapter/.test(html), 'нет входа через Telegram и облако Claude');
  assert.ok(html.includes('const ADAPTERS = [LocalAdapter];'), 'данные — в памяти устройства');
  assert.ok(!html.includes('fonts.googleapis.com'), 'шрифт свой, без интернета');
  for (const f of ['onest-cyrillic', 'onest-latin']) assert.ok(existsSync(file(`modules/podhod/fonts/${f}.woff2`)), f);
  const seed = JSON.parse(readFileSync(file('modules/podhod/seed.json'), 'utf8'));
  assert.equal(seed.profile.mode, 4);
  assert.equal(seed.profile.height, 183, 'рост — как сказал сам, а не значение по умолчанию');
  assert.deepEqual(Object.keys(seed.plans).sort(), ['3', '4']);
  assert.ok(Array.isArray(seed.body) && seed.body[0].w === 68);
  const sw = readFileSync(file('sw.js'), 'utf8');
  for (const f of ['modules/podhod/index.html', 'modules/podhod/seed.json', 'modules/podhod/fonts/onest-cyrillic.woff2', 'modules/podhod/fonts/onest-latin.woff2']) assert.ok(sw.includes(`'${f}'`), `${f} в кэше`);
  const shared = readFileSync(file('js/views/shared.js'), 'utf8');
  assert.ok(shared.includes("b.type === 'gym'") && shared.includes('modules/podhod/index.html'), 'в блоке зала есть ссылка на «Подход»');
});

test('iPad: колонка шире, меню плавающее и боковое, шторка окном, экраны в две колонки; игры подстроены под планшет', () => {
  const css = readFileSync(file('css/app.css'), 'utf8');
  for (const q of ['(min-width: 700px)', '(min-width: 800px)', '(min-width: 1024px)']) assert.ok(css.includes(`@media ${q}`), `брейкпоинт ${q}`);
  assert.ok(/--rail-w: calc\(108px/.test(css), 'боковая полоса меню от 1024');
  assert.ok(css.includes('.list.cards') && css.includes('.cols') && css.includes('.cards-grid'), 'сетки и колонки');
  assert.ok(css.includes('height: fit-content'), 'шторка на планшете — окно по центру');
  for (const f of ['today', 'calendar', 'day', 'settings', 'topics']) {
    assert.ok(readFileSync(file(`js/views/${f}.js`), 'utf8').includes('class="cols"'), `${f}: две колонки`);
  }
  assert.ok(readFileSync(file('js/app.js'), 'utf8').includes('view.dataset.route'), 'экран помечен маршрутом для вёрстки');
  for (const [f, mark] of [['kinematics', 'mapcols'], ['bits', 'font-size: 17.5px'], ['podhod', 'in-session'], ['chess', 'min-width:881px) and (max-width:1099px']]) {
    assert.ok(readFileSync(file(`modules/${f}/index.html`), 'utf8').includes(mark), `${f}: планшетная вёрстка`);
  }
  const manifest = JSON.parse(readFileSync(file('manifest.webmanifest'), 'utf8'));
  assert.ok(!manifest.orientation, 'ориентацию не фиксируем: iPad крутят');
});
