// Application frame: command bar, navigation on the left, current section.
import { h, button, menu, toast, confirm, pickFiles, clear, modal } from './dom.js';
import { headerSection, descriptionSection, referencesSection, glossarySection, variablesSection, resourcesSection, protocolsSection, interfacesSection, commandsSection, imagesSection } from './sections/basics.js';
import { pointsSection } from './sections/points.js';
import { stagesSection } from './sections/stages.js';
import { variantsSection } from './sections/variants.js';
import { validationSection, graphSection } from './sections/validation.js';
import { cycleTimeSection } from './sections/cycletime.js';
import { revisionsSection, issueFromToolbar } from './sections/revisions.js';
import { documentSection } from './sections/document.js';
import { aboutSection } from './sections/about.js';
import { emptyDocument } from '../model/schema.js';
import { emptyHistory } from '../history/revisions.js';
import { saveFile, openFile, exportJson, compareHistories } from '../io/file.js';
import { importData } from '../io/import.js';
import { exportWord } from '../export/word.js';
import { openPreview } from '../print/print.js';
import { formatBytes, assetsWeight } from '../io/images.js';
import { breadcrumb } from './breadcrumb.js';
import { recoveryStatus, clockOf } from './autosave.js';
import { onDocumentPosition } from './docspy.js';
import { sideRail } from './rail.js';
import { captureViewpoint, restoreViewpoint, takePinnedViewpoint } from './viewpoint.js';
import { exportNotes, importNotes, notesNeedExport, notesCount, notesStatus, notesOverview, adoptNotes } from './notes.js';

const GROUPS = [
  {
    title: 'Document', items: [
      ['header', 'Header', headerSection],
      ['description', 'Description', descriptionSection],
      ['references', 'External references', referencesSection],
      ['glossary', 'Glossary', glossarySection],
    ],
  },
  {
    title: 'Definitions', items: [
      ['variables', 'Global variables', variablesSection],
      ['variants', 'Product variants', variantsSection],
      ['resources', 'Test resources', resourcesSection],
      ['protocols', 'Protocols', protocolsSection],
      ['interfaces', 'Interfaces', interfacesSection],
      ['commands', 'Commands', commandsSection],
      ['images', 'Images', imagesSection],
      ['points', 'Application points', pointsSection],
    ],
  },
  {
    title: 'Testing', items: [
      ['stages', 'Stages, tests and steps', stagesSection],
      ['graph', 'Stage graph', graphSection],
      ['cycletime', 'Cycle time estimate', cycleTimeSection],
    ],
  },
  {
    title: 'Tools', items: [
      ['validation', 'Validation', validationSection],
      ['revisions', 'Revisions and comparison', revisionsSection],
      ['document', 'Document and print', documentSection],
      ['about', 'Version and changelog', aboutSection],
    ],
  },
];

const SECTIONS = new Map(GROUPS.flatMap((g) => g.items.map(([id, , render]) => [id, render])));

/** Where each section sits, for the trail that says where one is. */
const PLACES = new Map(GROUPS.flatMap((g) => g.items.map(([id, label]) => [id, { group: g.title, label }])));

/**
 * The navigation panel. It starts hidden — the file is opened to be read far more often than
 * to be edited, and the document deserves the whole width — but whoever works in it all day
 * can pin it open, and that choice is remembered.
 */
const nav = { open: false, pinned: readPinned() };

function readPinned() {
  // localStorage is not always reachable from file:// — a missing preference is not an error.
  try { return localStorage.getItem('tsw.nav.pinned') === '1'; } catch { return false; }
}

function writePinned(value) {
  try { localStorage.setItem('tsw.nav.pinned', value ? '1' : '0'); } catch { /* no preference kept */ }
}

