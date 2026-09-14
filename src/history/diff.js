// Comparison between two versions of the document.
// Deliberately simple: no in-document highlighting, just a list of differences paired
// by id, readable and printable.
import { readablePath, fieldLabel, truncate } from '../model/paths.js';
import { isId } from '../model/ids.js';

export const DIFF_TYPE = { ADDED: 'added', REMOVED: 'removed', CHANGED: 'changed', MOVED: 'moved' };

const TYPE_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' };

/** Chapters the differences are grouped into, in document order. */
const CHAPTERS = {
  header: 'Header', revision: 'Revision', description: 'Description',
  references: 'External references', variables: 'Global variables', variants: 'Product variants',
  resources: 'Test resources', protocols: 'Communication protocols',
  interfaces: 'Interfaces', commands: 'Commands',
  points: 'Application points', images: 'Images', glossary: 'Glossary', stages: 'Test stages',
  settings: 'Reading options',
};

const hasId = (v) => v && typeof v === 'object' && typeof v.id === 'string';
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {object} before document of the previous version
 * @param {object} after  document of the following version
 * @returns {Array} differences [{type, path, where, chapter, before, after, label}]
 */
export function compare(before, after) {
  const out = [];
  compareNode(before, after, [], out, { before, after });
  return out.map((d) => ({
    ...d,
    chapter: CHAPTERS[d.path[0]] || 'Document',
    where: readablePath(d.type === DIFF_TYPE.REMOVED ? before : after, d.path) || 'Document',
    typeLabel: TYPE_LABEL[d.type],
  }));
}

function compareNode(a, b, path, out, ctx) {
  if (Array.isArray(a) && Array.isArray(b)) return compareArray(a, b, path, out, ctx);
  if (isObject(a) && isObject(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === 'id') continue;
      const va = a[k], vb = b[k];
      if (va === undefined && vb !== undefined) { out.push(entry(DIFF_TYPE.ADDED, [...path, k], undefined, vb, ctx)); continue; }
      if (va !== undefined && vb === undefined) { out.push(entry(DIFF_TYPE.REMOVED, [...path, k], va, undefined, ctx)); continue; }
      compareNode(va, vb, [...path, k], out, ctx);
    }
    return;
  }
  if (!equal(a, b)) out.push(entry(DIFF_TYPE.CHANGED, path, a, b, ctx));
}

function compareArray(a, b, path, out, ctx) {
  const withIds = a.every(hasId) && b.every(hasId);
  if (!withIds) {
    // Lists of plain values (e.g. prerequisite ids): compared as a whole.
    if (!equal(a, b)) out.push(entry(DIFF_TYPE.CHANGED, path, a, b, ctx));
    return;
  }
  const mapA = new Map(a.map((e, i) => [e.id, { e, i }]));
  const mapB = new Map(b.map((e, i) => [e.id, { e, i }]));
  for (const [id, { e }] of mapA) {
    if (!mapB.has(id)) out.push(entry(DIFF_TYPE.REMOVED, [...path, '#' + id], e, undefined, ctx));
  }
  const moved = movedIds(a, b);
  for (const [id, { e, i }] of mapB) {
    const prev = mapA.get(id);
    if (!prev) { out.push(entry(DIFF_TYPE.ADDED, [...path, '#' + id], undefined, e, ctx)); continue; }
    compareNode(prev.e, e, [...path, '#' + id], out, ctx);
    if (moved.has(id)) out.push(entry(DIFF_TYPE.MOVED, [...path, '#' + id], `position ${prev.i + 1}`, `position ${i + 1}`, ctx));
  }
}

/**
 * The elements whose order changed, and only those. A stage inserted in the middle of the
 * sequence pushes every stage after it down one place, and reporting each of them as moved
 * buried the one insertion under a dozen moves nobody made. So the elements present in both
 * versions are compared by their order alone: the longest run that kept its order is taken
 * as having stayed put, and what is left is what moved.
 */
function movedIds(a, b) {
  const indexA = new Map(a.map((e, i) => [e.id, i]));
  const common = b.filter((e) => indexA.has(e.id));
  const sequence = common.map((e) => indexA.get(e.id));
  const kept = new Set(longestIncreasingRun(sequence));
  return new Set(common.filter((_, k) => !kept.has(k)).map((e) => e.id));
}

/** Positions, in the sequence, of a longest strictly increasing subsequence. */
function longestIncreasingRun(sequence) {
  const tailPositions = []; // tailPositions[len - 1]: position ending the best run of that length
  const previous = new Array(sequence.length).fill(-1);
  for (let k = 0; k < sequence.length; k++) {
    let lo = 0, hi = tailPositions.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sequence[tailPositions[mid]] < sequence[k]) lo = mid + 1; else hi = mid;
    }
    if (lo > 0) previous[k] = tailPositions[lo - 1];
    tailPositions[lo] = k;
  }
  const run = [];
  for (let k = tailPositions[tailPositions.length - 1]; k !== undefined && k >= 0; k = previous[k]) run.push(k);
  return run.reverse();
}

const entry = (type, path, before, after, ctx) => ({
  type, path,
  before: describe(before, path, ctx.before),
  after: describe(after, path, ctx.after),
  label: fieldLabel(path[path.length - 1]),
});

const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Textual rendering of a value, with ids resolved into names. */
export function describe(v, path, doc) {
  if (v === undefined) return '';
  if (v === null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v !== 'object') {
    const s = String(v);
    return nameFromId(s, doc) || truncate(s, 120);
  }
  if (Array.isArray(v)) {
    if (!v.length) return '(empty)';
    if (v.every((x) => typeof x === 'string')) return v.map((x) => nameFromId(x, doc) || x).join(', ');
    return `${v.length} elements`;
  }
  if (v.mode === 'constant') return String(v.value ?? '');
  if (v.mode === 'variable') return `variable ${nameFromId(v.variableId, doc) || v.variableId}`;
  if (v.name || v.title || v.description) return truncate(v.name || v.title || v.description, 120);
  return '(object)';
}

/** Looks the id up across the whole document and returns its name. */
function nameFromId(id, doc) {
  if (!doc || !isId(id)) return '';
  for (const key of ['resources', 'protocols', 'commands', 'interfaces', 'points', 'images', 'variables', 'variants', 'references', 'glossary']) {
    const e = (doc[key] || []).find((x) => x.id === id);
    if (e) return e.name || e.title || e.term || '(unnamed)';
  }
  for (const stage of doc.stages || []) {
    if (stage.id === id) return stage.name || '(unnamed stage)';
    for (const t of stage.tests || []) {
      if (t.id === id) return t.name || '(unnamed test)';
      for (const s of t.steps || []) if (s.id === id) return truncate(s.description || '(step)', 60);
    }
  }
  return '';
}

/** Groups the differences by chapter, keeping the document order. */
export function groupByChapter(differences) {
  const order = Object.values(CHAPTERS);
  const groups = new Map();
  for (const d of differences) {
    if (!groups.has(d.chapter)) groups.set(d.chapter, []);
    groups.get(d.chapter).push(d);
  }
  return [...groups.entries()].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
}

export const diffCounts = (differences) => {
  const c = { added: 0, removed: 0, changed: 0, moved: 0 };
  for (const d of differences) c[d.type]++;
  return c;
};
