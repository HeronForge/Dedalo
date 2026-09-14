// Negative cases: the ways a document, a file or an edit can be wrong.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyDocument, newStage, newTest, newStep, newResource, newInterface, newCommand,
  newPoint, newVariant, normaliseStepForType, STEP_TYPE, EXCLUSION_MODE,
} from '../src/model/schema.js';
import { readEmbeddedData, looksLikeSpecification, compareHistories, protectJson } from '../src/io/file.js';
import { createStore } from '../src/model/store.js';
import { validateDocument, SEVERITY } from '../src/model/validate.js';
import { issueRevision, revisionDocument, isNumberIssued, draftIsReleased, completeAssetIds, isDraft, openDraft, changeRecord, comparableVersions, editedSinceIssue } from '../src/history/revisions.js';
import { pruneAssets } from '../src/io/images.js';
import { expectedText } from '../src/model/variables.js';
import { newId, isId } from '../src/model/ids.js';
import { constant, SCHEMA_VERSION } from '../src/model/schema.js';
import { parallelGroupsDetailed } from '../src/model/stages.js';
import { resourceSummary } from '../src/model/resources.js';
import { importData } from '../src/io/import.js';
import {
  identityKey, docFingerprint, saveDraft, loadDraft, findDraft, dropDraft, listDrafts, pruneDrafts,
} from '../src/io/recovery.js';

const errorsOf = (doc) => validateDocument(doc).issues.filter((i) => i.severity === SEVERITY.ERROR);

/** A stand-in for a parsed HTML document, so the block reading can be tested without a DOM. */
const fakeRoot = (blocks) => ({
  getElementById: (id) => (id in blocks ? { textContent: blocks[id] } : null),
});

// ---- opening a file ----------------------------------------------------------

test('an HTML without data blocks is not mistaken for an empty specification', () => {
  const data = readEmbeddedData(fakeRoot({}));
  assert.equal(data.block.present, false);
  // The document still comes out usable, but the caller can tell there was nothing to read.
  assert.equal(data.doc.schemaVersion, SCHEMA_VERSION);
});

test('a damaged data block is told apart from a missing one', () => {
  const broken = readEmbeddedData(fakeRoot({ 'tsw-doc': '{ this is not json' }));
  assert.equal(broken.block.present, true);
  assert.equal(broken.block.valid, false);

  const good = readEmbeddedData(fakeRoot({ 'tsw-doc': JSON.stringify(emptyDocument()) }));
  assert.equal(good.block.valid, true);
  assert.equal(looksLikeSpecification(good.block.value), true);
});

test('only something shaped like a specification counts as one', () => {
  assert.equal(looksLikeSpecification(null), false);
  assert.equal(looksLikeSpecification('a string'), false);
  assert.equal(looksLikeSpecification([]), false);
  assert.equal(looksLikeSpecification({ hello: 'world' }), false);
  assert.equal(looksLikeSpecification({ stages: [] }), true);
  assert.equal(looksLikeSpecification(emptyDocument()), true);
});

test('a JSON whose «doc» is not a document is refused', () => {
  assert.throws(() => importData({ doc: 'not a document' }), /does not hold a specification/);
  assert.throws(() => importData({ doc: { title: 'x' } }), /does not hold a specification/);
  assert.doesNotThrow(() => importData({ doc: emptyDocument() }));
});

// ---- histories ---------------------------------------------------------------

test('two histories of the same length but different content are diverged, not equal', () => {
  const mine = { revisions: [{ number: '00', date: '2026-01-01', status: 'issued' }, { number: '01', date: '2026-02-02', status: 'issued' }] };
  const theirs = { revisions: [{ number: '00', date: '2026-01-01', status: 'issued' }, { number: '01', date: '2026-09-09', status: 'issued' }] };
  assert.equal(compareHistories(mine, theirs), 'diverged');
  assert.equal(compareHistories(mine, mine), 'same');
  assert.equal(compareHistories(mine, { revisions: mine.revisions.slice(0, 1) }), 'behind');
  assert.equal(compareHistories({ revisions: mine.revisions.slice(0, 1) }, mine), 'ahead');
});

