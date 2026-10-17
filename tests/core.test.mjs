// Тесты чистой логики. Запуск: npm test (или node --test tests/*.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CONFIG, PREP } from '../js/config.js';
import { addDays, fmtDur, fmtTime, mondayOf, plural, relDays, toMin, weekdayOf } from '../js/util.js';
import { baseTimes, classesOn, dayInfo } from '../js/schedule.js';
import {
  buildTodayPlan, catchUpTotal, coveredTopics, eventNeedMin, netFor, plannedCatchUp, prepStartOf, recordDone, simulate, splitNeed, streakInfo, undoRecord, wallFor,
} from '../js/planner.js';
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
  assert.equal(sat[0].eventId, 'ev-phys-lab1', 'суббота — сначала отчёт к лабе по физике во вторник');
});

const minutesFor = (plan, pred) => plan.blocks.filter((b) => b.type === 'study' && pred(b)).reduce((a, b) => a + b.min, 0);

test('КР по линалу: готовимся в воскресенье, раньше — нет', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 7);
  const linal = (k) => minutesFor(sim.plans[k], (b) => b.eventId === 'ev-linal-kr');
  assert.equal(linal('2026-10-17'), 0, 'суббота: «готовиться не раньше 18.10»');
  assert.ok(linal('2026-10-18') >= 120, `воскресенье: на линал ${linal('2026-10-18')} мин`);
  assert.ok(sim.plans['2026-10-18'].blocks.every((b) => b.type !== 'study' || b.place === 'home'), 'воскресенье — учёба дома');
  assert.ok(!sim.shortages.some((s) => s.eventId === 'ev-linal-kr'), 'на линал времени хватает');
});

test('отставание: физика и информатика — больше всех, история — с нуля, всё влезает до срока', () => {
  const st = defaultState();
  const total = Object.fromEntries(st.subjects.map((s) => [s.id, catchUpTotal(st, s)]));
  assert.equal(total.phys, 265);
  assert.equal(total.inf, 265);
  assert.equal(total.hist, 750, 'история — ~12,5 ч');
  assert.equal(total.pe, 0, 'физкультура — только посещаемость');
  for (const id of ['linal', 'matan', 'matlog', 'de', 'intro']) assert.ok(total[id] > 0 && total[id] <= 60, `${id}: ${total[id]}`);

  const sim = simulate(st, TODAY, 7 * 60, 21);
  const planned = plannedCatchUp(sim, st);
  for (const id of ['phys', 'inf', 'linal', 'matan', 'matlog', 'de', 'intro']) {
    assert.equal(planned[id], total[id], `${id}: в плане ${planned[id]} из ${total[id]}`);
  }
  assert.deepEqual(sim.catchUpShort, []);
  assert.ok(sim.shortages.every((s) => s.eventId), 'догоняние не выдаётся за нехватку по событию');
  assert.ok(!sim.items.some((i) => i.maint && total[i.subject] > 0), 'кого догоняем — без двойной «поддержки»');
  assert.ok(!sim.shortages.some((s) => s.options.some((o) => o.kind === 'pause')), 'все слабые на догонянии — «пауза поддержки» ничего не даст и не предлагается');
  const st2 = defaultState();
  st2.progress['c:phys:heavy'] = total.phys; // физику догнал — она снова на поддержке
  const pause = simulate(st2, TODAY, 7 * 60, 21).shortages.flatMap((s) => s.options).find((o) => o.kind === 'pause');
  assert.deepEqual(pause?.subjects, ['Физика']);
  // догоняем после дедлайнов: до КР 22.10 физика и информатика не отнимают вечер дома
  for (const k of ['2026-10-19', '2026-10-20', '2026-10-21']) {
    assert.equal(minutesFor(sim.plans[k], (b) => b.catchUp && b.place === 'home'), 0, `${k}: дома — подготовка к КР`);
  }
});

