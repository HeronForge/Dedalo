// Data model of the test specification and constructors for every entity.
import { newId } from './ids.js';

export const SCHEMA_VERSION = 2;

export const STEP_TYPE = {
  STIMULUS: 'stimulus',
  MEASUREMENT: 'measurement',
  STIMULUS_MEASUREMENT: 'stimulusMeasurement',
  STAGE_CALL: 'stageCall',
  // A matrix: rows of input combinations, columns of what is applied and what is read. Real
  // specifications write half their tests this way — six levels of one output, eight relay
  // states, one reading per channel — and flattened into steps they were unreadable.
  TABLE: 'table',
};

export const STEP_TYPE_LABEL = {
  stimulus: 'Stimulus',
  measurement: 'Measurement',
  stimulusMeasurement: 'Stimulus + measurement',
  stageCall: 'Stage call',
  table: 'Table (rows of inputs, columns of outputs)',
};

export const STEP_TYPE_SHORT = {
  stimulus: 'STIM',
  measurement: 'MEAS',
  stimulusMeasurement: 'STIM+MEAS',
  stageCall: 'CALL',
  table: 'TABLE',
};

export const VARIABLE_TYPE = {
  NUMBER: 'number',
  TEXT: 'text',
  ENUM: 'enum',
  BOOLEAN: 'boolean',
  RANGE: 'range',
};

export const VARIABLE_TYPE_LABEL = {
  number: 'Number with unit',
  text: 'Text',
  enum: 'Enumeration',
  boolean: 'Boolean',
  range: 'Range (min/max)',
};

export const EXCLUSION_MODE = { NONE: 'none', ALL: 'all', LIST: 'list' };

/**
 * Two kinds of stage, and the difference matters all the way through the document.
 *  - TEST: a stage of the test sequence. It runs once, in the order its prerequisites allow.
 *  - SETUP: a routine that runs only when a step calls it, as many times as it is called
 *    (power on, power off, load configuration…). It has no place of its own in the sequence.
 */
export const STAGE_KIND = { TEST: 'test', SETUP: 'setup' };

export const STAGE_KIND_LABEL = {
  test: 'Test stage',
  setup: 'Setup stage (runs only when called)',
};

/** Value reference: either a constant or a pointer to a global variable. */
export const constant = (value = '') => ({ mode: 'constant', value });
export const variableRef = (variableId) => ({ mode: 'variable', variableId });

export function emptyDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    header: {
      title: 'Test specification',
      company: '',
      logoAssetId: '',
      project: '',
      product: '',
      documentCode: '',
      confidentiality: 'Confidential – internal use',
      disclaimer: '',
      // Who signs, as a list: the three roles every document starts with are the least a
      // cover carries, and the real ones carry eight, with departments.
      signatories: defaultSignatories(),
    },
    /**
     * How the document behaves for whoever opens it, as opposed to what it says.
     * `noDirectEditing` cuts the link between a reference in the document and the editor:
     * a specification handed to a production line is there to be read, not stepped into.
     */
    settings: { noDirectEditing: false, chapterOrder: [] },
    revision: { number: '00', date: today(), author: '', reason: 'First issue', status: 'draft' },
    description: { product: '', testing: '' },
    references: [],
    variables: [],
    protocols: [],
    variants: [],
    resources: [],
    interfaces: [],
    commands: [],
    points: [],
    images: [],
    // What the acronyms of the text stand for: a chapter of its own, printed when it has a line.
    glossary: [],
    stages: [],
  };
}

/** One line of the glossary: the term as the text writes it, and what it stands for. */
export const newGlossaryEntry = (term = '', meaning = '') => ({ id: newId('gls'), term, meaning });

export const today = () => new Date().toISOString().slice(0, 10);

/**
 * One line of the signature table on the cover. `role` is what the column is headed with —
 * «Prepared by», «Verified by (SW)» — and `name` who signs under it.
 */
export const newSignatory = (role = '', name = '') => ({ id: newId('sig'), role, name });

/** The three columns a cover has always had, and what a new document starts with. */
export const defaultSignatories = () => [newSignatory('Prepared by'), newSignatory('Checked by'), newSignatory('Approved by')];

