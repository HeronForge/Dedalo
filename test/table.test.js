// The table step: the compact grammar of its cells, and how the rest of the tool reads it.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyDocument, newStage, newTest, newStep, newVariable, newResource, newPoint, newCommand, newInterface, newProtocol, newReference,
  newTableColumn, newTableRow, newTableCell, stepBlocks, normaliseStepForType, constant, variableRef, commandDecoding,
  STEP_TYPE, TABLE_COLUMN_KIND, VARIABLE_TYPE,
} from '../src/model/schema.js';
import { parseCriterion, criterionToShorthand, parseValue, valueToShorthand } from '../src/model/shorthand.js';
import { expectedText, variableIndex } from '../src/model/variables.js';
import { validateDocument } from '../src/model/validate.js';
import { resourceSummary } from '../src/model/resources.js';
import { estimateCycleTime } from '../src/model/cycletime.js';
import { describeOperation, OP, applyOverlay } from '../src/model/variants.js';
import { varianceIndex, fieldVaries } from '../src/model/variance.js';
import { cloneEntity } from '../src/model/clone.js';
import { importAuthoring } from '../src/io/import.js';

const vbat = Object.assign(newVariable(), { name: 'Vbat', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '12' });
const imax = Object.assign(newVariable(), { name: 'Imax', type: VARIABLE_TYPE.NUMBER, unit: 'A', value: '3' });
const variables = new Map([[vbat.id, vbat], [imax.id, imax]]);
const byName = (name) => ([vbat, imax].find((v) => v.name === name) || {}).id || null;
const nameOf = (id) => (variables.get(id) || {}).name || '';
const printed = (text, unit = 'V') => expectedText({ expected: parseCriterion(text, { unit, variable: byName }).expected }, variables);
const back = (text, unit = 'V') => criterionToShorthand(parseCriterion(text, { unit, variable: byName }).expected, nameOf);

// ---- the grammar, one line of the guide's table at a time ------------------------------

test('«12 ±0.5», with a comma or with +-, is a nominal with an absolute tolerance', () => {
  for (const t of ['12 ±0.5', '12±0,5', '12 +-0.5']) {
    assert.equal(printed(t), '12 V ± 0.5 V', t);
    assert.equal(back(t), '12 ±0.5', t);
  }
});

test('«12 ±5%» is a nominal with a percent tolerance', () => {
  assert.equal(printed('12 ±5%'), '12 V ± 5 %');
  assert.equal(back('12 ±5%'), '12 ±5%');
});

test('a comparison sign and one limit is that comparison', () => {
  const lines = [['< 0.8', '< 0.8 V'], ['<= 0.8', '≤ 0.8 V'], ['> 3', '> 3 V'], ['>= 3', '≥ 3 V'], ['= 0', '= 0 V'], ['!= 0', '≠ 0 V']];
  for (const [typed, shown] of lines) {
    assert.equal(printed(typed), shown, typed);
    assert.equal(back(typed), typed, typed);
  }
});

test('two numbers with dots, a dash or ÷ between them are an interval, both ends included', () => {
  for (const t of ['10 … 14', '10 .. 14', '10 - 14', '10÷14']) {
    assert.equal(printed(t), '10 V … 14 V', t);
    assert.equal(back(t), '10 … 14', t);
  }
  // A negative number is not a dash: the interval needs room around its dash.
  assert.equal(printed('-12 - -10'), '-12 V … -10 V');
});

test('«$Name» stands for the variable, in a nominal and in a limit alike', () => {
  assert.equal(printed('$Vbat ±5%'), '12 V (Vbat) ± 5 %');
  assert.equal(back('$Vbat ±5%'), '$Vbat ±5%');
  assert.equal(printed('< $Imax'), '< 3 A (Imax)');
  assert.equal(back('< $Imax'), '< $Imax');
});

test('«recorded» judges nothing, and yes / no / ok / true / false are a boolean', () => {
  assert.equal(printed('recorded'), 'recorded, no pass/fail');
  assert.equal(back('recorded'), 'recorded');
  assert.equal(printed('yes'), 'TRUE');
  assert.equal(printed('ok'), 'TRUE');
  assert.equal(printed('true'), 'TRUE');
  assert.equal(printed('no'), 'FALSE');
  assert.equal(printed('false'), 'FALSE');
  assert.equal(back('no'), 'no');
});

