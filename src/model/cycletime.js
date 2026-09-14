// Estimating how long the sequence takes.
//
// The specification says what to do, not how fast the bench does it, so none of this belongs
// in the printed document: the figures live in the estimator and are read from three places
// that the document does carry anyway —
//
//   · the wait declared on a step, which is time nobody can compress;
//   · the nominal execution time of a command, which is what the bus costs;
//   · the average time an instrument is held for one use, the only figure the estimator
//     asks for and the only one that is a guess.
//
// Two numbers come out of it. The serial time is the sum of every stage, one at a time, and
// it is the honest worst case. The parallel time uses the same groups the resource count
// uses: stages that may run together are charged as the longest of them, once.
import { testStages, setupStages, parallelGroupsDetailed } from './stages.js';
import { STEP_TYPE, EXCLUSION_MODE, stepBlocks } from './schema.js';
import { blockResources, commandInterfaces } from './resources.js';
import { variableIndex, resolveValue } from './variables.js';

const seconds = (value, unit) => {
  const n = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || n === 0) return 0;
  const u = String(unit || 's').trim().toLowerCase();
  if (u === 'ms') return n / 1000;
  if (u === 'us' || u === 'µs' || u === 'μs') return n / 1e6;
  if (u === 'min' || u === 'm') return n * 60;
  if (u === 'h') return n * 3600;
  return n; // seconds, and anything that does not say otherwise
};

export const parseSeconds = (value) => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * What one step costs, split so the estimate can be read rather than believed.
 * @returns {{wait: number, commands: number, resources: number, total: number}}
 */
export function stepTime(doc, step, index) {
  const wait = waitSeconds(step, index);
  let commands = 0;
  let resources = 0;
  // A table step sends each column's command once per row, and holds each column's
  // instrument once per row: the matrix is run line by line.
  const times = step.type === STEP_TYPE.TABLE ? Math.max(1, ((step.table || {}).rows || []).length) : 1;
  for (const { block } of stepBlocks(step)) {
    if (block.commandId) {
      const command = index.commands.get(block.commandId);
      commands += times * parseSeconds(command && command.nominalTime);
    }
    // The instrument the step names and the one behind its command both hold the bench.
    for (const id of blockResources(block, index.interfaceOfCommand)) {
      resources += times * parseSeconds((index.resources.get(id) || {}).averageTime);
    }
  }
  return { wait, commands, resources, total: wait + commands + resources };
}

/**
 * The wait of a step in seconds. A wait bound to a variable takes the variable's value and,
 * when the variable states one, its unit: «Ton = 100 ms» settles the unit for every step
 * that waits on it, whatever the step's own field says.
 */
function waitSeconds(step, index) {
  const w = step.wait || {};
  const r = resolveValue(w.value, index.variables, w.unit);
  return seconds(r.value != null ? r.value : r.text, r.unit);
}

const buildIndex = (doc) => ({
  variables: variableIndex(doc),
  interfaceOfCommand: commandInterfaces(doc),
  commands: new Map((doc.commands || []).map((c) => [c.id, c])),
  resources: new Map((doc.resources || []).map((r) => [r.id, r])),
  stages: new Map((doc.stages || []).map((s) => [s.id, s])),
});

/** Time of one stage, the setup stages its steps call included. */
export function stageTime(doc, stage, index, seen = new Set()) {
  let total = 0;
  const parts = { wait: 0, commands: 0, resources: 0, calls: 0 };
  for (const test of stage.tests || []) {
    for (const step of test.steps || []) {
      if (step.type === STEP_TYPE.STAGE_CALL) {
        const called = index.stages.get(step.calledStageId);
        // A setup stage that called itself would never come back; the validator reports it,
        // and the estimate simply stops counting.
        if (called && !seen.has(called.id)) {
          const inner = stageTime(doc, called, index, new Set([...seen, called.id]));
          parts.calls += inner.total;
          total += inner.total;
        }
        const wait = waitSeconds(step, index);
        total += wait;
        parts.wait += wait;
        continue;
      }
      const t = stepTime(doc, step, index);
      parts.wait += t.wait;
      parts.commands += t.commands;
      parts.resources += t.resources;
      total += t.total;
    }
  }
  return { ...parts, total };
}

/**
 * The estimate.
 * @returns {{stages: Array, serial: number, parallel: number, groups: Array, truncated: boolean,
 *            missing: {resources: Array, commands: Array}}}
 */
export function estimateCycleTime(doc) {
  const index = buildIndex(doc);
  const tests = testStages(doc);
  const rows = tests.map((stage) => ({ stage, ...stageTime(doc, stage, index) }));
  const byId = new Map(rows.map((r) => [r.stage.id, r]));
  const serial = rows.reduce((n, r) => n + r.total, 0);

  // Stages that may run together cost the longest of them; the rest add up. The groups are
  // the same ones the resource count uses, so the two figures never disagree.
  const { groups, truncated } = parallelGroupsDetailed(doc);
  const covered = new Set();
  let parallel = 0;
  const schedule = [];
  for (const group of groups) {
    const members = group.filter((id) => !covered.has(id) && byId.has(id));
    if (!members.length) continue;
    const longest = Math.max(...members.map((id) => byId.get(id).total));
    parallel += longest;
    schedule.push({ ids: members, seconds: longest });
    for (const id of members) covered.add(id);
  }
  for (const row of rows) {
    if (covered.has(row.stage.id)) continue;
    parallel += row.total;
    schedule.push({ ids: [row.stage.id], seconds: row.total });
  }

  // What the estimate is missing, so nobody mistakes a partial sum for a measurement.
  const usedResources = new Set();
  const usedCommands = new Set();
  for (const stage of doc.stages || []) for (const t of stage.tests || []) for (const s of t.steps || []) {
    for (const { block } of stepBlocks(s)) {
      for (const id of blockResources(block, index.interfaceOfCommand)) usedResources.add(id);
      if (block.commandId) usedCommands.add(block.commandId);
    }
  }
  const missing = {
    resources: (doc.resources || []).filter((r) => usedResources.has(r.id) && !parseSeconds(r.averageTime)),
    commands: (doc.commands || []).filter((c) => usedCommands.has(c.id) && !parseSeconds(c.nominalTime)),
  };

  // When the two figures coincide the reason is worth stating: an equality with no
  // explanation looks like an estimator that did not try.
  const blockers = tests
    .filter((s) => (s.exclusions || {}).mode && s.exclusions.mode !== EXCLUSION_MODE.NONE)
    .map((s) => ({
      id: s.id,
      name: s.name,
      mode: s.exclusions.mode,
      stageIds: (s.exclusions.stageIds || []).slice(),
    }));

  return {
    stages: rows,
    setups: setupStages(doc).map((s) => ({ stage: s, ...stageTime(doc, s, index) })),
    serial, parallel, schedule, truncated, missing, blockers,
    everySlotAlone: schedule.every((slot) => slot.ids.length === 1),
  };
}

/** «1 h 04 min 12 s», or «2.5 s» when that is all it is. */
export function formatSeconds(total) {
  if (!total) return '—';
  if (total < 60) return `${Math.round(total * 10) / 10} s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round(total % 60);
  return [h ? `${h} h` : null, (h || m) ? `${m} min` : null, `${s} s`].filter(Boolean).join(' ');
}
