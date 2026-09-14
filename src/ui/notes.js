// Notes on the sheet: coloured marks in the right margin, a name and a text behind each.
//
// A note is placed where the eye is — click the margin at the height of the line — and it
// stays with that line: what is remembered is the element of the document under the click,
// by the id the document draws it with, not a number of pixels. Zoom, fold a chapter, add a
// step above: the mark follows.
//
// Nothing here asks to be saved. Every change goes to the browser's storage at once, and the
// notes file — the specification's name with .json — is downloaded with the next Save, or on
// demand from the File menu. That file is how notes travel: somebody else's is read back in
// with Import, merged by id, and every decision the merge takes is put in front of the reader
// before it is made effective.
import { h, button, modal, toast, pickFiles, formatDate } from './dom.js';
import {
  newNote, touchNote, notesEnvelope, notesBelongTo, mergeNotes, detachedNotes, NOTE_COLOURS, DEFAULT_COLOUR,
  NOTE_KINDS, kindOf, kindColour, kindLabel, countByKind,
} from '../model/notes.js';
import { readNotes, writeNotes, readAuthor, writeAuthor } from '../io/notes.js';
import { safeStorage } from '../io/recovery.js';
import { download, suggestedFileName } from '../io/file.js';
import { hoverCards } from './hovercard.js';

const state = {
  store: null,
  storage: null,
  identity: '',      // which specification the notes in hand belong to
  notes: [],
  changed: '',       // when the set last changed, to know whether the file is behind
  exported: '',      // when the file was last downloaded
  author: { name: '', color: DEFAULT_COLOUR },
  placing: false,
  hidden: new Set(), // the kinds taken off the sheet for now: a filter, not a deletion
};

let mounted = null;  // the strip on the sheet currently on screen, and what tears it down

// ---- life cycle ---------------------------------------------------------------

/** Loads the notes of the document in hand and follows the document when it is replaced. */
export function setupNotes(store) {
  state.store = store;
  state.storage = safeStorage();
  const author = readAuthor(state.storage);
  state.author = { name: author.name || '', color: author.color || DEFAULT_COLOUR };
  load();
  store.subscribe(() => { if (identityOf(store.state.doc) !== state.identity) load(); });
}

const identityOf = (doc) => {
  const h = (doc || {}).header || {};
  return `${h.documentCode || ''}|${h.title || ''}`;
};

function load() {
  const doc = state.store.state.doc;
  const kept = readNotes(state.storage, doc);
  state.identity = identityOf(doc);
  state.notes = kept.notes;
  state.exported = kept.exported;
  state.changed = kept.changed || '';
  layout();
}

function persist() {
  state.changed = new Date().toISOString();
  writeNotes(state.storage, state.store.state.doc, { notes: state.notes, exported: state.exported, changed: state.changed });
  layout();
  state.store.refreshLight();
}

/** Whether the notes file on disk, if any, is behind what the browser holds. */
export const notesNeedExport = () => state.notes.length > 0 && state.changed > state.exported;

export const notesCount = () => state.notes.length;

/** How many notes there are, and of which kinds: what the status bar says. */
export const notesStatus = () => ({ total: state.notes.length, counts: countByKind(state.notes), hidden: new Set(state.hidden) });

/**
 * Takes the notes a conversion brought as the notes of the document just imported. The
 * browser may already hold notes under that name — from an earlier import of the same file,
 * beside which somebody may have written their own — and those are kept. An incoming note
 * that says what a note already there says, of the same kind and by the same name, is that
 * note brought again: it stays, and its anchor follows the new document, whose ids are all
 * new. Two notes with the same words on two elements — the same remark on two commands —
 * are two notes, and each is matched once. So importing the same file twice does not write
 * the margin twice, and does not leave the first import's notes pointing at elements that
 * are gone.
 * @returns {{added: number, already: number, counts: object}}
 */
