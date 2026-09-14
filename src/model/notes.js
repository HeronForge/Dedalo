// Notes: coloured marks in the margin of the document, each with a name and a text.
//
// They are not part of the specification. A specification is what gets signed and printed;
// a note is what somebody thinks about it while reading, and the two must not share a file —
// nobody should have to save the document again because they wrote «check this» beside a
// limit. So the notes live outside it, in a file that carries the specification's name with
// the extension .json, and travel between readers by import. This module knows their shape,
// which specification they belong to, and how two sets of them are put together.
import { newId } from './ids.js';
import { FORMATS } from '../version.js';

/** The colours a note can wear: few, distinct, and readable as a small mark. */
export const NOTE_COLOURS = [
  { id: 'red', value: '#d93a3a', label: 'Red' },
  { id: 'amber', value: '#e08a1e', label: 'Amber' },
  { id: 'yellow', value: '#d9c21a', label: 'Yellow' },
  { id: 'green', value: '#2f9e5b', label: 'Green' },
  { id: 'blue', value: '#2d7fd6', label: 'Blue' },
  { id: 'violet', value: '#8a5cc7', label: 'Violet' },
];

const colour = (id) => NOTE_COLOURS.find((c) => c.id === id).value;

/**
 * What a note is for. A remark is one thing; «this limit has to be checked against the
 * source», «this step runs only when…», «the source had this and the document has not» are
 * other things, and a reader filtering the margin wants to tell them apart. Each kind has the
 * colour it is born with; the author may still paint it otherwise.
 *
 * The field is additive to `tsw-notes/1`: a file written by an older build has no `kind`,
 * which reads as «free», and an older build reading a file with kinds ignores the field and
 * keeps the colour — nothing is lost either way, so the format number does not move.
 */
export const NOTE_KINDS = [
  { id: 'free', label: 'Note', color: colour('blue'), hint: 'A remark, a question, a reminder.' },
  { id: 'toCheck', label: 'To check', color: colour('amber'), hint: 'Something the document says that has to be verified against the source or the product.' },
  { id: 'condition', label: 'Condition', color: colour('violet'), hint: 'A circumstance under which this line applies or does not.' },
  { id: 'leftOut', label: 'Left out', color: colour('red'), hint: 'Something the source had that this document has not.' },
];

export const DEFAULT_KIND = NOTE_KINDS[0].id;

/** The colour of a plain note, which is what a person's first note is. */
export const DEFAULT_COLOUR = NOTE_KINDS[0].color;

/** The kind of a note, «free» for a note written before kinds existed or by a build without them. */
export const kindOf = (note) => (NOTE_KINDS.some((k) => k.id === (note || {}).kind) ? note.kind : DEFAULT_KIND);

export const kindColour = (kind) => (NOTE_KINDS.find((k) => k.id === kind) || NOTE_KINDS[0]).color;

export const kindLabel = (kind) => (NOTE_KINDS.find((k) => k.id === kind) || NOTE_KINDS[0]).label;

/** How many notes of each kind: what the status bar and the filter say. */
export function countByKind(notes) {
  const counts = Object.fromEntries(NOTE_KINDS.map((k) => [k.id, 0]));
  for (const n of notes || []) counts[kindOf(n)] += 1;
  return counts;
}

const now = () => new Date().toISOString();

/**
 * A new note. The anchor is what it is attached to: the element of the document under the
 * point where it was placed, by the id the document draws it with, and how far into it.
 * A note born without a colour wears the colour of its kind.
 */
export function newNote({ name = '', kind = DEFAULT_KIND, color = '', text = '', anchor = null } = {}) {
  const at = now();
  return { id: newId('nt'), name, kind, color: color || kindColour(kind), text, anchor, created: at, modified: at };
}

/** The same note, changed: the stamp moves with the change, which is what makes a merge decidable. */
export function touchNote(note, changes) {
  return { ...note, ...changes, modified: now() };
}

/** The identity of a specification, as a notes file records it. */
function specIdentity(doc) {
  const h = (doc || {}).header || {};
  return { documentCode: h.documentCode || '', title: h.title || '', revision: ((doc || {}).revision || {}).number || '' };
}

