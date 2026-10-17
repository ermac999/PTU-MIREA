// Тесты чистой логики. Запуск: npm test (или node --test tests/*.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONFIG } from '../js/config.js';
import { addDays, fmtDur, fmtTime, mondayOf, plural, relDays, toMin, weekdayOf } from '../js/util.js';
import { baseTimes, classesOn, dayInfo } from '../js/schedule.js';
import { buildTodayPlan, netFor, simulate, wallFor, eventNeedMin, streakInfo } from '../js/planner.js';
import { buildQueue, checkAnswer, gradeCard, nextTopicStatus, normalize, parseNumber, requeue } from '../js/practice.js';
import { parseCards, parseDeadlines, parseTasks } from '../js/parse.js';
import { buildIcs, fold } from '../js/ics.js';
import { defaultState, migrate, parseBackup } from '../js/store.js';

const TODAY = '2026-10-17'; // суббота
const bank = JSON.parse(readFileSync(new URL('../data/bank.json', import.meta.url), 'utf8'));

/* ---------- util ---------- */

test('время и даты', () => {
  assert.equal(toMin('05:00'), 300);
  assert.equal(toMin(''), null);
  assert.equal(fmtTime(1440), '00:00');
  assert.equal(fmtTime(1470), '00:30');
  assert.equal(fmtDur(135), '2 ч 15 мин');
  assert.equal(fmtDur(45), '45 мин');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdayOf(TODAY), 6);
  assert.equal(mondayOf(TODAY), '2026-10-12');
  assert.equal(mondayOf('2026-10-18'), '2026-10-12');
  assert.equal(plural(1, 'день', 'дня', 'дней'), 'день');
  assert.equal(plural(3, 'день', 'дня', 'дней'), 'дня');
  assert.equal(plural(11, 'день', 'дня', 'дней'), 'дней');
  assert.equal(relDays(TODAY, '2026-10-19'), 'послезавтра');
});

/* ---------- расписание ---------- */

test('вторник: «Введение» и лекция по информатике чередуются, лаба — раз в 4 недели', () => {
  const st = defaultState();
  const subj = (k) => classesOn(st, k).map((c) => `${c.subject}:${c.kind}`);
  assert.deepEqual(subj('2026-10-13'), ['matan:lecture', 'intro:lecture']);
  assert.deepEqual(subj('2026-10-20'), ['matan:lecture', 'inf:lecture', 'phys:lab', 'phys:lab']);
  assert.deepEqual(subj('2026-10-27'), ['matan:lecture', 'intro:lecture']);
  assert.deepEqual(subj('2026-11-03'), ['matan:lecture', 'inf:lecture']);
  assert.ok(subj('2026-11-17').includes('phys:lab'));
  assert.ok(subj('2026-12-15').includes('phys:lab'));
  assert.ok(!subj('2026-11-10').includes('phys:lab'));
  assert.equal(classesOn(st, '2026-10-18').length, 0); // воскресенье
});

test('в день лабы возвращаюсь домой позже на ту же разницу', () => {
  const st = defaultState();
  const b = baseTimes(st, '2026-10-20');
  assert.equal(fmtTime(b.classEnd), '15:50');
  assert.equal(fmtTime(b.home), '19:10');
  assert.equal(fmtTime(baseTimes(st, '2026-10-27').home), '15:30');
});

test('сон: минимум 7 ч, исключение пятницы — 6 ч, без исключения — честное предупреждение', () => {
  const st = defaultState();
  for (let d = 0; d < 28; d++) {
    const k = addDays(TODAY, d);
    const info = dayInfo(st, k);
    assert.ok(info.nightMin >= info.minSleep, `${k}: ночь ${info.nightMin} < ${info.minSleep}`);
  }
  const fri = dayInfo(st, '2026-10-23');
  assert.equal(fri.nightMin, 360);
  assert.ok(fri.isException);
  st.settings.fridayException = false;
  const fri2 = dayInfo(st, '2026-10-23');
  assert.ok(fri2.sleepShort, 'без исключения ночь не дотягивает до 7 ч — это видно');
  assert.equal(dayInfo(defaultState(), '2026-10-24').prevNight, 360);
});

test('правка отбоя позже допустимого — отбой сдвигается, чтобы сон был не меньше минимума', () => {
  const st = defaultState();
  st.dayOverrides['2026-10-19'] = { sleep: '23:30' }; // понедельник, во вторник подъём в 05:00
  const info = dayInfo(st, '2026-10-19');
  assert.equal(fmtTime(info.bed), '22:00');
  assert.ok(info.notes.some((n) => n.kind === 'bedEarlier'));
});

/* ---------- планировщик ---------- */

const TYPES_GREY = new Set(['sleep', 'morning', 'commute', 'class', 'break', 'meal', 'transfer']);

