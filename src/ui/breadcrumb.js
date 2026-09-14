// Where you are, said in one line under the command bar.
//
// A specification is deep — a section, a stage, a test, a step — and the panels that show it
// are all called «master» and «detail». After ten minutes of editing, what one has lost is not
// the content but the place: the trail names it, and every step of it leads back.
//
// Each step also knows its neighbours. Resting the pointer on a crumb drops the list of what
// else stands at that level — the other groups, the other sections, the other stages of the
// chapter — and resting on one of those opens what it contains, a level further down: a group
// its sections, a section its stages, a stage its tests, a test its steps. The trail is a way
// across the document as much as a way back up it, and the pointer never has to leave it.
import { h } from './dom.js';
import { currentSelection } from './list.js';
import { stageSelection, revealStage } from './sections/stages.js';
import { codeOf, nameOf, labelOf, computeIndex } from '../model/codes.js';
import { documentPosition, documentSiblings, documentChildren, documentChapters } from './docspy.js';
import { documentTools } from './sections/document.js';

/** Sections whose entries are picked from a list of their own: the trail names the one shown. */
const COLLECTIONS = new Set(['references', 'variables', 'variants', 'resources', 'protocols',
  'interfaces', 'commands', 'images', 'points']);

/**
 * The trail as data.
 * @param {Map<string, {group: string, label: string}>} sections what the navigation panel offers
 * @param {{reading?: boolean}} [options] in reading mode the editor is not there to be named
 * @returns {Array<{label: string, kind: string, id?: string, options?: Array}>}
 *  `options` are the neighbours at that level: {label, go, current, children?}, where
 *  `children` is a function giving the options one level down — built only when asked for,
 *  because the trail is redrawn at every keystroke and a whole document of steps is not.
 */
export function trail(store, sections, { reading = false } = {}) {
  const sectionId = store.state.section;
  const where = sections.get(sectionId) || { group: '', label: 'Document' };
  const doc = store.resolvedDoc();
  const codes = store.codes();
  const index = computeIndex(doc);
  const selectedId = (store.state.selection || {}).id || null;
  const open = (id) => () => store.set({ section: id });

  // Stages, tests and steps, each opening onto the next. Picking a test or a step from here
  // also opens its stage in the tree, or the tree would show a selection it cannot reach.
  const pickStage = (kind, id, stageId) => () => {
    if (stageId) revealStage(stageId);
    store.set({ section: 'stages', selection: { section: 'stages', id, kind } });
  };
  const stepOptions = (stage, test) => (test.steps || []).map((p) => ({
    label: entityLabel(codes, index, p.id), current: p.id === selectedId, go: pickStage('step', p.id, stage.id),
  }));
  const testOptions = (stage) => (stage.tests || []).map((t) => ({
    label: entityLabel(codes, index, t.id), current: t.id === selectedId, go: pickStage('test', t.id, stage.id),
    children: (t.steps || []).length ? () => stepOptions(stage, t) : null,
  }));
  const stageOptions = () => (doc.stages || []).map((s) => ({
    label: entityLabel(codes, index, s.id), current: s.id === selectedId, go: pickStage('stage', s.id),
    children: (s.tests || []).length ? () => testOptions(s) : null,
  }));

  // What a section contains, for the menus above it: its entries, or its stages.
  const contentsOf = (id) => {
    if (id === 'stages') return (doc.stages || []).length ? stageOptions : null;
    if (!COLLECTIONS.has(id) || !(doc[id] || []).length) return null;
    return () => (doc[id] || []).map((e) => ({
      label: entityLabel(codes, index, e.id), current: sectionId === id && e.id === currentSelection(store, id, doc[id]),
      go: () => store.set({ section: id, selection: { section: id, id: e.id } }),
    }));
  };

  // The groups, in the order the panel lists them, each leading to its first section.
  const groups = [];
  for (const [id, place] of sections) {
    const g = groups.find((x) => x.title === place.group);
    if (g) g.ids.push(id); else groups.push({ title: place.group, ids: [id] });
  }
  const sectionOptions = (title) => [...sections].filter(([, p]) => p.group === title)
    .map(([id, p]) => ({ label: p.label, go: open(id), current: id === sectionId, children: contentsOf(id) }));
  const groupCrumb = {
    label: where.group, kind: 'group',
    options: groups.map((g) => ({
      label: g.title, go: open(g.ids[0]), current: g.title === where.group, children: () => sectionOptions(g.title),
    })),
  };
  const sectionCrumb = { label: where.label, kind: 'section', options: sectionOptions(where.group) };

  // In the document view the question is not which panel is open — it never changes while one
  // reads — but which chapter, which stage, which test is under the eye.
  if (sectionId === 'document') {
    const placeOption = (item, current) => ({
      label: item.label, current, go: () => item.el.scrollIntoView({ block: 'start' }),
      children: documentChildren(item).length ? () => documentChildren(item).map((k) => placeOption(k, false)) : null,
    });
    const head = reading
      ? [{
          label: (doc.header || {}).title || 'Test specification', kind: 'title',
          options: documentChapters().map((ch) => placeOption(ch, false)),
        }]
      : [groupCrumb, sectionCrumb];
    const places = documentPosition().chain.map((c) => ({
      label: c.label, kind: 'place', el: c.el,
      options: documentSiblings(c).map((s) => placeOption(s, s === c)),
    }));
    return [...head, ...places];
  }

  const parts = [groupCrumb, sectionCrumb];
  if (sectionId === 'stages') {
    // The tree shows a stage even when nothing was ever clicked: the trail says the same one.
    const sel = stageSelection(store, doc);
    if (sel && sel.stage) parts.push({ ...crumb(codes, index, sel.stage.id, 'stage'), options: stageOptions() });
    if (sel && sel.test) parts.push({ ...crumb(codes, index, sel.test.id, 'test'), options: testOptions(sel.stage) });
    if (sel && sel.step) parts.push({ ...crumb(codes, index, sel.step.id, 'step'), options: stepOptions(sel.stage, sel.test) });
  } else if (COLLECTIONS.has(sectionId)) {
    const items = doc[sectionId] || [];
    const id = currentSelection(store, sectionId, items);
    const list = contentsOf(sectionId);
    if (id && list) parts.push({ ...crumb(codes, index, id, 'entity'), options: list() });
  }
  return parts;
}