test('лабы по физике: готовиться к допуску не нужно — один блок «досчитать и ответить на контрольные»', () => {
  const st = defaultState();
  const lab1 = st.events.find((e) => e.id === 'ev-phys-lab1');
  assert.deepEqual(splitNeed(st, lab1), { need: 100, light: 0, heavy: 100 });
  assert.equal(PREP.lab.light, '', 'лёгкой части (вопросы к допуску) нет');
  assert.ok(![PREP.lab.heavy, PREP.lab.first.heavy, ...PREP.lab.steps].some((t) => /допуск/i.test(t)), 'в нормах лабы нет подготовки к допуску');
  assert.ok(/контрольн/.test(PREP.lab.heavy) && /расч/.test(PREP.lab.heavy));
  for (const e of st.events.filter((x) => x.type === 'lab')) assert.ok(/не нужно/.test(e.note), `${e.id}: заметка про то, что к допуску не готовятся`);

  const sim = simulate(st, TODAY, 7 * 60, 7);
  const labBlocks = Object.values(sim.plans).flatMap((p) => p.blocks).filter((b) => b.eventId === 'ev-phys-lab1');
  assert.equal(labBlocks.length, 1, 'лаба — один блок');
  assert.equal(labBlocks[0].place, 'home');
  assert.equal(labBlocks[0].kind, 'heavy');
  assert.equal(labBlocks[0].min, 100);
  assert.ok(labBlocks[0].title.startsWith('Физика: досчитать расчёты'));

  // вечер как у тебя: 17:30, блок по лабе почти сделан (95 из 100) — хвост в 5 минут отдельным блоком не появляется,
  // а во втором слоте дома — презентация по немецкому
  st.progress['ev-phys-lab1:heavy'] = 95;
  const now = simulate(st, TODAY, 17 * 60 + 30, 5);
  const study = Object.values(now.plans).flatMap((p) => p.blocks).filter((b) => b.type === 'study');
  assert.ok(!study.some((b) => b.eventId === 'ev-phys-lab1'), 'хвост лабы меньше 10 минут не ставится');
  assert.ok(now.plans[TODAY].blocks.some((b) => b.eventId === 'ev-de-pres' && b.min >= 60), 'сегодня вечером — немецкий');
});

test('отчёт по лабе можно делать только после прошлой лабы — не раньше', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 90);
  const days = (id) => Object.keys(sim.plans).sort().filter((k) => sim.plans[k].blocks.some((b) => b.eventId === id));
  const first = (id) => days(id)[0];
  assert.equal(first('ev-phys-lab1'), TODAY, 'отчёт к 20.10 — по прошлой лабе, можно сразу');
  assert.ok(first('ev-phys-lab2') >= '2026-10-21', `лаба 17.11: отчёт по лабе 20.10, начало ${first('ev-phys-lab2')}`);
  assert.ok(first('ev-phys-lab3') >= '2026-11-18', `лаба 15.12: отчёт по лабе 17.11, начало ${first('ev-phys-lab3')}`);
  assert.ok(first('ev-phys-lab4') >= '2026-12-16', `лаба 12.01: отчёт по лабе 15.12, начало ${first('ev-phys-lab4')}`);
  for (const id of ['ev-phys-lab2', 'ev-phys-lab3', 'ev-phys-lab4']) {
    const planned = Object.values(sim.plans).flatMap((p) => p.blocks).filter((b) => b.eventId === id).reduce((a, b) => a + b.min, 0);
    assert.equal(planned, 100, `${id}: весь отчёт в плане до срока`);
  }
  assert.equal(prepStartOf(st, st.events.find((e) => e.id === 'ev-phys-lab3')), '2026-11-18');
  const own = st.events.find((e) => e.id === 'ev-phys-lab3');
  own.prepFrom = '2026-11-25'; // дату вручную не перебиваем
  assert.equal(prepStartOf(st, own), '2026-11-25');
});

test('пересборка дня во время блока дома: следующий блок — после перерыва в 10 минут', () => {
  const st = defaultState();
  st.plans[TODAY] = buildTodayPlan(st, TODAY, 7 * 60);
  const first = st.plans[TODAY].blocks.find((b) => b.type === 'study' && b.place === 'home');
  const now = first.start + 30; // блок идёт
  const next = buildTodayPlan(st, TODAY, now).blocks.filter((b) => b.type === 'study' && b.place === 'home' && b.start >= first.end);
  assert.ok(next.length, 'после идущего блока в окне дома есть ещё учёба');
  assert.ok(next[0].start - first.end >= CONFIG.breakBetweenChunksMin, `между блоками ${next[0].start - first.end} мин`);
});

