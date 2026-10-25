/* =====================================================================
   Твои артефакты из Claude, которые ещё не перенесены внутрь сайта:
   пока открываются по ссылке на claude.ai (нужен вход в аккаунт).
   Перенесённые внутрь живут в js/modules.js (игры по предметам).
   area: 'chess' — Развлечения → Шахматы, 'project' — Проекты.
   ===================================================================== */

export const ARTIFACTS = [
  { id: 'openings', area: 'chess', title: 'Дебютная тетрадь', about: 'Шахматы: дебюты, которые учу.', url: 'https://claude.ai/artifact/X14RMAYwQrrk6eUiDkCFnj' },
  { id: 'kr1-trainer', area: 'project', title: 'Тренажёр к контрольной №1', about: '', url: 'https://claude.ai/artifact/RWczbu5rXirThZggQU5mLc' },
  { id: 'radik-drop', area: 'project', title: 'RADIK DROP', about: '', url: 'https://claude.ai/artifact/BBv6tYhUtKKtoDwekowEXE' },
  { id: 'samost-1', area: 'project', title: 'Самостоятельная №1 — Вариант 4', about: '', url: 'https://claude.ai/artifact/WgCs1FqVjXuSCjXdkot5AZ' },
  { id: 'kin-15', area: 'project', title: 'Кинематика за 15 минут', about: '', url: 'https://claude.ai/artifact/S6oW5VUxgx1a3DkA4JRe39' },
  { id: 'podhod', area: 'project', title: 'Подход', about: '', url: 'https://claude.ai/artifact/VPvK4t85s6qMG6khB5WekT' },
];

export const artifactsIn = (area) => ARTIFACTS.filter((a) => a.area === area);