export function mountApp(store, root) {
  const bar = h('header', { class: 'toolbar' });
  const sidebar = h('nav', { class: 'sidebar', id: 'tsw-nav', 'aria-label': 'Sections' });
  const scrim = h('div', { class: 'nav-scrim', onClick: () => setNav(false) });
  const content = h('main', { class: 'content' });
  const status = h('footer', { class: 'statusbar' });
  const trail = h('div', { class: 'crumb-host' });
  const rail = h('div', { class: 'rail-host' });

  root.appendChild(h('div', { class: 'app' }, bar, trail, h('div', { class: 'workspace' }, sidebar, scrim, content, rail), status));

  const drawNav = () => {
    clear(sidebar).appendChild(navigation(store, { setNav, togglePin }));
    const shown = nav.pinned || nav.open;
    sidebar.classList.toggle('nav-pinned', nav.pinned);
    sidebar.classList.toggle('nav-open', shown);
    scrim.classList.toggle('scrim-on', nav.open && !nav.pinned);
    for (const b of bar.querySelectorAll('.nav-toggle')) {
      b.classList.toggle('nav-toggle-on', shown);
      b.setAttribute('aria-expanded', shown ? 'true' : 'false');
    }
  };

  function setNav(open) { nav.open = open; drawNav(); }

  function togglePin() {
    nav.pinned = !nav.pinned;
    nav.open = nav.pinned;
    writePinned(nav.pinned);
    drawNav();
  }

  // Where each section was left. Following a code out of the document and coming back should
  // land on the same paragraph, not at the top of a fifteen page specification — and the same
  // paragraph after the layout has changed under it, which is what reading mode does. So it is
  // not an offset that is kept but a viewpoint: the element under the top edge (see viewpoint.js).
  const viewBySection = new Map();
  let shownSection = null;

  const draw = () => {
    // Reading mode changes the layout before asking for the redraw and pins the viewpoint it
    // took first; otherwise the one to keep is taken now, on the section being left.
    const pinned = takePinnedViewpoint();
    if (shownSection) viewBySection.set(shownSection, pinned || captureViewpoint(content));
    clear(bar).appendChild(commandBar(store, { setNav }));
    drawNav();
    const render = SECTIONS.get(store.state.section) || headerSection;
    clear(content).appendChild(render(store));
    shownSection = store.state.section;
    const point = viewBySection.get(shownSection);
    if (point) restoreViewpoint(content, point);
    // Pictures and the paginated figures settle a frame later and can move the content:
    // one more pass puts the position back where it belongs.
    if (point) requestAnimationFrame(() => { if (shownSection === store.state.section) restoreViewpoint(content, point); });
    drawCrumbs();
    drawStatus(true);
  };

  // The trail and the status line follow every keystroke, the sections do not: renaming a
  // stage has to show up at the top of the window without the field losing the focus.
  const drawCrumbs = () => {
    clear(trail).appendChild(breadcrumb(store, PLACES, { openSections: () => setNav(true) }));
    clear(rail).appendChild(sideRail(store));
  };

  const drawChrome = () => { drawCrumbs(); drawStatus(false); };

  // Reading moves the trail without changing anything in the document: the crumbs alone are
  // redrawn, and nothing else is asked to recompute at the speed of a scroll wheel.
  onDocumentPosition(drawCrumbs);

  // The validation behind the count at the bottom is the costliest thing the editor does, and
  // it does not have to keep up with every keystroke: on the light channel the bar is redrawn
  // at once with the last count it had, and the count itself catches up a moment later.
  let counts = null;
  let countsTimer = 0;
  const drawStatus = (fresh) => {
    if (fresh || !counts) counts = store.validation().counts;
    else if (!countsTimer) countsTimer = setTimeout(() => { countsTimer = 0; drawStatus(true); }, 300);
    const weight = assetsWeight(store.state.assets);
    const dirty = store.state.dirty;
    const net = recoveryStatus();
    clear(status).appendChild(h('div', { class: ['status-row', dirty && 'status-dirty'] },
      h('span', {}, dirty ? '● Unsaved changes' : '✓ Saved'),
      issuesButton(store, counts),
      h('span', {}, `Images ${formatBytes(weight)}`),
      notesCount() ? notesButton(store) : null,
      h('span', { class: net.on ? 'muted' : 'status-nonet', title: recoveryHint(net) }, recoveryText(net))));
    markTitle(store);
  };

  store.subscribe(draw);
  store.subscribeLight(drawChrome);
  draw();
  shortcuts(store, { setNav });
}