test('история: темы докладов по очереди, без повторов, все 30 — до 11 декабря, по неделям ровно', () => {
  const st = defaultState();
  const sim = simulate(st, TODAY, 7 * 60, 70);
  const days = Object.keys(sim.plans).sort();
  const blocks = days.flatMap((k) => sim.plans[k].blocks.filter((b) => b.catchUp && b.subject === 'hist').map((b) => ({ ...b, day: k })));
  const ids = blocks.flatMap((b) => b.topicIds);
  assert.equal(new Set(ids).size, ids.length, 'тема не повторяется');
  assert.equal(ids.length, 30, 'все темы — за 8 недель');
  assert.ok(blocks.at(-1).day <= '2026-12-11', `последний блок ${blocks.at(-1).day} — после срока`);
  assert.ok(blocks.at(-1).day < '2026-12-15', 'до сессии и лабы 15.12 история закрыта');
  const perWeek = {};
  for (const b of blocks) perWeek[mondayOf(b.day)] = (perWeek[mondayOf(b.day)] || 0) + b.min;
  assert.ok(Math.max(...Object.values(perWeek)) <= 135, `в неделю не больше 2 ч 15 мин: ${JSON.stringify(perWeek)}`);
  assert.ok(!perWeek['2026-10-12'], 'за остаток текущей недели (сб–вс) порцию не выделяем');
  assert.deepEqual(ids.slice(0, 3), ['hist-t1', 'hist-t2', 'hist-t3']);
  assert.ok(blocks.every((b) => b.topicIds.length <= CONFIG.catchUp.maxTopicsPerBlock));
  assert.ok(blocks.every((b) => b.title.startsWith('История: «')));

  // как в жизни: план строится каждый день заново, блоки отмечены «готово» — очередь идёт дальше
  const st2 = defaultState();
  const seen = [];
  for (let d = 0, key = TODAY; d < 14; d++, key = addDays(key, 1)) {
    st2.plans[key] = buildTodayPlan(st2, key, 5 * 60);
    for (const b of st2.plans[key].blocks.filter((x) => x.catchUp && x.subject === 'hist')) {
      seen.push(...b.topicIds);
      recordDone(st2, key, b, 0);
    }
  }
  assert.ok(seen.length >= 4, `за 2 недели тем: ${seen.length}`);
  assert.equal(new Set(seen).size, seen.length, `темы не повторяются изо дня в день: ${seen.join(' ')}`);
  assert.equal(coveredTopics(st2, 'hist').size, seen.length);
  assert.ok(seen.every((id) => st2.topics.find((t) => t.id === id).status === 'learning'), 'пройденные темы — «учу»');
});

