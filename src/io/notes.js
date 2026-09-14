// Where the notes are kept between one session and the next.
//
// A page opened by double click cannot write a file beside itself — the browser refuses it,
// and rightly — so the notes file is downloaded, like the specification is, and what keeps
// the notes from one session to the next without asking anything of anybody is the browser's
// own storage, keyed by the specification they belong to. The file is for carrying them: to
// a colleague, to another machine, to the folder where the specification lives.
import { fingerprint } from './recovery.js';

const PREFIX = 'tsw.notes.';
const AUTHOR_KEY = 'tsw.notes.author';

/** The key of a specification's notes: what names it, not what it says, so a revision keeps them. */
const keyOf = (doc) => {
  const h = (doc || {}).header || {};
  return PREFIX + fingerprint([h.documentCode || '', h.title || ''].join('|'));
};

const read = (storage, key) => {
  try {
    const raw = storage && storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (storage, key, value) => {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/**
 * What this browser holds for the document: the notes, when the set last changed, and when
 * the file was last downloaded — the two stamps that say whether the file is behind.
 * @returns {{notes: Array, changed: string, exported: string}}
 */
export function readNotes(storage, doc) {
  const kept = read(storage, keyOf(doc));
  return kept && Array.isArray(kept.notes)
    ? { notes: kept.notes, changed: kept.changed || '', exported: kept.exported || '' }
    : { notes: [], changed: '', exported: '' };
}

export const writeNotes = (storage, doc, state) =>
  write(storage, keyOf(doc), { notes: state.notes, changed: state.changed || '', exported: state.exported || '' });

/** The name and colour of whoever writes here, remembered so a note asks only for its text. */
export const readAuthor = (storage) => read(storage, AUTHOR_KEY) || { name: '', color: '' };

export const writeAuthor = (storage, author) => write(storage, AUTHOR_KEY, { name: author.name || '', color: author.color || '' });
