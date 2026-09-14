// The Word export: a .docx is a ZIP of XML parts, so both are checked here — the archive
// round-trips, and the parts are the ones Word insists on, well formed and in the right places.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createZip, readZip, crc32 } from '../src/io/zip.js';
import { buildDocx } from '../src/export/docx.js';
import { buildDemo } from '../build/demo.mjs';
import { buildWallboxDemo } from '../build/demo-wallbox.mjs';
import { emptyDocument, newStage, newTest, newStep, STEP_TYPE } from '../src/model/schema.js';

const decoder = new TextDecoder();
const text = (bytes) => decoder.decode(bytes);

/**
 * Well-formedness, the failure that actually happens when generating XML by hand: every tag
 * closed, in the right order, nothing left open. Not a schema validation — a balance check.
 */
function checkBalanced(xml, label) {
  const stack = [];
  const tag = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let match;
  while ((match = tag.exec(xml))) {
    const [, closing, name, attributes, selfClosing] = match;
    if (attributes.startsWith('?') || name === '?xml') continue;
    if (selfClosing) continue;
    if (closing) {
      const open = stack.pop();
      assert.equal(open, name, `${label}: </${name}> closes <${open}>`);
    } else {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], `${label}: tags left open`);
}

const demoDocx = async (extra = {}) => {
  const demo = await buildDemo();
  const bytes = await buildDocx({ doc: demo.doc, history: demo.history, ...extra });
  return { demo, bytes, parts: await readZip(bytes) };
};

// ---- the archive --------------------------------------------------------------

