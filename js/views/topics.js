/* =====================================================================
   «Темы»: статусы тем, конспект, банк заданий, отработка, карточки,
   добавление заданий текстом.
   ===================================================================== */

import { CONFIG } from '../config.js';
import { commit, store } from '../store.js';
import { catchUpDone, catchUpTotal, catchUpWindow, subjectOf } from '../planner.js';
import {
  STATUS, STATUS_ORDER, allCards, allTasks, buildQueue, cardQueue, checkAnswer, deckList, gradeCard,
  recordAnswer, requeue, tasksForScope, topicStats, weakCards,
} from '../practice.js';
import { parseCards, parseTasks } from '../parse.js';
import { esc, fmtDur, humanDate, plural, uid } from '../util.js';
import { closeSheet, confirmSheet, copyText, icon, openSheet, toast } from '../ui.js';
import { go } from '../nav.js';
import { bank } from '../bank.js';
import { levelDots, subjShort, today } from './shared.js';

const tasksAll = () => allTasks(bank.data, store.state);
const cardsAll = () => allCards(bank.data, store.state);
const topicById = (id) => store.state.topics.find((t) => t.id === id);
const statusChip = (s) => `<span class="chip ${s === 'understood' || s === 'reviewed' ? 'ok' : s === 'learning' ? '' : 'warn'}">${STATUS[s] || s}</span>`;

/* ---------- Список тем ---------- */

const openSubjects = {}; // какие предметы раскрыты (запоминаем, пока приложение открыто)

/** Запомнить, раскрыт ли предмет (вызывается из app.js на событие toggle). */
export function rememberToggle(el) {
  if (el?.dataset?.subj) openSubjects[el.dataset.subj] = el.open;
}

function catchUpLine(st, s) {
  const total = catchUpTotal(st, s);
  if (!total) return '';
  const done = Math.min(total, catchUpDone(st, s));
  const pct = Math.round((done / total) * 100);
  const until = catchUpWindow(s, today()).until;
  return `<div class="stack" style="gap:4px">
    <span class="small">${done >= total ? 'Отставание догнано.' : `Догоняю: осталось ${fmtDur(total - done)} · до ${esc(humanDate(until))}`}</span>
    <div class="progress ${pct >= 100 ? 'ok' : ''}"><i style="width:${pct}%"></i></div>
  </div>`;
}

export function renderTopics() {
  const st = store.state;
  const tasks = tasksAll();
  // сначала те, кого догоняем, потом слабые, потом остальные
  const score = (s) => (catchUpTotal(st, s) > catchUpDone(st, s) ? 0 : 1) * 10 + (Number(s.level) || 3);
  const subjects = st.subjects.filter((s) => !s.noStudy).sort((a, b) => score(a) - score(b));
  return `
    <header class="head">
      <span class="eyebrow">Темы и отработка</span>
      <h1 class="display">Темы</h1>
    </header>
    <div class="grid2">
      <button class="btn" type="button" data-act="go" data-to="practice/weak">${icon('target', 's')}Отработка</button>
      <button class="btn ghost" type="button" data-act="go" data-to="cards">${icon('cards', 's')}Карточки</button>
    </div>
    <button class="btn ghost block" type="button" data-act="go" data-to="import">${icon('paste', 's')}Добавить задания текстом</button>
    <p class="small muted">Отработка без выбора темы — по слабым предметам. Задания с пометкой «пример» — для старта, пока нет твоих материалов.</p>
    ${subjects.map((s) => {
      const ts = st.topics.filter((t) => t.subject === s.id);
      const closed = ts.filter((t) => t.status === 'understood' || t.status === 'reviewed').length;
      const behind = catchUpTotal(st, s) > catchUpDone(st, s);
      const open = openSubjects[s.id] ?? (behind || Number(s.level) <= CONFIG.weakLevelMax);
      return `<details class="subj" data-subj="${esc(s.id)}" ${open ? 'open' : ''}>
        <summary class="sec-row"><h2 class="sec">${esc(s.short)}</h2><span class="row" style="gap:8px">${levelDots(s.level)}${behind ? '<span class="chip danger">догоняю</span>' : Number(s.level) <= CONFIG.weakLevelMax ? '<span class="chip warn">слабый</span>' : ''}${icon('chev', 'chev s subj-chev')}</span></summary>
        <div class="stack">
        ${catchUpLine(st, s)}
        ${ts.length ? `<p class="small muted" style="margin:0">Закрыто ${closed} из ${ts.length}</p>
        <ul class="list">${ts.map((t) => {
          const n = tasks.filter((x) => x.topic === t.id).length;
          return `<li><button class="li" type="button" data-act="go" data-to="topic/${esc(t.id)}">
            <span class="grow"><span class="t">${esc(t.name)}</span><span class="m">${t.num ? `доклад №${t.num} · ` : ''}${n ? `${n} ${plural(n, 'задание', 'задания', 'заданий')}` : 'заданий пока нет'}${t.example ? ' · примерная тема' : ''}</span></span>
            ${statusChip(t.status)}${icon('chev', 'chev s')}</button></li>`;
        }).join('')}</ul>` : '<p class="small muted" style="margin:0">Тем пока нет.</p>'}
        <button class="btn quiet small" type="button" data-act="topic-add" data-subject="${esc(s.id)}">${icon('plus', 's')}Тема</button>
        </div>
      </details>`;
    }).join('')}`;
}

