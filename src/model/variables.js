// Global variables and value references.
import { VARIABLE_TYPE, COMPARISON, comparisonOf, EXPECTED_KIND, expectedKind, STRING_COMPARISON, stringComparisonOf, expectedTextRef } from './schema.js';

export const variableIndex = (doc) => new Map((doc.variables || []).map((v) => [v.id, v]));

/**
 * Resolves a value reference.
 * Always returns { text, value, unit, variable, missing }.
 */
export function resolveValue(ref, index, fieldUnit = '') {
  if (!ref || typeof ref !== 'object') return { text: '', value: null, unit: fieldUnit, variable: null, missing: false };
  if (ref.mode === 'variable') {
    const v = index.get(ref.variableId);
    if (!v) return { text: '⟨missing variable⟩', value: null, unit: fieldUnit, variable: null, missing: true };
    return {
      text: variableText(v),
      value: v.type === VARIABLE_TYPE.NUMBER ? toNumber(v.value) : v.value,
      unit: v.unit || fieldUnit,
      variable: v,
      missing: false,
    };
  }
  return { text: String(ref.value ?? ''), value: toNumber(ref.value), unit: fieldUnit, variable: null, missing: false };
}

/**
 * The literal a text criterion compares against, resolved.
 *
 * A variable gives its bare value and not the form `variableText` prints: what comes back
 * from the unit is «LCU200 v1.4.0», and a unit written alongside would fail every comparison.
 */
export function stringValue(expected, index) {
  const ref = expectedTextRef(expected);
  if (ref.mode === 'variable') {
    const v = index.get(ref.variableId);
    if (!v) return { text: '', variable: null, missing: true };
    return {
      text: v.type === VARIABLE_TYPE.RANGE ? variableText(v) : String(v.value ?? ''),
      variable: v,
      missing: false,
    };
  }
  return { text: String(ref.value ?? ''), variable: null, missing: false };
}

/** Text of a variable value, according to its type. */
export function variableText(v) {
  switch (v.type) {
    case VARIABLE_TYPE.RANGE:
      return `${v.min ?? ''} … ${v.max ?? ''}${v.unit ? ' ' + v.unit : ''}`;
    case VARIABLE_TYPE.BOOLEAN:
      return v.value === true || v.value === 'true' ? 'true' : 'false';
    case VARIABLE_TYPE.NUMBER:
      return `${v.value ?? ''}${v.unit ? ' ' + v.unit : ''}`;
    default:
      return String(v.value ?? '');
  }
}

/** Text shown for a reference: the resolved value, with the variable name in brackets. */
export function valueText(ref, index, fieldUnit = '') {
  const r = resolveValue(ref, index, fieldUnit);
  if (!r.text) return '';
  const u = r.variable ? '' : r.unit ? ' ' + r.unit : '';
  return r.variable ? `${r.text} (${r.variable.name})` : `${r.text}${u}`;
}

const toNumber = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/**
 * The acceptance criterion in the shortest form that is still exact.
 *
 * «11 V … 14 V» when both ends are included — the form a technician reads fastest — with the
 * strict symbol written only on the end that excludes: «>11 V … 14 V». One sided criteria are
 * their own symbol and nothing else: «≥ 12 V», «≠ 0 V». The ones that pass outside the two
 * limits say «or», because that is what they mean.
 */
