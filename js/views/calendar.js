/* =====================================================================
   Главный экран — месячный календарь.
   Метки дедлайнов по цвету типа, перегруженные дни заштрихованы.
   ===================================================================== */

import { EVENT_TYPES } from '../config.js';
import { store } from '../store.js';
import { dayLoad } from '../planner.js';
import { addDays, dateOf, esc, humanDate, monthName, pad2, plural } from '../util.js';
import { icon } from '../ui.js';
import { go } from '../nav.js';
import { eventRow, getSim, today, upcoming } from './shared.js';

let shown = null; // 'ГГГГ-ММ' — какой месяц открыт

function monthGrid(y, m) {
  const first = `${y}-${pad2(m)}-01`;
  const start = addDays(first, -((dateOf(first).getDay() + 6) % 7)); // с понедельника
  const last = `${y}-${pad2(m)}-${pad2(new Date(y, m, 0).getDate())}`;
  const end = addDays(last, (7 - dateOf(last).getDay()) % 7);
  const days = [];
  for (let k = start; k <= end; k = addDays(k, 1)) days.push(k);
  return days;
}

export function renderCalendar() {
  const t = today();
  if (!shown) shown = t.slice(0, 7);
  const [y, m] = shown.split('-').map(Number);
  const sim = getSim();
  const shortageDates = new Set(sim.shortages.map((s) => s.deadline));
  const prefix = `${y}-${pad2(m)}`;

  const cells = monthGrid(y, m).map((k) => {
    const load = dayLoad(store.state, k, shortageDates);
    const evs = load.evs.filter((e) => !e.done);
    const n = dateOf(k).getDate();
    const label = `${humanDate(k)}${evs.length ? `, ${evs.length} ${plural(evs.length, 'событие', 'события', 'событий')}: ${evs.map((e) => EVENT_TYPES[e.type]?.label).join(', ')}` : ''}${load.level === 3 ? ', перегружен' : ''}`;
    return `<button class="d ${k === t ? 'today' : ''} ${k.startsWith(prefix) ? '' : 'out'} ${load.level >= 2 ? `lv${load.level}` : ''}" type="button"
        data-act="go" data-to="day/${k}" aria-label="${esc(label)}">
      <span class="n">${n}</span>
      <span class="mk">${evs.slice(0, 3).map((e) => `<i class="t-${esc(e.type)}"></i>`).join('')}${evs.length > 3 ? '<b class="tiny">+</b>' : ''}</span>
      ${load.level === 3 ? '<span class="ov" aria-hidden="true">!</span>' : ''}
    </button>`;
  }).join('');

  const next = upcoming(45).slice(0, 6);
  const hot = sim.shortages.length;

  return `
    <header class="head">
      <div class="head-row">
        <span class="eyebrow">План семестра</span>
        <button class="btn small ghost" type="button" data-act="go" data-to="burning">${icon('flame', 's')}Горит${hot ? ` · ${hot}` : ''}</button>
      </div>
      <h1 class="display">Календарь</h1>
    </header>

    <div class="cols"><div class="col w2">
    <section aria-label="Месяц">
      <div class="cal-nav">
        <button class="ibtn" type="button" data-act="cal-move" data-d="-1" aria-label="Предыдущий месяц">${icon('back')}</button>
        <span class="m">${monthName(m - 1)} ${y}</span>
        <button class="ibtn" type="button" data-act="cal-move" data-d="1" aria-label="Следующий месяц">${icon('chev')}</button>
      </div>
      <div class="cal" role="grid">
        ${['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((w) => `<div class="cal-wd" role="columnheader">${w}</div>`).join('')}
        ${cells}
      </div>
      <div class="legend" aria-label="Обозначения">
        ${['kr', 'lab', 'zachet', 'session', 'dz'].map((tp) => `<span><i class="dot t-${tp}"></i>${EVENT_TYPES[tp].label}</span>`).join('')}
        <span><i class="hatch"></i>Перегружено</span>
      </div>
      ${shown !== t.slice(0, 7) ? `<button class="btn quiet small" type="button" data-act="cal-today">К сегодняшнему месяцу</button>` : ''}
    </section>
    </div><div class="col">
    <section>
      <div class="sec-row"><h2 class="sec">Ближайшее</h2><button class="btn quiet small" type="button" data-act="go" data-to="day/${t}">Сегодня по часам →</button></div>
      ${next.length ? `<div>${next.map((e) => eventRow(e)).join('')}</div>` : '<p class="lead">В ближайшие полтора месяца дедлайнов нет. Добавь, когда узнаешь.</p>'}
      <div class="row">
        <button class="btn" type="button" data-act="event-new" data-date="${t}">${icon('plus', 's')}Дедлайн</button>
        <button class="btn ghost" type="button" data-act="deadlines-paste">${icon('paste', 's')}Вставить текстом</button>
      </div>
    </section>
    </div></div>`;
}

export const calendarActions = {
  'cal-move': (el) => {
    const [y, m] = (shown || today().slice(0, 7)).split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
    shown = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    go('calendar', { replace: true });
  },
  'cal-today': () => {
    shown = today().slice(0, 7);
    go('calendar', { replace: true });
  },
};
