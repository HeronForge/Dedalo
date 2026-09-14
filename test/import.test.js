import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { importAuthoring, importData, isAuthoringFormat, liftNoteLines } from '../src/io/import.js';

test('a wait written as «$Ton» is the variable Ton, and a plain number stays a constant', () => {
  const result = importAuthoring({
    format: 'tsw-authoring/1',
    variables: [{ key: 'TON', name: 'Ton', type: 'number', unit: 'ms', value: '100' }],
    stages: [{ key: 'S', name: 'S', tests: [{ name: 'T', steps: [
      { key: 'A', description: 'a', type: 'stimulus', wait: { value: '$Ton', unit: 'ms' }, stimulus: { description: 'x' } },
      { key: 'B', description: 'b', type: 'stimulus', wait: { value: '2', unit: 's' }, stimulus: { description: 'y' } },
    ] }] }],
  });
  const [a, b] = result.doc.stages[0].tests[0].steps;
  assert.deepEqual(a.wait, { value: { mode: 'variable', variableId: result.doc.variables[0].id }, unit: 'ms' });
  assert.deepEqual(b.wait, { value: { mode: 'constant', value: '2' }, unit: 's' });
});

test('the signatories come in as a list, and the three keys of older files become its first rows', () => {
  const listed = importAuthoring({ format: 'tsw-authoring/1', header: { title: 'T', signatories: [{ role: 'Issued by', name: 'A' }, { role: 'Approved by', name: 'B' }, null] } });
  assert.deepEqual(listed.doc.header.signatories.map((s) => [s.role, s.name]), [['Issued by', 'A'], ['Approved by', 'B']]);
  assert.ok(listed.problems.some((p) => /Header signatories: entry 3 is null/.test(p)));
  const legacy = importAuthoring({ format: 'tsw-authoring/1', header: { title: 'T', preparedBy: 'M. Rossi', approvedBy: 'L. Verdi' } });
  assert.deepEqual(legacy.doc.header.signatories.map((s) => [s.role, s.name]), [['Prepared by', 'M. Rossi'], ['Approved by', 'L. Verdi']]);
  // A file that says nothing keeps the three empty rows a cover starts with.
  const none = importAuthoring({ format: 'tsw-authoring/1', header: { title: 'T' } });
  assert.deepEqual(none.doc.header.signatories.map((s) => s.role), ['Prepared by', 'Checked by', 'Approved by']);
});

test('a comparison EQT with no nominal stays a nominal criterion, empty and said', () => {
  const result = importAuthoring({
    format: 'tsw-authoring/1',
    stages: [{ key: 'S', name: 'S', tests: [{ name: 'T', steps: [{ key: 'M', type: 'measurement', description: 'measure', measurement: { expected: { comparison: 'EQT', min: '1', max: '2', unit: 'V' } } }] }] }],
  });
  const e = result.doc.stages[0].tests[0].steps[0].measurement.expected;
  assert.equal(e.mode, 'nominal');
  assert.equal(e.comparison, 'EQT');
  assert.equal(e.nominal.value, '');
  assert.ok(result.problems.some((p) => /EQT .*no nominal/.test(p)));
});

test('a variant value for a range sets both ends, and one bare value is said to set only one', () => {
  const result = importAuthoring({
    format: 'tsw-authoring/1',
    variables: [{ key: 'T', name: 'Temp', type: 'range', min: '10', max: '30', unit: '°C' }, { key: 'U', name: 'Hum', type: 'range', min: '20', max: '80' }],
    variants: [{ key: 'HOT', name: 'Hot', variableValues: { T: { min: '40', max: '60' }, U: '50' } }],
  });
  const ops = result.doc.variants[0].overlay.map((o) => [o.path[2], o.value]);
  assert.deepEqual(ops, [['min', '40'], ['max', '60'], ['min', '50']]);
  assert.ok(result.problems.some((p) => /«U» is a range/.test(p)));
});

