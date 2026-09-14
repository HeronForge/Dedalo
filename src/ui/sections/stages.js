// Stages, tests and steps: the core of the specification.
// The navigable tree on the left, the data sheet of the selected element on the right.
//
// Two kinds of stage live here, and the tree keeps them apart: the test stages of the sequence
// (STG-xx) and the setup stages other steps call on demand (SET-xx), such as power up or load
// configuration.
import { h, field, button, card, empty, confirm, clear } from '../dom.js';
import { textField, selectField, multiField, valueField, textInput, suggestInput, selectInput, valueInput, checkInput, optionsFrom } from '../fields.js';
import { subList } from '../list.js';
import {
  newStage, newTest, newStep, newParameter, newHeldStimulus, newComputed, isComputed, normaliseStepForType, constant,
  STEP_TYPE, STEP_TYPE_LABEL, STEP_TYPE_SHORT, EXCLUSION_MODE, STAGE_KIND, STAGE_KIND_LABEL,
  COMPARISON, comparisonOf, EXPECTED_KIND, EXPECTED_KIND_LABEL, expectedKind,
  STRING_COMPARISON, stringComparisonOf, expectedBadge, expectedCaseNote,
} from '../../model/schema.js';
import { codeOf, optionLabel, labelOf, computeIndex } from '../../model/codes.js';
import { variableIndex, expectedText } from '../../model/variables.js';
import { isSetup, testStages, setupStages, callMap } from '../../model/stages.js';
import { cloneEntity, indexAfter } from '../../model/clone.js';
import { openForEditing } from '../navigate.js';
import { tableEditor } from '../tablestep.js';
import { renderStepPreview } from '../../render/document.js';

const expanded = new Set(); // stages expanded in the tree

/** Opens the tree down to a stage, so a step reached from the document is visible in it. */
export const revealStage = (stageId) => expanded.add(stageId);

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

export function stagesSection(store) {
  const doc = store.resolvedDoc();
  const codes = store.codes();
  const index = computeIndex(doc);
  const sel = selection(store, doc);

  const addStage = (kind) => {
    const s = newStage(kind);
    store.add(['stages'], s);
    expanded.add(s.id);
    pick(store, 'stage', s.id);
  };

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', {}, 'Stages, tests and steps'),
      button('+ Test stage', () => addStage(STAGE_KIND.TEST), { class: 'btn-primary' }),
      button('+ Setup stage', () => addStage(STAGE_KIND.SETUP), { title: 'A routine other steps call: power up, power down, load configuration…' })),
    h('div', { class: 'master-detail master-wide' },
      h('div', { class: 'master' }, tree(store, doc, codes, sel)),
      h('div', { class: 'detail' }, sheet(store, doc, codes, index, sel))));
}

// ---- selection ---------------------------------------------------------------

/**
 * What the tree is showing, tree included when nothing was ever clicked. The breadcrumb asks
 * this too: the line at the top of the window and the panel underneath must never disagree
 * about which stage is open.
 */
export const stageSelection = (store, doc) => selection(store, doc || store.resolvedDoc());

function selection(store, doc) {
  const s = store.state.selection;
  if (s && s.section === 'stages' && locate(doc, s.id)) return { ...s, ...locate(doc, s.id) };
  const first = (doc.stages || [])[0];
  return first ? { section: 'stages', id: first.id, kind: 'stage', stage: first } : null;
}

const pick = (store, kind, id) => store.set({ selection: { section: 'stages', id, kind } });

/** Finds an id in the tree and returns its context (stage/test/step). */
function locate(doc, id) {
  for (const stage of doc.stages || []) {
    if (stage.id === id) return { kind: 'stage', stage };
    for (const test of stage.tests || []) {
      if (test.id === id) return { kind: 'test', stage, test };
      for (const step of test.steps || []) if (step.id === id) return { kind: 'step', stage, test, step };
    }
  }
  return null;
}

const stagePath = (s) => ['stages', '#' + s.id];
const testPath = (s, t) => [...stagePath(s), 'tests', '#' + t.id];
const stepPath = (s, t, p) => [...testPath(s, t), 'steps', '#' + p.id];

// ---- tree --------------------------------------------------------------------

