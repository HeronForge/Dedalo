// The chapters of the printed document — which exist, in what order — and the glossary.
import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyDocument, newGlossaryEntry, newStage, newTest, newStep, newCommand, STEP_TYPE, migrate } from '../src/model/schema.js';
import { CHAPTERS, chapterHasContent, chapterOrder, printedChapters, movedOrder } from '../src/model/chapters.js';
import { acronymsInText, acronymsInDocument, undefinedAcronyms, sortedGlossary } from '../src/model/glossary.js';
import { validateDocument, SEVERITY } from '../src/model/validate.js';
import { importAuthoring } from '../src/io/import.js';
import { compare } from '../src/history/diff.js';
import { buildDocx } from '../src/export/docx.js';
import { readZip } from '../src/io/zip.js';
import { buildWallboxDemo } from '../build/demo-wallbox.mjs';

const decoder = new TextDecoder();

// ---- which chapters, in what order --------------------------------------------------------

test('an empty document prints no chapter at all: a page that says «none» tells the reader nothing', () => {
  const doc = emptyDocument();
  assert.deepEqual(printedChapters(doc), []);
  for (const c of CHAPTERS) assert.equal(chapterHasContent(c.key, doc), false, c.key);
});

test('a chapter is printed when it has something in it, and numbered by what is there', () => {
  const doc = emptyDocument();
  doc.description.testing = 'Everything at room temperature.';
  doc.glossary = [newGlossaryEntry('RCM', 'Residual current monitor')];
  doc.commands = [Object.assign(newCommand(), { name: 'read' })];
  const printed = printedChapters(doc);
  assert.deepEqual(printed.map((c) => [c.key, c.label]), [['testing', '1'], ['glossary', '2'], ['commands', 'Appendix A']]);
  // The stage graph and the resources come only with stages; the commands appendix turns the page.
  assert.equal(printed.find((c) => c.key === 'commands').landscape, true);
});

test('the order is the document\'s to set, chapters and appendices each among their own kind', () => {
  const doc = emptyDocument();
  doc.settings.chapterOrder = ['glossary', 'graph', 'references', 'nonsense'];
  const keys = chapterOrder(doc).map((c) => c.key);
  // The named ones first within their kind, the rest in the default order, the unknown ignored.
  assert.deepEqual(keys.slice(0, 3), ['glossary', 'references', 'product']);
  assert.equal(keys.indexOf('graph'), keys.indexOf('kpi') - 1);
  assert.ok(!keys.includes('nonsense'));
  assert.equal(keys.length, CHAPTERS.length);
  // A default document prints in the default order.
  assert.deepEqual(chapterOrder(emptyDocument()).map((c) => c.key), CHAPTERS.map((c) => c.key));
});

test('moving a chapter swaps it with its neighbour of the same kind and records the whole order', () => {
  const doc = emptyDocument();
  const moved = movedOrder(doc, 'testing', -1);
  assert.deepEqual(moved.slice(0, 3), ['references', 'testing', 'product']);
  assert.equal(moved.length, CHAPTERS.length);
  // Nowhere to go: the first chapter up, the last appendix down, an appendix into the chapters.
  assert.equal(movedOrder(doc, 'references', -1), null);
  assert.equal(movedOrder(doc, 'matrix', +1), null);
  assert.equal(movedOrder(doc, 'kpi', -1), null);
  doc.settings.chapterOrder = moved;
  assert.deepEqual(chapterOrder(doc).map((c) => c.key).slice(0, 3), ['references', 'testing', 'product']);
});

test('a document written before the chapter order existed opens with the default one', () => {
  const doc = migrate({ header: { title: 'Old' }, stages: [] });
  assert.deepEqual(doc.settings.chapterOrder, []);
  assert.deepEqual(doc.glossary, []);
});

// ---- the glossary -----------------------------------------------------------------------

test('acronyms are words of capitals: codes, part numbers and words with digits are not', () => {
  assert.deepEqual(acronymsInText('Check the CP after the RCM trips (IEC 62955); see STG-04, CMD-12, TP12, RS485, 0xFF, Ocpp and the EVC-22.'),
    ['CP', 'RCM', 'IEC']);
  assert.deepEqual(acronymsInText('$Vbat is not one, nor #REF, but OCPP is, once: OCPP.'), ['OCPP']);
  assert.deepEqual(acronymsInText(''), []);
});

