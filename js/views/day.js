/* =====================================================================
   Экран дня: лента по часам, «Собрать день» (3 вопроса кнопками)
   и «Править день» (времена этого дня за пару тапов).
   ===================================================================== */

import { CONFIG } from '../config.js';
import { store, commit } from '../store.js';
import { baseTimes } from '../schedule.js';
import { buildTodayPlan, hotList } from '../planner.js';
import { addDays, esc, fmtDur, fmtTime, humanDate, toMin, WD_LONG } from '../util.js';
import { closeSheet, icon, openSheet, toast } from '../ui.js';
import { go } from '../nav.js';
import { eventRow, eventTitle, getSim, nowMin, planFor, renderTimeline, today, upcoming } from './shared.js';
import { segButtons, segValue, switchBtn, switchValue, wireControls } from './events.js';

const durShort = (min) => (min < 60 ? `${min} мин` : `${Math.floor(min / 60)} ч${min % 60 ? ` ${min % 60}` : ''}`);

export function renderDay([keyParam]) {
  const t = today();
  const key = /^\d{4}-\d{2}-\d{2}$/.test(keyParam || '') ? keyParam : t;
  const plan = planFor(key);
  const { info } = plan;
  const isToday = key === t;
  const isPast = key < t;
  const studyMin = plan.blocks.filter((b) => b.type === 'study').reduce((s, b) => s + (b.min || 0), 0);
  const evs = store.state.events.filter((e) => e.date === key && !e.done);
  const shortages = getSim().shortages.filter((s) => evs.some((e) => e.id === s.eventId));
  const tag = isToday ? ' · сегодня' : key === addDays(t, 1) ? ' · завтра' : key === addDays(t, -1) ? ' · вчера' : '';

  return `
    <header class="head">
      <button class="back" type="button" data-act="go" data-to="calendar">${icon('back', 's')}Календарь</button>
      <span class="eyebrow">${WD_LONG[info.wd]}${tag}</span>
      <h1 class="display m">${humanDate(key)}</h1>
    </header>

    <div class="daysum">
      <div><span class="v">${durShort(info.nightMin)}</span><span class="k">сон ночью${info.isException ? ' · исключ.' : ''}</span></div>
      <div><span class="v">${studyMin ? durShort(studyMin) : '—'}</span><span class="k">учёба по плану</span></div>
      <div><span class="v">${info.classes.length || '—'}</span><span class="k">пар</span></div>
    </div>

    ${info.notes.map((n) => `<div class="note ${n.kind === 'sleepShort' ? 'warn' : ''}">${esc(n.text)}</div>`).join('')}
    ${(() => {
      const hotEvs = hotList(info.ov.hot).map((id) => store.state.events.find((e) => e.id === id)).filter(Boolean);
      if (!hotEvs.length && !info.ov.study) return '';
      return `<div class="note">${info.ov.study ? `Учебный выходной: до ${fmtDur(Number(info.ov.studyMin) || CONFIG.sundayExtraMin)} учёбы с перерывами, остальное — отдых. ` : ''}${hotEvs.length ? `В приоритете — ${hotEvs.map((e) => esc(eventTitle(e))).join(', ')}.` : ''}</div>`;
    })()}
    ${shortages.length ? `<div class="note danger">До ${esc(evs.find((e) => e.id === shortages[0].eventId) ? eventTitle(evs.find((e) => e.id === shortages[0].eventId)) : 'события')} не хватает ~${fmtDur(shortages[0].short)} подготовки. <button class="btn quiet small" type="button" data-act="go" data-to="burning">Что можно сократить →</button></div>` : ''}
    ${isPast && !plan.blocks.length ? '<p class="lead small">Плана на этот день не сохранилось — показываю только режим.</p>' : ''}
    ${!isPast && !isToday ? '<p class="lead small">Черновик: он пересобирается сам, когда меняется прогресс. Отмечать блоки можно в сам день.</p>' : ''}

    ${evs.length ? `<section><div class="sec-row"><h2 class="sec">В этот день</h2></div><div>${evs.map((e) => eventRow(e)).join('')}</div></section>` : ''}

    ${!isPast ? `<div class="row">
      <button class="btn" type="button" data-act="day-build" data-key="${key}">Собрать день</button>
      <button class="btn ghost" type="button" data-act="day-edit" data-key="${key}">${icon('edit', 's')}Править день</button>
    </div>` : ''}

    <section aria-label="Лента дня">
      ${renderTimeline(key, plan)}
    </section>

    <div class="row">
      <button class="btn quiet small" type="button" data-act="go" data-to="day/${addDays(key, -1)}">${icon('back', 's')}Пред. день</button>
      <button class="btn quiet small" type="button" data-act="go" data-to="day/${addDays(key, 1)}">След. день${icon('chev', 's')}</button>
    </div>`;
}

