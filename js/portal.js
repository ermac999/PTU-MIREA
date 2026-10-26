/* =====================================================================
   Твои артефакты из Claude, которые ещё не перенесены внутрь сайта:
   пока открываются по ссылке на claude.ai (нужен вход в аккаунт).
   Перенесённые внутрь живут в js/modules.js (игры по предметам) и в SITE_APPS
   ниже. area: 'chess' — Развлечения → Шахматы, 'project' — Проекты.
   ===================================================================== */

/** Перенесённые на сайт приложения: открываются здесь же, без входа в Claude, прогресс хранится на устройстве. */
export const SITE_APPS = [
  { id: 'chess', area: 'chess', icon: 'game', title: 'Дебютная тетрадь', about: 'Шахматы: дебюты, спарринг с тренером, задачи из твоих ошибок, партии чемпионов. 3 стиля и 9 досок.', href: 'modules/chess/index.html', storageKey: 'debut-notebook-v1' },
  { id: 'podhod', area: 'project', icon: 'dumbbell', title: 'Подход', about: 'Тренировки и питание: план на 3 или 4 дня, подходы с подсказкой веса, рекорды, вес тела, калории и вода. Работает без интернета.', href: 'modules/podhod/index.html', storageKey: 'podkhod:profile' },
];

export const ARTIFACTS = [
  { id: 'kr1-trainer', area: 'project', title: 'Тренажёр к контрольной №1', about: '', url: 'https://claude.ai/artifact/RWczbu5rXirThZggQU5mLc' },
  { id: 'radik-drop', area: 'project', title: 'RADIK DROP', about: '', url: 'https://claude.ai/artifact/BBv6tYhUtKKtoDwekowEXE' },
  { id: 'samost-1', area: 'project', title: 'Самостоятельная №1 — Вариант 4', about: '', url: 'https://claude.ai/artifact/WgCs1FqVjXuSCjXdkot5AZ' },
  { id: 'kin-15', area: 'project', title: 'Кинематика за 15 минут', about: '', url: 'https://claude.ai/artifact/S6oW5VUxgx1a3DkA4JRe39' },
];

export const artifactsIn = (area) => ARTIFACTS.filter((a) => a.area === area);
export const appsIn = (area) => SITE_APPS.filter((a) => a.area === area);