export function adoptNotes(store, incoming) {
  if (identityOf(store.state.doc) !== state.identity) load();
  const key = (n) => [kindOf(n), n.name || '', n.text || ''].join('\u0000');
  const pool = new Map();
  for (const n of state.notes) { if (!pool.has(key(n))) pool.set(key(n), []); pool.get(key(n)).push(n); }
  let added = 0;
  let already = 0;
  let changed = false;
  for (const n of incoming || []) {
    const candidates = pool.get(key(n)) || [];
    if (!candidates.length) { state.notes = [...state.notes, n]; added += 1; changed = true; continue; }
    // The one already on the same element first; otherwise any one brought before.
    const at = candidates.findIndex((m) => JSON.stringify(m.anchor || null) === JSON.stringify(n.anchor || null));
    const m = candidates.splice(at >= 0 ? at : 0, 1)[0];
    already += 1;
    if (at >= 0) continue;
    const moved = touchNote(m, { anchor: n.anchor });
    state.notes = state.notes.map((x) => (x.id === m.id ? moved : x));
    changed = true;
  }
  if (changed) persist();
  return { added, already, counts: countByKind(incoming || []) };
}

/**
 * The notes of the document, by kind: how many of each, and which kinds are on the sheet.
 * A kind taken off the sheet is still there — the count says so — it is just not in the way.
 */
export function notesOverview(store) {
  const counts = countByKind(state.notes);
  const chips = h('div', { class: 'kind-chips' });
  const paint = () => chips.replaceChildren(...NOTE_KINDS.map((k) => h('button', {
    type: 'button', class: ['note-kind-chip', !state.hidden.has(k.id) && 'note-kind-chip-on'],
    title: k.hint, 'aria-pressed': state.hidden.has(k.id) ? 'false' : 'true',
    onClick: () => { if (state.hidden.has(k.id)) state.hidden.delete(k.id); else state.hidden.add(k.id); paint(); layout(); },
  }, h('span', { class: 'note-dot', style: { background: k.color } }), ` ${k.label} `, h('span', { class: 'tag' }, String(counts[k.id])))));
  paint();
  const m = modal({
    title: state.notes.length ? `${state.notes.length} note${state.notes.length === 1 ? '' : 's'} on this document` : 'No note on this document yet',
    content: h('div', {},
      state.notes.length
        ? h('p', { class: 'hint' }, 'Press a kind to take it off the sheet or put it back. The marks are in the right margin; a resting pointer shows the words, a click opens them.')
        : h('p', { class: 'hint' }, 'Press 📝 beside the scrollbar, then click the sheet at the height the note goes.'),
      chips,
      state.notes.length
        ? h('p', { class: 'hint' }, notesNeedExport()
            ? 'The notes file is behind what the browser holds: it downloads again with the next Save, or from File › Export notes.'
            : 'The notes file is up to date.')
        : null),
    actions: [
      state.notes.length ? button('Download the notes file', () => { exportNotes(store); m.close(); }) : null,
      button('Close', () => m.close(), { class: 'btn-primary' }),
    ].filter(Boolean),
  });
}

// ---- the marks on the sheet ----------------------------------------------------

/**
 * Puts the marks on the sheet just drawn. Called by the document view after every render;
 * the previous strip goes with the previous copy of the sheet.
 */
export function mountNotes(store, section, rendered) {
  if (mounted) mounted.stop();
  const strip = h('div', { class: 'notes-strip', 'aria-label': 'Notes' });
  section.appendChild(strip);

  // The section, not the sheet: the sheet is zoomed in reading mode and its own coordinates
  // scale with it, while the section stays in the pixels the marks are placed in — and its
  // size changes whenever the sheet's does, folded chapter or zoom alike.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => layout()) : null;
  if (observer) observer.observe(section);
  const onResize = () => layout();
  window.addEventListener('resize', onResize);
  document.addEventListener('tsw:relayout', onResize);
  const stopHover = hoverCards(strip, '.note-mark', (el) => {
    const note = state.notes.find((n) => n.id === el.dataset.note);
    return note ? noteCard(note) : null;
  });
  const onPlace = (ev) => {
    if (!state.placing) return;
    ev.preventDefault();
    ev.stopPropagation();
    placeAt(section, rendered, ev.clientY);
  };
  section.addEventListener('click', onPlace, true);

  mounted = {
    section, rendered, strip,
    stop() {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('tsw:relayout', onResize);
      section.removeEventListener('click', onPlace, true);
      stopHover();
      strip.remove();
      if (mounted === this) mounted = null;
    },
  };
  // The section is put on the page right after this returns: the first layout waits for that,
  // and a second one waits for the frame, when pictures have settled and moved the lines.
  queueMicrotask(layout);
  requestAnimationFrame(layout);
}

