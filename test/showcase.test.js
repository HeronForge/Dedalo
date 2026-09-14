// The showcase document (dist/wallbox.html) is the one a demonstration opens, so it is held
// to a higher standard than the small example: it must validate clean, in the base and in
// every variant, and every version it carries must still open and validate.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildWallboxDemo } from '../build/demo-wallbox.mjs';
import { validateDocument, SEVERITY } from '../src/model/validate.js';
import { applyOverlay } from '../src/model/variants.js';
import { revisionDocument, assetsUsedBy } from '../src/history/revisions.js';
import { compare, diffCounts } from '../src/history/diff.js';
import { estimateCycleTime } from '../src/model/cycletime.js';
import { varianceIndex, variableVaries } from '../src/model/variance.js';

const demo = await buildWallboxDemo();

const messages = (issues, severity) => issues.filter((i) => i.severity === severity).map((i) => i.message);

test('the showcase validates without an error, a warning or a notice', () => {
  const { issues } = validateDocument(demo.doc, { history: demo.history });
  assert.deepEqual(messages(issues, SEVERITY.ERROR), []);
  assert.deepEqual(messages(issues, SEVERITY.WARNING), []);
  assert.deepEqual(messages(issues, SEVERITY.INFO), []);
});

test('every variant of the showcase applies in full and validates without an error, a warning or a notice', () => {
  assert.equal(demo.doc.variants.length, 4);
  for (const variant of demo.doc.variants) {
    const { doc, dropped } = applyOverlay(demo.doc, variant);
    assert.deepEqual(dropped, [], `${variant.name}: every customisation applies`);
    const { issues } = validateDocument(doc, { base: demo.doc, history: demo.history });
    assert.deepEqual(messages(issues, SEVERITY.ERROR), [], variant.name);
    assert.deepEqual(messages(issues, SEVERITY.WARNING), [], variant.name);
    assert.deepEqual(messages(issues, SEVERITY.INFO), [], variant.name);
  }
});

test('the variants of the showcase do the three things a variant can do', () => {
  const [, changes, removes, adds] = demo.doc.variants;
  assert.ok(changes.overlay.every((op) => op.op === 'set'), 'EVC-11 only changes values');
  assert.ok(removes.overlay.some((op) => op.op === 'remove' && op.path[0] === 'stages'), 'EVC-7 S removes a stage');
  assert.ok(removes.overlay.some((op) => op.op === 'remove' && op.path[0] === 'points'), 'EVC-7 S removes a point');
  assert.ok(adds.overlay.some((op) => op.op === 'add' && op.path[0] === 'commands'), 'EVC-22 Pro adds a command');
  assert.ok(adds.overlay.some((op) => op.op === 'add' && op.path[0] === 'stages'), 'EVC-22 Pro adds a test');
});

test('every picture the showcase names is in the file, and every picture in the file is named', () => {
  const used = assetsUsedBy(demo.doc);
  for (const id of used) assert.ok(demo.assets[id], `asset ${id} is present`);
  for (const id of Object.keys(demo.assets)) assert.ok(used.includes(id), `asset ${id} is used`);
  for (const asset of Object.values(demo.assets)) {
    assert.ok(asset.width > 0 && asset.height > 0);
    assert.ok(asset.data.length > 0);
  }
});

test('the issued revisions of the showcase open, validate and differ from the draft', async () => {
  assert.equal(demo.history.revisions.length, 3);
  let previous = null;
  for (const revision of demo.history.revisions) {
    const doc = await revisionDocument(revision);
    assert.equal(doc.revision.number, revision.number);
    const { issues } = validateDocument(doc);
    assert.deepEqual(messages(issues, SEVERITY.ERROR), [], `rev ${revision.number}`);
    if (previous) assert.ok(compare(previous, doc).length > 0, `rev ${revision.number} differs from the one before`);
    previous = doc;
  }
  const c = diffCounts(compare(previous, demo.doc));
  assert.ok(c.added >= 1, 'the draft adds the Pro variant');
  assert.ok(c.changed >= 1, 'the draft tightens the standby limit');
});

test('the showcase signs its cover eight times, in the order the departments sign', () => {
  const roles = demo.doc.header.signatories.map((s) => s.role);
  assert.equal(roles.length, 8);
  assert.equal(roles.filter((r) => r.startsWith('Issued by')).length, 3);
  assert.equal(roles.filter((r) => r.startsWith('Verified by')).length, 4);
  assert.equal(roles[7], 'Approved by');
  assert.ok(demo.doc.header.signatories.every((s) => s.name));
});

