// The recovery draft: what is left behind when the browser dies with the work still in it.
//
// Saving this file means downloading it again, so between one save and the next nothing at
// all is written to disk. A browser that crashes, a tab closed by mistake, a machine that
// reboots overnight — each of them takes the whole session with it.
//
// There is no honest way to write the file by itself: the picker that could do it exists in
// one browser out of three and is refused outright to a page opened by double click. What
// every browser does have is its own small storage, and that is what is used here — a copy of
// the work, kept beside the file rather than in it. It is not a save: the file on disk stays
// the one that was downloaded last, and recovering only puts the changes back on the screen,
// where they still have to be saved.
//
// This module never touches the DOM and never assumes the storage works: on a file opened
// from a disk some browsers refuse it altogether, and a refusal is a missing safety net, not
// an error to stop on.

const DRAFT_VERSION = 1;

import { emptyDocument } from '../model/schema.js';

/** Everything written here shares the prefix, so nothing else in the storage is ever touched. */
export const PREFIX = 'tsw.draft.';

/** The title a document is born with: two documents that still carry it are not two yet. */
const DEFAULT_TITLE = emptyDocument().header.title;

/** Drafts of other specifications are kept, but not for ever and not without a limit. */
const MAX_DRAFTS = 6;
const MAX_AGE_DAYS = 30;

const ASSETS_SUFFIX = '~img';

/** The browser storage, or null when it cannot be reached (private mode, file:// policies). */
export function safeStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    // Reachable is not the same as usable: some browsers hand over the object and then throw
    // on the first write. One probe now beats a surprise at the first snapshot.
    const probe = PREFIX + 'probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** A short, stable hash (FNV-1a). Not a checksum: it only has to tell two documents apart. */
export function fingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Which document a draft belongs to. Taken from what names the file — its place on disk, its
 * code, its title — rather than from its content, so the draft of a session is found again
 * when the same file is opened tomorrow. The place matters: two people on one machine, each
 * with a fresh copy of the empty document, have two files that say the same thing, and the
 * path is the one thing that tells them apart.
 * @param {string} [place] where the file is opened from; the page's own path by default
 */
export function identityKey(doc, place = currentPlace()) {
  const h = (doc || {}).header || {};
  return PREFIX + fingerprint([place, h.documentCode || '', h.title || ''].join('|'));
}

/** Whether the document has been given a code or a title of its own yet. */
export function isNamed(doc) {
  const h = (doc || {}).header || {};
  return !!(h.documentCode || (h.title && h.title !== DEFAULT_TITLE));
}

const currentPlace = () => {
  try {
    return globalThis.location ? decodeURIComponent(globalThis.location.pathname) : '';
  } catch {
    return '';
  }
};

/** What the document held when the file was opened: it says whether a draft is still in step. */
export const docFingerprint = (doc) => fingerprint(doc);

const read = (storage, key) => {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const write = (storage, key, value) => {
  try {
    storage.setItem(key, JSON.stringify(value));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reasonFor(err) };
  }
};

const reasonFor = (err) => {
  const name = (err && err.name) || '';
  if (/quota|QuotaExceeded|NS_ERROR_DOM_QUOTA/i.test(name + ' ' + ((err && err.message) || '')))
    return 'the browser storage is full';
  return (err && err.message) || 'the browser refused to write';
};

/**
 * Writes the draft. When the storage is full, what is stale is dropped — drafts older than a
 * month, drafts beyond the number kept — and the write is tried once more. What is not stale
 * stays, whatever it costs the write: another document's draft is somebody's unsaved work,
 * and one net must not be woven from the threads of another.
 */
export function saveDraft(storage, key, draft) {
  if (!storage) return { ok: false, reason: 'this browser keeps no storage for the file' };
  const payload = { v: DRAFT_VERSION, ...draft };
  const first = write(storage, key, payload);
  if (first.ok) return { ok: true };
  if (!pruneDrafts(storage, { except: key })) return first;
  const second = write(storage, key, payload);
  return second.ok ? { ok: true, pruned: true } : second;
}

/**
 * The pictures, kept apart from the text. They are the heavy half and they change hardly
 * ever, so they are written only when the pool is not the one the file was opened with, and a
 * storage too small for them still holds the text.
 */
export function saveAssets(storage, key, assets) {
  if (!storage) return { ok: false, reason: 'this browser keeps no storage for the file' };
  return write(storage, key + ASSETS_SUFFIX, assets || {});
}

export function loadDraft(storage, key) {
  if (!storage) return null;
  const draft = read(storage, key);
  if (!draft || draft.v !== DRAFT_VERSION || !draft.doc) return null;
  return { ...draft, key, assets: read(storage, key + ASSETS_SUFFIX) };
}

export function dropDraft(storage, key) {
  if (!storage) return;
  try {
    storage.removeItem(key);
    storage.removeItem(key + ASSETS_SUFFIX);
  } catch { /* nothing kept, nothing to remove */ }
}

/** Every draft in the storage, newest first. */
export function listDrafts(storage) {
  if (!storage) return [];
  const out = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !key.startsWith(PREFIX) || key.endsWith(ASSETS_SUFFIX)) continue;
      const draft = read(storage, key);
      if (draft && draft.v === DRAFT_VERSION && draft.doc) out.push({ ...draft, key });
    }
  } catch { /* an unreadable storage simply holds nothing */ }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * The draft of this document, if there is one. It is looked for by the name of the file
 * first, then by what the document held when the draft was taken: a title changed during the
 * lost session must not be what hides the work of that session.
 *
 * A document that has no name yet is a different case. Its key says nothing but where it was
 * opened from, and on a shared machine that is the same for everybody who starts from the
 * empty file: a draft is offered to it only when it was taken from this very content, and no
 * other draft is searched for it — the search by content would find every other unnamed one.
 */
export function findDraft(storage, doc, place = currentPlace()) {
  const base = docFingerprint(doc);
  const direct = loadDraft(storage, identityKey(doc, place));
  if (direct && (direct.base === base || isNamed(doc))) return direct;
  if (!isNamed(doc)) return null;
  const match = listDrafts(storage).find((d) => d.base === base);
  return match ? loadDraft(storage, match.key) : null;
}

/** Drops what is too old, and keeps the list short. The draft in `except` is never touched. */
export function pruneDrafts(storage, { now = Date.now(), except = '' } = {}) {
  if (!storage) return 0;
  const drafts = listDrafts(storage).filter((d) => d.key !== except);
  const stale = (d) => !d.at || now - Date.parse(d.at) > MAX_AGE_DAYS * 86400000;
  let dropped = 0;
  drafts.forEach((d, i) => {
    if (stale(d) || i >= MAX_DRAFTS - 1) {
      dropDraft(storage, d.key);
      dropped++;
    }
  });
  return dropped;
}