// ---- issuing a revision ------------------------------------------------------

test('the snapshot of an issued revision carries the issued metadata, not the draft one', async () => {
  const doc = emptyDocument();
  doc.revision = { number: '00', date: '2026-01-01', author: '', reason: '', status: 'draft' };
  const res = await issueRevision(doc, { revisions: [] }, { author: 'M. Rossi', reason: 'First issue', status: 'approved' });

  const row = res.history.revisions[0];
  const frozen = await revisionDocument(row);
  assert.equal(row.status, 'approved');
  assert.equal(frozen.revision.status, 'approved');
  assert.equal(frozen.revision.author, 'M. Rossi');
  assert.equal(frozen.revision.reason, 'First issue');
  assert.equal(frozen.revision.number, '00');
  // The working copy is the revision it was validated as: no draft opens by itself.
  assert.equal(res.doc.revision.number, '00');
  assert.equal(res.doc.revision.status, 'approved');
  assert.equal(isDraft(res.doc), false);
});

test('the next draft opens on request, under the next free number, and only once', async () => {
  const doc = emptyDocument();
  doc.revision = { number: '00', date: '2026-01-01', author: 'M. Rossi', reason: 'First', status: 'draft' };
  const res = await issueRevision(doc, { revisions: [] }, { author: 'M. Rossi', reason: 'First issue' });
  // No draft: the record ends with the revision, and the comparison offers the copy as issued.
  assert.equal(changeRecord(res.doc, res.history).length, 1);
  assert.match(comparableVersions(res.doc, res.history).pop().label, /as issued/);

  const draft = openDraft(res.doc, res.history);
  assert.equal(draft.revision.number, '01');
  assert.equal(draft.revision.status, 'draft');
  assert.equal(draft.revision.author, 'M. Rossi');
  assert.equal(draft.revision.reason, '');
  assert.equal(changeRecord(draft, res.history).length, 2, 'the draft is a row again');
  // Asked on a draft, nothing changes: there is one draft at a time.
  assert.equal(openDraft(draft, res.history), draft);
  // A number the record already holds is skipped.
  const crowded = { revisions: [...res.history.revisions, { ...res.history.revisions[0], number: '01' }] };
  assert.equal(openDraft(res.doc, crowded).revision.number, '02');
});

test('an issued document edited without a draft is an error, and the draft clears it', async () => {
  const doc = emptyDocument();
  doc.header.title = 'Lamp';
  const res = await issueRevision(doc, { revisions: [] }, { author: 'A', reason: 'First' });
  const clean = validateDocument(res.doc, { history: res.history }).issues;
  assert.equal(clean.some((i) => /changed since/.test(i.message)), false);

  const edited = { ...res.doc, header: { ...res.doc.header, title: 'Lamp, second source' } };
  assert.equal(editedSinceIssue(edited, res.history), true);
  const issues = validateDocument(edited, { history: res.history }).issues;
  assert.ok(issues.some((i) => i.severity === 'error' && /changed since/.test(i.message)));

  const draft = openDraft(edited, res.history);
  assert.equal(validateDocument(draft, { history: res.history }).issues.some((i) => /changed since|already been issued/.test(i.message)), false);
});

test('a revision number already issued is refused instead of overwriting it', async () => {
  const doc = emptyDocument();
  doc.revision = { number: '00', date: '2026-01-01', author: '', reason: '', status: 'draft' };
  const first = await issueRevision(doc, { revisions: [] }, { reason: 'First issue' });
  assert.equal(isNumberIssued(first.history, '00'), true);

  const again = { ...first.doc, revision: { ...first.doc.revision, number: '00' } };
  await assert.rejects(() => issueRevision(again, first.history, { reason: 'oops' }), /already been issued/);
  assert.equal(first.history.revisions.length, 1);
  assert.equal(first.history.revisions[0].reason, 'First issue');
});

