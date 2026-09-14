// Import from the authoring format.
//
// The authoring format is a flat JSON meant to be written by a person or by a language model
// reading an older specification (see docs/IMPORT-GUIDE.md). It differs from the internal model
// in one respect only: entities refer to each other through readable **keys** ("VBAT", "PSU",
// "POWER_UP") instead of stable ids. This importer creates the ids and resolves the keys, so
// whoever writes the file never has to invent or track an identifier.
//
// Nothing here throws on bad input: unknown keys and unexpected values are collected in
// `problems` and the rest of the document is imported anyway, exactly as validation does.
import {
  emptyDocument, migrate, newReference, newVariable, newVariant, newResource, newInterface,
  newCommand, newProtocol, newPoint, newCharacteristic, newImage, newMarker, newStage, newTest, newStep,
  newParameter, newHeldStimulus, newSignatory, newTableColumn, newTableRow, newTableCell, newComputed, newGlossaryEntry, constant, variableRef, normaliseStepForType,
  STEP_TYPE, TABLE_COLUMN_KIND, VARIABLE_TYPE, EXCLUSION_MODE, STAGE_KIND, COMPARISON,
} from '../model/schema.js';
import { looksLikeSpecification } from './file.js';
import { inspect } from './format.js';
import { migrateWithReport } from '../model/schema.js';
import { OP } from '../model/variants.js';
import { parseCriterion, parseValue as parseCellValue } from '../model/shorthand.js';
import { newNote } from '../model/notes.js';

/** True when the parsed JSON looks like the authoring format rather than a native export. */
export const isAuthoringFormat = (data) => inspect(data).kind === 'authoring';

/**
 * @param {object} data parsed JSON, either the authoring format or a data export
 * @returns {{doc: object, history: object|null, assets: object|null, problems: string[], notes: Array}}
 *   `notes` are what the conversion said beside the document rather than in it — see
 *   `importAuthoring`; a data export carries none, its notes travel in their own file.
 */
export function importData(data) {
  // What the file says it is decides how it is read, and a version this build cannot read
  // stops here rather than half way through.
  const format = inspect(data);
  if (!format.readable) throw new Error(format.reason);

  if (format.kind === 'export') {
    if (!looksLikeSpecification(data.doc))
      throw new Error('The «doc» field of this JSON does not hold a specification: it has neither a schema version nor a list of stages.');
    const { doc, applied, from } = migrateWithReport(data.doc);
    const problems = [...format.notes];
    for (const step of applied) problems.push(`Document upgraded from data schema ${from} to ${step.to}: ${step.what}.`);
    return { doc, history: data.history || null, assets: data.assets || null, problems, notes: [] };
  }

  const { doc, problems, notes } = importAuthoring(data);
  return { doc, history: null, assets: null, problems: [...format.notes, ...problems], notes };
}

/**
 * Reads an authoring file into a document.
 *
 * The document keeps what is signed. What the conversion has to say about it — what it left
 * out, what has to be checked, under which condition a line holds — is editorial, and goes
 * back as notes: the same objects `ui/notes.js` places in the margin, anchored by the id the
 * document draws the element with (`ref-` and the entity id; `chap-testing` is the test
 * description), and at the top of it. Nothing here needs a DOM: an anchor is two values.
 *
 * @returns {{doc: object, problems: string[], notes: Array}}
 */
