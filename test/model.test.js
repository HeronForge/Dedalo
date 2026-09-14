import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyDocument, newStage, newTest, newStep, newVariable, newResource, newPoint, newVariant, newImage,
  newCommand, newInterface,
  newHeldStimulus, newParameter, constant, variableRef, STEP_TYPE, VARIABLE_TYPE, EXCLUSION_MODE,
} from '../src/model/schema.js';
import { getAt, setAt, addAt, removeAt, readablePath } from '../src/model/paths.js';
import { applyOverlay, resolveVariant, recordOverride, OP } from '../src/model/variants.js';
import { resolveValue, expectedText, numericLimits, variableIndex } from '../src/model/variables.js';
import { findCycles, parallelGroups, transitivePrerequisites, levels } from '../src/model/stages.js';
import { resourceSummary } from '../src/model/resources.js';
import { validateDocument, SEVERITY } from '../src/model/validate.js';
import { compare, diffCounts } from '../src/history/diff.js';
import { nextNumber } from '../src/history/revisions.js';
import { computeCodes, computeIndex, labelOf, codeNumber } from '../src/model/codes.js';
import { STAGE_KIND } from '../src/model/schema.js';
import { testStages, setupStages, runningStages, callMap } from '../src/model/stages.js';
import { consolidateRevision, successorOf } from '../src/history/revisions.js';
import { cloneEntity, indexAfter } from '../src/model/clone.js';
import { migrate, SCHEMA_VERSION, newSignatory } from '../src/model/schema.js';
import { varianceIndex, fieldVaries, pathVaries, presenceVaries, variableVaries, hasVariants, valuesByVariant, findEntity } from '../src/model/variance.js';

/** Small but complete document, used by almost every test. */
function sampleDocument() {
  const doc = emptyDocument();

  const vBatt = Object.assign(newVariable(), { name: 'Vbatt', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '12' });
  doc.variables = [vBatt];

  const supply = Object.assign(newResource(), { name: 'Power supply' });
  const dmm = Object.assign(newResource(), { name: 'Multimeter' });
  doc.resources = [supply, dmm];

  const p1 = Object.assign(newPoint(), { name: 'VBAT' });
  const p2 = Object.assign(newPoint(), { name: 'GND' });
  const p3 = Object.assign(newPoint(), { name: 'OUT' });
  doc.points = [p1, p2, p3];

  const stgA = Object.assign(newStage(), { name: 'A' });
  const tA = Object.assign(newTest(), { name: 'TA' });
  const sA = Object.assign(newStep(STEP_TYPE.STIMULUS), { description: 'Power up' });
  Object.assign(sA.stimulus, { description: 'Power up', pointIds: [p1.id, p2.id], resourceId: supply.id });
  tA.steps = [sA];
  stgA.tests = [tA];
  stgA.heldStimuli = [Object.assign(newHeldStimulus(), { stepId: sA.id })];

  const stgB = Object.assign(newStage(), { name: 'B' });
  stgB.prerequisites = [stgA.id];
  const tB = Object.assign(newTest(), { name: 'TB' });
  const sB = Object.assign(newStep(STEP_TYPE.MEASUREMENT), { description: 'Measure the output' });
  Object.assign(sB.measurement, { description: 'Voltage', pointIds: [p3.id], resourceId: dmm.id });
  sB.measurement.expected = { mode: 'minmax', min: constant('11'), max: variableRef(vBatt.id), nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: 'V' };
  tB.steps = [sB];
  stgB.tests = [tB];

  const stgC = Object.assign(newStage(), { name: 'C' });
  stgC.prerequisites = [stgA.id];
  const tC = Object.assign(newTest(), { name: 'TC' });
  const sC = Object.assign(newStep(STEP_TYPE.MEASUREMENT), { description: 'Another measurement' });
  Object.assign(sC.measurement, { description: 'Voltage', pointIds: [p3.id], resourceId: dmm.id });
  sC.measurement.expected = { mode: 'minmax', min: constant('0'), max: constant('1'), nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: 'V' };
  tC.steps = [sC];
  stgC.tests = [tC];

  doc.stages = [stgA, stgB, stgC];
  return { doc, vBatt, supply, dmm, p1, p2, p3, stgA, stgB, stgC, sA, sB, tB };
}

// ---- paths -------------------------------------------------------------------

test('paths reach elements through their id', () => {
  const { doc, stgB, tB, sB } = sampleDocument();
  const path = ['stages', '#' + stgB.id, 'tests', '#' + tB.id, 'steps', '#' + sB.id, 'description'];
  assert.equal(getAt(doc, path), 'Measure the output');
  assert.equal(setAt(doc, path, 'New description'), true);
  assert.equal(getAt(doc, path), 'New description');
});

test('adding and removing through a path', () => {
  const { doc, stgA } = sampleDocument();
  const t = Object.assign(newTest(), { name: 'New' });
  assert.equal(addAt(doc, ['stages', '#' + stgA.id, 'tests'], t), true);
  assert.equal(doc.stages[0].tests.length, 2);
  assert.equal(removeAt(doc, ['stages', '#' + stgA.id, 'tests', '#' + t.id]), true);
  assert.equal(doc.stages[0].tests.length, 1);
});

test('a dangling path throws nothing', () => {
  const { doc } = sampleDocument();
  assert.equal(getAt(doc, ['stages', '#missing', 'tests']), undefined);
  assert.equal(setAt(doc, ['stages', '#missing', 'name'], 'x'), false);
});

test('the readable path resolves ids into names', () => {
  const { doc, stgB, tB, sB } = sampleDocument();
  const shown = readablePath(doc, ['stages', '#' + stgB.id, 'tests', '#' + tB.id, 'steps', '#' + sB.id, 'measurement', 'expected', 'max']);
  assert.match(shown, /Stage «B»/);
  assert.match(shown, /Maximum$/);
});

// ---- variants ----------------------------------------------------------------

test('a variant can change, remove and add anything', () => {
  const { doc, stgC, vBatt, stgA } = sampleDocument();
  const variant = newVariant();
  const created = Object.assign(newStage(), { name: 'D' });
  variant.overlay = [
    { op: OP.SET, path: ['variables', '#' + vBatt.id, 'value'], value: '24' },
    { op: OP.REMOVE, path: ['stages', '#' + stgC.id] },
    { op: OP.ADD, path: ['stages'], value: created },
  ];
  doc.variants = [variant];

  const { doc: resolved, dropped } = applyOverlay(doc, variant);
  assert.equal(dropped.length, 0);
  assert.equal(resolved.variables[0].value, '24');
  assert.equal(resolved.stages.some((s) => s.id === stgC.id), false);
  assert.equal(resolved.stages.some((s) => s.name === 'D'), true);
  // the base document is untouched
  assert.equal(doc.variables[0].value, '12');
  assert.equal(doc.stages.length, 3);
  assert.equal(doc.stages[0].id, stgA.id);
});

test('operations that cannot be applied are dropped without stopping the others', () => {
  const { doc, vBatt } = sampleDocument();
  const variant = newVariant();
  variant.overlay = [
    { op: OP.SET, path: ['stages', '#missing', 'name'], value: 'X' },
    { op: OP.SET, path: ['variables', '#' + vBatt.id, 'value'], value: '9' },
  ];
  const { doc: resolved, dropped } = applyOverlay(doc, variant);
  assert.equal(dropped.length, 1);
  assert.equal(resolved.variables[0].value, '9');
});

test('recordOverride replaces the customisation on the same field', () => {
  const variant = newVariant();
  const path = ['variables', '#x', 'value'];
  recordOverride(variant, OP.SET, path, '1');
  recordOverride(variant, OP.SET, path, '2');
  assert.equal(variant.overlay.length, 1);
  assert.equal(variant.overlay[0].value, '2');
});

test('resolveVariant returns the base document when no variant is selected', () => {
  const { doc } = sampleDocument();
  assert.equal(resolveVariant(doc, '').doc, doc);
});

// ---- variables ---------------------------------------------------------------

test('value references are resolved', () => {
  const { doc, vBatt, sB } = sampleDocument();
  const index = variableIndex(doc);
  assert.equal(resolveValue(variableRef(vBatt.id), index).value, 12);
  assert.equal(resolveValue(constant('3.5'), index).value, 3.5);
  assert.equal(resolveValue(variableRef('missing'), index).missing, true);
  assert.match(expectedText(sB.measurement, index), /11 V … 12 V \(Vbatt\)/);
});

test('a percent tolerance yields the expected limits', () => {
  const index = new Map();
  const measurement = { expected: { mode: 'nominal', nominal: constant('10'), tolerance: constant('10'), toleranceType: 'percent', unit: 'V' } };
  const { min, max } = numericLimits(measurement, index);
  assert.equal(min, 9);
  assert.equal(max, 11);
});

// ---- stage graph -------------------------------------------------------------

test('cycles in the prerequisites are found', () => {
  const { doc, stgA, stgB } = sampleDocument();
  assert.equal(findCycles(doc).length, 0);
  doc.stages.find((s) => s.id === stgA.id).prerequisites = [stgB.id];
  assert.ok(findCycles(doc).length >= 1);
});

