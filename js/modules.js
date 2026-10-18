/* =====================================================================
   Учебные модули — отдельные страницы в папке modules/: игры и тренажёры,
   в том числе перенесённые из артефактов Claude. Каждый привязан к предмету
   и темам. Прогресс модули хранят в localStorage этого же сайта, поэтому
   «Рамки» могут его показать (и подложить перенесённый прогресс заранее).
   ===================================================================== */

const isPreview = () => !!globalThis.__RAMKI_PREVIEW__; // как в ui.js; свой, чтобы модуль грузился и в тестах

const SITE = 'https://ermac999.github.io/PTU-MIREA/';

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
];

export const modulesFor = ({ subject = null, topic = null } = {}) =>
  MODULES.filter((m) => (!subject || m.subject === subject) && (!topic || m.topics.includes(topic)));

/** Темы «не начал», по которым игра уже начата (есть звёзды): их пора отметить «учу». */
export function startedTopics(state) {
  const ids = new Set(MODULES.filter((m) => m.progress?.().done > 0).flatMap((m) => m.topics));
  return state.topics.filter((t) => ids.has(t.id) && t.status === 'new').map((t) => t.id);
}

/** Ссылка на модуль: на сайте — относительная, в превью (артефакт) — на сайт в новой вкладке. */
export const moduleHref = (m) => (isPreview() ? SITE + m.href : m.href);

/**
 * Перенесённый прогресс: если на этом устройстве модуль ещё не открывали,
 * кладём сохранённый прогресс заранее — «Рамки» сразу покажут звёзды, а игра продолжит с того же места.
 */
export async function seedModules() {
  if (isPreview()) return;
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
