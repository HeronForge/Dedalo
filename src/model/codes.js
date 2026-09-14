// Readable codes (STG-01, SET-01, T-01.02, AP-03 …). They are derived from the position in
// the document and exist only for reading: internal references always use the stable ids.
import { STAGE_KIND } from './schema.js';

const pad = (n) => String(n).padStart(2, '0');

const PREFIXES = {
  references: 'REF', resources: 'RES', protocols: 'PRT', interfaces: 'IF', commands: 'CMD',
  points: 'AP', images: 'FIG', variants: 'V',
};

// Test stages and setup stages are numbered apart, and their codes say which is which
// at a glance — STG-02 is a stage of the sequence, SET-02 a routine other steps call.
const STAGE_PREFIX = { test: 'STG', setup: 'SET' };
const TEST_PREFIX = { test: 'T', setup: 'S' };

/**
 * Map id -> code for every entity of the document.
 *
 * When a variant is being read, the codes are those of the base document: a variant that does
 * not run the mechanical stage shows STG-01, STG-02, STG-04 — the gap says the stage is not
 * run here. Renumbering instead would make STG-04 mean two different stages in two documents
 * that carry the same title and revision, and codes are what people quote in reports.
 *
 * @param {object} doc the document being shown (resolved through a variant, or the base one)
 * @param {object} [base] the base document, when `doc` is a variant of it
 */
export function computeCodes(doc, base) {
  const m = base && base !== doc ? computeCodes(base) : new Map();
  const used = new Map(); // prefix -> highest number already handed out

  const note = (prefix, n) => used.set(prefix, Math.max(used.get(prefix) || 0, n));
  for (const code of m.values()) {
    const match = /^([A-Z]+)-(\d+)/.exec(code);
    if (match) note(match[1], Number(match[2]));
  }

  const assign = (id, prefix) => {
    if (m.has(id)) return m.get(id);
    const n = (used.get(prefix) || 0) + 1;
    note(prefix, n);
    const code = `${prefix}-${pad(n)}`;
    m.set(id, code);
    return code;
  };

  for (const [key, prefix] of Object.entries(PREFIXES)) {
    (doc[key] || []).forEach((e) => assign(e.id, prefix));
  }
  (doc.variables || []).forEach((v) => m.set(v.id, v.name ? `$${v.name}` : '$?'));

  // Stages carry their tests and steps with them: a test keeps the number of the stage it
  // belongs to, so the codes stay readable even where the base numbering has gaps.
  for (const stage of doc.stages || []) {
    const kind = stage.kind === STAGE_KIND.SETUP ? 'setup' : 'test';
    const stageCode = assign(stage.id, STAGE_PREFIX[kind]);
    const n = stageCode.slice(stageCode.indexOf('-') + 1);
    (stage.tests || []).forEach((test, j) => {
      const testCode = `${TEST_PREFIX[kind]}-${n}.${pad(j + 1)}`;
      m.set(test.id, testCode);
      (test.steps || []).forEach((step, k) => m.set(step.id, `${testCode}.${pad(k + 1)}`));
    });
  }
  return m;
}

/**
 * Map id -> entity for the document being read, completed with the base document.
 *
 * A variant that removes a stage still has to name it: the matrix says the stage exists and
 * that this variant does not run it, and a row reading «STG-03» with no name says nothing.
 * What the variant does carry wins, so a renamed entity shows its new name.
 */
export function mergedIndex(doc, base) {
  if (!base || base === doc) return computeIndex(doc);
  const m = computeIndex(base);
  for (const [id, entity] of computeIndex(doc)) m.set(id, entity);
  return m;
}

/** Map id -> entity, for every entity that can be referenced. */
export function computeIndex(doc) {
  const m = new Map();
  const add = (arr) => (arr || []).forEach((e) => e && e.id && m.set(e.id, e));
  add(doc.references); add(doc.resources); add(doc.protocols); add(doc.interfaces); add(doc.commands);
  add(doc.points); add(doc.images); add(doc.variants); add(doc.variables);
  for (const stage of doc.stages || []) {
    m.set(stage.id, stage);
    for (const test of stage.tests || []) {
      m.set(test.id, test);
      (test.steps || []).forEach((s) => m.set(s.id, s));
    }
  }
  return m;
}

export const codeOf = (codes, id) => codes.get(id) || '';

/** Just the number of a code: "AP-03" -> "03". Used where space is tight, on the images. */
export const codeNumber = (code) => {
  const s = String(code || '');
  const i = s.lastIndexOf('-');
  return i >= 0 ? s.slice(i + 1) : s;
};

/**
 * What to write on the picture for an application point.
 *
 * A test point already carries a name the whole factory uses — the TP number silk-screened on
 * the board, usually written in the connector field — and printing our own number next to it
 * would be a second name for the same thing. When the connector names a test point, that name
 * wins; otherwise the marker shows the number of the point code, which stays short.
 */
const TEST_POINT = /\bTP[-\s]?(\d+)\b/i;

export function markerLabel(point, code) {
  const match = TEST_POINT.exec((point && point.connector) || '');
  return match ? `TP${match[1]}` : codeNumber(code);
}

/** Name of a referenced entity, whatever collection it belongs to. */
export function nameOf(index, id) {
  const e = index.get(id);
  if (!e) return '';
  return e.name || e.title || e.description || '';
}

/**
 * "AP-01 Battery positive": the code keeps the reference short, the name spares the
 * reader a trip to the appendix. Used across the editor and the printed document.
 */
export function labelOf(codes, index, id, maxName = 32) {
  const code = codeOf(codes, id);
  const name = nameOf(index, id);
  if (!code && !name) return '⟨missing⟩';
  if (!name) return code;
  const short = name.length > maxName ? name.slice(0, maxName - 1) + '…' : name;
  return code ? `${code} ${short}` : short;
}

/** Option label for selects: "CODE — name". */
export function optionLabel(codes, entity, nameField = 'name') {
  if (!entity) return '';
  const code = codeOf(codes, entity.id);
  const name = entity[nameField] || entity.title || entity.description || '';
  if (code && name) return `${code} — ${name}`;
  return code || name || '(unnamed)';
}
