/* =====================================================================
   Помощники интерфейса: иконки, тост, нижняя шторка, подтверждение,
   «Поделиться» / сохранить файл, копирование текста.
   ===================================================================== */

import { esc } from './util.js';

const PATHS = {
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="1"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/>',
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  topics: '<path d="M4 4.5h6a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4z"/><path d="M20 4.5h-6a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  paste: '<rect x="5" y="4.5" width="14" height="16" rx="1"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  pause: '<path d="M8.5 5.5v13M15.5 5.5v13"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.6-5.3 3.6-8.3.9 2 2.3 3 3.4 3.1-.4-2.5.6-4.8 2.5-6.6.4 3.9 3.5 6.2 3.5 10.3 0 4.6-2.8 7.7-6.5 7.7z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  train: '<rect x="5.5" y="3.5" width="13" height="14" rx="2"/><path d="M5.5 11h13M9 21l1.5-3.5M15 21l-1.5-3.5"/>',
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h12V9.5"/>',
  dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
  game: '<rect x="3" y="8" width="18" height="10" rx="4"/><path d="M8 11v4M6 13h4M15 12h.01M17.5 14.5h.01"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5h4"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 16V5M7 9.5l5-5 5 5M5 20h14"/>',
  share: '<path d="M12 15V4M8 7.5l4-4 4 4"/><path d="M6 11v9h12v-9"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
  cards: '<rect x="3.5" y="7" width="13" height="13" rx="1"/><path d="M7.5 7V4h13v13h-4"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="1"/><path d="M5 15.5V4.5h10.5"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] || ''}</svg>`;
}

/* ---------- Тост ---------- */

let toastTimer = null;
export function toast(message, ms = 3400) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- Нижняя шторка ---------- */

let sheet = null;
let sheetOnClose = null;
let lastFocus = null;

export const sheetIsOpen = () => !!sheet;

export function openSheet({ title, body, onMount, onClose }) {
  closeSheet(true);
  lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="sheet-back" data-sheet-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-in">
        <div class="sheet-head">
          <h2 id="sheet-title" tabindex="-1">${esc(title)}</h2>
          <button class="ibtn" type="button" data-sheet-close aria-label="Закрыть">${icon('x')}</button>
        </div>
        <div class="sheet-body stack">${body}</div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  sheet = wrap;
  sheetOnClose = onClose || null;
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) closeSheet();
  });
  wrap.querySelector('#sheet-title')?.focus({ preventScroll: true });
  onMount?.(wrap.querySelector('.sheet-body'), wrap);
  return wrap;
}

export function closeSheet(silent = false) {
  if (!sheet) return;
  sheet.remove();
  sheet = null;
  document.body.style.overflow = '';
  const cb = sheetOnClose;
  sheetOnClose = null;
  if (!silent) cb?.();
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.({ preventScroll: true });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet) closeSheet();
});

/** Подтверждение внутри страницы (confirm() в превью не работает). */
export function confirmSheet({ title, text, ok = 'Да', cancel = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title,
      body: `<p class="lead">${esc(text)}</p>
        <div class="row">
          <button class="btn ${danger ? 'danger' : ''}" type="button" data-confirm="1">${esc(ok)}</button>
          <button class="btn ghost" type="button" data-confirm="0">${esc(cancel)}</button>
        </div>`,
      onMount: (body) => body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-confirm]');
        if (!b) return;
        answered = true;
        closeSheet(true);
        resolve(b.dataset.confirm === '1');
      }),
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

/* ---------- Файлы и буфер обмена ---------- */

export const isPreview = () => !!globalThis.__RAMKI_PREVIEW__;

/**
 * Отдать файл: меню «Поделиться» (Telegram, «Файлы»…), иначе скачать.
 * Возвращает 'shared' | 'downloaded' | 'cancelled' | 'failed'.
 */
export async function shareOrSave({ filename, mime, text, title, preferDownload = false }) {
  if (!preferDownload) {
    try {
      const file = new File([text], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return 'shared';
      }
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  if (isPreview()) return 'failed'; // в превью скачивание заблокировано
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** Скопировать текст (вызывать прямо из обработчика нажатия). */
export async function copyText(text, fallbackEl) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (fallbackEl) {
      fallbackEl.focus();
      fallbackEl.select();
    }
    return false;
  }
}

/** Шторка с текстом и кнопкой «Скопировать» — запасной путь, если файл не отдать. */
export function textFallbackSheet(title, text, hint) {
  openSheet({
    title,
    body: `<p class="lead small">${esc(hint)}</p>
      <textarea class="inp" id="fallback-text" rows="8" readonly>${esc(text)}</textarea>
      <button class="btn block" type="button" id="fallback-copy">${icon('copy')}Скопировать</button>`,
    onMount: (body) => {
      const ta = body.querySelector('#fallback-text');
      body.querySelector('#fallback-copy').addEventListener('click', async () => {
        const ok = await copyText(text, ta);
        toast(ok ? 'Скопировано. Вставь в Telegram «Избранное».' : 'Текст выделен — скопируй его вручную.');
      });
    },
  });
}