export const newReference = () => ({ id: newId('ref'), title: '', code: '', revision: '', notes: '' });

export const newVariable = () => ({
  id: newId('var'), name: '', type: VARIABLE_TYPE.NUMBER, unit: '',
  value: '', min: '', max: '', allowedValues: [], description: '',
});

export const newVariant = () => ({ id: newId('vnt'), name: '', description: '', overlay: [] });

/**
 * `averageTime` is the seconds the instrument typically holds the bench for one use. It is
 * not part of the specification — nobody signs off a mean — so it is written and read in the
 * cycle time estimator alone, and travels with the resource because that is what it belongs to.
 */
export const newResource = () => ({ id: newId('res'), name: '', category: '', characteristics: [], notes: '', averageTime: '' });

/**
 * An interface is wired to the unit somewhere: `pointIds` are the application points it needs.
 * A step that talks over a command borrows them the way a step that calls a setup stage
 * borrows what that stage uses — the bench has to reach those contacts for the step to run.
 */
export const newInterface = () => ({
  id: newId('itf'), name: '', type: '', parameters: [], pointIds: [],
  // The bench instrument that speaks this bus. A step that sends a command needs one, and
  // repeating it on every step is how a document ends up disagreeing with itself: it is
  // declared here once, and every command over this interface implies it.
  resourceId: '',
  notes: '',
});

/**
 * A protocol is the grammar the messages on a bus obey — application frames, UDS, Modbus.
 * The commands stay short because it lives here: what a request looks like, what an answer
 * looks like, what has to be respected for either to be understood.
 */
export const newProtocol = () => ({
  id: newId('prt'), name: '', family: '',
  description: '',
  requestFormat: '', responseFormat: '',
  rules: [],
  notes: '',
  // The external document that defines the protocol, when this one only names it.
  referenceId: '',
});

export const newCommand = () => ({
  id: newId('cmd'), name: '', interfaceId: '',
  // Which grammar this command is written in: CAN carries application frames and UDS alike,
  // and a reader who cannot tell them apart cannot build the message.
  protocolId: '',
  address: '',
  requestFormat: '', responseFormat: '',
  // What the unit answers when it refuses: a test that cannot tell «no» from silence is a
  // test that reports the wrong failure.
  negativeResponse: '',
  encoding: '', example: '', notes: '',
  // Seconds the command typically takes end to end, used by the cycle time estimator.
  nominalTime: '',
  // Where the command is defined when it is not defined here: half the commands of a real
  // specification live in an interface control document, and a row that says so is worth
  // more than an empty request format.
  referenceId: '',
  // How the raw answer becomes the value a step judges — «hex → U32, − 3072, ÷ 51.15» in
  // mA — written for a person. Its unit is what a criterion over this command is read in
  // when the criterion states none.
  decoding: { formula: '', unit: '' },
});

/** The decoding of a command, defaulted for the commands written before the field existed. */
export const commandDecoding = (command) => ((command || {}).decoding && typeof command.decoding === 'object' ? command.decoding : { formula: '', unit: '' });

export const newPoint = () => ({
  id: newId('pt'), name: '', connector: '', pin: '', signal: '', contactType: '',
  characteristics: [], markers: [], notes: '',
});

/**
 * What a measurement is judged as. A specification does not only measure volts: it reads back
 * a firmware string and it answers yes or no, and those are not numbers with a unit.
 *
 * Absent, a criterion is numeric — which is what every document written before this meant.
 */
export const EXPECTED_KIND = { NUMERIC: 'numeric', STRING: 'string', BOOLEAN: 'boolean' };

export const EXPECTED_KIND_LABEL = {
  numeric: 'Numeric',
  string: 'Text',
  boolean: 'Yes / no',
};

/**
 * The mark under a criterion: what kind of answer is being judged, in four words nobody has
 * to look up. A pattern is called out apart from plain text because reading «Abc» where a
 * regular expression is meant would send somebody comparing the pattern literally.
 */
