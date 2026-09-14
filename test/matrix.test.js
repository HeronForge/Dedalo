// The revision matrix: what each revision changed, kept beside it, and how a cell says it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyDocument, newVariable, newStage, newTest, newStep, STEP_TYPE, VARIABLE_TYPE } from '../src/model/schema.js';
import { issueRevision, consolidateRevision, completeChanges, warmLastRevision, lastIssuedDocument, revisionDocument, openDraft } from '../src/history/revisions.js';
import { revisionMatrix, cellText, matrixHasContent, matrixIsWide } from '../src/history/matrix.js';
import { printedChapters } from '../src/model/chapters.js';
import { buildDocx } from '../src/export/docx.js';
import { readZip } from '../src/io/zip.js';

const decoder = new TextDecoder();

function document_() {
  const doc = emptyDocument();
  doc.header = { ...doc.header, title: 'T', company: 'C', documentCode: 'X', product: 'P' };
  doc.description.testing = 'Short.';
  doc.variables = [Object.assign(newVariable(), { name: 'Vbat', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '12' })];
  const step = newStep(STEP_TYPE.STIMULUS);
  step.description = 'Power the unit';
  doc.stages = [Object.assign(newStage(), { name: 'Power', tests: [Object.assign(newTest(), { name: 'Supply', steps: [step] })] })];
  return doc;
}

/** Three revisions: the first issue, a value change, a rewritten description and a new stage. */
async function threeRevisions() {
  let doc = document_();
  let history = { revisions: [] };
  ({ doc, history } = await issueRevision(doc, history, { author: 'A', reason: 'First issue' }));
  doc = openDraft(doc, history);
  doc.variables[0].value = '14';
  ({ doc, history } = await issueRevision(doc, history, { author: 'A', reason: 'Vbat raised' }));
  doc = openDraft(doc, history);
  doc.description.testing = 'A much longer description of the test, written again from scratch so that no cell could quote it whole and the matrix has to count it instead of showing it, word by word.';
  doc.stages.push(Object.assign(newStage(), { name: 'Extra', tests: [] }));
  ({ doc, history } = await issueRevision(doc, history, { author: 'A', reason: 'Extra stage' }));
  return { doc, history };
}

test('an issued revision records what it changed against the one before; the first issue records nothing', async () => {
  const { history } = await threeRevisions();
  const [r0, r1, r2] = history.revisions;
  assert.deepEqual(r0.changes, []);
  assert.equal(r1.changes.length, 1);
  assert.deepEqual([r1.changes[0].chapter, r1.changes[0].type, r1.changes[0].before, r1.changes[0].after], ['Global variables', 'changed', '12', '14']);
  assert.ok(r2.changes.some((c) => c.chapter === 'Description' && c.type === 'changed'));
  assert.ok(r2.changes.some((c) => c.chapter === 'Test stages' && c.type === 'added'));
  // The record is strings only: it can be printed without the document it came from. Each
  // change names the element it belongs to, so the matrix can print its code.
  for (const c of r2.changes) assert.ok(['chapter', 'where', 'label', 'before', 'after', 'type', 'id'].every((k) => typeof c[k] === 'string'));
  assert.match(r1.changes[0].id, /^var_/);
  assert.equal(r2.changes.find((c) => c.chapter === 'Description').id, '');
});

