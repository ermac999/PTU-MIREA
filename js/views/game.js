/* =====================================================================
   «Спираль»: экран игры семестра (миры-предметы на витке спирали)
   и экран отдельного мира (его игры или «мир строится»).
   ===================================================================== */

import { esc, plural } from '../util.js';
import { icon } from '../ui.js';
import { moduleHref } from '../modules.js';
import { GAME_TITLE, WORLDS, gameTotals, gamesOf, worldById, worldProgress } from '../game.js';
import { startDust } from './home.js';

const ROW = 128; // высота витка: карточка 108px + зазор 20px (см. .worlds в app.css)

/** Волна, проходящая через центры карточек миров. */
function pathSvg(n) {
  const h = n * ROW;
  let d = `M50 0`;
  for (let i = 0; i < n; i += 1) {
    const y = i * ROW + ROW / 2;
    const x = i % 2 ? 72 : 28;
    d += ` S ${x} ${y - ROW / 3}, ${x} ${y}`;
  }
  d += ` S 50 ${h - 10}, 50 ${h}`;
  return `<svg class="w-path" viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}"/></svg>`;
}

const pct = (p) => (p && p.maxStars ? Math.round((p.stars / p.maxStars) * 100) : 0);

function worldCard(w, i) {
  const p = worldProgress(w);
  const games = gamesOf(w);
  return `<button class="world ${i % 2 ? 'r' : 'l'}" style="--wc:${w.color}" type="button" data-act="go" data-to="spiral/${w.id}">
    <span class="w-orb" aria-hidden="true"></span>
    <span class="w-body">
      <span class="w-k">виток ${i + 1} · ${esc(w.theme)}</span>
      <span class="w-t">${esc(w.title)}</span>
      ${p
        ? `<span class="w-bar"><i style="width:${pct(p)}%"></i></span><span class="w-m">${p.stars} из ${p.maxStars} ★ · ${games.length} ${plural(games.length, 'игра', 'игры', 'игр')}</span>`
        : '<span class="w-m">мир строится</span>'}
    </span>
  </button>`;
}

function renderWorlds() {
  const t = gameTotals();
  return `
    <div class="scene sc-game">
      <div class="sc-rays" aria-hidden="true"></div>
      <canvas class="sc-dust" id="sc-dust" aria-hidden="true"></canvas>
      <button class="back sc-back" type="button" data-act="go" data-to="home">${icon('back', 's')}Главная</button>
      <div class="sc-hero">
        <span class="sc-cap">игра семестра</span>
        <h1 class="sc-title">${esc(GAME_TITLE)}</h1>
        <svg class="sc-num small" viewBox="0 0 600 300" role="img" aria-label="${t.stars} звёзд"><text x="300" y="235" text-anchor="middle">${t.stars}</text></svg>
        <span class="sc-cap">${plural(t.stars, 'звезда', 'звезды', 'звёзд')} · ${esc(t.rank)}${t.next ? ` · до «${esc(t.next.name)}» ${t.next.at - t.stars}` : ''}</span>
      </div>
      <div class="sc-floor" aria-hidden="true"></div>
    </div>
    <section class="worlds">
      ${pathSvg(WORLDS.length)}
      ${WORLDS.map(worldCard).join('')}
    </section>
    <p class="small muted" style="margin:0">Каждый предмет — виток спирали. Пустые миры наполнятся, когда появятся игры и задачи по твоим практикам.</p>`;
}

function gameCard(m, w) {
  const p = m.progress?.();
  const ext = moduleHref(m) !== m.href;
  return `<a class="world-game" style="--wc:${w.color}" href="${esc(moduleHref(m))}"${ext ? ' target="_blank" rel="noopener"' : ''}>
    <span class="w-k">${esc(m.kind)}</span>
    <span class="w-t">${esc(m.title)}</span>
    <span class="w-m">${esc(m.about)}</span>
    ${p ? `<span class="w-bar"><i style="width:${pct(p)}%"></i></span><span class="w-m">${esc(p.label)}</span>` : ''}
    <span class="w-go">${icon('play', 's')}Играть</span>
  </a>`;
}

function renderWorld(w) {
  const games = gamesOf(w);
  const p = worldProgress(w);
  const n = WORLDS.indexOf(w) + 1;
  return `
    <div class="scene sc-world" style="--wc:${w.color}">
      <div class="sc-rays" aria-hidden="true"></div>
      <canvas class="sc-dust" id="sc-dust" aria-hidden="true"></canvas>
      <button class="back sc-back" type="button" data-act="go" data-to="spiral">${icon('back', 's')}${esc(GAME_TITLE)}</button>
      <div class="sc-hero">
        <span class="w-orb big" aria-hidden="true"></span>
        <span class="sc-cap">виток ${n} · ${esc(w.theme)}</span>
        <h1 class="sc-title">${esc(w.title)}</h1>
        <span class="sc-cap">${p ? `${p.stars} из ${p.maxStars} ★` : 'мир строится'}</span>
      </div>
      <div class="sc-floor" aria-hidden="true"></div>
    </div>
    <p class="lead small">${esc(w.about)}</p>
    ${games.length
      ? `<section class="cards-grid">${games.map((m) => gameCard(m, w)).join('')}</section>`
      : `<section class="world-empty" style="--wc:${w.color}">
          <span class="w-t">Мир строится</span>
          <span class="w-m">Здесь будет игра по ${esc(w.title.toLowerCase() === 'история' ? 'истории' : `предмету «${w.title}»`)} в общем стиле «Спирали». Пока — теория и задачи на странице предмета.</span>
          <button class="btn ghost small" type="button" data-act="go" data-to="subject/${esc(w.subject)}">Теория и задачи →</button>
        </section>`}`;
}

export function renderSpiral([id]) {
  const w = id ? worldById(id) : null;
  return w ? renderWorld(w) : renderWorlds();
}

export const mountSpiral = () => startDust();
