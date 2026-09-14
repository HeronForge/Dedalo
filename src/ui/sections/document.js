// On screen preview of the document, with interactive navigation:
// the codes in the steps (AP-01, CMD-02, RES-03…) open the detail card without losing
// your place, while in print they stay cross references to the appendices.
import { h, button, empty, modal, toast, formatDate } from '../dom.js';
import { renderDocument, renderStepPreview } from '../../render/document.js';
import { computeCodes, computeIndex, codeOf, markerLabel, labelOf } from '../../model/codes.js';
import { openPreview, watermark } from '../../print/print.js';
import { assetUrl } from '../../io/images.js';
import { variableText } from '../../model/variables.js';
import { stageGraph, graphLegend } from '../../render/graph.js';
import { openFigure, figureCrop, figureWithRegion, markerRegion, makeZoomable } from '../figure.js';
import { isReading } from '../reading.js';
import { watchDocument } from '../docspy.js';
import { hoverCards } from '../hovercard.js';
import { variantTable } from '../varianttable.js';
import { variableVaries, findEntity } from '../../model/variance.js';
import { mountNotes } from '../notes.js';
import { openForEditing, directEditingAllowed } from '../navigate.js';
import { revealStage } from './stages.js';
import { markerArea } from '../../model/schema.js';
import { fieldLabel } from '../../model/paths.js';
import { revisionDocument, isDraft } from '../../history/revisions.js';
import { compare, DIFF_TYPE } from '../../history/diff.js';
import { differenceRow, DIFFERENCE_HEADERS } from './revisions.js';

// Which sections the reader has folded away: kept outside the render so it survives redraws.
const collapsed = new Set();

/**
 * Which version the viewer is showing, and the differences from the one before it.
 * It lives outside the render because it survives every redraw, and it is a way of looking
 * at the document rather than a property of the document.
 */
const view = { revision: '', diff: null, loading: false, docNumber: null, previousLabel: null };

let stopHover = null; // the hover cards of the copy of the document currently on screen