test('the matrix has one column per revision that changed something, and the draft when it differs from the last issue', async () => {
  const { doc, history } = await threeRevisions();
  let m = revisionMatrix(doc, history, null);
  assert.deepEqual(m.columns.map((c) => [c.number, c.draft]), [['01', false], ['02', false]]);
  // Until the last issue has been read, the draft has no column; once read and unchanged, none either.
  await warmLastRevision(history);
  m = revisionMatrix(doc, history, lastIssuedDocument(history));
  assert.equal(m.columns.length, 2);
  // Edited without a draft, the copy still says Rev. 02: the column carries that number and
  // the status that tells it apart from the issued one beside it.
  doc.variables[0].value = '15';
  m = revisionMatrix(doc, history, lastIssuedDocument(history));
  assert.deepEqual(m.columns.map((c) => [c.number, c.draft, c.previous]), [['01', false, '00'], ['02', false, '01'], ['02', true, '02']]);
  assert.equal(m.columns[2].status, 'issued');
  const draft = openDraft(doc, history);
  m = revisionMatrix(draft, history, lastIssuedDocument(history));
  assert.deepEqual(m.columns.map((c) => [c.number, c.draft, c.previous]), [['01', false, '00'], ['02', false, '01'], ['03', true, '02']]);
  assert.equal(m.columns[2].status, 'draft');
  assert.match(m.groups.find((g) => g.chapter === 'Global variables').rows[0].id, /^var_/);
  // One row per thing changed, grouped by chapter, the cells by revision.
  const variables = m.groups.find((g) => g.chapter === 'Global variables');
  assert.equal(variables.rows.length, 1);
  assert.deepEqual([...variables.rows[0].cells.keys()], ['01', '03']);
  assert.equal(matrixHasContent(doc, history), true);
  assert.equal(matrixIsWide(doc, history, lastIssuedDocument(history)), true);
  assert.equal(matrixIsWide(doc, history, null), false);
});

test('a cell quotes a short value and counts a long one', () => {
  assert.deepEqual(cellText({ type: 'changed', before: '12', after: '14' }), { tag: 'changed', text: '12 → 14' });
  assert.deepEqual(cellText({ type: 'changed', before: '', after: 'x' }), { tag: 'changed', text: '— → x' });
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
  assert.deepEqual(cellText({ type: 'changed', before: 'short', after: long }), { tag: 'changed', text: 'text changed (1 → 14 words)' });
  assert.deepEqual(cellText({ type: 'changed', before: 'a value of thirty characters or so', after: 'another value of about the same length' }).text,
    'a value of thirty character… → another value of about the …');
  assert.deepEqual(cellText({ type: 'added', before: '', after: 'Extra' }), { tag: 'added', text: 'Extra' });
  assert.deepEqual(cellText({ type: 'added', before: '', after: long }), { tag: 'added', text: 'added (14 words)' });
  assert.deepEqual(cellText({ type: 'removed', before: 'Old', after: '' }), { tag: 'removed', text: 'Old' });
  assert.deepEqual(cellText({ type: 'moved', before: 'position 2', after: 'position 4' }), { tag: 'moved', text: 'position 2 → position 4' });
});

test('a file written before the record existed gets it when it opens, and a merged revision gets it again', async () => {
  const { doc, history } = await threeRevisions();
  const old = { revisions: history.revisions.map(({ changes, ...r }) => r) };
  assert.equal(await completeChanges(history), null, 'nothing to do when every revision has its record');
  const completed = await completeChanges(old);
  assert.deepEqual(completed.revisions.map((r) => r.changes.length), history.revisions.map((r) => r.changes.length));
  // Dropping Rev. 01: its value change now belongs to Rev. 02, whose record says so once completed.
  const merged = consolidateRevision(doc, history, '01');
  assert.equal(merged.history.revisions[1].changes, undefined);
  const again = await completeChanges(merged.history);
  assert.ok(again.revisions[1].changes.some((c) => c.chapter === 'Global variables' && c.after === '14'));
  assert.ok(await revisionDocument(again.revisions[1]));
});

test('the matrix is the last appendix, printed once a revision changed something, and points to itself from the record', async () => {
  const { doc, history } = await threeRevisions();
  const printed = printedChapters(doc, history, null);
  assert.equal(printed[printed.length - 1].key, 'matrix');
  assert.equal(printed[printed.length - 1].landscape, false, 'two columns fit a portrait page');
  assert.ok(!printedChapters(document_(), { revisions: [] }).some((c) => c.key === 'matrix'));
  const parts = await readZip(await buildDocx({ doc, history }));
  const xml = decoder.decode(parts.get('word/document.xml'));
  assert.match(xml, /Revision matrix/);
  assert.match(xml, /is in Appendix [A-Z] — Revision matrix/);
  assert.match(xml, /12 → 14/);
  assert.match(xml, /text changed \(1 → \d+ words\)/);
});