test('a draft whose number is already issued is flagged by validation', async () => {
  const doc = emptyDocument();
  doc.revision = { number: '00', date: '2026-01-01', author: '', reason: '', status: 'draft' };
  const res = await issueRevision(doc, { revisions: [] }, {});
  const clashing = { ...openDraft(res.doc, res.history), revision: { ...res.doc.revision, number: '00', status: 'draft' } };
  const issues = validateDocument(clashing, { history: res.history }).issues;
  assert.ok(issues.some((i) => /already been issued/.test(i.message)));
  // The issued copy itself carries the issued number, and that is not a clash.
  assert.equal(validateDocument(res.doc, { history: res.history }).issues.some((i) => /already been issued/.test(i.message)), false);
  // Nor is the number the draft actually moves on to.
  assert.equal(validateDocument(openDraft(res.doc, res.history), { history: res.history }).issues.some((i) => /already been issued/.test(i.message)), false);
});

// ---- references of the wrong kind --------------------------------------------

test('a reference pointing at the wrong kind of entity is an error, not a pass', () => {
  const doc = emptyDocument();
  const resource = Object.assign(newResource(), { name: 'PSU' });
  const itf = Object.assign(newInterface(), { name: 'CAN' });
  const point = Object.assign(newPoint(), { name: 'VBAT' });
  const command = Object.assign(newCommand(), { name: 'Read', interfaceId: resource.id }); // a resource, not an interface
  doc.resources = [resource]; doc.interfaces = [itf]; doc.points = [point]; doc.commands = [command];

  const stage = Object.assign(newStage(), { name: 'A' });
  const t = Object.assign(newTest(), { name: 'T' });
  const step = newStep(STEP_TYPE.MEASUREMENT);
  step.description = 'x';
  Object.assign(step.measurement, {
    description: 'y',
    resourceId: itf.id,        // an interface, not a resource
    commandId: point.id,       // a point, not a command
    pointIds: [command.id],    // a command, not a point
  });
  t.steps = [step]; stage.tests = [t]; doc.stages = [stage];

  const messages = errorsOf(doc).map((e) => e.message);
  assert.equal(messages.length, 4);
  assert.ok(messages.some((m) => /interface that is not an interface/.test(m)));
  assert.ok(messages.some((m) => /the resource is not a resource/.test(m)));
  assert.ok(messages.some((m) => /the command is not a command/.test(m)));
  assert.ok(messages.some((m) => /application point is not an application point/.test(m)));
});

test('a dangling reference still says it does not exist', () => {
  const doc = emptyDocument();
  const stage = Object.assign(newStage(), { name: 'A' });
  const t = Object.assign(newTest(), { name: 'T' });
  const step = newStep(STEP_TYPE.MEASUREMENT);
  step.description = 'x';
  Object.assign(step.measurement, { description: 'y', resourceId: 'res_gh0st1' });
  t.steps = [step]; stage.tests = [t]; doc.stages = [stage];
  assert.ok(errorsOf(doc).some((e) => /the resource does not exist/.test(e.message)));
});

test('two entities sharing an identifier are reported', () => {
  const doc = emptyDocument();
  const a = Object.assign(newResource(), { name: 'One' });
  const b = Object.assign(newResource(), { name: 'Two' });
  b.id = a.id;
  doc.resources = [a, b];
  assert.ok(errorsOf(doc).some((e) => /used by more than one element/.test(e.message)));
});

// ---- changing the type of a step ---------------------------------------------

test('turning a step into a stage call drops the stimulus it used to carry', () => {
  const step = newStep(STEP_TYPE.STIMULUS_MEASUREMENT);
  step.stimulus.description = 'apply';
  step.measurement.description = 'measure';

  normaliseStepForType(step, STEP_TYPE.STAGE_CALL);
  assert.equal(step.type, STEP_TYPE.STAGE_CALL);
  assert.equal('stimulus' in step, false);
  assert.equal('measurement' in step, false);
});