export function documentSection(store) {
  const { assets, history } = store.state;
  const shown = shownDocument(store);
  const doc = shown.doc;
  const variant = shown.isDraft ? store.activeVariant() : null;
  const codes = store.codes();
  const index = computeIndex(doc);

  // The change record of an issued revision is the one it carried: the revisions that came
  // after it were not in it. The snapshot already holds itself as the last row, so the ones
  // passed alongside stop just before it.
  const shownHistory = shown.isDraft ? history : historyUpTo(history, shown.revision);
  // A sheet being read never leads into the editor, whatever the document allows on screen:
  // the reading mode is the whole document and nothing else, a stray click included.
  const reading = isReading();
  const rendered = renderDocument(doc, {
    assets, history: shownHistory, variant, base: store.state.doc,
    directEditing: !reading && directEditingAllowed(doc),
  });
  rendered.classList.add('document-screen');
  rendered.addEventListener('click', (ev) => {
    // In the revision matrix a code is a way to the line it names — the stage, the row of the
    // appendix, the variable — not to a card: the card is what the resting pointer gives,
    // and the reader who clicks wants to see the thing where it stands, edited or not.
    const jump = ev.target.closest('.doc-table-matrix [data-ref]');
    if (jump) {
      ev.preventDefault();
      const target = rendered.querySelector('#ref-' + cssEscape(jump.dataset.ref));
      if (!target) { toast('That element is no longer in the document.', 'warning'); return; }
      // Unfold whatever it sits in: a folded chapter would scroll to nothing.
      for (let el = target.parentElement; el; el = el.parentElement) {
        if (el.classList.contains('collapsed')) { el.classList.remove('collapsed'); collapsed.delete(el.id); }
      }
      target.scrollIntoView({ block: 'start' });
      return;
    }
    const card = ev.target.closest('[data-ref]');
    if (card) {
      ev.preventDefault();
      openCard(store, doc, assets, codes, index, card.dataset.ref);
      return;
    }
    // A reference with no card of its own leads where the entity is defined: the editor.
    const edit = ev.target.closest('[data-edit]');
    if (edit && !reading) {
      ev.preventDefault();
      if (!openForEditing(store, edit.dataset.edit, revealStage)) {
        toast('That reference points at something the document no longer contains.', 'warning');
      }
      return;
    }
    // Blue text: what it is worth in every version, base first.
    const dyn = ev.target.closest('[data-varies]');
    if (dyn) {
      ev.preventDefault();
      openValues(store, doc, codes, index, dyn.dataset.varies);
    }
  });
  // The same cards under a resting pointer, for a glance instead of a click — on the codes that
  // open a card, on the ones that lead into the editor, and on the blue text alike. The document
  // view is rebuilt whole at every redraw: the previous watch goes with the previous copy.
  // Not on a code where its entity is defined (`ref-def`): the heading of a stage, the row of a
  // step, the row of a command already show everything the card would, and a card that repeats
  // the line under it is noise. The blue mark around such a code still answers, with its table.
  if (stopHover) stopHover();
  stopHover = hoverCards(rendered, '[data-ref]:not(.ref-def), [data-edit]:not(.ref-def), [data-varies], [data-change-rev]', (el) => (el.dataset.varies
    ? valuesCard(store, doc, codes, index, el.dataset.varies)
    : el.dataset.changeRev !== undefined
      ? changeCard(el.dataset)
      : hoverCard(store, doc, assets, codes, index, el.dataset.ref || el.dataset.edit)));
  addFolding(rendered);
  addGraphZoom(rendered, doc, codes);
  addFigureZoom(rendered, doc, assets, codes);
  // What this version changed, marked where it happened rather than listed elsewhere.
  if (view.diff) markDifferences(rendered, view.diff, store);
  addRevisionPicker(rendered, store, shown);

  const obsolete = !shown.isDraft && shown.revision ? 'Rev. ' + shown.revision.number : null;
  const preview = h('div', { class: ['doc-preview', obsolete && 'doc-obsolete'] },
    obsolete
      ? h('div', { class: 'obsolete-banner' },
          h('strong', {}, 'Superseded content'),
          h('span', {}, `you are reading ${obsolete}, kept for comparison. The current version is the draft.`),
          button('Back to the draft', () => {
            view.revision = '';
            view.docNumber = null;
            view.diff = null;
            closeCard();
            store.refresh();
          }, { class: 'btn-small' }))
      : null,
    rendered);
  if (obsolete) preview.style.setProperty('--obsolete-label', watermark(obsolete));

  // The trail at the top follows the reading from here: the document is what scrolls.
  watchDocument(rendered);

  // Nothing between the trail and the sheet: what the head row used to carry — fold, read,
  // print — sits at the end of the trail now (see `documentTools`), and the sheet starts here.
  const section = h('div', { class: 'section section-document' },
    (doc.stages || []).length
      ? null
      // An empty document opens here too, and a blank cover is a poor welcome: say where to start.
      : h('p', { class: 'hint hint-start' },
          h('strong', {}, 'This specification is still empty. '),
          'Start from ', link(store, 'header', 'Header'), ', then ', link(store, 'variables', 'Global variables'),
          ', ', link(store, 'resources', 'Test resources'), ' and ', link(store, 'points', 'Application points'),
          ', and write the tests under ', link(store, 'stages', 'Stages, tests and steps'), '. ',
          'The guide docs/EDITING-GUIDE.md walks through it with examples.'),
    preview);
  // The notes of whoever is reading, in the margin: they are not the document and they are
  // drawn over it, on the section that holds the sheet.
  mountNotes(store, section, rendered);
  return section;
}

/**
 * What the document view offers besides the sheet, for the end of the trail: fold and unfold
 * the chapters. They used to sit in a row of their own between the trail and the sheet, which
 * was a second bar saying less than the first. Reading, notes, print and the legend live on
 * the rail beside the scrollbar (see ui/rail.js) — print went there from here, where a word
 * in the trail was neither found nor missed; Word stays in the File menu alone — it is the
 * rarer output, and a row that offers everything is a row nobody reads.
 */
export function documentTools() {
  const tool = (label, onClick, title) =>
    h('button', { type: 'button', class: 'crumb-tool', title, onClick }, label);
  return [
    tool('Collapse all', () => foldAll(true), 'Fold every chapter away, headings alone'),
    tool('Expand all', () => foldAll(false), 'Open every chapter again'),
  ];
}

/** The paginated preview of the document on screen — the draft, or the revision being read. */
export function printDocument(store) {
  const shown = shownDocument(store);
  const { assets, history } = store.state;
  openPreview({
    doc: shown.doc, base: store.state.doc, assets,
    history: shown.isDraft ? history : historyUpTo(history, shown.revision),
    variant: shown.isDraft ? store.activeVariant() : null,
    obsolete: !shown.isDraft && shown.revision ? 'Rev. ' + shown.revision.number : null,
  });
}