/** Три коротких вопроса перед сборкой дня. */
function openBuild(key) {
  const st = store.state;
  const plan = planFor(key);
  const { info } = plan;
  const ov = st.dayOverrides[key] || {};
  const hot = upcoming(10, key).filter((e) => e.type !== 'session').slice(0, 3);
  const homeUsual = info.home != null ? info.home - (Number(ov.homeShift) || 0) : null;
  openSheet({
    title: 'Собрать день',
    body: `
      ${info.classes.length ? `<div class="field"><span class="eyebrow">Во сколько вернёшься домой?</span>
        ${segButtons('shift', [[0, `как обычно, ${fmtTime(homeUsual)}`], [30, '+30 мин'], [60, '+1 ч'], [120, '+2 ч'], [-60, 'на час раньше']], Number(ov.homeShift) || 0)}</div>` : ''}
      <div class="field"><span class="eyebrow">Есть силы?</span>
        ${segButtons('energy', [['low', 'мало'], ['mid', 'нормально'], ['high', 'много']], ov.energy || plan.energy || 'mid')}</div>
      <div class="field"><span class="eyebrow">Что горит в ближайшие дни?</span>
        <div class="seg col" role="group" data-seg="hot">
          ${hot.map((e) => `<button type="button" data-v="${esc(e.id)}" aria-pressed="${hotList(ov.hot ?? plan.hot).includes(e.id)}">${esc(eventTitle(e))} · ${esc(humanDate(e.date))}</button>`).join('')}
          <button type="button" data-v="" aria-pressed="${!hotList(ov.hot ?? plan.hot).length}">ничего особенного</button>
        </div></div>
      <p class="small muted">Сон не трогаю, игра — после учебных блоков. Если времени не хватает, покажу, что можно сократить.</p>
      <button class="btn block" type="button" id="build-go">Собрать</button>`,
    onMount: (body) => {
      wireControls(body);
      let hotTouched = false;
      body.querySelector('[data-seg="hot"]')?.addEventListener('click', () => { hotTouched = true; });
      body.querySelector('#build-go').addEventListener('click', () => {
        const shift = Number(segValue(body, 'shift') || 0);
        const energy = segValue(body, 'energy') || 'mid';
        // если «горит» не трогали — оставляем как было (там может быть список из нескольких событий)
        const hotId = hotTouched ? (segValue(body, 'hot') || null) : (ov.hot ?? plan.hot ?? null);
        commit((s) => {
          const o = { ...(s.dayOverrides[key] || {}), energy, hot: hotId };
          if (shift) o.homeShift = shift;
          else delete o.homeShift;
          s.dayOverrides[key] = o;
          if (key === today()) s.plans[key] = buildTodayPlan(s, key, nowMin(), { energy, hot: hotId });
        });
        closeSheet(true);
        toast(energy === 'low' ? 'Собрал полегче: меньше учёбы, сон и отдых на месте.' : 'День собран.');
      });
    },
  });
}