export function importAuthoring(input) {
  const problems = [];
  const notes = [];
  const src = input && typeof input === 'object' ? input : {};
  const doc = emptyDocument();

  // A line of a free-text field that begins with one of these is a note, not a requirement:
  // it leaves the field and goes to the margin, anchored where the field is printed. «TIMING:»
  // is not among them on purpose — a timing is a requirement of the test, and stays.
  const lift = (text, anchorId) => {
    const { kept, found } = liftNoteLines(text);
    for (const f of found) notes.push(newNote({ name: IMPORT_AUTHOR, kind: f.kind, text: f.text, anchor: { id: 'ref-' + anchorId, fraction: 0 } }));
    return kept;
  };

  const keys = { references: new Map(), variables: new Map(), resources: new Map(), protocols: new Map(), interfaces: new Map(), commands: new Map(), points: new Map(), images: new Map(), stages: new Map(), steps: new Map() };

  const register = (kind, key, id) => {
    const k = normaliseKey(key);
    if (!k) return;
    const already = keys[kind].get(k);
    // The same entity is registered under its key and under its name: only a clash
    // between two different entities is worth reporting.
    if (already && already !== id) problems.push(`Duplicate ${singular(kind)} key «${key}»: the second one wins.`);
    keys[kind].set(k, id);
  };
  const lookup = (kind, key, context) => {
    if (key == null || key === '') return '';
    const id = keys[kind].get(normaliseKey(key));
    if (!id) { problems.push(`${context}: unknown ${singular(kind)} «${key}».`); return ''; }
    return id;
  };

  // ---- header, description, references
  const header = src.header || {};
  Object.assign(doc.header, pick(header, ['title', 'company', 'project', 'product', 'documentCode', 'confidentiality', 'disclaimer']));
  // Who signs: a list of role and name, or the three keys files wrote before the list existed,
  // which become its first three rows exactly as a saved document's do.
  const signed = objects(header.signatories, 'Header signatories', problems)
    .map((s) => newSignatory(String(s.role || ''), String(s.name || '')));
  const legacy = [['Prepared by', header.preparedBy], ['Checked by', header.checkedBy], ['Approved by', header.approvedBy]]
    .filter(([, name]) => name != null && String(name).trim() !== '')
    .map(([role, name]) => newSignatory(role, String(name)));
  if (signed.length || legacy.length) doc.header.signatories = [...legacy, ...signed];
  // How the document behaves for its readers, as opposed to what it says. `pick` turns
  // everything into text, which is right for a title and wrong for a flag.
  if (src.settings && typeof src.settings === 'object') {
    doc.settings.noDirectEditing = src.settings.noDirectEditing === true || src.settings.noDirectEditing === 'true';
  }
  if (header.revision) Object.assign(doc.revision, pick(header.revision, ['number', 'date', 'author', 'reason']));
  Object.assign(doc.description, pick(src.description || {}, ['product', 'testing']));

  doc.references = objects(src.references, 'References', problems).map((r) => {
    const reference = Object.assign(newReference(), pick(r, ['code', 'title', 'revision', 'notes']));
    reference.notes = lift(reference.notes, reference.id);
    // A command or a protocol may say which document defines it: by key, or by the code
    // the reference is quoted with.
    register('references', r.key || reference.code, reference.id);
    register('references', reference.code, reference.id);
    return reference;
  });

  // ---- variables
  doc.variables = objects(src.variables, 'Variables', problems).map((v) => {
    const variable = Object.assign(newVariable(), pick(v, ['name', 'unit', 'value', 'min', 'max', 'description']));
    variable.description = lift(variable.description, variable.id);
    variable.type = knownValue(v.type, Object.values(VARIABLE_TYPE), VARIABLE_TYPE.NUMBER, `Variable «${v.name || v.key}»: type`, problems);
    if (Array.isArray(v.allowedValues)) variable.allowedValues = v.allowedValues.map(String);
    if (!variable.name) variable.name = String(v.key || '');
    register('variables', v.key || v.name, variable.id);
    // A variable can also be referenced by its name, which is what a step normally quotes.
    register('variables', variable.name, variable.id);
    return variable;
  });

  // ---- resources, interfaces, commands
  doc.resources = objects(src.resources, 'Resources', problems).map((r) => {
    const resource = Object.assign(newResource(), pick(r, ['name', 'category', 'notes', 'averageTime']));
    resource.notes = lift(resource.notes, resource.id);
    resource.characteristics = characteristics(r.characteristics);
    register('resources', r.key || r.name, resource.id);
    return resource;
  });

  doc.protocols = objects(src.protocols, 'Protocols', problems).map((p) => {
    const protocol = Object.assign(newProtocol(), pick(p, ['name', 'family', 'description', 'requestFormat', 'responseFormat', 'notes']));
    protocol.notes = lift(protocol.notes, protocol.id);
    protocol.rules = characteristics(p.rules);
    register('protocols', p.key || p.name, protocol.id);
    protocol._referenceKey = p.reference;
    return protocol;
  });

  doc.interfaces = objects(src.interfaces, 'Interfaces', problems).map((i) => {
    const itf = Object.assign(newInterface(), pick(i, ['name', 'type', 'notes']));
    itf.notes = lift(itf.notes, itf.id);
    itf.parameters = characteristics(i.parameters);
    // Where the bus is wired and what drives it: resolved in the second pass, like every
    // other reference.
    itf._pointKeys = asArray(i.points);
    itf._resourceKey = i.resource;
    register('interfaces', i.key || i.name, itf.id);
    return itf;
  });

  doc.commands = objects(src.commands, 'Commands', problems).map((c) => {
    const command = Object.assign(newCommand(), pick(c, ['name', 'address', 'requestFormat', 'responseFormat', 'negativeResponse', 'encoding', 'example', 'notes', 'nominalTime']));
    command.notes = lift(command.notes, command.id);
    register('commands', c.key || c.name, command.id);
    command._interfaceKey = c.interface;
    command._protocolKey = c.protocol;
    command._referenceKey = c.reference;
    if (c.decoding && typeof c.decoding === 'object') command.decoding = { formula: String(c.decoding.formula || ''), unit: String(c.decoding.unit || '') };
    return command;
  });

  // ---- images and points
  // The glossary: a term and its meaning, nothing to resolve.
  doc.glossary = objects(src.glossary, 'Glossary', problems)
    .map((g) => newGlossaryEntry(String(g.term || ''), String(g.meaning || '')))
    .filter((g) => g.term.trim());
  if (Array.isArray((src.settings || {}).chapterOrder)) doc.settings.chapterOrder = src.settings.chapterOrder.map(String);

  doc.images = objects(src.images, 'Images', problems).map((i) => {
    const image = newImage('', i.name || i.key || '');
    image.caption = String(i.caption || '');
    if (i.file) image.name = image.name || String(i.file);
    register('images', i.key || i.name, image.id);
    return image;
  });
  if (doc.images.length) problems.push(`${doc.images.length} image${doc.images.length > 1 ? 's are' : ' is'} declared without a file: upload the picture in the «Images» section, then the markers will show up.`);

  doc.points = objects(src.points, 'Points', problems).map((p) => {
    const point = Object.assign(newPoint(), pick(p, ['name', 'connector', 'pin', 'signal', 'contactType', 'notes']));
    point.notes = lift(point.notes, point.id);
    point.characteristics = characteristics(p.characteristics);
    if (!point.name) point.name = String(p.key || '');
    register('points', p.key || p.name, point.id);
    point._markers = objects(p.markers, `Point «${point.name}» markers`, problems);
    return point;
  });

  // ---- stages, tests, steps (first pass: create everything and register the keys)
  doc.stages = objects(src.stages, 'Stages', problems).map((s) => {
    const stage = newStage(s.kind === 'setup' ? STAGE_KIND.SETUP : STAGE_KIND.TEST);
    Object.assign(stage, pick(s, ['name', 'description']));
    stage.description = lift(stage.description, stage.id);
    if (!stage.name) stage.name = String(s.key || '');
    register('stages', s.key || s.name, stage.id);
    stage._src = s;
    stage.tests = objects(s.tests, `Stage «${stage.name}» tests`, problems).map((t) => {
      const test = Object.assign(newTest(), pick(t, ['name', 'purpose']));
      test.purpose = lift(test.purpose, test.id);
      test.kpi = t.kpi === true || t.kpi === 'true';
      test.steps = objects(t.steps, `Test «${test.name}» steps`, problems).map((st) => {
        const type = knownValue(st.type, Object.values(STEP_TYPE), guessStepType(st), `Step «${st.description || st.key}»: type`, problems);
        const step = normaliseStepForType(newStep(type), type);
        Object.assign(step, pick(st, ['description', 'note']));
        step.note = lift(step.note, step.id);
        // The value is kept as written for now and read in the second pass, once every
        // variable is registered: «$Ton» names one, and the name has to exist to be resolved.
        if (st.wait) step.wait = { value: constant(String(st.wait.value ?? '')), unit: String(st.wait.unit || 's') };
        register('steps', st.key, step.id);
        step._src = st;
        return step;
      });
      return test;
    });
    return stage;
  });

  // ---- second pass: resolve every reference now that all the keys are known
  for (const command of doc.commands) {
    command.interfaceId = lookup('interfaces', command._interfaceKey, `Command «${command.name}»`);
    command.protocolId = lookup('protocols', command._protocolKey, `Command «${command.name}»`);
    command.referenceId = lookup('references', command._referenceKey, `Command «${command.name}»`);
    delete command._interfaceKey;
    delete command._protocolKey;
    delete command._referenceKey;
  }
  for (const protocol of doc.protocols) {
    protocol.referenceId = lookup('references', protocol._referenceKey, `Protocol «${protocol.name}»`);
    delete protocol._referenceKey;
  }

  for (const itf of doc.interfaces) {
    itf.pointIds = itf._pointKeys.map((k) => lookup('points', k, `Interface «${itf.name}»`)).filter(Boolean);
    itf.resourceId = lookup('resources', itf._resourceKey, `Interface «${itf.name}»`);
    delete itf._pointKeys;
    delete itf._resourceKey;
  }

  for (const point of doc.points) {
    point.markers = point._markers.map((m) => {
      const imageId = lookup('images', m.image, `Point «${point.name}» marker`);
      const marker = newMarker(imageId, clamp(m.x), clamp(m.y));
      // How much of the picture the detail view shows around the point; the default stands.
      if (Number(m.area) > 0 && Number(m.area) <= 1) marker.area = Number(m.area);
      return marker;
    }).filter((m) => m.imageId);
    delete point._markers;
  }

  const parseValue = (raw, context) => {
    if (raw == null || raw === '') return constant('');
    const text = String(raw).trim();
    if (text.startsWith('$')) {
      const id = lookup('variables', text.slice(1), context);
      return id ? variableRef(id) : constant(text);
    }
    return constant(text);
  };

  /**
   * The matrix of a table step. Columns are declared with a key of their own and shared by
   * every row; a cell names its column by that key and carries a value or a criterion — as a
   * string in the compact grammar the guide gives, or as the same object a measurement's
   * `expected` takes. A cell for a column the table does not declare is dropped and said.
   */
  const tableOf = (raw, context) => {
    const table = { columns: [], rows: [] };
    if (!raw || typeof raw !== 'object') { problems.push(`${context}: a table step with no «table»; it stays empty.`); return table; }
    const byKey = new Map();
    const variableByName = (name) => keys.variables.get(normaliseKey(name)) || null;
    for (const c of objects(raw.columns, `${context} table columns`, problems)) {
      const kind = String(c.kind || '').toLowerCase() === 'stimulus' ? TABLE_COLUMN_KIND.STIMULUS : TABLE_COLUMN_KIND.MEASUREMENT;
      if (c.kind && !['stimulus', 'measurement'].includes(String(c.kind).toLowerCase()))
        problems.push(`${context}: column «${c.name || c.key}» has kind «${c.kind}», read as measurement.`);
      const column = Object.assign(newTableColumn(kind), { name: String(c.name || c.key || ''), unit: String(c.unit || '') });
      column.pointIds = asArray(c.points).map((k) => lookup('points', k, `${context} column «${column.name}»`)).filter(Boolean);
      column.resourceId = lookup('resources', c.resource, `${context} column «${column.name}»`);
      column.commandId = lookup('commands', c.command, `${context} column «${column.name}»`);
      const key = normaliseKey(c.key || c.name);
      if (key) byKey.set(key, column);
      table.columns.push(column);
    }
    for (const r of objects(raw.rows, `${context} table rows`, problems)) {
      const row = Object.assign(newTableRow(), { label: String(r.label || '') });
      // Cells come either as a list of { column, value | expected } or, shorter, as an object
      // keyed by column: { "RPP": "1500", "ILIM": "= 13" } — a string is the value or the
      // criterion in the compact grammar, an object is the criterion spelled out.
      const cells = r.cells && !Array.isArray(r.cells) && typeof r.cells === 'object'
        ? Object.entries(r.cells).map(([column, v]) => (v && typeof v === 'object' ? { column, expected: v } : { column, value: v }))
        : r.cells;
      for (const c of objects(cells, `${context} row «${row.label}» cells`, problems)) {
        const column = byKey.get(normaliseKey(c.column));
        if (!column) { problems.push(`${context}, row «${row.label}»: a cell names a column «${c.column}» the table does not declare; dropped.`); continue; }
        const cell = newTableCell(column);
        if (column.kind === TABLE_COLUMN_KIND.STIMULUS) {
          const { value, unresolved } = parseCellValue(c.value, { variable: variableByName });
          cell.value = value;
          for (const name of unresolved) problems.push(`${context}, row «${row.label}», column «${column.name}»: unknown variable «${name}»; kept as text.`);
        } else if (c.expected && typeof c.expected === 'object') {
          cell.expected = expected(c.expected, parseValue, `${context}, row «${row.label}», column «${column.name}»`, problems);
          if (!cell.expected.unit) cell.expected.unit = column.unit;
        } else {
          const { expected: e, unresolved } = parseCriterion(c.expected != null ? c.expected : c.value, { unit: column.unit, variable: variableByName });
          cell.expected = e;
          for (const name of unresolved) problems.push(`${context}, row «${row.label}», column «${column.name}»: unknown variable «${name}»; the cell is read as text.`);
        }
        row.cells.push(cell);
      }
      table.rows.push(row);
    }
    return table;
  };

  const block = (raw, factoryBlock, context) => {
    if (!raw) return null;
    const out = factoryBlock;
    out.description = String(raw.description || '');
    out.pointIds = asArray(raw.points).map((k) => lookup('points', k, context)).filter(Boolean);
    out.resourceId = lookup('resources', raw.resource, context);
    out.commandId = lookup('commands', raw.command, context);
    out.parameters = objects(raw.parameters, `${context} parameters`, problems).map((p) => {
      const parameter = newParameter();
      parameter.name = String(p.name || '');
      parameter.unit = String(p.unit || '');
      parameter.value = parseValue(p.value, `${context} parameter «${parameter.name}»`);
      return parameter;
    });
    return out;
  };

  for (const stage of doc.stages) {
    const s = stage._src;
    delete stage._src;
    stage.prerequisites = asArray(s.prerequisites).map((k) => lookup('stages', k, `Stage «${stage.name}» prerequisites`)).filter(Boolean);
    const parallel = s.parallel || {};
    const mode = knownValue(parallel.mode, Object.values(EXCLUSION_MODE), EXCLUSION_MODE.NONE, `Stage «${stage.name}»: parallel mode`, problems);
    stage.exclusions = {
      mode,
      stageIds: mode === EXCLUSION_MODE.LIST
        ? asArray(parallel.stages).map((k) => lookup('stages', k, `Stage «${stage.name}» exclusions`)).filter(Boolean)
        : [],
    };
    stage.heldStimuli = objects(s.heldStimuli, `Stage «${stage.name}» held stimuli`, problems).map((held) => {
      const entry = newHeldStimulus();
      entry.stepId = lookup('steps', held.step, `Stage «${stage.name}» held stimulus`);
      entry.note = String(held.note || '');
      return entry;
    }).filter((held) => held.stepId);

    for (const test of stage.tests) {
      for (const step of test.steps) {
        const raw = step._src;
        delete step._src;
        const context = `Step «${step.description || raw.key || ''}»`;
        if (step.type === STEP_TYPE.STAGE_CALL) {
          step.calledStageId = lookup('stages', raw.callStage || raw.stage, context);
          continue;
        }
        step.wait.value = parseValue(step.wait.value.value, `${context} wait`);
        step.imageId = lookup('images', raw.image, `${context} image`);
        if (step.type === STEP_TYPE.TABLE) { step.table = tableOf(raw.table, context); continue; }
        if (step.stimulus) step.stimulus = block(raw.stimulus, step.stimulus, `${context} stimulus`) || step.stimulus;
        if (step.measurement) {
          step.measurement = block(raw.measurement, step.measurement, `${context} measurement`) || step.measurement;
          step.measurement.expected = expected(raw.measurement && raw.measurement.expected, parseValue, context, problems);
          // Computed from earlier readings: the formula as written, the inputs by step key.
          const computed = raw.measurement && raw.measurement.computed;
          if (computed && typeof computed === 'object') {
            step.measurement.computed = Object.assign(newComputed(), { formula: String(computed.formula || '') });
            step.measurement.computed.inputStepIds = asArray(computed.inputs).map((k) => lookup('steps', k, `${context} computed inputs`)).filter(Boolean);
          }
        }
      }
    }
  }

  // ---- stage order: unless the source says otherwise, a specification is read top to bottom,
  // so the test stages are chained one after the other. A stage that states its own
  // prerequisites keeps them: what is written explicitly always wins.
  if (String(src.stageOrder || '').toLowerCase() === 'sequential') {
    const sequence = doc.stages.filter((s) => s.kind !== STAGE_KIND.SETUP);
    let chained = 0;
    for (let i = 1; i < sequence.length; i++) {
      if ((sequence[i].prerequisites || []).length) continue;
      sequence[i].prerequisites = [sequence[i - 1].id];
      chained++;
    }
    if (chained) problems.push(`Stage order «sequential»: ${chained} stage${chained > 1 ? 's were' : ' was'} chained to the one before it. Check the sequence, and give a stage its own prerequisites where the order is different.`);
  }

  // ---- variants: the two cases that cover most legacy documents
  doc.variants = objects(src.variants, 'Variants', problems).map((v) => {
    const variant = Object.assign(newVariant(), pick(v, ['name', 'description']));
    if (!variant.name) variant.name = String(v.key || '');
    for (const key of asArray(v.excludeStages)) {
      const id = lookup('stages', key, `Variant «${variant.name}»`);
      if (id) variant.overlay.push({ op: OP.REMOVE, path: ['stages', '#' + id] });
    }
    for (const [key, value] of Object.entries(v.variableValues || {})) {
      const id = lookup('variables', key, `Variant «${variant.name}»`);
      if (!id) continue;
      const variable = doc.variables.find((x) => x.id === id);
      const set = (field, val) => variant.overlay.push({ op: OP.SET, path: ['variables', '#' + id, field], value: String(val) });
      if (variable && variable.type === VARIABLE_TYPE.RANGE) {
        // A range has two ends: `{ "min": …, "max": … }` sets both; one bare value sets the
        // lower one alone, and says so, because a range with half a new value is no range.
        if (value && typeof value === 'object') {
          if (value.min != null) set('min', value.min);
          if (value.max != null) set('max', value.max);
        } else {
          set('min', value);
          problems.push(`Variant «${variant.name}»: «${key}» is a range, and one value sets its minimum only — write { "min": …, "max": … } to set both.`);
        }
      } else {
        set('value', value);
      }
    }
    return variant;
  });

  // Last, so that its line closes the report: what stayed out is the note the conversion ends on.
  applyConversion(src.conversion, doc, problems, notes);

  return { doc: migrate(doc), problems, notes };
}