test('transitive prerequisites walk the whole chain', () => {
  const { doc, stgA, stgB, stgC } = sampleDocument();
  doc.stages.find((s) => s.id === stgC.id).prerequisites = [stgB.id];
  const t = transitivePrerequisites(doc);
  assert.deepEqual([...t.get(stgC.id)].sort(), [stgA.id, stgB.id].sort());
});

test('levels put the prerequisites before their dependents', () => {
  const { doc, stgA } = sampleDocument();
  const rows = levels(doc);
  assert.deepEqual(rows[0], [stgA.id]);
  assert.equal(rows[1].length, 2);
});

test('ordered or excluded stages are never parallel', () => {
  const { doc, stgB, stgC } = sampleDocument();
  const parallel = parallelGroups(doc).filter((g) => g.length > 1);
  assert.equal(parallel.length, 1);
  assert.deepEqual(parallel[0].sort(), [stgB.id, stgC.id].sort());

  doc.stages.find((s) => s.id === stgB.id).exclusions = { mode: EXCLUSION_MODE.LIST, stageIds: [stgC.id] };
  assert.equal(parallelGroups(doc).filter((g) => g.length > 1).length, 0);
});

// ---- resources ---------------------------------------------------------------

test('concurrent channels account for parallelism and held stimuli', () => {
  const { doc, supply, dmm, stgA, stgB } = sampleDocument();
  const { rows } = resourceSummary(doc);

  const dmmRow = rows.find((r) => r.resource.id === dmm.id);
  // B and C use one point each and may run together: two channels are needed.
  assert.equal(dmmRow.channelsPerStage.get(stgB.id), 1);
  assert.equal(dmmRow.maxChannels, 2);

  const supplyRow = rows.find((r) => r.resource.id === supply.id);
  // The stimulus of A is held: its two points stay occupied in B and in C.
  assert.equal(supplyRow.channelsPerStage.get(stgA.id), 2);
  assert.equal(supplyRow.channelsPerStage.get(stgB.id), 2);
  assert.equal(supplyRow.maxChannels, 4);
});

test('without held stimuli the channels do not propagate', () => {
  const { doc, supply, stgA } = sampleDocument();
  doc.stages.find((s) => s.id === stgA.id).heldStimuli = [];
  const { rows } = resourceSummary(doc);
  const supplyRow = rows.find((r) => r.resource.id === supply.id);
  assert.equal(supplyRow.maxChannels, 2);
});

// ---- validation --------------------------------------------------------------

const errorsOf = (doc) => validateDocument(doc).issues.filter((p) => p.severity === SEVERITY.ERROR);

test('the sample document has no errors', () => {
  const { doc } = sampleDocument();
  assert.deepEqual(errorsOf(doc).map((e) => e.message), []);
});

test('a reference to a deleted resource is reported', () => {
  const { doc, dmm } = sampleDocument();
  doc.resources = doc.resources.filter((r) => r.id !== dmm.id);
  assert.ok(errorsOf(doc).some((e) => /resource does not exist/.test(e.message)));
});

test('a recursive stage call is reported', () => {
  const { doc, stgA, stgB } = sampleDocument();
  const call = Object.assign(newStep(STEP_TYPE.STAGE_CALL), { description: 'call B', calledStageId: stgB.id });
  doc.stages.find((s) => s.id === stgA.id).tests[0].steps.push(call);
  const back = Object.assign(newStep(STEP_TYPE.STAGE_CALL), { description: 'call A', calledStageId: stgA.id });
  doc.stages.find((s) => s.id === stgB.id).tests[0].steps.push(back);
  assert.ok(errorsOf(doc).some((e) => /Recursive stage call/.test(e.message)));
});

test('a held stimulus outside the stage is reported', () => {
  const { doc, stgA, sB } = sampleDocument();
  doc.stages.find((s) => s.id === stgA.id).heldStimuli = [Object.assign(newHeldStimulus(), { stepId: sB.id })];
  assert.ok(errorsOf(doc).some((e) => /does not belong/.test(e.message)));
});

test('a lower limit above the upper one is reported', () => {
  const { doc, stgB } = sampleDocument();
  doc.stages.find((s) => s.id === stgB.id).tests[0].steps[0].measurement.expected.min = constant('99');
  assert.ok(errorsOf(doc).some((e) => /above the upper limit/.test(e.message)));
});

test('validation messages carry code and name of what they talk about', () => {
  const { doc, stgA } = sampleDocument();
  doc.stages.find((s) => s.id === stgA.id).tests = [];
  const issues = validateDocument(doc).issues.filter((i) => /contains no tests/.test(i.message));
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /STG-01 A/);
});

// ---- diff --------------------------------------------------------------------

test('the comparison finds changes, additions and removals', () => {
  const { doc, stgB, stgC } = sampleDocument();
  const after = JSON.parse(JSON.stringify(doc));
  after.stages.find((s) => s.id === stgB.id).name = 'B renamed';
  after.stages = after.stages.filter((s) => s.id !== stgC.id);
  after.stages.push(Object.assign(newStage(), { name: 'D' }));

  const differences = compare(doc, after);
  const c = diffCounts(differences);
  assert.equal(c.added, 1);
  assert.equal(c.removed, 1);
  assert.ok(c.changed >= 1);
  assert.ok(differences.some((d) => d.type === 'changed' && /Stage «B renamed»/.test(d.where) && d.before === 'B'));
});

test('a stage inserted in the middle of the sequence is one addition, not a move of everything after it', () => {
  const { doc, stgA } = sampleDocument();
  const after = JSON.parse(JSON.stringify(doc));
  const at = after.stages.findIndex((s) => s.id === stgA.id) + 1;
  after.stages.splice(at, 0, Object.assign(newStage(), { name: 'Inserted' }));

  const c = diffCounts(compare(doc, after));
  assert.equal(c.added, 1);
  assert.equal(c.moved, 0);
});

test('a stage taken to the end of the sequence is the one element reported as moved', () => {
  const { doc, stgA } = sampleDocument();
  const after = JSON.parse(JSON.stringify(doc));
  const first = after.stages.find((s) => s.id === stgA.id);
  after.stages = [...after.stages.filter((s) => s.id !== stgA.id), first];

  const differences = compare(doc, after);
  const moved = differences.filter((d) => d.type === 'moved');
  assert.equal(moved.length, 1);
  assert.match(moved[0].where, /Stage «A»/);
  assert.equal(moved[0].before, 'position 1');
});

test('identical documents produce no differences', () => {
  const { doc } = sampleDocument();
  assert.equal(compare(doc, JSON.parse(JSON.stringify(doc))).length, 0);
});

test('revision numbering keeps the format', () => {
  assert.equal(nextNumber('00'), '01');
  assert.equal(nextNumber('09'), '10');
  assert.equal(nextNumber('A1'), 'A2');
  assert.equal(nextNumber(''), '01');
});

// ---- codes and labels --------------------------------------------------------

test('codes follow the position in the document', () => {
  const { doc, stgA, stgB, p1 } = sampleDocument();
  const codes = computeCodes(doc);
  assert.equal(codes.get(stgA.id), 'STG-01');
  assert.equal(codes.get(stgB.id), 'STG-02');
  assert.equal(codes.get(p1.id), 'AP-01');
  assert.equal(codes.get(doc.stages[0].tests[0].id), 'T-01.01');
  assert.equal(codes.get(doc.stages[0].tests[0].steps[0].id), 'T-01.01.01');
});

test('a label carries the code and the name of what it points at', () => {
  const { doc, p1, stgA } = sampleDocument();
  const codes = computeCodes(doc);
  const index = computeIndex(doc);
  assert.equal(labelOf(codes, index, p1.id), 'AP-01 VBAT');
  assert.equal(labelOf(codes, index, stgA.id), 'STG-01 A');
  assert.equal(labelOf(codes, index, 'nope'), '⟨missing⟩');
});

test('long names in a label are truncated, the code is not', () => {
  const { doc, p1 } = sampleDocument();
  doc.points[0].name = 'A very long application point name that would not fit';
  const codes = computeCodes(doc);
  const index = computeIndex(doc);
  const label = labelOf(codes, index, p1.id, 20);
  assert.ok(label.startsWith('AP-01 '));
  assert.ok(label.length <= 'AP-01 '.length + 20);
  assert.ok(label.endsWith('…'));
});

// ---- setup stages ------------------------------------------------------------

/** The sample document plus a setup stage called by the first test stage. */
function documentWithSetup() {
  const base = sampleDocument();
  const { doc, supply, p1, p2, stgA, stgB } = base;

  const setup = Object.assign(newStage(STAGE_KIND.SETUP), { name: 'Power up' });
  const setupTest = Object.assign(newTest(), { name: 'Supply' });
  const setupStep = Object.assign(newStep(STEP_TYPE.STIMULUS), { description: 'Apply the supply' });
  Object.assign(setupStep.stimulus, { description: 'Apply the supply', pointIds: [p1.id, p2.id], resourceId: supply.id });
  setupTest.steps = [setupStep];
  setup.tests = [setupTest];
  setup.heldStimuli = [Object.assign(newHeldStimulus(), { stepId: setupStep.id })];
  doc.stages.push(setup);

  // The first test stage now calls the setup stage instead of powering up itself.
  const stage = doc.stages.find((s) => s.id === stgA.id);
  const call = Object.assign(newStep(STEP_TYPE.STAGE_CALL), { description: 'Power up', calledStageId: setup.id });
  stage.tests[0].steps = [call];
  stage.heldStimuli = [];

  return { ...base, setup, setupStep, stage, stgB };
}