function commandBar(store, { setNav }) {
  const doc = store.resolvedDoc();
  const variants = store.state.doc.variants || [];

  const variantSelect = h('select', { class: 'inp inp-variant', title: 'Product variant shown' },
    h('option', { value: '' }, 'Base document'),
    ...variants.map((v) => h('option', { value: v.id, selected: v.id === store.state.variantId }, v.name || '(variant)')));
  variantSelect.addEventListener('change', () => store.set({ variantId: variantSelect.value }));

  return h('div', { class: 'toolbar-row' },
    h('button', {
      type: 'button', class: ['btn', 'nav-toggle'], title: 'Show the list of sections',
      'aria-controls': 'tsw-nav', 'aria-expanded': 'false',
      onClick: () => setNav(!(nav.pinned || nav.open)),
    }, h('span', { class: 'burger' }, '☰'), h('span', { class: 'nav-toggle-text' }, 'Sections')),
    h('div', { class: 'toolbar-title' },
      h('strong', {}, doc.header.title || 'Test specification'),
      h('span', { class: 'muted' }, ` Rev. ${(doc.revision || {}).number || '—'}`)),
    h('div', { class: 'toolbar-actions' },
      h('label', { class: 'toolbar-variant' }, h('span', { class: 'toolbar-variant-label' }, 'Variant'), variantSelect),
      // Two icons where two words used to be: the bar is read a hundred times a day, and what
      // a floppy and a tick mean is learnt once. The tooltips keep the words.
      button('💾', () => save(store), {
        class: ['btn-icon', 'btn-act', 'btn-primary', store.state.dirty && 'btn-unsaved'],
        title: store.state.dirty ? 'Save — there are unsaved changes (Ctrl+S)' : 'Save: download the updated file (Ctrl+S)',
      }),
      // Validating is a decision, not a file operation: it sits next to Save because that is
      // when one thinks of it, and it is the act that turns a draft into a revision.
      button('✔', () => issueFromToolbar(store),
        { class: ['btn-icon', 'btn-act'], title: 'Validate the draft: freeze it as an issued revision' }),
      button('↶', () => store.undo(), { class: 'btn-icon', title: 'Undo (Ctrl+Z)', disabled: !store.canUndo() }),
      button('↷', () => store.redo(), { class: 'btn-icon', title: 'Redo (Ctrl+Y)', disabled: !store.canRedo() }),
      // Everything used now and then lives in one menu: the bar used to carry eleven buttons,
      // two of which the document view offered again a few pixels below.
      menu('File ▾', [
        ['Open a specification…', () => open(store)],
        ['New empty specification', () => createNew(store)],
        null,
        ['Paginated preview and print', () => openPreview({
          doc, assets: store.state.assets, history: store.state.history, variant: store.activeVariant(),
        })],
        ['Export Word (.docx)', () => exportWord(store)],
        null,
        ['Export data (JSON)', () => exportJson(store.state)],
        ['Import data…', () => importJson(store)],
        null,
        ['Export notes (JSON)', () => exportNotes(store), { title: 'Download the notes file, named after the specification' }],
        ['Import notes…', () => importNotes(store), { title: 'Read a notes file written on this specification and merge it with yours' }],
      ], { title: 'Open, print, export, import' })),
    store.activeVariant()
      ? h('div', { class: 'variant-banner' },
          `Active variant: ${store.activeVariant().name || '(unnamed)'} — every change is recorded as a customisation of this variant.`,
          button('Back to the base document', () => store.set({ variantId: '' }), { class: 'btn-small' }))
      : null,
    // Nothing is written anywhere until you save: the editor holds the changes, the file on
    // disk is still the old one. That deserves a line of its own, not a note in a corner.
    store.state.dirty
      ? h('div', { class: 'unsaved-banner' },
          h('strong', {}, '● Unsaved changes'),
          h('span', {}, 'the file on disk is still the previous one. Saving downloads the updated file, which replaces it.'),
          button('Save now', () => save(store), { class: 'btn-small' }))
      : null);
}

/**
 * The state of the document, in the bar at the bottom, and the way into the validation panel.
 * The bar is quiet by trade — a line of small grey figures — so an error has to break that
 * quiet: a red plate with the count, not a number among the others.
 */