test('narrowing a step to a stimulus drops the measurement, and widening it creates one', () => {
  const step = newStep(STEP_TYPE.STIMULUS_MEASUREMENT);
  step.stimulus.description = 'apply';

  normaliseStepForType(step, STEP_TYPE.STIMULUS);
  assert.equal('measurement' in step, false);
  assert.equal(step.stimulus.description, 'apply'); // what still fits is kept

  normaliseStepForType(step, STEP_TYPE.STIMULUS_MEASUREMENT);
  assert.ok(step.measurement);
  assert.equal(step.stimulus.description, 'apply');
});

test('a step left over as a stage call no longer counts as a resource user', () => {
  const doc = emptyDocument();
  const resource = Object.assign(newResource(), { name: 'PSU' });
  doc.resources = [resource];
  const stage = Object.assign(newStage(), { name: 'A' });
  const t = Object.assign(newTest(), { name: 'T' });
  const step = newStep(STEP_TYPE.STIMULUS);
  step.description = 'x';
  step.stimulus.resourceId = resource.id;
  t.steps = [step]; stage.tests = [t]; doc.stages = [stage];
  assert.equal(resourceSummary(doc).rows[0].uses.length, 1);

  normaliseStepForType(step, STEP_TYPE.STAGE_CALL);
  assert.equal(resourceSummary(doc).rows[0].uses.length, 0);
});

// ---- reordering while a variant is active ------------------------------------

test('with a variant active the arrows do not reorder the base document', () => {
  const doc = emptyDocument();
  const a = Object.assign(newStage(), { name: 'A' });
  const b = Object.assign(newStage(), { name: 'B' });
  doc.stages = [a, b];
  const variant = Object.assign(newVariant(), { name: 'V' });
  doc.variants = [variant];

  const store = createStore({ doc, history: { revisions: [] }, assets: {} });
  store.set({ variantId: variant.id });

  assert.equal(store.move(['stages'], b.id, -1), false);
  assert.deepEqual(store.state.doc.stages.map((s) => s.name), ['A', 'B']);
  assert.equal(store.state.doc.variants[0].overlay.length, 0);

  // The variants themselves are not variant specific: reordering them is allowed.
  assert.equal(store.move(['variants'], variant.id, 0), true);

  // And on the base document the move works as before.
  store.set({ variantId: '' });
  assert.equal(store.move(['stages'], b.id, -1), true);
  assert.deepEqual(store.state.doc.stages.map((s) => s.name), ['B', 'A']);
});

// ---- when the parallel groups cannot be enumerated ---------------------------

/** Pairs of mutually excluded stages: the number of maximal cliques doubles with each pair. */
function manyCliques(pairs) {
  const doc = emptyDocument();
  doc.stages = [];
  for (let i = 0; i < pairs; i++) {
    const x = Object.assign(newStage(), { name: `X${i}` });
    const y = Object.assign(newStage(), { name: `Y${i}` });
    x.exclusions = { mode: EXCLUSION_MODE.LIST, stageIds: [y.id] };
    doc.stages.push(x, y);
  }
  return doc;
}

test('a graph too large to enumerate says so instead of returning a partial count', () => {
  const small = parallelGroupsDetailed(manyCliques(3));
  assert.equal(small.truncated, false);
  assert.equal(small.groups.length, 8); // 2^3 maximal cliques

  const huge = parallelGroupsDetailed(manyCliques(20));
  assert.equal(huge.truncated, true);
});

test('when the count is truncated the resource table falls back to the worst case', () => {
  const doc = manyCliques(20);
  const resource = Object.assign(newResource(), { name: 'PSU' });
  const point = Object.assign(newPoint(), { name: 'VBAT' });
  doc.resources = [resource];
  doc.points = [point];
  for (const stage of doc.stages) {
    const t = Object.assign(newTest(), { name: 'T' });
    const step = newStep(STEP_TYPE.STIMULUS);
    step.description = 'x';
    Object.assign(step.stimulus, { description: 'y', resourceId: resource.id, pointIds: [point.id] });
    t.steps = [step];
    stage.tests = [t];
  }

  const summary = resourceSummary(doc);
  assert.equal(summary.truncated, true);
  const row = summary.rows[0];
  assert.equal(row.approximate, true);
  // The worst case is one channel per stage, which is what an upper bound must report.
  assert.equal(row.maxChannels, doc.stages.length);
  assert.ok(validateDocument(doc).issues.some((i) => /upper bound/.test(i.message)));
});

