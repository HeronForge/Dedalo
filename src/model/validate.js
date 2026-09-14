// Consistency checks over the whole document. Nothing here blocks editing:
// the results feed the validation panel and each one can be jumped to.
import { STEP_TYPE, EXCLUSION_MODE, COMPARISON, comparisonOf, EXPECTED_KIND, expectedKind, expectedTextRef, stepBlocks, isComputed, TABLE_COLUMN_KIND, commandDecoding } from './schema.js';
import { isDraft, editedSinceIssue } from '../history/revisions.js';
import { stageIndex, findCycles, transitivePrerequisites, callMap, isSetup, parallelGroupsDetailed } from './stages.js';
import { variableIndex, numericLimits, stringValue } from './variables.js';
import { applyOverlay } from './variants.js';
import { readablePath } from './paths.js';
import { computeCodes, computeIndex, labelOf } from './codes.js';
import { blockPoints, commandInterfaces } from './resources.js';

export const SEVERITY = { ERROR: 'error', WARNING: 'warning', INFO: 'info' };

export const SEVERITY_LABEL = { error: 'Errors', warning: 'Warnings', info: 'Notices' };

const P = (severity, message, where) => ({ severity, message, where: where || null });

/**
 * @param {object} doc the document to check
 * @param {object} [options] `history` lets the check see the revisions already issued
 * @returns {{issues: Array, counts: {error:number, warning:number, info:number}}}
 */
export function validateDocument(doc, options = {}) {
  const issues = [];
  const stages = stageIndex(doc);
  const variables = variableIndex(doc);
  const known = collectIds(doc);
  const codes = computeCodes(doc, options.base);
  const index = computeIndex(doc);
  const ctx = { doc, base: options.base || null, stages, variables, known, codes, index, history: options.history || null, out: issues };

  checkPrerequisites(ctx);
  checkExclusions(ctx);
  checkStageCalls(ctx);
  checkStageKinds(ctx);
  checkHeldStimuli(ctx);
  checkReferences(ctx);
  checkMeasurements(ctx);
  checkTables(ctx);
  checkComputed(ctx);
  checkContents(ctx);
  checkCommandInstruments(ctx);
  checkVariables(ctx);
  checkPoints(ctx);
  checkVariants(ctx);
  checkHeader(ctx);
  checkGlossary(ctx);
  checkIdentity(ctx);

  const counts = { error: 0, warning: 0, info: 0 };
  for (const p of issues) counts[p.severity]++;
  return { issues, counts };
}

/**
 * Ids grouped by the collection they belong to. Checking a reference against «every id in the
 * document» would let a command point at a resource and call it valid, so each kind keeps its
 * own set; `all` is what tells a wrong kind from a dangling reference, and `duplicates` catches
 * the one thing that would quietly break paths, diffing and the index.
 */
function collectIds(doc) {
  const byKind = {
    references: new Set(), resources: new Set(), protocols: new Set(),
    interfaces: new Set(), commands: new Set(),
    points: new Set(), images: new Set(), variables: new Set(), variants: new Set(),
    stages: new Set(), tests: new Set(), steps: new Set(), signatories: new Set(),
  };
  const all = new Set();
  const duplicates = new Set();
  const add = (kind, id) => {
    if (!id) return;
    if (all.has(id)) duplicates.add(id);
    all.add(id);
    byKind[kind].add(id);
  };
  for (const kind of ['references', 'resources', 'protocols', 'interfaces', 'commands', 'points', 'images', 'variables', 'variants'])
    for (const e of doc[kind] || []) add(kind, e && e.id);
  for (const s of (doc.header || {}).signatories || []) add('signatories', s && s.id);
  for (const stage of doc.stages || []) {
    add('stages', stage.id);
    for (const t of stage.tests || []) {
      add('tests', t.id);
      for (const s of t.steps || []) add('steps', s.id);
    }
  }
  return { byKind, all, duplicates: [...duplicates] };
}

const label = (ctx, id) => labelOf(ctx.codes, ctx.index, id, 40) || 'unnamed';

