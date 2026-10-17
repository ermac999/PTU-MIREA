/* =====================================================================
   События (дедлайны): карточка события с «как готовиться», добавление
   вручную и вставкой текстом.
   ===================================================================== */

import { CONFIG, EVENT_TYPES, PREP } from '../config.js';
import { commit, store } from '../store.js';
import { buildTodayPlan, defaultNeedMin, eventProgress, plannedByEvent, splitNeed, subjectOf } from '../planner.js';
import { parseDeadlines } from '../parse.js';
import { esc, fmtDur, round5, shortDate, uid } from '../util.js';
import { closeSheet, confirmSheet, icon, openSheet, toast } from '../ui.js';
import { getSim, nowMin, today } from './shared.js';

const TYPE_ORDER = ['kr', 'lab', 'zachet', 'exam', 'dz', 'session'];

/** После изменения дедлайнов пересобрать остаток сегодняшнего дня. */
function replanToday(st) {
  const t = today();
  if (st.plans[t]) st.plans[t] = buildTodayPlan(st, t, nowMin());
}

const segButtons = (group, options, value) => `<div class="seg" role="group" data-seg="${group}">${options
  .map(([v, label]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${String(v) === String(value)}">${esc(label)}</button>`)
  .join('')}</div>`;

const switchBtn = (name, label, on) => `<button class="switch" type="button" data-switch="${name}" aria-pressed="${!!on}"><span>${esc(label)}</span><span class="tr" aria-hidden="true"></span></button>`;

/** Подключить сегменты и переключатели внутри шторки. */
export function wireControls(root) {
  root.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-seg] button');
    if (sb) {
      sb.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === sb)));
      return;
    }
    const sw = e.target.closest('[data-switch]');
    if (sw) sw.setAttribute('aria-pressed', String(sw.getAttribute('aria-pressed') !== 'true'));
  });
}
export const segValue = (root, group) => root.querySelector(`[data-seg="${group}"] [aria-pressed="true"]`)?.dataset.v ?? null;
export const switchValue = (root, name) => root.querySelector(`[data-switch="${name}"]`)?.getAttribute('aria-pressed') === 'true';
export { segButtons, switchBtn };

/** Блок «Как готовиться»: шаги, часы, прогресс. */
export function howToHtml(ev) {
  const st = store.state;
  const p = PREP[ev.type];
  if (!p) return '';
  const subj = subjectOf(st, ev.subject);
  const { need, light, heavy } = splitNeed(st, ev);
  const prog = eventProgress(st, ev);
  const planned = plannedByEvent(getSim(), st)[ev.id] || 0;
  const short = getSim().shortages.find((s) => s.eventId === ev.id);
  const factor = CONFIG.levelFactor[Number(subj?.level) || 3];
  const pct = need ? Math.min(100, Math.round((prog.done / need) * 100)) : 0;
  return `<section>
    <div class="sec-row"><h3 class="sec">Как готовиться</h3></div>
    ${need ? `<p class="lead small">Закладываю на подготовку <b>${fmtDur(need)}</b>${ev.prepMin != null && ev.prepMin !== '' ? ' (ты задал сам)' : ` — ${String(p.hours).replace('.', ',')} ч × ${String(factor).replace('.', ',')} за уровень предмета ${subj?.level ?? 3}`}.
      ${light ? `Лёгкая часть — ${fmtDur(light)}: ${esc(p.light)}, удобно в электричке.` : ''}
      ${heavy ? `Тяжёлая — ${fmtDur(heavy)}: ${esc(p.heavy)}, дома.` : ''}</p>
      <div class="progress ${pct >= 100 ? 'ok' : ''}"><i style="width:${pct}%"></i></div>
      <p class="small muted">Сделано ${fmtDur(prog.done)} из ${fmtDur(need)} · в плане ещё ${fmtDur(planned)}${short ? ` · <b style="color:var(--danger)">не хватает ~${fmtDur(short.short)}</b>` : ''}</p>` : ''}
    ${ev.prepFrom ? `<p class="small" style="margin:0">Подготовка начнётся ${esc(shortDate(ev.prepFrom))} — раньше в план не ставлю.</p>` : ''}
    <ol class="small" style="margin:0;padding-left:20px;display:grid;gap:6px">${p.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  </section>`;
}

/** Шторка события: просмотр и правка. id = null — новое событие. */
export function openEventSheet(id, presetDate) {
  const st = store.state;
  const ev = id ? st.events.find((e) => e.id === id) : null;
  const draft = ev ? { ...ev } : {
    id: uid('ev'), subject: '', type: 'kr', title: '', date: presetDate || today(), time: '', format: '', phone: '?', confirmed: true, note: '', prepMin: null,
  };
  const hours = draft.prepMin != null && draft.prepMin !== '' ? String(Math.round((draft.prepMin / 60) * 10) / 10).replace('.', ',') : '';
  const defHours = Math.round((defaultNeedMin(st, { ...draft, subject: draft.subject || null }) / 60) * 10) / 10;

  openSheet({
    title: ev ? 'Событие' : 'Новый дедлайн',
    body: `
      ${ev ? howToHtml(ev) : ''}
      <div class="field"><label for="ev-title">Что</label><input class="inp" id="ev-title" value="${esc(draft.title)}" placeholder="Контрольная, презентация, отчёт…" autocomplete="off"></div>
      <div class="field"><span class="eyebrow">Тип</span>${segButtons('type', TYPE_ORDER.map((t) => [t, EVENT_TYPES[t].short]), draft.type)}</div>
      <div class="field"><label for="ev-subject">Предмет</label>
        <select class="inp" id="ev-subject"><option value="">— без предмета —</option>${st.subjects.map((s) => `<option value="${esc(s.id)}" ${s.id === draft.subject ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      <div class="times">
        <div class="field"><label for="ev-date">Дата</label><input class="inp" type="date" id="ev-date" value="${esc(draft.date)}"></div>
        <div class="field"><label for="ev-time">Время</label><input class="inp" type="time" id="ev-time" value="${esc(draft.time || '')}"></div>
      </div>
      <div class="field"><label for="ev-from">Готовиться не раньше (необязательно)</label><input class="inp" type="date" id="ev-from" value="${esc(draft.prepFrom || '')}"></div>
      <div class="field"><label for="ev-format">Формат</label><input class="inp" id="ev-format" value="${esc(draft.format || '')}" placeholder="на бумаге, на компьютере, устно, в СДО"></div>
      <div class="field"><span class="eyebrow">Телефон</span>${segButtons('phone', [['no', 'нельзя'], ['yes', 'можно'], ['?', 'не знаю']], draft.phone || '?')}</div>
      ${switchBtn('confirmed', 'Точно известно (дата и формат)', draft.confirmed !== false)}
      <div class="field"><label for="ev-prep">Часов на подготовку</label><input class="inp" id="ev-prep" inputmode="decimal" value="${esc(hours)}" placeholder="по умолчанию ${String(defHours).replace('.', ',')} ч"></div>
      <div class="field"><label for="ev-note">Заметка</label><textarea class="inp" id="ev-note" rows="3" style="min-height:90px">${esc(draft.note || '')}</textarea></div>
      ${ev ? switchBtn('done', 'Уже прошло или сдано', ev.done) : ''}
      <div class="row">
        <button class="btn" type="button" id="ev-save">Сохранить</button>
        ${ev ? `<button class="btn danger" type="button" id="ev-del">${icon('trash', 's')}Удалить</button>` : ''}
      </div>`,
    onMount: (body) => {
      wireControls(body);
      body.querySelector('#ev-save').addEventListener('click', () => {
        const date = body.querySelector('#ev-date').value;
        if (!date) {
          toast('Нужна дата — без неё событие не встанет в календарь.');
          return;
        }
        const type = segValue(body, 'type') || 'kr';
        const prepRaw = body.querySelector('#ev-prep').value.trim().replace(',', '.');
        const prepH = prepRaw === '' ? null : Number(prepRaw);
        if (prepRaw !== '' && (Number.isNaN(prepH) || prepH < 0 || prepH > 100)) {
          toast('Часы на подготовку — число, например 2,5.');
          return;
        }
        const next = {
          ...draft,
          type,
          title: body.querySelector('#ev-title').value.trim() || EVENT_TYPES[type].label,
          subject: body.querySelector('#ev-subject').value || null,
          date,
          time: body.querySelector('#ev-time').value || null,
          timeAssumed: ev && body.querySelector('#ev-time').value === ev.time ? ev.timeAssumed : false,
          format: body.querySelector('#ev-format').value.trim(),
          phone: segValue(body, 'phone') || '?',
          confirmed: switchValue(body, 'confirmed'),
          prepMin: prepH == null ? null : round5(prepH * 60),
          prepFrom: body.querySelector('#ev-from').value || null,
          note: body.querySelector('#ev-note').value.trim(),
          done: ev ? switchValue(body, 'done') : false,
        };
        commit((s) => {
          const i = s.events.findIndex((e) => e.id === next.id);
          if (i >= 0) s.events[i] = next;
          else s.events.push(next);
          replanToday(s);
        });
        closeSheet(true);
        toast(ev ? 'Сохранено. План пересчитан.' : 'Дедлайн добавлен. План пересчитан.');
      });
      body.querySelector('#ev-del')?.addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'Удалить событие?', text: `«${draft.title}» пропадёт из календаря и плана.`, ok: 'Удалить', danger: true });
        if (!ok) return;
        commit((s) => {
          s.events = s.events.filter((e) => e.id !== draft.id);
          replanToday(s);
        });
        toast('Удалено.');
      });
    },
  });
}

