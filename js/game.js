/* =====================================================================
   «Спираль» — одна игра семестра на все предметы. Каждый предмет — мир
   (виток спирали) со своей темой и цветом; внутри — игры этого предмета
   (js/modules.js). Пустые миры ждут игр и задач по практикам.
   ===================================================================== */

import { MODULES } from './modules.js';

export const GAME_TITLE = 'Спираль';

export const WORLDS = [
  { id: 'phys', subject: 'phys', title: 'Физика', theme: 'Траектории', color: '#5aa9e6', about: 'Скорость, ускорение, падение, бросок под углом — от км/ч до вузовской кинематики.' },
  { id: 'inf', subject: 'inf', title: 'Информатика', theme: 'Кварц-8', color: '#4fd18b', about: 'Биты, коды, ошибки и системы счисления: чини модули старой ЭВМ.' },
  { id: 'linal', subject: 'linal', title: 'Линал', theme: 'Матрицы', color: '#b46cf0', about: 'Определители, Крамер, обратная матрица, Гаусс, векторы.' },
  { id: 'matan', subject: 'matan', title: 'Матан', theme: 'Пределы', color: '#f0a04f', about: 'Пределы, производные, исследование функций.' },
  { id: 'matlog', subject: 'matlog', title: 'Матлогика', theme: 'Истина и ложь', color: '#e8668f', about: 'Высказывания, таблицы истинности, ДНФ и КНФ.' },
  { id: 'hist', subject: 'hist', title: 'История', theme: 'Летопись', color: '#c9a35b', about: 'От Рюрика до Александра Невского — темы докладов.' },
];

export const worldById = (id) => WORLDS.find((w) => w.id === id) || null;
export const gamesOf = (w) => MODULES.filter((m) => m.subject === w.subject);

/** Прогресс мира: звёзды всех его игр. Пустой мир — null. */
export function worldProgress(w) {
  const games = gamesOf(w);
  if (!games.length) return null;
  const ps = games.map((m) => m.progress?.() || { stars: 0, maxStars: 0, done: 0, total: 0 });
  const sum = (k) => ps.reduce((a, p) => a + (p[k] || 0), 0);
  return { stars: sum('stars'), maxStars: sum('maxStars'), done: sum('done'), total: sum('total') };
}

/** Звания по общему числу звёзд. */
const RANKS = [[0, 'Первокурсник'], [15, 'Ученик'], [40, 'Знаток'], [80, 'Отличник'], [130, 'Профессор'], [190, 'Магистр спирали']];

export function gameTotals() {
  let stars = 0;
  let maxStars = 0;
  for (const w of WORLDS) {
    const p = worldProgress(w);
    if (p) { stars += p.stars; maxStars += p.maxStars; }
  }
  let i = 0;
  while (i + 1 < RANKS.length && stars >= RANKS[i + 1][0]) i += 1;
  return { stars, maxStars, rank: RANKS[i][1], next: RANKS[i + 1] ? { at: RANKS[i + 1][0], name: RANKS[i + 1][1] } : null };
}