test('a null or a bare string where an entity was expected is skipped and said, never thrown on', () => {
  const result = importAuthoring({
    format: 'tsw-authoring/1',
    resources: [null, { key: 'PSU', name: 'Power supply' }],
    stages: [null, 'POWER_UP', { key: 'STG', name: 'Stage', tests: [null, { name: 'T', steps: [42, { key: 'S1', description: 'ok', stimulus: { resource: 'PSU', parameters: [null] } }] }] }],
    variants: [null],
  });
  assert.equal(result.doc.resources.length, 1);
  assert.equal(result.doc.stages.length, 1);
  assert.equal(result.doc.stages[0].tests.length, 1);
  assert.equal(result.doc.stages[0].tests[0].steps.length, 1);
  assert.equal(result.doc.stages[0].tests[0].steps[0].stimulus.resourceId, result.doc.resources[0].id);
  // Every skipped entry is accounted for, with where it was.
  const skipped = result.problems.filter((p) => /was skipped/.test(p));
  assert.equal(skipped.length, 7);
  assert.ok(skipped.some((p) => p.startsWith('Stages: entry 2 is a string')));
  assert.ok(skipped.some((p) => p.startsWith('Test «T» steps: entry 1 is a number')));
});
import { validateDocument, SEVERITY } from '../src/model/validate.js';
import { computeCodes } from '../src/model/codes.js';
import { resourceSummary } from '../src/model/resources.js';
import { STAGE_KIND, STEP_TYPE, SCHEMA_VERSION, emptyDocument } from '../src/model/schema.js';
import { exportEnvelope, inspect } from '../src/io/format.js';
import { APP_NAME, APP_VERSION } from '../src/version.js';
import { expectedText, variableIndex } from '../src/model/variables.js';
import { applyOverlay } from '../src/model/variants.js';

const guideExample = async () =>
  JSON.parse(await readFile(new URL('../docs/example-spec.json', import.meta.url), 'utf8'));

test('the example of the guide imports without a single problem worth reporting', async () => {
  const { doc, problems } = importAuthoring(await guideExample());
  // The only expected remarks are the image declared without its file, and the line saying
  // that what the example's conversion block left out went to the margin.
  assert.equal(problems.length, 2);
  assert.match(problems[0], /image is declared without a file/);
  assert.match(problems[1], /1 item left out of the conversion: it is in the margin/);
  assert.deepEqual(validateDocument(doc).issues.filter((i) => i.severity === SEVERITY.ERROR), []);
});

test('what a conversion left out is a note in the margin of the test description, not a paragraph of it', async () => {
  const { doc, notes } = importAuthoring(await guideExample());
  // The document keeps what is signed: the description ends where the author ended it.
  assert.match(doc.description.testing, /Every measurement is taken at room temperature\.$/);
  assert.ok(!/Converted from|Left out/.test(doc.description.testing));
  const left = notes.filter((n) => n.kind === 'leftOut');
  assert.equal(left.length, 1);
  assert.equal(left[0].name, '§ 3, Figure 1');
  assert.equal(left[0].text, 'the drawing of the bench with the probe positions — a picture; declared as image BOARD, to be uploaded and marked by hand');
  assert.deepEqual(left[0].anchor, { id: 'chap-testing', fraction: 0 });
  // The source stated its own reason, so the record keeps it.
  assert.equal(doc.revision.reason, 'Converted from SPC-TEST-0042 Rev. 07 (PDF)');
});

test('a conversion block names its source in the revision record when the file gives no reason, and its remarks become a note', () => {
  const { doc, problems, notes } = importAuthoring({
    format: 'tsw-authoring/1',
    stages: [],
    conversion: { source: 'NORME_COLL rev 6 (PDF)', leftOut: [], notes: 'Chapters 1–3 in this pass.' },
  });
  assert.equal(doc.revision.reason, 'Converted from NORME_COLL rev 6 (PDF)');
  assert.equal(doc.description.testing, '');
  assert.deepEqual(notes.map((n) => [n.kind, n.name, n.text, n.anchor.id]), [['free', 'Import', 'Chapters 1–3 in this pass.', 'chap-testing']]);
  // Nothing left out: nothing to look at, and no line saying so.
  assert.ok(!problems.some((p) => /left out/i.test(p)));
});