/** Folds or opens every chapter of the sheet on screen, and remembers it across redraws. */
function foldAll(fold) {
  const rendered = document.querySelector('.content .document-screen');
  if (!rendered) return;
  for (const section of rendered.querySelectorAll('.doc-chapter, .doc-sub')) {
    if (!section.id) continue;
    section.classList.toggle('collapsed', fold);
    if (fold) collapsed.add(section.id); else collapsed.delete(section.id);
    const toggle = section.querySelector(':scope > * > .sec-toggle');
    if (toggle) toggle.textContent = fold ? '▸' : '▾';
  }
}

/**
 * The document the viewer is showing: the draft, or an issued revision recovered from its
 * snapshot. The snapshot is decompressed asynchronously, so the first draw after a change of
 * selection still shows the draft and the redraw that follows shows the revision.
 */
function shownDocument(store) {
  const { history } = store.state;
  const issued = history.revisions || [];
  const key = view.revision || '__draft__';

  if (!view.revision) {
    // The draft is a version like the others: the newest one, compared with the last issued.
    // That is why the marks are there without anything having to be selected first.
    const previous = issued.length ? issued[issued.length - 1] : null;
    if (view.docNumber !== key) ensureDiff(store, key, previous, () => store.resolvedDoc());
    return { doc: store.resolvedDoc(), isDraft: true, revision: null };
  }

  const revision = issued.find((r) => r.number === view.revision);
  if (!revision) { view.revision = ''; return { doc: store.resolvedDoc(), isDraft: true, revision: null }; }
  if (view.docNumber !== key) {
    const i = issued.indexOf(revision);
    ensureDiff(store, key, i > 0 ? issued[i - 1] : null, () => revisionDocument(revision));
    return { doc: store.resolvedDoc(), isDraft: true, revision: null, loading: true };
  }
  return { doc: view.doc, isDraft: false, revision };
}

/**
 * Loads the version to show and the one before it, once. Snapshots are compressed, so this is
 * asynchronous: the first draw shows the draft and the redraw that follows shows the version
 * that was asked for.
 */
async function ensureDiff(store, key, previousRevision, load) {
  if (view.loading) return;
  view.loading = true;
  try {
    const shown = await load();
    const previous = previousRevision ? await revisionDocument(previousRevision) : null;
    view.doc = shown;
    view.docNumber = key;
    view.previousLabel = previousRevision ? 'Rev. ' + previousRevision.number : null;
    view.diff = previous ? changedIds(compare(previous, shown)) : null;
  } catch (err) {
    toast('That revision could not be read: ' + err.message, 'error');
    view.revision = '';
    view.docNumber = null;
    view.diff = null;
  } finally {
    view.loading = false;
    store.refresh();
  }
}

/**
 * From the list of differences to the entities that carry them: every path is walked back to
 * the last id it names, which is the smallest thing the document draws on its own.
 */
export function changedIds(differences) {
  const ids = new Map(); // id -> { type, list }
  let removed = 0;
  for (const d of differences) {
    if (d.type === DIFF_TYPE.REMOVED) { removed++; continue; }
    const id = [...d.path].reverse().find((x) => typeof x === 'string' && x.startsWith('#'));
    const key = id ? id.slice(1) : '__document__';
    if (!ids.has(key)) ids.set(key, { type: d.type, list: [] });
    const entry = ids.get(key);
    // Added wins over changed: a new step is not a step with an edited field.
    if (d.type === DIFF_TYPE.ADDED) entry.type = DIFF_TYPE.ADDED;
    entry.list.push(d);
  }
  return { ids, removed, count: differences.length };
}

/**
 * A pin in the margin where something changed, rather than red text through the document.
 * Colour inside a specification reads as part of the value; a symbol beside the line says
 * "this moved" without pretending to be part of the sentence.
 */
function markDifferences(root, diff, store) {
  for (const [id, entry] of diff.ids) {
    if (id === '__document__') continue;
    const el = root.querySelector('#ref-' + CSS.escape(id));
    if (!el) continue;
    const added = entry.type === DIFF_TYPE.ADDED;
    el.classList.add('diff-mark', added ? 'diff-added' : 'diff-changed');
    const host = el.tagName === 'TR' ? el.querySelector('td') : el;
    if (!host || host.querySelector(':scope > .diff-pin')) continue;
    const many = entry.list.length === 1 ? '1 difference' : entry.list.length + ' differences';
    const pin = h('button', {
      type: 'button',
      class: ['diff-pin', added ? 'diff-pin-added' : 'diff-pin-changed'],
      title: (added ? 'Added in this version' : 'Changed in this version') + ' - ' + many + '. Click to see them.',
      onClick: (ev) => { ev.stopPropagation(); ev.preventDefault(); openDiffCard(store, id, entry); },
    }, added ? '+' : '\u0394');
    host.insertBefore(pin, host.firstChild);
  }
}