/** Who signs the notes a conversion brings: not a person, and the margin should say so. */
const IMPORT_AUTHOR = 'Import';

const NOTE_MARKERS = [['TO CHECK:', 'toCheck'], ['CONDITION:', 'condition']];

/**
 * The lines of a text that are notes, and the text without them. A marker counts at the
 * start of a line only: «TO CHECK:» in the middle of a sentence is the sentence's business.
 * Exported for the tests; the document never sees the lines that are lifted.
 * @returns {{kept: string, found: Array<{kind: string, text: string}>}}
 */
export function liftNoteLines(text) {
  const kept = [];
  const found = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    const marker = NOTE_MARKERS.find(([m]) => trimmed.toUpperCase().startsWith(m));
    if (!marker) { kept.push(line); continue; }
    const body = trimmed.slice(marker[0].length).trim();
    if (body) found.push({ kind: marker[1], text: body });
  }
  return { kept: kept.join('\n').trim(), found };
}

/**
 * What the conversion could not carry, said beside the document.
 *
 * A specification converted from an older one is read by people who will never open the
 * original: a figure the model could not read, a chapter it did not reach, a table it had to
 * flatten are gone for them unless somebody says so. The authoring file names its source and
 * lists what stayed out (`conversion.leftOut`, see the guide). None of it is part of what
 * gets signed, so none of it goes into the document: each item becomes a note in the margin
 * of the test description, and the source goes into the record of the draft as its reason —
 * the one line of the document that is about the document.
 */