test('the zip writer round-trips names, contents and checksums', async () => {
  const entries = [
    { name: 'hello.txt', data: 'plain text' },
    { name: 'nested/dir/file.xml', data: '<a>' + 'x'.repeat(5000) + '</a>' },
    { name: 'binary.bin', data: new Uint8Array([0, 1, 2, 253, 254, 255]) },
  ];
  const archive = await createZip(entries);
  const back = await readZip(archive);

  assert.deepEqual([...back.keys()], entries.map((e) => e.name));
  assert.equal(text(back.get('hello.txt')), 'plain text');
  assert.equal(text(back.get('nested/dir/file.xml')).length, 5007);
  assert.deepEqual([...back.get('binary.bin')], [0, 1, 2, 253, 254, 255]);
  // The archive really is a ZIP: it starts with the local file header signature.
  assert.deepEqual([...archive.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test('the checksum is the standard CRC-32', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('the end record describes the central directory exactly', async () => {
  // Getting this wrong by a few bytes is invisible to a lenient unzipper, which just rescans,
  // and fatal to Word, which reports the file as damaged. It happened: the size was measured
  // while the record was being written, so it counted itself.
  const archive = await createZip([
    { name: 'one.txt', data: 'first' },
    { name: 'two/three.txt', data: 'second entry, a little longer' },
    { name: 'binary', data: new Uint8Array(300).fill(7) },
  ]);
  const view = new DataView(archive.buffer);

  let eocd = archive.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  assert.equal(eocd, archive.length - 22, 'the end record must be the last thing in the file');

  const entries = view.getUint16(eocd + 10, true);
  const declaredSize = view.getUint32(eocd + 12, true);
  const declaredOffset = view.getUint32(eocd + 16, true);

  assert.equal(entries, 3);
  assert.equal(declaredOffset + declaredSize, eocd, 'the directory must end where the end record begins');

  // And walking it lands exactly on the end record.
  let pointer = declaredOffset;
  for (let i = 0; i < entries; i++) {
    assert.equal(view.getUint32(pointer, true), 0x02014b50, `entry ${i} is not a central header`);
    pointer += 46 + view.getUint16(pointer + 28, true) + view.getUint16(pointer + 30, true) + view.getUint16(pointer + 32, true);
  }
  assert.equal(pointer, eocd);
});

test('every local header sits where the directory says it does', async () => {
  const { bytes } = await demoDocx();
  const view = new DataView(bytes.buffer);
  let eocd = bytes.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  let pointer = view.getUint32(eocd + 16, true);
  for (let i = view.getUint16(eocd + 10, true); i > 0; i--) {
    const localOffset = view.getUint32(pointer + 42, true);
    assert.equal(view.getUint32(localOffset, true), 0x04034b50, 'a local header is not where the directory points');
    pointer += 46 + view.getUint16(pointer + 28, true) + view.getUint16(pointer + 30, true) + view.getUint16(pointer + 32, true);
  }
});

// ---- the parts Word expects ----------------------------------------------------

test('the document carries every part Word needs to open it', async () => {
  const { parts } = await demoDocx();
  for (const required of [
    '[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml',
    'word/header1.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels',
    'docProps/core.xml', 'docProps/app.xml',
  ]) assert.ok(parts.has(required), `missing part ${required}`);
});

test('every XML part is well formed', async () => {
  const { parts } = await demoDocx();
  for (const [name, bytes] of parts) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    checkBalanced(text(bytes), name);
  }
});

test('the relationships referenced by the document all exist', async () => {
  const { parts } = await demoDocx();
  const document = text(parts.get('word/document.xml'));
  const rels = text(parts.get('word/_rels/document.xml.rels'));
  const declared = new Set([...rels.matchAll(/Id="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...document.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map((m) => m[1]),
  ]);
  for (const id of used) assert.ok(declared.has(id), `relationship ${id} is used but not declared`);
  // The header and footer are wired to the section.
  assert.match(document, /<w:headerReference w:type="default" r:id="rId2"\/>/);
  assert.match(document, /<w:footerReference w:type="default" r:id="rId3"\/>/);
});

// ---- the content ---------------------------------------------------------------

test('the document has the headings, the tables and the content of the specification', async () => {
  const { parts } = await demoDocx();
  const document = text(parts.get('word/document.xml'));

  // Real heading styles: the navigation pane and the table of contents depend on them.
  assert.match(document, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(document, /<w:pStyle w:val="Heading2"\/>/);
  for (const title of ['Revision history', 'Contents', 'Test stages', 'Setup stages',
    'Application points', 'Test resources', 'Stage graph']) {
    assert.ok(document.includes(title), `the chapter «${title}» is missing`);
  }
  // The appendix letters follow what the document contains, so they are read as a sequence
  // rather than asserted one by one: A, B, C… with no gap and no repetition.
  const letters = [...document.matchAll(/Appendix ([A-Z]) — /g)].map((m) => m[1]);
  assert.deepEqual(letters, letters.map((_, i) => String.fromCharCode(65 + i)));
  // The table of contents is a Word field, so Word fills in the page numbers itself.
  assert.match(document, /TOC \\o &quot;1-3&quot; \\h \\z \\u/);
  // Tables repeat their header row when they break across pages.
  assert.match(document, /<w:tblHeader\/>/);
  // The content is there: codes, step tags, the resource note.
  assert.ok(document.includes('STG-01'));
  assert.ok(document.includes('SET-01'));
  assert.ok(document.includes('APPLY'));
  assert.ok(document.includes('MEASURE'));
  assert.ok(document.includes('Max channels') || document.includes('How to read the channel count'));
});

test('the running header and footer carry the identification and «Page X of Y»', async () => {
  const { parts, demo } = await demoDocx();
  const header = text(parts.get('word/header1.xml'));
  const footer = text(parts.get('word/footer1.xml'));

  assert.ok(header.includes(demo.doc.header.company));
  assert.ok(header.includes(demo.doc.header.product));
  assert.ok(footer.includes(demo.doc.header.documentCode));
  assert.ok(footer.includes('Rev. 02'));
  assert.ok(footer.includes(demo.doc.header.confidentiality.replace(/–/, '–')));
  assert.match(footer, /instrText[^>]*> PAGE </);
  assert.match(footer, /instrText[^>]*> NUMPAGES </);
});

test('A4 page setup, with the cover left without header and footer', async () => {
  const { parts } = await demoDocx();
  const document = text(parts.get('word/document.xml'));
  assert.match(document, /<w:pgSz w:w="11906" w:h="16838"\/>/);
  assert.match(document, /<w:titlePg\/>/);
});

// ---- pictures -------------------------------------------------------------------

test('a picture becomes a media part with its own relationship and drawing', async () => {
  const demo = await buildDemo();
  const image = demo.doc.images[0];
  demo.doc.header.logoAssetId = 'logo-asset'; // the header carries a logo in this document
  const png = { data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]), mime: 'image/png', width: 640, height: 400 };
  const bytes = await buildDocx({
    doc: demo.doc,
    history: demo.history,
    images: new Map([[image.id, png], ['logo', png]]),
    graph: { ...png, width: 900, height: 500 },
  });
  const parts = await readZip(bytes);
  const document = text(parts.get('word/document.xml'));

  const media = [...parts.keys()].filter((n) => n.startsWith('word/media/'));
  assert.equal(media.length, 5); // the figure, the graph, the logo of the header, the DEDALO logo and its mark
  assert.match(text(parts.get('[Content_Types].xml')), /Extension="png"/);
  assert.match(document, /<a:blip r:embed="rId\d+"\/>/);
  assert.match(document, /<wp:extent cx="\d+" cy="\d+"\/>/);

  // The logo of the header belongs to the header's relationships, not the document's.
  assert.ok(parts.has('word/_rels/header1.xml.rels'));
  assert.match(text(parts.get('word/_rels/header1.xml.rels')), /media\/logo\.png/);
  assert.match(text(parts.get('word/header1.xml')), /<a:blip r:embed="rId1"\/>/);
  // The logo of the tool is on the cover, its mark in the header, each with its file.
  assert.match(text(parts.get('word/_rels/header1.xml.rels')), /media\/dedalo-mark\.png/);
  assert.match(text(parts.get('word/header1.xml')), /<a:blip r:embed="rId2"\/>/);
  assert.match(document, /Powered by<\/w:t>[\s\S]{0,400}name="DEDALO"/);
});

test('the disclaimer reaches the cover of the Word file, and only when there is one', async () => {
  const demo = await buildDemo();
  demo.doc.header.disclaimer = 'Property of Acme. Not to be disclosed.';
  const withIt = text((await readZip(await buildDocx({ doc: demo.doc, history: demo.history }))).get('word/document.xml'));
  assert.match(withIt, /Property of Acme\. Not to be disclosed\./);

  demo.doc.header.disclaimer = '';
  const without = text((await readZip(await buildDocx({ doc: demo.doc, history: demo.history }))).get('word/document.xml'));
  assert.ok(!without.includes('Not to be disclosed'));
});

test('a tall logo is fitted into the header instead of making it taller', async () => {
  const demo = await buildDemo();
  demo.doc.header.logoAssetId = 'logo-asset';
  // Taller than it is wide: scaling on the width alone would push the header down the page.
  const tall = { data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), mime: 'image/png', width: 100, height: 400 };
  const bytes = await buildDocx({ doc: demo.doc, history: demo.history, images: new Map([['logo', tall]]), graph: null });
  const header = text((await readZip(bytes)).get('word/header1.xml'));
  const [, cx, cy] = header.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/).map(Number);
  const EMU_PER_PX = 9525;
  assert.ok(cy <= 24 * EMU_PER_PX, `the logo is ${cy / EMU_PER_PX} px tall in the header`);
  assert.equal(Math.round(cx / cy * 100), 25); // the proportions are kept
});

// ---- the mistakes Word punishes ---------------------------------------------------

/**
 * OOXML fixes the order of the children of every property element. Word does not shrug at a
 * wrong order: it declares the file damaged and offers to repair it, which is exactly the
 * report that started this test. These are the sequences for the elements written here.
 */
const ORDER = {
  'w:pPr': ['w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl',
    'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:spacing', 'w:ind',
    'w:contextualSpacing', 'w:jc', 'w:textAlignment', 'w:outlineLvl', 'w:rPr'],
  'w:rPr': ['w:rStyle', 'w:rFonts', 'w:b', 'w:bCs', 'w:i', 'w:iCs', 'w:caps', 'w:smallCaps', 'w:strike',
    'w:color', 'w:spacing', 'w:w', 'w:kern', 'w:position', 'w:sz', 'w:szCs', 'w:highlight', 'w:u',
    'w:bdr', 'w:shd', 'w:vertAlign', 'w:lang'],
  'w:tblPr': ['w:tblStyle', 'w:tblpPr', 'w:tblOverlap', 'w:bidiVisual', 'w:tblW', 'w:jc',
    'w:tblCellSpacing', 'w:tblInd', 'w:tblBorders', 'w:shd', 'w:tblLayout', 'w:tblCellMar', 'w:tblLook'],
  'w:tcPr': ['w:cnfStyle', 'w:tcW', 'w:gridSpan', 'w:hMerge', 'w:vMerge', 'w:tcBorders', 'w:shd',
    'w:noWrap', 'w:tcMar', 'w:textDirection', 'w:tcFitText', 'w:vAlign', 'w:hideMark'],
  'w:trPr': ['w:cnfStyle', 'w:divId', 'w:gridBefore', 'w:gridAfter', 'w:wBefore', 'w:wAfter',
    'w:cantSplit', 'w:trHeight', 'w:tblHeader', 'w:tblCellSpacing', 'w:jc', 'w:hidden'],
  'w:sectPr': ['w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr', 'w:type',
    'w:pgSz', 'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols',
    'w:formProt', 'w:vAlign', 'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:docGrid'],
};

function checkPropertyOrder(xml, label) {
  for (const [element, sequence] of Object.entries(ORDER)) {
    const blocks = xml.matchAll(new RegExp(`<${element}>([\s\S]*?)</${element}>`, 'g'));
    for (const [, body] of blocks) {
      // Only the direct children matter, and none of these blocks nests another of its kind.
      const children = [...body.matchAll(/<(w:[A-Za-z]+)[ />]/g)].map((m) => m[1])
        .filter((name) => sequence.includes(name));
      const positions = children.map((name) => sequence.indexOf(name));
      const sorted = [...positions].sort((a, b) => a - b);
      assert.deepEqual(positions, sorted,
        `${label}: the children of <${element}> are out of order — ${children.join(', ')}`);
    }
  }
}

test('every property element lists its children in the order the schema fixes', async () => {
  const { parts } = await demoDocx();
  for (const [name, bytes] of parts) {
    if (!name.endsWith('.xml')) continue;
    checkPropertyOrder(text(bytes), name);
  }
});

test('the document properties follow their own order', async () => {
  const { parts } = await demoDocx();
  const core = text(parts.get('docProps/core.xml'));
  const app = text(parts.get('docProps/app.xml'));
  const sequence = ['cp:category', 'dcterms:created', 'dc:creator', 'dcterms:modified', 'cp:revision', 'dc:subject', 'dc:title'];
  const found = [...core.matchAll(/<((?:cp|dc|dcterms):[A-Za-z]+)[ >]/g)].map((m) => m[1])
    .filter((name) => name !== 'cp:coreProperties');
  assert.deepEqual(found, sequence);
  assert.ok(app.indexOf('<Company>') < app.indexOf('<Application>'));
});

test('no part ever shows written markup as text', async () => {
  // Passing already written markup where text is expected escapes it, and it lands on the
  // page as «<w:r><w:rPr>…». It happened to the table of contents and then to the footer.
  const { parts } = await demoDocx();
  for (const [name, bytes] of parts) {
    if (!name.endsWith('.xml')) continue;
    assert.equal(/&lt;w:/.test(text(bytes)), false, `${name} carries escaped markup as text`);
  }
});

test('header, footer and body all end with a paragraph, never with a table', async () => {
  // A table as the last element of a header, a footer or the body is what makes Word
  // announce that the file is damaged and offer to repair it.
  const { parts } = await demoDocx();
  assert.match(text(parts.get('word/header1.xml')), /<\/w:p><\/w:hdr>$/);
  assert.match(text(parts.get('word/footer1.xml')), /<\/w:p><\/w:ftr>$/);
  const document = text(parts.get('word/document.xml'));
  // The last section's properties close the body; the earlier ones sit inside the paragraphs
  // that end a section, which is why the search runs from the end.
  const beforeSection = document.slice(0, document.lastIndexOf('<w:sectPr'));
  assert.match(beforeSection, /<\/w:p>$/);
});

test('every table declares the width its columns add up to', async () => {
  const { parts } = await demoDocx();
  const document = text(parts.get('word/document.xml'));
  const tables = [...document.matchAll(/<w:tbl>([\s\S]*?)<\/w:tblPr>([\s\S]*?)<w:tr>/g)];
  assert.ok(tables.length > 3);
  for (const [, head, grid] of tables) {
    const declared = Number(/<w:tblW w:w="(\d+)"/.exec(head)[1]);
    const columns = [...grid.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((m) => Number(m[1]));
    if (!columns.length) continue;
    assert.equal(declared, columns.reduce((a, b) => a + b, 0));
  }
});

test('the footer carries the confidentiality as text in its own run', async () => {
  const { parts, demo } = await demoDocx();
  const footer = text(parts.get('word/footer1.xml'));
  const wanted = `<w:t xml:space="preserve">${demo.doc.header.confidentiality}</w:t>`;
  assert.ok(footer.includes(wanted), 'the confidentiality is not a plain run of text');
});

// ---- escaping --------------------------------------------------------------------

test('characters that would break the XML are escaped, and control characters dropped', async () => {
  const doc = emptyDocument();
  doc.header.title = 'A & B <tag> "quoted"';
  doc.header.company = 'Acme';
  const stage = Object.assign(newStage(), { name: 'Stage & <one>' });
  const t = Object.assign(newTest(), { name: 'Test' });
  const step = newStep(STEP_TYPE.STIMULUS);
  step.description = 'Line with a bell \u0007 inside';
  t.steps = [step];
  stage.tests = [t];
  doc.stages = [stage];

  const parts = await readZip(await buildDocx({ doc }));
  const document = text(parts.get('word/document.xml'));

  checkBalanced(document, 'document.xml');
  assert.ok(document.includes('A &amp; B &lt;tag&gt; &quot;quoted&quot;'));
  assert.ok(document.includes('Stage &amp; &lt;one&gt;'));
  assert.equal(document.includes('\u0007'), false);
});

test('the showcase, with its table step, its computed value, its figure and its signatories, becomes a well formed Word file', async () => {
  // The small demo has none of these; the showcase has all of them, and a local variable that
  // shadowed the table writer once made this the one export that threw.
  const demo = await buildWallboxDemo();
  const bytes = await buildDocx({ doc: demo.doc, history: demo.history });
  const parts = await readZip(bytes);
  for (const [name, part] of parts) {
    if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
    checkBalanced(text(part), name);
  }
  const document = text(parts.get('word/document.xml'));
  assert.match(document, /COMPUTED/);
  assert.match(document, /See FIG-/);
  assert.match(document, /Defined in REF-/);
  assert.match(document, /Decoding/);
  assert.match(document, /Verified by \(Quality\)/);
  // The table step is a table inside the cell of the step table: a cell that holds a table
  // must end with a paragraph, or Word calls the file damaged.
  const nested = [...document.matchAll(/<w:tc>(?:(?!<\/w:tc>)[\s\S])*?<w:tbl>/g)];
  assert.ok(nested.length >= 1, 'the table step is written as a nested table');
  // The table step is the whole row, code column included: its cell spans the three.
  assert.match(nested[0][0], /<w:gridSpan w:val="3"\/>/);
  assert.match(document, /<\/w:tbl><w:p[ >][\s\S]*?<\/w:p><\/w:tc>/);
});

test('an empty specification still produces a document Word can open', async () => {
  const parts = await readZip(await buildDocx({ doc: emptyDocument() }));
  const document = text(parts.get('word/document.xml'));
  checkBalanced(document, 'document.xml');
  assert.match(document, /<w:body>/);
  assert.match(document, /<w:sectPr>/);
});