// ---- what varies from one variant to the next --------------------------------

/** A base document with one variant that changes a value, a parameter and a whole stage. */
function documentWithVariant() {
  const { doc, vBatt, stgA, stgB, sA } = sampleDocument();
  const parameter = Object.assign(newParameter(), { name: 'Voltage', value: constant('12') });
  sA.stimulus.parameters = [parameter];

  const variant = Object.assign(newVariant(), { name: '24 V version' });
  variant.overlay = [
    { op: OP.SET, path: ['variables', '#' + vBatt.id, 'value'], value: '24' },
    { op: OP.SET,
      path: ['stages', '#' + stgA.id, 'tests', '#' + stgA.tests[0].id, 'steps', '#' + sA.id,
        'stimulus', 'parameters', '#' + parameter.id, 'value'],
      value: constant('24') },
    { op: OP.REMOVE, path: ['stages', '#' + stgB.id] },
  ];
  doc.variants = [variant];
  return { doc, variable: vBatt, stage: stgA, absent: stgB, step: sA, parameter };
}

test('a value a variant redefines is known to vary, and says which variant', () => {
  const { doc, variable } = documentWithVariant();
  const index = varianceIndex(doc);
  assert.deepEqual(variableVaries(index, variable.id), ['24 V version']);
  assert.deepEqual(variableVaries(index, 'var_nothing'), []);
  assert.ok(hasVariants(index));
});

test('a change written deep inside a step is reported for the step as well as for the parameter', () => {
  const { doc, step, parameter } = documentWithVariant();
  const index = varianceIndex(doc);
  // The parameter is what changed, and the step is what the reader is looking at.
  assert.deepEqual(fieldVaries(index, parameter.id, 'value'), ['24 V version']);
  assert.deepEqual(fieldVaries(index, step.id, 'stimulus'), ['24 V version']);
  // What the variant leaves alone stays unmarked, or every page would be marked.
  assert.deepEqual(fieldVaries(index, step.id, 'measurement'), []);
  assert.deepEqual(fieldVaries(index, step.id, 'description'), []);
});

test('a stage a variant does not run depends on the variant, and says so', () => {
  const { doc, stage, absent } = documentWithVariant();
  const index = varianceIndex(doc);
  assert.deepEqual(presenceVaries(index, absent.id), { added: [], removed: ['24 V version'] });
  assert.deepEqual(presenceVaries(index, stage.id), { added: [], removed: [] });
});

test('the editor asks the same question with a path', () => {
  const { doc, variable, step, parameter } = documentWithVariant();
  const index = varianceIndex(doc);
  assert.deepEqual(pathVaries(index, ['variables', '#' + variable.id, 'value']), ['24 V version']);
  assert.deepEqual(pathVaries(index, ['variables', '#' + variable.id, 'unit']), []);
  assert.deepEqual(
    pathVaries(index, ['stages', '#x', 'tests', '#y', 'steps', '#' + step.id, 'stimulus', 'parameters', '#' + parameter.id, 'value']),
    ['24 V version']);
});

test('the values of a marked text are listed version by version, base first, as the page prints them', () => {
  const { doc, variable, parameter, absent } = documentWithVariant();
  assert.deepEqual(valuesByVariant(doc, variable.id, 'value'), [
    { name: 'Base document', isBase: true, present: true, value: '12 V' },
    { name: '24 V version', isBase: false, present: true, value: '24 V' },
  ]);
  // A parameter three levels inside a step is found all the same.
  assert.deepEqual(valuesByVariant(doc, parameter.id, 'value').map((r) => r.value), ['12', '24']);
  // A stage the variant does not run has no value there, and the table says so.
  const rows = valuesByVariant(doc, absent.id, '');
  assert.equal(rows[0].present, true);
  assert.equal(rows[1].present, false);
});

test('an entity is found wherever it sits in the document', () => {
  const { doc, parameter, step } = documentWithVariant();
  assert.equal(findEntity(doc, parameter.id), parameter);
  assert.equal(findEntity(doc, step.id), step);
  assert.equal(findEntity(doc, 'par_nowhere'), null);
});

test('a document with no variants marks nothing at all', () => {
  const index = varianceIndex(sampleDocument().doc);
  assert.equal(hasVariants(index), false);
  assert.deepEqual(fieldVaries(index, 'anything', 'name'), []);
  assert.deepEqual(presenceVaries(index, 'anything'), { added: [], removed: [] });
});

// ---- duplicating ------------------------------------------------------------

test('a duplicate carries new identifiers all the way down', () => {
  const stage = Object.assign(newStage(), { name: 'Power up' });
  const t = Object.assign(newTest(), { name: 'Supply' });
  const step = Object.assign(newStep(STEP_TYPE.STIMULUS), { description: 'Apply 12 V' });
  t.steps = [step];
  stage.tests = [t];

  const copy = cloneEntity(stage);
  assert.notEqual(copy.id, stage.id);
  assert.notEqual(copy.tests[0].id, t.id);
  assert.notEqual(copy.tests[0].steps[0].id, step.id);
  // The prefix says what the id is: a copied step is still a step.
  assert.ok(copy.tests[0].steps[0].id.startsWith('stp_'));
  assert.equal(copy.tests[0].steps[0].description, 'Apply 12 V');
});

test('a duplicate keeps what it points at outside itself and follows what is inside it', () => {
  const stage = Object.assign(newStage(), { name: 'Power up', prerequisites: ['stg_others'] });
  const t = newTest();
  const step = Object.assign(newStep(STEP_TYPE.STIMULUS), { description: 'Apply 12 V' });
  step.stimulus.pointIds = ['pt_abcdef'];
  step.stimulus.resourceId = 'res_abcdef';
  t.steps = [step];
  stage.tests = [t];
  stage.heldStimuli = [Object.assign(newHeldStimulus(), { stepId: step.id })];

  const copy = cloneEntity(stage);
  // Outwards: the resource, the points and the stage that must come first were not copied.
  assert.deepEqual(copy.tests[0].steps[0].stimulus.pointIds, ['pt_abcdef']);
  assert.equal(copy.tests[0].steps[0].stimulus.resourceId, 'res_abcdef');
  assert.deepEqual(copy.prerequisites, ['stg_others']);
  // Inwards: the held stimulus names the step of the copy, not the one of the original.
  assert.equal(copy.heldStimuli[0].stepId, copy.tests[0].steps[0].id);
  assert.notEqual(copy.heldStimuli[0].stepId, step.id);
});

test('a duplicated variant customises its own elements, not the ones it was copied from', () => {
  const variant = newVariant();
  const added = Object.assign(newStage(), { name: 'Extra' });
  variant.overlay = [
    { op: OP.ADD, path: ['stages'], value: added },
    { op: OP.SET, path: ['stages', '#' + added.id, 'name'], value: 'Extra, renamed' },
  ];

  const copy = cloneEntity(variant, { suffix: '(copy)' });
  const copiedStage = copy.overlay[0].value;
  assert.notEqual(copiedStage.id, added.id);
  assert.deepEqual(copy.overlay[1].path, ['stages', '#' + copiedStage.id, 'name']);
  // The paths that name the base document are left exactly as they were.
  assert.deepEqual(copy.overlay[0].path, ['stages']);
});

test('the copy is named so the two are told apart, and it goes right after the original', () => {
  const resource = Object.assign(newResource(), { name: 'Power supply' });
  const nameless = newResource();
  assert.equal(cloneEntity(resource, { suffix: '(copy)' }).name, 'Power supply (copy)');
  assert.equal(cloneEntity(nameless, { suffix: '(copy)' }).name, '(copy)');

  const list = [newResource(), resource, newResource()];
  assert.equal(indexAfter(list, resource.id), 2);
  assert.equal(indexAfter(list, 'res_missing'), undefined);
});

test('setup stages stay out of the sequence', () => {
  const { doc, setup } = documentWithSetup();
  assert.equal(testStages(doc).length, 3);
  assert.deepEqual(setupStages(doc).map((s) => s.id), [setup.id]);
  assert.equal(levels(doc).flat().includes(setup.id), false);
  assert.equal(parallelGroups(doc).flat().includes(setup.id), false);
});

test('a setup stage runs inside the test stages that call it', () => {
  const { doc, setup, stgA } = documentWithSetup();
  assert.deepEqual([...runningStages(doc).get(setup.id)], [stgA.id]);
  assert.deepEqual(callMap(doc).get(setup.id).map((c) => c.stageId), [stgA.id]);
});

test('what a setup stage uses is charged to its caller, held stimuli included', () => {
  const { doc, supply, stgA, stgB, setup } = documentWithSetup();
  const { rows } = resourceSummary(doc);
  const supplyRow = rows.find((r) => r.resource.id === supply.id);
  // Two points, charged to the calling test stage and not to the setup stage itself.
  assert.equal(supplyRow.channelsPerStage.get(stgA.id), 2);
  assert.equal(supplyRow.channelsPerStage.has(setup.id), false);
  // The stimulus is held on exit, so it still occupies the bench during the next stage.
  assert.equal(supplyRow.channelsPerStage.get(stgB.id), 2);
});

