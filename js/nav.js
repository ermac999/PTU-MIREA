/* =====================================================================
   Навигация: экраны адресуются хэшем (#calendar, #day/2026-10-19 …).
   Если браузер не даёт менять адрес (превью), переходы всё равно работают.
   ===================================================================== */

let renderFn = () => {};
export const route = { name: 'calendar', params: [], changed: true };

export function setRenderer(fn) {
  renderFn = fn;
}

export function parseHash(hash) {
  const s = String(hash || '').replace(/^#\/?/, '');
  if (!s) return null;
  const [name, ...params] = s.split('/');
  return { name, params: params.map((p) => decodeURIComponent(p)) };
}

/** Перейти на экран: go('day/2026-10-19'). */
export function go(path, { replace = false } = {}) {
  const r = parseHash(`#${path}`);
  if (!r) return;
  route.name = r.name;
  route.params = r.params;
  route.changed = true;
  try {
    if (replace) history.replaceState(null, '', `#${path}`);
    else if (location.hash !== `#${path}`) history.pushState(null, '', `#${path}`);
  } catch {
    /* адрес не меняется — не страшно */
  }
  renderFn();
}

export function initNav(defaultRoute) {
  const r = parseHash(location.hash) || parseHash(`#${defaultRoute}`);
  route.name = r.name;
  route.params = r.params;
  window.addEventListener('popstate', () => {
    const p = parseHash(location.hash) || parseHash(`#${defaultRoute}`);
    route.name = p.name;
    route.params = p.params;
    route.changed = true;
    renderFn();
  });
}