test('a nested class list becomes separate classes, not one long name', async () => {
  // `button()` wraps whatever the caller passes inside its own array; joined as it stood,
  // that produced a single class called «btn-primary,btn-unsaved», matching no rule at all.
  const { classAttr } = await import('../src/ui/dom.js');
  assert.equal(classAttr(['btn', ['btn-primary', false, 'btn-unsaved']]), 'btn btn-primary btn-unsaved');
  assert.equal(classAttr('plain'), 'plain');
  assert.equal(classAttr(['a', null, undefined, '']), 'a');
});

test('a revision number already issued is refused, whichever way it is asked for', async () => {
  const { issueRevision, isNumberIssued, nextNumber, openDraft } = await import('../src/history/revisions.js');
  const doc = emptyDocument();
  doc.revision = { number: '00', date: '2026-01-01', author: 'A', reason: 'First', status: 'draft' };
  const first = await issueRevision(doc, { revisions: [] }, { author: 'A', reason: 'First', status: 'issued' });

  assert.equal(first.doc.revision.number, '00'); // the copy is the revision, until a draft opens
  assert.equal(openDraft(first.doc, first.history).revision.number, '01');
  assert.equal(isNumberIssued(first.history, '00'), true);
  assert.equal(nextNumber('02'), '03');

  // Validating the issued copy again would overwrite the record: refused.
  await assert.rejects(() => issueRevision(first.doc, first.history, { author: 'A', reason: 'again', status: 'issued' }));
  // And so is a draft sent back to a number already in the record.
  const back = { ...openDraft(first.doc, first.history), revision: { ...first.doc.revision, number: '00', status: 'draft' } };
  await assert.rejects(() => issueRevision(back, first.history, { author: 'A', reason: 'again', status: 'issued' }));
});

// ---- the recovery draft ------------------------------------------------------

/**
 * A stand-in for the browser storage, with a budget: what makes a draft interesting is
 * exactly what happens when there is no room left for it.
 */
function fakeStorage({ budget = Infinity } = {}) {
  const m = new Map();
  const weight = (key, value) => key.length + value.length;
  const used = (skip) => [...m].reduce((n, [k, v]) => (k === skip ? n : n + weight(k, v)), 0);
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i],
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      const text = String(v);
      if (used(k) + weight(k, text) > budget) {
        const err = new Error('exceeded the quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      m.set(k, text);
    },
    removeItem: (k) => { m.delete(k); },
  };
}

const draftOf = (doc, at = new Date().toISOString()) =>
  ({ at, base: docFingerprint(doc), title: doc.header.title, code: doc.header.documentCode, revision: '00', doc, history: { revisions: [] } });

const specification = (code, title) => {
  const doc = emptyDocument();
  doc.header.documentCode = code;
  doc.header.title = title;
  return doc;
};

test('a draft is offered back when the file it belongs to is opened again', () => {
  const storage = fakeStorage();
  const doc = specification('TS-100', 'Lamp control unit');
  assert.deepEqual(saveDraft(storage, identityKey(doc), draftOf(doc)), { ok: true });

  const found = findDraft(storage, doc);
  assert.equal(found.doc.header.documentCode, 'TS-100');
  // Another specification opened from the same folder does not find it.
  assert.equal(findDraft(storage, specification('TS-200', 'Door module')), null);

  dropDraft(storage, found.key);
  assert.equal(findDraft(storage, doc), null);
});

test('a document renamed during the lost session still finds its draft', () => {
  const storage = fakeStorage();
  const opened = specification('TS-100', 'Lamp control unit');
  const renamed = { ...opened, header: { ...opened.header, title: 'Lamp control unit, second source' } };
  // The draft is written under the new name, the file on disk still carries the old one.
  saveDraft(storage, identityKey(renamed), { ...draftOf(renamed), base: docFingerprint(opened) });

  const found = findDraft(storage, opened);
  assert.ok(found, 'the draft must be found by what the file held, not only by its name');
  assert.equal(found.doc.header.title, 'Lamp control unit, second source');
});