function checkPrerequisites({ doc, stages, out, codes, index }) {
  const ctx = { codes, index };
  for (const stage of doc.stages || []) {
    for (const p of stage.prerequisites || []) {
      if (p === stage.id) out.push(P(SEVERITY.ERROR, `Stage ${label(ctx, stage.id)} lists itself as a prerequisite.`, { kind: 'stage', id: stage.id }));
      else if (!stages.has(p)) out.push(P(SEVERITY.ERROR, `Stage ${label(ctx, stage.id)} requires a prerequisite that no longer exists.`, { kind: 'stage', id: stage.id }));
      else if (isSetup(stages.get(p))) out.push(P(SEVERITY.WARNING, `Stage ${label(ctx, stage.id)} lists the setup stage ${label(ctx, p)} as a prerequisite: setup stages run only when a step calls them.`, { kind: 'stage', id: stage.id }));
    }
  }
  for (const cycle of findCycles(doc)) {
    const names = cycle.map((id) => label(ctx, id)).join(' → ');
    out.push(P(SEVERITY.ERROR, `Cycle in the stage prerequisites: ${names}.`, { kind: 'stage', id: cycle[0] }));
  }
}

function checkExclusions({ doc, stages, out, codes, index }) {
  const ctx = { codes, index };
  const transitive = transitivePrerequisites(doc);
  for (const stage of doc.stages || []) {
    const e = stage.exclusions || { mode: EXCLUSION_MODE.NONE, stageIds: [] };
    if (e.mode !== EXCLUSION_MODE.LIST) continue;
    for (const id of e.stageIds || []) {
      if (id === stage.id) { out.push(P(SEVERITY.ERROR, `Stage ${label(ctx, stage.id)} declares that it excludes itself.`, { kind: 'stage', id: stage.id })); continue; }
      if (!stages.has(id)) { out.push(P(SEVERITY.ERROR, `Stage ${label(ctx, stage.id)} excludes a stage that no longer exists.`, { kind: 'stage', id: stage.id })); continue; }
      const ordered = (transitive.get(stage.id) || new Set()).has(id) || (transitive.get(id) || new Set()).has(stage.id);
      if (ordered) out.push(P(SEVERITY.INFO, `The exclusion between ${label(ctx, stage.id)} and ${label(ctx, id)} is redundant: the prerequisites already make them sequential.`, { kind: 'stage', id: stage.id }));
    }
  }
}

function checkStageCalls({ doc, stages, out, codes, index }) {
  const ctx = { codes, index };
  const calls = new Map(); // stageId -> Set(called stageId)
  for (const stage of doc.stages || []) {
    const set = new Set();
    for (const t of stage.tests || []) for (const s of t.steps || []) {
      if (s.type !== STEP_TYPE.STAGE_CALL) continue;
      if (!s.calledStageId) { out.push(P(SEVERITY.ERROR, `Step ${label(ctx, s.id)} calls a stage but does not say which one.`, { kind: 'step', id: s.id })); continue; }
      if (!stages.has(s.calledStageId)) { out.push(P(SEVERITY.ERROR, `Step ${label(ctx, s.id)} calls a stage that no longer exists.`, { kind: 'step', id: s.id })); continue; }
      set.add(s.calledStageId);
    }
    calls.set(stage.id, set);
  }
  const state = new Map();
  const stack = [];
  const visit = (id) => {
    state.set(id, 1); stack.push(id);
    for (const c of calls.get(id) || []) {
      if (state.get(c) === 1) {
        const path = stack.slice(stack.indexOf(c)).concat(c).map((x) => label(ctx, x)).join(' → ');
        out.push(P(SEVERITY.ERROR, `Recursive stage call: ${path}.`, { kind: 'stage', id: c }));
      } else if (!state.get(c)) visit(c);
    }
    stack.pop(); state.set(id, 2);
  };
  for (const id of calls.keys()) if (!state.get(id)) visit(id);
}