/**
 * Every mark at the height of what it is attached to. The ones attached to nothing go to the
 * top left corner of the sheet, side by side: a place no line claims, and away from the rail.
 */
function layout() {
  if (!mounted || !mounted.section.isConnected) return;
  const { section, rendered, strip } = mounted;
  const sectionRect = section.getBoundingClientRect();
  const sheet = section.querySelector('.doc-preview');
  const sheetRect = sheet ? sheet.getBoundingClientRect() : sectionRect;
  const right = sheetRect.right - sectionRect.left - 22;
  const corner = sheetRect.left - sectionRect.left + 8;
  const ids = new Set([...rendered.querySelectorAll('[id]')].map((e) => e.id));
  const detached = new Set(detachedNotes(state.notes, ids).map((n) => n.id));

  let loose = 0;
  const placed = state.notes.filter((note) => !state.hidden.has(kindOf(note))).map((note) => {
    if (detached.has(note.id)) return { note, top: 6, left: corner + 18 * loose++, detached: true };
    const el = rendered.querySelector('#' + cssEscape(note.anchor.id));
    const r = el.getBoundingClientRect();
    const top = r.top - sectionRect.top + (note.anchor.fraction || 0) * r.height - 11;
    return { note, top: Math.max(0, top), left: right, detached: false };
  }).sort((a, b) => a.top - b.top);

  // Two notes on one line step left, into the sheet, instead of hiding each other.
  let lastTop = -100;
  let shift = 0;
  strip.replaceChildren(...placed.map((p) => {
    if (!p.detached) { shift = p.top - lastTop < 24 ? shift + 1 : 0; lastTop = p.top; }
    return h('button', {
      type: 'button',
      class: ['note-mark', p.detached && 'note-mark-detached'],
      style: { top: `${Math.round(p.top)}px`, left: `${Math.round(p.left - (p.detached ? 0 : shift * 16))}px`, background: p.note.color || DEFAULT_COLOUR },
      dataset: { note: p.note.id, kind: kindOf(p.note) },
      'aria-label': `${kindLabel(kindOf(p.note))} by ${p.note.name || 'somebody'}`,
      onClick: (ev) => { ev.stopPropagation(); editNote(p.note); },
    });
  }));
}

const cssEscape = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));

/** What a resting pointer gets: who, when, and the words. */
function noteCard(note) {
  const kind = kindOf(note);
  return h('div', { class: 'note-card' },
    h('div', { class: 'note-card-head' },
      h('span', { class: 'note-dot', style: { background: note.color || DEFAULT_COLOUR } }),
      h('strong', {}, note.name || '(no name)'),
      kind !== 'free' ? h('span', { class: 'note-kind-tag', style: { background: kindColour(kind) } }, kindLabel(kind)) : null,
      h('span', { class: 'muted' }, ` · ${formatDate(String(note.modified || '').slice(0, 10))}`),
      !note.anchor || !mounted || !mounted.rendered.querySelector('#' + cssEscape(note.anchor.id))
        ? h('span', { class: 'note-detached-tag', title: 'What this note was attached to is no longer in the document' }, 'detached')
        : null),
    h('div', { class: 'note-text' }, note.text || h('em', { class: 'muted' }, '(no text)')));
}

// ---- placing and editing --------------------------------------------------------

