// What reads differently from one variant to the next.
//
// A variant is an overlay of operations on the base document (see variants.js), so the
// document knows exactly which values it changes — but only the person who wrote the variants
// knows it while reading. Somebody at the bench reading «11 V … 14 V» has no way of telling
// whether that limit is the same on every product this document covers, and that is the one
// thing a specification must never leave to memory.
//
// This turns the overlays inside out: instead of «what does variant X change», it answers
// «does this piece of text depend on the variant at all», which is the question the reader
// has. It is computed from the base document and is therefore the same answer whether the
// base or one of the variants is on screen.
import { OP, applyOverlay } from './variants.js';
import { getAt } from './paths.js';
import { computeCodes, computeIndex, labelOf } from './codes.js';
import { variableIndex, variableText, valueText, expectedText } from './variables.js';

/**
 * @returns {{fields: Map, presence: Map, variables: Map, variants: number}}
 *  - fields:    entity id -> Map(field path -> Set of variant names)
 *  - presence:  entity id -> {added: Set, removed: Set}
 *  - variables: variable id -> Set of variant names that give it another value
 */
export function varianceIndex(base) {
  const variants = (base && base.variants) || [];
  const index = { fields: new Map(), presence: new Map(), variables: new Map(), variants: variants.length };

  for (const variant of variants) {
    const who = variant.name || '(unnamed variant)';
    for (const op of variant.overlay || []) {
      if (!op || !Array.isArray(op.path)) continue;
      if (op.op === OP.ADD) {
        const id = (op.value || {}).id;
        if (id) presenceOf(index, id).added.add(who);
        continue;
      }
      if (op.op === OP.REMOVE && isEntity(op.path)) {
        presenceOf(index, op.path[op.path.length - 1].slice(1)).removed.add(who);
        continue;
      }
      // A change to a field: recorded against every entity that contains it, so a step can be
      // asked about a parameter written three levels inside it without knowing its shape.
      for (const { id, field } of ancestorFields(op.path)) note(index.fields, id, field, who);
      if (op.path[0] === 'variables' && isRef(op.path[1])) {
        const id = op.path[1].slice(1);
        index.variables.set(id, (index.variables.get(id) || new Set()).add(who));
      }
    }
  }
  return index;
}

/** The variants that give this field of this entity another value. */
export function fieldVaries(index, id, field = '') {
  const entity = index && index.fields.get(id || '');
  if (!entity) return [];
  const names = new Set();
  for (const [key, who] of entity) {
    // An empty key is the entity replaced whole: everything in it varies.
    if (key === '' || key === field || key.startsWith(field + '.') || field === '') who.forEach((n) => names.add(n));
  }
  return [...names];
}

/**
 * The variants that change the field a path points at. The editor works in paths, the
 * document works in entities: this is the same question asked the other way round.
 */
export function pathVaries(index, path) {
  const parts = ancestorFields(path || []);
  const deepest = parts[parts.length - 1];
  return deepest ? fieldVaries(index, deepest.id, deepest.field) : [];
}

/** The variants that do not run this entity, and the ones that add it. */
export function presenceVaries(index, id) {
  const p = index && index.presence.get(id);
  return { added: p ? [...p.added] : [], removed: p ? [...p.removed] : [] };
}

/** The variants that give this global variable another value. */
export const variableVaries = (index, id) => [...((index && index.variables.get(id)) || [])];

/** Whether anything at all varies: a document with no variants asks nothing of the reader. */
export const hasVariants = (index) => !!(index && index.variants);

/**
 * What a piece of text is worth in every version of the document: the base first, then each
 * variant. The mark says «this changes»; this is the table that says into what, which is what
 * the person at the bench opens the mark for.
 *
 * @param {object} base the base document
 * @param {string} id the entity the text belongs to
 * @param {string} [field] the field inside it, dotted; empty for the entity itself
 * @returns {Array<{name: string, isBase: boolean, present: boolean, value: string}>}
 */
export function valuesByVariant(base, id, field = '') {
  const versions = [
    { name: 'Base document', isBase: true, doc: base },
    ...(base.variants || []).map((v) => ({ name: v.name || '(unnamed variant)', isBase: false, doc: applyOverlay(base, v).doc })),
  ];
  return versions.map(({ name, isBase, doc }) => {
    const entity = findEntity(doc, id);
    if (!entity) return { name, isBase, present: false, value: '' };
    return { name, isBase, present: true, value: textOf(doc, entity, field) };
  });
}

/** The entity with that id, wherever it sits: a parameter three levels inside a step included. */
export function findEntity(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findEntity(item, id);
      if (found) return found;
    }
    return null;
  }
  if (node.id === id) return node;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findEntity(value, id);
      if (found) return found;
    }
  }
  return null;
}

/** The field as the document prints it, so the table reads like the page it explains. */
function textOf(doc, entity, field) {
  const variables = variableIndex(doc);
  if (!field) return entity.name || entity.title || entity.description || '';
  if ((doc.variables || []).includes(entity) && field === 'value') return variableText(entity);
  const raw = getAt(entity, field.split('.'));
  const last = field.split('.').pop();
  if (raw == null) return '';
  if (last === 'expected') return expectedText({ expected: raw }, variables);
  if (last === 'wait') return `${raw.value || ''} ${raw.unit || ''}`.trim();
  if (typeof raw === 'object' && !Array.isArray(raw) && raw.mode) return valueText(raw, variables);
  if (/Ids?$/.test(last)) {
    const codes = computeCodes(doc);
    const index = computeIndex(doc);
    return [].concat(raw).filter(Boolean).map((ref) => labelOf(codes, index, ref, 40)).join(', ');
  }
  if (Array.isArray(raw)) return raw.map((x) => (x && typeof x === 'object' ? x.name || x.value || '' : String(x))).filter(Boolean).join(', ');
  if (typeof raw === 'object') return raw.name || raw.title || raw.description || '';
  return String(raw);
}

const isRef = (seg) => typeof seg === 'string' && seg.startsWith('#');

const isEntity = (path) => isRef(path[path.length - 1]);

/**
 * Every entity along the path, each with the field seen from where it stands.
 * `['stages','#stg','tests','#tc','steps','#stp','measurement','expected','min']` gives the
 * step `measurement.expected.min`, the test `steps.#stp.measurement…`, and so on up to the
 * document itself, which is the entry under the empty id.
 */
function ancestorFields(path) {
  const out = [{ id: '', field: path.join('.') }];
  path.forEach((seg, i) => {
    if (isRef(seg)) out.push({ id: seg.slice(1), field: path.slice(i + 1).join('.') });
  });
  return out;
}

function note(map, id, field, who) {
  const entity = map.get(id) || new Map();
  entity.set(field, (entity.get(field) || new Set()).add(who));
  map.set(id, entity);
}

function presenceOf(index, id) {
  const found = index.presence.get(id) || { added: new Set(), removed: new Set() };
  index.presence.set(id, found);
  return found;
}