test('a storage that refuses to write leaves a reason, not an exception', () => {
  const storage = fakeStorage({ budget: 10 });
  const doc = specification('TS-100', 'Lamp control unit');
  const result = saveDraft(storage, identityKey(doc), draftOf(doc));
  assert.equal(result.ok, false);
  assert.match(result.reason, /full/);
});

test('the work in hand makes room from stale drafts, never from somebody else\'s unsaved work', () => {
  const other = specification('TS-900', 'Old project');
  const mine = specification('TS-100', 'Lamp control unit');
  const roomForOne = JSON.stringify({ v: 1, ...draftOf(other) }).length + identityKey(other).length + 40;

  // A draft of another file from last season: dropped to make room.
  const stale = fakeStorage({ budget: roomForOne });
  const longAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  assert.equal(saveDraft(stale, identityKey(other), draftOf(other, longAgo)).ok, true);
  const made = saveDraft(stale, identityKey(mine), draftOf(mine));
  assert.equal(made.ok, true);
  assert.equal(made.pruned, true);
  assert.equal(listDrafts(stale).length, 1);
  assert.ok(findDraft(stale, mine));

  // A draft of another file from this morning: kept, and the write says it could not be done.
  const fresh = fakeStorage({ budget: roomForOne });
  assert.equal(saveDraft(fresh, identityKey(other), draftOf(other)).ok, true);
  const refused = saveDraft(fresh, identityKey(mine), draftOf(mine));
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /full/);
  assert.ok(findDraft(fresh, other), 'the other draft is still there');
});

test('a draft written by another build is ignored instead of half read', () => {
  const storage = fakeStorage();
  const doc = specification('TS-100', 'Lamp control unit');
  storage.setItem(identityKey(doc), JSON.stringify({ v: 99, doc, at: new Date().toISOString() }));
  assert.equal(loadDraft(storage, identityKey(doc)), null);
  assert.equal(findDraft(storage, doc), null);
});

test('two unnamed documents on one machine never see each other\'s drafts', () => {
  const storage = fakeStorage();
  // Two people start from the empty file, in two folders of their own, and each writes
  // something before the browser dies: same title, same code — none — and different content.
  const first = emptyDocument();
  const second = emptyDocument();
  const written = { ...first, header: { ...first.header, project: 'confidential' } };
  saveDraft(storage, identityKey(first, '/home/a/spec.html'), { ...draftOf(written), base: docFingerprint(first) });

  // The second person, in the second folder, is offered nothing: not by name, not by content.
  assert.equal(findDraft(storage, second, '/home/b/spec.html'), null);
  // The first person, back in the first folder with the same empty file, gets it back.
  assert.ok(findDraft(storage, first, '/home/a/spec.html'));
  // Even in the same folder, an unnamed file that holds something else is not the same file.
  const other = { ...second, description: { ...second.description, product: 'another unit' } };
  assert.equal(findDraft(storage, other, '/home/a/spec.html'), null);
});

test('a named document keeps being found by name across places, and by content when renamed', () => {
  const storage = fakeStorage();
  const doc = specification('TS-100', 'Lamp control unit');
  saveDraft(storage, identityKey(doc, '/home/a/spec.html'), draftOf(doc));
  // The same file opened from the same place, after an edit on disk: still its draft, by name.
  const edited = { ...doc, description: { ...doc.description, product: 'edited on disk' } };
  assert.ok(findDraft(storage, edited, '/home/a/spec.html'));
  // Moved to another folder, unchanged: found by its content.
  assert.ok(findDraft(storage, doc, '/home/b/spec.html'));
});

test('the data written into the file can spell neither the end of a script nor a block marker', () => {
  const text = JSON.stringify({ description: 'see </script> and <!--/TSW:DOC--> in the guide' });
  const safe = protectJson(text);
  assert.equal(safe.includes('</script'), false);
  assert.equal(safe.includes('<!--'), false);
  // What comes back is exactly what was written: the escapes are JSON's own.
  assert.deepEqual(JSON.parse(safe), JSON.parse(text));
});