export const expectedBadge = (expected) => {
  const kind = expectedKind(expected);
  if (kind === EXPECTED_KIND.BOOLEAN) return 'DGT';
  if (kind === EXPECTED_KIND.STRING) return (expected || {}).regex ? 'RegEx' : 'Abc';
  return '123';
};

/** Said only when it is not the default: silence means the comparison is case sensitive. */
export const expectedCaseNote = (expected) =>
  (expectedKind(expected) === EXPECTED_KIND.STRING && (expected || {}).caseSensitive === false
    ? 'not case sensitive'
    : '');

export const expectedKind = (expected) => {
  const k = (expected || {}).kind;
  return k === EXPECTED_KIND.STRING || k === EXPECTED_KIND.BOOLEAN ? k : EXPECTED_KIND.NUMERIC;
};

/**
 * How a text answer is compared. The regular expression is a flag rather than a comparison of
 * its own: whether a pattern is matched is a property of the value, not of the operator, and
 * keeping them apart means «contains» and «matches» cannot be chosen at the same time by
 * mistake.
 */
export const STRING_COMPARISON = {
  EQ: { label: 'Equal to', condition: 'Text = Value', symbol: '=' },
  NE: { label: 'Not equal to', condition: 'Text ≠ Value', symbol: '≠' },
  CONTAINS: { label: 'Contains', condition: 'Text contains Value', symbol: 'contains' },
  STARTS: { label: 'Starts with', condition: 'Text starts with Value', symbol: 'starts with' },
  ENDS: { label: 'Ends with', condition: 'Text ends with Value', symbol: 'ends with' },
};

/**
 * What a text criterion compares against: a constant written in the step, or a global
 * variable — the same choice a numeric limit has always had. A firmware release named once
 * and read in four steps is one value to change, not four.
 *
 * Documents written before this wrote a plain string here; it is read as a constant, so
 * nothing has to be migrated and an older build still reads what this one writes.
 */
export const expectedTextRef = (expected) => {
  const t = (expected || {}).text;
  return t && typeof t === 'object' ? t : constant(t == null ? '' : String(t));
};

export const stringComparisonOf = (expected) =>
  (STRING_COMPARISON[(expected || {}).stringComparison] ? expected.stringComparison : 'EQ');

/**
 * Comparison types for a numeric measurement: the set TestStand uses, with its own codes.
 *
 * They are optional. A criterion with no `comparison` keeps the meaning it always had — both
 * limits filled means «between them, inclusive», one limit alone means «at least» or «at
 * most» — so nothing has to be migrated and an older build reads these documents unchanged.
 *
 * The threshold of a one sided comparison lives in the field that carries its direction:
 * `min` for the ones that bound from below, `max` for the ones that bound from above. An
 * older build reading such a file still shows «≥ x» or «≤ x», which is the truth.
 *
 * `sides`: 1 one limit · 2 two limits · 0 no limit at all.
 * `outside`: the value passes *outside* the two limits, not between them.
 */
export const COMPARISON = {
  EQ: { code: '==', condition: 'Value = Limit', sides: 1, slot: 'min' },
  GELE: { code: '>=<=', condition: 'Low ≤ Value ≤ High', sides: 2, low: '≥', high: '≤' },
  EQT: { code: '==+/-', condition: 'Nominal − Tol ≤ Value ≤ Nominal + Tol', sides: 2, mode: 'nominal' },
  NE: { code: '!=', condition: 'Value ≠ Limit', sides: 1, slot: 'min' },
  GT: { code: '>', condition: 'Value > Limit', sides: 1, slot: 'min' },
  LT: { code: '<', condition: 'Value < Limit', sides: 1, slot: 'max' },
  GE: { code: '>=', condition: 'Value ≥ Limit', sides: 1, slot: 'min' },
  LE: { code: '<=', condition: 'Value ≤ Limit', sides: 1, slot: 'max' },
  GTLT: { code: '><', condition: 'Low < Value < High', sides: 2, low: '>', high: '<' },
  GELT: { code: '>=<', condition: 'Low ≤ Value < High', sides: 2, low: '≥', high: '<' },
  GTLE: { code: '><=', condition: 'Low < Value ≤ High', sides: 2, low: '>', high: '≤' },
  LTGT: { code: '<>', condition: 'Value < Low or Value > High', sides: 2, outside: true, low: '<', high: '>' },
  LEGE: { code: '<=>=', condition: 'Value ≤ Low or Value ≥ High', sides: 2, outside: true, low: '≤', high: '≥' },
  LEGT: { code: '<=>', condition: 'Value ≤ Low or Value > High', sides: 2, outside: true, low: '≤', high: '>' },
  LTGE: { code: '<>=', condition: 'Value < Low or Value ≥ High', sides: 2, outside: true, low: '<', high: '≥' },
  NONE: { code: 'no comparison', condition: 'the value is recorded, nothing is judged', sides: 0 },
};