/** The difference between a test stage and a setup stage has to stay meaningful. */
function checkStageKinds({ doc, out, codes, index, stages }) {
  const ctx = { codes, index };
  const calls = callMap(doc);
  for (const stage of doc.stages || []) {
    const callers = calls.get(stage.id) || [];
    if (isSetup(stage)) {
      if (!callers.length)
        out.push(P(SEVERITY.WARNING, `Setup stage ${label(ctx, stage.id)} is never called by any step: as it stands it never runs.`, { kind: 'stage', id: stage.id }));
      if ((stage.prerequisites || []).length)
        out.push(P(SEVERITY.INFO, `Setup stage ${label(ctx, stage.id)} declares prerequisites, which are ignored: it runs where it is called.`, { kind: 'stage', id: stage.id }));
    } else if (callers.length) {
      const who = callers.map((c) => label(ctx, c.stepId)).join(', ');
      out.push(P(SEVERITY.WARNING, `Test stage ${label(ctx, stage.id)} is called by ${who}: a stage meant to be called should be marked as a setup stage.`, { kind: 'stage', id: stage.id }));
    }
  }
}

function checkHeldStimuli({ doc, out, codes, index }) {
  const ctx = { codes, index };
  for (const stage of doc.stages || []) {
    const own = new Map();
    for (const t of stage.tests || []) for (const s of t.steps || []) own.set(s.id, s);
    for (const held of stage.heldStimuli || []) {
      if (!held.stepId) { out.push(P(SEVERITY.WARNING, `Stage ${label(ctx, stage.id)} declares a held stimulus without naming the step.`, { kind: 'stage', id: stage.id })); continue; }
      const s = own.get(held.stepId);
      if (!s) out.push(P(SEVERITY.ERROR, `Stage ${label(ctx, stage.id)} holds a stimulus that does not belong to its own steps.`, { kind: 'stage', id: stage.id }));
      else if (!s.stimulus) out.push(P(SEVERITY.ERROR, `Stage ${label(ctx, stage.id)} holds step ${label(ctx, s.id)}, which applies no stimulus.`, { kind: 'stage', id: stage.id }));
    }
  }
}