/** The button on the rail: press it, then click the sheet at the height the note goes. */
export function noteButton() {
  return h('button', {
    type: 'button', class: ['rail-btn', state.placing && 'rail-btn-on'],
    title: state.placing
      ? 'Click the sheet at the height the note goes (Esc to cancel)'
      : 'Add a note: press, then click the sheet at the height it goes',
    'aria-pressed': state.placing ? 'true' : 'false',
    onClick: () => (state.placing ? stopPlacing() : startPlacing()),
  }, '📝');
}

function startPlacing() {
  state.placing = true;
  document.body.classList.add('placing-note');
  document.addEventListener('keydown', onPlacingKey, true);
  toast('Click the sheet at the height the note goes. Esc to cancel.', 'info', 4000);
  state.store.refreshLight();
}

function stopPlacing() {
  state.placing = false;
  document.body.classList.remove('placing-note');
  document.removeEventListener('keydown', onPlacingKey, true);
  state.store.refreshLight();
}

const onPlacingKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); stopPlacing(); } };

/** The note goes on the element of the document under that height, and how far into it. */
function placeAt(section, rendered, clientY) {
  stopPlacing();
  const marks = [...rendered.querySelectorAll('[id]')];
  const i = lastAbove(marks, clientY);
  const el = i >= 0 ? marks[i] : marks[0];
  if (!el) { toast('There is nothing on the sheet to attach a note to.', 'warning'); return; }
  const r = el.getBoundingClientRect();
  const fraction = r.height > 0 ? Math.min(1, Math.max(0, (clientY - r.top) / r.height)) : 0;
  const note = newNote({ name: state.author.name, color: state.author.color, anchor: { id: el.id, fraction } });
  editNote(note, { isNew: true });
}

function lastAbove(list, y) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].getBoundingClientRect().top <= y) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

/**
 * The dialog of a note: name, kind, colour, text. Name and colour are remembered — they are
 * who is writing, and that does not change from one note to the next — so a note asks for
 * its text. Choosing a kind paints the note in the kind's colour; a swatch pressed afterwards
 * still wins, the colour being the author's to choose.
 */
function editNote(note, { isNew = false } = {}) {
  const name = h('input', { class: 'inp', value: note.name || '', placeholder: 'Your name or initials' });
  const text = h('textarea', { class: 'inp', rows: 5, placeholder: 'What you want to say about this line' }, note.text || '');
  let color = note.color || DEFAULT_COLOUR;
  let kind = kindOf(note);
  const swatches = h('div', { class: 'note-swatches', role: 'radiogroup' });
  const kinds = h('div', { class: 'kind-chips', role: 'radiogroup' });
  const paint = () => {
    swatches.replaceChildren(...NOTE_COLOURS.map((c) => h('button', {
      type: 'button', class: ['note-swatch', c.value === color && 'note-swatch-on'], title: c.label,
      style: { background: c.value }, role: 'radio', 'aria-checked': c.value === color ? 'true' : 'false',
      onClick: () => { color = c.value; paint(); },
    })));
    kinds.replaceChildren(...NOTE_KINDS.map((k) => h('button', {
      type: 'button', class: ['note-kind-chip', k.id === kind && 'note-kind-chip-on'], title: k.hint,
      role: 'radio', 'aria-checked': k.id === kind ? 'true' : 'false',
      onClick: () => { if (k.id !== kind) { kind = k.id; color = k.color; paint(); } },
    }, h('span', { class: 'note-dot', style: { background: k.color } }), ` ${k.label}`)));
  };
  paint();

  const m = modal({
    title: isNew ? 'New note' : 'Note',
    content: h('div', {},
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Name'), name),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Kind'), kinds),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Colour'), swatches),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Text'), text)),
    actions: [
      isNew ? null : button('Delete', () => {
        state.notes = state.notes.filter((n) => n.id !== note.id);
        persist();
        m.close();
      }, { class: 'btn-danger' }),
      button('Cancel', () => m.close()),
      button(isNew ? 'Add the note' : 'Save the note', () => {
        const changed = touchNote(note, { name: name.value.trim(), kind, color, text: text.value.trim() });
        // The colour of a plain note is the author's; the colour of a kind is the kind's.
        state.author = { name: changed.name, color: kind === 'free' ? color : state.author.color };
        writeAuthor(state.storage, state.author);
        state.notes = isNew ? [...state.notes, changed] : state.notes.map((n) => (n.id === note.id ? changed : n));
        persist();
        m.close();
      }, { class: 'btn-primary' }),
    ].filter(Boolean),
  });
  setTimeout(() => text.focus(), 0);
}