test('a conversion block with nothing in it changes nothing', () => {
  const { doc, notes } = importAuthoring({ format: 'tsw-authoring/1', stages: [], conversion: {} });
  assert.equal(doc.description.testing, '');
  assert.equal(doc.revision.reason, 'First issue');
  assert.deepEqual(notes, []);
});

test('a «TO CHECK:» or «CONDITION:» line leaves the field it was written in and becomes a note on that element; «TIMING:» stays', () => {
  const { doc, notes } = importAuthoring({
    format: 'tsw-authoring/1',
    variables: [{ key: 'SPL', name: 'SPL', type: 'number', unit: 'dB', value: '85', description: 'Sound pressure level.\nTO CHECK: the acceptable value is under evaluation.' }],
    resources: [{ key: 'PSU', name: 'Supply', notes: 'to check: the source states no characteristic for it.' }],
    points: [{ key: 'KL15', name: 'KL15', notes: 'TO CHECK: shown only in a drawing.' }],
    commands: [{ key: 'VER', name: 'read version', notes: 'TO CHECK: which frame carries it.\nAnswer within 100 ms.' }],
    stages: [{ key: 'S', name: 'S', description: 'CONDITION: front-only units.', tests: [{ name: 'Sound', purpose: 'Verify the sound.\nTO CHECK: the source says «rear».', steps: [
      { description: 'listen', note: 'TIMING: within 500 ms of KL15.\nTO CHECK: who judges the sound.\nCONDITION: only when the speaker is fitted.', stimulus: { description: 'x' } },
    ] }] }],
  });
  const kinds = (id) => notes.filter((n) => n.anchor.id === 'ref-' + id).map((n) => [n.kind, n.text]);
  const [stage] = doc.stages;
  const [test_] = stage.tests;
  const [step] = test_.steps;
  assert.equal(doc.variables[0].description, 'Sound pressure level.');
  assert.deepEqual(kinds(doc.variables[0].id), [['toCheck', 'the acceptable value is under evaluation.']]);
  assert.equal(doc.resources[0].notes, '');
  assert.deepEqual(kinds(doc.resources[0].id), [['toCheck', 'the source states no characteristic for it.']]);
  assert.deepEqual(kinds(doc.points[0].id), [['toCheck', 'shown only in a drawing.']]);
  assert.equal(doc.commands[0].notes, 'Answer within 100 ms.');
  assert.equal(stage.description, '');
  assert.deepEqual(kinds(stage.id), [['condition', 'front-only units.']]);
  assert.equal(test_.purpose, 'Verify the sound.');
  assert.deepEqual(kinds(test_.id), [['toCheck', 'the source says «rear».']]);
  // The timing is a requirement of the test: it stays, alone now, in the step.
  assert.equal(step.note, 'TIMING: within 500 ms of KL15.');
  assert.deepEqual(kinds(step.id), [['toCheck', 'who judges the sound.'], ['condition', 'only when the speaker is fitted.']]);
  // Every note a conversion brings is signed by the import and coloured by its kind.
  assert.ok(notes.every((n) => n.name === 'Import' && n.color && n.anchor.fraction === 0));
  assert.notEqual(notes.find((n) => n.kind === 'toCheck').color, notes.find((n) => n.kind === 'condition').color);
});

test('a marker in the middle of a sentence is the sentence\'s business, and an empty marker line is dropped', () => {
  const { kept, found } = liftNoteLines('The limit is 8 %. TO CHECK: or is it?\nTO CHECK:\n  to check: the second reading\nplain line');
  assert.equal(kept, 'The limit is 8 %. TO CHECK: or is it?\nplain line');
  assert.deepEqual(found, [{ kind: 'toCheck', text: 'the second reading' }]);
  assert.deepEqual(liftNoteLines(''), { kept: '', found: [] });
  assert.deepEqual(liftNoteLines(null), { kept: '', found: [] });
});

test('a data export brings no notes: those travel in their own file', () => {
  const { notes } = importData(exportEnvelope({ doc: emptyDocument(), history: null, assets: {} }));
  assert.deepEqual(notes, []);
});