test('a move that cannot happen changes nothing: no undo step, no unsaved change', () => {
  const store = createStore({ doc: emptyDocument(), history: { revisions: [] }, assets: {} });
  const a = newStage();
  const b = newStage();
  store.state.doc.stages = [a, b];
  store.markSaved();
  assert.equal(store.move(['stages'], a.id, -1), false);
  assert.equal(store.state.dirty, false);
  assert.equal(store.canUndo(), false);
  assert.equal(store.move(['stages'], a.id, +1), true);
  assert.equal(store.state.doc.stages[0].id, b.id);
  assert.equal(store.state.dirty, true);
});

test('drafts older than a month are cleared, the one in hand is never touched', () => {
  const storage = fakeStorage();
  const mine = specification('TS-100', 'Lamp control unit');
  const old = specification('TS-900', 'Old project');
  const longAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  saveDraft(storage, identityKey(mine), draftOf(mine, longAgo));
  saveDraft(storage, identityKey(old), draftOf(old, longAgo));

  assert.equal(pruneDrafts(storage, { except: identityKey(mine) }), 1);
  assert.ok(findDraft(storage, mine));
  assert.equal(findDraft(storage, old), null);
});

// ---- opening on the sheet alone ----------------------------------------------

test('a draft that is the last issued revision word for word is a released file', async () => {
  const doc = emptyDocument();
  doc.header.title = 'Lamp control unit';
  // Nothing issued yet: a fresh document is work in progress, whatever it says.
  assert.equal(await draftIsReleased(doc, { revisions: [] }), false);

  const issued = await issueRevision(doc, { revisions: [] }, { author: 'M. Rossi', reason: 'First issue' });
  // Just validated: the copy is the revision and nothing has changed.
  assert.equal(await draftIsReleased(issued.doc, issued.history), true);
  // A draft opened and not yet touched is still the released document, word for word.
  assert.equal(await draftIsReleased(openDraft(issued.doc, issued.history), issued.history), true);

  // One edit after the issue, and the file is a draft again.
  const edited = { ...issued.doc, header: { ...issued.doc.header, title: 'Lamp control unit, second source' } };
  assert.equal(await draftIsReleased(edited, issued.history), false);
});

// ---- what the second review found ------------------------------------------------

test('a document that came in from an import or was just created is unsaved, one just opened is not', () => {
  const store = createStore({ doc: emptyDocument(), history: { revisions: [] }, assets: {} });
  store.replaceAll({ doc: emptyDocument(), history: { revisions: [] }, assets: {} });
  assert.equal(store.state.dirty, false, 'opened: the file on disk holds it');
  store.replaceAll({ doc: emptyDocument(), history: { revisions: [] }, assets: {} }, { dirty: true });
  assert.equal(store.state.dirty, true, 'imported or new: nowhere but on the screen');
});

test('an undo after validating puts back the number and the record together', async () => {
  const store = createStore({ doc: emptyDocument(), history: { revisions: [] }, assets: {} });
  store.change((d) => { d.header.title = 'Lamp'; });
  const res = await issueRevision(store.state.doc, store.state.history, { author: 'A', reason: 'First' });
  store.changeAll((s) => { s.doc.revision = res.doc.revision; s.history = res.history; });
  assert.equal(store.state.doc.revision.status, 'issued');
  assert.equal(store.state.history.revisions.length, 1);
  store.undo();
  assert.equal(store.state.doc.revision.status, 'draft');
  assert.equal(store.state.history.revisions.length, 0, 'the frozen copy went with the number');
  // And issuing again is not refused as a number already taken.
  const again = await issueRevision(store.state.doc, store.state.history, { author: 'A', reason: 'First' });
  assert.equal(again.history.revisions.length, 1);
  store.redo();
  assert.equal(store.state.history.revisions.length, 1);
  // The history handed to `set` is a step like any other.
  store.set({ history: { revisions: [] } });
  assert.equal(store.state.history.revisions.length, 0);
  store.undo();
  assert.equal(store.state.history.revisions.length, 1);
});