test('the resource row lists the application points, not the stages', () => {
  const { doc, supply, p1, p2 } = documentWithSetup();
  const { rows } = resourceSummary(doc);
  const supplyRow = rows.find((r) => r.resource.id === supply.id);
  assert.deepEqual(supplyRow.points, [p1.id, p2.id]);
  assert.equal(supplyRow.usesWithoutPoint, 0);
});

test('a setup stage nobody calls is reported, and so is a called test stage', () => {
  const { doc, setup, stgA, stage } = documentWithSetup();
  assert.equal(validateDocument(doc).issues.some((i) => /never called/.test(i.message)), false);

  // Nobody calls it any more.
  stage.tests[0].steps = [];
  assert.ok(validateDocument(doc).issues.some((i) => /never called/.test(i.message)));

  // A test stage on the receiving end of a call should have been marked as setup.
  const caller = doc.stages.find((s) => s.id !== stgA.id && s.kind !== STAGE_KIND.SETUP);
  caller.tests[0].steps.push(Object.assign(newStep(STEP_TYPE.STAGE_CALL), { description: 'call A', calledStageId: stgA.id }));
  assert.ok(validateDocument(doc).issues.some((i) => /should be marked as a setup stage/.test(i.message)));
});

test('setup stages are numbered apart from the sequence', () => {
  const { doc, setup, stgA } = documentWithSetup();
  const codes = computeCodes(doc);
  assert.equal(codes.get(stgA.id), 'STG-01');
  assert.equal(codes.get(setup.id), 'SET-01');
  assert.equal(codes.get(setup.tests[0].id), 'S-01.01');
  assert.equal(codes.get(setup.tests[0].steps[0].id), 'S-01.01.01');
});

test('only the number of a code goes on the image', () => {
  assert.equal(codeNumber('AP-03'), '03');
  assert.equal(codeNumber('SET-01'), '01');
  assert.equal(codeNumber(''), '');
});

// ---- consolidating revisions -------------------------------------------------

test('merging a revision forward drops it and carries its reason over', () => {
  const doc = emptyDocument();
  doc.revision = { number: '02', date: '2026-03-03', author: 'M', reason: 'draft work', status: 'draft' };
  const history = {
    revisions: [
      { number: '00', date: '2026-01-01', author: 'M', reason: 'first issue', status: 'issued', snapshot: { encoding: 'text', data: '' } },
      { number: '01', date: '2026-02-02', author: 'M', reason: 'typo fixes', status: 'issued', snapshot: { encoding: 'text', data: '' } },
    ],
  };

  assert.deepEqual(successorOf(doc, history, '00'), { number: '01', isDraft: false });

  const merged = consolidateRevision(doc, history, '00');
  assert.deepEqual(merged.history.revisions.map((r) => r.number), ['01']);
  assert.equal(merged.history.revisions[0].reason, 'first issue; typo fixes');
  assert.equal(merged.mergedInto, '01');
  // The original history is untouched.
  assert.equal(history.revisions.length, 2);
});

test('merging the last issued revision moves its reason into the draft', () => {
  const doc = emptyDocument();
  doc.revision = { number: '01', date: '2026-02-02', author: 'M', reason: 'work in progress', status: 'draft' };
  const history = {
    revisions: [{ number: '00', date: '2026-01-01', author: 'M', reason: 'first issue', status: 'issued', snapshot: { encoding: 'text', data: '' } }],
  };

  assert.deepEqual(successorOf(doc, history, '00'), { number: '01', isDraft: true });

  const merged = consolidateRevision(doc, history, '00');
  assert.equal(merged.history.revisions.length, 0);
  assert.equal(merged.doc.revision.reason, 'first issue; work in progress');
});

// ---- what goes on the picture ------------------------------------------------

test('a test point is marked with its own TP name, everything else with its number', async () => {
  const { markerLabel } = await import('../src/model/codes.js');
  assert.equal(markerLabel({ connector: 'TP12' }, 'AP-03'), 'TP12');
  assert.equal(markerLabel({ connector: 'TP-7' }, 'AP-03'), 'TP7');
  assert.equal(markerLabel({ connector: 'tp 5' }, 'AP-03'), 'TP5');
  // A plain connector, or none at all: the number of the point code.
  assert.equal(markerLabel({ connector: 'J1' }, 'AP-03'), '03');
  assert.equal(markerLabel({ connector: '' }, 'AP-11'), '11');
  assert.equal(markerLabel({}, 'AP-11'), '11');
  // «TP» without a number is not a test point name.
  assert.equal(markerLabel({ connector: 'TPX' }, 'AP-04'), '04');
});

// ---- the version of this build -----------------------------------------------

test('the changelog is led by the version this build declares', async () => {
  const { APP_VERSION, CHANGELOG, compareVersions } = await import('../src/version.js');
  assert.equal(CHANGELOG[0].version, APP_VERSION);
  // Newest first, and no duplicates.
  for (let i = 1; i < CHANGELOG.length; i++) {
    assert.equal(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version), 1,
      `${CHANGELOG[i - 1].version} should come after ${CHANGELOG[i].version}`);
  }
  for (const entry of CHANGELOG) {
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(entry.changes.length, `release ${entry.version} lists no change`);
    for (const line of entry.changes) assert.ok(line.length > 15 && line.endsWith('.'), `«${line}» is not a sentence`);
  }
});