function issuesButton(store, counts) {
  const tone = counts.error ? 'error' : counts.warning ? 'warning' : 'ok';
  const text = counts.error
    ? `⚠ ${plural(counts.error, 'error')}${counts.warning ? ` · ${plural(counts.warning, 'warning')}` : ''}`
    : counts.warning ? `${plural(counts.warning, 'warning')}` : '✓ No issues';
  return h('button', {
    type: 'button', class: ['status-issues', 'status-issues-' + tone],
    title: 'Open the validation panel',
    onClick: () => store.set({ section: 'validation' }),
  }, text);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The notes in the corner: how many, and how many still to check — the one kind that asks
 * for somebody's time, so the one the bar names. A dot says the file on disk is behind.
 */
function notesButton(store) {
  const { total, counts } = notesStatus();
  const check = counts.toCheck ? ` · ${counts.toCheck} to check` : '';
  return h('button', {
    type: 'button', class: ['status-issues', counts.toCheck && 'status-issues-warning'],
    title: (notesNeedExport()
      ? 'Changed since the notes file was last downloaded: it downloads again with the next Save, or from File › Export notes.'
      : 'The notes file is up to date.') + ' Click for the notes by kind.',
    onClick: () => notesOverview(store),
  }, `Notes ${total}${check}${notesNeedExport() ? ' •' : ''}`);
}

/**
 * What the safety net is doing, in the corner where one looks for it. It says «copy», never
 * «saved»: the file on disk is still the one that was downloaded last, and the day that
 * difference is blurred is the day somebody loses a document.
 */
function recoveryText(net) {
  if (!net.on) return '⚠ No recovery copy';
  if (!net.at) return 'Recovery copy ready';
  return `Recovery copy ${clockOf(net.at)}${net.pictures ? '' : ' (text only)'}`;
}

const recoveryHint = (net) => (net.on
  ? 'A copy of the unsaved work is kept in this browser and offered back if the window dies. It is not a save: the file on disk changes only when you save it.'
  : `The work is not copied anywhere while you type: ${net.reason}. Save often.`);

/** The tab title says it too, for whoever comes back to the window later. */
function markTitle(store) {
  const doc = store.resolvedDoc();
  const name = [doc.header.documentCode, doc.header.title].filter(Boolean).join(' — ') || 'Test specification';
  document.title = (store.state.dirty ? '• ' : '') + name;
}

function navigation(store, { setNav, togglePin }) {
  return h('div', { class: 'nav-inner' },
    h('div', { class: 'nav-head' },
      h('span', { class: 'nav-head-title' }, 'Sections'),
      h('button', {
        type: 'button', class: ['btn-icon', 'nav-pin', nav.pinned && 'nav-pin-on'],
        title: nav.pinned ? 'Unpin: let the panel close when you pick a section' : 'Pin the panel open',
        'aria-pressed': nav.pinned ? 'true' : 'false',
        onClick: togglePin,
      }, nav.pinned ? '📌' : '📌'),
      h('button', {
        type: 'button', class: 'btn-icon nav-close', title: 'Hide the panel (Esc)',
        onClick: () => setNav(false),
      }, '✕')),
    ...GROUPS.map((g) =>
      h('div', { class: 'nav-group' },
        h('div', { class: 'nav-title' }, g.title),
        h('ul', {}, ...g.items.map(([id, label]) =>
          h('li', {},
            h('button', {
              type: 'button',
              class: ['nav-item', store.state.section === id && 'nav-item-sel'],
              // While the panel floats over the content, picking a section is also done with it.
              onClick: () => { store.set({ section: id }); if (!nav.pinned) setNav(false); },
            }, label)))))));
}

// ---- commands -----------------------------------------------------------------

function save(store) {
  try {
    const r = saveFile(store.state);
    store.markSaved();
    // The notes file goes with the specification, under the same name with .json, whenever
    // the notes have changed since it was last written: the two files are placed together.
    const notes = notesNeedExport() ? exportNotes(store) : null;
    toast(`File saved: ${r.name} (${formatBytes(r.bytes)}). Replace the original file with the downloaded one.`
      + (notes ? ` The notes went with it as ${notes.name}: keep it beside the specification.` : ''), 'ok', notes ? 9000 : 7000);
  } catch (err) {
    toast('Save failed: ' + err.message, 'error', 8000);
  }
}

async function open(store) {
  if (store.state.dirty && !(await confirm('There are unsaved changes: opening another file will lose them. Continue?', { danger: true, okLabel: 'Open anyway' }))) return;
  const [file] = await pickFiles({ accept: '.html,text/html' });
  if (!file) return;
  try {
    const data = await openFile(file);
    const relation = compareHistories(store.state.history, data.history);
    store.replaceAll(data);
    if (relation === 'behind') toast('Careful: the file you opened has fewer issued revisions than the one you were using. Check you are not starting from a stale copy.', 'warning', 9000);
    else if (relation === 'diverged') toast('Careful: this file and the one you were using share a revision number with different content. They are two diverging histories — decide which one is the good copy before going on.', 'warning', 12000);
    else toast('File opened.', 'ok');
  } catch (err) {
    toast('Could not open the file: ' + err.message, 'error', 8000);
  }
}

/**
 * Loads a JSON: either a previous export, or the authoring format described in
 * docs/IMPORT-GUIDE.md — the format a language model fills in when converting an older
 * specification. Whatever could not be resolved is listed, never silently dropped.
 */
async function importJson(store) {
  // What an import throws away is not only the unsaved work: it is every issued revision and
  // every picture of the document on screen, saved or not, and an undo brings back the
  // document alone. So the question is asked whenever there is something to lose.
  const losing = whatAnImportLoses(store);
  if (losing && !(await confirm(`Importing replaces the document on screen: ${losing}. Save it first if it matters. Continue?`, { danger: true, okLabel: 'Import anyway' }))) return;
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    toast('That file is not valid JSON: ' + err.message, 'error', 8000);
    return;
  }
  try {
    const result = importData(data);
    // What came in is on the screen and nowhere else: not saved, whatever the bar said before.
    store.replaceAll({
      doc: result.doc,
      history: result.history || emptyHistory(),
      assets: result.assets || {},
    }, { dirty: true });
    store.set({ section: 'validation', selection: null });
    // What the conversion said beside the document is the margin of the new one, signed by
    // the import and kept the way every note is: in the browser now, in the file on demand.
    const adopted = result.notes && result.notes.length ? adoptNotes(store, result.notes) : null;
    reportImport(store, result.problems, adopted);
  } catch (err) {
    toast('Import failed: ' + err.message, 'error', 8000);
  }
}