test('план на 3 недели: сон не трогаем, игра до отбоя −30 мин, максимум 3 задачи, без наложений', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 21);
  for (const [key, plan] of Object.entries(sim.plans)) {
    const { info } = plan;
    const study = plan.blocks.filter((b) => b.type === 'study');
    assert.ok(study.length <= CONFIG.maxTasksPerDay, `${key}: задач ${study.length}`);
    for (const b of plan.blocks) {
      assert.ok(b.end > b.start, `${key}: пустой блок ${b.type}`);
      assert.ok(b.end <= info.bed, `${key}: ${b.type} ${fmtTime(b.start)}–${fmtTime(b.end)} заходит за отбой ${fmtTime(info.bed)}`);
      assert.ok(b.start >= info.wake, `${key}: ${b.type} раньше подъёма`);
      for (const f of plan.fixed) {
        if (!TYPES_GREY.has(f.type)) continue;
        const overlap = Math.min(b.end, f.end) - Math.max(b.start, f.start);
        assert.ok(overlap <= 0, `${key}: ${b.type} ${fmtTime(b.start)} пересекается с ${f.type} ${fmtTime(f.start)}`);
      }
    }
    const sorted = [...plan.blocks].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].start >= sorted[i - 1].end, `${key}: блоки накладываются (${sorted[i - 1].type} и ${sorted[i].type})`);
    }
    for (const g of plan.blocks.filter((b) => b.type === 'game')) {
      assert.ok(g.end <= info.bed - CONFIG.game.endBeforeSleepMin, `${key}: игра заходит на время перед сном`);
    }
    if (info.isException) {
      assert.ok(!plan.blocks.some((b) => b.type === 'game' || (b.type === 'study' && b.place === 'home')), `${key}: в короткую ночь без учёбы дома и игр`);
    }
  }
});

test('в электричке — только лёгкие задачи, дома первым идёт тяжёлое', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 14);
  for (const plan of Object.values(sim.plans)) {
    for (const b of plan.blocks.filter((x) => x.type === 'study' && x.place === 'train')) assert.equal(b.kind, 'light');
  }
  const sat = sim.plans[TODAY].blocks.filter((b) => b.type === 'study' && b.place === 'home');
  assert.equal(sat[0].kind, 'heavy');
  assert.equal(sat[0].eventId, 'ev-linal-kr', 'суббота — сначала КР по линалу в понедельник');
});

test('нехватка времени видна, варианты сокращения — без урезания сна', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 21);
  assert.ok(sim.shortages.length > 0, 'неделя 19–22.10 плотная — должна быть нехватка');
  for (const s of sim.shortages) {
    assert.ok(s.options.length > 0);
    assert.ok(s.options.every((o) => ['shrink', 'nogame', 'sunday', 'morning', 'pause'].includes(o.kind)));
  }
  // «Сократить до минимума» действительно уменьшает потребность
  const ev = st.events.find((e) => e.id === sim.shortages[0].eventId);
  const shrink = sim.shortages[0].options.find((o) => o.kind === 'shrink');
  ev.prepMin = shrink.to;
  assert.equal(eventNeedMin(st, ev), shrink.to);
});

test('«не успел»: блок остаётся отмеченным, его задача снова в плане', () => {
  const st = defaultState();
  st.plans[TODAY] = buildTodayPlan(st, TODAY, 7 * 60);
  const first = st.plans[TODAY].blocks.find((b) => b.type === 'study');
  assert.ok(first);
  st.done[TODAY] = { [first.id]: { status: 'skipped', min: first.min, itemKey: first.itemKey, type: 'study', at: 1 } };
  const now = first.end; // нажал после блока
  st.plans[TODAY] = buildTodayPlan(st, TODAY, now);
  const blocks = st.plans[TODAY].blocks;
  assert.ok(blocks.some((b) => b.id === first.id), 'пропущенный блок остаётся в истории дня');
  const again = blocks.filter((b) => b.type === 'study' && b.itemKey === first.itemKey && b.id !== first.id);
  const later = Object.values(simulate(st, TODAY, now, 3).plans).flatMap((p) => p.blocks).filter((b) => b.itemKey === first.itemKey && b.id !== first.id);
  assert.ok(again.length || later.length, 'задача перенесена на сегодня или ближайшие дни');
});

test('помидоры 25/5', () => {
  assert.equal(wallFor(25), 25);
  assert.equal(wallFor(50), 55);
  assert.equal(wallFor(100), 115);
  assert.equal(netFor(55), 50);
  assert.ok(wallFor(netFor(83)) <= 83);
});