test('versions are compared as numbers, not as strings', async () => {
  const { compareVersions } = await import('../src/version.js');
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('the formats this build declares are the ones it writes', async () => {
  const { FORMATS } = await import('../src/version.js');
  const { formatTag } = await import('../src/io/format.js');
  for (const [kind, spec] of Object.entries(FORMATS)) {
    assert.ok(spec.reads.includes(spec.writes), `${kind}: it writes a version it cannot read`);
    assert.equal(formatTag(kind), `${spec.id}/${spec.writes}`);
  }
});

// ---- the area a marker points at ---------------------------------------------

test('the zoom area is centred on the marker and stays inside the picture', async () => {
  const { markerRegion } = await import('../src/ui/figure.js');
  const middle = markerRegion({ x: 0.5, y: 0.5 }, 0.2);
  assert.deepEqual([middle.x0.toFixed(2), middle.y0.toFixed(2)], ['0.40', '0.40']);

  // A point near the edge cannot centre the crop: the crop slides back inside the picture.
  const corner = markerRegion({ x: 0.02, y: 0.99 }, 0.3);
  assert.equal(corner.x0, 0);
  assert.equal(Number(corner.y0.toFixed(2)), 0.7);

  // The whole picture is a legitimate area, and nothing may exceed it.
  const all = markerRegion({ x: 0.5, y: 0.5 }, 1);
  assert.deepEqual([all.x0, all.y0, all.f], [0, 0, 1]);
  assert.equal(markerRegion({ x: 0.5, y: 0.5 }, 4).f, 1);
});

test('markers written before the area existed still have one', async () => {
  const { markerArea, newMarker, DEFAULT_MARKER_AREA } = await import('../src/model/schema.js');
  assert.equal(markerArea({ x: 0.1, y: 0.1 }), DEFAULT_MARKER_AREA);
  assert.equal(markerArea({ area: 0 }), DEFAULT_MARKER_AREA);
  assert.equal(markerArea({ area: 0.15 }), 0.15);
  assert.equal(newMarker('img_1', 0.2, 0.3).area, DEFAULT_MARKER_AREA);
});

test('the licence this build declares is complete', async () => {
  const { LICENSE, AUTHOR } = await import('../src/version.js');
  assert.equal(LICENSE.id, 'MIT');
  assert.match(LICENSE.copyright, /D\. Tracchi/);
  assert.equal(AUTHOR.name, 'D. Tracchi');
  assert.match(AUTHOR.assistedBy, /Claude/);
});

// ---- the picture pool ---------------------------------------------------------

test('formats are named the way people name them', async () => {
  const { formatLabel } = await import('../src/io/images.js');
  assert.equal(formatLabel('image/webp'), 'WebP');
  assert.equal(formatLabel('image/svg+xml'), 'SVG');
  assert.equal(formatLabel('image/jpeg'), 'JPEG');
  assert.equal(formatLabel('image/avif'), 'AVIF'); // one this build does not write, still named
  assert.equal(formatLabel(''), '—');
});

test('the weight of an image is the weight of its bytes, not of its base64', async () => {
  const { base64Bytes, assetsWeight } = await import('../src/io/images.js');
  assert.equal(base64Bytes('AAAA'), 3);
  assert.equal(base64Bytes(''), 0);
  assert.equal(assetsWeight({ a: { data: 'AAAA' }, b: { data: 'AAAAAAAA' } }), 9);
});

test('a picture cannot enter the pool without its id', async () => {
  const { createStore } = await import('../src/model/store.js');
  const store = createStore({ doc: emptyDocument(), history: { revisions: [] }, assets: {} });
  assert.throws(() => store.registerAsset({ mime: 'image/webp', data: 'AAAA' }), /without its id/);
  store.registerAsset({ id: 'abc', mime: 'image/webp', data: 'AAAA', sourceBytes: 900 });
  assert.equal(store.state.assets.abc.mime, 'image/webp');
  // What the original weighed is kept, so the saving stays visible after reopening.
  assert.equal(store.state.assets.abc.sourceBytes, 900);
});

// ---- following a reference into the editor ------------------------------------

test('a reference knows where its entity is edited', async () => {
  const { editTarget, directEditingAllowed } = await import('../src/ui/navigate.js');
  const doc = emptyDocument();
  const point = newPoint();
  const image = newImage('asset1', 'Board');
  const stage = newStage();
  const test1 = newTest();
  const step = newStep();
  test1.steps = [step];
  stage.tests = [test1];
  doc.points = [point];
  doc.images = [image];
  doc.stages = [stage];

  assert.deepEqual(editTarget(doc, point.id), { section: 'points', selection: { section: 'points', id: point.id } });
  assert.deepEqual(editTarget(doc, image.id), { section: 'images', selection: { section: 'images', id: image.id } });
  assert.equal(editTarget(doc, stage.id).section, 'stages');
  // A step is reached through its stage, which the tree has to open.
  const target = editTarget(doc, step.id);
  assert.equal(target.selection.kind, 'step');
  assert.equal(target.stageId, stage.id);
  assert.equal(editTarget(doc, 'nothing_here'), null);

  assert.equal(directEditingAllowed(doc), true);
  doc.settings.noDirectEditing = true;
  assert.equal(directEditingAllowed(doc), false);
});

test('a document written before the setting existed allows direct editing', async () => {
  const { migrate } = await import('../src/model/schema.js');
  const { directEditingAllowed } = await import('../src/ui/navigate.js');
  const old = migrate({ header: { title: 'Old' }, stages: [] });
  assert.deepEqual(old.settings, { noDirectEditing: false, chapterOrder: [] });
  assert.equal(directEditingAllowed(old), true);
  // And the setting survives a document that carries it.
  assert.equal(migrate({ settings: { noDirectEditing: true } }).settings.noDirectEditing, true);
});

// ---- comparison operators -----------------------------------------------------

test('a criterion with no comparison keeps the meaning it always had', async () => {
  const { comparisonOf } = await import('../src/model/schema.js');
  const { expectedText } = await import('../src/model/variables.js');
  const index = new Map();
  const limits = (min, max) => ({ expected: { mode: 'minmax', min: constant(min), max: constant(max), unit: 'V' } });

  assert.equal(comparisonOf(limits('11', '14').expected), 'GELE');
  assert.equal(comparisonOf(limits('11', '').expected), 'GE');
  assert.equal(comparisonOf(limits('', '14').expected), 'LE');
  assert.equal(expectedText(limits('11', '14'), index), '11 V … 14 V');
  assert.equal(expectedText(limits('11', ''), index), '≥ 11 V');
  assert.equal(expectedText(limits('', '14'), index), '≤ 14 V');
});

test('each operator prints the shortest text that is still exact', async () => {
  const { expectedText } = await import('../src/model/variables.js');
  const index = new Map();
  const withCode = (comparison, min, max) => ({ expected: { mode: 'minmax', comparison, min: constant(min), max: constant(max), unit: 'V' } });

  assert.equal(expectedText(withCode('GT', '12', ''), index), '> 12 V');
  assert.equal(expectedText(withCode('LT', '', '0.5'), index), '< 0.5 V');
  assert.equal(expectedText(withCode('EQ', '5', ''), index), '= 5 V');
  assert.equal(expectedText(withCode('NE', '0', ''), index), '≠ 0 V');
  assert.equal(expectedText(withCode('GELE', '11', '14'), index), '11 V … 14 V');
  assert.equal(expectedText(withCode('GTLE', '11', '14'), index), '>11 V … 14 V');
  assert.equal(expectedText(withCode('GELT', '11', '14'), index), '11 V … <14 V');
  assert.equal(expectedText(withCode('GTLT', '11', '14'), index), '>11 V … <14 V');
  // The nominal form is untouched by any of this.
  assert.equal(expectedText({ expected: { mode: 'nominal', nominal: constant('13.5'), tolerance: constant('5'), toleranceType: 'percent', unit: 'V' } }, index), '13.5 V ± 5 %');
});

test('a one sided comparison bounds one side only', async () => {
  const { numericLimits } = await import('../src/model/variables.js');
  const index = new Map();
  const m = (comparison, min, max) => ({ expected: { mode: 'minmax', comparison, min: constant(min), max: constant(max) } });

  assert.deepEqual(numericLimits(m('LE', '', '5'), index), { min: null, max: 5 });
  assert.deepEqual(numericLimits(m('GE', '2', ''), index), { min: 2, max: null });
  assert.deepEqual(numericLimits(m('EQ', '7', ''), index), { min: 7, max: 7 });
  assert.deepEqual(numericLimits(m('NE', '7', ''), index), { min: null, max: null });
  // A value stranded in the field the comparison ignores is not a limit.
  assert.deepEqual(numericLimits(m('GT', '2', '99'), index), { min: 2, max: null });
});

test('the validator watches the shape of the comparison', async () => {
  const doc = emptyDocument();
  const stage = newStage();
  const t = newTest();
  const step = newStep();
  step.type = STEP_TYPE.MEASUREMENT;
  step.measurement = { description: 'V out', pointIds: [], parameters: [], expected: { mode: 'minmax', comparison: 'GTLT', min: constant('1'), max: constant('') } };
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];

  const both = validateDocument(doc).issues.map((p) => p.message).join(' ');
  assert.match(both, /needs both limits/);

  step.measurement.expected = { mode: 'minmax', comparison: 'GT', min: constant('1'), max: constant('9') };
  const stranded = validateDocument(doc).issues.map((p) => p.message).join(' ');
  assert.match(stranded, /still holds a value that is ignored/);
});

test('the comparison types are the ones TestStand names, with its codes', async () => {
  const { COMPARISON, comparisonOf } = await import('../src/model/schema.js');
  const expected = ['EQ', 'GELE', 'EQT', 'NE', 'GT', 'LT', 'GE', 'LE', 'GTLT', 'GELT', 'GTLE', 'LTGT', 'LEGE', 'LEGT', 'LTGE', 'NONE'];
  assert.deepEqual(Object.keys(COMPARISON), expected);
  assert.equal(COMPARISON.GELE.code, '>=<=');
  assert.equal(COMPARISON.LTGE.code, '<>=');
  // The code this build used before the names were corrected still reads.
  assert.equal(comparisonOf({ mode: 'minmax', comparison: 'GELI', min: constant('1'), max: constant('2') }), 'GELE');
});

test('the criteria that pass outside their limits say so', async () => {
  const { expectedText, numericLimits } = await import('../src/model/variables.js');
  const index = new Map();
  const m = (comparison) => ({ expected: { mode: 'minmax', comparison, min: constant('2'), max: constant('10'), unit: 'V' } });

  assert.equal(expectedText(m('LTGT'), index), '< 2 V or > 10 V');
  assert.equal(expectedText(m('LEGE'), index), '≤ 2 V or ≥ 10 V');
  assert.equal(expectedText(m('LEGT'), index), '≤ 2 V or > 10 V');
  assert.equal(expectedText(m('LTGE'), index), '< 2 V or ≥ 10 V');
  // Outside is not an interval: it must not be read as one.
  assert.deepEqual(numericLimits(m('LTGT'), index), { min: null, max: null });
});

test('a measurement with no comparison is recorded, not judged', async () => {
  const { expectedText, numericLimits } = await import('../src/model/variables.js');
  const index = new Map();
  const m = { expected: { mode: 'minmax', comparison: 'NONE', min: constant(''), max: constant(''), unit: 'V' } };
  assert.equal(expectedText(m, index), 'recorded, no pass/fail');
  assert.deepEqual(numericLimits(m, index), { min: null, max: null });

  const doc = emptyDocument();
  const stage = newStage();
  const t = newTest();
  const step = newStep();
  step.type = STEP_TYPE.MEASUREMENT;
  step.measurement = { description: 'Trace', pointIds: [], parameters: [], expected: m.expected };
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];
  // Having no criterion is the point of this type: it must not be reported as an omission.
  const messages = validateDocument(doc).issues.map((i) => i.message).join(' ');
  assert.ok(!/no acceptance criterion/.test(messages), messages);
});

// ---- cycle time ---------------------------------------------------------------

const timedDoc = () => {
  const doc = emptyDocument();
  const supply = newResource();
  supply.name = 'Supply';
  supply.averageTime = '1.5';
  doc.resources = [supply];

  const command = newCommand();
  command.name = 'Read';
  command.nominalTime = '0.5';
  doc.commands = [command];

  const make = (name, wait) => {
    const stage = newStage();
    stage.name = name;
    const t = newTest();
    const step = newStep();
    step.type = STEP_TYPE.STIMULUS_MEASUREMENT;
    step.wait = { value: constant(wait), unit: 's' };
    step.stimulus = { description: 'apply', pointIds: [], parameters: [], resourceId: supply.id, commandId: '' };
    step.measurement = { description: 'read', pointIds: [], parameters: [], commandId: command.id, expected: { mode: 'minmax', min: constant('1'), max: constant('2') } };
    t.steps = [step];
    stage.tests = [t];
    return stage;
  };
  doc.stages = [make('A', '1'), make('B', '3')];
  return doc;
};

