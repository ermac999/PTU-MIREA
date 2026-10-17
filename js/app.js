/* =====================================================================
   «Рамки» — точка входа: загрузка данных, маршруты, нижнее меню,
   обработка нажатий, офлайн-режим (service worker).
   ===================================================================== */

import { CONFIG } from './config.js';
import { commit, loadState, onChange, persistNow, store } from './store.js';
import { loadBank } from './bank.js';
import { go, initNav, route, setRenderer } from './nav.js';
import { closeSheet, icon, sheetIsOpen } from './ui.js';
import { buildTodayPlan, catchUpWindow, streakInfo, subjectOf } from './planner.js';
import { daysBetween, esc, humanDate, minutesNow, plural } from './util.js';
import { blockActionHandlers, ensureTodayPlan, today } from './views/shared.js';
import { calendarActions, renderCalendar } from './views/calendar.js';
import { eventActions } from './views/events.js';
import { dayActions, renderDay } from './views/day.js';
import { ensureTicker, paintTimer, renderBurning, renderToday, todayActions } from './views/today.js';
import {
  rememberToggle, renderCards, renderDrill, renderImport, renderPractice, renderTopic, renderTopics, topicsActions, topicsInputs,
} from './views/topics.js';
import {
  applyLook, mountSettings, renderAttendance, renderClasses, renderSettings, renderSubjects, settingsActions,
} from './views/settings.js';

const ROUTES = {
  calendar: { tab: 'calendar', title: 'Календарь', render: renderCalendar },
  day: { tab: 'calendar', title: 'День', render: renderDay, scrollToNow: true },
  burning: { tab: 'calendar', title: 'Горит', render: renderBurning },
  today: { tab: 'today', title: 'Сегодня', render: renderToday },
  topics: { tab: 'topics', title: 'Темы', render: renderTopics },
  topic: { tab: 'topics', title: 'Тема', render: renderTopic },
  practice: { tab: 'topics', title: 'Отработка', render: renderPractice },
  cards: { tab: 'topics', title: 'Карточки', render: renderCards },
  drill: { tab: 'topics', title: 'Карточки', render: renderDrill },
  import: { tab: 'topics', title: 'Добавить задания', render: renderImport },
  settings: { tab: 'settings', title: 'Настройки', render: renderSettings, mount: mountSettings },
  subjects: { tab: 'settings', title: 'Предметы', render: renderSubjects },
  classes: { tab: 'settings', title: 'Пары', render: renderClasses },
  attendance: { tab: 'settings', title: 'Посещаемость', render: renderAttendance },
};

const TABS = [
  ['calendar', 'Календарь', 'calendar'],
  ['today', 'Сегодня', 'today'],
  ['topics', 'Темы', 'topics'],
  ['settings', 'Настройки', 'settings'],
];

const actions = {
  go: (el) => go(el.dataset.to),
  'intro-dismiss': () => commit((st) => { st.settings.introSeen = true; }),
  'update-dismiss': () => commit((st) => { st.settings.updateSeen = CONFIG.noteVersion; }),
  ...blockActionHandlers, ...calendarActions, ...eventActions, ...dayActions,
  ...todayActions, ...topicsActions, ...settingsActions,
};
const inputs = { ...topicsInputs };

/* ---------- Отрисовка ---------- */

function renderStrip() {
  const st = store.state;
  const t = today();
  const s = streakInfo(st, t);
  const session = st.events.find((e) => e.type === 'session' && !e.done);
  const left = session ? daysBetween(t, session.date) : null;
  document.getElementById('strip').innerHTML = `<div class="strip-in">
    <span>Серия <b>${s.streak}</b></span>
    ${left != null && left >= 0 ? `<span>До сессии <b>${session.confirmed ? '' : '~'}${left}</b> ${plural(left, 'день', 'дня', 'дней')}</span>` : ''}
    <span>Сон ≥ <b>${String(st.settings.minSleepHours).replace('.', ',')} ч</b></span>
    <span id="strip-timer" hidden></span>
  </div>`;
}