/* ---------- Тема ---------- */

export function renderTopic([id]) {
  const st = store.state;
  const topic = topicById(id);
  if (!topic) return `<p class="lead">Тема не найдена.</p><button class="btn" type="button" data-act="go" data-to="topics">К темам</button>`;
  const all = tasksAll();
  const tasks = all.filter((t) => t.topic === id);
  const stats = topicStats(all, st, id);
  const cards = cardsAll().filter((c) => c.topic === id);
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="topics">${icon('back', 's')}Темы</button>
      <span class="eyebrow">${esc(subjectOf(st, topic.subject)?.name || '')}${topic.num ? ` · доклад №${topic.num}` : ''}</span>
      <h1 class="display m">${esc(topic.name)}</h1>
      ${topic.example ? '<span class="small muted">Примерная тема — переименуй под свою программу или удали.</span>' : ''}
    </header>

    <section>
      <span class="eyebrow">Статус — меняется сам по результатам, можно поправить</span>
      <div class="seg" role="group">${STATUS_ORDER.map((s) => `<button type="button" data-act="topic-status" data-id="${esc(id)}" data-v="${s}" aria-pressed="${topic.status === s}">${STATUS[s]}</button>`).join('')}</div>
      <p class="small muted" style="margin:0">${stats.total ? `Заданий: ${stats.total} · ответов: ${stats.seen}${stats.accuracy != null ? ` · верно ${Math.round(stats.accuracy * 100)}%` : ''}${stats.wrongDue ? ` · ошибок к повтору: ${stats.wrongDue}` : ''}` : 'Заданий по теме пока нет — добавь свои или работай по конспекту и карточкам.'}</p>
      <div class="row">
        <button class="btn" type="button" data-act="go" data-to="practice/t:${esc(id)}" ${tasks.length ? '' : 'disabled'}>${icon('target', 's')}Отработка</button>
        ${cards.length ? `<button class="btn ghost" type="button" data-act="go" data-to="drill/t:${esc(id)}">${icon('cards', 's')}Карточки · ${cards.length}</button>` : ''}
      </div>
    </section>

    <section>
      <div class="sec-row"><h2 class="sec">Конспект</h2><span class="tiny muted">сохраняется сам</span></div>
      <textarea class="inp" id="topic-note" data-input="topic-note" data-id="${esc(id)}" placeholder="Своими словами: определения, формулы, пример решения. Потом из этого удобно сделать карточки.">${esc(topic.note || '')}</textarea>
      <button class="btn ghost small" type="button" data-act="deck-from-note" data-id="${esc(id)}">${icon('cards', 's')}Сделать карточки из конспекта</button>
    </section>

    <section>
      <div class="sec-row"><h2 class="sec">Банк заданий</h2><span class="small muted">${tasks.length}</span></div>
      ${tasks.length ? `<ul class="list">${tasks.map((t) => {
        const p = st.practice[t.id];
        const own = st.customTasks.some((c) => c.id === t.id);
        return `<li class="li"><span class="grow"><span class="t" style="font-weight:500">${esc(t.q.length > 110 ? `${t.q.slice(0, 110)}…` : t.q)}</span>
          <span class="m">${t.example ? 'пример · ' : ''}${p ? `решено ${p.correct} из ${p.seen}` : 'ещё не решал'}</span></span>
          ${own ? `<button class="ibtn" type="button" data-act="task-del" data-id="${esc(t.id)}" aria-label="Удалить задание">${icon('trash', 's')}</button>` : ''}</li>`;
      }).join('')}</ul>` : ''}
      <button class="btn ghost small" type="button" data-act="go" data-to="import">${icon('plus', 's')}Добавить задания</button>
    </section>

    <div class="row">
      <button class="btn quiet small" type="button" data-act="topic-rename" data-id="${esc(id)}">${icon('edit', 's')}Переименовать</button>
      <button class="btn quiet small" type="button" data-act="topic-del" data-id="${esc(id)}">${icon('trash', 's')}Удалить тему</button>
    </div>`;
}

/* ---------- Отработка ---------- */

let P = null; // текущая сессия отработки

function scopeOf(param) {
  if (!param || param === 'weak') return { weak: true, label: 'слабые предметы', back: 'topics' };
  const [k, v] = param.split(':');
  if (k === 't') return { topic: v, label: topicById(v)?.name || 'тема', back: `topic/${v}` };
  if (k === 's') return { subject: v, label: subjShort(v) || 'предмет', back: 'topics' };
  return { weak: true, label: 'слабые предметы', back: 'topics' };
}

function startPractice(param) {
  const st = store.state;
  const pool = tasksForScope(tasksAll(), scopeOf(param), st);
  P = { param, ids: buildQueue(pool, st.practice, Date.now()), pos: 0, ok: 0, answered: 0, shown: false, last: null, changes: [] };
}

export function renderPractice([param = 'weak']) {
  if (!P || P.param !== param) startPractice(param);
  const scope = scopeOf(param);
  const head = (sub) => `<header class="head">
      <button class="back" type="button" data-act="go" data-to="${esc(scope.back)}">${icon('back', 's')}Назад</button>
      <span class="eyebrow">Отработка · ${esc(scope.label)}${sub ? ` · ${sub}` : ''}</span>
    </header>`;

  if (!P.ids.length) {
    return `${head('')}<h1 class="display m">Пока нечего решать</h1>
      <p class="lead">В этом разделе нет заданий. Добавь свои текстом — или пришли материалы в чат, я превращу их в задания.</p>
      <button class="btn block" type="button" data-act="go" data-to="import">Добавить задания</button>`;
  }
  if (P.pos >= P.ids.length) {
    return `${head('итог')}<h1 class="display m">Верно ${P.ok} из ${P.answered}</h1>
      ${P.changes.map((c) => `<p class="note">Тема «${esc(c.topic.name)}»: ${STATUS[c.from]} → <b>${STATUS[c.to]}</b></p>`).join('')}
      <p class="lead">${P.ok === P.answered ? 'Чисто. Эти задачи вернутся для повторения через несколько дней.' : 'Ошибочные задачи вернутся завтра — так они запоминаются лучше всего.'}</p>
      <div class="row"><button class="btn" type="button" data-act="pr-restart">Ещё круг</button><button class="btn ghost" type="button" data-act="go" data-to="${esc(scope.back)}">Готово</button></div>`;
  }
  const task = tasksAll().find((t) => t.id === P.ids[P.pos]);
  if (!task) {
    P.pos += 1;
    return renderPractice([param]);
  }
  const res = P.shown ? P.last : null;
  const answerUi = task.type === 'choice'
    ? `<div class="opts">${task.options.map((o, i) => {
      const cls = res ? (i === Number(task.answer) ? 'right' : i === Number(res.chosen) ? 'wrong' : '') : '';
      return `<button class="opt ${cls}" type="button" data-act="pr-choice" data-i="${i}" ${res ? 'disabled' : ''}>${esc(o)}</button>`;
    }).join('')}</div>`
    : `<form class="stack" data-submit="pr-check" autocomplete="off">
        <div class="field"><label for="pr-ans">Ответ${task.type === 'number' ? ' (число)' : ''}</label>
        <input class="inp" id="pr-ans" ${task.type === 'number' ? 'inputmode="decimal"' : 'autocapitalize="off" spellcheck="false"'} ${res ? 'disabled' : ''} value="${esc(res?.input || '')}"></div>
        ${res ? '' : `<div class="row"><button class="btn" type="submit">Проверить</button><button class="btn ghost" type="button" data-act="pr-dunno">Не знаю</button></div>`}
      </form>`;

  return `${head(`${P.pos + 1} из ${P.ids.length}`)}
    <section>
      <div class="row" style="gap:6px">${task.example ? '<span class="chip">пример</span>' : ''}<span class="chip">${esc(subjShort(task.subject))}</span></div>
      <p class="q">${esc(task.q)}</p>
      ${answerUi}
    </section>
    ${res ? `<section class="result ${res.ok ? 'ok' : ''}" aria-live="polite">
      <span class="r">${res.ok ? 'Верно' : res.dunno ? 'Разберём' : 'Пока нет'}</span>
      ${res.ok ? '' : `<span>Правильный ответ: <b>${esc(res.correctText)}</b></span>`}
      ${task.explain ? `<span class="small">${esc(task.explain)}</span>` : ''}
      ${res.ok ? '' : '<span class="small muted">Эта задача вернётся через пару задач и завтра.</span>'}
      <button class="btn block" type="button" data-act="pr-next">Дальше</button>
    </section>` : ''}`;
}

function answer(input, opts = {}) {
  const task = tasksAll().find((t) => t.id === P.ids[P.pos]);
  if (!task) return;
  const res = opts.dunno ? { ok: false, correctText: task.type === 'choice' ? task.options[task.answer] : task.answers[0] } : checkAnswer(task, input);
  if (res.empty) {
    toast('Впиши ответ — или нажми «Не знаю», это тоже нормально.');
    return;
  }
  if (res.notNumber) {
    toast('Здесь нужно число, например 0,25 или 1/4.');
    return;
  }
  commit((st) => {
    const ch = recordAnswer(st, task, res.ok);
    if (ch) P.changes.push(ch);
  });
  P.answered += 1;
  if (res.ok) P.ok += 1;
  else P.ids = requeue(P.ids, P.pos, task.id);
  P.shown = true;
  P.last = { ...res, input: typeof input === 'string' ? input : '', chosen: input, dunno: !!opts.dunno };
  go(`practice/${P.param}`, { replace: true });
}

/* ---------- Карточки ---------- */

function deckName(d) {
  if (d.own) return d.name;
  return `Примеры: ${subjShort(d.subject) || 'разное'}`;
}

export function renderCards() {
  const st = store.state;
  const now = Date.now();
  const decks = deckList(bank.data, st);
  const due = cardQueue(cardsAll(), st.cardStats, now, 999).length;
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="topics">${icon('back', 's')}Темы</button>
      <span class="eyebrow">Самопроверка</span>
      <h1 class="display">Карточки</h1>
    </header>
    <button class="btn block" type="button" data-act="go" data-to="drill/all" ${due ? '' : 'disabled'}>${due ? `Повторить всё, что пора · ${due}` : 'Сейчас повторять нечего'}</button>
    <p class="small muted">«Не помню» — карточка вернётся через пару штук и снова завтра. «Помню» — следующий повтор реже. Слабые идут первыми.</p>
    <section>
      <div class="sec-row"><h2 class="sec">Колоды</h2><button class="btn quiet small" type="button" data-act="deck-new">${icon('plus', 's')}Из текста</button></div>
      <ul class="list">${decks.map((d) => {
        const dDue = cardQueue(d.cards, st.cardStats, now, 999).length;
        return `<li class="li">
          <button class="grow" type="button" data-act="go" data-to="drill/d:${esc(d.id)}" style="background:none;border:0;text-align:left;padding:0">
            <span class="t">${esc(deckName(d))}</span><span class="m">${d.cards.length} ${plural(d.cards.length, 'карточка', 'карточки', 'карточек')} · пора повторить: ${dDue}</span></button>
          ${d.own ? `<button class="ibtn" type="button" data-act="deck-del" data-id="${esc(d.id)}" aria-label="Удалить колоду">${icon('trash', 's')}</button>` : '<span class="chip">пример</span>'}
        </li>`;
      }).join('')}</ul>
    </section>`;
}