test('a step costs its wait, its command and the instrument it holds', async () => {
  const { estimateCycleTime, formatSeconds } = await import('../src/model/cycletime.js');
  const doc = timedDoc();
  const est = estimateCycleTime(doc);
  // A: 1 s wait + 0.5 s command + 1.5 s instrument = 3 s; B: 3 + 0.5 + 1.5 = 5 s.
  assert.equal(est.stages[0].total, 3);
  assert.equal(est.stages[1].total, 5);
  assert.equal(est.serial, 8);
  // Nothing orders the two stages, so they may run together: the longest one is the cost.
  assert.equal(est.parallel, 5);
  assert.equal(formatSeconds(est.serial), '8 s');
  assert.equal(formatSeconds(3725), '1 h 2 min 5 s');
});

test('a prerequisite forbids the saving, and the estimate says so', async () => {
  const { estimateCycleTime } = await import('../src/model/cycletime.js');
  const doc = timedDoc();
  doc.stages[1].prerequisites = [doc.stages[0].id];
  const est = estimateCycleTime(doc);
  assert.equal(est.serial, 8);
  assert.equal(est.parallel, 8); // one after the other, nothing to gain
});

test('what the estimate does not know is listed rather than assumed', async () => {
  const { estimateCycleTime } = await import('../src/model/cycletime.js');
  const doc = timedDoc();
  doc.resources[0].averageTime = '';
  const est = estimateCycleTime(doc);
  assert.equal(est.missing.resources.length, 1);
  assert.equal(est.missing.commands.length, 0);
  assert.equal(est.stages[0].total, 1.5); // the instrument counts as zero, not as a guess
});

test('a step that speaks through a command occupies the points of its interface', async () => {
  const { collectUses } = await import('../src/model/resources.js');
  const doc = timedDoc();
  const point = newPoint();
  point.name = 'CAN bus';
  doc.points = [point];
  const itf = newInterface();
  itf.name = 'Vehicle CAN';
  itf.pointIds = [point.id];
  itf.resourceId = doc.resources[0].id;
  doc.interfaces = [itf];
  doc.commands[0].interfaceId = itf.id;

  const uses = collectUses(doc);
  const measurement = uses.find((u) => u.kind === 'measurement');
  // The measurement names no point of its own: the bus contact is still needed.
  assert.deepEqual(measurement.pointIds, [point.id]);
  assert.equal(measurement.resourceId, doc.resources[0].id);
});

test('when nothing may run in parallel the estimate names what forbids it', async () => {
  const { estimateCycleTime } = await import('../src/model/cycletime.js');
  const doc = timedDoc();
  // The two stages are free to run together until one of them says otherwise.
  assert.ok(estimateCycleTime(doc).parallel < estimateCycleTime(doc).serial);

  doc.stages[1].exclusions = { mode: EXCLUSION_MODE.ALL, stageIds: [] };
  const blocked = estimateCycleTime(doc);
  assert.equal(blocked.parallel, blocked.serial);
  assert.equal(blocked.blockers.length, 1);
  assert.equal(blocked.blockers[0].mode, EXCLUSION_MODE.ALL);
  assert.equal(blocked.everySlotAlone, true);
});

test('the differences of a version are grouped under the entity that carries them', async () => {
  const { changedIds } = await import('../src/ui/sections/document.js');
  const { compare } = await import('../src/history/diff.js');
  const before = emptyDocument();
  const stage = newStage();
  stage.name = 'Power up';
  const t = newTest();
  const step = newStep();
  step.description = 'Apply the voltage';
  t.steps = [step];
  stage.tests = [t];
  before.stages = [stage];

  const after = JSON.parse(JSON.stringify(before));
  after.stages[0].tests[0].steps[0].description = 'Apply the nominal voltage';
  after.stages[0].tests[0].steps[0].note = 'measured at the connector';

  const { ids, count } = changedIds(compare(before, after));
  assert.equal(count, 2);
  const entry = ids.get(step.id);
  assert.equal(entry.list.length, 2); // both edits belong to the same step
  assert.equal(entry.type, 'changed');
});

// ---- the instrument behind a command ------------------------------------------

const commandDoc = () => {
  const doc = emptyDocument();
  const bench = newResource();
  bench.name = 'Bench CAN interface';
  bench.averageTime = '0.3';
  const meter = newResource();
  meter.name = 'Multimeter';
  meter.averageTime = '0.8';
  doc.resources = [bench, meter];

  const itf = newInterface();
  itf.name = 'Vehicle CAN';
  itf.resourceId = bench.id;
  doc.interfaces = [itf];

  const command = newCommand();
  command.name = 'Read voltage';
  command.interfaceId = itf.id;
  command.nominalTime = '0.5';
  doc.commands = [command];

  const stage = newStage();
  const t = newTest();
  const step = newStep();
  step.type = STEP_TYPE.MEASUREMENT;
  step.measurement = { description: 'read', pointIds: [], parameters: [], commandId: command.id, resourceId: '', expected: { mode: 'minmax', min: constant('1'), max: constant('2') } };
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];
  return { doc, bench, meter, itf, command, step };
};

test('a command brings the instrument its interface declares, and only that one', async () => {
  const { blockResources, blockPoints, commandInterfaces, collectUses } = await import('../src/model/resources.js');
  const { doc, bench, meter, step } = commandDoc();

  assert.deepEqual(blockResources(step.measurement, commandInterfaces(doc)), [bench.id]);
  // A command speaks over its interface, and the interface says what drives it and where it
  // is wired. Anything the step may still carry from before is not a second instrument.
  step.measurement.resourceId = meter.id;
  step.measurement.pointIds = ['pt_stale'];
  assert.deepEqual(blockResources(step.measurement, commandInterfaces(doc)), [bench.id]);
  assert.deepEqual(blockPoints(step.measurement, commandInterfaces(doc)), []);
  assert.deepEqual(collectUses(doc).map((u) => u.resourceId), [bench.id]);
});

test('a command with no instrument anywhere is reported', async () => {
  const { doc, itf } = commandDoc();
  assert.equal(validateDocument(doc).issues.some((i) => /instrument/.test(i.message)), false);

  itf.resourceId = '';
  const messages = validateDocument(doc).issues.map((i) => i.message).join(' ');
  assert.match(messages, /declares no instrument/);
});

test('the cycle time counts the instrument behind the command', async () => {
  const { estimateCycleTime } = await import('../src/model/cycletime.js');
  const { doc, meter, step } = commandDoc();
  // 0.5 s of command + 0.3 s of the interface instrument.
  assert.equal(estimateCycleTime(doc).stages[0].total, 0.8);

  // A command is charged its interface instrument and nothing else, whatever the step holds.
  step.measurement.resourceId = meter.id;
  assert.equal(estimateCycleTime(doc).stages[0].total, 0.8);

  // Without a command the step's own instrument is what counts.
  step.measurement.commandId = '';
  assert.equal(estimateCycleTime(doc).stages[0].total, 0.8); // the multimeter alone
});

test('a command block is named SET or GET, a plain one APPLY or MEASURE', async () => {
  const { blockTag } = await import('../src/model/schema.js');
  assert.equal(blockTag('stimulus', { commandId: '' }), 'APPLY');
  assert.equal(blockTag('measurement', { commandId: '' }), 'MEASURE');
  assert.equal(blockTag('stimulus', { commandId: 'cmd_1' }), 'SET');
  assert.equal(blockTag('measurement', { commandId: 'cmd_1' }), 'GET');
});

// ---- KPI and protocols ---------------------------------------------------------

test('a test can be marked as a key performance indicator', async () => {
  const { newTest } = await import('../src/model/schema.js');
  assert.equal(newTest().kpi, false);
  const { importData } = await import('../src/io/import.js');
  const result = importData({
    format: 'tsw-authoring/1',
    header: { title: 'X' },
    stages: [{ name: 'S', tests: [{ name: 'Watched', kpi: true }, { name: 'Plain' }] }],
  });
  assert.equal(result.doc.stages[0].tests[0].kpi, true);
  assert.equal(result.doc.stages[0].tests[1].kpi, false);
});

test('a command names the protocol it is written in, and a missing one is an error', async () => {
  const { newProtocol, newCommand, newInterface } = await import('../src/model/schema.js');
  const doc = emptyDocument();
  const protocol = newProtocol();
  protocol.name = 'UDS over ISO-TP';
  const itf = newInterface();
  const command = newCommand();
  command.interfaceId = itf.id;
  command.protocolId = protocol.id;
  doc.protocols = [protocol];
  doc.interfaces = [itf];
  doc.commands = [command];
  assert.equal(validateDocument(doc).issues.some((i) => /protocol/.test(i.message)), false);

  command.protocolId = 'prt_gone';
  const messages = validateDocument(doc).issues.map((i) => i.message).join(' ');
  assert.match(messages, /points at a protocol that does not exist/);
});

test('the protocols of a document are coded and indexed like every other entity', async () => {
  const { computeCodes, computeIndex } = await import('../src/model/codes.js');
  const { newProtocol } = await import('../src/model/schema.js');
  const doc = emptyDocument();
  const a = newProtocol();
  a.name = 'Application frames';
  const b = newProtocol();
  b.name = 'UDS';
  doc.protocols = [a, b];
  const codes = computeCodes(doc);
  assert.equal(codes.get(a.id), 'PRT-01');
  assert.equal(codes.get(b.id), 'PRT-02');
  assert.equal(computeIndex(doc).get(b.id).name, 'UDS');
});