test('anything else is the text the unit must answer, equal and case sensitive', () => {
  for (const t of ['+', '-', 'NC', '0x0008']) {
    assert.equal(printed(t), `= "${t}"`, t);
    assert.equal(back(t), t, t);
  }
});

test('a malformed cell falls back to text and says which variable it could not find', () => {
  const unknown = parseCriterion('$Nope ±1', { unit: 'V', variable: byName });
  assert.deepEqual(unknown.unresolved, ['Nope']);
  assert.equal(expectedText({ expected: unknown.expected }, variables), '= "$Nope ±1"');
  const half = parseCriterion('12 ±', { unit: 'V' });
  assert.equal(expectedText({ expected: half.expected }, variables), '= "12 ±"');
  assert.equal(expectedText({ expected: parseCriterion('', { unit: 'V' }).expected }, variables), 'V');
});

test('what the grammar cannot say comes back as null, so the cell is shown and not edited', () => {
  const outside = { ...parseCriterion('10 … 14').expected, comparison: 'LTGT' };
  assert.equal(criterionToShorthand(outside, nameOf), null);
  const open = { ...parseCriterion('10 … 14').expected, comparison: 'GTLT' };
  assert.equal(criterionToShorthand(open, nameOf), null);
  const pattern = { ...parseCriterion('ABC').expected, regex: true };
  assert.equal(criterionToShorthand(pattern, nameOf), null);
});

test('a stimulus cell is a value, or a variable when it starts with $', () => {
  assert.deepEqual(parseValue('open').value, constant('open'));
  assert.deepEqual(parseValue('$Vbat', { variable: byName }).value, variableRef(vbat.id));
  assert.equal(valueToShorthand(variableRef(vbat.id), nameOf), '$Vbat');
  assert.equal(valueToShorthand(constant('1500')), '1500');
});

// ---- the step in the document ---------------------------------------------------------

/** A stage with one table step: a simulator applies a resistor, a command reads two things. */
function tableDocument() {
  const doc = emptyDocument();
  doc.header = { ...doc.header, company: 'C', documentCode: 'X', product: 'P' };
  doc.header.signatories[0].name = 'A';
  doc.variables = [imax];
  const sim = Object.assign(newResource(), { name: 'Simulator', averageTime: '1' });
  const bench = Object.assign(newResource(), { name: 'Bench PC', averageTime: '' });
  doc.resources = [sim, bench];
  const pp = Object.assign(newPoint(), { name: 'PP', markers: [{ id: 'mk_000001', imageId: 'img_000001', x: 0.1, y: 0.1, area: 0.3 }] });
  doc.points = [pp];
  doc.images = [{ id: 'img_000001', name: 'board', assetId: 'sha_x', caption: '' }];
  const itf = Object.assign(newInterface(), { name: 'Console', resourceId: bench.id, pointIds: [] });
  doc.interfaces = [itf];
  const read = Object.assign(newCommand(), { name: 'read pp', interfaceId: itf.id, nominalTime: '0.5' });
  doc.commands = [read];

  const step = normaliseStepForType(newStep(STEP_TYPE.TABLE), STEP_TYPE.TABLE);
  step.description = 'PP table';
  const resistor = Object.assign(newTableColumn(TABLE_COLUMN_KIND.STIMULUS), { name: 'PP resistor', unit: 'Ω', pointIds: [pp.id], resourceId: sim.id });
  const limit = Object.assign(newTableColumn(TABLE_COLUMN_KIND.MEASUREMENT), { name: 'ilimit', unit: 'A', commandId: read.id });
  step.table.columns = [resistor, limit];
  const rowOf = (label, ohm, crit) => {
    const row = Object.assign(newTableRow(), { label });
    const a = newTableCell(resistor); a.value = constant(ohm);
    const b = newTableCell(limit); b.expected = parseCriterion(crit, { unit: 'A', variable: byName }).expected;
    row.cells = [a, b];
    return row;
  };
  step.table.rows = [rowOf('13 A cable', '1500', '= 13'), rowOf('63 A cable', '100', '= $Imax'), rowOf('open', 'open', 'recorded')];
  const t = Object.assign(newTest(), { name: 'Cables', steps: [step] });
  const stage = Object.assign(newStage(), { name: 'PP', tests: [t] });
  doc.stages = [stage];
  return { doc, step, resistor, limit, sim, read };
}