test('a picture an issued revision still shows is not pruned from the file', async () => {
  const doc = emptyDocument();
  doc.images = [{ id: 'img_1', name: 'board', assetId: 'sha_board', caption: '' }];
  const assets = { sha_board: { mime: 'image/png', data: 'x' }, sha_old: { mime: 'image/png', data: 'y' } };
  const issued = await issueRevision(doc, { revisions: [] }, { author: 'A', reason: 'First' });
  assert.deepEqual(issued.history.revisions[0].assetIds, ['sha_board']);

  // The draft drops the picture: the file keeps it, for the revision that was issued with it.
  const later = { ...issued.doc, images: [] };
  const kept = pruneAssets(later, assets, issued.history);
  assert.deepEqual(Object.keys(kept), ['sha_board']);

  // A revision from an earlier build says nothing about its pictures: nothing is pruned.
  const legacy = { revisions: [{ ...issued.history.revisions[0], assetIds: undefined }] };
  assert.deepEqual(Object.keys(pruneAssets(later, assets, legacy)).sort(), ['sha_board', 'sha_old']);
  // Until it is completed from the snapshot, which is what the file does on opening.
  const completed = await completeAssetIds(legacy);
  assert.deepEqual(completed.revisions[0].assetIds, ['sha_board']);
  assert.equal(await completeAssetIds(completed), null, 'nothing left to complete');
});

/** One measuring step inside one stage: the smallest document a criterion can be judged in. */
function measuringDocument() {
  const doc = emptyDocument();
  const stage = Object.assign(newStage(), { name: 'A' });
  const test = Object.assign(newTest(), { name: 'T' });
  const step = Object.assign(newStep(STEP_TYPE.MEASUREMENT), { description: 'Measure' });
  step.measurement.description = 'Voltage';
  test.steps = [step];
  stage.tests = [test];
  doc.stages = [stage];
  return { doc, step };
}

test('a nominal without a tolerance is an error, and prints its gap rather than an equality', () => {
  const { doc, step: sB } = measuringDocument();
  sB.measurement.expected = { mode: 'nominal', comparison: 'EQT', nominal: constant('13.5'), tolerance: constant(''), toleranceType: 'absolute', unit: 'V', min: constant(''), max: constant('') };
  const errors = errorsOf(doc);
  assert.ok(errors.some((e) => /no tolerance/.test(e.message)), errors.map((e) => e.message).join('\n'));
  assert.equal(expectedText(sB.measurement, new Map()), '13.5 V ± ⟨missing tolerance⟩');
  sB.measurement.expected.tolerance = constant('0.5');
  assert.equal(expectedText(sB.measurement, new Map()), '13.5 V ± 0.5 V');
  assert.equal(errorsOf(doc).some((e) => /no tolerance/.test(e.message)), false);
});

test('the parallel groups are computed once per state of the stages, and again when they change', () => {
  const doc = emptyDocument();
  const stgB = Object.assign(newStage(), { name: 'B' });
  const stgC = Object.assign(newStage(), { name: 'C' });
  doc.stages = [stgB, stgC];
  const first = parallelGroupsDetailed(doc);
  assert.equal(parallelGroupsDetailed(doc), first, 'the same object comes back while nothing moved');
  // A change in place — the store edits the document in place — is seen.
  stgB.exclusions = { mode: EXCLUSION_MODE.LIST, stageIds: [stgC.id] };
  const second = parallelGroupsDetailed(doc);
  assert.notEqual(second, first);
  assert.ok(second.groups.every((g) => !(g.includes(stgB.id) && g.includes(stgC.id))));
});

test('ids are ten characters now, and the six of earlier builds stay valid', () => {
  const id = newId('stg');
  assert.match(id, /^stg_[a-z0-9]{10}$/);
  assert.ok(isId(id));
  assert.ok(isId('stg_a1b2c3'));
  assert.equal(isId('stg_a1b2c3d4e5f6'), false);
  const many = new Set(Array.from({ length: 5000 }, () => newId('x')));
  assert.equal(many.size, 5000);
});