function checkReferences({ doc, known, variables, out, codes, index }) {
  const ctx = { codes, index };
  /** null when the reference is fine, otherwise why it is not. */
  const refProblem = (kind, id) => {
    if (!id) return null;
    if (known.byKind[kind].has(id)) return null;
    return known.all.has(id) ? `is not ${withArticle(singularKind(kind))}` : 'does not exist';
  };
  const checkRef = (ref, context, where) => {
    if (ref && ref.mode === 'variable' && !variables.has(ref.variableId))
      out.push(P(SEVERITY.ERROR, `${context}: reference to a variable that no longer exists.`, where));
  };
  for (const c of doc.commands || []) {
    const why = refProblem('interfaces', c.interfaceId);
    if (why) out.push(P(SEVERITY.ERROR, `Command ${label(ctx, c.id)} points at an interface that ${why}.`, { kind: 'command', id: c.id }));
    const whyProtocol = refProblem('protocols', c.protocolId);
    if (whyProtocol) out.push(P(SEVERITY.ERROR, `Command ${label(ctx, c.id)} points at a protocol that ${whyProtocol}.`, { kind: 'command', id: c.id }));
    const whyDefined = refProblem('references', c.referenceId);
    if (whyDefined) out.push(P(SEVERITY.ERROR, `Command ${label(ctx, c.id)} says it is defined in a reference that ${whyDefined}.`, { kind: 'command', id: c.id }));
  }
  for (const p of doc.protocols || []) {
    const whyDefined = refProblem('references', p.referenceId);
    if (whyDefined) out.push(P(SEVERITY.ERROR, `Protocol ${label(ctx, p.id)} says it is defined in a reference that ${whyDefined}.`, { kind: 'protocol', id: p.id }));
  }
  // Commands defined elsewhere and described nowhere here: one line per reference, so whoever
  // reads the document knows which other document they will need at the bench.
  const elsewhere = new Map();
  for (const c of doc.commands || []) {
    if (c.referenceId && !String(c.requestFormat || '').trim() && !String(c.responseFormat || '').trim())
      elsewhere.set(c.referenceId, (elsewhere.get(c.referenceId) || 0) + 1);
  }
  for (const [referenceId, n] of elsewhere) {
    out.push(P(SEVERITY.INFO, `${n} command${n === 1 ? ' is' : 's are'} defined in ${label(ctx, referenceId)} and carr${n === 1 ? 'ies' : 'y'} no format here.`, null));
  }
  for (const p of doc.points || [])
    for (const m of p.markers || []) {
      const why = refProblem('images', m.imageId);
      if (why) out.push(P(SEVERITY.ERROR, `Point ${label(ctx, p.id)} has a marker on an image that ${why}.`, { kind: 'point', id: p.id }));
    }

  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    const where = { kind: 'step', id: s.id };
    if (s.wait) checkRef(s.wait.value, `Wait of step ${label(ctx, s.id)}`, where);
    const figure = refProblem('images', s.imageId);
    if (figure) out.push(P(SEVERITY.ERROR, `Step ${label(ctx, s.id)} points at an image that ${figure}.`, where));
    for (const { kind, block, column } of stepBlocks(s)) {
      const context = column
        ? `Column «${column.name || '?'}» of step ${label(ctx, s.id)}`
        : `${kind === 'stimulus' ? 'Stimulus' : 'Measurement'} of step ${label(ctx, s.id)}`;
      const resource = refProblem('resources', block.resourceId);
      if (resource) out.push(P(SEVERITY.ERROR, `${context}: the resource ${resource}.`, where));
      const command = refProblem('commands', block.commandId);
      if (command) out.push(P(SEVERITY.ERROR, `${context}: the command ${command}.`, where));
      for (const pid of block.pointIds || []) {
        const point = refProblem('points', pid);
        if (point) out.push(P(SEVERITY.ERROR, `${context}: an application point ${point}.`, where));
      }
      for (const par of block.parameters || []) checkParameter(par, context, where, variables, out, checkRef);
      if (block.expected) checkExpectedRefs(block.expected, context, where, checkRef);
    }
    // The cells of a table: a value or a criterion each, bound to variables like any other.
    for (const row of ((s.table || {}).rows || [])) for (const cell of row.cells || []) {
      const context = `Row «${row.label || '?'}» of step ${label(ctx, s.id)}`;
      if (cell.value) checkRef(cell.value, context, where);
      if (cell.expected) checkExpectedRefs(cell.expected, context, where, checkRef);
    }
  }
}

function checkExpectedRefs(expected, context, where, checkRef) {
  checkRef(expected.min, context, where); checkRef(expected.max, context, where);
  checkRef(expected.nominal, context, where); checkRef(expected.tolerance, context, where);
  // A text criterion can be bound to a variable too, and loses it the same way.
  if (expectedKind(expected) === 'string') checkRef(expected.text, context, where);
}

function checkParameter(par, context, where, variables, out, checkRef) {
  checkRef(par.value, context, where);
  if (par.value && par.value.mode === 'variable') {
    const v = variables.get(par.value.variableId);
    if (v && par.unit && v.unit && v.unit !== par.unit)
      out.push(P(SEVERITY.WARNING, `${context}: parameter «${par.name || '?'}» is in ${par.unit} but variable ${v.name} is in ${v.unit}.`, where));
  }
}

function checkMeasurements({ doc, variables, out, codes, index }) {
  const ctx = { codes, index };
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    if (!s.measurement) continue;
    const where = { kind: 'step', id: s.id };
    if (checkCriterion(s.measurement.expected, `Step ${label(ctx, s.id)}`, where, variables, out))
      out.push(P(SEVERITY.WARNING, `Step ${label(ctx, s.id)}: the measurement has no acceptance criterion.`, where));
  }
}