function tree(store, doc, codes, sel) {
  const stages = doc.stages || [];
  if (!stages.length) return empty('No stage yet. Use «+ Test stage».');
  const tests = testStages(doc);
  const setups = setupStages(doc);
  const group = (title, list, hint) => (list.length
    ? [h('li', { class: 'tree-group' }, title, hint ? h('span', { class: 'muted' }, ' — ' + hint) : null),
       ...list.map((s) => stageNode(store, doc, codes, sel, s))]
    : []);
  return h('ul', { class: 'tree' },
    ...group('Test sequence', tests),
    ...group('Setup stages', setups, 'called on demand'));
}

function stageNode(store, doc, codes, sel, s) {
  const open = expanded.has(s.id);
  const setup = isSetup(s);
  return h('li', { class: 'node' },
    h('div', { class: ['item', sel && sel.id === s.id && 'item-sel'], onClick: () => pick(store, 'stage', s.id) },
      h('button', {
        type: 'button', class: 'btn btn-icon btn-expand', title: open ? 'Collapse' : 'Expand',
        onClick: (e) => { e.stopPropagation(); open ? expanded.delete(s.id) : expanded.add(s.id); store.refresh(); },
      }, open ? '▾' : '▸'),
      // The name wraps and the prerequisites take a line of their own: a stage called
      // «Local mechanical command · after STG-01» was being cut down to «· aft…».
      h('div', { class: 'item-text item-text-wrap' },
        h('span', { class: ['code', setup && 'code-setup'] }, codeOf(codes, s.id)), ' ',
        h('strong', {}, s.name || (setup ? '(unnamed setup stage)' : '(unnamed stage)')),
        !setup && (s.prerequisites || []).length
          ? h('span', { class: 'item-meta' }, `after ${(s.prerequisites || []).map((p) => codeOf(codes, p) || '?').join(', ')}`)
          : null),
      actions(store, ['stages'], s, 'stage', () => newTest(), [...stagePath(s), 'tests'], 'test')),
    open ? h('ul', {}, ...(s.tests || []).map((t) => testNode(store, doc, codes, sel, s, t))) : null);
}

function testNode(store, doc, codes, sel, s, t) {
  return h('li', { class: 'node' },
    h('div', { class: ['item', sel && sel.id === t.id && 'item-sel'], onClick: () => pick(store, 'test', t.id) },
      h('div', { class: 'item-text item-text-wrap' },
        h('span', { class: 'code' }, codeOf(codes, t.id)), ' ', t.name || '(unnamed test)',
        t.kpi ? h('span', { class: 'tag tag-kpi' }, 'KPI') : null),
      actions(store, [...stagePath(s), 'tests'], t, 'test', () => newStep(), [...testPath(s, t), 'steps'], 'step')),
    h('ul', {}, ...(t.steps || []).map((p) => h('li', { class: 'node' },
      h('div', { class: ['item', sel && sel.id === p.id && 'item-sel'], onClick: () => pick(store, 'step', p.id) },
        h('div', { class: 'item-text' },
          h('span', { class: 'code' }, codeOf(codes, p.id)), ' ',
          h('span', { class: 'tag' }, STEP_TYPE_SHORT[p.type] || ''), ' ',
          p.description || '(step with no description)'),
        actions(store, [...testPath(s, t), 'steps'], p, 'step'))))));
}

function actions(store, collectionPath, entity, kind, childFactory, childPath, childName) {
  const reorderBlocked = !!store.recordingVariant(collectionPath);
  const reorderTitle = reorderBlocked ? 'The order belongs to the base document: leave the variant to change it' : null;
  return h('div', { class: 'item-actions' },
    childFactory
      ? button('+', (e) => {
          e.stopPropagation();
          const child = childFactory();
          store.add(childPath, child);
          if (childName === 'test') expanded.add(entity.id);
          pick(store, childName, child.id);
        }, { class: 'btn-icon', title: `Add ${childName}` })
      : null,
    // A stage of twenty steps written twice, once at 12 V and once at 24 V, is the same stage
    // twice: it is copied, not typed again. The copy carries new ids all the way down, so the
    // two live apart from the very first keystroke.
    button('⧉', (e) => {
      e.stopPropagation();
      const copy = cloneEntity(entity, { suffix: kind === 'step' ? '' : '(copy)' });
      store.add(collectionPath, copy, indexAfter(store.read(collectionPath), entity.id));
      if (kind === 'stage') expanded.add(copy.id);
      pick(store, kind, copy.id);
    }, { class: 'btn-icon', title: `Duplicate this ${kind} with everything inside it` }),
    button('↑', (e) => { e.stopPropagation(); store.move(collectionPath, entity.id, -1); },
      { class: 'btn-icon', title: reorderTitle || 'Move up', disabled: reorderBlocked }),
    button('↓', (e) => { e.stopPropagation(); store.move(collectionPath, entity.id, +1); },
      { class: 'btn-icon', title: reorderTitle || 'Move down', disabled: reorderBlocked }),
    button('✕', async (e) => {
      e.stopPropagation();
      if (await confirm('Delete this element and everything inside it?', { danger: true, okLabel: 'Delete' }))
        store.remove([...collectionPath, '#' + entity.id]);
    }, { class: 'btn-icon btn-danger', title: 'Delete' }));
}