let D = null; // текущая сессия карточек

function drillCards(param) {
  const cards = cardsAll();
  if (!param || param === 'all') return { cards, label: 'всё, что пора' };
  const [k, v] = param.split(':');
  if (k === 'd') {
    const d = deckList(bank.data, store.state).find((x) => x.id === v);
    return { cards: cards.filter((c) => c.deckId === v), label: d ? deckName(d) : 'колода' };
  }
  if (k === 's') return { cards: cards.filter((c) => c.subject === v), label: subjShort(v) };
  if (k === 't') return { cards: cards.filter((c) => c.topic === v), label: topicById(v)?.name || 'тема' };
  return { cards, label: 'всё' };
}

export function renderDrill([param = 'all']) {
  const { cards, label } = drillCards(param);
  if (!D || D.param !== param) {
    let ids = cardQueue(cards, store.state.cardStats, Date.now());
    let extra = false;
    if (!ids.length) {
      ids = weakCards(cards, store.state.cardStats, 10);
      extra = true;
    }
    D = { param, ids, pos: 0, shown: false, known: 0, total: 0, extra, changes: [] };
  }
  const head = `<header class="head">
      <button class="back" type="button" data-act="go" data-to="cards">${icon('back', 's')}Карточки</button>
      <span class="eyebrow">Карточки · ${esc(label)}${D.ids.length && D.pos < D.ids.length ? ` · ${D.pos + 1} из ${D.ids.length}` : ''}</span>
    </header>`;
  if (!D.ids.length) {
    return `${head}<h1 class="display m">Карточек нет</h1><p class="lead">Сделай колоду из конспекта или списка вопросов — по строке «вопрос :: ответ».</p>
      <button class="btn block" type="button" data-act="deck-new">Колода из текста</button>`;
  }
  if (D.pos >= D.ids.length) {
    return `${head}<h1 class="display m">Помню ${D.known} из ${D.total}</h1>
      ${D.changes.map((c) => `<p class="note">Тема «${esc(c.topic.name)}»: ${STATUS[c.from]} → <b>${STATUS[c.to]}</b></p>`).join('')}
      <p class="lead">${D.known === D.total ? 'Отлично. Следующий повтор — через несколько дней.' : 'То, что не вспомнилось, вернётся первым в следующий раз.'}</p>
      <div class="row"><button class="btn" type="button" data-act="dr-restart">Ещё раз</button><button class="btn ghost" type="button" data-act="go" data-to="cards">Готово</button></div>`;
  }
  const card = cards.find((c) => c.id === D.ids[D.pos]) || cardsAll().find((c) => c.id === D.ids[D.pos]);
  if (!card) {
    D.pos += 1;
    return renderDrill([param]);
  }
  return `${head}
    ${D.extra && D.pos === 0 ? '<p class="small muted">Повторять по графику пока нечего — гоняю самые слабые.</p>' : ''}
    <div class="flash">
      ${card.example ? '<span class="chip" style="justify-self:center">пример</span>' : ''}
      <div class="fq">${esc(card.q)}</div>
      ${D.shown ? `<div class="fa">${card.a ? esc(card.a) : 'Ответа нет — сверь с конспектом.'}</div>` : ''}
    </div>
    ${D.shown
      ? `<div class="grid2"><button class="btn ghost" type="button" data-act="dr-grade" data-v="0">Не помню</button><button class="btn" type="button" data-act="dr-grade" data-v="1">Помню</button></div>`
      : '<button class="btn block" type="button" data-act="dr-show">Показать ответ</button>'}`;
}