/** What changed here, with the previous content shown for what it is: superseded. */
function openDiffCard(store, id, entry) {
  closeCard();
  const codes = computeCodes(store.state.doc);
  const shownLabel = view.revision
    ? 'Rev. ' + view.revision
    : 'the draft (Rev. ' + ((store.state.doc.revision || {}).number || '-') + ')';
  const added = entry.type === DIFF_TYPE.ADDED;
  const panel = h('aside', { class: 'ref-panel ref-panel-diff' },
    h('div', { class: 'panel-title' },
      h('strong', {}, codeOf(codes, id) || 'Changes'),
      h('span', { class: 'tag tag-' + entry.type }, added ? 'Added' : 'Changed'),
      button('\u2715', closeCard, { class: 'btn-icon', title: 'Close' })),
    h('div', { class: 'panel-body' },
      h('p', { class: 'hint' },
        'What ', shownLabel, ' changed here, against ', view.previousLabel || 'the previous version', '. '),
      h('p', { class: 'obsolete-note' },
        h('strong', {}, 'Before'), ' is superseded content: kept so the change can be read, not for use.'),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'table diff-table' },
          h('thead', {}, h('tr', {},
            ...DIFFERENCE_HEADERS.map((t) => h('th', { class: t === 'Before' ? 'th-obsolete' : null },
              t === 'Before' ? 'Before (obsolete)' : t)))),
          h('tbody', {}, ...entry.list.map(differenceRow))))));
  document.body.appendChild(panel);
}

/** The issued revisions that came before the given one: the record as it stood then. */
function historyUpTo(history, revision) {
  const list = history.revisions || [];
  const i = list.findIndex((r) => r.number === revision.number);
  return { ...history, revisions: i < 0 ? list : list.slice(0, i) };
}

/**
 * The selector lives in the revision history, where the versions already are: one column of
 * radio buttons, the chosen row marked as the one being read and the row above it marked as
 * what it is compared with. A bar over the document said the same thing and took a strip of
 * every screen to say it.
 */