test('keys become references: points, resources, commands and called stages', async () => {
  const { doc } = importAuthoring(await guideExample());
  const codes = computeCodes(doc);

  const setup = doc.stages.find((s) => s.kind === STAGE_KIND.SETUP);
  const stage = doc.stages.find((s) => s.kind === STAGE_KIND.TEST);
  assert.equal(codes.get(setup.id), 'SET-01');
  assert.equal(codes.get(stage.id), 'STG-01');

  const call = stage.tests[0].steps[0];
  assert.equal(call.type, STEP_TYPE.STAGE_CALL);
  assert.equal(call.calledStageId, setup.id);

  const apply = setup.tests[0].steps[0];
  assert.equal(apply.stimulus.pointIds.length, 2);
  assert.equal(apply.stimulus.pointIds[0], doc.points[0].id);
  assert.equal(apply.stimulus.resourceId, doc.resources[0].id);
  assert.deepEqual(apply.wait.value, { mode: 'constant', value: '2' });

  const read = stage.tests[0].steps[2];
  assert.equal(read.measurement.commandId, doc.commands[0].id);
  assert.equal(doc.commands[0].interfaceId, doc.interfaces[0].id);
});

test('a $name value becomes a reference to that variable', async () => {
  const { doc } = importAuthoring(await guideExample());
  const variables = variableIndex(doc);
  const setup = doc.stages.find((s) => s.kind === STAGE_KIND.SETUP);
  const voltage = setup.tests[0].steps[0].stimulus.parameters[0];
  assert.equal(voltage.value.mode, 'variable');
  assert.equal(variables.get(voltage.value.variableId).name, 'Vbatt');

  const stage = doc.stages.find((s) => s.kind === STAGE_KIND.TEST);
  assert.match(expectedText(stage.tests[0].steps[1].measurement, variables), /0 mA … 45 mA \(IquiescentMax\)/);
  assert.match(expectedText(stage.tests[0].steps[2].measurement, variables), /13\.5 V \(Vbatt\) ± 5 %/);
});

test('held stimuli and marker coordinates survive the import', async () => {
  const { doc } = importAuthoring(await guideExample());
  const setup = doc.stages.find((s) => s.kind === STAGE_KIND.SETUP);
  assert.equal(setup.heldStimuli.length, 1);
  assert.equal(setup.heldStimuli[0].stepId, setup.tests[0].steps[0].id);

  const point = doc.points[0];
  assert.equal(point.markers.length, 1);
  assert.equal(point.markers[0].imageId, doc.images[0].id);
  assert.equal(point.markers[0].x, 0.69);
});

test('what the setup stage uses is already charged to its caller', async () => {
  const { doc } = importAuthoring(await guideExample());
  const stage = doc.stages.find((s) => s.kind === STAGE_KIND.TEST);
  const { rows } = resourceSummary(doc);
  const psu = rows.find((r) => r.resource.id === doc.resources[0].id);
  assert.equal(psu.channelsPerStage.get(stage.id), 2);
  assert.deepEqual(psu.points, [doc.points[0].id, doc.points[1].id]);
});

test('a variant turns into overlay operations', async () => {
  const { doc } = importAuthoring(await guideExample());
  const v24 = doc.variants.find((v) => v.name.includes('24'));
  assert.equal(v24.overlay.length, 2);
  const resolved = applyOverlay(doc, v24).doc;
  assert.equal(resolved.variables.find((v) => v.name === 'Vbatt').value, '27');
});

test('unknown keys are reported, and the rest is imported anyway', () => {
  const { doc, problems } = importAuthoring({
    stages: [{
      key: 'S1', name: 'One',
      prerequisites: ['NOWHERE'],
      tests: [{ name: 'T', steps: [{ description: 'x', stimulus: { description: 'y', points: ['GHOST'], resource: 'GONE' } }] }],
    }],
  });
  assert.equal(doc.stages.length, 1);
  assert.equal(doc.stages[0].tests[0].steps.length, 1);
  assert.equal(doc.stages[0].prerequisites.length, 0);
  assert.equal(problems.filter((p) => /unknown/.test(p)).length, 3);
});

