// Summary of the test resources required by the specification, with the concurrent channel count.
//
// Counting rule (also stated in the document, so the reader can check it):
//  1. inside a stage a resource needs one channel for every distinct application point it is
//     used on (worst case: every connection present on the bench at the same time);
//     a use with no declared point counts as one channel;
//  2. what a setup stage uses is charged to the test stages that call it, since a setup stage
//     never runs on its own;
//  3. stimuli declared "held on exit" keep occupying their channels in every stage that has
//     that stage as a prerequisite, directly or indirectly;
//  4. the total requirement is the largest sum of channels over all groups of test stages that
//     may run in parallel.
import { transitivePrerequisites, parallelGroupsDetailed, runningStages, findStep } from './stages.js';
import { stepBlocks } from './schema.js';

/** Every resource use, with the context it appears in. */
export function collectUses(doc) {
  const uses = [];
  const interfaceOfCommand = commandInterfaces(doc);
  for (const stage of doc.stages || []) {
    for (const test of stage.tests || []) {
      for (const step of test.steps || []) {
        // A table step's columns are its blocks: one use per column, whatever the rows.
        for (const { kind, block } of stepBlocks(step)) {
          const points = blockPoints(block, interfaceOfCommand);
          // Two instruments can be involved in one line: the one the step names, and the one
          // that drives the bus its command travels on. Both occupy the bench.
          for (const resourceId of blockResources(block, interfaceOfCommand)) {
            uses.push({ resourceId, kind, block, stageId: stage.id, testId: test.id, stepId: step.id, pointIds: points });
          }
        }
      }
    }
  }
  return uses;
}

/**
 * The points a block occupies: the ones it names, plus the ones the interface behind its
 * command is wired to. Talking to the unit over the bus takes the bus contacts, exactly as
 * applying a voltage takes the ones the stimulus names — the bench has to reach both.
 */
export function blockPoints(block, interfaceOfCommand) {
  // A block that speaks a command speaks it over an interface, and the interface says where
  // it is wired and what drives it. The step declares neither: two places for one fact is
  // how a document ends up disagreeing with itself.
  const itf = block.commandId ? interfaceOfCommand.get(block.commandId) : null;
  if (itf) return [...new Set(itf.pointIds || [])];
  return [...new Set(block.pointIds || [])];
}

/**
 * The instruments a block occupies. A command brings the one its interface declares and
 * nothing else; a block without a command brings the one it names.
 */
export function blockResources(block, interfaceOfCommand) {
  const itf = block.commandId ? interfaceOfCommand.get(block.commandId) : null;
  if (itf) return itf.resourceId ? [itf.resourceId] : [];
  return block.resourceId ? [block.resourceId] : [];
}

/** command id -> the interface it speaks over. */
export function commandInterfaces(doc) {
  const interfaces = new Map((doc.interfaces || []).map((i) => [i.id, i]));
  const out = new Map();
  for (const c of doc.commands || []) if (c.interfaceId) out.set(c.id, interfaces.get(c.interfaceId) || null);
  return out;
}

/** Channel keys of one use: one per distinct point, or the step itself when it has none. */
const channelKeys = (use) => (use.pointIds.length ? use.pointIds.map((p) => 'pt:' + p) : ['step:' + use.stepId]);

/**
 * Channels taken by stimuli held on exit, charged to the test stage they belong to: a
 * stimulus held by a setup stage stays applied for whoever called it.
 */
function heldChannels(doc, owners) {
  const interfaces = commandInterfaces(doc);
  const perStage = new Map(); // test stageId -> Map(resourceId -> Set(key))
  const add = (stageId, resourceId, keys) => {
    if (!perStage.has(stageId)) perStage.set(stageId, new Map());
    const m = perStage.get(stageId);
    if (!m.has(resourceId)) m.set(resourceId, new Set());
    for (const k of keys) m.get(resourceId).add(k);
  };
  for (const stage of doc.stages || []) {
    for (const held of stage.heldStimuli || []) {
      const step = findStep(stage, held.stepId);
      const block = step && step.stimulus;
      if (!block) continue;
      const keys = channelKeys({ pointIds: blockPoints(block, interfaces), stepId: step.id });
      for (const resourceId of blockResources(block, interfaces)) {
        for (const ownerId of owners.get(stage.id) || [stage.id]) add(ownerId, resourceId, keys);
      }
    }
  }
  return perStage;
}