/** Вставка дедлайнов текстом: разбор → предпросмотр → добавить. */
export function openPasteSheet() {
  const st = store.state;
  let drafts = [];
  openSheet({
    title: 'Дедлайны текстом',
    body: `
      <p class="lead small">По строке на событие. Части через «|» или просто словами: дата, предмет, что, формат, можно ли телефон.</p>
      <pre class="code">22.10 | матан | контрольная | на бумаге | телефон нельзя
25.10 информатика лаба в СДО</pre>
      <div class="field"><label for="paste-text">Текст</label><textarea class="inp" id="paste-text" placeholder="Вставь сюда"></textarea></div>
      <button class="btn block" type="button" id="paste-parse">Разобрать</button>
      <div id="paste-preview" class="stack"></div>`,
    onMount: (body) => {
      const preview = body.querySelector('#paste-preview');
      const draw = () => {
        if (!drafts.length) {
          preview.innerHTML = '';
          return;
        }
        const okCount = drafts.filter((d) => d.include && d.date).length;
        preview.innerHTML = `
          <ul class="list">${drafts.map((d, i) => `
            <li class="li" style="align-items:flex-start">
              <button class="ibtn" type="button" data-pi="${i}" aria-pressed="${d.include}" aria-label="${d.include ? 'Не добавлять' : 'Добавить'}">${d.include ? icon('check') : ''}</button>
              <span class="grow">
                <span class="t">${d.date ? esc(shortDate(d.date)) : '<span style="color:var(--danger)">без даты</span>'} · ${esc(EVENT_TYPES[d.type].short)} · ${esc(d.title)}</span>
                <select class="inp" data-ps="${i}" aria-label="Предмет">${['', ...st.subjects.map((s) => s.id)].map((sid) => `<option value="${esc(sid)}" ${sid === (d.subject || '') ? 'selected' : ''}>${sid ? esc(subjectOf(st, sid).short) : '— предмет —'}</option>`).join('')}</select>
                <span class="m">${[d.time, d.format, d.phone === 'no' ? 'без телефона' : d.phone === 'yes' ? 'с телефоном' : '', d.confirmed ? '' : 'уточнить'].filter(Boolean).map(esc).join(' · ')}</span>
                ${d.warnings.length ? `<span class="m" style="color:var(--warn)">${esc(d.warnings.join('; '))}</span>` : ''}
              </span>
            </li>`).join('')}</ul>
          <button class="btn block" type="button" id="paste-add" ${okCount ? '' : 'disabled'}>Добавить ${okCount}</button>`;
      };
      body.querySelector('#paste-parse').addEventListener('click', () => {
        drafts = parseDeadlines(body.querySelector('#paste-text').value, st, today()).map((d) => ({ ...d, include: !!d.date }));
        if (!drafts.length) toast('Пусто. Вставь хотя бы одну строку с датой.');
        draw();
      });
      preview.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pi]');
        if (b) {
          const d = drafts[Number(b.dataset.pi)];
          d.include = !d.include && !!d.date;
          draw();
        }
        if (e.target.closest('#paste-add')) {
          const add = drafts.filter((d) => d.include && d.date);
          commit((s) => {
            for (const d of add) {
              s.events.push({ id: uid('ev'), subject: d.subject, type: d.type, title: d.title, date: d.date, time: d.time, format: d.format, phone: d.phone, confirmed: d.confirmed, note: '', prepMin: null });
            }
            replanToday(s);
          });
          closeSheet(true);
          toast(`Добавлено: ${add.length}. План пересчитан.`);
        }
      });
      preview.addEventListener('change', (e) => {
        const s = e.target.closest('[data-ps]');
        if (s) drafts[Number(s.dataset.ps)].subject = s.value || null;
      });
    },
  });
}

/** Короткая строка «когда»: «пн, 19.10 · 09:00?» */
export const whenText = (ev) => `${shortDate(ev.date)}${ev.time ? ` · ${ev.time}${ev.timeAssumed ? '?' : ''}` : ''}`;

export const eventActions = {
  'event-open': (el) => openEventSheet(el.dataset.id),
  'event-new': (el) => openEventSheet(null, el.dataset.date),
  'deadlines-paste': () => openPasteSheet(),
};