test('duplicate keys are reported', () => {
  const { problems } = importAuthoring({
    resources: [{ key: 'PSU', name: 'One' }, { key: 'psu', name: 'Two' }],
    stages: [],
  });
  assert.ok(problems.some((p) => /Duplicate resource key/.test(p)));
});

test('a data export is recognised and passes straight through', async () => {
  const { doc } = importAuthoring(await guideExample());
  const result = importData(exportEnvelope({ doc, history: { revisions: [] }, assets: {} }));
  assert.equal(result.problems.length, 0);
  assert.equal(result.doc.stages.length, doc.stages.length);
  assert.equal(isAuthoringFormat({ doc }), false);
  assert.equal(isAuthoringFormat({ format: 'tsw-authoring/1', stages: [] }), true);
});

// ---- the version of the format ------------------------------------------------

test('the envelope of an export says what it is and who wrote it', () => {
  const envelope = exportEnvelope({ doc: emptyDocument(), history: { revisions: [] }, assets: {} });
  assert.equal(envelope.format, 'tsw-export/1');
  assert.equal(envelope.application, APP_NAME);
  assert.equal(envelope.applicationVersion, APP_VERSION);
  assert.equal(envelope.schemaVersion, SCHEMA_VERSION);
  assert.match(envelope.exported, /^\d{4}-\d{2}-\d{2}$/);
});

test('a file with no version is read as the current one, and says so', () => {
  const legacy = { doc: emptyDocument(), history: { revisions: [] }, assets: {} };
  const result = importData(legacy);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /carries no version/);
  assert.equal(result.doc.schemaVersion, SCHEMA_VERSION);
});

test('a document written against an older data schema is upgraded, and the upgrade is reported', () => {
  const old = emptyDocument();
  old.schemaVersion = 0;
  old.stages = [{ id: 'stg_aaaaaa', name: 'A', tests: [] }]; // no «kind»: it predates setup stages
  const result = importData({ format: 'tsw-export/1', doc: old });
  assert.equal(result.doc.stages[0].kind, 'test');
  assert.equal(result.doc.schemaVersion, SCHEMA_VERSION);
  assert.ok(result.problems.some((p) => /upgraded from data schema 0 to 1/i.test(p)));
});

test('a format newer than this build is refused, with the reason', () => {
  assert.throws(() => importData({ format: 'tsw-authoring/7', stages: [] }), /only reads up to tsw-authoring\/1/);
  assert.throws(() => importData({ format: 'tsw-export/9', doc: emptyDocument() }), /only reads up to tsw-export\/1/);
  const future = emptyDocument();
  future.schemaVersion = 99;
  assert.throws(() => importData({ format: 'tsw-export/1', doc: future }), new RegExp(`understands up to ${SCHEMA_VERSION}`));
});

test('something that is neither format is refused rather than guessed at', () => {
  assert.throws(() => importData({ hello: 'world' }), /resembles neither/);
  assert.throws(() => importData({ format: 'something-else/1', stages: [] }), /Unknown format/);
  assert.throws(() => importData('a string'), /does not contain a JSON object/);
});

test('inspect tells the two formats apart and reports what it found', () => {
  assert.equal(inspect({ format: 'tsw-authoring/1', stages: [] }).kind, 'authoring');
  assert.equal(inspect({ stages: [] }).kind, 'authoring');
  assert.equal(inspect(exportEnvelope({ doc: emptyDocument(), history: {}, assets: {} })).kind, 'export');
  assert.equal(inspect({ doc: emptyDocument() }).kind, 'export');
  assert.equal(inspect({ format: 'tsw-export/2', doc: {} }).readable, false);
});