test('the showcase waits on a variable somewhere, and every wait is a value reference', () => {
  const steps = demo.doc.stages.flatMap((s) => s.tests).flatMap((t) => t.steps);
  assert.ok(steps.every((s) => s.wait && typeof s.wait.value === 'object'));
  const bound = steps.filter((s) => s.wait.value.mode === 'variable');
  assert.ok(bound.length >= 1, 'at least one wait follows a variable');
  const named = new Set(demo.doc.variables.map((v) => v.id));
  assert.ok(bound.every((s) => named.has(s.wait.value.variableId)));
});

test('the showcase decodes the cables in one table step, judged where the answer is settled', () => {
  const steps = demo.doc.stages.flatMap((s) => s.tests).flatMap((t) => t.steps);
  const tables = steps.filter((s) => s.type === 'table');
  assert.equal(tables.length, 1);
  const [table] = tables;
  assert.deepEqual(table.table.columns.map((c) => c.kind), ['stimulus', 'measurement', 'measurement']);
  assert.equal(table.table.rows.length, 5);
  // The 63 A row judges the limit against MaxCurrent, which the EVC-11 variant changes: the
  // cell is marked as depending on the variant, and resolves to 16 A there.
  const maxCurrent = demo.doc.variables.find((v) => v.name === 'MaxCurrent');
  const row63 = table.table.rows.find((r) => /63 A/.test(r.label));
  const limitCell = row63.cells[2];
  assert.deepEqual(limitCell.expected.min, { mode: 'variable', variableId: maxCurrent.id });
  const evc11 = demo.doc.variants.find((v) => /EVC-11/.test(v.name));
  const resolved = applyOverlay(demo.doc, evc11).doc;
  const resolvedMax = resolved.variables.find((v) => v.id === maxCurrent.id);
  assert.equal(resolvedMax.value, '16');
  assert.deepEqual(variableVaries(varianceIndex(demo.doc), maxCurrent.id), [evc11.name]);
});

test('the showcase judges the metering error as a computation of two recorded readings', () => {
  const steps = demo.doc.stages.flatMap((s) => s.tests).flatMap((t) => t.steps);
  const computed = steps.filter((s) => s.measurement && s.measurement.computed);
  assert.equal(computed.length, 1);
  const [error] = computed;
  assert.match(error.measurement.computed.formula, /reference/);
  const test_ = demo.doc.stages.flatMap((s) => s.tests).find((t) => t.steps.includes(error));
  const inputs = error.measurement.computed.inputStepIds.map((id) => test_.steps.find((s) => s.id === id));
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every((s) => s && s.measurement && s.measurement.expected.comparison === 'NONE'), 'both inputs are recorded, not judged');
  assert.ok(inputs.every((s) => test_.steps.indexOf(s) < test_.steps.indexOf(error)));
  assert.equal(error.measurement.resourceId, '');
});

test('the showcase points one step at the front panel picture', () => {
  const steps = demo.doc.stages.flatMap((s) => s.tests).flatMap((t) => t.steps);
  const pointed = steps.filter((s) => s.imageId);
  assert.equal(pointed.length, 1);
  const image = demo.doc.images.find((i) => i.id === pointed[0].imageId);
  assert.equal(image.name, 'Front panel');
});

test('the showcase names where its Modbus protocol and its meter command are defined, and how the meter answer is decoded', () => {
    const byCode = (code) => demo.doc.references.find((r) => r.code === code);
    const ocpp = demo.doc.protocols.find((p) => p.name === 'OCPP 1.6J');
    assert.equal(ocpp.referenceId, byCode('ICD-OCPP-VOL').id);
    const meter = demo.doc.commands.find((c) => c.name === 'Read active power directly from the meter');
    assert.equal(meter.referenceId, byCode('ICD-MB-EM3').id);
    assert.equal(meter.decoding.unit, 'W');
    assert.ok(meter.decoding.formula.length > 0);
    // The command keeps its own format: nothing for the validation to notice.
    assert.ok(meter.requestFormat && meter.responseFormat);
});

test('the showcase has something for the cycle time estimate to optimise', () => {
  const estimate = estimateCycleTime(demo.doc);
  assert.ok(estimate.serial > 0);
  assert.ok(estimate.parallel < estimate.serial, 'parallel stages make the estimate shorter');
  assert.equal(estimate.truncated, false);
});