/**
 * Full summary: one row per used resource, plus the rows of resources declared in the
 * catalogue but never used (useful when reviewing the document).
 */
export function resourceSummary(doc) {
  const uses = collectUses(doc);
  const transitive = transitivePrerequisites(doc);
  const { groups, truncated } = parallelGroupsDetailed(doc);
  const owners = runningStages(doc);
  const held = heldChannels(doc, owners);

  // resourceId -> stageId -> Set(channel key)
  const channels = new Map();
  const add = (resourceId, stageId, keys) => {
    if (!channels.has(resourceId)) channels.set(resourceId, new Map());
    const perStage = channels.get(resourceId);
    if (!perStage.has(stageId)) perStage.set(stageId, new Set());
    for (const k of keys) perStage.get(stageId).add(k);
  };

  for (const use of uses) {
    for (const stageId of owners.get(use.stageId) || [use.stageId]) add(use.resourceId, stageId, channelKeys(use));
  }

  // Held stimuli propagate to the stages that depend on that stage, even indirectly.
  for (const stage of doc.stages || []) {
    for (const prereqId of transitive.get(stage.id) || []) {
      const m = held.get(prereqId);
      if (!m) continue;
      for (const [resourceId, keys] of m) add(resourceId, stage.id, keys);
    }
  }

  const rows = [];
  for (const resource of doc.resources || []) {
    rows.push(buildRow(doc, resource, channels.get(resource.id) || new Map(), uses, groups, truncated));
  }
  // Resources referenced but missing from the catalogue: placeholder row, flagged by validation.
  for (const [resourceId, perStage] of channels) {
    if ((doc.resources || []).some((r) => r.id === resourceId)) continue;
    rows.push(buildRow(doc, { id: resourceId, name: '⟨missing resource⟩', missing: true }, perStage, uses, groups, truncated));
  }
  return { rows, groups, truncated };
}

function buildRow(doc, resource, perStage, uses, groups, truncated) {
  const channelsPerStage = new Map([...perStage].map(([stageId, set]) => [stageId, set.size]));
  let maxChannels = 0;
  let criticalGroup = null;
  for (const group of groups) {
    const sum = group.reduce((acc, stageId) => acc + (channelsPerStage.get(stageId) || 0), 0);
    if (sum > maxChannels) { maxChannels = sum; criticalGroup = group; }
  }
  // A stage that appears in no group still counts on its own.
  for (const [, n] of channelsPerStage) if (n > maxChannels) maxChannels = n;

  // When the parallel groups could not be enumerated in full, an exact figure would be a
  // guess: fall back on the worst case, every stage at once, and say the number is a bound.
  if (truncated) {
    const total = [...channelsPerStage.values()].reduce((a, b) => a + b, 0);
    if (total > maxChannels) { maxChannels = total; criticalGroup = null; }
  }

  const own = uses.filter((u) => u.resourceId === resource.id);
  const usedPoints = new Set();
  let usesWithoutPoint = 0;
  for (const u of own) {
    if (u.pointIds.length) u.pointIds.forEach((p) => usedPoints.add(p));
    else usesWithoutPoint++;
  }
  // Document order, so the appendix reads in the same order as the point list.
  const points = (doc.points || []).filter((p) => usedPoints.has(p.id)).map((p) => p.id);
  for (const id of usedPoints) if (!points.includes(id)) points.push(id);

  return {
    resource,
    approximate: !!truncated,
    uses: own,
    points,
    usesWithoutPoint,
    channelsPerStage,
    maxChannels,
    criticalGroup,
    usedParameters: distinctParameters(own),
  };
}

/** Names of the parameters the various uses ask of the resource. */
function distinctParameters(uses) {
  const set = new Set();
  for (const u of uses) for (const p of u.block.parameters || []) if (p.name) set.add(p.name);
  return [...set];
}