test('«sequential» chains the test stages, and an explicit prerequisite still wins', () => {
  const source = {
    stageOrder: 'sequential',
    stages: [
      { key: 'A', name: 'A', tests: [] },
      { key: 'B', name: 'B', tests: [] },
      { key: 'C', name: 'C', prerequisites: ['A'], tests: [] },
      { key: 'ROUTINE', kind: 'setup', name: 'Routine', tests: [] },
    ],
  };
  const { doc, problems } = importAuthoring(source);
  const byName = (n) => doc.stages.find((s) => s.name === n);
  const nameOfPrereq = (s) => (s.prerequisites || []).map((id) => doc.stages.find((x) => x.id === id).name);

  assert.deepEqual(nameOfPrereq(byName('A')), []);
  assert.deepEqual(nameOfPrereq(byName('B')), ['A']);
  assert.deepEqual(nameOfPrereq(byName('C')), ['A']);   // declared, so it is kept
  assert.deepEqual(nameOfPrereq(byName('Routine')), []); // setup stages stay out of the sequence
  assert.ok(problems.some((p) => /chained to the one before/.test(p)));
});

test('without «sequential» the stages keep exactly the prerequisites they declare', () => {
  const { doc, problems } = importAuthoring({
    stages: [{ key: 'A', name: 'A', tests: [] }, { key: 'B', name: 'B', tests: [] }],
  });
  assert.deepEqual(doc.stages[1].prerequisites, []);
  assert.equal(problems.some((p) => /chained/.test(p)), false);
});

test('the header disclaimer and the reading options come across', () => {
  const result = importData({
    format: 'tsw-authoring/1',
    settings: { noDirectEditing: true },
    header: { title: 'Converted', disclaimer: 'Property of Acme.' },
    stages: [],
  });
  assert.equal(result.doc.header.disclaimer, 'Property of Acme.');
  assert.equal(result.doc.settings.noDirectEditing, true);
});

test('a file that says nothing about the reading options keeps the defaults', () => {
  const result = importData({ format: 'tsw-authoring/1', header: { title: 'Plain' }, stages: [] });
  assert.equal(result.doc.settings.noDirectEditing, false);
  assert.equal(result.doc.header.disclaimer, '');
});

test('an interface carries the points it is wired to, and a command its time and refusal', () => {
  const result = importData({
    format: 'tsw-authoring/1',
    header: { title: 'Converted' },
    points: [{ key: 'CAN', name: 'CAN bus', connector: 'J1', pin: '6' }],
    interfaces: [{ key: 'BUS', name: 'Vehicle CAN', type: 'CAN 2.0B', points: ['CAN'] }],
    commands: [{
      key: 'READ', name: 'Read voltage', interface: 'BUS',
      responseFormat: '62 F1 90', negativeResponse: '7F 22 31', nominalTime: '0.25',
    }],
    resources: [{ key: 'PSU', name: 'Supply', averageTime: '1.5' }],
    stages: [],
  });
  const [itf] = result.doc.interfaces;
  const [command] = result.doc.commands;
  assert.equal(itf.pointIds.length, 1);
  assert.equal(itf.pointIds[0], result.doc.points[0].id);
  assert.equal(command.negativeResponse, '7F 22 31');
  assert.equal(command.nominalTime, '0.25');
  assert.equal(result.doc.resources[0].averageTime, '1.5');
});

test('a protocol declared in the authoring format is imported and linked, not thrown at', () => {
  // The importer kept no key register for protocols, so the first one declared crashed the
  // whole import — which is every file written to the guide, since the guide documents them.
  const { doc, problems } = importAuthoring({
    protocols: [{ key: 'UDS', name: 'Unified diagnostic services', family: 'ISO 14229' }],
    interfaces: [{ key: 'CAN', name: 'CAN bus' }],
    commands: [
      { key: 'READ_FW', name: 'Read firmware', interface: 'CAN', protocol: 'UDS' },
      { key: 'PING', name: 'Ping', interface: 'CAN', protocol: 'NOT_THERE' },
    ],
  });
  assert.equal(doc.protocols.length, 1);
  assert.equal(doc.commands[0].protocolId, doc.protocols[0].id);
  // An unknown key is reported the way every other one is, by its own name.
  assert.equal(doc.commands[1].protocolId, '');
  assert.deepEqual(problems, ['Command «Ping»: unknown protocol «NOT_THERE».']);
});
