/* =====================================================================
   Главная: четыре раздела — Календарь, Предметы, Развлечения, Проекты.
   Пока сырой скелет: структура есть, красоту и единый стиль — потом.
   ===================================================================== */

import { store } from '../store.js';
import { catchUpDone, catchUpTotal } from '../planner.js';
import { esc, plural, relDays } from '../util.js';
import { icon } from '../ui.js';
import { MODULES } from '../modules.js';
import { ARTIFACTS, artifactsIn } from '../portal.js';
import { eventTitle, today, upcoming } from './shared.js';

const tile = (to, ic, title, sub) => `<button class="tile" type="button" data-act="go" data-to="${to}">
    <span class="tile-ic">${icon(ic)}</span>
    <span class="tile-t">${esc(title)}</span>
    <span class="tile-m">${esc(sub)}</span>
  </button>`;

const linkCard = (a) => `<a class="mod" href="${esc(a.url)}" target="_blank" rel="noopener">
    <span class="mod-k">${icon('target', 's')}артефакт</span>
    <span class="t">${esc(a.title)}</span>
    ${a.about ? `<span class="m">${esc(a.about)}</span>` : ''}
    <span class="mod-go">Открыть в Claude →</span>
  </a>`;

export function renderHome() {
  const st = store.state;
  const next = upcoming(60).find((e) => e.type !== 'session');
  const subjects = st.subjects.filter((s) => !s.noStudy);
  const behind = subjects.filter((s) => catchUpTotal(st, s) > catchUpDone(st, s)).length;
  return `
    <header class="head">
      <span class="eyebrow">Рамки</span>
      <h1 class="display">Главная</h1>
    </header>
    <div class="tiles">
      ${tile('calendar', 'calendar', 'Календарь', next ? `${eventTitle(next)} · ${relDays(today(), next.date)}` : 'Дедлайнов не видно')}
      ${tile('topics', 'topics', 'Предметы', `${subjects.length} ${plural(subjects.length, 'предмет', 'предмета', 'предметов')}${behind ? ` · догоняю ${behind}` : ''} · игр ${MODULES.length}`)}
      ${tile('fun', 'game', 'Развлечения', 'Шахматы и КС')}
      ${tile('projects', 'edit', 'Проекты', `${artifactsIn('project').length} ${plural(artifactsIn('project').length, 'проект', 'проекта', 'проектов')}`)}
    </div>
    <p class="small muted" style="margin:0">Сырая версия: разделы на месте, красоту наведём потом.</p>`;
}

export function renderFun() {
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="home">${icon('back', 's')}Главная</button>
      <span class="eyebrow">Отдых после учёбы</span>
      <h1 class="display m">Развлечения</h1>
    </header>
    <section>
      <div class="sec-row"><h2 class="sec">Шахматы</h2></div>
      ${artifactsIn('chess').map(linkCard).join('')}
    </section>
    <section>
      <div class="sec-row"><h2 class="sec">Counter-Strike</h2></div>
      <p class="small muted" style="margin:0">Игра стоит в плане вечером — после учебных блоков и за 30 минут до отбоя. Смотри «Сегодня».</p>
    </section>`;
}

export function renderProjects() {
  const list = artifactsIn('project');
  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="home">${icon('back', 's')}Главная</button>
      <span class="eyebrow">Что я сделал в Claude</span>
      <h1 class="display m">Проекты</h1>
    </header>
    <section>${list.map(linkCard).join('')}</section>
    <p class="small muted" style="margin:0">Пока открываются в Claude (нужен вход). Потом перенесём внутрь сайта и уберём лишнее. Игры по предметам — в «Предметах»: ${esc(MODULES.map((m) => m.title).join(', '))}. Всего артефактов в разделах: ${ARTIFACTS.length}.</p>`;
}