// ---- data sheets -------------------------------------------------------------

function sheet(store, doc, codes, index, sel) {
  if (!sel) return empty('Create a stage to get started.');
  if (sel.kind === 'stage') return stageSheet(store, doc, codes, index, sel.stage);
  if (sel.kind === 'test') return testSheet(store, sel.stage, sel.test);
  return stepSheet(store, doc, codes, sel.stage, sel.test, sel.step);
}

function stageSheet(store, doc, codes, index, s) {
  const path = stagePath(s);
  const setup = isSetup(s);
  const others = (doc.stages || []).filter((x) => x.id !== s.id && !isSetup(x));
  const stimulusSteps = [];
  for (const t of s.tests || []) for (const p of t.steps || []) if (p.stimulus) stimulusSteps.push(p);
  const callers = callMap(doc).get(s.id) || [];

  return h('div', {},
    card(`${setup ? 'Setup stage' : 'Test stage'} ${codeOf(codes, s.id)}`,
      textField(store, [...path, 'name'], 'Name'),
      selectField(store, [...path, 'kind'], 'Kind of stage',
        Object.values(STAGE_KIND).map((k) => ({ value: k, label: STAGE_KIND_LABEL[k] })),
        { blank: false, help: setup
          ? 'It has no place of its own in the sequence: it runs where a step calls it, as many times as it is called.'
          : 'It runs once, in the order its prerequisites allow.' }),
      textField(store, [...path, 'description'], 'Description', { multiline: true, rows: 3 })),

    setup
      ? card('Where it is called',
          callers.length
            ? h('ul', { class: 'plain-list' }, ...callers.map((c) => h('li', {},
                h('button', {
                  type: 'button', class: 'link-item',
                  onClick: () => store.set({ selection: { section: 'stages', id: c.stepId, kind: 'step' } }),
                }, labelOf(codes, index, c.stepId, 60)),
                h('span', { class: 'muted' }, ` — in ${labelOf(codes, index, c.stageId, 40)}`))))
            : empty('No step calls this stage yet: add a step of type «Stage call» where you need it.'))
      : card('Execution constraints',
          multiField(store, [...path, 'prerequisites'], 'Must be preceded by', optionsFrom(others, codes),
            { help: 'Test stages that must be complete before this one.' }),
          selectField(store, [...path, 'exclusions', 'mode'], 'Parallel execution', [
            { value: EXCLUSION_MODE.NONE, label: 'No restriction' },
            { value: EXCLUSION_MODE.ALL, label: 'Allows no other stage in parallel' },
            { value: EXCLUSION_MODE.LIST, label: 'Allows no parallel run with the listed stages' },
          ], { blank: false }),
          (s.exclusions || {}).mode === EXCLUSION_MODE.LIST
            ? multiField(store, [...path, 'exclusions', 'stageIds'], 'Excluded stages', optionsFrom(others, codes))
            : null),

    card('Stimuli held on exit',
      h('p', { class: 'hint' }, 'Stimuli that stay applied when the stage ends: they keep occupying resources afterwards.'),
      subList(store, {
        path: [...path, 'heldStimuli'], items: s.heldStimuli, factory: newHeldStimulus,
        addLabel: '+ held stimulus',
        row: (hs, hp) => h('span', { class: 'row-2' },
          selectInput(store, [...hp, 'stepId'], stimulusSteps.map((p) => ({ value: p.id, label: optionLabel(codes, p, 'description') })), { blankLabel: '— pick the step —' }),
          textInput(store, [...hp, 'note'], { placeholder: 'Note (e.g. keep until the end of the test)' })),
      })));
}

