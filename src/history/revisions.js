// Revision history: a working draft plus immutable snapshots of the issued revisions.
// Snapshots carry no images (those live once in the asset pool) and are gzip compressed,
// so the history stays small even after many issues.
import { migrate, today } from '../model/schema.js';
import { compare } from './diff.js';

export const STATUS = { DRAFT: 'draft', ISSUED: 'issued', APPROVED: 'approved' };

export const STATUS_LABEL = { draft: 'Draft', issued: 'Issued', approved: 'Approved' };

export const emptyHistory = () => ({ revisions: [] });

/**
 * The comparison of two documents reduced to what the revision matrix keeps beside each
 * revision: strings only — the chapter, the readable place, the field, the value before and
 * after — so nothing has to be resolved against a document that is no longer the current one.
 * The revision block itself is left out: the number moving on is not a change of the document.
 */
export const changesOf = (before, after) =>
  compare(before, after).filter((d) => d.path[0] !== 'revision')
    .map((d) => ({
      type: d.type, chapter: d.chapter, where: d.where, label: d.label, before: d.before, after: d.after,
      // The element the change belongs to — the deepest id on the path — so the matrix can
      // print its code and open its card, as long as the element is still in the document.
      id: [...d.path].reverse().map((s) => String(s)).find((s) => s.startsWith('#'))?.slice(1) || '',
    }));

// The documents of the revisions decompressed so far, by revision: the matrix compares the
// draft with the last issue at every redraw, and cannot wait for a decompression each time.
// What the cache holds is pristine — `revisionDocument` hands out copies, because whoever
// restores a revision into the draft goes on to edit it, and the draft must not edit the
// record of what was issued.
const frozenCache = new WeakMap();
const copyOf = (doc) => JSON.parse(JSON.stringify(doc));

/** The document of a revision, when it has already been read, to read and not to change; null until then. */
export const cachedDocument = (revision) => (revision && frozenCache.get(revision)) || null;

/** The last issued revision's document, when known: what the draft is compared with. */
export function lastIssuedDocument(history) {
  const revisions = (history && history.revisions) || [];
  return cachedDocument(revisions[revisions.length - 1]);
}

/** Next revision number: "00" -> "01" -> "02"; non numeric formats are preserved. */
export function nextNumber(number) {
  const s = String(number ?? '').trim();
  const m = s.match(/^(\D*)(\d+)$/);
  if (!m) return s ? s + '.1' : '01';
  const digits = m[2];
  return m[1] + String(Number(digits) + 1).padStart(digits.length, '0');
}

/**
 * Whether the working copy is a draft — a revision in the making — or the issued revision
 * itself, as it stands after validating and before anybody opens the next. A block that
 * says nothing about its status is a draft: that is what every document starts as.
 */
export const isDraft = (doc) => {
  const status = ((doc && doc.revision) || {}).status;
  return !status || status === STATUS.DRAFT;
};

/**
 * Opens the next draft on an issued document: the number after the last one issued, today's
 * date, the same author, no reason yet. Nothing is copied — the draft *is* the working copy,
 * which was the issued revision until now. Asked for on a draft, it changes nothing: there
 * is one draft at a time.
 */
export function openDraft(doc, history) {
  if (isDraft(doc)) return doc;
  const last = doc.revision || {};
  let number = nextNumber(last.number);
  // A record that was corrected or merged may hold a number ahead of this one.
  while (isNumberIssued(history, number)) number = nextNumber(number);
  return { ...doc, revision: { number, date: today(), author: last.author || '', reason: '', status: STATUS.DRAFT } };
}

/** True when that revision number has already been frozen in the history. */
export const isNumberIssued = (history, number) =>
  ((history && history.revisions) || []).some((r) => String(r.number).trim() === String(number ?? '').trim());

/**
 * Freezes the current document as a new issued revision. The working copy becomes that
 * revision — the same number, the issued status — and stays so until somebody opens the
 * next draft (`openDraft`): a document validated as final is final, and a draft «02» that
 * nobody asked for, printed on the cover of what was meant to be Rev. 01, said otherwise.
 *
 * The snapshot is taken of the document *as issued*: number, date, author, reason and status are
 * settled first, so the frozen copy and the row in the change record can never tell two different
 * stories. Re-using a number that is already in the history is refused rather than overwriting it.
 *
 * @returns {{history: object, doc: object}} new values for the state
 */