function applyConversion(raw, doc, problems, notes) {
  if (!raw || typeof raw !== 'object') return;
  const source = String(raw.source || '').trim();
  const leftOut = objects(raw.leftOut, 'Conversion: left out', problems).map((e) => ({
    where: String(e.where || '').trim(), what: String(e.what || '').trim(), why: String(e.why || '').trim(),
  })).filter((e) => e.what || e.where);
  const remarks = String(raw.notes || '').trim();

  // The test description chapter carries its key as its id, wherever it is numbered.
  const anchor = { id: 'chap-testing', fraction: 0 };
  for (const e of leftOut) {
    notes.push(newNote({ name: e.where || IMPORT_AUTHOR, kind: 'leftOut', text: [e.what, e.why].filter(Boolean).join(' — '), anchor }));
  }
  if (remarks) notes.push(newNote({ name: IMPORT_AUTHOR, kind: 'free', text: remarks, anchor }));

  // The record of the draft says where it came from, unless the file already said it. The
  // default reason of a new document counts as unsaid: a converted specification is not a
  // first issue, whatever the empty document calls itself.
  const reason = String(doc.revision.reason || '').trim();
  if (source && (!reason || reason === emptyDocument().revision.reason)) doc.revision.reason = `Converted from ${source}`;

  if (leftOut.length) problems.push(`${leftOut.length} item${leftOut.length > 1 ? 's' : ''} left out of the conversion: ${leftOut.length > 1 ? 'they are' : 'it is'} in the margin of the test description as «left out» notes, not in the document.`);
}