test('a table step has no blocks of its own: its columns are its blocks', () => {
  const { step } = tableDocument();
  assert.equal(step.stimulus, undefined);
  assert.equal(step.measurement, undefined);
  const blocks = stepBlocks(step);
  assert.deepEqual(blocks.map((b) => b.kind), ['stimulus', 'measurement']);
  // Turned into an ordinary step, the table goes and the blocks come; and back again.
  const plain = normaliseStepForType(JSON.parse(JSON.stringify(step)), STEP_TYPE.STIMULUS_MEASUREMENT);
  assert.equal(plain.table, undefined);
  assert.ok(plain.stimulus && plain.measurement);
});

test('a clean table validates clean, and every way it can be wrong is said once per row', () => {
  const { doc, step, limit } = tableDocument();
  const issues = () => validateDocument(doc).issues.filter((i) => /PP table/.test(i.message)).map((i) => i.message);
  assert.deepEqual(issues(), []);
  // Two rows judged by nothing: one line each, not one per cell.
  step.table.rows[0].cells[1].expected = parseCriterion('', { unit: 'A' }).expected;
  step.table.rows[1].cells = [step.table.rows[1].cells[0]];
  assert.equal(issues().filter((m) => /without a criterion/.test(m)).length, 2);
  // A nominal without a tolerance is an error in a cell as in a step.
  step.table.rows[2].cells[1].expected = parseCriterion('12 ±', { unit: 'A' }).expected;
  step.table.rows[2].cells[1].expected = { ...step.table.rows[2].cells[1].expected, kind: 'numeric', mode: 'nominal', comparison: 'EQT', nominal: constant('12') };
  assert.ok(issues().some((m) => /no tolerance/.test(m)));
  // A cell of a column that is gone.
  step.table.columns = step.table.columns.filter((c) => c.id !== limit.id);
  assert.ok(issues().some((m) => /column the table no longer has/.test(m)));
  step.table.columns = [];
  step.table.rows = [];
  assert.ok(issues().some((m) => /no columns/.test(m)) && issues().some((m) => /no rows/.test(m)));
});

test('a column occupies the bench like a block, and a command runs once per row', () => {
  const { doc, sim } = tableDocument();
  const rows = resourceSummary(doc).rows;
  const simulator = rows.find((r) => r.resource.id === sim.id);
  assert.ok(simulator && simulator.used !== false, 'the simulator is used through the stimulus column');
  // 3 rows × (1 s simulator + 0.5 s command) = 4.5 s
  assert.equal(estimateCycleTime(doc).serial, 4.5);
});

test('a cell is reached by path: a variant changes one, the change reads as a sentence, and the cell is marked', () => {
  const { doc, step } = tableDocument();
  const row = step.table.rows[0];
  const cell = row.cells[1];
  const path = ['stages', '#' + doc.stages[0].id, 'tests', '#' + doc.stages[0].tests[0].id, 'steps', '#' + step.id, 'table', 'rows', '#' + row.id, 'cells', '#' + cell.id, 'expected', 'min'];
  const variant = { id: 'vnt_000001', name: '16 A version', description: '', overlay: [{ op: OP.SET, path, value: constant('16') }] };
  doc.variants = [variant];
  const { doc: resolved, dropped } = applyOverlay(doc, variant);
  assert.deepEqual(dropped, []);
  const resolvedCell = resolved.stages[0].tests[0].steps[0].table.rows[0].cells[1];
  assert.equal(expectedText({ expected: resolvedCell.expected }, variableIndex(resolved)), '= 16 A');
  const said = describeOperation(doc, variant.overlay[0]);
  assert.match(said.where, /Table › Row «13 A cable» › Cell 2 › Expected value › Minimum/);
  assert.deepEqual(fieldVaries(varianceIndex(doc), cell.id, 'expected'), ['16 A version']);
});

