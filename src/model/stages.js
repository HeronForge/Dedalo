// Stage graph: prerequisites, topological order, cycles, groups that may run in parallel,
// and the call relation between test stages and setup stages.
//
// Only test stages take part in the sequence: a setup stage has no place of its own, it runs
// wherever a step calls it, as many times as it is called. Everything that reasons about
// order or concurrency therefore works on the test stages alone.
import { EXCLUSION_MODE, STAGE_KIND, STEP_TYPE } from './schema.js';

export const isSetup = (stage) => !!stage && stage.kind === STAGE_KIND.SETUP;
export const isTestStage = (stage) => !isSetup(stage);

export const testStages = (doc) => (doc.stages || []).filter(isTestStage);
export const setupStages = (doc) => (doc.stages || []).filter(isSetup);

export const stageIndex = (doc) => new Map((doc.stages || []).map((s) => [s.id, s]));

/** Valid direct prerequisites (references to missing stages are ignored here). */
export function prerequisites(stage, index) {
  return (stage.prerequisites || []).filter((id) => index.has(id));
}

/** The step with that id inside a stage, or null. Three readers needed it: one copy. */
export function findStep(stage, stepId) {
  for (const t of stage.tests || []) {
    const s = (t.steps || []).find((x) => x.id === stepId);
    if (s) return s;
  }
  return null;
}

/** Who calls what: calledStageId -> [{ stageId, testId, stepId }]. */
export function callMap(doc) {
  const out = new Map();
  for (const stage of doc.stages || []) {
    for (const test of stage.tests || []) {
      for (const step of test.steps || []) {
        if (step.type !== STEP_TYPE.STAGE_CALL || !step.calledStageId) continue;
        if (!out.has(step.calledStageId)) out.set(step.calledStageId, []);
        out.get(step.calledStageId).push({ stageId: stage.id, testId: test.id, stepId: step.id });
      }
    }
  }
  return out;
}

/**
 * For every stage, the test stages that actually run it: a test stage runs itself, a setup
 * stage runs inside each of its callers (following nested calls). A setup stage nobody calls
 * falls back to itself, so its resources are not silently lost.
 */
export function runningStages(doc) {
  const index = stageIndex(doc);
  const calls = callMap(doc);
  const out = new Map();
  const resolve = (id, seen) => {
    const stage = index.get(id);
    if (!stage) return new Set();
    if (isTestStage(stage)) return new Set([id]);
    if (seen.has(id)) return new Set(); // recursion: reported by validation
    seen.add(id);
    const owners = new Set();
    for (const caller of calls.get(id) || []) {
      for (const owner of resolve(caller.stageId, seen)) owners.add(owner);
    }
    seen.delete(id);
    return owners.size ? owners : new Set([id]);
  };
  for (const id of index.keys()) out.set(id, resolve(id, new Set()));
  return out;
}

/** Transitive closure of the prerequisites, over the test stages: id -> Set(id before it). */
export function transitivePrerequisites(doc) {
  const index = new Map(testStages(doc).map((s) => [s.id, s]));
  const memo = new Map();
  const visit = (id, inProgress) => {
    if (memo.has(id)) return memo.get(id);
    if (inProgress.has(id)) return new Set(); // cycle: stop here, validation reports it
    inProgress.add(id);
    const acc = new Set();
    for (const p of prerequisites(index.get(id) || { prerequisites: [] }, index)) {
      acc.add(p);
      for (const t of visit(p, inProgress)) acc.add(t);
    }
    inProgress.delete(id);
    memo.set(id, acc);
    return acc;
  };
  const out = new Map();
  for (const id of index.keys()) out.set(id, visit(id, new Set()));
  return out;
}

