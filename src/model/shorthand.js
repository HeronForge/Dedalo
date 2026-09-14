// The compact grammar of a table cell.
//
// A table step has as many criteria as it has measurement cells, and a form with twelve
// fields per cell is how an editing page becomes a spreadsheet nobody opens. So a cell is
// typed as the specification itself writes it — «12 ±0.5», «< 0.8», «10 … 14», «recorded»,
// «yes» — and read back into a criterion. The inverse writes a criterion back into the same
// words, so a cell re-opens showing what was typed; what the grammar cannot say (a two-sided
// open comparison, a criterion that passes outside its limits, a pattern) reads back as null,
// and the cell shows the criterion without offering to edit it.
import { constant, variableRef, newExpected, EXPECTED_KIND, COMPARISON, comparisonOf, stringComparisonOf, expectedKind, expectedTextRef } from './schema.js';
import { valueText } from './variables.js';

/** A number as a bench writes it, comma or point, sign allowed; or a variable by name. */
const NUMBER = '[-+]?\\d+(?:[.,]\\d+)?';
const VARIABLE = '\\$[A-Za-z_][\\w]*';
const OPERAND = `(${NUMBER}|${VARIABLE})`;

const ONE_SIDED = { '<': 'LT', '<=': 'LE', '≤': 'LE', '>': 'GT', '>=': 'GE', '≥': 'GE', '=': 'EQ', '==': 'EQ', '!=': 'NE', '≠': 'NE' };
const SYMBOL_OF = { LT: '<', LE: '<=', GT: '>', GE: '>=', EQ: '=', NE: '!=' };

const BOOLEANS = { yes: 'true', ok: 'true', true: 'true', pass: 'true', no: 'false', false: 'false' };

/**
 * Reads a cell into a criterion.
 * @param {string} text what was typed
 * @param {{unit?: string, variable?: (name: string) => (string|null)}} [options]
 *  `unit` is the column's; `variable` turns «$Name» into the id of the variable, or null
 *  when there is no such variable — the cell then stays what was typed, as text, and says so.
 * @returns {{expected: object, unresolved: string[]}}
 */
export function parseCriterion(text, { unit = '', variable = () => null } = {}) {
  const e = { ...newExpected(), unit };
  const unresolved = [];
  const raw = String(text || '').trim();
  const operand = (token) => {
    if (token.startsWith('$')) {
      const id = variable(token.slice(1));
      if (id) return variableRef(id);
      unresolved.push(token.slice(1));
      return null;
    }
    return constant(token.replace(',', '.'));
  };

  if (!raw) return { expected: e, unresolved };

  if (/^recorded$/i.test(raw)) return { expected: { ...e, comparison: 'NONE' }, unresolved };

  const bool = BOOLEANS[raw.toLowerCase()];
  if (bool) return { expected: { ...e, kind: EXPECTED_KIND.BOOLEAN, booleanValue: bool }, unresolved };

  // «12 ±0.5», «12±0,5», «12 +-0.5», «12 ±5%», «$Vbat ±5%»
  let m = new RegExp(`^${OPERAND}\\s*(?:±|\\+-|\\+/-)\\s*${OPERAND}\\s*(%?)$`).exec(raw);
  if (m) {
    const nominal = operand(m[1]);
    const tolerance = operand(m[2]);
    if (nominal && tolerance) {
      return { expected: { ...e, mode: 'nominal', comparison: 'EQT', nominal, tolerance, toleranceType: m[3] ? 'percent' : 'absolute' }, unresolved };
    }
    return { expected: asText(e, raw), unresolved };
  }

  // «< 0.8», «<= 0.8», «> 3», «>= 3», «= 0», «!= 0», «< $Imax»
  m = new RegExp(`^(<=|>=|!=|==|<|>|=|≤|≥|≠)\\s*${OPERAND}$`).exec(raw);
  if (m) {
    const code = ONE_SIDED[m[1]];
    const limit = operand(m[2]);
    if (limit) return { expected: { ...e, comparison: code, [COMPARISON[code].slot]: limit }, unresolved };
    return { expected: asText(e, raw), unresolved };
  }

  // «10 … 14», «10 .. 14», «10 - 14», «10÷14»: between, both ends included. The dash needs
  // room on both sides, or «-12 - -10» could not be told from a negative number.
  m = new RegExp(`^${OPERAND}\\s*(?:…|\\.\\.\\.?|÷|\\s-\\s)\\s*${OPERAND}$`).exec(raw) || new RegExp(`^${OPERAND}\\s+-\\s+${OPERAND}$`).exec(raw);
  if (m) {
    const min = operand(m[1]);
    const max = operand(m[2]);
    if (min && max) return { expected: { ...e, comparison: 'GELE', min, max }, unresolved };
    return { expected: asText(e, raw), unresolved };
  }

  // Anything else is the text the unit has to answer with: «+», «NC», «0x0008».
  return { expected: asText(e, raw), unresolved };
}

