// A thin layer for building DOM without external libraries.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The class attribute from anything a caller may pass. Flattened, because `button()` nests
 * the caller's own list inside its own: joined as it stood, `['btn', ['btn-primary', 'x']]`
 * produced a single class called «btn-primary,x», which matches no rule at all.
 */
export const classAttr = (v) => (Array.isArray(v) ? v.flat(4).filter(Boolean).join(' ') : String(v));

function applyProps(el, props) {
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', classAttr(v));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled') el[k] = v;
    // No `html` prop, on purpose: everything that reaches an element here is text or a node,
    // and user text set as markup would be the one way to script this page from a document.
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

function appendAll(el, children) {
  for (const c of children.flat(4)) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  appendAll(el, children);
  return el;
}

export function svg(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, String(v));
  }
  appendAll(el, children);
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export const button = (label, onClick, options = {}) =>
  h('button', { type: 'button', class: ['btn', options.class], title: options.title, disabled: options.disabled, onClick }, label);

/**
 * A button that drops a short list of commands. Commands that are used now and then belong
 * here rather than in the bar: a row of twelve buttons is a row nobody reads.
 * Items are [label, action] pairs; a null item draws a separator.
 */
export function menu(label, items, options = {}) {
  const list = h('div', { class: 'menu-list', role: 'menu' });
  const trigger = h('button', {
    type: 'button', class: ['btn', 'menu-trigger', options.class], title: options.title,
    'aria-haspopup': 'true', 'aria-expanded': 'false',
  }, label);
  const wrap = h('div', { class: 'menu' }, trigger, list);

  const close = () => {
    wrap.classList.remove('menu-open');
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (ev) => { if (!wrap.contains(ev.target)) close(); };
  const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
  const open = () => {
    wrap.classList.add('menu-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
  };
  trigger.addEventListener('click', () => (wrap.classList.contains('menu-open') ? close() : open()));

  for (const item of items) {
    if (!item) { list.appendChild(h('div', { class: 'menu-sep' })); continue; }
    const [text, action, opts = {}] = item;
    list.appendChild(h('button', {
      type: 'button', class: ['menu-item', opts.class], title: opts.title, disabled: opts.disabled,
      onClick: () => { close(); action(); },
    }, text));
  }
  return wrap;
}

/** Label + control row, for forms. */
export const field = (label, control, options = {}) =>
  h('label', { class: ['field', options.class] },
    h('span', { class: 'field-label' }, label),
    control,
    options.help ? h('span', { class: 'field-help' }, options.help) : null);

export const card = (title, ...content) =>
  h('section', { class: 'card' }, title ? h('h3', { class: 'card-title' }, title) : null, ...content);

/** Plain table: headers plus ready made rows. */
export const table = (headers, rows, options = {}) =>
  h('div', { class: ['table-wrap', options.class] },
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, ...headers.map((t) => h('th', {}, t)))),
      h('tbody', {}, ...rows)));

export const empty = (message) => h('p', { class: 'empty' }, message);

// ---- dialogs -----------------------------------------------------------------

export function modal({ title, content, actions, width }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  // Both width and maxWidth: the stylesheet gives the dialog a default width, and a caller
  // asking for a wide window (the enlarged graph) has to be able to override it.
  const box = h('div', { class: 'modal', style: width ? { width, maxWidth: width } : null, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'modal-title' }, title, h('button', { class: 'btn btn-icon', title: 'Close', onClick: close }, '✕')),
    h('div', { class: 'modal-body' }, content),
    h('div', { class: 'modal-actions' }, ...(actions || [])));
  backdrop.appendChild(box);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(backdrop);
  function close() {
    document.removeEventListener('keydown', onEsc);
    backdrop.remove();
  }
  return { close, box };
}

export function confirm(message, { title = 'Confirm', okLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      title,
      content: h('p', {}, message),
      actions: [
        button('Cancel', () => { m.close(); resolve(false); }),
        button(okLabel, () => { m.close(); resolve(true); }, { class: danger ? 'btn-danger' : 'btn-primary' }),
      ],
    });
  });
}

let toastHost = null;

export function toast(message, kind = 'info', duration = 4000) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const el = h('div', { class: ['toast', 'toast-' + kind] }, message);
  toastHost.appendChild(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 300); }, duration);
  return el;
}

/** Opens the file picker and returns the chosen files. */
export function pickFiles({ accept, multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export const formatDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return d ? `${d}/${m}/${y}` : iso;
};
