// Product variants: applicability matrix and list of customisations.
//
// A variant is a set of operations on the base document. The matrix covers the two most
// frequent cases (stage applicable or not, different variable value); everything else is
// customised by selecting the variant in the top bar and editing the document.
import { h, button, card, empty, table } from '../dom.js';
import { textField } from '../fields.js';
import { listEditor } from '../list.js';
import { newVariant, VARIABLE_TYPE } from '../../model/schema.js';
import { computeCodes, computeIndex, labelOf } from '../../model/codes.js';
import { applyOverlay, describeOperation, OP } from '../../model/variants.js';
import { samePath } from '../../model/paths.js';
import { variableText } from '../../model/variables.js';

export function variantsSection(store) {
  const base = store.state.doc;
  const codes = computeCodes(base);
  const index = computeIndex(base);

  return h('div', {},
    matrix(store, base, codes, index),
    listEditor(store, {
      key: 'variants', title: 'Product variants', singular: 'Variant',
      factory: newVariant,
      row: (e) => [h('strong', {}, e.name || '(unnamed)'), h('span', { class: 'muted' }, ` · ${(e.overlay || []).length} customisations`)],
      detail: (v, path) => h('div', {},
        card('Variant',
          textField(store, [...path, 'name'], 'Name', { placeholder: 'e.g. 24 V version' }),
          textField(store, [...path, 'description'], 'Description', { multiline: true, rows: 2 }),
          h('div', { class: 'toolstrip' },
            button(store.state.variantId === v.id ? '● Variant active in the view' : 'Show this variant',
              () => store.set({ variantId: store.state.variantId === v.id ? '' : v.id }),
              { class: store.state.variantId === v.id ? 'btn-primary' : '' }))),
        overrideList(store, base, v)),
    }));
}

function overrideList(store, base, v) {
  const ops = v.overlay || [];
  if (!ops.length) return card('Customisations', empty('No customisation: this variant matches the base document.'));
  const rows = ops.map((o, i) => {
    const d = describeOperation(base, o);
    return h('tr', {},
      h('td', {}, h('span', { class: ['tag', 'tag-' + o.op] }, d.action)),
      h('td', {}, d.where),
      h('td', {}, d.value),
      h('td', {}, button('✕', () => {
        store.change((doc) => {
          const target = (doc.variants || []).find((x) => x.id === v.id);
          if (target) target.overlay.splice(i, 1);
        });
      }, { class: 'btn-icon btn-danger', title: 'Drop the customisation' })));
  });
  return card('Customisations', table(['Action', 'Where', 'Value', ''], rows));
}

function matrix(store, base, codes, index) {
  const variants = base.variants || [];
  const stages = base.stages || [];
  const variables = base.variables || [];
  if (!variants.length) return card('Variant matrix', empty('Define at least one variant to use the matrix.'));

  const resolved = new Map(variants.map((v) => [v.id, applyOverlay(base, v).doc]));
  const headers = ['', ...variants.map((v) => v.name || '(unnamed)')];

  const stageRows = stages.map((s) => h('tr', {},
    h('th', { class: 'row-head' }, labelOf(codes, index, s.id, 40)),
    ...variants.map((v) => {
      const included = (resolved.get(v.id).stages || []).some((x) => x.id === s.id);
      const box = h('input', { type: 'checkbox', checked: included, title: included ? 'Applicable' : 'Not applicable' });
      box.addEventListener('change', () => setApplicability(store, v.id, ['stages', '#' + s.id], box.checked));
      return h('td', { class: 'center' }, box);
    })));

  const variableRows = variables.map((vr) => h('tr', {},
    h('th', { class: 'row-head' }, h('span', { class: 'code' }, codes.get(vr.id)), ' ', h('span', { class: 'muted' }, variableText(vr))),
    ...variants.map((v) => {
      const resolvedVar = (resolved.get(v.id).variables || []).find((x) => x.id === vr.id);
      if (!resolvedVar) return h('td', { class: 'center muted' }, '— removed —');
      const key = vr.type === VARIABLE_TYPE.RANGE ? 'min' : 'value';
      const inp = h('input', { class: 'inp inp-cell', value: resolvedVar[key] ?? '', title: 'Value for this variant' });
      inp.addEventListener('change', () => setValue(store, v.id, ['variables', '#' + vr.id, key], inp.value, vr[key]));
      return h('td', {}, inp);
    })));

  return card('Variant matrix',
    h('p', { class: 'hint' }, 'The tick says the stage applies to the variant. For values, a cell different from the base becomes a customisation.'),
    table(headers, [
      ...(stageRows.length ? [h('tr', { class: 'group-row' }, h('th', { colspan: variants.length + 1 }, 'Stages'))] : []),
      ...stageRows,
      ...(variableRows.length ? [h('tr', { class: 'group-row' }, h('th', { colspan: variants.length + 1 }, 'Global variables'))] : []),
      ...variableRows,
    ], { class: 'table-matrix' }));
}

function setApplicability(store, variantId, path, included) {
  store.change((doc) => {
    const v = (doc.variants || []).find((x) => x.id === variantId);
    if (!v) return;
    v.overlay = v.overlay.filter((o) => !(o.op === OP.REMOVE && samePath(o.path, path)));
    if (!included) v.overlay.push({ op: OP.REMOVE, path });
  });
}

function setValue(store, variantId, path, value, baseValue) {
  store.change((doc) => {
    const v = (doc.variants || []).find((x) => x.id === variantId);
    if (!v) return;
    v.overlay = v.overlay.filter((o) => !samePath(o.path, path));
    if (String(value) !== String(baseValue ?? '')) v.overlay.push({ op: OP.SET, path, value });
  });
}