// ---- the file --------------------------------------------------------------------

/** The notes file, named after the specification exactly as Save names it. */
const notesFileName = (doc) => suggestedFileName(doc).replace(/\.html$/, '.json');

/** Downloads the notes file and remembers that the file is now up to date. */
export function exportNotes(store) {
  if (!state.notes.length) { toast('There are no notes yet: press 📝 beside the scrollbar and click the sheet.', 'info', 5000); return null; }
  const doc = store.state.doc;
  const exported = new Date().toISOString();
  const r = download(JSON.stringify(notesEnvelope(doc, state.notes, exported), null, 2), notesFileName(doc), 'application/json');
  state.exported = exported;
  writeNotes(state.storage, doc, { notes: state.notes, exported: state.exported, changed: state.changed });
  state.store.refreshLight();
  return r;
}

/**
 * Reads somebody's notes file into this document. Refused, with the reason, when the notes
 * belong to another specification or another revision; otherwise merged by id, and the
 * merge is shown — what comes in, what is taken over, what stays — before it is applied.
 */
export async function importNotes(store) {
  const [file] = await pickFiles({ accept: '.json,application/json' });
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    toast('That file is not valid JSON: ' + err.message, 'error', 8000);
    return;
  }
  const fit = notesBelongTo(data, store.state.doc);
  if (!fit.ok) {
    const m = modal({
      title: 'These notes cannot be read into this document',
      content: h('p', {}, fit.reason),
      actions: [button('Got it', () => m.close(), { class: 'btn-primary' })],
    });
    return;
  }
  const { notes, report } = mergeNotes(state.notes, data.notes);
  const ids = mounted ? new Set([...mounted.rendered.querySelectorAll('[id]')].map((e) => e.id)) : new Set();
  const loose = mounted ? detachedNotes(report.added.concat(report.updated.map((u) => u.theirs)), ids) : [];
  const total = report.added.length + report.updated.length + report.kept.length;
  if (!total) {
    toast(`Nothing new: the ${report.same} note${report.same === 1 ? '' : 's'} in that file ${report.same === 1 ? 'is' : 'are'} already here.`, 'info', 6000);
    return;
  }

  const line = (n) => `${n.name || '(no name)'}: «${shorten(n.text)}»`;
  const m = modal({
    title: 'Notes to bring in',
    content: h('div', {},
      h('p', {}, `${report.added.length} new, ${report.updated.length} changed in the file more recently than here, ${report.kept.length} changed here more recently, ${report.same} identical.`),
      report.updated.length
        ? part('Taken from the file — the file\'s change is the later one', report.updated.map((u) => `${line(u.theirs)} replaces «${shorten(u.mine.text)}»`))
        : null,
      report.kept.length
        ? part('Kept as they are here — your change is the later one', report.kept.map((k) => `${line(k.mine)} keeps over «${shorten(k.theirs.text)}»`))
        : null,
      report.added.length ? part('New', report.added.map(line)) : null,
      loose.length
        ? h('p', { class: 'warn-line' }, `${loose.length} of them point at something this document no longer draws; they will sit at the top of the sheet, marked as detached.`)
        : null),
    actions: [
      button('Cancel', () => m.close()),
      button('Apply', () => {
        state.notes = notes;
        persist();
        m.close();
        toast(`Notes merged: ${report.added.length} new, ${report.updated.length} updated.`, 'ok', 6000);
      }, { class: 'btn-primary' }),
    ],
  });
}

const part = (title, lines) => h('div', { class: 'merge-part' },
  h('h4', {}, title),
  h('ul', { class: 'plain-list' }, ...lines.map((l) => h('li', {}, l))));

const shorten = (s, n = 60) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