/* ---------- Добавить задания текстом ---------- */

const TEMPLATE = `Предмет: Физика
Тема: Кинематика
Вопрос: Тело прошло 120 м за 20 с. Скорость, м/с?
Ответ: 6
Разбор: v = s / t = 120 / 20 = 6 м/с
---
Вопрос: Что выведет print(7 // 2)?
Предмет: Информатика
Варианты: 3.5 | 3 | 4
Ответ: 3
Разбор: // — деление нацело`;

const IMP = { text: '', drafts: [] };

export function renderImport() {
  const ok = IMP.drafts.filter((d) => d.ok).length;
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="topics">${icon('back', 's')}Темы</button>
      <span class="eyebrow">Банк заданий</span>
      <h1 class="display m">Добавить задания</h1>
    </header>
    <p class="lead small">Вставь задания по шаблону. «Предмет» и «Тема» действуют на следующие задания, пока не сменишь. Несколько верных ответов — через «|». Новая тема создастся сама.</p>
    <pre class="code">${esc(TEMPLATE)}</pre>
    <button class="btn ghost small" type="button" data-act="imp-copy">${icon('copy', 's')}Скопировать шаблон</button>
    <p class="small muted">Через чат удобнее: пришли конспект, фото тетради или список вопросов — я верну текст в этом формате, останется вставить.</p>
    <div class="field"><label for="imp-text">Текст</label><textarea class="inp" id="imp-text" data-input="imp-text" placeholder="Вставь сюда">${esc(IMP.text)}</textarea></div>
    <button class="btn block" type="button" data-act="imp-parse">Разобрать</button>
    ${IMP.drafts.length ? `<section>
      <div class="sec-row"><h2 class="sec">Проверка</h2><span class="small muted">готово ${ok} из ${IMP.drafts.length}</span></div>
      <ul class="list">${IMP.drafts.map((d) => `<li class="li"><span class="grow">
        <span class="t" style="font-weight:500">${esc(d.task.q || '(без вопроса)')}</span>
        <span class="m">${d.ok ? `${esc(subjShort(d.task.subject))} · ${d.task.topic ? esc(topicById(d.task.topic)?.name || '') : d.task.topicName ? `новая тема «${esc(d.task.topicName)}»` : 'без темы'} · ${d.task.type === 'choice' ? 'выбор' : d.task.type === 'number' ? 'число' : 'текст'}` : `<span style="color:var(--danger)">${esc(d.errors.join('; '))}</span>`}</span>
      </span>${d.ok ? icon('check', 's') : icon('alert', 's')}</li>`).join('')}</ul>
      <button class="btn block" type="button" data-act="imp-save" ${ok ? '' : 'disabled'}>Добавить ${ok}</button>
    </section>` : ''}`;
}

/* ---------- Шторки ---------- */

function openDeckSheet(prefill = '', topicId = null) {
  const st = store.state;
  const topic = topicId ? topicById(topicId) : null;
  let cards = prefill ? parseCards(prefill) : [];
  openSheet({
    title: 'Колода из текста',
    body: `
      <div class="field"><label for="dk-name">Название</label><input class="inp" id="dk-name" value="${esc(topic ? topic.name : '')}" placeholder="Например: Физика — формулы"></div>
      <div class="field"><label for="dk-subject">Предмет</label><select class="inp" id="dk-subject">${st.subjects.map((s) => `<option value="${esc(s.id)}" ${topic?.subject === s.id ? 'selected' : ''}>${esc(s.short)}</option>`).join('')}</select></div>
      <div class="field"><label for="dk-topic">Тема (необязательно)</label><select class="inp" id="dk-topic"><option value="">— без темы —</option>${st.topics.map((t) => `<option value="${esc(t.id)}" ${t.id === topicId ? 'selected' : ''}>${esc(subjShort(t.subject))}: ${esc(t.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="dk-text">Карточки — по строке «вопрос :: ответ»</label><textarea class="inp" id="dk-text" placeholder="Второй закон Ньютона :: F = m·a">${esc(prefill)}</textarea></div>
      <p class="small muted" id="dk-count">${cards.length ? `Карточек: ${cards.length}` : 'Разделители: «::», « — », « | », Tab. Строка без разделителя — вопрос без ответа.'}</p>
      <button class="btn block" type="button" id="dk-save">Сохранить колоду</button>`,
    onMount: (body) => {
      const ta = body.querySelector('#dk-text');
      const count = body.querySelector('#dk-count');
      ta.addEventListener('input', () => {
        cards = parseCards(ta.value);
        count.textContent = `Карточек: ${cards.length}`;
      });
      body.querySelector('#dk-save').addEventListener('click', () => {
        cards = parseCards(ta.value);
        if (!cards.length) {
          toast('Нет ни одной карточки — проверь разделители.');
          return;
        }
        const deck = {
          id: uid('deck'),
          name: body.querySelector('#dk-name').value.trim() || 'Моя колода',
          subject: body.querySelector('#dk-subject').value,
          topicId: body.querySelector('#dk-topic').value || null,
          cards: cards.map((c) => ({ id: uid('c'), q: c.q, a: c.a })),
        };
        commit((s) => { s.decks.push(deck); });
        closeSheet(true);
        toast(`Колода сохранена: ${deck.cards.length} ${plural(deck.cards.length, 'карточка', 'карточки', 'карточек')}.`);
      });
    },
  });
}

