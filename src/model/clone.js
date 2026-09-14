// Duplicating an entity.
//
// A copy of the object would not be a duplicate: paths, variant overlays and the change
// record all speak of an entity by its id, so two elements carrying the same id are one
// element seen twice — deleting the copy would delete the original, and a customisation
// written on one would land on both. Cloning therefore hands out new ids, all the way down.
//
// What the copy keeps are the references pointing *out* of it: the resource a step drives,
// the points it touches, the stages it must follow. Those name entities that were not copied
// and are still there. References pointing *in* — a held stimulus naming a step of the very
// stage being duplicated — are moved onto the copy, otherwise the duplicate would go on
// talking about the original.
import { newId } from './ids.js';

const deep = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/** The shape newId() writes. Anything else in an `id` field is left alone. */
const ID_SHAPE = /^([a-z]+)_[a-z0-9]{6,10}$/;

/**
 * A duplicate of the entity, ready to be added next to it.
 * @param {object} entity
 * @param {{suffix?: string}} [options] appended to the name, so the two are told apart in a list
 */
export function cloneEntity(entity, { suffix = '' } = {}) {
  const copy = deep(entity);
  const renamed = new Map();
  renumber(copy, renamed);
  relink(copy, renamed);
  if (suffix) {
    const field = typeof copy.name === 'string' ? 'name' : (typeof copy.title === 'string' ? 'title' : '');
    if (field) copy[field] = copy[field] ? `${copy[field]} ${suffix}` : suffix;
  }
  return copy;
}

/** Where the copy goes: right after the original, so the two sit side by side. */
export function indexAfter(list, id) {
  const i = (list || []).findIndex((e) => e && e.id === id);
  return i < 0 ? undefined : i + 1;
}

/** Every id inside the copy is replaced by a fresh one of the same family. */
function renumber(node, renamed) {
  if (Array.isArray(node)) {
    for (const v of node) renumber(v, renamed);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.id === 'string') {
    const m = ID_SHAPE.exec(node.id);
    if (m) {
      const next = newId(m[1]);
      renamed.set(node.id, next);
      node.id = next;
    }
  }
  for (const v of Object.values(node)) renumber(v, renamed);
}

/**
 * Whatever inside the copy still names an element of the copy is pointed at the new one.
 * The "#id" form is handled too: that is how a variant overlay writes a path, and a variant
 * that was duplicated has to customise its own elements, not the ones it was copied from.
 */
function relink(node, renamed) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      if (typeof node[i] === 'string') node[i] = swap(node[i], renamed);
      else relink(node[i], renamed);
    }
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'id') continue; // already the new one
    if (typeof v === 'string') node[k] = swap(v, renamed);
    else relink(v, renamed);
  }
}

const swap = (s, renamed) => {
  if (renamed.has(s)) return renamed.get(s);
  if (s.startsWith('#') && renamed.has(s.slice(1))) return '#' + renamed.get(s.slice(1));
  return s;
};