// ---- helpers -----------------------------------------------------------------

const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * The entries of a list that are objects. A language model writing the file sometimes leaves a
 * null or a bare string where an entity was expected; reading a field off it would throw, and
 * the promise at the top of this file is that nothing here throws. The entry is skipped, and
 * when there is somewhere to say so, said.
 */
function objects(list, where, problems) {
  const out = [];
  asArray(list).forEach((e, i) => {
    if (e && typeof e === 'object' && !Array.isArray(e)) out.push(e);
    else if (problems) problems.push(`${where}: entry ${i + 1} is ${e === null ? 'null' : Array.isArray(e) ? 'a list' : 'a ' + typeof e}, not an object, and was skipped.`);
  });
  return out;
}

const normaliseKey = (k) => String(k == null ? '' : k).trim().toLowerCase();

const clamp = (n) => Math.min(1, Math.max(0, Number(n) || 0));

const pick = (obj, fields) => {
  const out = {};
  for (const f of fields) if (obj && obj[f] != null) out[f] = String(obj[f]);
  return out;
};

const characteristics = (list) => objects(list).map((c) => {
  const item = newCharacteristic();
  item.name = String(c.name || '');
  item.value = String(c.value ?? '');
  item.unit = String(c.unit || '');
  return item;
});

const singular = (kind) => ({ references: 'reference', variables: 'variable', resources: 'resource', protocols: 'protocol', interfaces: 'interface', commands: 'command', points: 'point', images: 'image', stages: 'stage', steps: 'step' }[kind] || kind);