/**
 * One criterion, wherever it sits — the measurement of a step, a cell of a table — checked
 * for the things that make it unjudgeable: limits crossed, a nominal without a tolerance, a
 * two-sided comparison with one end missing, a pattern that does not compile.
 * @returns {boolean} whether the criterion is empty
 */
function checkCriterion(expected, subject, where, variables, out) {
  const e = expected || {};
  const { min, max } = numericLimits({ expected: e }, variables);
  if (min != null && max != null && min > max)
    out.push(P(SEVERITY.ERROR, `${subject}: the lower limit is above the upper limit.`, where));
  const code = comparisonOf(e);
  const spec = COMPARISON[code] || {};
  // «No comparison» records the value and judges nothing: an empty criterion is the point.
  if (code === 'NONE') return false;

  // A text or a yes/no criterion is judged on its own terms.
  if (expectedKind(e) === 'boolean') return false;
  if (expectedKind(e) === 'string') {
    const value = stringValue(e, variables);
    // A criterion whose variable is gone is reported where every broken reference is;
    // here it would only be said a second time.
    if (value.missing) return false;
    if (!value.text.trim()) return true;
    if (e.regex) {
      // A pattern that does not compile can never match: better said here than on the bench.
      try {
        new RegExp(value.text);
      } catch (err) {
        out.push(P(SEVERITY.ERROR, `${subject}: the regular expression is not valid — ${err.message}.`, where));
      }
    }
    return false;
  }

  const empty = code === 'EQT' ? !hasValue(e.nominal) : !hasValue(e.min) && !hasValue(e.max);
  if (empty) return true;
  // A nominal without a tolerance prints as a bare number, which at the bench reads as an
  // exact equality — the one criterion no measurement ever meets.
  if (code === 'EQT') {
    if (!hasValue(e.tolerance))
      out.push(P(SEVERITY.ERROR, `${subject}: the nominal value has no tolerance, so the criterion reads as an exact equality.`, where));
    return false;
  }
  // A two sided comparison with one end missing passes anything on that side, which is
  // almost never what was meant.
  if (spec.sides === 2 && (!hasValue(e.min) || !hasValue(e.max))) {
    out.push(P(SEVERITY.WARNING,
      `${subject}: comparison ${code} (${spec.condition}) needs both limits, and one of them is empty.`, where));
  }
  if (spec.sides === 1) {
    const unused = spec.slot === 'min' ? e.max : e.min;
    if (hasValue(unused)) {
      out.push(P(SEVERITY.WARNING,
        `${subject}: comparison ${code} (${spec.condition}) uses one limit, and the other one still holds a value that is ignored.`, where));
    }
  }
  return false;
}

/**
 * A measurement computed from earlier readings: its inputs are steps of the same test that
 * come before it and read something, and it names no instrument — a computed value that also
 * says which multimeter took it is two stories about one number.
 */
function checkComputed({ doc, out, codes, index }) {
  const ctx = { codes, index };
  for (const stage of doc.stages || []) for (const t of stage.tests || []) {
    const steps = t.steps || [];
    steps.forEach((s, at) => {
      const m = s.measurement;
      if (!isComputed(m)) return;
      const where = { kind: 'step', id: s.id };
      const subject = `Step ${label(ctx, s.id)}`;
      if (m.resourceId || (m.pointIds || []).length || m.commandId)
        out.push(P(SEVERITY.ERROR, `${subject}: the measurement is computed, yet names an instrument, a point or a command.`, where));
      if (!String(m.computed.formula || '').trim())
        out.push(P(SEVERITY.WARNING, `${subject}: the computed measurement has no formula.`, where));
      const inputs = m.computed.inputStepIds || [];
      if (!inputs.length) out.push(P(SEVERITY.WARNING, `${subject}: the computed measurement names no input step.`, where));
      for (const id of inputs) {
        const k = steps.findIndex((x) => x.id === id);
        if (k < 0) { out.push(P(SEVERITY.ERROR, `${subject}: an input of the computation is not a step of this test.`, where)); continue; }
        if (k >= at) out.push(P(SEVERITY.ERROR, `${subject}: input ${label(ctx, id)} comes after the computation, or is the computation itself.`, where));
        const input = steps[k];
        if (!input.measurement && input.type !== STEP_TYPE.TABLE)
          out.push(P(SEVERITY.ERROR, `${subject}: input ${label(ctx, id)} reads nothing, so there is nothing to compute from.`, where));
      }
    });
  }
}