function addRevisionPicker(root, store, shown) {
  const rows = [...root.querySelectorAll('tr.rev-row')];
  if (!rows.length) return;
  const table = rows[0].closest('table');
  const head = table.querySelector('thead tr');
  if (head) head.insertBefore(h('th', { class: 'col-pick' }, 'Read'), head.firstChild);

  const issued = store.state.history.revisions || [];
  const draftNumber = (store.state.doc.revision || {}).number || '';
  const current = view.revision || '';
  // An issued document is its last revision: that row is the working copy, and reading it
  // is reading the document on screen, not a snapshot marked as superseded.
  const own = isDraft(store.state.doc) ? '' : draftNumber;

  const select = (value) => {
    view.revision = value;
    view.docNumber = null;
    view.diff = null;
    closeCard();
    store.refresh();
  };

  const radioCell = (value, label) => h('td', { class: 'col-pick' }, h('input', {
    type: 'radio', name: 'tsw-revision', checked: value === current,
    title: label, onChange: () => select(value),
  }));

  // The rows the document itself printed. While an issued revision is on screen its own row
  // is the last one, and it is the version being read.
  rows.forEach((row) => {
    let printed = row.dataset.draft === '1' ? (shown.isDraft ? '' : shown.revision.number) : row.dataset.rev;
    if (own && printed === own) printed = '';
    const label = printed ? 'Read Rev. ' + printed : own ? 'Read the document as it stands' : 'Read the draft';
    row.insertBefore(radioCell(printed, label), row.firstChild);
    if (printed === current) row.classList.add('rev-reading');
  });

  // The versions that came after the one on screen were not in its change record: they are
  // added here, plainly marked, so the way back is never further than a click.
  const printedNumbers = new Set(rows.map((r) => (r.dataset.draft === '1'
    ? (shown.isDraft ? draftNumber : shown.revision.number)
    : r.dataset.rev)));
  const later = [
    ...issued.filter((r) => !printedNumbers.has(r.number)).map((r) => ({ ...r, value: r.number === own ? '' : r.number })),
    ...(shown.isDraft || own ? [] : [{ value: '', number: draftNumber, date: (store.state.doc.revision || {}).date, author: (store.state.doc.revision || {}).author, reason: (store.state.doc.revision || {}).reason, status: 'draft' }]),
  ];
  const body = table.querySelector('tbody');
  for (const r of later) {
    body.appendChild(h('tr', { class: 'rev-row rev-later' },
      radioCell(r.value, r.value ? 'Read Rev. ' + r.number : own ? 'Read the document as it stands' : 'Read the draft'),
      h('td', {}, r.number || '—'),
      h('td', {}, formatDate(r.date)),
      h('td', {}, r.author || '—'),
      h('td', {}, r.reason || '—'),
      h('td', {}, (r.status === 'draft' ? 'Draft' : r.status === 'approved' ? 'Approved' : 'Issued') + ' · after this version')));
  }

  // The row above the one being read is what the differences are measured against.
  const all = [...table.querySelectorAll('tr.rev-row')];
  const i = all.findIndex((r) => r.classList.contains('rev-reading'));
  if (i > 0) all[i - 1].classList.add('rev-baseline');

  const label = view.revision ? 'Rev. ' + view.revision : own ? 'Rev. ' + own + ' as it stands' : 'the draft';
  const note = h('p', { class: 'doc-hint rev-caption' },
    view.diff
      ? [
          'Reading ', h('strong', {}, label), ' \u2014 differences from ',
          h('strong', {}, view.previousLabel), ' are pinned in the document: ',
          h('span', { class: 'diff-pin diff-pin-changed pin-sample' }, '\u0394'), ' changed, ',
          h('span', { class: 'diff-pin diff-pin-added pin-sample' }, '+'), ' added',
          view.diff.removed ? ', ' + view.diff.removed + ' removed (no longer in the document)' : '',
          '. ',
          store.activeVariant() && view.revision ? 'Shown as the base document, not through the selected variant.' : '',
        ]
      : ['Reading ', h('strong', {}, label), ' \u2014 nothing before it to compare with.']);
  table.parentNode.insertBefore(note, table.nextSibling);
}

/**
 * Folding, on screen only: a long specification is easier to walk through when the chapters
 * you are not reading are out of the way. The printed document is untouched.
 */
function addFolding(root) {
  const sections = [
    ...[...root.querySelectorAll('.doc-chapter')].map((el) => [el, el.querySelector(':scope > .doc-h2')]),
    ...[...root.querySelectorAll('.doc-sub')].map((el) => [el, el.querySelector(':scope > .doc-h3')]),
  ];
  for (const [section, heading] of sections) {
    if (!heading || !section.id) continue;
    const folded = collapsed.has(section.id);
    section.classList.toggle('collapsed', folded);
    const toggle = h('button', {
      type: 'button', class: 'sec-toggle', title: 'Fold this section away',
      'aria-expanded': folded ? 'false' : 'true',
    }, folded ? '▸' : '▾');
    const flip = (ev) => {
      // A code inside the heading is a link to its entity, not a place to fold from: this
      // handler stops the event, so it has to let the links through first.
      if (ev.target.closest('[data-edit], [data-ref]')) return;
      ev.preventDefault();
      ev.stopPropagation();
      const nowFolded = !section.classList.contains('collapsed');
      section.classList.toggle('collapsed', nowFolded);
      toggle.textContent = nowFolded ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', nowFolded ? 'false' : 'true');
      if (nowFolded) collapsed.add(section.id); else collapsed.delete(section.id);
    };
    toggle.addEventListener('click', flip);
    heading.addEventListener('click', flip);
    heading.classList.add('foldable');
    heading.insertBefore(toggle, heading.firstChild);
  }
}

/** The stage graph is the one figure worth looking at closely: a click opens it full size. */
function addGraphZoom(root, doc, codes) {
  const box = root.querySelector('.doc-graph');
  if (!box) return;
  const open = () => modal({
    title: 'Stage graph',
    width: '96vw',
    content: h('div', { class: 'graph-large' },
      stageGraph(doc, { codes }),
      h('ul', { class: 'legend' }, ...graphLegend().map((l) => h('li', {}, h('span', { class: 'legend-seg ' + l.className }), l.text)))),
  });
  makeZoomable(box, open);
}