function testSheet(store, s, t) {
  const path = testPath(s, t);
  return card('Test',
    textField(store, [...path, 'name'], 'Name'),
    textField(store, [...path, 'purpose'], 'Purpose', { multiline: true, rows: 3 }),
    field('Key performance indicator',
      checkInput(store, [...path, 'kpi'], 'KPI — this test is followed line-side'),
      { help: 'Marked in the document and gathered, with its acceptance criteria, in the KPI appendix.' }));
}

function stepSheet(store, doc, codes, s, t, p) {
  const path = stepPath(s, t, p);
  const variables = variableIndex(doc);

  const typeSelect = h('select', { class: 'inp' },
    ...Object.values(STEP_TYPE).map((v) => h('option', { value: v, selected: v === p.type }, STEP_TYPE_LABEL[v])));
  typeSelect.addEventListener('change', () => {
    // The whole step is rewritten: whatever the new type has no room for is dropped, instead
    // of lingering out of sight in validation and in the resource count.
    const next = normaliseStepForType(clone(p), typeSelect.value);
    store.write(path, next, null);
    store.refresh();
  });

  // A step calls a setup stage; a test stage stays in the sequence and is not called.
  const callable = setupStages(doc).filter((x) => x.id !== s.id);
  const current = (doc.stages || []).find((x) => x.id === p.calledStageId);
  if (current && !callable.includes(current) && current.id !== s.id) callable.push(current);

  return h('div', {},
    card(`Step ${codeOf(codes, p.id)}`,
      textField(store, [...path, 'description'], 'High level description', {
        multiline: true, rows: 2,
        placeholder: 'What the document shows, e.g. «Power the unit at nominal voltage and check the quiescent current»',
      }),
      field('Step type', typeSelect),
      h('div', { class: 'field-row' },
        valueField(store, [...path, 'wait', 'value'], 'Wait time (optional)', doc),
        textField(store, [...path, 'wait', 'unit'], 'Unit', { placeholder: 'ms, s, min', help: 'A variable brings its own unit and wins over this one.' })),
      selectField(store, [...path, 'imageId'], 'Figure (optional)', optionsFrom(doc.images, codes),
        { help: 'A picture this step refers to: printed small beside it, opened full size on a click. The points keep their own markers in the appendix.' }),
      textField(store, [...path, 'note'], 'Note', { multiline: true, rows: 2 })),

    p.type === STEP_TYPE.STAGE_CALL
      ? card('Setup stage to run',
          callable.length
            ? selectField(store, [...path, 'calledStageId'], 'Run setup stage', optionsFrom(callable, codes),
                { help: 'The setup stage runs in full, then execution continues with the next step. The same stage can be called from as many steps as needed.' })
            : empty('No setup stage defined yet: create one with «+ Setup stage» (power up, power down, load configuration…).'))
      : null,

    // The matrix replaces the two blocks: its columns are the blocks, one per column.
    p.type === STEP_TYPE.TABLE ? tableEditor(store, doc, codes, path, p) : null,

    p.stimulus && p.type !== STEP_TYPE.STAGE_CALL
      ? card('Stimulus — what is applied to the unit', applicationBlock(store, doc, codes, [...path, 'stimulus'], p.stimulus, 'stimulus'))
      : null,

    p.measurement && p.type !== STEP_TYPE.STAGE_CALL
      ? card('Measurement — what is read back from the unit',
          computedSwitch(store, [...path, 'measurement'], p.measurement),
          isComputed(p.measurement)
            ? computedBlock(store, doc, codes, [...path, 'measurement'], p.measurement, t, p)
            : applicationBlock(store, doc, codes, [...path, 'measurement'], p.measurement, 'measurement'),
          expectedBlock(store, doc, [...path, 'measurement', 'expected'], p.measurement),
          h('p', { class: 'hint' }, 'Resulting criterion: ',
            h('strong', {}, expectedText(p.measurement, variables) || '—'),
            ' ', h('span', { class: 'tag' }, expectedBadge(p.measurement.expected)),
            expectedCaseNote(p.measurement.expected) ? ' — ' + expectedCaseNote(p.measurement.expected) : ''))
      : null,

    stepPreview(store, p.id));
}

/**
 * Whether the measurement is read from the unit or computed from readings taken before it.
 * Switching to computed drops the instrument, the points and the command: a computed value
 * touches nothing, and leaving them behind would be reported as a contradiction.
 */
