/* =====================================================================
   CONFIG — все настройки приложения «Рамки» в одном месте.

   Как это устроено:
   • CONFIG — числа и правила, по которым собирается план. Меняйте здесь.
   • DEFAULT_DATA — стартовые данные из опроса: режим недели, пары,
     предметы, дедлайны, примерные темы. Они попадают в приложение
     при первом запуске. Дальше всё правится в «Настройках» и хранится
     в localStorage телефона, поэтому повторно менять этот файл не нужно.
   • Время везде в формате 'ЧЧ:ММ', даты — 'ГГГГ-ММ-ДД'.
   • Дни недели: 0 — воскресенье, 1 — понедельник … 6 — суббота.
   ===================================================================== */

export const CONFIG = {
  appName: 'Рамки',
  storageKey: 'ramki.v1',
  dataVersion: 1,

  /* ---------- Сон: жёсткие границы ---------- */
  minSleepHours: 7,            // план никогда не ставит сон меньше этого
  sleepExceptions: { 5: 6 },   // ночь после пятницы: минимум 6 ч (договорились в опросе)
  napMin: 40,                  // дневной сон в субботу после короткой ночи
  napAfterNightBelowMin: 420,  // дневной сон ставится, если ночь была короче 7 ч

  /* ---------- Дорога и быт ---------- */
  trainMin: 150,               // электричка домой, мин (дорога 2–2,5 ч)
  trainStudyMin: 60,           // учёба в электричке: карточки, теория, аудио
  trainSettleMin: 10,          // сесть, выдохнуть, потом учиться
  fatigueClassMin: 300,        // если пар 5 ч и больше — в дороге нагрузка меньше
  fatigueFactor: 0.6,
  dinnerMin: 40,               // ужин и душ после дороги
  weekendMeals: { breakfast: 30, lunchAt: '13:30', lunch: 45, dinnerAt: '19:00', dinner: 40 },
  morningStudyMin: 60,         // если утреннюю дорогу сделать учебной
  defaultLeaveBeforeClassMin: 160, // если в шаблоне дня нет «выхожу» — за 2 ч 40 мин до пар
  defaultHomeAfterClassMin: 200,   // если нет «дома в» — через 3 ч 20 мин после пар

  /* ---------- Учёба дома ---------- */
  homeCapByWeekday: { 0: 0, 1: 150, 2: 150, 3: 150, 4: 150, 5: 150, 6: 180 },
  sundayExtraMin: 120,         // воскресенье «по необходимости», если включить
  sundayPlanMin: 30,           // лёгкий план на неделю в воскресенье
  sundayPlanAt: '11:00',
  energyFactor: { low: 0.6, mid: 1, high: 1.2 },
  pomodoro: { work: 25, rest: 5 },
  maxChunkMin: 100,            // один учебный блок дома — не длиннее (2 помидора по 50)
  minChunkMin: 20,             // меньше нет смысла садиться
  maxTasksPerDay: 3,           // экран «Сегодня»: максимум 3 задачи
  maxHomeChunks: 2,
  breakBetweenChunksMin: 10,
  breakBeforeGameMin: 15,
  reviewMin: 15,               // повторение перед сном

  /* ---------- Игра (Counter-Strike) ---------- */
  game: {
    minutes: 75,               // награда 1–1,5 ч
    minMinutes: 45,            // если меньше — в этот день без игры
    endBeforeSleepMin: 30,     // игра заканчивается за 30 мин до отбоя
  },

  /* ---------- Привычки ---------- */
  habits: {
    duolingoMin: 15,           // немецкий в Duolingo — в электричке
    sportMin: 15,              // зарядка / спорт
    sportDays: [2, 3, 6, 0],   // вт, ср, сб, вс — дни с длинным вечером
  },

  /* ---------- Подготовка к событиям ---------- */
  // Множитель часов по уровню предмета (1 — плаваю, 5 — уверенно)
  levelFactor: { 1: 1.6, 2: 1.3, 3: 1, 4: 0.8, 5: 0.6 },
  // Поддержка слабых предметов (уровень 1–2), минут в неделю
  weakWeekly: { light: 30, heavy: 60 },
  weakLevelMax: 2,
  horizonDays: 21,             // на сколько дней вперёд считать план

  /* ---------- Отработка и карточки ---------- */
  srsDays: [1, 3, 7, 14, 30],  // повтор верно решённой задачи через N дней
  cardDays: [0, 1, 2, 4, 7, 15],
  practiceSessionSize: 10,
  cardSessionSize: 20,
  retryAfter: 3,               // ошибку вернуть через 3 задачи в этой же сессии
  understoodNeed: 4,           // «понял»: из последних 5 ответов верных ≥ 4
  reviewGapDays: 2,            // «повторил»: верно через 2+ дня после «понял»

  /* ---------- Таймер ---------- */
  focus: { work: 25, rest: 5 },

  /* ---------- Посещаемость и семестр ---------- */
  semesterStart: '2026-09-01',

  /* ---------- Напоминания и данные ---------- */
  icsDaysAhead: 7,
  backupEveryDays: 7,
};