/** Codes written by an earlier build, kept readable. */
const COMPARISON_ALIAS = { GELI: 'GELE' };

/** The comparison of a criterion, inferred when the document does not state one. */
export function comparisonOf(expected) {
  const e = expected || {};
  const declared = COMPARISON_ALIAS[e.comparison] || e.comparison;
  if (e.mode === STEP_EXPECTED.NOMINAL) return 'EQT';
  if (COMPARISON[declared] && declared !== 'EQT') return declared;
  const low = filled(e.min);
  const high = filled(e.max);
  if (low && high) return 'GELE';
  if (low) return 'GE';
  if (high) return 'LE';
  return 'GELE';
}

const filled = (ref) => !!(ref && (ref.mode === 'variable' ? ref.variableId : String(ref.value ?? '').trim() !== ''));

export const STEP_EXPECTED = { LIMITS: 'minmax', NOMINAL: 'nominal' };

/**
 * A marker is where the point is touched, plus how much of the picture is worth looking at
 * around it: `area` is the fraction of the image the detail view crops to (1 = the whole
 * picture). It is what turns a dot on a board photograph into something one can act on.
 */
export const newMarker = (imageId, x, y) => ({ id: newId('mk'), imageId, x, y, area: DEFAULT_MARKER_AREA });

export const DEFAULT_MARKER_AREA = 0.3;

/** The area of a marker, defaulted for the markers written before the field existed. */
export const markerArea = (marker) => {
  const a = Number((marker || {}).area);
  return a > 0 && a <= 1 ? a : DEFAULT_MARKER_AREA;
};

export const newImage = (assetId, name) => ({ id: newId('img'), name: name || '', assetId, caption: '' });

export const newCharacteristic = () => ({ id: newId('chr'), name: '', value: '', unit: '' });

export const newParameter = () => ({ id: newId('par'), name: '', value: constant(''), unit: '' });

export const newStage = (kind = STAGE_KIND.TEST) => ({
  id: newId('stg'), name: '', description: '', kind,
  prerequisites: [], exclusions: { mode: EXCLUSION_MODE.NONE, stageIds: [] },
  heldStimuli: [], tests: [],
});

/**
 * `kpi` marks a test whose result is followed line-side as a key performance indicator:
 * yield, cycle time, a value trended over production. It changes nothing about how the test
 * runs — it says that somebody watches this one, and it gathers them into one appendix.
 */
export const newTest = () => ({ id: newId('tc'), name: '', purpose: '', kpi: false, steps: [] });

/**
 * What a half of a step is called on the page. A command is a different act from a probe on
 * a pad — one writes to the unit and reads it back over a bus, the other touches it — and
 * calling both APPLY was what made commands hard to pick out.
 */
export const BLOCK_TAG = {
  stimulus: { plain: 'APPLY', command: 'SET' },
  measurement: { plain: 'MEASURE', command: 'GET' },
};

export const blockTag = (kind, block) =>
  (kind === 'measurement' && isComputed(block) ? 'COMPUTED' : BLOCK_TAG[kind][(block || {}).commandId ? 'command' : 'plain']);

/**
 * A measurement computed from earlier readings — «error = (meter − reference) / reference» —
 * touches no instrument and no contact: its inputs are steps of the same test that came
 * before it, and its formula is written as the specification writes it, for a person. It is
 * a measurement all the same, judged by the ordinary criterion.
 */