/**
 * The pictures of the appendix open full size like the graph does, with the markers kept at
 * their own size: the enlargement is there to read the board, not the labels.
 */
function addFigureZoom(root, doc, assets, codes) {
  // The figures of the appendix, and the thumbnails a step points at: the same picture, the
  // same enlarged view, the same markers.
  for (const figure of root.querySelectorAll('.doc-figure[id^="ref-img"], .step-figure[data-figure]')) {
    const image = (doc.images || []).find((i) => 'ref-' + i.id === figure.id || i.id === figure.dataset.figure);
    if (!image) continue;
    const asset = (assets || {})[image.assetId] || {};
    const markers = [];
    for (const point of doc.points || []) {
      for (const m of point.markers || []) {
        if (m.imageId === image.id) markers.push({ x: m.x, y: m.y, label: markerLabel(point, codeOf(codes, point.id)), title: point.name || '' });
      }
    }
    makeZoomable(figure, () => openFigure({
      src: assetUrl(assets, image.assetId),
      alt: image.name || '',
      title: image.name || 'Figure',
      caption: image.caption || '',
      markers,
      width: asset.width,
      height: asset.height,
    }));
  }
}

const link = (store, section, label) =>
  h('button', { type: 'button', class: 'link-item', onClick: () => store.set({ section }) }, label);

// ---- detail cards ------------------------------------------------------------

function openCard(store, doc, assets, codes, index, id) {
  closeCard();
  const content = cardFor(doc, assets, codes, index, id, store);
  // The card answers «what is this»; the button answers «take me to it». Without it the
  // entities that have a card were the only ones the reader could not reach — except while
  // reading, when nothing leads into the editor.
  const canEdit = directEditingAllowed(doc) && !isReading();
  const panel = h('aside', { class: 'ref-panel' },
    h('div', { class: 'panel-title' },
      h('strong', {}, codeOf(codes, id) || 'Detail'),
      canEdit
        ? button('Edit', () => { closeCard(); openForEditing(store, id, revealStage); },
            { class: 'btn-small', title: 'Open this entity in the editor' })
        : null,
      button('✕', closeCard, { class: 'btn-icon', title: 'Close' })),
    h('div', { class: 'panel-body' }, content || empty('Element not found.')));
  document.body.appendChild(panel);
}

function closeCard() {
  document.querySelectorAll('.ref-panel').forEach((p) => p.remove());
}

/**
 * The side panel for a piece of blue text: what it is worth in the base document and in
 * every variant. `key` is what the mark carries — the entity and the field inside it.
 */
function openValues(store, doc, codes, index, key) {
  closeCard();
  const panel = h('aside', { class: 'ref-panel' },
    h('div', { class: 'panel-title' },
      h('strong', {}, 'Changes with the variant'),
      button('✕', closeCard, { class: 'btn-icon', title: 'Close' })),
    h('div', { class: 'panel-body' }, valuesCard(store, doc, codes, index, key)));
  document.body.appendChild(panel);
}

/** The table of values, with what it is about written above it. */
function valuesCard(store, doc, codes, index, key) {
  const [id, field = ''] = String(key || '').split('|');
  const entity = findEntity(store.state.doc, id) || findEntity(doc, id);
  const what = labelOf(codes, index, id, 48) || (entity && (entity.name || entity.description)) || '';
  return h('div', { class: 'values-card' },
    h('h4', {}, what || 'This value', field ? h('span', { class: 'muted' }, ` · ${fieldTitle(field)}`) : null),
    variantTable(store, id, field));
}

/**
 * The card of a cell of the revision matrix: the same shape as the card of a varying value,
 * with the two versions in place of the variants — what the line said in the revision before,
 * and what it says in this one — in full, where the cell had room for a few words.
 */
function changeCard({ changeRev, changePrev, changeTag, changeWhere, changeBefore, changeAfter, changeDraft }) {
  const label = (n, draft) => `Rev. ${n || '—'}${draft ? ' (draft)' : ''}`;
  const gone = h('em', { class: 'muted' }, changeTag === 'added' ? 'not there yet' : 'removed');
  const value = (v) => (v ? v : h('span', { class: 'muted' }, '(empty)'));
  const rows = [
    h('tr', {}, h('td', {}, label(changePrev)), h('td', {}, changeTag === 'added' ? gone : value(changeBefore))),
    h('tr', { class: 'row-current' }, h('td', {}, label(changeRev, changeDraft)), h('td', { class: 'value-differs' }, changeTag === 'removed' ? gone : value(changeAfter))),
  ];
  return h('div', { class: 'values-card' },
    h('h4', {}, changeWhere, h('span', { class: 'muted' }, ` · ${changeTag}`)),
    h('div', { class: 'variant-values' },
      h('table', { class: 'table table-compact' }, h('thead', {}, h('tr', {}, h('th', {}, 'Version'), h('th', {}, changeTag === 'moved' ? 'Position' : 'Value'))), h('tbody', {}, ...rows)),
      h('p', { class: 'hint' }, 'What this revision did to this line, against the revision before it.')));
}

