/* =====================================================================
   Учебные модули — отдельные страницы в папке modules/: игры и тренажёры,
   в том числе перенесённые из артефактов Claude. Каждый привязан к предмету
   и темам. Прогресс модули хранят в localStorage этого же сайта, поэтому
   «Рамки» могут его показать (и подложить перенесённый прогресс заранее).
   ===================================================================== */



function readJson(key) {
  try {
    const s = globalThis.localStorage?.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Прогресс «Кинематики на зачёт»: звёзды за 16 уровней (15 + финал). */
function kinematicsProgress() {
  const levels = Object.values(readJson('kin-zachet-v1')?.levels || {});
  const stars = levels.reduce((s, l) => s + (Number(l?.stars) || 0), 0);
  const done = levels.filter((l) => Number(l?.stars) > 0).length;
  return { stars, maxStars: 48, done, total: 16, label: `${stars}/48 ★ · пройдено ${done} из 16` };
}

/** «Бит за битом»: 8 модулей = 8 практик информатики; уровней в модуле (вместе с боссом). */
const BITS_LEVELS = { 1: 6, 2: 6, 3: 7, 4: 6, 5: 6, 6: 6, 7: 8, 8: 7 };

/** Прогресс «Бит за битом»: весь или по одной практике (тема inf-pN = модуль N). */
function bitsProgress(topicId = null) {
  const levels = readJson('bzb.progress.v1')?.levels || {};
  const world = /^inf-p\d+$/.test(topicId || '') ? Number(topicId.slice(5)) : null;
  let stars = 0;
  let done = 0;
  for (const [id, l] of Object.entries(levels)) {
    const m = id.match(/^w(\d+)(?:l\d+|b)$/);
    if (!m || (world && Number(m[1]) !== world)) continue;
    const s = Number(l?.stars) || 0;
    stars += s;
    if (s > 0) done += 1;
  }
  const total = world ? BITS_LEVELS[world] || 0 : Object.values(BITS_LEVELS).reduce((a, b) => a + b, 0);
  return { stars, maxStars: total * 3, done, total, label: `${world ? `модуль ${world}: ` : ''}${stars}/${total * 3} ★ · пройдено ${done} из ${total}` };
}

export const MODULES = [
  {
    id: 'kinematics',
    title: 'Кинематика на зачёт',
    kind: 'игра',
    subject: 'phys',
    topics: ['phys-1'],
    href: 'modules/kinematics/index.html',
    about: '15 уровней от км/ч до броска под углом, финальная контрольная и «нарешка» с новыми числами.',
    storageKey: 'kin-zachet-v1',
    seed: 'modules/kinematics/seed.json',
    progress: kinematicsProgress,
  },
  {
    id: 'bits',
    title: 'Бит за битом',
    kind: 'игра',
    subject: 'inf',
    topics: ['inf-p1', 'inf-p2', 'inf-p3', 'inf-p4', 'inf-p5', 'inf-p6', 'inf-p7', 'inf-p8'],
    href: 'modules/bits/index.html',
    about: 'Пульт ЭВМ «Кварц-8»: 8 модулей по практикам — информация, коды, ошибки, системы счисления, доп. код. Теория, задачи с разбором, Python.',
    storageKey: 'bzb.progress.v1',
    seed: 'modules/bits/seed.json',
    progress: bitsProgress,
  },
];

export const modulesFor = ({ subject = null, topic = null } = {}) =>
  MODULES.filter((m) => (!subject || m.subject === subject) && (!topic || m.topics.includes(topic)));

/** Темы «не начал», по которым игра уже начата (есть звёзды): их пора отметить «учу». */
export function startedTopics(state) {
  const ids = new Set(MODULES.flatMap((m) => m.topics.filter((t) => m.progress?.(t).done > 0)));
  return state.topics.filter((t) => ids.has(t.id) && t.status === 'new').map((t) => t.id);
}

/** Ссылка на модуль — относительная: и на сайте, и в артефакте игры лежат рядом со страницей. */
export const moduleHref = (m) => m.href;

/**
 * Перенесённый прогресс: если на этом устройстве модуль ещё не открывали,
 * кладём сохранённый прогресс заранее — «Рамки» сразу покажут звёзды, а игра продолжит с того же места.
 */
export async function seedModules() {
  for (const m of MODULES) {
    if (!m.seed || !m.storageKey || readJson(m.storageKey)) continue;
    try {
      const res = await fetch(m.seed, { cache: 'no-cache' });
      if (!res.ok) continue;
      const seed = await res.json();
      if (!readJson(m.storageKey)) globalThis.localStorage?.setItem(m.storageKey, JSON.stringify(seed));
    } catch { /* без сети — просто позже */ }
  }
}