export function expectedText(measurement, index, fallbackUnit = '') {
  const raw = measurement && measurement.expected;
  if (!raw) return '';
  // A criterion that states no unit over a command whose decoding states one is read in that
  // unit — on the page only; nothing is written into the step.
  const e = fallbackUnit && !String(raw.unit || '').trim() ? { ...raw, unit: fallbackUnit } : raw;

  const kind = expectedKind(e);
  if (kind === EXPECTED_KIND.BOOLEAN) return e.booleanValue === 'false' ? 'FALSE' : 'TRUE';
  if (kind === EXPECTED_KIND.STRING) {
    const r = stringValue(e, index);
    if (r.missing) return '⟨missing variable⟩';
    if (!r.text) return '';
    // Where the value comes from is said the way a numeric limit says it: the name in
    // brackets after the value, which is also what makes it clickable in the document.
    const from = r.variable && r.variable.name ? ` (${r.variable.name})` : '';
    // A pattern is shown between slashes and nothing else: the plate underneath already says
    // it is a pattern, and «matches» in front of it was the same word said twice.
    if (e.regex) return `/${r.text}/${from}`;
    return `${STRING_COMPARISON[stringComparisonOf(e)].symbol} "${r.text}"${from}`;
  }

  const code = comparisonOf(e);
  const spec = COMPARISON[code] || {};

  if (code === 'EQT') {
    const nom = valueText(e.nominal, index, e.unit);
    const tol = valueText(e.tolerance, index, e.toleranceType === 'percent' ? '%' : e.unit);
    if (!nom) return '';
    // Never the nominal alone: printed bare it reads as an equality, and the bench would fail
    // every unit on it. The gap is written where the tolerance should be.
    return `${nom} ± ${tol || '⟨missing tolerance⟩'}`;
  }
  if (code === 'NONE') return 'recorded, no pass/fail';

  const min = valueText(e.min, index, e.unit);
  const max = valueText(e.max, index, e.unit);

  if (spec.sides === 1) {
    const value = spec.slot === 'max' ? max : min;
    return value ? `${SYMBOL[code]} ${value}` : (e.unit || '');
  }
  if (spec.outside) {
    if (min && max) return `${spec.low} ${min} or ${spec.high} ${max}`;
    if (min) return `${spec.low} ${min}`;
    return max ? `${spec.high} ${max}` : (e.unit || '');
  }
  if (min && max) {
    const low = spec.low === '>' ? '>' : '';
    const high = spec.high === '<' ? '<' : '';
    return `${low}${min} … ${high}${max}`;
  }
  // A range with one end missing still says what it can, rather than nothing.
  if (min) return `${spec.low === '>' ? '>' : '≥'} ${min}`;
  if (max) return `${spec.high === '<' ? '<' : '≤'} ${max}`;
  return e.unit || '';
}

/** The symbol a one sided comparison prints. */
const SYMBOL = { EQ: '=', NE: '≠', GT: '>', GE: '≥', LT: '<', LE: '≤' };

/** Effective numeric limits (used by the consistency checks). */
export function numericLimits(measurement, index) {
  const e = measurement && measurement.expected;
  if (!e) return { min: null, max: null };
  // Only a numeric criterion has limits; a string or a yes/no answer has none to compare.
  if (expectedKind(e) !== EXPECTED_KIND.NUMERIC) return { min: null, max: null };
  if (e.mode === 'nominal') {
    const nom = resolveValue(e.nominal, index).value;
    const tol = resolveValue(e.tolerance, index).value;
    if (nom == null || tol == null) return { min: null, max: null };
    const d = e.toleranceType === 'percent' ? Math.abs((nom * tol) / 100) : Math.abs(tol);
    return { min: nom - d, max: nom + d };
  }
  // The comparison decides which ends are really bounds: a «less than» keeps no lower one, a
  // value left behind in an unused field must not become a phantom limit, and a criterion
  // that passes outside its two limits is not an interval at all.
  const code = comparisonOf(e);
  const spec = COMPARISON[code] || {};
  const min = resolveValue(e.min, index).value;
  const max = resolveValue(e.max, index).value;
  if (code === 'NONE' || spec.outside) return { min: null, max: null };
  if (spec.sides === 1) {
    const only = spec.slot === 'max' ? max : min;
    if (code === 'EQ') return { min: only, max: only };
    if (code === 'NE') return { min: null, max: null };
    return spec.slot === 'max' ? { min: null, max: only } : { min: only, max: null };
  }
  return { min, max };
}