const asText = (e, raw) => ({ ...e, kind: EXPECTED_KIND.STRING, text: constant(raw), stringComparison: 'EQ', caseSensitive: true, regex: false });

/**
 * Writes a criterion back into the grammar, or null when the grammar cannot say it.
 * @param {object} expected
 * @param {(id: string) => string} [variableName] the name of a variable, for «$Name»
 */
export function criterionToShorthand(expected, variableName = () => '') {
  const e = expected || {};
  const word = (ref) => {
    if (!ref) return '';
    if (ref.mode === 'variable') { const n = variableName(ref.variableId); return n ? '$' + n : null; }
    return String(ref.value ?? '').trim();
  };
  const kind = expectedKind(e);
  if (kind === EXPECTED_KIND.BOOLEAN) return e.booleanValue === 'false' ? 'no' : 'yes';
  if (kind === EXPECTED_KIND.STRING) {
    if (e.regex || e.caseSensitive === false || stringComparisonOf(e) !== 'EQ') return null;
    const text = expectedTextRef(e);
    return text.mode === 'variable' ? null : String(text.value ?? '');
  }
  const code = comparisonOf(e);
  if (code === 'NONE') return 'recorded';
  if (code === 'EQT') {
    const nom = word(e.nominal);
    const tol = word(e.tolerance);
    if (nom === null || tol === null) return null;
    if (!nom) return '';
    return tol ? `${nom} ±${tol}${e.toleranceType === 'percent' ? '%' : ''}` : `${nom} ±`;
  }
  const spec = COMPARISON[code] || {};
  if (spec.sides === 1) {
    const limit = word(e[spec.slot]);
    return limit === null ? null : (limit ? `${SYMBOL_OF[code]} ${limit}` : '');
  }
  if (code === 'GELE') {
    const min = word(e.min);
    const max = word(e.max);
    if (min === null || max === null) return null;
    if (!min && !max) return '';
    return `${min} … ${max}`;
  }
  return null;
}

/**
 * A stimulus cell: a value, or «$Name». Plain text, since a value is whatever the bench
 * needs — «12», «open», «0x1F» — and only the variable form is read specially.
 */
export function parseValue(text, { variable = () => null } = {}) {
  const raw = String(text || '').trim();
  const m = new RegExp(`^${VARIABLE}$`).exec(raw);
  if (m) {
    const id = variable(raw.slice(1));
    return id ? { value: variableRef(id), unresolved: [] } : { value: constant(raw), unresolved: [raw.slice(1)] };
  }
  return { value: constant(raw), unresolved: [] };
}

/**
 * A stimulus cell as the page prints it: the column's unit after a number, nothing after a
 * word — «1500 Ω», but «open», not «open Ω».
 */
export function cellValueText(ref, variables, unit = '') {
  const numeric = ref && ref.mode === 'constant' && new RegExp(`^${NUMBER}$`).test(String(ref.value ?? '').trim());
  return valueText(ref, variables, numeric ? unit : '');
}

export const valueToShorthand = (ref, variableName = () => '') => {
  if (!ref) return '';
  if (ref.mode === 'variable') { const n = variableName(ref.variableId); return n ? '$' + n : ''; }
  return String(ref.value ?? '');
};
