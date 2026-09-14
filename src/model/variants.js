// Product variants: a variant is an overlay of operations on the base document.
// Anything can be added, changed or removed by a variant, because the operations work
// on generic paths anchored to stable ids.
import { setAt, addAt, removeAt, samePath, readablePath } from './paths.js';

export const OP = { SET: 'set', ADD: 'add', REMOVE: 'remove' };

export const newOperation = (op, path, value) => ({ op, path, value });

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

/**
 * Applies the overlay of a variant to a copy of the base document.
 * Operations that cannot be applied (dangling path) do not stop the rest:
 * they are collected in `dropped` and reported by validation.
 */
export function applyOverlay(baseDoc, variant) {
  const doc = clone(baseDoc);
  const dropped = [];
  if (!variant || !Array.isArray(variant.overlay)) return { doc, dropped };
  for (const op of variant.overlay) {
    let ok = false;
    try {
      if (op.op === OP.SET) ok = setAt(doc, op.path, clone(op.value));
      else if (op.op === OP.ADD) ok = addAt(doc, op.path, clone(op.value), op.index);
      else if (op.op === OP.REMOVE) ok = removeAt(doc, op.path);
    } catch {
      ok = false;
    }
    if (!ok) dropped.push(op);
  }
  return { doc, dropped };
}

/** Document resolved for the selected variant (or the base one, when no variant is active). */
export function resolveVariant(baseDoc, variantId) {
  if (!variantId) return { doc: baseDoc, variant: null, dropped: [] };
  const variant = (baseDoc.variants || []).find((v) => v.id === variantId);
  if (!variant) return { doc: baseDoc, variant: null, dropped: [] };
  const { doc, dropped } = applyOverlay(baseDoc, variant);
  return { doc, variant, dropped };
}

/**
 * Records a change as an overlay operation, replacing the one already present
 * on the same path (one operation per field).
 */
export function recordOverride(variant, op, path, value) {
  const i = variant.overlay.findIndex((o) => o.op === op && samePath(o.path, path));
  const next = newOperation(op, path, value);
  if (op === OP.SET && i >= 0) variant.overlay[i] = next;
  else variant.overlay.push(next);
  return next;
}

/** Readable description of one operation, for the variant matrix and for print. */
export function describeOperation(baseDoc, op) {
  const where = readablePath(baseDoc, op.path);
  if (op.op === OP.REMOVE) return { action: 'Removed', where, value: '' };
  if (op.op === OP.ADD) return { action: 'Added', where, value: nameOf(op.value) };
  return { action: 'Changed', where, value: formatValue(op.value) };
}

const nameOf = (v) => (v && typeof v === 'object' ? v.name || v.title || v.description || '(new element)' : String(v ?? ''));

export function formatValue(v) {
  if (v == null) return '';
  if (typeof v !== 'object') return String(v);
  if (v.mode === 'constant') return String(v.value ?? '');
  if (v.mode === 'variable') return '→ variable';
  if (Array.isArray(v)) return `${v.length} elements`;
  return nameOf(v);
}