/** «measurement.expected» as the reader knows it: Measurement › Expected value. */
const fieldTitle = (field) => field.split('.').filter((s) => !s.startsWith('#')).map(fieldLabel).join(' › ');

/** The card a resting pointer gets: the same content as the panel, without its chrome. */
function hoverCard(store, doc, assets, codes, index, id) {
  // A variable named in brackets after its value: the value is already on the line, and a
  // card that only says it again is left out. It comes when there is a description to read
  // or another version to compare.
  const variable = (doc.variables || []).find((v) => v.id === id);
  if (variable && !variable.description && !(store && variableVaries(store.variance(), id).length)) return null;
  const content = cardFor(doc, assets, codes, index, id, store);
  if (!content) return null;
  return h('div', {}, h('div', { class: 'hover-card-code' }, codeOf(codes, id) || ''), content);
}

const rows = (pairs) =>
  h('table', { class: 'doc-table' }, h('tbody', {}, ...pairs.filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => h('tr', {}, h('th', {}, k), h('td', {}, v)))));

const characteristics = (list) =>
  (list || []).filter((c) => c.name || c.value).map((c) => `${c.name} ${c.value}${c.unit ? ' ' + c.unit : ''}`).join(' · ');

function cardFor(doc, assets, codes, index, id, store) {
  const point = (doc.points || []).find((p) => p.id === id);
  if (point) return pointCard(doc, assets, codes, point);

  const command = (doc.commands || []).find((c) => c.id === id);
  if (command) {
    const itf = (doc.interfaces || []).find((i) => i.id === command.interfaceId);
    const protocol = (doc.protocols || []).find((p) => p.id === command.protocolId);
    return h('div', {},
      h('h4', {}, command.name || ''),
      rows([
        ['Interface', itf ? `${labelOf(codes, index, itf.id, 40)} (${itf.type || ''})` : '—'],
        ['Protocol', protocol ? `${labelOf(codes, index, protocol.id, 40)}${protocol.family ? ' · ' + protocol.family : ''}` : '—'],
        ['Interface requirements', itf ? characteristics(itf.parameters) : ''],
        ['Address', command.address],
        ['Request format', command.requestFormat],
        ['Response format', command.responseFormat],
        ['Encoding', command.encoding],
        ['Example', command.example],
        ['Notes', command.notes],
      ]));
  }

  const protocol = (doc.protocols || []).find((p) => p.id === id);
  if (protocol) return h('div', {},
    h('h4', {}, protocol.name || ''),
    rows([
      ['Family', protocol.family],
      ['What it is', protocol.description],
      ['Request', protocol.requestFormat],
      ['Response', protocol.responseFormat],
      ['Rules', characteristics(protocol.rules)],
      ['Notes', protocol.notes],
    ]));

  const resource = (doc.resources || []).find((r) => r.id === id);
  if (resource) return h('div', {},
    h('h4', {}, resource.name || ''),
    rows([['Category', resource.category], ['Characteristics', characteristics(resource.characteristics)], ['Notes', resource.notes]]));

  const variable = (doc.variables || []).find((v) => v.id === id);
  if (variable) return h('div', {},
    h('h4', {}, variable.name || ''),
    rows([['Value', variableText(variable)], ['Description', variable.description]]),
    // A variable some variant redefines is the reason the blue exists: its card says what
    // every version makes of it, base first.
    store && variableVaries(store.variance(), id).length ? variantTable(store, id, 'value') : null);

  const stage = (doc.stages || []).find((s) => s.id === id);
  if (stage) return h('div', {},
    h('h4', {}, stage.name || ''),
    rows([
      ['Description', stage.description],
      ['Prerequisites', (stage.prerequisites || []).map((p) => labelOf(codes, index, p, 30)).join(', ')],
      ['Tests', String((stage.tests || []).length)],
    ]));

  // The entities whose code leads into the editor rather than to a card of its own. A pointer
  // resting on them still gets an answer: a click is a trip, a glance should not be.
  const itf = (doc.interfaces || []).find((i) => i.id === id);
  if (itf) return h('div', {},
    h('h4', {}, itf.name || ''),
    rows([
      ['Type', itf.type],
      ['Requirements', characteristics(itf.parameters)],
      ['Driven by', itf.resourceId ? labelOf(codes, index, itf.resourceId, 40) : ''],
      ['Connected at', (itf.pointIds || []).map((p) => labelOf(codes, index, p, 30)).join(', ')],
      ['Notes', itf.notes],
    ]));

  const reference = (doc.references || []).find((r) => r.id === id);
  if (reference) return h('div', {},
    h('h4', {}, reference.title || ''),
    rows([['Code', reference.code], ['Revision / date', reference.revision], ['Notes', reference.notes]]));

  const variant = (doc.variants || []).find((v) => v.id === id);
  if (variant) return h('div', {},
    h('h4', {}, variant.name || ''),
    rows([['Description', variant.description], ['Customisations', String((variant.overlay || []).length)]]));

  const image = (doc.images || []).find((i) => i.id === id);
  if (image) return h('div', {},
    h('h4', {}, image.name || ''),
    (assets || {})[image.assetId] ? h('img', { class: 'card-image', src: assetUrl(assets, image.assetId), alt: image.name || '' }) : null,
    rows([['Caption', image.caption]]));

  for (const s of doc.stages || []) {
    for (const t of s.tests || []) {
      if (t.id === id) return h('div', {},
        h('h4', {}, t.name || '(unnamed test)', t.kpi ? h('span', { class: 'tag tag-kpi' }, 'KPI') : null),
        rows([['In stage', labelOf(codes, index, s.id, 40)], ['Purpose', t.purpose], ['Steps', String((t.steps || []).length)]]));
      const step = (t.steps || []).find((p) => p.id === id);
      // The row exactly as the page prints it: what a step is, is what it says.
      if (step) return h('div', {},
        h('div', { class: 'muted' }, `In ${labelOf(codes, index, t.id, 40)}`),
        renderStepPreview(doc, step, { assets, base: store ? store.state.doc : doc }));
    }
  }

  return null;
}