test('«готово» и «отменить»: минуты и статусы тем возвращаются как были', () => {
  const st = defaultState();
  const b = { id: 'x', type: 'study', min: 40, itemKey: 'c:hist:light#2026-10-26', progressKey: 'c:hist:light', catchUp: true, topicIds: ['hist-t1', 'hist-t2'] };
  st.topics.find((t) => t.id === 'hist-t2').status = 'understood';
  assert.ok(recordDone(st, TODAY, b, 0));
  assert.ok(!recordDone(st, TODAY, b, 0), 'второй раз не засчитывается');
  assert.equal(st.progress['c:hist:light'], 40, 'прогресс общий на предмет, не на неделю');
  assert.equal(st.topics.find((t) => t.id === 'hist-t1').status, 'learning');
  assert.equal(st.topics.find((t) => t.id === 'hist-t2').status, 'understood', 'закрытая тема не откатывается в «учу»');
  undoRecord(st, TODAY, 'x');
  assert.equal(st.progress['c:hist:light'], 0);
  assert.equal(st.topics.find((t) => t.id === 'hist-t1').status, 'new');
  assert.equal(st.topics.find((t) => t.id === 'hist-t2').status, 'understood');
  assert.equal(coveredTopics(st, 'hist').size, 0);
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

test('сессия — в конце декабря: у старых данных дата сдвигается, ручную правку не трогаем', () => {
  assert.equal(defaultState().events.find((e) => e.id === 'ev-session').date, '2026-12-22');
  assert.equal(defaultState().settings.sessionStart, '2026-12-22');
  const old = defaultState();
  old.version = 2;
  const ev = old.events.find((e) => e.id === 'ev-session');
  ev.date = '2026-12-01';
  old.settings.sessionStart = '2026-12-01';
  const m = migrate(JSON.parse(JSON.stringify(old)));
  assert.equal(m.events.find((e) => e.id === 'ev-session').date, '2026-12-22');
  assert.equal(m.settings.sessionStart, '2026-12-22');
  assert.equal(m.settings.updateSeen, old.settings.updateSeen, 'заметка «что нового» не повторяется');
  // дату поправили сами (например, на 25.12) — остаётся как есть
  const mine = JSON.parse(JSON.stringify(old));
  mine.events.find((e) => e.id === 'ev-session').date = '2026-12-25';
  mine.settings.sessionStart = '2026-12-25';
  const m2 = migrate(mine);
  assert.equal(m2.events.find((e) => e.id === 'ev-session').date, '2026-12-25');
  assert.equal(m2.settings.sessionStart, '2026-12-25');
});

test('обновление до версии 4: история — 8 недель, свои сроки не трогаем, заметку показываем один раз', () => {
  const v3 = defaultState();
  v3.version = 3;
  v3.settings.updateSeen = 2;
  v3.subjects.find((s) => s.id === 'hist').catchUpWeeks = 6; // как было у версии 2–3
  const m = migrate(JSON.parse(JSON.stringify(v3)));
  assert.equal(m.version, CONFIG.dataVersion);
  assert.equal(m.subjects.find((s) => s.id === 'hist').catchUpWeeks, 8);
  assert.equal(m.settings.updateSeen, 2, 'заметка про историю ещё не показана');
  assert.ok(m.settings.updateSeen < CONFIG.noteVersion);
  assert.equal(migrate(m).subjects.find((s) => s.id === 'hist').catchUpWeeks, 8, 'повторный запуск ничего не меняет');
  assert.ok(defaultState().settings.updateSeen >= CONFIG.noteVersion, 'на чистой установке заметки «что нового» нет');

  const mine = JSON.parse(JSON.stringify(v3));
  mine.subjects.find((s) => s.id === 'hist').catchUpWeeks = 4; // сам сжал срок
  assert.equal(migrate(mine).subjects.find((s) => s.id === 'hist').catchUpWeeks, 4);
  const mine2 = JSON.parse(JSON.stringify(v3));
  mine2.subjects.find((s) => s.id === 'hist').catchUpMin = 600; // сам поменял объём
  assert.equal(migrate(mine2).subjects.find((s) => s.id === 'hist').catchUpWeeks, 6);
});

test('обновление до версии 5: заметки к лабам обновляются, свои — нет', () => {
  const v4 = defaultState();
  v4.version = 4;
  const old = { 'ev-phys-lab1': 'Допуск и подготовка — уточнить.', 'ev-phys-lab2': 'Каждые 4 недели после 20 октября.', 'ev-phys-lab3': '', 'ev-phys-lab4': '' };
  for (const [id, note] of Object.entries(old)) v4.events.find((e) => e.id === id).note = note;
  v4.events.find((e) => e.id === 'ev-phys-lab3').note = 'сдавать лично препу'; // свою заметку не трогаем
  const m = migrate(JSON.parse(JSON.stringify(v4)));
  const note = (id) => m.events.find((e) => e.id === id).note;
  assert.ok(/не нужно/.test(note('ev-phys-lab1')) && /не нужно/.test(note('ev-phys-lab2')) && /не нужно/.test(note('ev-phys-lab4')));
  assert.equal(note('ev-phys-lab3'), 'сдавать лично препу');
  assert.equal(migrate(m).events.find((e) => e.id === 'ev-phys-lab1').note, note('ev-phys-lab1'), 'повторный запуск ничего не меняет');
  assert.equal(m.settings.updateSeen, v4.settings.updateSeen);
  assert.ok(m.settings.updateSeen < CONFIG.noteVersion || v4.settings.updateSeen >= CONFIG.noteVersion);
});

/** Данные с телефона в формате версии 1 (до отставания и тем докладов). */
function stateV1() {
  const v1 = defaultState();
  v1.version = 1;
  for (const s of v1.subjects) {
    for (const k of ['behindDays', 'behindSince', 'catchUpWeeks', 'catchUpMin', 'catchUpLight', 'catchUpByTopic', 'noStudy']) delete s[k];
  }
  v1.subjects.find((s) => s.id === 'hist').level = 2;
  v1.topics = v1.topics.filter((t) => t.subject !== 'hist').concat(['Древняя Русь', 'Московское царство']
    .map((name, i) => ({ id: `hist-${i + 1}`, subject: 'hist', name, status: 'new', note: '', example: true })));
  const kr = v1.events.find((e) => e.id === 'ev-linal-kr');
  delete kr.prepFrom;
  kr.confirmed = false;
  kr.note = 'Точно не известно, будет ли контрольная.';
  v1.dayOverrides = { '2026-10-20': { sleep: '22:00' } };
  delete v1.settings.updateSeen;
  v1.done['2026-10-16'] = { a: { status: 'done', type: 'study', min: 30, itemKey: 'ev-de-pres:heavy', at: 1 } };
  v1.progress['ev-de-pres:heavy'] = 30;
  return JSON.parse(JSON.stringify(v1));
}

test('обновление с версии 1: отставание, темы докладов, воскресенье — отметки и правки целы', () => {
  const m = migrate(stateV1());
  assert.equal(m.version, CONFIG.dataVersion);
  const hist = m.subjects.find((s) => s.id === 'hist');
  assert.equal(hist.level, 1);
  assert.equal(catchUpTotal(m, hist), 750);
  assert.equal(hist.catchUpWeeks, 8, 'история — 8 недель, до 11 декабря');
  assert.equal(catchUpTotal(m, m.subjects.find((s) => s.id === 'phys')), 265);
  const ht = m.topics.filter((t) => t.subject === 'hist');
  assert.equal(ht.length, 30);
  assert.ok(!ht.some((t) => t.id === 'hist-1'), 'нетронутые примерные темы истории заменены темами докладов');
  const kr = m.events.find((e) => e.id === 'ev-linal-kr');
  assert.deepEqual([kr.prepFrom, kr.confirmed, kr.note], ['2026-10-18', true, 'Готовимся в воскресенье.']);
  assert.ok(m.dayOverrides['2026-10-18'].study, 'воскресенье 18.10 — учебный день');
  assert.equal(m.dayOverrides['2026-10-20'].sleep, '22:00', 'свои правки дней остаются');
  assert.equal(m.progress['ev-de-pres:heavy'], 30, 'прогресс не теряется');
  assert.equal(m.done['2026-10-16'].a.status, 'done', 'отметки не теряются');
  assert.equal(m.settings.updateSeen, 1, 'покажется заметка «что нового»');
  assert.equal(migrate(m).settings.updateSeen, 1, 'повторный запуск ничего не меняет');

  // свои темы истории не трогаем — темы докладов добавляются рядом
  const v1 = stateV1();
  v1.topics.find((t) => t.id === 'hist-1').note = 'мой конспект';
  const m2 = parseBackup(JSON.stringify({ app: 'ramki', version: 1, state: v1 }));
  assert.ok(m2.topics.some((t) => t.id === 'hist-1' && t.note === 'мой конспект'));
  assert.equal(m2.topics.filter((t) => t.subject === 'hist').length, 32);
  assert.ok(simulate(m2, TODAY, 7 * 60, 7).plans['2026-10-18'].blocks.some((b) => b.eventId === 'ev-linal-kr'));
});