const FIELDS = [
  ['wake', 'Подъём'], ['leave', 'Выхожу из дома'], ['classStart', 'Пары с'], ['classEnd', 'Пары до'], ['home', 'Дома в'], ['sleep', 'Отбой'],
];

/** Править времена конкретного дня. */
function openEdit(key) {
  const st = store.state;
  const cur = baseTimes(st, key);
  const ov = st.dayOverrides[key] || {};
  const noCl = !!ov.noClasses || !cur.classes.length;
  const val = (f) => (cur[f] == null ? '' : fmtTime(cur[f]));
  openSheet({
    title: `Правка: ${humanDate(key)}`,
    body: `
      <p class="small muted">Меняю только этот день. Шаблон недели — в «Настройках».</p>
      <div class="times">${FIELDS.filter(([f]) => !noCl || f === 'wake' || f === 'sleep').map(([f, label]) => `
        <div class="field"><label for="de-${f}">${label}</label><input class="inp" type="time" id="de-${f}" value="${val(f)}"></div>`).join('')}
      </div>
      ${switchBtn('noClasses', 'Пар нет (выходной, отмена)', !!ov.noClasses)}
      ${!cur.classes.length || ov.study ? switchBtn('study', 'Учиться в этот выходной (до 2–3 ч после обеда)', !!ov.study) : ''}
      ${cur.classes.length || ov.morningStudy ? switchBtn('morningStudy', 'Учиться в утренней дороге', !!ov.morningStudy) : ''}
      ${switchBtn('noGame', 'Без игры в этот день', !!ov.noGame)}
      ${st.settings.gym && (st.settings.gymDays || []).includes(cur.wd) ? switchBtn('noGym', 'Сегодня без зала', !!ov.noGym) : ''}
      <div class="row">
        <button class="btn" type="button" id="de-save">Сохранить</button>
        <button class="btn ghost" type="button" id="de-reset">Как в шаблоне</button>
      </div>
      <button class="btn quiet small" type="button" data-act="go" data-to="settings/week">Шаблон недели →</button>`,
    onMount: (body) => {
      wireControls(body);
      const finish = (mut, msg) => {
        commit((s) => {
          mut(s);
          if (key === today()) s.plans[key] = buildTodayPlan(s, key, nowMin());
        });
        closeSheet(true);
        toast(msg);
      };
      body.querySelector('#de-save').addEventListener('click', () => {
        // базовые времена без правок дня — чтобы сохранить только то, что поменяли
        const clean = { ...st, dayOverrides: { ...st.dayOverrides, [key]: {} } };
        const base = baseTimes(clean, key);
        const o = { ...ov };
        for (const [f] of FIELDS) {
          const inp = body.querySelector(`#de-${f}`);
          if (!inp) continue;
          const v = inp.value;
          const baseV = base[f] == null ? '' : fmtTime(base[f]);
          if (v && v !== baseV) o[f] = v;
          else delete o[f];
        }
        delete o.homeShift; // точное время «дома в» важнее сдвига
        for (const sw of ['noClasses', 'morningStudy', 'noGame', 'study', 'noGym']) {
          if (switchValue(body, sw)) o[sw] = true;
          else delete o[sw];
        }
        if (o.wake && o.leave && toMin(o.leave) <= toMin(o.wake)) {
          toast('Выход из дома должен быть позже подъёма.');
          return;
        }
        finish((s) => { s.dayOverrides[key] = o; }, 'День обновлён, план пересобран.');
      });
      body.querySelector('#de-reset').addEventListener('click', () => {
        finish((s) => {
          const keep = {};
          for (const k of ['energy', 'hot', 'study', 'studyMin']) if (ov[k] != null) keep[k] = ov[k];
          s.dayOverrides[key] = keep;
        }, 'Вернул как в шаблоне.');
      });
    },
  });
}

export const dayActions = {
  'day-build': (el) => openBuild(el.dataset.key),
  'day-edit': (el) => openEdit(el.dataset.key),
  'day-open': (el) => go(`day/${el.dataset.key}`),
};