export async function issueRevision(doc, history, { author, reason, status = STATUS.ISSUED } = {}) {
  const meta = doc.revision || {};
  const number = meta.number || '00';
  if (isNumberIssued(history, number))
    throw new Error(`Revision ${number} has already been issued: open a new draft before validating again.`);

  const issued = {
    number,
    date: meta.date || today(),
    author: author || meta.author || '',
    reason: reason || meta.reason || '',
    status,
  };
  const frozen = { ...doc, revision: { ...issued } };
  // Which pictures the frozen document uses, said in the clear beside the compressed copy:
  // saving the file drops the pictures nothing uses any more, and «nothing» has to include
  // every issued revision, or a picture dropped from the draft would be gone from a revision
  // that still shows it. Reading it here costs nothing; reading it from the snapshot would
  // mean decompressing every revision at every save.
  // What this revision changed, against the one before it, kept in the clear for the matrix.
  // The first issue records nothing: everything is new in it, and a column that says «added»
  // on every line says nothing.
  const previous = (history.revisions || [])[(history.revisions || []).length - 1];
  const before = previous ? await revisionDocument(previous) : null;
  const changes = before ? changesOf(before, frozen) : [];
  const text = JSON.stringify(frozen);
  const revision = { ...issued, assetIds: assetsUsedBy(frozen), changes, snapshot: await compress(text) };
  frozenCache.set(revision, JSON.parse(text));
  const revisions = [...(history.revisions || []), revision];
  return { history: { ...history, revisions }, doc: { ...doc, revision: { ...issued } } };
}

/**
 * Consolidates two revisions into one by dropping an issued revision: what it changed then
 * simply belongs to the revision that follows it (or to the draft, when it was the last one),
 * because the following snapshot already contains those changes. The reason for the change is
 * carried over, so nothing of the record is lost.
 * @returns {{history: object, doc: object, mergedInto: string|null}}
 */
export function consolidateRevision(doc, history, number) {
  const revisions = history.revisions || [];
  const i = revisions.findIndex((r) => r.number === number);
  if (i < 0) return { history, doc, mergedInto: null };
  const removed = revisions[i];
  const next = revisions[i + 1] || null;
  const rest = revisions.filter((_, k) => k !== i);

  const mergedReason = (target) => {
    const parts = [removed.reason, target.reason].map((t) => String(t || '').trim()).filter(Boolean);
    return [...new Set(parts)].join('; ');
  };

  if (next) {
    // The changes of the dropped revision now belong to the one after it: its record is
    // computed again, from the snapshots, by `completeChanges`.
    const updated = { ...next, reason: mergedReason(next), changes: undefined };
    return {
      history: { ...history, revisions: rest.map((r) => (r.number === next.number ? updated : r)) },
      doc,
      mergedInto: next.number,
    };
  }
  const draft = { ...(doc.revision || {}) };
  draft.reason = mergedReason(draft);
  return { history: { ...history, revisions: rest }, doc: { ...doc, revision: draft }, mergedInto: draft.number || null };
}

/** The revision the changes of `number` would flow into, or null when it is unknown. */
export function successorOf(doc, history, number) {
  const revisions = history.revisions || [];
  const i = revisions.findIndex((r) => r.number === number);
  if (i < 0) return null;
  const next = revisions[i + 1];
  return next ? { number: next.number, isDraft: false } : { number: (doc.revision || {}).number, isDraft: true };
}

/**
 * Whether the draft is the last issued revision word for word: the file exactly as it is
 * handed out after validating, before anybody has touched it again. Whoever opens such a file
 * came to read it, and the editor opens on the sheet alone. The revision block is left out of
 * the comparison — the draft carries the next number by construction.
 */
export async function draftIsReleased(doc, history) {
  const issued = (history && history.revisions) || [];
  const last = issued[issued.length - 1];
  if (!last) return false;
  const frozen = await revisionDocument(last);
  if (!frozen) return false;
  return compare(frozen, doc).every((d) => d.path[0] === 'revision');
}

/** The pictures a document uses: the logo and every image of the images chapter. */
export function assetsUsedBy(doc) {
  const ids = new Set();
  if (doc && doc.header && doc.header.logoAssetId) ids.add(doc.header.logoAssetId);
  for (const img of (doc && doc.images) || []) if (img && img.assetId) ids.add(img.assetId);
  return [...ids];
}