function knownValue(value, allowed, fallback, context, problems) {
  if (value == null || value === '') return fallback;
  if (allowed.includes(value)) return value;
  problems.push(`${context}: «${value}» is not a known value, «${fallback}» used instead.`);
  return fallback;
}

/** When the step does not say, its content tells what it is. */
function guessStepType(st) {
  if (st.callStage || st.stage) return STEP_TYPE.STAGE_CALL;
  if (st.table) return STEP_TYPE.TABLE;
  if (st.stimulus && st.measurement) return STEP_TYPE.STIMULUS_MEASUREMENT;
  if (st.measurement) return STEP_TYPE.MEASUREMENT;
  return STEP_TYPE.STIMULUS;
}

/** Acceptance criterion: nominal + tolerance when given, otherwise lower/upper limits. */
function expected(raw, parseValue, context, problems) {
  const out = {
    kind: 'numeric',
    mode: 'minmax', min: constant(''), max: constant(''),
    nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: '',
    text: '', stringComparison: 'EQ', caseSensitive: true, regex: false, booleanValue: 'true',
  };
  if (!raw) return out;
  out.unit = String(raw.unit || '');
  if (raw.nominal != null && raw.nominal !== '') {
    out.mode = 'nominal';
    out.nominal = parseValue(raw.nominal, `${context} nominal`);
    out.tolerance = parseValue(raw.tolerance, `${context} tolerance`);
    out.toleranceType = raw.toleranceType === 'percent' ? 'percent' : 'absolute';
    return out;
  }
  // A text or a yes/no criterion is judged on its own terms, and says so.
  const kind = String(raw.kind || '').toLowerCase();
  if (kind === 'boolean' || raw.boolean != null) {
    out.kind = 'boolean';
    const value = raw.boolean != null ? raw.boolean : raw.value;
    out.booleanValue = value === false || value === 'false' ? 'false' : 'true';
    return out;
  }
  if (kind === 'string' || kind === 'text' || raw.text != null || raw.pattern != null) {
    out.kind = 'string';
    // «$Name» works here too: the text to expect is a value, and can be a variable.
    out.text = parseValue(raw.pattern != null ? raw.pattern : raw.text, `${context} expected text`);
    out.regex = raw.pattern != null || raw.regex === true || raw.regex === 'true';
    out.caseSensitive = !(raw.caseSensitive === false || raw.caseSensitive === 'false');
    const sc = String(raw.stringComparison || raw.comparison || '').toUpperCase();
    if (['EQ', 'NE', 'CONTAINS', 'STARTS', 'ENDS'].includes(sc)) out.stringComparison = sc;
    return out;
  }

  out.min = parseValue(raw.min, `${context} minimum`);
  out.max = parseValue(raw.max, `${context} maximum`);

  // The comparison is optional; without it the limits mean what they have always meant.
  // A one sided operator may state its threshold as `limit`, which lands in the field that
  // carries its direction.
  const code = String(raw.comparison || '').toUpperCase();
  if (code === 'EQT') {
    // «Nominal ± tolerance» declared as a comparison but with no nominal to go with it: the
    // criterion is kept as what was meant, empty, and said — read as limits it would have
    // become «between» two values that were never written.
    out.mode = 'nominal';
    out.comparison = 'EQT';
    if (problems) problems.push(`${context}: comparison EQT (nominal ± tolerance) has no nominal value; the criterion is left empty.`);
    return out;
  }
  if (code && COMPARISON[code]) {
    out.comparison = code;
    const spec = COMPARISON[code];
    if (spec.sides === 1 && raw.limit != null && raw.limit !== '') {
      out[spec.slot] = parseValue(raw.limit, `${context} limit`);
    }
  }
  return out;
}