test('every collection of the document can be reached from a reference', async () => {
  // A collection missing from the navigation map made the PRT links dead: the reference was
  // drawn, the click found nothing, and the reader was told the entity no longer existed.
  const { editTarget } = await import('../src/ui/navigate.js');
  const { newReference, newVariable, newVariant, newResource, newProtocol, newInterface,
    newCommand, newImage, newPoint } = await import('../src/model/schema.js');
  const doc = emptyDocument();
  const made = {
    references: newReference(), variables: newVariable(), variants: newVariant(),
    resources: newResource(), protocols: newProtocol(), interfaces: newInterface(),
    commands: newCommand(), images: newImage('asset', 'Board'), points: newPoint(),
  };
  for (const [key, entity] of Object.entries(made)) doc[key] = [entity];

  for (const [key, entity] of Object.entries(made)) {
    const target = editTarget(doc, entity.id);
    assert.ok(target, `${key} cannot be reached from a reference`);
    assert.equal(target.section, key);
    assert.equal(target.selection.id, entity.id);
  }
});

// ---- a variant seen from every side --------------------------------------------

const variantDoc = () => {
  const doc = emptyDocument();
  const a = newStage();
  a.name = 'Power up';
  const b = newStage();
  b.name = 'Mechanical';
  const c = newStage();
  c.name = 'Diagnostics';
  doc.stages = [a, b, c];
  const variant = newVariant();
  variant.name = 'Without the mechanics';
  variant.overlay = [{ op: OP.REMOVE, path: ['stages', '#' + b.id] }];
  doc.variants = [variant];
  return { doc, a, b, c, variant };
};

test('a variant keeps the codes of the base document, gaps included', async () => {
  const { computeCodes } = await import('../src/model/codes.js');
  const { doc, a, b, c, variant } = variantDoc();
  const base = computeCodes(doc);
  assert.deepEqual([base.get(a.id), base.get(b.id), base.get(c.id)], ['STG-01', 'STG-02', 'STG-03']);

  const resolved = resolveVariant(doc, variant.id).doc;
  const codes = computeCodes(resolved, doc);
  // The stage that stays keeps its own code: renumbering would make STG-02 mean two
  // different stages in two documents carrying the same title and revision.
  assert.equal(codes.get(c.id), 'STG-03');
  assert.deepEqual(resolved.stages.map((s) => codes.get(s.id)), ['STG-01', 'STG-03']);
});

test('a variant can still name what it removes', async () => {
  const { mergedIndex } = await import('../src/model/codes.js');
  const { doc, b, variant } = variantDoc();
  const resolved = resolveVariant(doc, variant.id).doc;
  assert.equal(mergedIndex(resolved, doc).get(b.id).name, 'Mechanical');
  // Without the base there is nothing to name it with, which is what the matrix used to show.
  assert.equal(mergedIndex(resolved).get(b.id), undefined);
});

test('a variant is validated against the base, not against itself resolved', () => {
  const { doc, variant } = variantDoc();
  const resolved = resolveVariant(doc, variant.id).doc;
  // Read against the resolved document, the variant's own removal looks like a customisation
  // of a stage that does not exist: an error the reader can do nothing about.
  const messages = validateDocument(resolved, { base: doc }).issues.map((i) => i.message).join(' ');
  assert.ok(!/can no longer be applied/.test(messages), messages);
});

// ---- text and yes/no criteria --------------------------------------------------

test('a criterion says how it is judged, and defaults to numeric', async () => {
  const { expectedKind, EXPECTED_KIND } = await import('../src/model/schema.js');
  assert.equal(expectedKind(undefined), EXPECTED_KIND.NUMERIC);
  assert.equal(expectedKind({ mode: 'minmax' }), EXPECTED_KIND.NUMERIC); // written before this existed
  assert.equal(expectedKind({ kind: 'string' }), EXPECTED_KIND.STRING);
  assert.equal(expectedKind({ kind: 'boolean' }), EXPECTED_KIND.BOOLEAN);
  assert.equal(expectedKind({ kind: 'nonsense' }), EXPECTED_KIND.NUMERIC);
});

test('a text criterion prints what it compares and how', async () => {
  const { expectedText, numericLimits } = await import('../src/model/variables.js');
  const index = new Map();
  const m = (expected) => expectedText({ expected }, index);

  assert.equal(m({ kind: 'string', text: 'LCU200 v1.4.0', stringComparison: 'EQ', caseSensitive: true }), '= "LCU200 v1.4.0"');
  assert.equal(m({ kind: 'string', text: 'ERR', stringComparison: 'NE', caseSensitive: true }), '≠ "ERR"');
  // Whether case matters is said under the criterion, not inside it.
  assert.equal(m({ kind: 'string', text: 'v1.', stringComparison: 'CONTAINS', caseSensitive: false }), 'contains "v1."');
  assert.equal(m({ kind: 'string', text: 'LCU', stringComparison: 'STARTS', caseSensitive: true }), 'starts with "LCU"');
  assert.equal(m({ kind: 'string', text: '^v\d+$', regex: true, caseSensitive: true }), '/^v\d+$/');
  assert.equal(m({ kind: 'string', text: '^v\d+$', regex: true, caseSensitive: false }), '/^v\d+$/');
  // A text answer has no numeric bounds to check against.
  assert.deepEqual(numericLimits({ expected: { kind: 'string', text: 'x', min: constant('1'), max: constant('9') } }, index), { min: null, max: null });
});

test('a text criterion can be bound to a variable, and says which one', async () => {
  const { expectedText } = await import('../src/model/variables.js');
  const index = new Map([
    ['v1', { id: 'v1', name: 'FwRelease', type: VARIABLE_TYPE.TEXT, value: 'LCU200 v1.4.0' }],
    ['v2', { id: 'v2', name: 'FwPattern', type: VARIABLE_TYPE.TEXT, value: '^LCU200 v\\d+$' }],
    ['v3', { id: 'v3', name: 'Vbatt', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '13.5' }],
  ]);
  const m = (expected) => expectedText({ expected }, index);

  assert.equal(m({ kind: 'string', text: variableRef('v1'), stringComparison: 'EQ' }), '= "LCU200 v1.4.0" (FwRelease)');
  assert.equal(m({ kind: 'string', text: variableRef('v2'), regex: true }), '/^LCU200 v\\d+$/ (FwPattern)');
  // The bare value, not the way a variable prints itself: the unit belongs to a measurement,
  // not to the text coming back from the unit under test.
  assert.equal(m({ kind: 'string', text: variableRef('v3'), stringComparison: 'CONTAINS' }), 'contains "13.5" (Vbatt)');
  assert.equal(m({ kind: 'string', text: variableRef('gone'), stringComparison: 'EQ' }), '⟨missing variable⟩');
  // What was written as a plain string before this existed still reads as a constant.
  assert.equal(m({ kind: 'string', text: 'LCU200 v1.4.0', stringComparison: 'EQ' }), '= "LCU200 v1.4.0"');
});

test('a pattern held in a variable is compiled and checked like any other', () => {
  const doc = emptyDocument();
  doc.variables = [{ id: 'v1', name: 'FwPattern', type: VARIABLE_TYPE.TEXT, value: 'LCU200 v[' }];
  const stage = newStage();
  const t = newTest();
  const step = newStep();
  step.type = STEP_TYPE.MEASUREMENT;
  step.measurement = {
    description: 'Version', pointIds: [], parameters: [],
    expected: { kind: 'string', text: variableRef('v1'), regex: true },
  };
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];
  assert.equal(validateDocument(doc).issues.filter((i) => /regular expression is not valid/.test(i.message)).length, 1);

  doc.variables[0].value = '^LCU200 v';
  assert.equal(validateDocument(doc).issues.some((i) => /regular expression/.test(i.message)), false);

  // A criterion whose variable is gone is a broken reference, said once.
  doc.variables = [];
  const messages = validateDocument(doc).issues.map((i) => i.message);
  assert.equal(messages.filter((msg) => /variable that no longer exists/.test(msg)).length, 1);
  assert.equal(messages.some((msg) => /no acceptance criterion/.test(msg)), false);
});

test('a yes/no criterion says which answer passes', async () => {
  const { expectedText } = await import('../src/model/variables.js');
  const index = new Map();
  assert.equal(expectedText({ expected: { kind: 'boolean', booleanValue: 'true' } }, index), 'TRUE');
  assert.equal(expectedText({ expected: { kind: 'boolean', booleanValue: 'false' } }, index), 'FALSE');
});

test('an empty text and a broken pattern are both reported', () => {
  const doc = emptyDocument();
  const stage = newStage();
  const t = newTest();
  const step = newStep();
  step.type = STEP_TYPE.MEASUREMENT;
  step.measurement = { description: 'Version', pointIds: [], parameters: [], expected: { kind: 'string', text: '' } };
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];
  assert.match(validateDocument(doc).issues.map((i) => i.message).join(' '), /no acceptance criterion/);

  step.measurement.expected = { kind: 'string', text: 'LCU200 v[', regex: true };
  const broken = validateDocument(doc).issues.filter((i) => /regular expression is not valid/.test(i.message));
  assert.equal(broken.length, 1);

  step.measurement.expected = { kind: 'string', text: '^LCU200', regex: true };
  assert.equal(validateDocument(doc).issues.some((i) => /regular expression/.test(i.message)), false);
});