test('a duplicated table step keeps its cells on its own columns', () => {
  const { step } = tableDocument();
  const copy = cloneEntity(step);
  const ids = new Set(copy.table.columns.map((c) => c.id));
  assert.ok(copy.table.rows.every((r) => r.cells.every((c) => ids.has(c.columnId))));
  assert.notEqual(copy.table.columns[0].id, step.table.columns[0].id);
});

test('a table comes in from an authoring file, cells as the grammar or as the criterion object', () => {
  const r = importAuthoring({
    format: 'tsw-authoring/1',
    variables: [{ key: 'IMAX', name: 'Imax', type: 'number', unit: 'A', value: '3' }],
    resources: [{ key: 'SIM', name: 'Simulator' }],
    points: [{ key: 'PP', name: 'PP' }],
    stages: [{ key: 'S', name: 'S', tests: [{ name: 'T', steps: [{ description: 'PP table', table: {
      columns: [{ key: 'R', name: 'PP resistor', kind: 'stimulus', unit: 'Ω', resource: 'SIM', points: ['PP'] }, { key: 'IL', name: 'ilimit', kind: 'measurement', unit: 'A' }],
      rows: [
        { label: '13 A', cells: [{ column: 'R', value: '1500' }, { column: 'IL', expected: '= 13' }] },
        { label: '63 A', cells: [{ column: 'R', value: '$Imax' }, { column: 'IL', expected: { min: '1', max: '3' } }] },
        { label: 'odd', cells: [{ column: 'NOPE', value: 'x' }, { column: 'IL', expected: '= $Gone' }] },
        // The shorter form: an object keyed by column, a string or the criterion object.
        { label: 'keyed', cells: { R: '680', IL: '20 ±1' } },
        { label: 'keyed object', cells: { R: '$Imax', IL: { nominal: '2', tolerance: '10', toleranceType: 'percent' } } },
      ] } }] }] }],
  });
  const step = r.doc.stages[0].tests[0].steps[0];
  assert.equal(step.type, STEP_TYPE.TABLE);
  assert.equal(step.table.columns.length, 2);
  assert.equal(step.table.columns[0].resourceId, r.doc.resources[0].id);
  const [r13, r63, odd, keyed, keyedObject] = step.table.rows;
  assert.equal(expectedText({ expected: r13.cells[1].expected }, variableIndex(r.doc)), '= 13 A');
  assert.deepEqual(r63.cells[0].value, variableRef(r.doc.variables[0].id));
  assert.equal(expectedText({ expected: r63.cells[1].expected }, variableIndex(r.doc)), '1 A … 3 A');
  assert.equal(odd.cells.length, 1, 'the cell of an undeclared column is dropped');
  assert.deepEqual(keyed.cells[0].value, constant('680'));
  assert.equal(expectedText({ expected: keyed.cells[1].expected }, variableIndex(r.doc)), '20 A ± 1 A');
  assert.deepEqual(keyedObject.cells[0].value, variableRef(r.doc.variables[0].id));
  assert.equal(expectedText({ expected: keyedObject.cells[1].expected }, variableIndex(r.doc)), '2 A ± 10 %');
  assert.ok(r.problems.some((p) => /column «NOPE»/.test(p)));
  assert.ok(r.problems.some((p) => /unknown variable «Gone»/.test(p)));
});

// ---- a measurement computed from earlier readings -------------------------------------