/**
 * A table step: columns to read from, rows to run, and in every measurement cell something
 * to judge. A row with cells that judge nothing is reported once, not once per cell: the
 * cure is the same and the reader would not thank five lines for it.
 */
function checkTables({ doc, variables, out, codes, index }) {
  const ctx = { codes, index };
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    if (s.type !== STEP_TYPE.TABLE) continue;
    const where = { kind: 'step', id: s.id };
    const table = s.table || {};
    const columns = table.columns || [];
    const rows = table.rows || [];
    if (!columns.length) out.push(P(SEVERITY.WARNING, `Step ${label(ctx, s.id)}: the table has no columns.`, where));
    if (!rows.length) out.push(P(SEVERITY.WARNING, `Step ${label(ctx, s.id)}: the table has no rows.`, where));
    const byId = new Map(columns.map((c) => [c.id, c]));
    for (const c of columns) if (!c.name) out.push(P(SEVERITY.WARNING, `Step ${label(ctx, s.id)}: a column of the table has no name.`, where));
    for (const row of rows) {
      const rowLabel = row.label || '(unlabelled row)';
      let unjudged = 0;
      for (const cell of row.cells || []) {
        const column = byId.get(cell.columnId);
        if (!column) {
          out.push(P(SEVERITY.ERROR, `Step ${label(ctx, s.id)}, row «${rowLabel}»: a cell belongs to a column the table no longer has.`, where));
          continue;
        }
        if (column.kind === TABLE_COLUMN_KIND.MEASUREMENT && cell.expected) {
          if (checkCriterion(cell.expected, `Step ${label(ctx, s.id)}, row «${rowLabel}», column «${column.name || '?'}»`, where, variables, out)) unjudged += 1;
        }
      }
      // A measurement column with no cell in this row judges nothing there either.
      for (const c of columns) {
        if (c.kind === TABLE_COLUMN_KIND.MEASUREMENT && !(row.cells || []).some((cell) => cell.columnId === c.id)) unjudged += 1;
      }
      if (unjudged) out.push(P(SEVERITY.WARNING, `Step ${label(ctx, s.id)}: row «${rowLabel}» has ${unjudged} cell${unjudged === 1 ? '' : 's'} without a criterion.`, where));
    }
  }
}

/**
 * A command needs an instrument to send it. The step may name one; otherwise the interface
 * the command speaks over declares it. When neither does, the bench has nothing to plug in.
 */
function checkCommandInstruments({ doc, out, codes, index }) {
  const interfaces = new Map((doc.interfaces || []).map((i) => [i.id, i]));
  const commands = new Map((doc.commands || []).map((c) => [c.id, c]));
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    // Two columns of one table over the same command are one thing to fix, said once.
    const said = new Set();
    for (const { block } of stepBlocks(s)) {
      if (!block || !block.commandId || block.resourceId || said.has(block.commandId)) continue;
      said.add(block.commandId);
      const command = commands.get(block.commandId);
      const itf = command && interfaces.get(command.interfaceId);
      if (itf && itf.resourceId) continue;
      const where = { kind: 'step', id: s.id };
      out.push(P(SEVERITY.WARNING,
        itf
          ? `Step ${labelOf(codes, index, s.id, 30)}: interface ${labelOf(codes, index, itf.id, 26)} declares no instrument, so the command has nothing to send it with.`
          : `Step ${labelOf(codes, index, s.id, 30)}: the command names no interface, so no instrument can be derived for it.`,
        where));
    }
  }
}

const hasValue = (ref) => !!(ref && (ref.mode === 'variable' ? ref.variableId : String(ref.value ?? '').trim()));