test('the glossary is checked against the prose of the document, not against its frames and pins', () => {
  const doc = emptyDocument();
  doc.description.product = 'An EV charger with an RCM.';
  doc.commands = [Object.assign(newCommand(), { name: 'Read RSSI', requestFormat: 'AT+CSQ', responseFormat: 'OK' })];
  doc.points = [{ id: 'pt_00000001', name: 'Battery', connector: 'J1', pin: '1', signal: 'GND', contactType: '', characteristics: [], markers: [], notes: '' }];
  assert.deepEqual(acronymsInDocument(doc), ['EV', 'RCM', 'RSSI']);
  doc.glossary = [newGlossaryEntry('rcm', 'Residual current monitor'), newGlossaryEntry('EV', 'Electric vehicle')];
  assert.deepEqual(undefinedAcronyms(doc), ['RSSI']);
  // Printed in alphabetical order, whatever order they were typed in.
  assert.deepEqual(sortedGlossary(doc).map((g) => g.term), ['EV', 'rcm']);
});

test('a glossary line without a meaning, or a term explained twice, is a warning', () => {
  const doc = emptyDocument();
  doc.glossary = [newGlossaryEntry('RCM', ''), newGlossaryEntry('rcm', 'again'), newGlossaryEntry('', 'nothing')];
  const warnings = validateDocument(doc).issues.filter((i) => i.severity === SEVERITY.WARNING).map((i) => i.message);
  assert.ok(warnings.some((m) => /«RCM» has no meaning/.test(m)));
  assert.ok(warnings.some((m) => /«rcm» is explained twice/.test(m)));
  assert.ok(warnings.some((m) => /glossary line has no term/.test(m)));
});

test('the glossary and the chapter order come in from an authoring file', () => {
  const { doc } = importAuthoring({
    format: 'tsw-authoring/1',
    settings: { chapterOrder: ['glossary', 'references'] },
    glossary: [{ term: 'RCM', meaning: 'Residual current monitor' }, { term: '', meaning: 'dropped' }, null],
    stages: [],
  });
  assert.deepEqual(doc.glossary.map((g) => [g.term, g.meaning]), [['RCM', 'Residual current monitor']]);
  assert.deepEqual(doc.settings.chapterOrder, ['glossary', 'references']);
  assert.deepEqual(chapterOrder(doc).map((c) => c.key).slice(0, 2), ['glossary', 'references']);
});

test('a glossary line changed between two versions is reported under its own chapter, by its term', () => {
  const before = emptyDocument();
  before.glossary = [newGlossaryEntry('RCM', 'Residual current monitor')];
  const after = JSON.parse(JSON.stringify(before));
  after.glossary[0].meaning = 'Residual current monitoring device';
  after.settings.chapterOrder = ['glossary'];
  const diffs = compare(before, after);
  const glossary = diffs.find((d) => d.chapter === 'Glossary');
  assert.ok(glossary, 'the change is filed under Glossary');
  assert.match(glossary.label || glossary.path.join('.'), /RCM|Meaning/);
  assert.ok(diffs.some((d) => d.chapter === 'Reading options'));
});

// ---- the showcase, and the Word file -----------------------------------------------------

test('the showcase explains every acronym its prose uses, save the words that only look like one', async () => {
  const demo = await buildWallboxDemo();
  assert.ok(demo.doc.glossary.length >= 20);
  assert.deepEqual(undefinedAcronyms(demo.doc), ['OK', 'ERR', 'TEST']);
  const printed = printedChapters(demo.doc).map((c) => c.key);
  assert.ok(printed.includes('glossary'));
  assert.equal(printed.indexOf('commands') > printed.indexOf('setups'), true);
});

test('the Word file turns the page for the commands and the graph, and turns it back after each', async () => {
  const demo = await buildWallboxDemo();
  const parts = await readZip(await buildDocx({ doc: demo.doc, history: demo.history }));
  const xml = decoder.decode(parts.get('word/document.xml'));
  const sections = [...xml.matchAll(/<w:sectPr>([\s\S]*?)<\/w:sectPr>/g)].map((m) => m[1]);
  // Portrait up to the commands, landscape for them, portrait for the resources, landscape
  // for the graph — which ends the document, so its properties close the body.
  assert.deepEqual(sections.map((s) => /w:orient="landscape"/.test(s)), [false, true, false, true]);
  // The cover alone has its title page; a later section with one would blank its header.
  assert.deepEqual(sections.map((s) => /<w:titlePg\/>/.test(s)), [true, false, false, false]);
  // Every section keeps the running header and footer.
  assert.ok(sections.every((s) => /headerReference/.test(s) && /footerReference/.test(s)));
  assert.match(xml, /Glossary/);
  assert.match(xml, /Residual current monitor/);
  // The empty chapters of the small demo are left out there too.
  const doc = emptyDocument();
  doc.stages = [Object.assign(newStage(), { name: 'Only', tests: [Object.assign(newTest(), { name: 'T', steps: [newStep(STEP_TYPE.STIMULUS)] })] })];
  const small = decoder.decode((await readZip(await buildDocx({ doc }))).get('word/document.xml'));
  assert.ok(!/External references/.test(small.replace(/Contents[\s\S]*?Heading1/, '')));
  assert.ok(!/Glossary/.test(small));
});