test('a computed measurement names its inputs among the earlier readings of its test, and nothing on the bench', () => {
  const { doc, step: table } = tableDocument();
  const t = doc.stages[0].tests[0];
  const before = Object.assign(newStep(STEP_TYPE.MEASUREMENT), { description: 'reference' });
  before.measurement.description = 'ref'; before.measurement.resourceId = doc.resources[0].id;
  before.measurement.expected = parseCriterion('recorded', { unit: 'W' }).expected;
  const computed = Object.assign(newStep(STEP_TYPE.MEASUREMENT), { description: 'error' });
  computed.measurement.description = 'error';
  computed.measurement.computed = { formula: '(a − b) / b', inputStepIds: [before.id, table.id] };
  computed.measurement.expected = parseCriterion('0 ±1', { unit: '%' }).expected;
  t.steps = [table, before, computed];
  const errors = () => validateDocument(doc).issues.filter((i) => i.severity !== 'info' && /Step .*error/.test(i.message)).map((i) => i.message);
  assert.deepEqual(errors(), []);
  assert.deepEqual(stepBlocks(computed), [], 'a computed measurement holds nothing on the bench');

  computed.measurement.resourceId = doc.resources[0].id;
  assert.ok(errors().some((m) => /computed, yet names/.test(m)));
  computed.measurement.resourceId = '';
  computed.measurement.computed.formula = '';
  assert.ok(errors().some((m) => /no formula/.test(m)));
  // An input that comes after, one that is not of this test, one that reads nothing.
  const later = Object.assign(newStep(STEP_TYPE.STIMULUS), { description: 'after' });
  t.steps = [table, before, computed, later];
  computed.measurement.computed.inputStepIds = [later.id, 'stp_elsewhere', before.id];
  assert.ok(errors().some((m) => /comes after/.test(m)));
  assert.ok(errors().some((m) => /not a step of this test/.test(m)));
  computed.measurement.computed.inputStepIds = [];
  t.steps = [table, before, later, computed];
  computed.measurement.computed.inputStepIds = [later.id];
  assert.ok(errors().some((m) => /reads nothing/.test(m)));
});

test('a computed measurement comes in from an authoring file with its formula and its inputs by key', () => {
  const r = importAuthoring({
    format: 'tsw-authoring/1',
    resources: [{ key: 'AN', name: 'Analyser' }],
    stages: [{ key: 'S', name: 'S', tests: [{ name: 'T', steps: [
      { key: 'REF', description: 'reference', measurement: { description: 'ref', resource: 'AN', expected: { comparison: 'NONE', unit: 'W' } } },
      { key: 'MET', description: 'meter', measurement: { description: 'meter', resource: 'AN', expected: { comparison: 'NONE', unit: 'W' } } },
      { key: 'ERR', description: 'error', measurement: { description: 'error', computed: { formula: '(MET − REF) / REF', inputs: ['REF', 'MET', 'NOPE'] }, expected: { nominal: '0', tolerance: '1', unit: '%' } } },
    ] }] }],
  });
  const [ref, met, err] = r.doc.stages[0].tests[0].steps;
  assert.equal(err.measurement.computed.formula, '(MET − REF) / REF');
  assert.deepEqual(err.measurement.computed.inputStepIds, [ref.id, met.id]);
  assert.ok(r.problems.some((p) => /unknown step «NOPE»/.test(p)));
});

// ---- a step that points at a figure ------------------------------------------------------

test('a step may point at a figure, and a figure that is gone is an error', () => {
  const { doc, step } = tableDocument();
  step.imageId = doc.images[0].id;
  const errors = () => validateDocument(doc).issues.filter((i) => i.severity === 'error').map((i) => i.message);
  assert.deepEqual(errors(), []);
  step.imageId = 'img_gone00';
  assert.ok(errors().some((m) => /points at an image that does not exist/.test(m)));
  const r = importAuthoring({
    format: 'tsw-authoring/1',
    images: [{ key: 'FRONT', name: 'Front panel' }],
    stages: [{ key: 'S', name: 'S', tests: [{ name: 'T', steps: [
      { description: 'look', image: 'FRONT', stimulus: { description: 'x' } },
      { description: 'look elsewhere', image: 'NOPE', stimulus: { description: 'y' } },
    ] }] }],
  });
  const [a, b] = r.doc.stages[0].tests[0].steps;
  assert.equal(a.imageId, r.doc.images[0].id);
  assert.equal(b.imageId, '');
  assert.ok(r.problems.some((p) => /unknown image «NOPE»/.test(p)));
});