function reportImport(store, problems, adopted) {
  if (!problems.length && !adopted) {
    toast('Import done. Check the validation panel, then upload the images.', 'ok', 7000);
    return;
  }
  const notesLine = adopted ? notesOfConversion(adopted) : null;
  const m = modal({
    title: problems.length
      ? `Import done, with ${problems.length} thing${problems.length > 1 ? 's' : ''} to look at`
      : 'Import done',
    content: h('div', {},
      problems.length ? h('p', { class: 'hint' }, 'Everything else was imported. These points need a human eye:') : null,
      problems.length ? h('ul', { class: 'issue-list' }, ...problems.map((p) => h('li', { class: 'issue issue-warning' }, h('span', { class: 'dot' }, '!'), h('span', { class: 'issue-text' }, p)))) : null,
      notesLine),
    actions: [
      adopted && adopted.added ? button(`Download the ${plural(notesCount(), 'note')} of this document`, () => { exportNotes(store); m.close(); }) : null,
      button('Got it', () => m.close(), { class: 'btn-primary' }),
    ].filter(Boolean),
  });
}

/** What the conversion brought as notes, in one sentence: the kinds, and where they went. */
function notesOfConversion({ added, already, counts }) {
  const kinds = [['leftOut', 'left out', 'left out'], ['toCheck', 'to check', 'to check'], ['condition', 'condition', 'conditions'], ['free', 'remark', 'remarks']]
    .filter(([k]) => counts[k]).map(([k, one, many]) => `${counts[k]} ${counts[k] === 1 ? one : many}`);
  const brought = added + already;
  return h('p', { class: 'notes-of-import' },
    `${plural(brought, 'note')} came with this conversion (${kinds.join(', ')})`,
    already ? `: ${already} ${already === 1 ? 'was' : 'were'} already in the margin and now ${already === 1 ? 'sits' : 'sit'} beside the new document, ${added} ${added === 1 ? 'is' : 'are'} new. ` : '. ',
    'They are the coloured marks in the right margin of the sheet, not part of the document; the notes file downloads with the next Save, or now.');
}

async function createNew(store) {
  if (!(await confirm('Create an empty specification? The current content will be replaced (save first if you need it).', { danger: true, okLabel: 'Create new' }))) return;
  // A new document exists on the screen and nowhere else: it opens as unsaved.
  store.replaceAll({ doc: emptyDocument(), history: emptyHistory(), assets: {} }, { dirty: true });
  store.set({ section: 'header', selection: null });
}

/** What the document on screen would lose to an import, in words, or nothing when nothing. */
function whatAnImportLoses(store) {
  const parts = [];
  const issued = (store.state.history.revisions || []).length;
  const images = Object.keys(store.state.assets || {}).length;
  if (store.state.dirty) parts.push('the unsaved changes');
  if (issued) parts.push(`${issued} issued revision${issued === 1 ? '' : 's'}`);
  if (images) parts.push(`${images} image${images === 1 ? '' : 's'}`);
  if (!parts.length && (store.state.doc.stages || []).length) parts.push('its stages');
  return parts.join(', ');
}

function shortcuts(store, { setNav }) {
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && nav.open && !nav.pinned) { setNav(false); return; }
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === 's') { ev.preventDefault(); save(store); }
    else if (k === 'z' && !ev.shiftKey) { ev.preventDefault(); store.undo(); }
    else if (k === 'y' || (k === 'z' && ev.shiftKey)) { ev.preventDefault(); store.redo(); }
  });
}