function pointCard(doc, assets, codes, point) {
  const uses = [];
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || [])
    for (const [label, block] of [['stimulus', s.stimulus], ['measurement', s.measurement]])
      if (block && (block.pointIds || []).includes(point.id)) uses.push(`${codeOf(codes, s.id)} (${label})`);

  // What one needs when reaching for the point: the area around it first, the whole board
  // underneath with that area outlined, so the crop can be placed at a glance.
  const figures = (point.markers || []).map((m) => {
    const img = (doc.images || []).find((i) => i.id === m.imageId);
    if (!img) return null;
    const asset = (assets || {})[img.assetId] || {};
    const src = assetUrl(assets, img.assetId);
    const label = markerLabel(point, codeOf(codes, point.id));
    const region = markerRegion(m, markerArea(m));
    const others = [];
    for (const other of doc.points || []) {
      for (const om of other.markers || []) {
        if (om.imageId !== img.id) continue;
        others.push({ x: om.x, y: om.y, label: markerLabel(other, codeOf(codes, other.id)), title: other.name || '', own: other.id === point.id });
      }
    }
    const open = () => openFigure({
      src, alt: img.name || '', title: `${label} — ${img.name || 'figure'}`, caption: img.caption || '',
      markers: others, width: asset.width, height: asset.height,
    });
    return h('figure', { class: 'doc-figure card-figure' },
      figureCrop({ src, alt: img.name || '', width: asset.width, height: asset.height, region, markers: others }),
      h('figcaption', {}, img.name || '', ' — ', h('span', { class: 'muted' }, `area of ${Math.round(region.f * 100)} %`)),
      figureWithRegion({ src, alt: img.name || '', region, markers: others }),
      button('⤢ Enlarge', open, { class: 'btn-small' }));
  }).filter(Boolean);

  return h('div', {},
    h('h4', {}, point.name || ''),
    rows([
      ['Connector', point.connector],
      ['Pin', point.pin],
      ['Signal', point.signal],
      ['Contact type', point.contactType],
      ['Characteristics', characteristics(point.characteristics)],
      ['Used by', uses.join(', ')],
      ['Notes', point.notes],
    ]),
    ...figures);
}

const cssEscape = (v) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, '\\$&'));