function computedSwitch(store, path, measurement) {
  const box = h('input', { type: 'checkbox', checked: isComputed(measurement) });
  box.addEventListener('change', () => {
    const next = clone(measurement);
    if (box.checked) {
      next.computed = newComputed();
      next.resourceId = ''; next.pointIds = []; next.commandId = ''; next.parameters = [];
    } else {
      delete next.computed;
    }
    store.write(path, next, null);
    store.refresh();
  });
  return field('Computed from earlier readings', h('label', { class: 'check' }, box, ' this value is worked out from what previous steps of this test read, not measured'),
    { help: 'The tag reads COMPUTED, and the formula and the input steps are printed in place of an instrument.' });
}

/** The formula, and which of the steps before this one it reads. */
function computedBlock(store, doc, codes, path, measurement, test, step) {
  const before = [];
  for (const s of test.steps || []) { if (s.id === step.id) break; if (s.measurement || s.type === STEP_TYPE.TABLE) before.push(s); }
  return h('div', {},
    textField(store, [...path, 'description'], 'What is computed', { placeholder: 'e.g. Metering error' }),
    textField(store, [...path, 'computed', 'formula'], 'Formula, as the document should print it', {
      placeholder: 'e.g. (meter − reference) / reference × 100',
      help: 'Written for a person: the tool does not evaluate it.',
    }),
    before.length
      ? multiField(store, [...path, 'computed', 'inputStepIds'], 'Computed from', optionsFrom(before, codes, 'description'),
          { help: 'The steps of this test that read something, before this one.' })
      : h('p', { class: 'hint' }, 'No earlier step of this test reads anything yet: the inputs come first.'));
}

/**
 * The line as the document will print it, refreshed at every keystroke. It follows the light
 * notification channel — the one the status bar uses — so the field being typed into never
 * loses the focus; when the sheet is replaced the listener drops itself at the next signal.
 */
function stepPreview(store, stepId) {
  const body = h('div', { class: 'preview-body' });
  const paint = () => {
    const current = store.resolvedDoc();
    const found = locate(current, stepId);
    clear(body);
    if (found && found.step) body.appendChild(renderStepPreview(current, found.step, { assets: store.state.assets }));
  };
  const off = store.subscribeLight(() => {
    if (!body.isConnected) { off(); return; }
    paint();
  });
  paint();
  return card('In the document', body,
    h('p', { class: 'hint' }, 'The row exactly as it is printed and exported. Codes carry the name of what they point at; the full detail stays in the appendices.'));
}

function applicationBlock(store, doc, codes, path, block, kind) {
  const stimulus = kind === 'stimulus';
  const command = (doc.commands || []).find((c) => c.id === block.commandId);
  const itf = command ? (doc.interfaces || []).find((i) => i.id === command.interfaceId) : null;

  // Choosing a command changes what the block is: the instrument and the contacts come from
  // the interface, so the fields that named them are cleared rather than left to disagree
  // with what the document shows.
  const commandSelect = selectInput(store, [...path, 'commandId'], optionsFrom(doc.commands, codes));
  commandSelect.addEventListener('change', () => {
    if (commandSelect.value) {
      store.write([...path, 'resourceId'], '', null);
      store.write([...path, 'pointIds'], [], null);
    }
    store.refresh();
  });

  return h('div', {},
    textField(store, [...path, 'description'], stimulus ? 'What is applied' : 'What is measured', {
      placeholder: stimulus ? 'e.g. Apply the supply voltage' : 'e.g. Measure the current draw',
    }),
    field(stimulus ? 'Communication command — SET' : 'Communication command — GET', commandSelect, {
      help: stimulus
        ? 'When the stimulus is written to the unit over a bus. The step then reads SET instead of APPLY.'
        : 'When the value is read from the unit over a bus. The step then reads GET instead of MEASURE.',
    }),

    // With a command, the instrument and the points are the interface's; without one, they
    // belong to the step and are asked for here.
    command
      ? h('div', { class: 'derived' },
          h('div', { class: 'derived-title' }, 'From the interface of this command'),
          itf
            ? h('ul', { class: 'plain-list' },
                h('li', {}, 'Interface: ', labelOf(codes, computeIndex(doc), itf.id, 40)),
                h('li', {}, 'Instrument: ', itf.resourceId
                  ? labelOf(codes, computeIndex(doc), itf.resourceId, 40)
                  : h('strong', {}, 'none declared — the bench has nothing to send it with')),
                h('li', {}, 'Application points: ', (itf.pointIds || []).length
                  ? (itf.pointIds || []).map((id) => labelOf(codes, computeIndex(doc), id, 30)).join(', ')
                  : h('em', {}, 'none declared')))
            : h('p', { class: 'hint' }, 'This command names no interface: nothing can be derived from it.'),
          button('Open the interface', () => openForEditing(store, (itf || {}).id), { class: 'btn-small', disabled: !itf }))
      : h('div', {},
          multiField(store, [...path, 'pointIds'], stimulus ? 'Applied on (application points)' : 'Measured at (application points)', optionsFrom(doc.points, codes),
            { help: 'The detail (connector, pin, connection characteristics) is read in the appendix.' }),
          selectField(store, [...path, 'resourceId'], stimulus ? 'Resource that applies it' : 'Resource that measures it', optionsFrom(doc.resources, codes))),

    field(command ? 'Command parameters' : 'Resource parameters', subList(store, {
      path: [...path, 'parameters'], items: block.parameters, factory: newParameter,
      addLabel: '+ parameter',
      // The names already in use are offered as one types: «Voltage» written twice should be
      // one parameter across the document, not two that only look alike.
      row: (par, pp) => h('span', { class: 'row-3' },
        suggestInput(store, [...pp, 'name'], parameterNames(doc, { resourceId: block.resourceId, commandId: block.commandId }),
          { placeholder: command ? 'e.g. Requested state' : 'e.g. Voltage / Force' }),
        valueInput(store, [...pp, 'value'], doc),
        suggestInput(store, [...pp, 'unit'], parameterUnits(doc), { placeholder: 'Unit' })),
    }), {
      help: command
        ? 'The arguments of the command: what is written into it, or what is asked for. They carry the colour of the command in the document.'
        : 'How the instrument is driven: amplitude, force, range.',
    }));
}

