// Form controls bound to a document path.
// Every control reads from the resolved document and writes through the store: when a
// variant is active the write automatically becomes a customisation of that variant.
import { h, field } from './dom.js';
import { constant, variableRef } from '../model/schema.js';
import { variableText } from '../model/variables.js';
import { optionLabel } from '../model/codes.js';
import { pathVaries } from '../model/variance.js';

const keyOf = (path) => path.join('/');

/**
 * Adds the "customised for this variant" frame and the reset button.
 *
 * A field that no variant touches is left alone; one that some variant rewrites is marked
 * even while the base document is on screen, because that is when nothing else says so. The
 * two marks are the same statement at two strengths: this value is not the same for every
 * product, and here it is being written for one of them.
 */
export function withVariant(store, path, control) {
  const overridden = !!store.activeVariant() && store.isOverridden(path);
  const who = overridden ? [] : pathVaries(store.variance(), path);
  if (!overridden && !who.length) return control;
  return h('span', {
    class: ['bind', overridden && 'bind-override', who.length && 'bind-varies'],
    title: who.length ? `Changes with the variant — ${who.slice(0, 3).join(', ')}` : null,
  },
    control,
    overridden
      ? h('button', {
          type: 'button', class: 'btn btn-icon btn-reset',
          title: 'Drop this variant customisation',
          onClick: () => store.resetOverride(path),
        }, '↺')
      : null);
}

function bindEvents(store, path, el, readEl) {
  el.addEventListener('input', () => store.write(path, readEl(el), keyOf(path), true));
  el.addEventListener('change', () => { store.write(path, readEl(el), keyOf(path), true); store.refresh(); });
  return el;
}

export function textInput(store, path, options = {}) {
  const v = store.read(path);
  const el = options.multiline
    ? h('textarea', { class: 'inp', rows: options.rows || 3, placeholder: options.placeholder || '' }, v == null ? '' : String(v))
    : h('input', { class: 'inp', type: options.type || 'text', placeholder: options.placeholder || '', value: v == null ? '' : String(v) });
  return withVariant(store, path, bindEvents(store, path, el, (x) => x.value));
}

export function selectInput(store, path, options, extra = {}) {
  const v = store.read(path) ?? '';
  const el = h('select', { class: 'inp' },
    extra.blank !== false ? h('option', { value: '' }, extra.blankLabel || '— none —') : null,
    ...options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(v) }, o.label)));
  el.value = String(v);
  return withVariant(store, path, bindEvents(store, path, el, (x) => x.value));
}

/**
 * A text field with a list of suggestions: the names already used in the document, offered
 * rather than imposed. Typing something new stays possible — the point is that «Voltage»
 * written twice is one name, not two.
 */
export function suggestInput(store, path, suggestions, options = {}) {
  const listId = 'sug-' + Math.random().toString(36).slice(2, 9);
  const el = h('input', {
    class: 'inp', type: 'text', list: listId,
    placeholder: options.placeholder || '',
    value: store.read(path) == null ? '' : String(store.read(path)),
  });
  const list = h('datalist', { id: listId }, ...[...new Set(suggestions)].filter(Boolean).sort().map((v) => h('option', { value: v })));
  return h('span', { class: 'suggest' }, withVariant(store, path, bindEvents(store, path, el, (x) => x.value)), list);
}

export function checkInput(store, path, label) {
  const el = h('input', { type: 'checkbox', checked: !!store.read(path) });
  el.addEventListener('change', () => { store.write(path, el.checked, null); });
  return withVariant(store, path, h('label', { class: 'check' }, el, h('span', {}, label)));
}

/**
 * Multiple selection of ids (points, prerequisites, excluded stages…).
 * The chosen entries appear as removable chips; the menu offers the remaining ones.
 */
export function multiInput(store, path, options, extra = {}) {
  const values = (store.read(path) || []).slice();
  const byId = new Map(options.map((o) => [String(o.value), o.label]));
  const write = (next) => { store.write(path, next, null); store.refresh(); };

  const chips = values.map((id) =>
    h('span', { class: 'chip' },
      byId.get(String(id)) || '⟨deleted⟩',
      h('button', { type: 'button', class: 'chip-x', title: 'Remove', onClick: () => write(values.filter((x) => x !== id)) }, '✕')));

  const remaining = options.filter((o) => !values.includes(o.value));
  const menu = h('select', { class: 'inp inp-add' },
    h('option', { value: '' }, extra.addLabel || '+ add…'),
    ...remaining.map((o) => h('option', { value: o.value }, o.label)));
  menu.addEventListener('change', () => { if (menu.value) write([...values, menu.value]); });

  const none = !options.length ? h('span', { class: 'muted' }, extra.emptyText || 'nothing defined yet') : null;
  return withVariant(store, path, h('span', { class: 'multi' }, ...chips, remaining.length ? menu : null, none));
}

/**
 * Value reference: constant or global variable.
 * This is the control used by every parameter and every measurement limit — and, with
 * `options.text`, by the value a text criterion is compared against, which is a value like
 * any other and deserves the same choice.
 */
export function valueInput(store, path, doc, options = {}) {
  const ref = store.read(path) || constant('');
  const variables = doc.variables || [];

  const mode = h('select', { class: 'inp inp-mode', title: 'Constant or global variable' },
    h('option', { value: 'constant', selected: ref.mode !== 'variable' }, '#'),
    h('option', { value: 'variable', selected: ref.mode === 'variable' }, '$'));
  mode.addEventListener('change', () => {
    store.write(path, mode.value === 'variable' ? variableRef(variables[0] ? variables[0].id : '') : constant(''), null);
    store.refresh();
  });

  let control;
  if (ref.mode === 'variable') {
    const sel = h('select', { class: 'inp' },
      h('option', { value: '' }, '— pick a variable —'),
      ...variables.map((v) => h('option', { value: v.id, selected: v.id === ref.variableId }, `${v.name || '(unnamed)'} = ${variableText(v)}`)));
    sel.addEventListener('change', () => { store.write(path, variableRef(sel.value), null); store.refresh(); });
    control = sel;
  } else {
    const inp = options.text
      ? h('input', { class: 'inp', type: 'text', placeholder: options.placeholder || '', value: ref.value ?? '' })
      : h('input', { class: 'inp inp-num', type: 'text', inputmode: 'decimal', placeholder: options.placeholder || '', value: ref.value ?? '' });
    inp.addEventListener('input', () => store.write(path, constant(inp.value), keyOf(path), true));
    inp.addEventListener('change', () => { store.write(path, constant(inp.value), keyOf(path), true); store.refresh(); });
    control = inp;
  }

  return withVariant(store, path, h('span', { class: 'value-ref' }, mode, control, options.unit ? h('span', { class: 'unit' }, options.unit) : null));
}

/** Shorthands for composing form rows. */
export const textField = (store, path, label, options = {}) => field(label, textInput(store, path, options), options);
export const selectField = (store, path, label, options, extra = {}) => field(label, selectInput(store, path, options, extra), extra);
export const multiField = (store, path, label, options, extra = {}) => field(label, multiInput(store, path, options, extra), extra);
export const valueField = (store, path, label, doc, options = {}) => field(label, valueInput(store, path, doc, options), options);

/** Select options built from a collection. */
export const optionsFrom = (list, codes, nameField = 'name') =>
  (list || []).map((e) => ({ value: e.id, label: optionLabel(codes, e, nameField) }));