/* Типы событий в календаре. Цвет задаётся в CSS переменной --t-<type>. */
export const EVENT_TYPES = {
  kr:      { label: 'Контрольная',  short: 'КР',     weight: 2 },
  lab:     { label: 'Лабораторная', short: 'Лаба',   weight: 2 },
  zachet:  { label: 'Зачёт',        short: 'Зачёт',  weight: 3 },
  exam:    { label: 'Экзамен',      short: 'Экз',    weight: 4 },
  session: { label: 'Сессия',       short: 'Сессия', weight: 0 },
  dz:      { label: 'Сдача / ДЗ',   short: 'Сдача',  weight: 1 },
};

/* Как готовиться к событию и сколько часов закладывать (при уровне 3).
   lightShare — доля «лёгкой» подготовки (карточки, теория — подходит для электрички).
   leadDays — за сколько дней до события подготовка становится главной;
   раньше этого времени приоритет у поддержки слабых предметов.
   Остальное — «тяжёлая»: задачи в тетради, отчёт, презентация — только дома. */
export const PREP = {
  kr: {
    hours: 3, lightShare: 0.35, leadDays: 10,
    light: 'формулы и определения — карточки',
    heavy: 'типовые задачи на бумаге',
    first: {
      light: 'Пролистай 10 карточек по темам КР — без зубрёжки, просто вспомни.',
      heavy: 'Открой последнюю практику и реши первую задачу заново, без подсказок.',
    },
    steps: [
      'Узнай темы и формат: сколько задач, что можно взять с собой.',
      'Собери типовые задачи по каждой теме — с практик и из задачника.',
      'Реши по 2–3 задачи на тему на бумаге, без телефона — как на КР.',
      'Формулы и определения — в карточки, гоняй их в электричке.',
      'Накануне: одна пробная КР на время и разбор ошибок. Сон по плану.',
    ],
  },
  lab: {
    hours: 2, lightShare: 0.4, leadDays: 7,
    light: 'методичка и вопросы к допуску',
    heavy: 'таблицы, расчёты, отчёт',
    first: {
      light: 'Найди методичку и выпиши цель работы и главную формулу.',
      heavy: 'Начерти в тетради таблицу для измерений.',
    },
    steps: [
      'Прочитай методичку: цель, схема установки, расчётные формулы.',
      'Заранее подготовь в тетради таблицы для измерений.',
      'Ответь на контрольные вопросы к допуску — их удобно сделать карточками.',
      'После лабы добавь в календарь сдачу отчёта: расчёты, погрешности, вывод.',
    ],
  },
  zachet: {
    hours: 8, lightShare: 0.5, leadDays: 21,
    light: 'вопросы к зачёту — карточки',
    heavy: 'задачи по слабым темам',
    first: {
      light: 'Возьми список вопросов и отметь три, которые знаешь хуже всего.',
      heavy: 'Реши одну задачу по самой слабой теме.',
    },
    steps: [
      'Возьми список вопросов или требований к зачёту.',
      'Закрой хвосты: лабы, ДЗ, контрольные — без них могут не допустить.',
      'Вопросы — в карточки, 2–3 круга повторения.',
      'Отработка задач по темам со статусом «не начал» и «учу».',
    ],
  },
  exam: {
    hours: 14, lightShare: 0.5, leadDays: 30,
    light: 'билеты — теория по карточкам',
    heavy: 'задачи из билетов',
    first: {
      light: 'Открой список билетов и разбей его на темы.',
      heavy: 'Реши задачу из первого билета, который пугает больше всего.',
    },
    steps: [
      'Список билетов → разбей на темы (они уже есть на экране «Темы»).',
      'Каждая тема: теория в карточках + 2–3 задачи.',
      'Три круга: понять → вспомнить без конспекта → быстро пройти слабое.',
      'За 2–3 дня — пробный билет на бумаге или вслух.',
      'Ночь перед экзаменом — сон, а не зубрёжка.',
    ],
  },
  dz: {
    hours: 2.5, lightShare: 0, leadDays: 10,
    light: 'повторить материал',
    heavy: 'сделать работу',
    first: {
      light: 'Перечитай задание и выпиши требования.',
      heavy: 'Открой файл и напиши заголовки — пять пунктов или слайдов.',
    },
    steps: [
      'Уточни требования: объём, формат, куда сдавать.',
      'Структура за 15 минут: заголовки или пункты.',
      'Черновик целиком, без шлифовки.',
      'Доделай и проверь формат сдачи накануне, а не в последний вечер.',
    ],
  },
  session: {
    hours: 0, lightShare: 0, leadDays: 0, light: '', heavy: '', first: { light: '', heavy: '' },
    steps: ['Сессия — ориентир: к её началу все лабы, зачёты и хвосты должны быть закрыты.'],
  },
};