function renderNav(tab) {
  document.getElementById('nav').innerHTML = `<div class="nav-in">${TABS.map(([id, label, ic]) => `
    <a href="#${id}" data-act="go" data-to="${id}" ${tab === id ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`).join('')}</div>`;
}

function updateNote() {
  const seen = Number(store.state.settings.updateSeen) || 0;
  const hist = subjectOf(store.state, 'hist');
  const parts = [];
  if (seen < 2) {
    parts.push('Учёл отставание: физика и информатика — около 8 дней (догоняем по ~4,5 ч за 3 недели), остальные предметы — 1–2 дня, история — с нуля, по темам докладов (~12,5 ч). Воскресенье 18.10 — подготовка к КР по линалу.');
  }
  if (seen < 3) {
    const until = hist ? ` до ${humanDate(catchUpWindow(hist, today()).until)}` : '';
    parts.push(`Сессия — в конце декабря (дата примерная, 22.12), поэтому историю растянул${until}: около 1,5 ч в неделю.`);
  }
  if (seen < 4) {
    parts.push('Лабы по физике: к допуску готовиться не нужно, в плане только доделать прошлую лабу — досчитать и ответить на контрольные вопросы (~1,5 ч). Время можно поправить в карточке события.');
  }
  if (seen < 5) {
    parts.push('Добавил контрольную по информатике в пятницу 23.10 (время — по первой паре, 16:20). Неделя очень плотная: что не влезает и что сократить — на экране «Горит».');
  }
  return `<div class="note"><b>Обновление плана.</b> ${parts.join(' ')} Поправить — «Настройки → Предметы».
    <button class="btn quiet small" type="button" data-act="update-dismiss">Понятно</button></div>`;
}

function introNote() {
  const s = store.state.settings;
  if ((Number(s.updateSeen) || 0) < CONFIG.noteVersion) return updateNote(); // что изменилось — важнее приветствия
  if (s.introSeen) return '';
  return `<div class="note"><b>Данные из опроса уже внутри:</b> режим недели, пары, предметы, дедлайны, отставание по предметам и темы истории по докладам. Мои предположения — отбой в чт и пт, подъём в вс, «иностранный = немецкий», дата сессии — поправь в «Настройках», если не так. Задания и карточки с пометкой «пример» — для старта.
    <button class="btn quiet small" type="button" data-act="intro-dismiss">Понятно</button></div>`;
}

let rendering = false;

function render() {
  if (rendering) return;
  rendering = true;
  const view = document.getElementById('view');
  try {
    ensureTodayPlan();
    if (!ROUTES[route.name]) {
      route.name = 'calendar';
      route.params = [];
    }
    const def = ROUTES[route.name];
    view.innerHTML = (route.name === 'calendar' || route.name === 'today' ? introNote() : '') + def.render(route.params || []);
    renderStrip();
    renderNav(def.tab);
    document.title = `${def.title} · ${CONFIG.appName}`;
    if (route.changed) {
      route.changed = false;
      window.scrollTo(0, 0);
      def.mount?.(route.params);
      if (def.scrollToNow) document.getElementById('tl-now')?.scrollIntoView({ block: 'center' });
    }
    paintTimer();
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="note danger">Экран не отрисовался: ${esc(e.message)}. Данные целы.
      <button class="btn small" type="button" data-act="go" data-to="calendar">На главный</button></div>`;
  } finally {
    rendering = false;
  }
}

// Не перерисовывать, пока человек печатает в поле на экране — дождаться, пока уберёт фокус.
let pending = false;
let raf = 0;
const typing = () => {
  const a = document.activeElement;
  return !!a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !!a.closest('#view');
};
function scheduleRender() {
  if (typing()) {
    pending = true;
    return;
  }
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    render();
  });
}
document.addEventListener('focusout', () => {
  if (!pending) return;
  pending = false;
  setTimeout(scheduleRender, 0);
});

/* ---------- Нажатия ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.dataset.act === 'go' && sheetIsOpen()) closeSheet(true);
  fn(el, e);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('[data-submit]');
  if (!f) return;
  e.preventDefault();
  actions[f.dataset.submit]?.(f, e);
});
document.addEventListener('toggle', (e) => rememberToggle(e.target), true); // toggle не всплывает — ловим на погружении
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-input]');
  if (el) inputs[el.dataset.input]?.(el, e);
});

/* ---------- Запуск ---------- */

function registerServiceWorker() {
  if (globalThis.__RAMKI_PREVIEW__ || !('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !local) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => { /* без офлайна — тоже работает */ });
  // Новая версия встала в кэш — один раз перезапустить экран, чтобы не приходилось закрывать приложение дважды.
  // Если человек печатает или открыта шторка — не трогаем: новая версия подхватится при следующем запуске.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || typing() || sheetIsOpen()) return;
    try {
      if (sessionStorage.getItem('ramki.reloaded')) return;
      sessionStorage.setItem('ramki.reloaded', '1');
    } catch { return; }
    persistNow();
    location.reload();
  });
}

function start() {
  loadState();
  if (store.migratedFrom) {
    // данные обновились — пересобрать остаток сегодняшнего плана (отметки и прошедшие блоки остаются)
    const t = today();
    if (store.state.plans[t]) commit((st) => { st.plans[t] = buildTodayPlan(st, t, minutesNow()); }, { silent: true });
  }
  applyLook();
  document.documentElement.classList.add('motion');
  initNav('calendar');
  setRenderer(render);
  onChange(scheduleRender);
  render();
  loadBank().then(scheduleRender);
  ensureTicker();
  registerServiceWorker();

  // Раз в 5 минут обновить «сейчас» на ленте; после полуночи — новый день.
  let lastTick = `${today()}|${Math.floor(minutesNow() / 5)}`;
  setInterval(() => {
    const k = `${today()}|${Math.floor(minutesNow() / 5)}`;
    if (k === lastTick || sheetIsOpen() || typing()) return;
    lastTick = k;
    if (['calendar', 'day', 'today', 'burning'].includes(route.name)) scheduleRender();
  }, 30000);

  window.addEventListener('pagehide', persistNow);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persistNow();
    else {
      scheduleRender();
      paintTimer();
    }
  });
}

start();