export const newComputed = () => ({ formula: '', inputStepIds: [] });

export const isComputed = (measurement) => !!(measurement && measurement.computed);

export const newStimulus = () => ({ description: '', pointIds: [], resourceId: '', parameters: [], commandId: '' });

/** An acceptance criterion with nothing in it yet: what a measurement and a table cell start from. */
export const newExpected = () => ({
  // Numeric unless said otherwise: what every document written before this meant.
  kind: EXPECTED_KIND.NUMERIC,
  mode: 'minmax', min: constant(''), max: constant(''),
  nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: '',
  // Text
  text: constant(''), stringComparison: 'EQ', caseSensitive: true, regex: false,
  // Yes / no
  booleanValue: 'true',
});

export const newMeasurement = () => ({
  description: '', pointIds: [], resourceId: '', parameters: [], commandId: '',
  expected: newExpected(),
});

/**
 * The table step. The columns are declared once and shared by every row: that is what keeps
 * points, instruments and commands from being repeated per row, and what makes the resource
 * count right — a column occupies the bench like a block does. A cell belongs to a column by
 * id, in a list rather than a map keyed by column: the clone repoints values, not keys, and
 * a variant reaches a cell by path.
 */
export const TABLE_COLUMN_KIND = { STIMULUS: 'stimulus', MEASUREMENT: 'measurement' };

export const newTableColumn = (kind = TABLE_COLUMN_KIND.MEASUREMENT) =>
  ({ id: newId('col'), name: '', kind, pointIds: [], resourceId: '', commandId: '', unit: '' });

export const newTableRow = () => ({ id: newId('row'), label: '', cells: [] });

/** A cell for a column: a value to apply, or a criterion to judge, never both. */
export const newTableCell = (column) => (column.kind === TABLE_COLUMN_KIND.STIMULUS
  ? { id: newId('cel'), columnId: column.id, value: constant('') }
  : { id: newId('cel'), columnId: column.id, expected: { ...newExpected(), unit: column.unit || '' } });

/**
 * A step's blocks — what it applies and what it reads — in one shape whatever the step is.
 * An ordinary step has its stimulus and its measurement; a table step has one block per
 * column, and everything that counts points, instruments and commands walks this list.
 * @returns {Array<{kind: string, block: object, column?: object}>}
 */
export function stepBlocks(step) {
  if (!step) return [];
  if (step.type === STEP_TYPE.TABLE) {
    return ((step.table || {}).columns || []).map((c) => ({
      kind: c.kind === TABLE_COLUMN_KIND.STIMULUS ? 'stimulus' : 'measurement',
      block: { description: c.name || '', pointIds: c.pointIds || [], resourceId: c.resourceId || '', commandId: c.commandId || '', parameters: [] },
      column: c,
    }));
  }
  const out = [];
  if (step.stimulus) out.push({ kind: 'stimulus', block: step.stimulus });
  // A computed measurement holds nothing on the bench: it is left out of what counts.
  if (step.measurement && !isComputed(step.measurement)) out.push({ kind: 'measurement', block: step.measurement });
  return out;
}

export function newStep(type = STEP_TYPE.STIMULUS_MEASUREMENT) {
  // The wait is a value like a parameter's: a constant, or a global variable — «wait Ton» is
  // written once in the variables and read by every step that settles on it.
  // `imageId`: the figure a step points at — «see the front panel picture» — printed small
  // beside the step and opened full size on the screen. Optional; most steps have none.
  const s = { id: newId('stp'), description: '', type, wait: { value: constant(''), unit: 's' }, note: '', calledStageId: '', imageId: '' };
  if (type === STEP_TYPE.STIMULUS || type === STEP_TYPE.STIMULUS_MEASUREMENT) s.stimulus = newStimulus();
  if (type === STEP_TYPE.MEASUREMENT || type === STEP_TYPE.STIMULUS_MEASUREMENT) s.measurement = newMeasurement();
  if (type === STEP_TYPE.TABLE) s.table = { columns: [], rows: [] };
  return s;
}

export const newHeldStimulus = () => ({ id: newId('hs'), stepId: '', note: '' });