test('серия: день засчитывается, если сделан хотя бы один блок', () => {
  const st = defaultState();
  st.done['2026-10-15'] = { a: { status: 'done', type: 'study' } };
  st.done['2026-10-16'] = { b: { status: 'done', type: 'habit' } };
  assert.equal(streakInfo(st, TODAY).streak, 2); // сегодня ещё не сделано — серия до вчера
  st.done[TODAY] = { c: { status: 'done', type: 'game' } };
  assert.equal(streakInfo(st, TODAY).streak, 2, 'игра не засчитывается');
  st.done[TODAY].d = { status: 'done', type: 'review' };
  assert.equal(streakInfo(st, TODAY).streak, 3);
});

/* ---------- отработка ---------- */

test('проверка ответов', () => {
  const num = { type: 'number', answers: ['0.25', '1/4'] };
  assert.ok(checkAnswer(num, '0,25').ok);
  assert.ok(checkAnswer(num, '1/4').ok);
  assert.ok(!checkAnswer(num, '0.3').ok);
  assert.ok(checkAnswer({ type: 'number', answers: ['6'] }, '6 м/с').ok);
  assert.ok(checkAnswer({ type: 'number', answers: ['-2'] }, '−2').ok);
  assert.ok(checkAnswer({ type: 'number', answers: ['10.2'], tolerance: 0.01 }, '10,2').ok);
  assert.ok(checkAnswer({ type: 'number', answers: ['9.8'], tolerance: 0.2 }, '10').ok);
  assert.ok(checkAnswer({ type: 'text', answers: ['3x^2'] }, '3x²').ok);
  assert.ok(checkAnswer({ type: 'text', answers: ['3x^2'] }, '3 * х ** 2').ok, 'русская х и ** тоже');
  assert.ok(checkAnswer({ type: 'text', answers: ['cos x'] }, 'Cos X').ok);
  assert.ok(checkAnswer({ type: 'text', answers: ['zwölf'] }, 'Zwölf').ok);
  assert.ok(checkAnswer({ type: 'choice', options: ['a', 'b'], answer: 1 }, 1).ok);
  assert.ok(checkAnswer({ type: 'text', answers: ['x'] }, '').empty);
  assert.ok(Number.isNaN(parseNumber('1.2.3')));
  assert.equal(normalize(' Ёлка '), 'eлka');
});

test('каждое задание банка проходит собственную проверку (нет опечаток в эталонах)', () => {
  const st = defaultState();
  const ids = new Set();
  const topicIds = new Set(st.topics.map((t) => t.id));
  const subjIds = new Set(st.subjects.map((s) => s.id));
  for (const t of bank.tasks) {
    assert.ok(!ids.has(t.id), `дубль id ${t.id}`);
    ids.add(t.id);
    assert.ok(subjIds.has(t.subject), `${t.id}: нет предмета ${t.subject}`);
    assert.ok(!t.topic || topicIds.has(t.topic), `${t.id}: нет темы ${t.topic}`);
    assert.ok(t.example === true, `${t.id}: пример должен быть помечен`);
    assert.ok(t.q && t.explain, `${t.id}: нет вопроса или разбора`);
    if (t.type === 'choice') {
      assert.ok(t.options.length >= 2 && t.answer >= 0 && t.answer < t.options.length, `${t.id}: варианты`);
      assert.ok(checkAnswer(t, t.answer).ok);
    } else {
      for (const a of t.answers) assert.ok(checkAnswer(t, a).ok, `${t.id}: эталон «${a}» не проходит проверку`);
    }
  }
  for (const c of bank.cards) {
    assert.ok(!ids.has(c.id), `дубль id ${c.id}`);
    ids.add(c.id);
    assert.ok(subjIds.has(c.subject) && c.q && c.a && c.example === true, `${c.id}: карточка`);
  }
});

test('очередь: сначала ошибки, которым пора, потом новые; ошибка возвращается через 3 задачи', () => {
  const now = 1_000_000_000_000;
  const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const practice = { b: { seen: 1, streak: 0, due: now - 1 }, c: { seen: 2, streak: 2, due: now + 1e9 } };
  assert.deepEqual(buildQueue(tasks, practice, now), ['b', 'a', 'c']);
  assert.deepEqual(requeue(['x', 'y', 'z', 'w', 'v'], 0, 'x'), ['x', 'y', 'z', 'w', 'x', 'v']);
});

test('статус темы: учу → понял → повторил, и обратно при ошибках', () => {
  const DAY = 86400000;
  const t0 = 1_000_000_000_000;
  const topic = { status: 'new' };
  let r = nextTopicStatus(topic, [{ ok: false }], t0);
  assert.equal(r.status, 'learning');
  r = nextTopicStatus({ status: 'learning' }, [{ ok: true }, { ok: true }, { ok: false }, { ok: true }, { ok: true }], t0);
  assert.equal(r.status, 'understood');
  r = nextTopicStatus({ status: 'understood', understoodAt: t0 }, [{ ok: true }, { ok: true }, { ok: true }], t0 + 3 * DAY);
  assert.equal(r.status, 'reviewed');
  r = nextTopicStatus({ status: 'reviewed' }, [{ ok: true }, { ok: false }, { ok: false }], t0);
  assert.equal(r.status, 'learning');
});