/** Cycles in the prerequisites, as a list of id paths. */
export function findCycles(doc) {
  const index = new Map(testStages(doc).map((s) => [s.id, s]));
  const cycles = [];
  const state = new Map(); // 0 = unvisited, 1 = in progress, 2 = done
  const stack = [];
  const visit = (id) => {
    state.set(id, 1);
    stack.push(id);
    for (const p of prerequisites(index.get(id), index)) {
      if (state.get(p) === 1) {
        const i = stack.indexOf(p);
        cycles.push(stack.slice(i).concat(p));
      } else if (!state.get(p)) visit(p);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of index.keys()) if (!state.get(id)) visit(id);
  return cycles;
}

/** Topological levels of the test stages: an array of arrays of stage ids. */
export function levels(doc) {
  const index = new Map(testStages(doc).map((s) => [s.id, s]));
  const remaining = new Set(index.keys());
  const done = new Set();
  const out = [];
  while (remaining.size) {
    const level = [...remaining].filter((id) => prerequisites(index.get(id), index).every((p) => done.has(p) || !remaining.has(p)));
    if (!level.length) { out.push([...remaining]); break; } // cycle: everything left on one level
    for (const id of level) remaining.delete(id);
    for (const id of level) done.add(id);
    out.push(level);
  }
  return out;
}

/** True when the two stages exclude each other by explicit declaration. */
export function mutuallyExcluded(a, b) {
  const excludes = (x, y) => {
    const e = x.exclusions || { mode: EXCLUSION_MODE.NONE };
    if (e.mode === EXCLUSION_MODE.ALL) return true;
    if (e.mode === EXCLUSION_MODE.LIST) return (e.stageIds || []).includes(y.id);
    return false;
  };
  return excludes(a, b) || excludes(b, a);
}

/** True when the two stages may be running at the same time. */
export function canCoexist(a, b, transitive) {
  if (a.id === b.id) return false;
  if (mutuallyExcluded(a, b)) return false;
  if ((transitive.get(a.id) || new Set()).has(b.id)) return false;
  if ((transitive.get(b.id) || new Set()).has(a.id)) return false;
  return true;
}

/**
 * Maximal groups of test stages that may run at the same time
 * (maximal cliques of the compatibility graph, Bron-Kerbosch with pivot).
 *
 * Enumerating cliques is exponential in the worst case, so the search is capped. When the cap
 * is hit the answer is incomplete, and `truncated` says so: whoever uses the groups to size the
 * bench must know the figure is no longer exact rather than trust a silently partial result.
 *
 * @returns {{groups: string[][], truncated: boolean}}
 */
export function parallelGroupsDetailed(doc) {
  const stages = testStages(doc);
  if (!stages.length) return { groups: [], truncated: false };
  // Four parts of the editor ask for the groups on every change, and the search behind them
  // is exponential in the exclusions: on a document with thirty stages excluding each other in
  // pairs it took a quarter of a second, four times per keystroke. The answer depends on the
  // stages' ids, kinds, prerequisites and exclusions and on nothing else, so it is kept with
  // that as its key and computed again only when one of them moves.
  const signature = JSON.stringify(stages.map((s) => [s.id, s.kind, s.prerequisites, s.exclusions]));
  const kept = GROUPS_MEMO.get(doc.stages);
  if (kept && kept.signature === signature) return kept.result;
  const result = computeParallelGroups(doc, stages);
  GROUPS_MEMO.set(doc.stages, { signature, result });
  return result;
}

const GROUPS_MEMO = new WeakMap();

function computeParallelGroups(doc, stages) {
  const transitive = transitivePrerequisites(doc);
  const neighbours = stages.map(() => new Set());
  for (let i = 0; i < stages.length; i++)
    for (let j = i + 1; j < stages.length; j++)
      if (canCoexist(stages[i], stages[j], transitive)) { neighbours[i].add(j); neighbours[j].add(i); }

  const cliques = [];
  let steps = 0;
  let truncated = false;
  const LIMIT = 200000;
  const bk = (R, P, X) => {
    if (steps++ > LIMIT) { truncated = true; return; }
    if (!P.size && !X.size) { if (R.size) cliques.push([...R]); return; }
    const pivot = [...P, ...X].reduce((best, v) => (neighbours[v].size > (best == null ? -1 : neighbours[best].size) ? v : best), null);
    const candidates = [...P].filter((v) => !neighbours[pivot].has(v));
    for (const v of candidates) {
      bk(new Set([...R, v]), new Set([...P].filter((u) => neighbours[v].has(u))), new Set([...X].filter((u) => neighbours[v].has(u))));
      P.delete(v); X.add(v);
    }
  };
  bk(new Set(), new Set(stages.map((_, i) => i)), new Set());

  // Isolated stages appear in no clique: they count as a group of their own.
  const covered = new Set(cliques.flat());
  stages.forEach((_, i) => { if (!covered.has(i)) cliques.push([i]); });

  return {
    groups: cliques.map((g) => g.map((i) => stages[i].id)).filter((g) => g.length),
    truncated,
  };
}

/** The groups alone, for the callers that do not care about the cap. */
export const parallelGroups = (doc) => parallelGroupsDetailed(doc).groups;