/** The bar itself. Every crumb but the last one leads somewhere; every one drops its neighbours. */
export function breadcrumb(store, sections, { openSections }) {
  const reading = document.body.classList.contains('reading-mode');
  const parts = trail(store, sections, { reading });
  const bar = h('nav', { class: 'crumbs', 'aria-label': 'Position in the specification' });
  parts.forEach((part, i) => {
    if (i) bar.appendChild(h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›'));
    const here = i === parts.length - 1;
    const target = destination(store, part, openSections);
    const node = here || !target
      ? h('span', { class: ['crumb', 'crumb-static', here && 'crumb-here'], 'aria-current': here ? 'true' : null }, part.label)
      : h('button', { type: 'button', class: 'crumb', title: target.title, onClick: target.go }, part.label);
    bar.appendChild(part.options && part.options.length > 1 ? withMenu(node, part.options) : node);
  });
  // The document view keeps its tools at the end of the trail: fold, unfold, print. Reading
  // and the legend sit on the rail beside the scrollbar, in both the ways of reading.
  if (store.state.section === 'document' && !reading) {
    bar.appendChild(h('span', { class: 'crumb-tools' }, ...documentTools(store)));
  }
  return bar;
}

/** A crumb with its neighbours folded underneath, shown while the pointer rests on it. */
function withMenu(node, options) {
  return h('span', { class: 'crumb-wrap' }, node, menuList(options));
}

/**
 * A list of options; an option with children opens them beside itself while the pointer rests
 * on it. The children are built the first time they are asked for and kept: a menu that opens
 * a second time should not be a second copy. They are positioned from the window rather than
 * from the list, so a long list that scrolls does not clip them.
 */
function menuList(options, sub = false) {
  const menu = h('div', { class: ['crumb-menu', sub && 'crumb-menu-sub'], role: 'menu' });
  for (const o of options) {
    const item = h('button', {
      type: 'button', role: 'menuitem', onClick: o.go,
      class: ['crumb-menu-item', o.current && 'crumb-menu-current', o.children && 'crumb-menu-more'],
    }, o.label);
    if (!o.children) { menu.appendChild(item); continue; }
    const wrap = h('div', { class: 'crumb-sub' }, item);
    let below = null;
    wrap.addEventListener('mouseenter', () => {
      if (!below) { below = menuList(o.children(), true); wrap.appendChild(below); }
      placeBeside(below, item);
    });
    menu.appendChild(wrap);
  }
  return menu;
}

/** To the right of the item, or to its left when the window ends there; never off the bottom. */
function placeBeside(menu, item) {
  const r = item.getBoundingClientRect();
  const w = menu.offsetWidth || 220;
  const hgt = menu.offsetHeight || 0;
  const left = r.right + w > window.innerWidth - 8 ? Math.max(8, r.left - w) : r.right;
  const top = Math.max(8, Math.min(r.top - 5, window.innerHeight - hgt - 8));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

const crumb = (codes, index, id, kind) => ({ label: entityLabel(codes, index, id), kind, id });

/**
 * «STG-01 Power up». A global variable is left as its own code: written in full it would read
 * «$Vbatt Vbatt», which says the name twice and the place once.
 */
function entityLabel(codes, index, id) {
  const code = codeOf(codes, id);
  const name = nameOf(index, id);
  if (code && name && code === '$' + name) return code;
  return labelOf(codes, index, id, 36);
}

function destination(store, part, openSections) {
  if (part.kind === 'section') return { title: 'Open the list of sections', go: openSections };
  // Inside the document a crumb leads where it says, which is a chapter or a stage further up.
  if (part.kind === 'place') return { title: 'Back to this chapter', go: () => part.el.scrollIntoView({ block: 'start' }) };
  if (part.id) {
    const kind = part.kind === 'entity' ? null : part.kind;
    return {
      title: 'Back to this element',
      go: () => store.set({ selection: { section: store.state.section, id: part.id, ...(kind ? { kind } : {}) } }),
    };
  }
  return null;
}