/**
 * What to suggest for the name of a parameter: the knobs this very instrument declares, and
 * the names already used with it — or with this command — elsewhere in the document.
 *
 * Every name in the document was too wide a net: a force offered while driving a power supply
 * is noise, and noise in a suggestion list is what makes people stop reading it.
 */
function parameterNames(doc, { resourceId, commandId }) {
  const names = new Set();

  const resource = (doc.resources || []).find((r) => r.id === resourceId);
  for (const c of (resource && resource.characteristics) || []) if (c.name) names.add(c.name);

  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    for (const block of [s.stimulus, s.measurement]) {
      if (!block) continue;
      const sameResource = resourceId && block.resourceId === resourceId;
      const sameCommand = commandId && block.commandId === commandId;
      if (!sameResource && !sameCommand) continue;
      for (const p of block.parameters || []) if (p.name) names.add(p.name);
    }
  }
  return [...names];
}

function parameterUnits(doc) {
  const units = new Set();
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    for (const block of [s.stimulus, s.measurement]) {
      for (const p of (block && block.parameters) || []) if (p.unit) units.add(p.unit);
    }
  }
  for (const r of doc.resources || []) for (const c of r.characteristics || []) if (c.unit) units.add(c.unit);
  for (const v of doc.variables || []) if (v.unit) units.add(v.unit);
  return [...units];
}

function expectedBlock(store, doc, path, measurement) {
  const e = measurement.expected || {};
  const kind = expectedKind(e);

  // What is being judged comes first: a voltage, a string and a yes/no are three different
  // questions, and the fields underneath are the ones that question needs.
  const kindSelect = h('select', { class: 'inp' },
    ...Object.values(EXPECTED_KIND).map((v) =>
      h('option', { value: v, selected: v === kind }, EXPECTED_KIND_LABEL[v])));
  kindSelect.addEventListener('change', () => {
    store.write([...path, 'kind'], kindSelect.value, null);
    store.refresh();
  });

  return h('div', { class: 'expected' },
    field('Evaluated as', kindSelect, {
      help: 'Numeric compares against limits; text compares the answer the unit gives; yes/no is a pass or a fail on its own.',
    }),
    kind === EXPECTED_KIND.STRING ? stringCriterion(store, doc, path, e)
      : kind === EXPECTED_KIND.BOOLEAN ? booleanCriterion(store, path)
        : numericCriterion(store, doc, path, e));
}