const withArticle = (word) => (/^[aeiou]/i.test(word) ? 'an ' : 'a ') + word;

const singularKind = (kind) => ({
  references: 'reference', resources: 'resource', protocols: 'protocol',
  interfaces: 'interface', commands: 'command',
  points: 'application point', images: 'image', variables: 'variable', variants: 'variant',
  stages: 'stage', tests: 'test', steps: 'step',
}[kind] || kind);

function checkContents({ doc, out, codes, index }) {
  const ctx = { codes, index };
  if (!(doc.stages || []).length) out.push(P(SEVERITY.WARNING, 'The specification contains no stages yet.', null));
  for (const stage of doc.stages || []) {
    if (!stage.name) out.push(P(SEVERITY.WARNING, `Stage ${label(ctx, stage.id)} has no name.`, { kind: 'stage', id: stage.id }));
    if (!(stage.tests || []).length) out.push(P(SEVERITY.WARNING, `Stage ${label(ctx, stage.id)} contains no tests.`, { kind: 'stage', id: stage.id }));
    for (const t of stage.tests || []) {
      if (!t.name) out.push(P(SEVERITY.WARNING, `Test ${label(ctx, t.id)} has no name.`, { kind: 'test', id: t.id }));
      if (!(t.steps || []).length) out.push(P(SEVERITY.WARNING, `Test ${label(ctx, t.id)} contains no steps.`, { kind: 'test', id: t.id }));
      for (const s of t.steps || [])
        if (!s.description) out.push(P(SEVERITY.WARNING, `Step ${label(ctx, s.id)} has no description.`, { kind: 'step', id: s.id }));
    }
  }
}

function checkVariables({ doc, out }) {
  const seen = new Map();
  for (const v of doc.variables || []) {
    if (!v.name) { out.push(P(SEVERITY.WARNING, 'A global variable has no name.', { kind: 'variable', id: v.id })); continue; }
    if (seen.has(v.name)) out.push(P(SEVERITY.ERROR, `The variable name «${v.name}» is used more than once.`, { kind: 'variable', id: v.id }));
    seen.set(v.name, v.id);
  }
  const used = new Set();
  walkValueRefs(doc, (ref) => { if (ref.mode === 'variable') used.add(ref.variableId); });
  for (const v of doc.variables || [])
    if (v.name && !used.has(v.id)) out.push(P(SEVERITY.INFO, `Variable «${v.name}» is not used by any step.`, { kind: 'variable', id: v.id }));
}

function checkPoints({ doc, out, codes, index }) {
  const ctx = { codes, index };
  const used = new Set();
  // A step that sends a command reaches the unit through the contacts its interface is wired
  // to: those points are used every time the bus is, even though no step names them. This
  // is the same rule the resource count applies, so the two never disagree.
  const interfaceOfCommand = commandInterfaces(doc);
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || [])
    for (const { block } of stepBlocks(s)) blockPoints(block, interfaceOfCommand).forEach((p) => used.add(p));
  for (const p of doc.points || []) {
    if (!(p.markers || []).length) out.push(P(SEVERITY.WARNING, `Point ${label(ctx, p.id)} is not marked on any image.`, { kind: 'point', id: p.id }));
    if (!used.has(p.id)) out.push(P(SEVERITY.INFO, `Point ${label(ctx, p.id)} is not used by any step.`, { kind: 'point', id: p.id }));
  }
}

function checkVariants({ doc, base, out }) {
  // A variant is a list of differences from the base document, so it is checked against the
  // base: read against a document already resolved through it, its own removals would look
  // like customisations of something that does not exist.
  const source = base || doc;
  for (const v of source.variants || []) {
    if (!v.name) out.push(P(SEVERITY.WARNING, 'A variant has no name.', { kind: 'variant', id: v.id }));
    const { dropped } = applyOverlay(source, v);
    for (const op of dropped)
      out.push(P(SEVERITY.ERROR, `Variant «${v.name || 'unnamed'}»: the customisation on ${readablePath(source, op.path)} can no longer be applied.`, { kind: 'variant', id: v.id }));
  }
}