test('the three kinds of criterion come across the authoring format', async () => {
  const { importData } = await import('../src/io/import.js');
  const result = importData({
    format: 'tsw-authoring/1',
    header: { title: 'X' },
    variables: [{ key: 'FwTarget', name: 'FwTarget', type: 'text', value: 'LCU200 v1.4.0' }],
    stages: [{
      name: 'S',
      tests: [{
        name: 'T',
        steps: [
          { description: 'a', measurement: { description: 'volts', expected: { min: '11', max: '14', unit: 'V' } } },
          { description: 'b', measurement: { description: 'version', expected: { text: 'LCU200', stringComparison: 'STARTS', caseSensitive: false } } },
          { description: 'c', measurement: { description: 'version', expected: { pattern: '^v\d+$' } } },
          { description: 'd', measurement: { description: 'pressed', expected: { boolean: false } } },
          { description: 'e', measurement: { description: 'version', expected: { text: '$FwTarget' } } },
        ],
      }],
    }],
  });
  const steps = result.doc.stages[0].tests[0].steps;
  assert.equal(steps[0].measurement.expected.kind, 'numeric');
  assert.equal(steps[1].measurement.expected.kind, 'string');
  assert.equal(steps[1].measurement.expected.stringComparison, 'STARTS');
  assert.equal(steps[1].measurement.expected.caseSensitive, false);
  assert.equal(steps[2].measurement.expected.regex, true);
  assert.equal(steps[3].measurement.expected.kind, 'boolean');
  assert.equal(steps[3].measurement.expected.booleanValue, 'false');
  // The text to expect is a value like any other: «$Name» binds it to a variable.
  assert.equal(steps[4].measurement.expected.text.mode, 'variable');
  assert.equal(result.doc.variables[0].id, steps[4].measurement.expected.text.variableId);
});

test('the plate under a criterion names the kind, and the case note only when it applies', async () => {
  const { expectedBadge, expectedCaseNote } = await import('../src/model/schema.js');
  assert.equal(expectedBadge({ mode: 'minmax' }), '123');
  assert.equal(expectedBadge({ kind: 'string', regex: false }), 'Abc');
  assert.equal(expectedBadge({ kind: 'string', regex: true }), 'RegEx');
  assert.equal(expectedBadge({ kind: 'boolean' }), 'DGT');

  // Silence means case sensitive: only the exception is written.
  assert.equal(expectedCaseNote({ kind: 'string', caseSensitive: true }), '');
  assert.equal(expectedCaseNote({ kind: 'string' }), '');
  assert.equal(expectedCaseNote({ kind: 'string', caseSensitive: false }), 'not case sensitive');
  assert.equal(expectedCaseNote({ kind: 'numeric', caseSensitive: false }), '');
});

test('a variable read only by a text criterion counts as used', async () => {
  const { validateDocument } = await import('../src/model/validate.js');
  const { emptyDocument, newVariable, newStage, newTest, newStep, variableRef, STEP_TYPE } =
    await import('../src/model/schema.js');

  const doc = emptyDocument();
  const fw = newVariable();
  Object.assign(fw, { name: 'FwTarget', type: 'text', value: 'v1.4.0' });
  doc.variables = [fw];

  const step = newStep(STEP_TYPE.MEASUREMENT);
  step.description = 'read the firmware release';
  step.measurement.expected.kind = 'string';
  step.measurement.expected.text = variableRef(fw.id);
  const t = newTest();
  Object.assign(t, { name: 'Firmware', steps: [step] });
  const stage = newStage();
  Object.assign(stage, { name: 'Identity', tests: [t] });
  doc.stages = [stage];

  // The walk over the value references skipped the text criterion, so the one place the
  // variable was read did not count and the document reported it as unused.
  const unused = validateDocument(doc).issues.filter((i) => i.message.includes('FwTarget'));
  assert.deepEqual(unused, []);
});

test('a change to a protocol lands in its own chapter, named', async () => {
  const { compare } = await import('../src/history/diff.js');
  const { emptyDocument, newProtocol, newCommand } = await import('../src/model/schema.js');

  const before = emptyDocument();
  const protocol = newProtocol();
  Object.assign(protocol, { name: 'UDS', family: 'ISO 14229' });
  const command = newCommand();
  Object.assign(command, { name: 'Read firmware' });
  before.protocols = [protocol];
  before.commands = [{ ...command }];

  const after = structuredClone(before);
  after.protocols[0].family = 'ISO 14229-1';
  after.commands[0].protocolId = protocol.id;

  const differences = compare(before, after);
  const onProtocol = differences.find((d) => d.path[0] === 'protocols');
  assert.equal(onProtocol.chapter, 'Communication protocols');
  assert.equal(onProtocol.where, 'Protocols «UDS» › Family');

  // The reference reads as the protocol it points at, not as the identifier behind it.
  const onCommand = differences.find((d) => d.path[0] === 'commands');
  assert.equal(onCommand.label, 'Protocol');
  assert.equal(onCommand.after, 'UDS');
});

// ---- schema 2 ------------------------------------------------------------------

test('a schema-1 document opens as schema 2: three header fields become three signatories, string waits become references', () => {
  const old = {
    schemaVersion: 1,
    header: { title: 'Old', documentCode: 'OLD-1', company: 'C', product: 'P', preparedBy: 'M. Rossi', checkedBy: '', approvedBy: 'L. Verdi' },
    stages: [{ id: 'stg_aaaaaa', name: 'A', kind: 'test', tests: [{ id: 'tc_aaaaaa', name: 'T', steps: [
      { id: 'stp_aaaaaa', description: 'wait', type: 'stimulus', wait: { value: '100', unit: 'ms' }, stimulus: { description: 'x', pointIds: [], resourceId: '', parameters: [], commandId: '' } },
      { id: 'stp_bbbbbb', description: 'no wait', type: 'stimulus', stimulus: { description: 'y', pointIds: [], resourceId: '', parameters: [], commandId: '' } },
    ] }] }],
  };
  const doc = migrate(old);
  assert.equal(doc.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(doc.header.signatories.map((s) => [s.role, s.name]), [['Prepared by', 'M. Rossi'], ['Checked by', ''], ['Approved by', 'L. Verdi']]);
  assert.equal('preparedBy' in doc.header, false);
  const [withWait, without] = doc.stages[0].tests[0].steps;
  assert.deepEqual(withWait.wait, { value: { mode: 'constant', value: '100' }, unit: 'ms' });
  assert.deepEqual(without.wait, { value: { mode: 'constant', value: '' }, unit: 's' });
  // And it validates: nothing about the upgrade is reported as a fault of the document.
  const { issues } = validateDocument(doc);
  assert.deepEqual(issues.filter((i) => i.severity === SEVERITY.ERROR), []);
});

test('a document already at schema 2 keeps its own signatories, however many', () => {
  const doc = emptyDocument();
  doc.header.signatories = [newSignatory('Issued by', 'A'), newSignatory('Verified by', 'B'), newSignatory('Verified by', 'C'), newSignatory('Verified by', 'D'), newSignatory('Approved by', 'E')];
  const back = migrate(JSON.parse(JSON.stringify(doc)));
  assert.equal(back.header.signatories.length, 5);
  assert.equal(back.header.signatories[3].name, 'D');
});

test('a cover nobody signs is an incomplete header', () => {
  const { doc } = sampleDocument();
  doc.header.company = 'C'; doc.header.documentCode = 'X'; doc.header.product = 'P';
  const nobody = validateDocument(doc).issues.filter((i) => /no signatory/.test(i.message));
  assert.equal(nobody.length, 1);
  doc.header.signatories[0].name = 'M. Rossi';
  assert.equal(validateDocument(doc).issues.filter((i) => /no signatory/.test(i.message)).length, 0);
});

test('a wait bound to a variable takes its value and its unit, in the estimate and in the print', async () => {
  const { estimateCycleTime } = await import('../src/model/cycletime.js');
  const doc = emptyDocument();
  const ton = Object.assign(newVariable(), { name: 'Ton', type: VARIABLE_TYPE.NUMBER, unit: 'ms', value: '250' });
  doc.variables = [ton];
  const stage = Object.assign(newStage(), { name: 'A' });
  const t = Object.assign(newTest(), { name: 'T' });
  const step = Object.assign(newStep(STEP_TYPE.STIMULUS), { description: 'settle' });
  step.wait = { value: variableRef(ton.id), unit: 's' }; // the step says seconds; the variable says ms, and wins
  step.stimulus.description = 'x';
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];
  assert.equal(estimateCycleTime(doc).serial, 0.25);
  // The variable counts as used, and a wait on a variable that is gone is an error.
  assert.equal(validateDocument(doc).issues.some((i) => /Ton.*not used/.test(i.message)), false);
  step.wait.value = variableRef('var_gone00');
  assert.ok(validateDocument(doc).issues.some((i) => i.severity === SEVERITY.ERROR && /Wait of step/.test(i.message)));
});