/** The answer the unit gives, compared as text. */
function stringCriterion(store, doc, path, e) {
  const regex = !!e.regex;
  const comparison = stringComparisonOf(e);
  const comparisonSelect = selectInput(store, [...path, 'stringComparison'],
    Object.entries(STRING_COMPARISON).map(([value, c]) => ({ value, label: `${c.label} — ${c.condition}` })), { blank: false });

  return h('div', {},
    regex
      ? null
      : field('Comparison', comparisonSelect, { help: 'How the answer is compared with the value below.' }),
    // The same control a limit uses: # is written here, $ is a global variable. A firmware
    // release, or the shape of one, is declared once and read by every step that checks it.
    field(regex ? 'Regular expression' : 'Expected text',
      valueInput(store, [...path, 'text'], doc, {
        text: true,
        placeholder: regex ? 'e.g. ^LCU200 v\\d+\\.\\d+\\.\\d+$' : 'e.g. LCU200 v1.4.0',
      }),
      {
        help: regex
          ? 'A pattern, written without the slashes — or a variable holding one. The answer passes when the pattern matches it.'
          : 'A constant, or a global variable holding the text to expect.',
      }),
    h('div', { class: 'field-row' },
      field('Case', checkInput(store, [...path, 'caseSensitive'], 'Case sensitive')),
      field('Pattern', checkInput(store, [...path, 'regex'], 'Regular expression'), {
        help: 'The value becomes a pattern, and the comparison above no longer applies.',
      })));
}

/** A pass or a fail on its own: the unit answers yes or no. */
function booleanCriterion(store, path) {
  return h('div', {},
    selectField(store, [...path, 'booleanValue'], 'Passes when the result is', [
      { value: 'true', label: 'TRUE — the condition holds' },
      { value: 'false', label: 'FALSE — the condition does not hold' },
    ], { blank: false }),
    h('p', { class: 'hint' }, 'No limits and no unit: the step reports a pass or a fail, and the document says which answer is the good one.'));
}

function numericCriterion(store, doc, path, e) {
  const code = comparisonOf(e);
  const spec = COMPARISON[code] || {};

  // One list, as TestStand has it: the type first, then what makes the measurement pass.
  const typeSelect = h('select', { class: 'inp' },
    ...Object.entries(COMPARISON).map(([value, c]) =>
      h('option', { value, selected: value === code }, `${value} (${c.code}) — ${c.condition}`)));
  typeSelect.addEventListener('change', () => {
    const next = typeSelect.value;
    const from = COMPARISON[code] || {};
    const to = COMPARISON[next] || {};
    // The threshold follows the comparison into the field the new one reads.
    if (from.sides === 1 && to.sides === 1 && from.slot !== to.slot) {
      store.write([...path, to.slot], store.read([...path, from.slot]) || constant(''), null);
      store.write([...path, from.slot], constant(''), null);
    }
    store.write([...path, 'mode'], to.mode === 'nominal' ? 'nominal' : 'minmax', null);
    store.write([...path, 'comparison'], next, null);
    store.refresh();
  });

  const fields = () => {
    if (code === 'EQT') {
      return h('div', { class: 'field-row' },
        valueField(store, [...path, 'nominal'], 'Nominal', doc),
        valueField(store, [...path, 'tolerance'], 'Tolerance', doc),
        selectField(store, [...path, 'toleranceType'], 'Type', [
          { value: 'absolute', label: 'Absolute' },
          { value: 'percent', label: 'Percent (%)' },
        ], { blank: false }));
    }
    if (spec.sides === 0) return null;
    if (spec.sides === 1) {
      return h('div', { class: 'field-row' },
        valueField(store, [...path, spec.slot], 'Limit', doc, {
          help: `Passes when ${spec.condition.replace('Limit', 'this').toLowerCase()}.`,
        }));
    }
    return h('div', { class: 'field-row' },
      valueField(store, [...path, 'min'], `Low limit (${spec.low})`, doc),
      valueField(store, [...path, 'max'], `High limit (${spec.high})`, doc));
  };

  return h('div', {},
    field('Comparison type', typeSelect, {
      help: e.comparison
        ? null
        : 'Not stated in the document: read from the limits filled in, as it has always been.',
    }),
    fields(),
    code === 'NONE'
      ? h('p', { class: 'hint' }, 'The value is written down and nothing is judged: the step has no pass or fail of its own.')
      : null,
    textField(store, [...path, 'unit'], 'Unit'));
}

