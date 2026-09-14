// The values a marked piece of text takes, one row per version of the document.
//
// The blue on the page says «this is not the same for every product». It does not say what
// it is for each of them, and the reader who noticed the blue is exactly the one who now
// wants that: the table answers with the base first, then every variant, in the words the
// page itself uses for the value.
import { h, table } from './dom.js';
import { valuesByVariant } from '../model/variance.js';

/**
 * @param {object} store
 * @param {string} id the entity the text belongs to
 * @param {string} field the field inside it (empty: the entity itself — is it run at all)
 */
export function variantTable(store, id, field) {
  const rows = valuesByVariant(store.state.doc, id, field);
  const active = store.activeVariant();
  const base = rows.find((r) => r.isBase) || { value: '', present: true };
  const shownName = active ? active.name || '(unnamed variant)' : 'Base document';

  const body = rows.map((r) => {
    const current = (active ? !r.isBase && r.name === shownName : r.isBase);
    const differs = r.present !== base.present || r.value !== base.value;
    return h('tr', { class: [current && 'row-current'] },
      h('td', {}, r.name, current ? h('span', { class: 'muted' }, ' — on screen') : null),
      h('td', { class: [differs && !r.isBase && 'value-differs'] },
        r.present
          ? (r.value || h('span', { class: 'muted' }, '(empty)'))
          : h('em', { class: 'muted' }, field ? 'not in this version' : 'not run in this version')));
  });

  return h('div', { class: 'variant-values' },
    table(['Version', field ? 'Value' : 'Runs'], body, { class: 'table-compact' }),
    h('p', { class: 'hint' }, 'In bold, what differs from the base document.'));
}