/**
 * The file as it is written: the format, which specification and which revision, and the
 * notes. Room is left for whatever else may travel beside a specification one day — the notes
 * are one key among the ones to come, not the file.
 */
export function notesEnvelope(doc, notes, exported = now()) {
  return {
    format: `${FORMATS.notes.id}/${FORMATS.notes.writes}`,
    spec: specIdentity(doc),
    exported,
    notes: notes.map((n) => ({ ...n })),
  };
}

/**
 * Whether a notes file may be read into this document. Notes are anchored to the elements of
 * one revision of one specification; imported onto another they would point at things that
 * are not there, or worse, at things that are there and mean something else.
 * @returns {{ok: boolean, reason: string}}
 */
export function notesBelongTo(envelope, doc) {
  if (!envelope || typeof envelope !== 'object' || !Array.isArray(envelope.notes)) {
    return { ok: false, reason: 'This file does not hold notes: it has no «notes» list.' };
  }
  const format = String(envelope.format || '');
  const [id, version] = format.split('/');
  if (id !== FORMATS.notes.id) {
    return { ok: false, reason: format ? `This file is «${format}», not a notes file (${FORMATS.notes.id}).` : 'This file says nothing about its format, and a notes file does.' };
  }
  if (Number(version) > FORMATS.notes.writes) {
    return { ok: false, reason: `These notes are written in ${format}, and this build reads up to ${FORMATS.notes.id}/${FORMATS.notes.writes}. Open them with a newer build.` };
  }
  const theirs = envelope.spec || {};
  const mine = specIdentity(doc);
  const sameCode = theirs.documentCode && mine.documentCode
    ? theirs.documentCode === mine.documentCode
    : theirs.title === mine.title;
  if (!sameCode) {
    return {
      ok: false,
      reason: `These notes belong to another specification — ${describe(theirs)} — and this is ${describe(mine)}. Notes point at the elements of the document they were written on.`,
    };
  }
  if (String(theirs.revision || '') !== String(mine.revision || '')) {
    return {
      ok: false,
      reason: `These notes were written on revision ${theirs.revision || '—'} of this specification, and the one open is revision ${mine.revision || '—'}. A revision moves and renumbers things: notes written on another one would sit beside the wrong lines.`,
    };
  }
  return { ok: true, reason: '' };
}

const describe = (s) => [s.documentCode, s.title].filter(Boolean).join(' — ') || '(unnamed)';

/**
 * Two sets of notes put together, by id. A note the file has and this document has not is
 * taken; a note both have is decided by its stamp — the later change wins — and every such
 * decision is reported, because it was taken for somebody rather than by them.
 * @returns {{notes: Array, report: {added: Array, updated: Array, kept: Array, same: number}}}
 */
export function mergeNotes(mine, theirs) {
  const byId = new Map(mine.map((n) => [n.id, n]));
  const report = { added: [], updated: [], kept: [], same: 0 };
  for (const t of theirs || []) {
    if (!t || !t.id) continue;
    const m = byId.get(t.id);
    if (!m) { byId.set(t.id, { ...t }); report.added.push(t); continue; }
    if (sameNote(m, t)) { report.same += 1; continue; }
    if (String(t.modified || '') > String(m.modified || '')) { byId.set(t.id, { ...t }); report.updated.push({ mine: m, theirs: t }); }
    else report.kept.push({ mine: m, theirs: t });
  }
  return { notes: [...byId.values()], report };
}

const sameNote = (a, b) => ['name', 'color', 'text', 'modified'].every((k) => (a[k] ?? '') === (b[k] ?? ''))
  && kindOf(a) === kindOf(b)
  && JSON.stringify(a.anchor || null) === JSON.stringify(b.anchor || null);

/**
 * The notes whose anchor the document no longer draws: a stage deleted, a step moved into
 * another test. They are kept — a note is somebody's words — and shown at the top, apart.
 */
export const detachedNotes = (notes, ids) => notes.filter((n) => !(n.anchor && n.anchor.id && ids.has(n.anchor.id)));