/**
 * Two things that are invisible while editing and poisonous afterwards: two entities sharing
 * an id (paths, diff and the index would resolve the wrong one) and a draft whose number has
 * already been issued (issuing it would collide with the frozen revision).
 */
function checkIdentity({ doc, base, known, history, out, codes, index }) {
  const ctx = { codes, index };
  for (const id of known.duplicates)
    out.push(P(SEVERITY.ERROR, `The identifier of ${label(ctx, id)} is used by more than one element: references may resolve to the wrong one.`, null));

  if (history) {
    const number = String((doc.revision || {}).number ?? '').trim();
    const clash = (history.revisions || []).some((r) => String(r.number).trim() === number);
    if (isDraft(doc)) {
      if (number && clash)
        out.push(P(SEVERITY.WARNING, `Revision ${number} has already been issued: change the draft number before validating it.`, { kind: 'header', id: '' }));
    } else if (editedSinceIssue(base || doc, history)) {
      // The cover says «Rev. 01 — Issued» over a document that is not Rev. 01 any more.
      out.push(P(SEVERITY.ERROR, `Revision ${number} is issued and the document has been changed since: open a new draft on the revisions page, or restore Rev. ${number}.`, { kind: 'header', id: '' }));
    }
  }

  const { truncated } = parallelGroupsDetailed(doc);
  if (truncated)
    out.push(P(SEVERITY.WARNING, 'The stage graph is too large to enumerate every group of stages that may run in parallel: the channel figures in the resource table are an upper bound, not an exact count.', null));
}

function checkHeader({ doc, out }) {
  const h = doc.header || {};
  const missing = [['title', 'title'], ['company', 'company'], ['documentCode', 'document code'], ['product', 'product']]
    .filter(([k]) => !String(h[k] || '').trim()).map(([, l]) => l);
  if (missing.length) out.push(P(SEVERITY.WARNING, `Incomplete header: missing ${missing.join(', ')}.`, { kind: 'header', id: '' }));
  // A cover with a signature table and nobody in it is a document nobody answers for.
  if (!(h.signatories || []).some((s) => s && String(s.name || '').trim()))
    out.push(P(SEVERITY.WARNING, 'Incomplete header: no signatory is named.', { kind: 'header', id: '' }));
}

/** A glossary line says what a term stands for; two lines for one term say two things. */
function checkGlossary({ doc, out }) {
  const seen = new Set();
  for (const g of doc.glossary || []) {
    const term = String(g.term || '').trim();
    const where = { kind: 'glossary', id: g.id };
    if (!term) { out.push(P(SEVERITY.WARNING, 'A glossary line has no term.', where)); continue; }
    if (!String(g.meaning || '').trim()) out.push(P(SEVERITY.WARNING, `Glossary: «${term}» has no meaning written.`, where));
    const key = term.toUpperCase();
    if (seen.has(key)) out.push(P(SEVERITY.WARNING, `Glossary: «${term}» is explained twice.`, where));
    seen.add(key);
  }
}

/** Visits every value reference in the document. */
export function walkValueRefs(doc, cb) {
  const visitBlock = (b) => {
    if (!b) return;
    for (const p of b.parameters || []) if (p.value) cb(p.value);
    if (!b.expected) return;
    for (const k of ['min', 'max', 'nominal', 'tolerance']) if (b.expected[k]) cb(b.expected[k]);
    // A text criterion holds a value reference too: a variable read only there is used, and
    // leaving it out of this walk is what made it look like nobody wanted it.
    if (expectedKind(b.expected) === EXPECTED_KIND.STRING) cb(expectedTextRef(b.expected));
  };
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    if (s.wait && s.wait.value) cb(s.wait.value);
    visitBlock(s.stimulus); visitBlock(s.measurement);
    for (const row of ((s.table || {}).rows || [])) for (const cell of row.cells || []) {
      if (cell.value) cb(cell.value);
      if (cell.expected) visitBlock({ expected: cell.expected });
    }
  }
}
