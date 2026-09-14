// Notes: what travels beside a specification without being part of it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyDocument } from '../src/model/schema.js';
import {
  newNote, touchNote, notesEnvelope, notesBelongTo, mergeNotes, detachedNotes, DEFAULT_COLOUR,
  NOTE_KINDS, kindOf, kindColour, kindLabel, countByKind,
} from '../src/model/notes.js';
import { readNotes, writeNotes, readAuthor, writeAuthor } from '../src/io/notes.js';

const specification = (code, revision = '02') => {
  const doc = emptyDocument();
  doc.header.documentCode = code;
  doc.header.title = 'Lamp control unit';
  doc.revision.number = revision;
  return doc;
};

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test('a note is born with an id, a colour and the two stamps, and a change moves the second one', async () => {
  const note = newNote({ name: 'DT', text: 'check this', anchor: { id: 'ref-x', fraction: 0.4 } });
  assert.match(note.id, /^nt_[a-z0-9]{10}$/);
  assert.equal(note.color, DEFAULT_COLOUR);
  assert.equal(note.kind, 'free');
  assert.equal(note.created, note.modified);
  await new Promise((r) => setTimeout(r, 5));
  const later = touchNote(note, { text: 'checked' });
  assert.equal(later.created, note.created);
  assert.ok(later.modified > note.modified);
  assert.equal(later.text, 'checked');
});

test('a note has a kind, each kind its own colour, and a note without one — from an older file — is a plain note', () => {
  assert.deepEqual(NOTE_KINDS.map((k) => k.id), ['free', 'toCheck', 'condition', 'leftOut']);
  assert.equal(new Set(NOTE_KINDS.map((k) => k.color)).size, NOTE_KINDS.length);
  const check = newNote({ kind: 'toCheck', text: 'x' });
  assert.equal(check.color, kindColour('toCheck'));
  assert.equal(kindLabel('toCheck'), 'To check');
  // A colour given wins over the kind's own.
  assert.equal(newNote({ kind: 'leftOut', color: '#123456' }).color, '#123456');
  const old = { id: 'nt_1', name: 'A', color: '#d93a3a', text: 't', anchor: null, created: '', modified: '' };
  assert.equal(kindOf(old), 'free');
  assert.equal(kindOf({ ...old, kind: 'whatever' }), 'free');
  assert.deepEqual(countByKind([old, check, newNote({ kind: 'toCheck' }), newNote({ kind: 'leftOut' })]), { free: 1, toCheck: 2, condition: 0, leftOut: 1 });
  // The same note, once with the field and once without, is the same note to a merge.
  const { report } = mergeNotes([old], [{ ...old, kind: 'free' }]);
  assert.equal(report.same, 1);
});

test('the notes file says which specification and which revision it was written on', () => {
  const doc = specification('TS-100');
  const env = notesEnvelope(doc, [newNote({ text: 'a' })]);
  assert.equal(env.format, 'tsw-notes/1');
  assert.deepEqual(env.spec, { documentCode: 'TS-100', title: 'Lamp control unit', revision: '02' });
  assert.equal(env.notes.length, 1);
  assert.ok(notesBelongTo(env, doc).ok);
});

test('notes of another revision, or another specification, are refused with the reason', () => {
  const env = notesEnvelope(specification('TS-100', '01'), []);
  const other = notesBelongTo(env, specification('TS-100', '02'));
  assert.equal(other.ok, false);
  assert.match(other.reason, /revision 01/);
  assert.match(other.reason, /revision 02/);

  const elsewhere = notesBelongTo(notesEnvelope(specification('TS-900'), []), specification('TS-100'));
  assert.equal(elsewhere.ok, false);
  assert.match(elsewhere.reason, /another specification/);

  assert.equal(notesBelongTo({ format: 'tsw-export/1', doc: {} }, specification('TS-100')).ok, false);
  assert.match(notesBelongTo({ format: 'tsw-notes/9', spec: {}, notes: [] }, specification('TS-100')).reason, /newer build/);
});

test('two sets of notes merge by id, the later change wins, and every decision is reported', () => {
  const shared = newNote({ name: 'DT', text: 'mine' });
  const mineNewer = { ...newNote({ name: 'DT', text: 'mine, later' }), modified: '2099-01-02T00:00:00.000Z' };
  const identical = newNote({ name: 'DT', text: 'same' });
  const mine = [shared, mineNewer, identical];

  const theirs = [
    { ...shared, text: 'theirs, later', modified: '2099-01-01T00:00:00.000Z' },
    { ...mineNewer, text: 'theirs, earlier', modified: '2099-01-01T00:00:00.000Z' },
    { ...identical },
    newNote({ name: 'MR', text: 'new from them' }),
  ];

  const { notes, report } = mergeNotes(mine, theirs);
  assert.equal(notes.length, 4);
  assert.equal(notes.find((n) => n.id === shared.id).text, 'theirs, later');
  assert.equal(notes.find((n) => n.id === mineNewer.id).text, 'mine, later');
  assert.equal(report.added.length, 1);
  assert.equal(report.updated.length, 1);
  assert.equal(report.kept.length, 1);
  assert.equal(report.same, 1);
});

test('a note whose anchor the document no longer draws is detached, not lost', () => {
  const notes = [newNote({ anchor: { id: 'ref-a', fraction: 0 } }), newNote({ anchor: { id: 'ref-gone', fraction: 0 } }), newNote({ anchor: null })];
  const detached = detachedNotes(notes, new Set(['ref-a']));
  assert.equal(detached.length, 2);
});

test('the browser keeps the notes of a specification, and who writes them', () => {
  const storage = memory();
  const doc = specification('TS-100');
  const note = newNote({ name: 'DT', text: 'kept' });
  assert.equal(writeNotes(storage, doc, { notes: [note], changed: '2026-09-12T10:00:00Z', exported: '' }), true);
  const back = readNotes(storage, doc);
  assert.equal(back.notes[0].text, 'kept');
  assert.equal(back.changed, '2026-09-12T10:00:00Z');
  // The next revision of the same specification finds them: the key is the name, not the content.
  assert.equal(readNotes(storage, specification('TS-100', '03')).notes.length, 1);
  // Another specification does not.
  assert.equal(readNotes(storage, specification('TS-900')).notes.length, 0);

  writeAuthor(storage, { name: 'DT', color: '#2f9e5b' });
  assert.deepEqual(readAuthor(storage), { name: 'DT', color: '#2f9e5b' });
  assert.deepEqual(readAuthor(memory()), { name: '', color: '' });
});
