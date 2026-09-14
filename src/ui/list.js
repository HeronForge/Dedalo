// Generic list + detail editor, shared by all the simple collections
// (references, variables, resources, interfaces, commands, images, points).
import { h, button, empty, confirm } from './dom.js';
import { cloneEntity, indexAfter } from '../model/clone.js';

/**
 * @param {object} cfg
 *  - key: name of the collection in the document (e.g. 'resources')
 *  - title, singular: labels
 *  - factory(): a new entity
 *  - row(e, i): contents of the list entry
 *  - detail(e, path): the detail form
 *  - intro: optional node shown above the list
 */
export function listEditor(store, cfg) {
  const doc = store.resolvedDoc();
  const items = doc[cfg.key] || [];
  const selectedId = currentSelection(store, cfg.key, items);
  const selected = items.find((e) => e.id === selectedId) || null;

  // Reordering is a property of the base document, not something a variant can customise.
  const reorderBlocked = !!store.recordingVariant([cfg.key]);
  const reorderTitle = reorderBlocked ? 'The order belongs to the base document: leave the variant to change it' : null;

  const entries = items.map((e, i) =>
    h('li', { class: ['item', e.id === selectedId && 'item-sel'], onClick: () => select(store, cfg.key, e.id) },
      h('div', { class: 'item-text' }, cfg.row(e, i)),
      h('div', { class: 'item-actions' },
        button('↑', (ev) => { ev.stopPropagation(); store.move([cfg.key], e.id, -1); },
          { class: 'btn-icon', title: reorderTitle || 'Move up', disabled: reorderBlocked }),
        button('↓', (ev) => { ev.stopPropagation(); store.move([cfg.key], e.id, +1); },
          { class: 'btn-icon', title: reorderTitle || 'Move down', disabled: reorderBlocked }),
        // Most entries of these lists are written by starting from the one above: the copy
        // lands right after the original, named «… (copy)» so the two are told apart.
        button('⧉', (ev) => {
          ev.stopPropagation();
          const copy = cloneEntity(e, { suffix: '(copy)' });
          store.add([cfg.key], copy, indexAfter(items, e.id));
          select(store, cfg.key, copy.id);
        }, { class: 'btn-icon', title: `Duplicate this ${cfg.singular.toLowerCase()}` }),
        button('✕', async (ev) => {
          ev.stopPropagation();
          if (await confirm(`Delete ${cfg.singular.toLowerCase()} «${cfg.nameOf ? cfg.nameOf(e) : e.name || ''}»?`, { danger: true, okLabel: 'Delete' }))
            store.remove([cfg.key, '#' + e.id]);
        }, { class: 'btn-icon btn-danger', title: 'Delete' }))));

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', {}, cfg.title),
      button(`+ ${cfg.singular}`, () => {
        const created = cfg.factory();
        store.add([cfg.key], created);
        select(store, cfg.key, created.id);
      }, { class: 'btn-primary' })),
    cfg.intro || null,
    h('div', { class: 'master-detail' },
      h('div', { class: 'master' }, items.length ? h('ul', { class: 'list' }, ...entries) : empty(`Nothing here yet. Use «+ ${cfg.singular}».`)),
      h('div', { class: 'detail' },
        selected
          ? cfg.detail(selected, [cfg.key, '#' + selected.id])
          : empty('Pick an entry from the list to edit it.'))));
}

export function currentSelection(store, key, items) {
  const sel = store.state.selection;
  if (sel && sel.section === key && items.some((e) => e.id === sel.id)) return sel.id;
  return items.length ? items[0].id : null;
}

export function select(store, key, id) {
  store.set({ selection: { section: key, id } });
}

/** Nested editable rows (parameters, characteristics): compact list with add/remove. */
export function subList(store, { path, items, factory, row, addLabel }) {
  return h('div', { class: 'sublist' },
    ...(items || []).map((e) =>
      h('div', { class: 'subrow' },
        row(e, [...path, '#' + e.id]),
        button('⧉', () => store.add(path, cloneEntity(e), indexAfter(items, e.id)),
          { class: 'btn-icon', title: 'Duplicate this row' }),
        button('✕', () => store.remove([...path, '#' + e.id]), { class: 'btn-icon btn-danger', title: 'Remove' }))),
    button(addLabel || '+ add', () => store.add(path, factory()), { class: 'btn-small' }));
}