// ---- a command or a protocol defined in another document -----------------------------------

test('a command defined elsewhere is a notice, and one that names a reference that is gone is an error', () => {
  const { doc, read } = tableDocument();
  const icd = Object.assign(newReference(), { code: 'ICD-01', title: 'Interface control document' });
  doc.references = [icd];
  const issues = () => validateDocument(doc).issues;
  const messages = (severity) => issues().filter((i) => i.severity === severity).map((i) => i.message);
  assert.deepEqual(messages('error'), []);
  assert.deepEqual(messages('info'), []);
  // Named in the reference, with no format here: said once per reference, as information.
  read.referenceId = icd.id;
  assert.ok(messages('info').some((m) => /1 command is defined in REF-01 .* and carries no format here/.test(m)));
  // With a format of its own, the reference is just where to read more.
  read.requestFormat = 'read pp\r\n';
  assert.deepEqual(messages('info'), []);
  // A reference that is gone is an error, on the command and on a protocol alike.
  read.referenceId = 'ref_gone00';
  const protocol = Object.assign(newProtocol(), { name: 'Console', referenceId: 'ref_gone00' });
  doc.protocols = [protocol];
  const errors = messages('error');
  assert.ok(errors.some((m) => /Command CMD-01 .* defined in a reference that does not exist/.test(m)));
  assert.ok(errors.some((m) => /Protocol PRT-01 .* defined in a reference that does not exist/.test(m)));
});

test('a criterion that states no unit over a decoded command is read in the unit of the decoding', () => {
  const command = Object.assign(newCommand(), { name: 'read current', decoding: { formula: 'hex → U32, ÷ 51.15', unit: 'mA' } });
  assert.deepEqual(commandDecoding(command), { formula: 'hex → U32, ÷ 51.15', unit: 'mA' });
  assert.deepEqual(commandDecoding(newCommand()), { formula: '', unit: '' });
  const expected = parseCriterion('120 ±5', { unit: '', variable: byName }).expected;
  assert.equal(expectedText({ expected }, variables), '120 ± 5');
  assert.equal(expectedText({ expected }, variables, commandDecoding(command).unit), '120 mA ± 5 mA');
  // A unit the criterion states wins over the one of the decoding: nothing is written into the step.
  const inAmps = parseCriterion('0.12 ±0.005', { unit: 'A', variable: byName }).expected;
  assert.equal(expectedText({ expected: inAmps }, variables, 'mA'), '0.12 A ± 0.005 A');
  assert.equal(expected.unit, '');
});

test('a command and a protocol come in from an authoring file with their reference and decoding', () => {
  const r = importAuthoring({
    format: 'tsw-authoring/1',
    references: [{ key: 'ICD', code: 'ICD-EM3', title: 'Meter register map' }],
    resources: [{ key: 'PC', name: 'Bench PC' }],
    protocols: [{ key: 'MB', name: 'Modbus RTU', reference: 'ICD' }, { key: 'X', name: 'Other', reference: 'NOPE' }],
    interfaces: [{ key: 'RS', name: 'RS-485', resource: 'PC' }],
    commands: [
      { key: 'PWR', name: 'read power', interface: 'RS', protocol: 'MB', reference: 'ICD-EM3', decoding: { formula: 'float32 big endian', unit: 'W' } },
      { key: 'PLAIN', name: 'read plain', interface: 'RS', protocol: 'MB' },
    ],
  });
  const icd = r.doc.references[0];
  assert.equal(r.doc.protocols[0].referenceId, icd.id);
  assert.equal(r.doc.protocols[1].referenceId, '');
  assert.ok(r.problems.some((p) => /Protocol «Other».*unknown reference «NOPE»/.test(p)));
  // The reference is reached by its key or by its code, whichever the file uses.
  assert.equal(r.doc.commands[0].referenceId, icd.id);
  assert.deepEqual(r.doc.commands[0].decoding, { formula: 'float32 big endian', unit: 'W' });
  assert.deepEqual(r.doc.commands[1].decoding, { formula: '', unit: '' });
  assert.equal(r.doc.commands[1].referenceId, '');
});