test('карточки: «не помню» — в начало, «помню» — реже', () => {
  const st = defaultState();
  const card = { id: 'k1' };
  gradeCard(st, card, true, 0);
  assert.equal(st.cardStats.k1.box, 1);
  gradeCard(st, card, true, 0);
  assert.equal(st.cardStats.k1.box, 2);
  gradeCard(st, card, false, 0);
  assert.equal(st.cardStats.k1.box, 0);
});

/* ---------- разбор текста ---------- */

test('дедлайны из опроса разбираются как надо', () => {
  const st = defaultState();
  const text = `19.10 | линал | контрольная(точно не знаю) | на бумаге | телефон нельзя

21.10 | немецкий | презентация как дз | на флегке или в сдо

22.10 | мат логика | контрольная | на бумаге | телефон нельзя
22.10 | матанализ | контрольная | на бумаге | телефон нельзя
12.01 физика лаба`;
  const r = parseDeadlines(text, st, TODAY);
  assert.equal(r.length, 5);
  assert.deepEqual([r[0].date, r[0].type, r[0].subject, r[0].phone, r[0].confirmed, r[0].format], ['2026-10-19', 'kr', 'linal', 'no', false, 'на бумаге']);
  assert.deepEqual([r[1].date, r[1].type, r[1].subject, r[1].format], ['2026-10-21', 'dz', 'de', 'в СДО']);
  assert.equal(r[1].title, 'Презентация как дз');
  assert.deepEqual([r[2].subject, r[2].type, r[2].confirmed], ['matlog', 'kr', true]);
  assert.equal(r[3].subject, 'matan');
  assert.deepEqual([r[4].date, r[4].type, r[4].subject], ['2027-01-12', 'lab', 'phys']);
});

test('физкультура не путается с физикой', () => {
  const st = defaultState();
  const r = parseDeadlines('25.10 физкультура зачёт\n26.10 физика контрольная', st, TODAY);
  assert.equal(r[0].subject, 'pe');
  assert.equal(r[1].subject, 'phys');
});

test('задания по шаблону', () => {
  const st = defaultState();
  const text = `Предмет: Физика
Тема: Кинематика
Вопрос: Тело прошло 120 м за 20 с. Скорость (м/с)?
Ответ: 6
Разбор: v = s / t
---
Вопрос: Что выведет print(7 // 2)?
Предмет: Информатика
Варианты: 3.5 | 3 | 4
Ответ: б
Вопрос: Производная x^3
Ответ: 3x^2 | 3x²`;
  const r = parseTasks(text, st);
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].ok, r[0].task.subject, r[0].task.topic, r[0].task.type], [true, 'phys', 'phys-1', 'number']);
  assert.equal(r[1].task.type, 'choice');
  assert.equal(r[1].task.answer, 1);
  assert.equal(r[2].task.type, 'text');
  assert.equal(r[2].task.subject, 'inf', 'предмет «запоминается» для следующих задач');
});

test('карточки из текста', () => {
  const r = parseCards(`1. Второй закон Ньютона — F = m·a
Кинетическая энергия :: E = mv²/2
В: Год Куликовской битвы
О: 1380
Просто вопрос без ответа`);
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { q: 'Второй закон Ньютона', a: 'F = m·a' });
  assert.equal(r[2].a, '1380');
  assert.equal(r[3].a, '');
});

/* ---------- .ics ---------- */

test('.ics: формат, будильники, длина строк', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 7);
  const ics = buildIcs({ state: st, sim, today: TODAY, nowMin: 7 * 60, now: new Date(Date.UTC(2026, 9, 17, 4)) });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(ics.includes('BEGIN:VALARM'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261019'));
  assert.ok(ics.includes('UID:checkin-am-2026-10-19@ramki'));
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, `длинная строка: ${line}`);
  assert.equal(fold('a'.repeat(80)).split('\r\n ').length, 2);
});

/* ---------- хранилище ---------- */

test('копия: импорт проверяет файл и дополняет недостающее', () => {
  const st = defaultState();
  const back = parseBackup(JSON.stringify({ app: 'ramki', version: 1, state: st }));
  assert.equal(back.subjects.length, st.subjects.length);
  assert.throws(() => parseBackup('{oops'), /JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ app: 'other', state: {} })), /не файл копии/);
  const m = migrate({ subjects: [], events: [], week: {}, settings: { theme: 'dark' } });
  assert.equal(m.settings.theme, 'dark');
  assert.equal(m.settings.minSleepHours, 7);
  assert.deepEqual(m.done, {});
});