/**
 * Revisions issued before the pictures were recorded beside the snapshot get the record now,
 * from the snapshot itself. Done once, when the file opens; until it is done the save keeps
 * every picture rather than guess.
 * @returns {Promise<object|null>} the completed history, or null when nothing was missing
 */
export async function completeAssetIds(history) {
  const revisions = (history && history.revisions) || [];
  if (revisions.every((r) => Array.isArray(r.assetIds))) return null;
  const completed = [];
  for (const r of revisions) {
    if (Array.isArray(r.assetIds)) { completed.push(r); continue; }
    const frozen = await revisionDocument(r);
    completed.push({ ...r, assetIds: frozen ? assetsUsedBy(frozen) : [] });
  }
  return { ...history, revisions: completed };
}

/** Document of an issued revision. */
export async function revisionDocument(revision) {
  if (!revision || !revision.snapshot) return null;
  const cached = frozenCache.get(revision);
  if (cached) return copyOf(cached);
  const doc = migrate(JSON.parse(await decompress(revision.snapshot)));
  frozenCache.set(revision, doc);
  return copyOf(doc);
}

/**
 * Revisions issued before the changes were recorded beside them get the record now, from the
 * snapshots, in order: each against the one before it, the first against nothing. Done when
 * the file opens, and after two revisions are consolidated into one.
 * @returns {Promise<object|null>} the completed history, or null when nothing was missing
 */
export async function completeChanges(history) {
  const revisions = (history && history.revisions) || [];
  if (revisions.every((r) => Array.isArray(r.changes))) return null;
  const completed = [];
  let before = null;
  for (const r of revisions) {
    const frozen = await revisionDocument(r);
    if (Array.isArray(r.changes)) completed.push(r);
    else {
      const done = { ...r, changes: before && frozen ? changesOf(before, frozen) : [] };
      if (frozen) frozenCache.set(done, frozenCache.get(r));
      completed.push(done);
    }
    before = frozen || before;
  }
  return { ...history, revisions: completed };
}

/** Reads the last issued revision into memory, so the draft can be compared with it at once. */
export async function warmLastRevision(history) {
  const revisions = (history && history.revisions) || [];
  return revisions.length ? revisionDocument(revisions[revisions.length - 1]) : null;
}

/**
 * Rows of the change record: the issued revisions, plus the draft in progress when there is
 * one. An issued document has no draft row: the record ends with the revision it is.
 */
export function changeRecord(doc, history) {
  const rows = (history.revisions || []).map((r) => ({
    number: r.number, date: r.date, author: r.author, reason: r.reason, status: r.status, issued: true,
  }));
  const d = doc.revision || {};
  if (isDraft(doc)) rows.push({ number: d.number, date: d.date, author: d.author, reason: d.reason, status: STATUS.DRAFT, issued: false });
  return rows;
}

/** Comparable versions: the issued revisions plus the working copy, draft or not. */
export function comparableVersions(doc, history) {
  const v = (history.revisions || []).map((r) => ({ id: r.number, label: `Rev. ${r.number} — ${r.date}`, revision: r }));
  const number = (doc.revision || {}).number || '?';
  v.push({ id: '__current__', label: isDraft(doc) ? `Current draft (Rev. ${number})` : `Working copy (Rev. ${number}, as issued)`, revision: null });
  return v;
}

/**
 * Whether an issued document has been edited without a draft being opened: the working copy
 * says «Rev. 01, issued» and is no longer what Rev. 01 was. Answered from the decompressed
 * copy of the last issue when there is one; unknown — false — until it has been read.
 */
export function editedSinceIssue(doc, history) {
  if (isDraft(doc)) return false;
  const frozen = lastIssuedDocument(history);
  if (!frozen) return false;
  return compare(frozen, doc).some((d) => d.path[0] !== 'revision');
}

// ---- compression -------------------------------------------------------------

const gzipAvailable = () => typeof globalThis.CompressionStream === 'function';

export async function compress(text) {
  const bytes = new TextEncoder().encode(text);
  if (!gzipAvailable()) return { encoding: 'text', data: bytesToBase64(bytes) };
  const cs = new CompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return { encoding: 'gzip', data: bytesToBase64(buf) };
}

export async function decompress(packet) {
  const bytes = base64ToBytes(packet.data);
  if (packet.encoding !== 'gzip') return new TextDecoder().decode(bytes);
  const ds = new DecompressionStream('gzip');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new TextDecoder().decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export function bytesToBase64(bytes) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