/**
 * Brings a step in line with its type, dropping whatever no longer belongs to it: a stage call
 * carries no stimulus and no measurement, a stimulus-only step carries no measurement, and so on.
 * Leaving the old block behind would keep it out of the printed document but still inside
 * validation and the resource count, which is worse than losing it.
 */
export function normaliseStepForType(step, type) {
  step.type = type;
  if (type === STEP_TYPE.STAGE_CALL) {
    delete step.stimulus;
    delete step.measurement;
    delete step.table;
    return step;
  }
  step.calledStageId = '';
  if (type === STEP_TYPE.TABLE) {
    delete step.stimulus;
    delete step.measurement;
    if (!step.table) step.table = { columns: [], rows: [] };
    return step;
  }
  delete step.table;
  const wantsStimulus = type === STEP_TYPE.STIMULUS || type === STEP_TYPE.STIMULUS_MEASUREMENT;
  const wantsMeasurement = type === STEP_TYPE.MEASUREMENT || type === STEP_TYPE.STIMULUS_MEASUREMENT;
  if (wantsStimulus) { if (!step.stimulus) step.stimulus = newStimulus(); } else delete step.stimulus;
  if (wantsMeasurement) { if (!step.measurement) step.measurement = newMeasurement(); } else delete step.measurement;
  return step;
}

/**
 * One step per schema version, applied in order to whatever comes in. A document written by an
 * older build must keep opening here, so a version is never dropped from this list: new ones
 * are appended, and `SCHEMA_VERSION` moves with them.
 */
const MIGRATIONS = [
  {
    to: 1,
    what: 'setup stages introduced: every stage without a kind is a test stage',
    apply(doc) {
      for (const stage of doc.stages || []) if (!stage.kind) stage.kind = STAGE_KIND.TEST;
    },
  },
  {
    to: 2,
    what: 'signatories became a list (the three header fields are its first three rows); a wait may follow a variable, so its value became a value reference',
    apply(doc) {
      // Three fields, three rows — a blank name still gets its row, so a cover that never had
      // more than three signatures keeps its three columns.
      const h = doc.header || (doc.header = {});
      if (!Array.isArray(h.signatories)) {
        h.signatories = [
          newSignatory('Prepared by', String(h.preparedBy || '')),
          newSignatory('Checked by', String(h.checkedBy || '')),
          newSignatory('Approved by', String(h.approvedBy || '')),
        ];
      }
      delete h.preparedBy;
      delete h.checkedBy;
      delete h.approvedBy;
      for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
        if (!s.wait) s.wait = { value: constant(''), unit: 's' };
        else if (!s.wait.value || typeof s.wait.value !== 'object') s.wait.value = constant(String(s.wait.value ?? ''));
      }
    },
  },
];

/**
 * Brings a document saved with an older schema up to the current version.
 * @returns {{doc: object, applied: Array<{to: number, what: string}>, from: number}}
 */
export function migrateWithReport(doc) {
  if (!doc || typeof doc !== 'object') return { doc: emptyDocument(), applied: [], from: SCHEMA_VERSION };
  const empty = emptyDocument();
  const out = { ...empty, ...doc };
  out.header = { ...empty.header, ...(doc.header || {}) };
  // The empty header's signatories are defaults for a document that has none, not a floor
  // under a document that has its own — and a schema-1 document has its three fields to
  // turn into rows, which the migration below does.
  if (!Array.isArray((doc.header || {}).signatories)) delete out.header.signatories;
  out.settings = { ...empty.settings, ...(doc.settings || {}) };
  out.revision = { ...empty.revision, ...(doc.revision || {}) };
  out.description = { ...empty.description, ...(doc.description || {}) };

  const from = Number(doc.schemaVersion) || 0;
  const applied = [];
  for (const step of MIGRATIONS) {
    if (from >= step.to) continue;
    step.apply(out);
    applied.push({ to: step.to, what: step.what });
  }
  out.schemaVersion = SCHEMA_VERSION;
  return { doc: out, applied, from };
}

/** Brings a document saved with an older schema up to the current version. */
export const migrate = (doc) => migrateWithReport(doc).doc;