/* Стартовые данные из опроса. */
export const DEFAULT_DATA = {
  settings: {
    minSleepHours: CONFIG.minSleepHours,
    fridayException: true,       // ночь Пт→Сб — минимум 6 ч + дневной сон в сб
    strictness: 'strict',        // 'soft' | 'medium' | 'strict'
    agreement: true,             // утром договорились — вечером отчёт
    theme: 'auto',               // 'auto' | 'light' | 'dark'
    motion: 'light',             // 'light' | 'none'
    gameMinutes: CONFIG.game.minutes,
    duolingo: true,
    sport: true,
    sundayExtra: false,
    pauseMaintenance: false,
    quiet: { classes: true, game: true, morningTrain: true },
    sessionStart: '2026-12-01',
    sessionApprox: true,
    lastBackupAt: null,
    backupSnoozeUntil: null,
    introSeen: false,            // подсказка «данные из опроса уже внутри» показана
  },

  /* Режим недели. assumed — значения, которые я предположил, а вы не подтверждали. */
  week: {
    1: { wake: '05:00', leave: '06:20', classStart: '09:00', classEnd: '14:10', home: '17:30', sleep: '21:30' },
    2: { wake: '05:00', leave: '06:20', classStart: '09:00', classEnd: '12:10', home: '15:30', sleep: '21:30' },
    3: { wake: '05:00', leave: '06:20', classStart: '09:00', classEnd: '12:10', home: '15:30', sleep: '21:30' },
    4: { wake: '08:36', leave: '09:56', classStart: '12:40', classEnd: '19:30', home: '22:30', sleep: '23:30', assumed: ['sleep'] },
    5: { wake: '12:10', leave: '13:30', classStart: '16:20', classEnd: '19:30', home: '22:30', sleep: '23:00', assumed: ['sleep'] },
    6: { wake: '05:00', leave: '06:20', classStart: '09:00', classEnd: '12:10', home: '15:30', sleep: '00:00' },
    0: { wake: '09:00', sleep: '21:30', assumed: ['wake'] },
  },

  subjects: [
    { id: 'linal',  name: 'Линейная алгебра и аналитическая геометрия', short: 'Линал',       level: 3 },
    { id: 'matan',  name: 'Математический анализ',                     short: 'Матан',       level: 3 },
    { id: 'matlog', name: 'Математическая логика',                     short: 'Матлогика',   level: 3, note: 'Название на скриншоте обрезано — поправьте.' },
    { id: 'inf',    name: 'Информатика',                               short: 'Информатика', level: 2 },
    { id: 'phys',   name: 'Физика',                                    short: 'Физика',      level: 2 },
    { id: 'hist',   name: 'История России',                            short: 'История',     level: 2 },
    { id: 'intro',  name: 'Введение в профессиональную деятельность',  short: 'Введение',    level: 3 },
    { id: 'de',     name: 'Иностранный язык (немецкий)',               short: 'Немецкий',    level: 3, note: 'Предположил, что иностранный — это немецкий.' },
    { id: 'pe',     name: 'Физическая культура и спорт',               short: 'Физкультура', level: 3 },
  ],

  /* Пары. every — раз в сколько недель, anchor — дата одного из занятий. */
  classes: [
    { id: 'mon1', subject: 'linal',  weekday: 1, start: '09:00', end: '10:30', kind: 'practice' },
    { id: 'mon2', subject: 'hist',   weekday: 1, start: '10:40', end: '12:10', kind: 'practice' },
    { id: 'mon3', subject: 'phys',   weekday: 1, start: '12:40', end: '14:10', kind: 'lecture' },
    { id: 'tue1', subject: 'matan',  weekday: 2, start: '09:00', end: '10:30', kind: 'lecture' },
    { id: 'tue2a', subject: 'intro', weekday: 2, start: '10:40', end: '12:10', kind: 'lecture', every: 2, anchor: '2026-10-13' },
    { id: 'tue2b', subject: 'inf',   weekday: 2, start: '10:40', end: '12:10', kind: 'lecture', every: 2, anchor: '2026-10-20' },
    { id: 'tueLab1', subject: 'phys', weekday: 2, start: '12:40', end: '14:10', kind: 'lab', every: 4, anchor: '2026-10-20', from: '2026-10-20' },
    { id: 'tueLab2', subject: 'phys', weekday: 2, start: '14:20', end: '15:50', kind: 'lab', every: 4, anchor: '2026-10-20', from: '2026-10-20' },
    { id: 'wed1', subject: 'phys',   weekday: 3, start: '09:00', end: '10:30', kind: 'practice' },
    { id: 'wed2', subject: 'de',     weekday: 3, start: '10:40', end: '12:10', kind: 'practice' },
    { id: 'thu1', subject: 'pe',     weekday: 4, start: '12:40', end: '14:10', kind: 'practice' },
    { id: 'thu2', subject: 'matlog', weekday: 4, start: '14:20', end: '15:50', kind: 'practice' },
    { id: 'thu3', subject: 'matlog', weekday: 4, start: '16:20', end: '17:50', kind: 'lecture' },
    { id: 'thu4', subject: 'matan',  weekday: 4, start: '18:00', end: '19:30', kind: 'practice' },
    { id: 'fri1', subject: 'inf',    weekday: 5, start: '16:20', end: '17:50', kind: 'practice' },
    { id: 'fri2', subject: 'inf',    weekday: 5, start: '18:00', end: '19:30', kind: 'practice' },
    { id: 'sat1', subject: 'linal',  weekday: 6, start: '09:00', end: '10:30', kind: 'lecture' },
    { id: 'sat2', subject: 'hist',   weekday: 6, start: '10:40', end: '12:10', kind: 'lecture' },
  ],

  /* Дедлайны из опроса. timeAssumed — время пары, на которой, скорее всего, событие. */
  events: [
    { id: 'ev-linal-kr', subject: 'linal', type: 'kr', title: 'Контрольная', date: '2026-10-19', time: '09:00', timeAssumed: true,
      format: 'на бумаге', phone: 'no', confirmed: false, note: 'Точно не известно — уточни у старосты или в чате группы.' },
    { id: 'ev-phys-lab1', subject: 'phys', type: 'lab', title: 'Лабораторная', date: '2026-10-20', time: '12:40',
      format: 'две пары подряд', phone: '?', confirmed: true, note: 'Допуск и подготовка — уточнить.' },
    { id: 'ev-de-pres', subject: 'de', type: 'dz', title: 'Презентация (ДЗ)', date: '2026-10-21', time: '10:40', timeAssumed: true,
      format: 'на флешке или в СДО', phone: '?', confirmed: true, note: 'Тема и объём — уточнить.' },
    { id: 'ev-matlog-kr', subject: 'matlog', type: 'kr', title: 'Контрольная', date: '2026-10-22', time: '14:20', timeAssumed: true,
      format: 'на бумаге', phone: 'no', confirmed: true, note: '' },
    { id: 'ev-matan-kr', subject: 'matan', type: 'kr', title: 'Контрольная', date: '2026-10-22', time: '18:00', timeAssumed: true,
      format: 'на бумаге', phone: 'no', confirmed: true, note: '' },
    { id: 'ev-phys-lab2', subject: 'phys', type: 'lab', title: 'Лабораторная', date: '2026-11-17', time: '12:40',
      format: 'две пары подряд', phone: '?', confirmed: true, note: 'Каждые 4 недели после 20 октября.' },
    { id: 'ev-phys-lab3', subject: 'phys', type: 'lab', title: 'Лабораторная', date: '2026-12-15', time: '12:40',
      format: 'две пары подряд', phone: '?', confirmed: true, note: '' },
    { id: 'ev-phys-lab4', subject: 'phys', type: 'lab', title: 'Лабораторная', date: '2027-01-12', time: '12:40',
      format: 'две пары подряд', phone: '?', confirmed: true, note: '' },
    { id: 'ev-session', subject: null, type: 'session', title: 'Начало сессии (примерно)', date: '2026-12-01', time: null,
      format: '', phone: '?', confirmed: false, note: 'Точной даты нет — поменяй, когда узнаешь.' },
  ],

  /* Примерные темы. Замените по программе — это просто старт. */
  topics: [
    ['linal', ['Матрицы и действия с ними', 'Определители', 'Обратная матрица', 'СЛАУ: метод Гаусса и Крамера', 'Векторы и скалярное произведение', 'Прямая и плоскость']],
    ['matan', ['Пределы последовательностей', 'Предел функции, замечательные пределы', 'Непрерывность и разрывы', 'Производная и правила', 'Исследование функции']],
    ['matlog', ['Высказывания и таблицы истинности', 'Равносильности, законы де Моргана', 'ДНФ и КНФ', 'Булевы функции']],
    ['inf', ['Системы счисления', 'Кодирование информации', 'Логические операции', 'Алгоритмы и программы']],
    ['phys', ['Кинематика', 'Динамика: законы Ньютона', 'Работа, энергия, мощность', 'Законы сохранения', 'Погрешности измерений (для лаб)']],
    ['hist', ['Древняя Русь (IX–XII вв.)', 'Русские земли XIII–XV вв.', 'Россия в XVI–XVII вв.', 'Россия в XVIII в.']],
    ['intro', ['Темы лекций — добавь свои']],
    ['de', ['Приветствия и знакомство', 'Числа', 'Глаголы sein и haben']],
  ],
};
