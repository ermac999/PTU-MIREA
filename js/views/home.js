/* =====================================================================
   Главная: четыре раздела — Календарь, Предметы, Развлечения, Проекты.
   Сцена в духе INRA 70 ans: светлая дымка, лучи, пыль, огромная мягкая цифра
   (дней до сессии) и спираль ДНК, на которой стоят разделы.
   ===================================================================== */

import { store } from '../store.js';
import { catchUpDone, catchUpTotal } from '../planner.js';
import { daysBetween, esc, plural, relDays } from '../util.js';
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

/* ---------- Сцена главной: дымка, лучи, пыль, спираль с разделами (по мотивам INRA 70 ans) ---------- */

const reduced = () => document.documentElement.dataset.motion === 'none'
  || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Огромная мягкая цифра: тонкий шрифт + толстая круглая обводка = скруглённые «пухлые» цифры. */
const bigNumber = (n) => `<svg class="sc-num" viewBox="0 0 600 300" role="img" aria-label="${n}">
    <text x="300" y="235" text-anchor="middle">${n}</text>
  </svg>`;

/** Спираль ДНК: две ленты в противофазе и перекладины; пересечения — в 20, 40, 60, 80 % ширины. */
function helix() {
  const W = 1000, H = 240, A = 64, C = H / 2, waves = 2.5;
  const y = (x, ph) => (C + A * Math.sin((x / W) * Math.PI * 2 * waves + ph)).toFixed(1);
  const strand = (ph) => Array.from({ length: W / 10 + 1 }, (_, i) => `${i ? 'L' : 'M'}${i * 10} ${y(i * 10, ph)}`).join('');
  let rungs = '';
  for (let x = 8; x < W; x += 14) rungs += `M${x} ${y(x, 0)}L${x} ${y(x, Math.PI)}`;
  return `<svg class="sc-helix-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <path class="h-rung" d="${rungs}"/>
      <path class="h-strand back" d="${strand(Math.PI)}"/>
      <path class="h-stripe back" d="${strand(Math.PI)}"/>
      <path class="h-strand" d="${strand(0)}"/>
      <path class="h-stripe" d="${strand(0)}"/>
      <path class="h-accent a" d="M60 135 C 110 95, 160 100, 200 125 S 260 150, 300 118"/>
      <path class="h-accent b" d="M780 150 C 830 170, 880 120, 930 116 S 975 124, 1000 108"/>
    </svg>`;
}

const node = (to, left, side, title, sub) => `<button class="sc-node ${side}" style="left:${left}%" type="button" data-act="go" data-to="${to}">
    <span class="sc-node-t">${esc(title)}</span>${sub ? `<span class="sc-node-m">${esc(sub)}</span>` : ''}
  </button><i class="sc-dot" style="left:${left}%" aria-hidden="true"></i>`;

export function renderHome() {
  const st = store.state;
  const t = today();
  const next = upcoming(60).find((e) => e.type !== 'session');
  const session = st.events.find((e) => e.type === 'session' && !e.done);
  const left = session ? Math.max(0, daysBetween(t, session.date)) : null;
  const subjects = st.subjects.filter((s) => !s.noStudy);
  const behind = subjects.filter((s) => catchUpTotal(st, s) > catchUpDone(st, s)).length;
  const projects = artifactsIn('project').length;
  return `
    <div class="scene" id="scene">
      <div class="sc-rays" aria-hidden="true"></div>
      <canvas class="sc-dust" id="sc-dust" aria-hidden="true"></canvas>
      <div class="sc-hero">
        ${left != null ? bigNumber(left) : ''}
        <span class="sc-cap">${left != null ? `${plural(left, 'день', 'дня', 'дней')} до сессии` : 'Рамки'}</span>
      </div>
      <div class="sc-helix">
        ${helix()}
        ${node('calendar', 20, 'up', 'Календарь', next ? relDays(t, next.date) : '')}
        ${node('topics', 40, 'down', 'Предметы', behind ? `догоняю ${behind}` : '')}
        ${node('fun', 60, 'up', 'Развлечения', 'шахматы и КС')}
        ${node('projects', 80, 'down', 'Проекты', `${projects}`)}
      </div>
      <div class="sc-floor" aria-hidden="true"></div>
    </div>
    <section class="sc-below">
      <div class="tiles">
        ${tile('calendar', 'calendar', 'Календарь', next ? `${eventTitle(next)} · ${relDays(t, next.date)}` : 'Дедлайнов не видно')}
        ${tile('topics', 'topics', 'Предметы', `${subjects.length} ${plural(subjects.length, 'предмет', 'предмета', 'предметов')}${behind ? ` · догоняю ${behind}` : ''} · игр ${MODULES.length}`)}
        ${tile('fun', 'game', 'Развлечения', 'Шахматы и КС')}
        ${tile('projects', 'edit', 'Проекты', `${projects} ${plural(projects, 'проект', 'проекта', 'проектов')}`)}
      </div>
    </section>`;
}

/* Пылинки в лучах: живут, пока на экране есть холст; переживают перерисовку экрана. */
let dustRaf = 0;
function startDust() {
  if (dustRaf || reduced()) return;
  const parts = Array.from({ length: 42 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.6, s: 0.012 + Math.random() * 0.03, a: 0.2 + Math.random() * 0.55, ph: Math.random() * 6.28 }));
  let last = 0;
  let color = '#fff';
  const tick = (now) => {
    const c = document.getElementById('sc-dust');
    if (!c) { dustRaf = 0; return; }
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      color = window.getComputedStyle(c).color;
    }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = color;
    for (const p of parts) {
      p.y -= p.s * dt;
      p.x += Math.sin(now / 3000 + p.ph) * 0.004 * dt;
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      g.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(now / 1200 + p.ph));
      g.beginPath();
      g.arc(p.x * w, p.y * h, p.r, 0, 6.283);
      g.fill();
    }
    dustRaf = requestAnimationFrame(tick);
  };
  dustRaf = requestAnimationFrame(tick);
}

/** Заставка при первом открытии за сессию: цифра всплывает из тумана и растворяется. Тап — пропустить. */
function splash() {
  try {
    if (sessionStorage.getItem('ramki.splash')) return;
    sessionStorage.setItem('ramki.splash', '1');
  } catch { return; }
  if (reduced()) return;
  const session = store.state.events.find((e) => e.type === 'session' && !e.done);
  const left = session ? Math.max(0, daysBetween(today(), session.date)) : null;
  const el = document.createElement('div');
  el.className = 'splash';
  el.innerHTML = `<div class="sc-rays" aria-hidden="true"></div>${left != null ? bigNumber(left) : ''}<span class="sc-cap">${left != null ? `${plural(left, 'день', 'дня', 'дней')} до сессии` : 'Рамки'}</span><div class="sc-floor" aria-hidden="true"></div>`;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 800); };
  el.addEventListener('click', close);
  document.body.appendChild(el);
  setTimeout(close, 1600);
}

export function mountHome() {
  splash();
  startDust();
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