function openTopicNameSheet({ title, value = '', onSave }) {
  openSheet({
    title,
    body: `<div class="field"><label for="tp-name">Название темы</label><input class="inp" id="tp-name" value="${esc(value)}" autocomplete="off"></div>
      <button class="btn block" type="button" id="tp-save">Сохранить</button>`,
    onMount: (body) => body.querySelector('#tp-save').addEventListener('click', () => {
      const name = body.querySelector('#tp-name').value.trim();
      if (!name) {
        toast('Нужно название.');
        return;
      }
      onSave(name);
      closeSheet(true);
    }),
  });
}

/* ---------- Действия ---------- */

let noteTimer = null;

export const topicsInputs = {
  'topic-note': (el) => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      commit((st) => {
        const t = st.topics.find((x) => x.id === el.dataset.id);
        if (t) t.note = el.value;
      }, { silent: true });
    }, 400);
  },
  'imp-text': (el) => { IMP.text = el.value; },
};

export const topicsActions = {
  'topic-status': (el) => commit((st) => {
    const t = st.topics.find((x) => x.id === el.dataset.id);
    if (t) {
      t.status = el.dataset.v;
      if (el.dataset.v === 'understood') t.understoodAt = Date.now();
    }
  }),
  'topic-add': (el) => openTopicNameSheet({
    title: `Новая тема · ${subjShort(el.dataset.subject)}`,
    onSave: (name) => commit((st) => { st.topics.push({ id: uid('tp'), subject: el.dataset.subject, name, status: 'new', note: '', example: false }); }),
  }),
  'topic-rename': (el) => {
    const t = topicById(el.dataset.id);
    openTopicNameSheet({
      title: 'Переименовать тему', value: t?.name,
      onSave: (name) => commit((st) => {
        const x = st.topics.find((y) => y.id === el.dataset.id);
        if (x) {
          x.name = name;
          x.example = false;
        }
      }),
    });
  },
  'topic-del': async (el) => {
    const t = topicById(el.dataset.id);
    const ok = await confirmSheet({ title: 'Удалить тему?', text: `«${t?.name}» и конспект удалятся. Задания банка останутся, но без темы.`, ok: 'Удалить', danger: true });
    if (!ok) return;
    commit((st) => { st.topics = st.topics.filter((x) => x.id !== el.dataset.id); });
    go('topics');
  },
  'task-del': async (el) => {
    const ok = await confirmSheet({ title: 'Удалить задание?', text: 'Оно пропадёт из банка.', ok: 'Удалить', danger: true });
    if (ok) commit((st) => { st.customTasks = st.customTasks.filter((x) => x.id !== el.dataset.id); });
  },
  'deck-from-note': (el) => {
    const t = topicById(el.dataset.id);
    const note = document.getElementById('topic-note')?.value ?? t?.note ?? '';
    if (!note.trim()) {
      toast('Конспект пустой. Напиши строки «вопрос :: ответ» или просто определения.');
      return;
    }
    openDeckSheet(note, el.dataset.id);
  },
  'deck-new': () => openDeckSheet(),
  'deck-del': async (el) => {
    const ok = await confirmSheet({ title: 'Удалить колоду?', text: 'Карточки и их история повторов удалятся.', ok: 'Удалить', danger: true });
    if (ok) commit((st) => { st.decks = st.decks.filter((d) => d.id !== el.dataset.id); });
  },
  'pr-check': (form) => answer(form.querySelector('#pr-ans')?.value ?? ''),
  'pr-choice': (el) => answer(el.dataset.i),
  'pr-dunno': () => answer('', { dunno: true }),
  'pr-next': () => {
    P.pos += 1;
    P.shown = false;
    P.last = null;
    go(`practice/${P.param}`, { replace: true });
  },
  'pr-restart': () => {
    const p = P.param;
    startPractice(p);
    go(`practice/${p}`, { replace: true });
  },
  'dr-show': () => {
    D.shown = true;
    go(`drill/${D.param}`, { replace: true });
  },
  'dr-grade': (el) => {
    const known = el.dataset.v === '1';
    const card = cardsAll().find((c) => c.id === D.ids[D.pos]);
    if (card) {
      commit((st) => {
        const ch = gradeCard(st, card, known);
        if (ch) D.changes.push(ch);
      });
      D.total += 1;
      if (known) D.known += 1;
      else D.ids = requeue(D.ids, D.pos, card.id);
    }
    D.pos += 1;
    D.shown = false;
    go(`drill/${D.param}`, { replace: true });
  },
  'dr-restart': () => {
    const p = D.param;
    D = null;
    go(`drill/${p}`, { replace: true });
  },
  'imp-copy': async () => {
    const ok = await copyText(TEMPLATE);
    toast(ok ? 'Шаблон скопирован.' : 'Не получилось скопировать — выдели текст вручную.');
  },
  'imp-parse': () => {
    IMP.text = document.getElementById('imp-text')?.value ?? IMP.text;
    IMP.drafts = parseTasks(IMP.text, store.state);
    if (!IMP.drafts.length) toast('Не нашёл ни одного «Вопрос:». Посмотри на шаблон выше.');
    go('import', { replace: true });
  },
  'imp-save': () => {
    const good = IMP.drafts.filter((d) => d.ok);
    commit((st) => {
      for (const d of good) {
        const task = { ...d.task };
        if (!task.topic && task.topicName) {
          let t = st.topics.find((x) => x.subject === task.subject && x.name.toLowerCase() === task.topicName.toLowerCase());
          if (!t) {
            t = { id: uid('tp'), subject: task.subject, name: task.topicName, status: 'new', note: '', example: false };
            st.topics.push(t);
          }
          task.topic = t.id;
        }
        delete task.topicName;
        st.customTasks.push(task);
      }
    });
    toast(`Добавлено заданий: ${good.length}.`);
    IMP.text = '';
    IMP.drafts = [];
    go('topics');
  },
};
