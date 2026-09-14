// Word export.
//
// A .docx is a ZIP of XML parts, so no library is needed: the parts are written here and the
// archive by io/zip.js. What comes out is a real Word document — heading styles (so the
// navigation pane and the table of contents work), tables with repeating header rows, a running
// header and footer with «Page X of Y», embedded pictures, A4 page setup — and not an HTML file
// with a .docx name on it.
//
// The pictures arrive already rasterised (see export/figures.js): Word cannot overlay the point
// markers on an image the way the browser does, so the browser burns them in first.
import { createZip } from '../io/zip.js';
import { computeCodes, computeIndex, codeOf, labelOf } from '../model/codes.js';
import { variableIndex, valueText, expectedText, variableText } from '../model/variables.js';
import { changeRecord, STATUS_LABEL, base64ToBytes } from '../history/revisions.js';
import { STEP_TYPE, STEP_TYPE_SHORT, EXCLUSION_MODE, VARIABLE_TYPE_LABEL, TABLE_COLUMN_KIND, blockTag, expectedBadge, expectedCaseNote, commandDecoding } from '../model/schema.js';
import { testStages, setupStages, callMap, isSetup, findStep } from '../model/stages.js';
import { applyOverlay, describeOperation } from '../model/variants.js';
import { resourceSummary, blockResources, commandInterfaces } from '../model/resources.js';
import { cellValueText } from '../model/shorthand.js';
import { printedChapters } from '../model/chapters.js';
import { sortedGlossary } from '../model/glossary.js';
import { revisionMatrix, cellText } from '../history/matrix.js';
import { lastIssuedDocument } from '../history/revisions.js';
import { DEDALO_LOGO_PNG, DEDALO_LOGO_PNG_SIZE, DEDALO_MARK_PNG, DEDALO_MARK_PNG_SIZE } from '../brand/dedalo.js';
import { APP_NAME, APP_TAGLINE } from '../version.js';

// ---- page geometry (twips: 1/20 pt) ------------------------------------------

const PAGE = { w: 11906, h: 16838, top: 1134, bottom: 1134, side: 794, header: 567, footer: 567 };
const CONTENT_WIDTH = PAGE.w - PAGE.side * 2;
// A landscape section for the appendices too wide for the page: the same margins, the page
// turned, and the tables laid out again for the width they then have.
const LANDSCAPE_WIDTH = PAGE.h - PAGE.side * 2;
const EMU_PER_PX = 9525; // at 96 dpi

// ---- tiny XML helpers ---------------------------------------------------------

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Control characters are not valid XML: one of them and Word refuses the whole file.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/**
 * Markup that is already written, as opposed to text that still has to be escaped.
 * Passing one where the other is expected is the mistake this class exists to prevent:
 * it once turned the table of contents, and then the footer, into literal XML on the page.
 */
class Xml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

const xml = (value) => new Xml(value);
const isXml = (value) => value instanceof Xml;

/** One run of text. Line breaks become real breaks. */
function run(text, props = {}) {
  // The order of these elements is fixed by the OOXML schema: out of order, Word calls the
  // whole document corrupt.
  const rPr = [
    props.font ? `<w:rFonts w:ascii="${props.font}" w:hAnsi="${props.font}"/>` : '',
    props.bold ? '<w:b/>' : '',
    props.italic ? '<w:i/>' : '',
    props.caps ? '<w:smallCaps/>' : '',
    props.color ? `<w:color w:val="${props.color}"/>` : '',
    props.size ? `<w:sz w:val="${props.size}"/>` : '',
    props.highlight ? `<w:shd w:val="clear" w:color="auto" w:fill="${props.highlight}"/>` : '',
  ].join('');
  // A line break and a tab are elements of their own in a run: inside <w:t> the first is
  // lost and the second is a space.
  const body = String(text ?? '').split('\n')
    .map((line, i) => (i ? '<w:br/>' : '') + line.split('\t').map((piece) => `<w:t xml:space="preserve">${esc(piece)}</w:t>`).join('<w:tab/>'))
    .join('');
  return xml(`<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${body}</w:r>`);
}

function para(content, props = {}) {
  const runs = Array.isArray(content) ? content.join('')
    : isXml(content) ? String(content)
      : String(run(content, props));
  const pPr = [
    props.style ? `<w:pStyle w:val="${props.style}"/>` : '',
    props.keepNext ? '<w:keepNext/>' : '',
    props.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    props.border ? '<w:pBdr><w:left w:val="single" w:sz="12" w:space="4" w:color="B9C0C8"/></w:pBdr>' : '',
    props.shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${props.shading}"/>` : '',
    props.tabRight ? `<w:tabs><w:tab w:val="right" w:pos="${props.tabRight}"/></w:tabs>` : '',
    props.spacingBefore || props.spacingAfter != null
      ? `<w:spacing${props.spacingBefore ? ` w:before="${props.spacingBefore}"` : ''}${props.spacingAfter != null ? ` w:after="${props.spacingAfter}"` : ''}/>`
      : '',
    props.indent ? `<w:ind w:left="${props.indent}" w:hanging="${props.hanging || 0}"/>` : '',
    props.align ? `<w:jc w:val="${props.align}"/>` : '',
  ].join('');
  return xml(`<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs}</w:p>`);
}

const heading = (level, text, options = {}) =>
  para(text, { style: 'Heading' + level, keepNext: true, ...options });

const empty = () => xml('<w:p/>');

/** The closing paragraph a header, a footer and the body each need. */
const emptyLine = () => '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';

/** A table cell always holds at least one paragraph, or Word refuses the file. */
function cell(content, { width, span, shading, align } = {}) {
  const body = Array.isArray(content) ? content.join('') : String(content ?? '');
  const tcPr = [
    width ? `<w:tcW w:w="${width}" w:type="dxa"/>` : '',
    span > 1 ? `<w:gridSpan w:val="${span}"/>` : '',
    shading ? `<w:shd w:val="clear" w:color="auto" w:fill="${shading}"/>` : '',
    align ? `<w:vAlign w:val="${align}"/>` : '',
  ].join('');
  return xml(`<w:tc><w:tcPr>${tcPr}</w:tcPr>${body || empty()}</w:tc>`);
}

const row = (cells, { header } = {}) =>
  xml(`<w:tr>${header ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`);

const BORDER = '<w:tblBorders>'
  + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9AA5B1"/>`).join('')
  + '</w:tblBorders>';

function table(rows, { widths } = {}) {
  const grid = (widths || []).map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  // The declared width has to agree with the columns, or the layout Word computes is not
  // the one the column widths describe.
  const total = (widths || []).reduce((a, b) => a + b, 0) || CONTENT_WIDTH;
  return xml(`<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/>${BORDER}`
    + '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="70" w:type="dxa"/>'
    + '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar></w:tblPr>'
    + (grid ? `<w:tblGrid>${grid}</w:tblGrid>` : '')
    + rows.join('') + '</w:tbl>');
}

/** Header row plus body rows, the shape every table in this document has. */
function dataTable(headers, rows, widths) {
  const head = row(headers.map((t, i) => cell(para(t, { bold: true, size: 17, spacingAfter: 0 }), { width: widths[i], shading: 'E7ECF2' })), { header: true });
  return table([head, ...rows], { widths });
}

const textCell = (text, width, props = {}) => cell(para(text, { size: 17, spacingAfter: 0, ...props }), { width });

/** A field such as PAGE, NUMPAGES or TOC: Word computes it when it opens the file. */
const field = (instruction, placeholder = '') =>
  xml('<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
  + `<w:r><w:instrText xml:space="preserve"> ${esc(instruction)} </w:instrText></w:r>`
  + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
  + (placeholder ? run(placeholder) : '')
  + '<w:r><w:fldChar w:fldCharType="end"/></w:r>');

const picture = (...args) => xml(`<w:p>${pictureRun(...args)}</w:p>`);

/** The picture as a run, for a picture that shares its paragraph with words. */
function pictureRun(relationId, index, name, widthPx, heightPx, maxWidthPx, maxHeightPx) {
  // Both limits, so a tall narrow logo cannot push the header down the page.
  const scale = Math.min(1, maxWidthPx / widthPx, maxHeightPx ? maxHeightPx / heightPx : Infinity);
  const cx = Math.round(widthPx * scale * EMU_PER_PX);
  const cy = Math.round(heightPx * scale * EMU_PER_PX);
  return xml(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`
    + `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="${esc(name)}"/>`
    + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${relationId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
    + '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>');
}

/** The DEDALO logo and mark as picture assets: the PNGs the brand module carries, decoded. */
const dedaloLogo = () => ({ data: base64ToBytes(DEDALO_LOGO_PNG), mime: 'image/png', width: DEDALO_LOGO_PNG_SIZE.width, height: DEDALO_LOGO_PNG_SIZE.height });
const dedaloMark = () => ({ data: base64ToBytes(DEDALO_MARK_PNG), mime: 'image/png', width: DEDALO_MARK_PNG_SIZE.width, height: DEDALO_MARK_PNG_SIZE.height });

// ---- the document -------------------------------------------------------------

const CONTENT_PX = 700; // how wide a picture may be on the page, in pixels at 96 dpi

/**
 * @param {object} options { doc, base, history, variant, images, graph }
 *   images: Map(imageId -> { data: Uint8Array, mime, width, height }) already carrying the markers
 *   graph:  { data, mime, width, height } | null — the stage graph as a picture
 * @returns {Promise<Uint8Array>} the .docx file
 */
export async function buildDocx({ doc, base = null, history = { revisions: [] }, variant = null, images = new Map(), graph = null }) {
  const codes = computeCodes(doc, base);
  const index = computeIndex(doc);
  const variables = variableIndex(doc);
  const calls = callMap(doc);
  const ctx = { doc, codes, index, variables, calls, interfaceOfCommand: commandInterfaces(doc) };

  // Relationships: the fixed parts first, then one per picture.
  const relations = [
    { id: 'rId1', type: 'styles', target: 'styles.xml' },
    { id: 'rId2', type: 'header', target: 'header1.xml' },
    { id: 'rId3', type: 'footer', target: 'footer1.xml' },
  ];
  const media = [];
  const addPicture = (asset, name) => {
    if (!asset || !asset.data) return null;
    const extension = asset.mime === 'image/jpeg' ? 'jpeg' : 'png';
    const file = `media/${name}${media.length + 1}.${extension}`;
    const id = `rId${relations.length + 1}`;
    relations.push({ id, type: 'image', target: file });
    media.push({ name: `word/${file}`, data: asset.data });
    return { id, index: media.length + 10, width: asset.width || 800, height: asset.height || 600 };
  };

  const body = [];
  body.push(...cover(ctx, variant, addPicture));
  // The tool's logo closes the cover, centred, under the two words that say why it is there.
  const logo_ = addPicture(dedaloLogo(), 'dedalo');
  if (logo_) {
    body.push(para('Powered by', { size: 15, color: '7A8592', caps: true, align: 'center', spacingBefore: 360, spacingAfter: 60 }));
    body.push(para([pictureRun(logo_.id, logo_.index, APP_NAME, logo_.width, logo_.height, 160, 130)], { align: 'center' }));
  }
  const lastFrozen = lastIssuedDocument(history);
  const printed = printedChapters(doc, history, lastFrozen);
  const matrixChapter = printed.find((c) => c.key === 'matrix') || null;
  body.push(heading(1, 'Revision history', { pageBreakBefore: true }), revisionTable(doc, history));
  if (matrixChapter) body.push(para(`What each revision changed, line by line, is in ${matrixChapter.label} — ${matrixChapter.title}.`, { italic: true, size: 16, color: '55606B' }));
  body.push(heading(1, 'Contents'), tableOfContents());

  // The chapters in the document's order, the empty ones left out: the same list, from the
  // same place, that the sheet prints. An appendix marked landscape gets a section of its
  // own, the page turned; a section break starts a page, so the heading does not ask for one.
  const content = {
    references: () => referenceTable(ctx),
    product: () => paragraphs(doc.description.product),
    testing: () => paragraphs(doc.description.testing),
    glossary: () => glossaryTable(ctx),
    variables: () => variableTable(ctx),
    variants: () => variantSection(ctx),
    stages: () => [
      para('The stages of the sequence, in the order their prerequisites impose.', { italic: true, size: 17, color: '55606B' }),
      ...testStages(doc).flatMap((stage) => stageSection(ctx, stage)),
    ],
    setups: () => [
      para('Routines with no place of their own in the sequence: they run where a step calls them.', { italic: true, size: 17, color: '55606B' }),
      ...setupStages(doc).flatMap((stage) => stageSection(ctx, stage)),
    ],
    kpi: () => kpiAppendix(ctx),
    points: () => pointsAppendix(ctx, images, addPicture),
    protocols: () => protocolsAppendix(ctx),
    commands: () => commandsAppendix(ctx, LANDSCAPE_WIDTH),
    resources: () => resourcesAppendix(ctx),
    graph: () => graphAppendix(graph, addPicture, { landscape: true }),
    matrix: () => matrixAppendix(revisionMatrix(doc, history, lastFrozen), matrixChapter && matrixChapter.landscape ? LANDSCAPE_WIDTH : CONTENT_WIDTH),
  };
  let landscape = false;
  let first = true;
  for (const c of printed) {
    const turn = !!c.landscape !== landscape;
    if (turn) { body.push(sectionBreak({ landscape, first })); landscape = !!c.landscape; first = false; }
    const title = c.kind === 'chapter' ? c.title : `${c.label} — ${c.title}`;
    body.push(heading(1, title, { pageBreakBefore: !turn }), ...asArray(content[c.key]()));
  }

  // A picture used by the header belongs to the header's own relationships, not to the
  // document's: putting it in the wrong part is exactly the kind of thing that makes Word
  // declare the file unreadable.
  const logo = doc.header.logoAssetId ? images.get('logo') : null;
  let headerLogo = null;
  const headerRelations = [];
  if (logo && logo.data) {
    const extension = logo.mime === 'image/jpeg' ? 'jpeg' : 'png';
    const file = `media/logo.${extension}`;
    headerRelations.push({ id: 'rId1', type: 'image', target: file });
    media.push({ name: `word/${file}`, data: logo.data });
    headerLogo = { id: 'rId1', index: 9, width: logo.width || 200, height: logo.height || 80 };
  }
  // The tool's mark — the D alone — at the right end of the header, through a relationship
  // of the header's own.
  const markPng = dedaloMark();
  headerRelations.push({ id: 'rId2', type: 'image', target: 'media/dedalo-mark.png' });
  media.push({ name: 'word/media/dedalo-mark.png', data: markPng.data });
  const headerMark = { id: 'rId2', index: 8, width: markPng.width, height: markPng.height };

  // The body ends with a paragraph too, for the same reason.
  const documentXml = DOCUMENT_OPEN + body.join('') + emptyLine() + sectionProperties({ landscape, first }) + DOCUMENT_CLOSE;

  const parts = [
    { name: '[Content_Types].xml', data: contentTypes(media) },
    { name: '_rels/.rels', data: packageRels() },
    { name: 'docProps/core.xml', data: coreProperties(doc) },
    { name: 'docProps/app.xml', data: appProperties(doc) },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: styles() },
    { name: 'word/header1.xml', data: headerPart(doc, headerLogo, headerMark) },
    { name: 'word/footer1.xml', data: footerPart(doc) },
    { name: 'word/_rels/document.xml.rels', data: documentRels(relations) },
    { name: 'word/_rels/header1.xml.rels', data: documentRels(headerRelations) },
    ...media,
  ];
  return createZip(parts);
}

const asArray = (v) => (Array.isArray(v) ? v : [v]);

// ---- front matter -------------------------------------------------------------

function cover({ doc }, variant, addPicture) {
  const hd = doc.header || {};
  const rev = doc.revision || {};
  const out = [];
  out.push(empty());
  out.push(para(hd.company || '', { bold: true, size: 24, align: 'center', caps: true }));
  out.push(para(hd.title || 'Test specification', { style: 'Title', align: 'center' }));
  out.push(para([hd.product, hd.project].filter(Boolean).join(' · '), { size: 24, align: 'center', color: '45525F' }));
  if (variant) out.push(para(`Variant: ${variant.name || ''}`, { size: 22, align: 'center', color: '7A4A12' }));
  out.push(empty());

  const label = (t) => textCell(t, 3000, { bold: true });
  out.push(table([
    row([label('Document code'), textCell(hd.documentCode || '—', 5000)]),
    row([label('Revision'), textCell([rev.number, STATUS_LABEL[rev.status] || rev.status].filter(Boolean).join(' — '), 5000)]),
    row([label('Date'), textCell(formatDate(rev.date), 5000)]),
    row([label('Confidentiality'), textCell(hd.confidentiality || '—', 5000)]),
  ], { widths: [3000, 5000] }));
  out.push(empty());

  // One column per signatory, four to a table: the same cut the screen makes, so a cover
  // with eight signatures reads the same on paper and in Word.
  const signatories = (hd.signatories || []).filter(Boolean);
  for (let i = 0; i < signatories.length; i += 4) {
    const chunk = signatories.slice(i, i + 4);
    const width = Math.floor(CONTENT_WIDTH / chunk.length);
    out.push(dataTable(chunk.map((s) => s.role || ''), [
      row(chunk.map((s) => textCell(s.name || '', width))),
      row(chunk.map(() => cell([para('Signature', { size: 16, color: '7A8592' }), empty(), empty()], { width }))),
    ], chunk.map(() => width)));
    if (i + 4 < signatories.length) out.push(empty());
  }

  // The disclaimer closes the cover, boxed and in small type, exactly as it prints.
  if (hd.disclaimer) {
    out.push(empty());
    out.push(table([row([cell(
      String(hd.disclaimer).split(/\n{2,}/).map((block) => para(block.replace(/\n/g, ' '), { size: 15, color: '45525F', spacingAfter: 60 })),
      { width: CONTENT_WIDTH, shading: 'F7F9FC' },
    )])], { widths: [CONTENT_WIDTH] }));
  }
  return out;
}

function revisionTable(doc, history) {
  const widths = [900, 1400, 2000, 4318, 1700];
  const rows = changeRecord(doc, history).map((r) => row([
    textCell(r.number || '—', widths[0]),
    textCell(formatDate(r.date), widths[1]),
    textCell(r.author || '—', widths[2]),
    textCell(r.reason || '—', widths[3]),
    textCell(STATUS_LABEL[r.status] || r.status, widths[4]),
  ]));
  return dataTable(['Rev.', 'Date', 'Author', 'Reason', 'Status'], rows, widths);
}

/** A real Word field: the reader updates it and gets the page numbers. */
const tableOfContents = () =>
  para([field('TOC \\o "1-3" \\h \\z \\u', 'Select the table and press F9 to fill in the contents.')]);

// ---- chapters -----------------------------------------------------------------

const paragraphs = (text) =>
  String(text || '').split(/\n{2,}/).filter(Boolean).map((p) => para(p));

/** The glossary, one line per term, alphabetical: what the acronyms of the text stand for. */
function glossaryTable({ doc }) {
  const entries = sortedGlossary(doc).filter((g) => String(g.term || '').trim());
  const widths = [1800, CONTENT_WIDTH - 1800];
  return [dataTable(['Term', 'Meaning'], entries.map((g) => row([
    textCell(g.term, widths[0], { bold: true }),
    textCell(g.meaning || '', widths[1]),
  ])), widths)];
}

function referenceTable({ doc, codes }) {
  const refs = doc.references || [];
  if (!refs.length) return [para('No external reference.', { italic: true, color: '7A8592' })];
  const widths = [1000, 2200, 4318, 1500, 1300];
  return [dataTable(['Code', 'Reference', 'Title', 'Revision', 'Notes'], refs.map((r) => row([
    textCell(codeOf(codes, r.id), widths[0]),
    textCell(r.code || '', widths[1]),
    textCell(r.title || '', widths[2]),
    textCell(r.revision || '', widths[3]),
    textCell(r.notes || '', widths[4]),
  ])), widths)];
}

function variableTable({ doc, codes }) {
  const vars = doc.variables || [];
  if (!vars.length) return [para('No global variable.', { italic: true, color: '7A8592' })];
  const widths = [2000, 2200, 2200, 3918];
  return [dataTable(['Name', 'Type', 'Value', 'Description'], vars.map((v) => row([
    textCell(codeOf(codes, v.id), widths[0]),
    textCell(VARIABLE_TYPE_LABEL[v.type] || v.type, widths[1]),
    textCell(variableText(v), widths[2]),
    textCell(v.description || '', widths[3]),
  ])), widths)];
}

function variantSection({ doc, codes, index }) {
  const variants = doc.variants || [];
  const stages = doc.stages || [];
  const resolved = new Map(variants.map((v) => [v.id, applyOverlay(doc, v).doc]));
  const nameWidth = 4000;
  const each = Math.floor((CONTENT_WIDTH - nameWidth) / Math.max(1, variants.length));

  const out = [dataTable(['Stage', ...variants.map((v) => v.name || '')], stages.map((stage) => row([
    textCell(labelOf(codes, index, stage.id, 48), nameWidth),
    ...variants.map((v) => textCell((resolved.get(v.id).stages || []).some((x) => x.id === stage.id) ? '✓' : '—', each, { align: 'center' })),
  ])), [nameWidth, ...variants.map(() => each)])];

  for (const v of variants) {
    out.push(heading(2, `${codeOf(codes, v.id)} — ${v.name || '(unnamed)'}`));
    if (v.description) out.push(para(v.description));
    if (!(v.overlay || []).length) {
      out.push(para('No difference from the base document.', { italic: true, color: '7A8592' }));
      continue;
    }
    const widths = [1800, 5518, 3000];
    out.push(dataTable(['Action', 'Where', 'Value'], v.overlay.map((op) => {
      const d = describeOperation(doc, op);
      return row([textCell(d.action, widths[0]), textCell(d.where, widths[1]), textCell(d.value, widths[2])]);
    }), widths));
  }
  return out;
}

// ---- stages -------------------------------------------------------------------

function stageSection(ctx, stage) {
  const { codes, index, calls } = ctx;
  const out = [heading(2, `${codeOf(codes, stage.id)} — ${stage.name || '(unnamed)'}`)];
  if (stage.description) out.push(...paragraphs(stage.description));

  const held = (stage.heldStimuli || []).map((hs) => {
    const step = findStep(stage, hs.stepId);
    return step ? labelOf(codes, index, step.id, 40) + (hs.note ? ` (${hs.note})` : '') : '⟨step not found⟩';
  });

  const items = [];
  if (isSetup(stage)) {
    const callers = calls.get(stage.id) || [];
    items.push(['Kind', 'setup stage — runs only when a step calls it']);
    items.push(['Called by', callers.length ? callers.map((c) => labelOf(codes, index, c.stepId, 34)).join('; ') : 'nobody yet']);
  } else {
    const e = stage.exclusions || {};
    items.push(['Prerequisites', (stage.prerequisites || []).map((id) => labelOf(codes, index, id, 28)).join(', ') || 'none']);
    items.push(['Parallel', e.mode === EXCLUSION_MODE.ALL
      ? 'no stage in parallel'
      : e.mode === EXCLUSION_MODE.LIST
        ? `not with ${(e.stageIds || []).map((id) => labelOf(codes, index, id, 28)).join(', ') || '—'}`
        : 'unrestricted']);
  }
  items.push(['Held on exit', held.length ? held.join('; ') : 'none, every stimulus is removed']);

  out.push(para(items.flatMap(([label, value], i) => [
    i ? run('   ·   ', { size: 17, color: '9AA5B1' }) : '',
    run(label + ': ', { bold: true, size: 17 }),
    run(value, { size: 17 }),
  ]).filter(Boolean), { shading: 'F4F7FA', border: true, spacingAfter: 120 }));

  for (const test of stage.tests || []) {
    out.push(heading(3, `${codeOf(codes, test.id)} — ${test.name || '(unnamed test)'}`));
    if (test.purpose) out.push(para(test.purpose, { italic: true, size: 17, color: '55606B' }));
    out.push(stepTable(ctx, test));
  }
  return out;
}

function stepTable(ctx, test) {
  const { codes, index } = ctx;
  const steps = test.steps || [];
  if (!steps.length) return para('No step.', { italic: true, color: '7A8592' });
  const widths = [1300, 7018, 2000];
  const rows = steps.map((s) => {
    // A table step carries its criteria in its own cells: its cell spans the acceptance column
    // too, as on the sheet, and the nested table gets the width.
    const table = s.type === STEP_TYPE.TABLE;
    if (table) {
      // The whole row: the code at the right of the description, the table under both.
      return row([cell([
        para([
          run(codeOf(codes, s.id) + ' ', { size: 16, bold: true, font: 'Consolas' }),
          run((STEP_TYPE_SHORT[s.type] || '') + '  ', { size: 14, color: '7A8592' }),
          run(s.description || '', { bold: true, size: 17 }),
        ], { spacingAfter: 0 }),
        ...stepDetail(ctx, s),
        ...(s.note ? [para(s.note, { italic: true, size: 16, color: '55606B', spacingAfter: 0 })] : []),
        ...(s.imageId ? [para('See ' + labelOf(codes, index, s.imageId, 40), { size: 16, color: '10559A', spacingAfter: 0 })] : []),
      ], { width: widths[0] + widths[1] + widths[2], span: 3 })]);
    }
    return row([
      cell([
        para(codeOf(codes, s.id), { size: 16, bold: true, font: 'Consolas', spacingAfter: 0 }),
        para(STEP_TYPE_SHORT[s.type] || '', { size: 14, color: '7A8592', spacingAfter: 0 }),
      ], { width: widths[0] }),
      cell([
        para(s.description || '', { bold: true, size: 17, spacingAfter: 0 }),
        ...stepDetail(ctx, s),
        ...(s.note ? [para(s.note, { italic: true, size: 16, color: '55606B', spacingAfter: 0 })] : []),
        // The figure by code and name only: the picture itself is in the appendix, and a
        // thumbnail per step would double the pictures a Word file carries.
        ...(s.imageId ? [para('See ' + labelOf(codes, index, s.imageId, 40), { size: 16, color: '10559A', spacingAfter: 0 })] : []),
      ], { width: widths[1] }),
      // The criterion in its own column, the way the screen and the print show it.
      // The criterion, then the grey plate that says what kind of answer it judges, then the
      // one line that is only there when case does not matter.
      cell(s.measurement && expectedText(s.measurement, ctx.variables, unitOfCommand(ctx, s.measurement))
        ? expectedCell(s.measurement, ctx.variables, unitOfCommand(ctx, s.measurement))
        : [para('—', { size: 17, spacingAfter: 0 })], { width: widths[2] }),
    ]);
  });
  return dataTable(['Step', 'Action and detail', 'Acceptance'], rows, widths);
}

/** The unit a command's decoding gives, for a criterion over that command that states none. */
const unitOfCommand = (ctx, block) => (block && block.commandId ? commandDecoding((ctx.doc.commands || []).find((c) => c.id === block.commandId)).unit : '');

/** The acceptance cell of the printed table: value, plate, and the case note when it applies. */
function expectedCell(measurement, variables, fallbackUnit = '') {
  const e = measurement.expected || {};
  const note = expectedCaseNote(e);
  return [
    para(expectedText(measurement, variables, fallbackUnit) || '—', { size: 17, bold: true, spacingAfter: 20 }),
    para([run(' ' + expectedBadge(e) + ' ', { bold: true, size: 13, color: '45525F', highlight: 'E7EBEF' })],
      { align: 'center', spacingAfter: note ? 20 : 0 }),
    ...(note ? [para(note, { size: 13, color: '7A8592', align: 'center', spacingAfter: 0 })] : []),
  ];
}

function stepDetail(ctx, step) {
  const { codes, index, variables } = ctx;
  if (step.type === STEP_TYPE.STAGE_CALL) {
    return [para([
      run(' RUN ', { bold: true, size: 15, color: 'FFFFFF', highlight: '5B4B9A' }),
      run(' ' + labelOf(codes, index, step.calledStageId, 40), { size: 17 }),
      run(' — the setup stage runs in full, then the sequence continues here', { size: 16, color: '7A8592' }),
    ], { spacingAfter: 0 })];
  }
  // Apply, then wait, then measure: the order the operator works in.
  const lines = [];
  if (step.type === STEP_TYPE.TABLE) {
    const wait = step.wait ? valueText(step.wait.value, variables, step.wait.unit) : '';
    if (wait) lines.push(para([run(' WAIT ', { bold: true, size: 15, color: 'FFFFFF', highlight: '55606B' }), run(' ' + wait, { size: 17, color: '45525F' })], { spacingAfter: 0 }));
    // A table inside the cell, as on the page; Word wants a paragraph after a nested table.
    lines.push(tableBlock(ctx, step), empty());
    return lines;
  }
  if (step.stimulus) lines.push(blockLine(ctx, 'stimulus', step.stimulus));
  const wait = step.wait ? valueText(step.wait.value, variables, step.wait.unit) : '';
  if (wait) {
    lines.push(para([
      run(' WAIT ', { bold: true, size: 15, color: 'FFFFFF', highlight: '55606B' }),
      run(' ' + wait, { size: 17, color: '45525F' }),
    ], { spacingAfter: 0 }));
  }
  if (step.measurement) lines.push(blockLine(ctx, 'measurement', step.measurement));
  return lines;
}

/**
 * The matrix of a table step, one column per definition and one row per combination. The
 * header says what the column does and with what; the cells say the value or the criterion,
 * the plate under each criterion as in the acceptance column.
 */
function tableBlock({ codes, index, variables, interfaceOfCommand }, step) {
  // Not `table`: that is the function that writes one, a few lines down.
  const grid = step.table || {};
  const columns = grid.columns || [];
  const rows = grid.rows || [];
  if (!columns.length || !rows.length) return para('The table has no rows or no columns yet.', { italic: true, size: 16, color: '7A8592' });
  const inner = 1300 + 7018 + 2000 - 140;
  const labelWidth = Math.min(1800, Math.floor(inner / (columns.length + 1)));
  const colWidth = Math.floor((inner - labelWidth) / columns.length);
  const widths = [labelWidth, ...columns.map(() => colWidth)];

  const head = row([
    cell(para('', { size: 15, spacingAfter: 0 }), { width: labelWidth, shading: 'E7ECF2' }),
    ...columns.map((c) => {
      const kind = c.kind === TABLE_COLUMN_KIND.STIMULUS ? 'stimulus' : 'measurement';
      const command = !!c.commandId;
      const badge = command ? (kind === 'stimulus' ? '0F6B7D' : '8A2F5F') : (kind === 'stimulus' ? 'B26A12' : '1D6B32');
      const refs = [];
      if (command) refs.push(labelOf(codes, index, c.commandId, 30));
      else {
        for (const id of blockResources(c, interfaceOfCommand)) refs.push(labelOf(codes, index, id, 30));
        if ((c.pointIds || []).length) refs.push('@ ' + c.pointIds.map((id) => labelOf(codes, index, id, 24)).join(', '));
      }
      return cell([
        para([run(' ' + blockTag(kind, c) + ' ', { bold: true, size: 13, color: 'FFFFFF', highlight: badge }),
          run(' ' + (c.name || '') + (c.unit ? ` [${c.unit}]` : ''), { bold: true, size: 15 })], { spacingAfter: 0 }),
        ...(refs.length ? [para(refs.join(' · '), { size: 13, color: '55606B', spacingAfter: 0 })] : []),
      ], { width: colWidth, shading: 'E7ECF2' });
    }),
  ], { header: true });

  const body = rows.map((r) => row([
    textCell(r.label || '', labelWidth, { bold: true, size: 15 }),
    ...columns.map((c) => {
      const found = (r.cells || []).find((x) => x.columnId === c.id);
      if (!found) return textCell('—', colWidth, { size: 15, color: '7A8592' });
      if (c.kind === TABLE_COLUMN_KIND.STIMULUS) return textCell(cellValueText(found.value, variables, c.unit) || '—', colWidth, { size: 15 });
      const text = expectedText({ expected: found.expected }, variables);
      return cell(text
        ? [para(text, { size: 15, bold: true, spacingAfter: 10 }),
           para([run(' ' + expectedBadge(found.expected) + ' ', { bold: true, size: 12, color: '45525F', highlight: 'E7EBEF' })], { spacingAfter: 0 })]
        : [para('—', { size: 15, color: '7A8592', spacingAfter: 0 })], { width: colWidth });
    }),
  ]));
  return table([head, ...body], { widths });
}

function blockLine({ codes, index, variables, interfaceOfCommand }, kind, block) {
  const stimulus = kind === 'stimulus';
  if (!stimulus && block.computed) {
    const inputs = (block.computed.inputStepIds || []).map((id) => labelOf(codes, index, id, 40)).join(', ');
    return para([
      run(' COMPUTED ', { bold: true, size: 15, color: 'FFFFFF', highlight: '3A5A8C' }),
      run(' ' + (block.description || ''), { size: 17 }),
      ...(block.computed.formula ? [run(' = ' + block.computed.formula, { size: 17, font: 'Consolas' })] : []),
      ...(inputs ? [run(' from ' + inputs, { size: 16, color: '7A8592' })] : []),
    ], { spacingAfter: 0 });
  }
  const command = !!block.commandId;
  const tag = blockTag(kind, block);
  const tone = command
    ? (stimulus ? { badge: '0F6B7D', chip: 'E2F1F4', text: '0F5A69' } : { badge: '8A2F5F', chip: 'F7E6EF', text: '7A2853' })
    : (stimulus ? { badge: 'B26A12', chip: 'FBF0DC', text: '6B4A12' } : { badge: '1D6B32', chip: 'FBF0DC', text: '6B4A12' });

  // A command carries its own instrument and contacts through its interface: the step states
  // neither, exactly as on screen.
  const points = command ? '' : (block.pointIds || []).map((id) => labelOf(codes, index, id, 30)).join(', ');
  const resources = command ? [] : blockResources(block, interfaceOfCommand);

  const runs = [
    run(' ' + tag + ' ', { bold: true, size: 15, color: 'FFFFFF', highlight: tone.badge }),
    run(' ' + (block.description || ''), { size: 17 }),
  ];
  for (const id of resources) runs.push(run(' · ' + labelOf(codes, index, id, 30), { size: 17 }));
  // What is said to the software, in the software's font, as on the sheet.
  if (command) runs.push(run(' · ' + labelOf(codes, index, block.commandId, 30), { size: 16, font: 'Consolas', italic: true, bold: true, color: tone.text }));
  for (const p of (block.parameters || []).filter((x) => x.name)) {
    runs.push(run(' ' + p.name + ' ' + (valueText(p.value, variables, p.unit) || '—') + ' ', { size: 16, color: tone.text, highlight: tone.chip, font: command ? 'Consolas' : undefined, italic: command, bold: command }));
  }
  if (points) runs.push(run('  @ ' + points + ' ', { size: 16, highlight: 'E6F1FB' }));
  return para(runs, { spacingAfter: 0 });
}

// ---- appendices ----------------------------------------------------------------

const characteristicsText = (list) =>
  (list || []).filter((c) => c.name || c.value).map((c) => `${c.name} ${c.value}${c.unit ? ' ' + c.unit : ''}`);

function pointsAppendix({ doc, codes }, images, addPicture) {
  const points = doc.points || [];
  const out = [];
  if (!points.length) {
    out.push(para('No application point defined.', { italic: true, color: '7A8592' }));
  } else {
    const widths = [900, 2200, 1300, 1300, 1600, 2118, 900];
    out.push(dataTable(['Code', 'Name', 'Connector', 'Signal', 'Contact', 'Connection characteristics', 'Fig.'],
      points.map((p) => row([
        textCell(codeOf(codes, p.id), widths[0]),
        textCell(p.name || '', widths[1]),
        textCell([p.connector, p.pin && `pin ${p.pin}`].filter(Boolean).join(' '), widths[2]),
        textCell(p.signal || '', widths[3]),
        textCell(p.contactType || '', widths[4]),
        cell(bulletParagraphs(characteristicsText(p.characteristics)), { width: widths[5] }),
        textCell((p.markers || []).map((m) => codeOf(codes, m.imageId)).filter(Boolean).join(', '), widths[6]),
      ])), widths));
  }

  for (const image of doc.images || []) {
    const asset = images.get(image.id);
    if (!asset) continue;
    const picture_ = addPicture(asset, 'figure');
    if (!picture_) continue;
    out.push(picture(picture_.id, picture_.index, image.name || 'figure', picture_.width, picture_.height, CONTENT_PX));
    out.push(para(`${codeOf(codes, image.id)} ${image.name || ''}${image.caption ? ' — ' + image.caption : ''}`,
      { italic: true, size: 16, color: '45525F' }));
  }
  return out;
}

/** The grammar of the messages, before the commands written in it. */
function protocolsAppendix({ doc, codes, index }) {
  const protocols = doc.protocols || [];
  const out = [];
  if (!protocols.length) return [para('No protocol described.', { italic: true, color: '7A8592' })];
  for (const p of protocols) {
    out.push(heading(2, `${codeOf(codes, p.id)} — ${p.name || '(unnamed)'}${p.family ? ' · ' + p.family : ''}`));
    if (p.description) out.push(para(p.description, { size: 17 }));
    const rows = [];
    const line = (label, value) => rows.push(row([textCell(label, 2000, { bold: true }), textCell(value, CONTENT_WIDTH - 2000)]));
    if (p.referenceId) line('Defined in', labelOf(codes, index, p.referenceId, 40));
    if (p.requestFormat) line('Request', p.requestFormat);
    if (p.responseFormat) line('Response', p.responseFormat);
    const rules = characteristicsText(p.rules);
    if (rules.length) rows.push(row([textCell('Rules', 2000, { bold: true }), cell(bulletParagraphs(rules), { width: CONTENT_WIDTH - 2000 })]));
    if (p.notes) line('Notes', p.notes);
    const users = (doc.commands || []).filter((c) => c.protocolId === p.id).map((c) => codeOf(codes, c.id) + ' ' + (c.name || ''));
    line('Used by', users.length ? users.join(', ') : 'no command yet');
    out.push(table(rows, { widths: [2000, CONTENT_WIDTH - 2000] }));
  }
  return out;
}

/** The tests somebody follows line-side, with what each of them is judged by. */
function kpiAppendix({ doc, codes, index, variables }) {
  const rows = [];
  const widths = [1300, 2600, 2400, 2818, 1800];
  for (const stage of doc.stages || []) {
    for (const test of stage.tests || []) {
      if (!test.kpi) continue;
      const measurements = (test.steps || []).filter((s) => s.measurement);
      if (!measurements.length) {
        rows.push(row([
          textCell(codeOf(codes, test.id), widths[0]),
          textCell(test.name || '', widths[1]),
          textCell(labelOf(codes, index, stage.id, 30), widths[2]),
          textCell('no measurement in this test', widths[3], { italic: true }),
          textCell('—', widths[4]),
        ]));
        continue;
      }
      for (const step of measurements) {
        rows.push(row([
          textCell(codeOf(codes, test.id), widths[0]),
          textCell(test.name || '', widths[1]),
          textCell(labelOf(codes, index, stage.id, 30), widths[2]),
          textCell(step.measurement.description || codeOf(codes, step.id), widths[3]),
          cell(expectedCell(step.measurement, variables), { width: widths[4] }),
        ]));
      }
    }
  }
  if (!rows.length) return [para('No test is marked as a key performance indicator.', { italic: true, color: '7A8592' })];
  return [
    para('The tests followed line-side, with the criterion each of them is judged by.', { size: 16, color: '55606B' }),
    dataTable(['Test', 'Name', 'Stage', 'Measured', 'Acceptance'], rows, widths),
  ];
}

function commandsAppendix({ doc, codes, index }, contentWidth = CONTENT_WIDTH) {
  const out = [heading(2, 'Interfaces')];
  const interfaces = doc.interfaces || [];
  // The columns share the width of the page the appendix is printed on.
  const fit = (parts) => {
    const total = parts.reduce((a, b) => a + b, 0);
    const widths = parts.map((p) => Math.floor((p * contentWidth) / total));
    widths[widths.length - 1] += contentWidth - widths.reduce((a, b) => a + b, 0);
    return widths;
  };
  if (!interfaces.length) out.push(para('No interface defined.', { italic: true, color: '7A8592' }));
  else {
    const widths = fit([900, 2300, 1500, 2918, 1600, 1100]);
    out.push(dataTable(['Code', 'Name', 'Type', 'Requirements', 'Connected at', 'Notes'], interfaces.map((i) => row([
      textCell(codeOf(codes, i.id), widths[0]),
      textCell(i.name || '', widths[1]),
      textCell(i.type || '', widths[2]),
      cell(bulletParagraphs(characteristicsText(i.parameters)), { width: widths[3] }),
      textCell((i.pointIds || []).map((id) => labelOf(codes, index, id, 22)).join(', ') || '—', widths[4]),
      textCell(i.notes || '', widths[5]),
    ])), widths));
  }

  out.push(heading(2, 'Commands'));
  const commands = doc.commands || [];
  if (!commands.length) out.push(para('No command defined.', { italic: true, color: '7A8592' }));
  else {
    const widths = fit([900, 1800, 1300, 1300, 1400, 1300, 1800, 900, 1200]);
    out.push(dataTable(['Code', 'Command', 'Interface', 'Protocol', 'Address', 'Request', 'Response', 'Time', 'Encoding'], commands.map((c) => row([
      textCell(codeOf(codes, c.id), widths[0]),
      cell([
        para(c.name || '', { size: 17, spacingAfter: c.referenceId ? 20 : 0 }),
        ...(c.referenceId ? [para('Defined in ' + labelOf(codes, index, c.referenceId, 30), { size: 14, color: '55606B', spacingAfter: 0 })] : []),
      ], { width: widths[1] }),
      textCell(labelOf(codes, index, c.interfaceId, 24), widths[2]),
      textCell(labelOf(codes, index, c.protocolId, 24) || '—', widths[3]),
      textCell(c.address || '', widths[4]),
      textCell(c.requestFormat || '', widths[5]),
      // The refusal belongs under the answer it replaces, in the same cell.
      cell([
        para(c.responseFormat || '', { spacingAfter: c.negativeResponse ? 20 : 0 }),
        ...(c.negativeResponse ? [para([run('NEG ', { bold: true, color: '8C2020', size: 14 }), run(c.negativeResponse, { color: '8C2020' })], { spacingAfter: 0 })] : []),
      ], { width: widths[6] }),
      textCell(c.nominalTime ? `${c.nominalTime} s` : '—', widths[7]),
      cell([
        para(c.encoding || '', { size: 17, spacingAfter: commandDecoding(c).formula || commandDecoding(c).unit ? 20 : 0 }),
        ...(commandDecoding(c).formula || commandDecoding(c).unit
          ? [para([run('Decoding ', { bold: true, size: 14, color: '55606B' }), run([commandDecoding(c).formula, commandDecoding(c).unit ? `→ ${commandDecoding(c).unit}` : ''].filter(Boolean).join(' '), { size: 14, color: '55606B' })], { spacingAfter: 0 })]
          : []),
      ], { width: widths[8] }),
    ])), widths));
  }
  return out;
}

function resourcesAppendix({ doc, codes, index }) {
  const { rows: summary, groups, truncated } = resourceSummary(doc);
  if (!summary.length) return [para('No resource required.', { italic: true, color: '7A8592' })];

  const widths = [900, 2400, 1600, 2200, 1400, 2318, 1000];
  const rows = summary.map((r) => row([
    textCell(codeOf(codes, r.resource.id), widths[0]),
    textCell(r.resource.name || '', widths[1]),
    textCell(r.resource.category || '', widths[2]),
    cell(bulletParagraphs(characteristicsText(r.resource.characteristics)), { width: widths[3] }),
    textCell(r.usedParameters.join(', '), widths[4]),
    cell(numberedParagraphs(r.points.map((id) => labelOf(codes, index, id, 34)),
      r.usesWithoutPoint ? `${r.usesWithoutPoint} use${r.usesWithoutPoint > 1 ? 's' : ''} with no declared point` : ''), { width: widths[5] }),
    textCell(String(r.maxChannels), widths[6], { bold: true, align: 'center' }),
  ]));

  const parallel = groups.filter((g) => g.length > 1);
  const note = 'How to read the channel count. Inside a stage a resource needs one channel per distinct '
    + 'application point it is used on (worst case: every connection present on the bench at the same time); '
    + 'a use with no declared point counts as one. What a setup stage uses is charged to the test stages that '
    + 'call it. Stimuli held on exit keep occupying their channels in the stages that depend on that stage. '
    + '«Max channels» is the largest sum of channels over all groups of test stages that may run in parallel. '
    + (truncated
      ? 'The stage graph is too large to enumerate every parallel group: the figures above are the worst case, not an exact count.'
      : parallel.length
        ? `Parallel groups: ${parallel.map((g) => g.map((id) => codeOf(codes, id) || '?').join(' + ')).join('; ')}.`
        : 'No two stages may run in parallel: the sequence is fully ordered.');

  return [
    dataTable(['Code', 'Resource', 'Category', 'Required characteristics', 'Parameters used', 'Applied on', 'Max channels'], rows, widths),
    para(note, { size: 16, color: '45525F', shading: 'F4F7FA', border: true }),
  ];
}

/** The revision matrix as a table: the place, then one cell per revision, shaded by kind. */
function matrixAppendix({ columns, groups }, contentWidth) {
  const SHADE = { added: 'EAF7EE', changed: 'FDF6E6', removed: 'FCEAEA', moved: 'EFEFF9' };
  const INK = { added: '1D6B32', changed: 'B26A12', removed: '8C2020', moved: '5B4B9A' };
  const whereWidth = Math.min(3200, Math.floor(contentWidth / 3));
  const colWidth = Math.floor((contentWidth - whereWidth) / Math.max(1, columns.length));
  const widths = [whereWidth, ...columns.map(() => colWidth)];
  widths[widths.length - 1] += contentWidth - widths.reduce((a, b) => a + b, 0);
  const head = row([
    cell(para('What changed', { bold: true, size: 16, spacingAfter: 0 }), { width: whereWidth, shading: 'E7ECF2' }),
    ...columns.map((c, i) => cell([
      para(`Rev. ${c.number || '—'}`, { bold: true, size: 16, spacingAfter: 0, align: 'center' }),
      para(c.draft ? (c.status === 'draft' ? 'draft' : 'changed since issue') : formatDate(c.date), { size: 14, color: '55606B', spacingAfter: 0, align: 'center' }),
    ], { width: widths[i + 1], shading: 'E7ECF2' })),
  ], { header: true });
  const rows = groups.flatMap((g) => [
    row([cell(para(g.chapter.toUpperCase(), { bold: true, size: 14, color: '45525F', spacingAfter: 0 }), { width: contentWidth, span: columns.length + 1, shading: 'EEF1F5' })]),
    ...g.rows.map((r) => row([
      textCell(r.where, whereWidth, { size: 15 }),
      ...columns.map((c, i) => {
        const change = r.cells.get(c.number);
        if (!change) return cell(para('', { size: 15, spacingAfter: 0 }), { width: widths[i + 1], shading: 'FAFBFC' });
        const { tag, text } = cellText(change);
        return cell(para([
          run(' ' + tag.toUpperCase() + ' ', { bold: true, size: 12, color: 'FFFFFF', highlight: INK[tag] }),
          run(' ' + text, { size: 15 }),
        ], { spacingAfter: 0 }), { width: widths[i + 1], shading: SHADE[tag] });
      }),
    ])),
  ]);
  return [
    para('One column per revision that changed something, one row per thing changed. A cell says what that revision did to it; a long text is not quoted but counted. The first issue records nothing: everything was new in it.', { italic: true, size: 16, color: '55606B' }),
    table([head, ...rows], { widths }),
  ];
}

function graphAppendix(graph, addPicture, { landscape = false } = {}) {
  if (!graph) return [para('The stage graph could not be rendered as a picture.', { italic: true, color: '7A8592' })];
  const picture_ = addPicture(graph, 'graph');
  if (!picture_) return [para('The stage graph could not be rendered as a picture.', { italic: true, color: '7A8592' })];
  // On a turned page the picture is bounded by the height as much as by the width: a tall
  // graph that fit a portrait page must not run off the foot of a landscape one.
  const box = landscape ? [1000, 560] : [CONTENT_PX, 900];
  return [
    picture(picture_.id, picture_.index, 'Stage graph', picture_.width, picture_.height, box[0], box[1]),
    para('Arrow: mandatory prerequisite · ⊘ not with…: the stages it cannot run alongside · dotted: a step calls this setup stage · '
      + 'rounded box: setup stage · thick border: allows no stage in parallel.',
      { italic: true, size: 16, color: '45525F' }),
  ];
}

/** Bullets and numbers written by hand: no numbering part, no list state to get wrong. */
const bulletParagraphs = (items) =>
  (items.length
    ? items.map((t) => para('• ' + t, { size: 17, spacingAfter: 0, indent: 160, hanging: 160 }))
    : [para('—', { size: 17, spacingAfter: 0 })]);

const numberedParagraphs = (items, footnote) => {
  const out = items.length
    ? items.map((t, i) => para(`${i + 1}. ${t}`, { size: 17, spacingAfter: 0, indent: 200, hanging: 200 }))
    : [para('—', { size: 17, spacingAfter: 0 })];
  if (footnote) out.push(para(footnote, { size: 15, italic: true, color: '55606B', spacingAfter: 0 }));
  return out;
};

// ---- fixed parts ---------------------------------------------------------------

const DOCUMENT_OPEN = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
  + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>';

const DOCUMENT_CLOSE = '</w:body></w:document>';

/**
 * The properties of one section: the page, turned or not, with the running header and
 * footer. Only the first section has a title page — the cover — without them; a `titlePg`
 * on a later section would blank the header of its first page too.
 */
const sectionProperties = ({ landscape = false, first = true } = {}) =>
  '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>'
  + (landscape ? `<w:pgSz w:w="${PAGE.h}" w:h="${PAGE.w}" w:orient="landscape"/>` : `<w:pgSz w:w="${PAGE.w}" w:h="${PAGE.h}"/>`)
  + `<w:pgMar w:top="${PAGE.top}" w:right="${PAGE.side}" w:bottom="${PAGE.bottom}" w:left="${PAGE.side}"`
  + ` w:header="${PAGE.header}" w:footer="${PAGE.footer}" w:gutter="0"/>`
  + (first ? '<w:titlePg/>' : '') + '</w:sectPr>';

/** Closes the section the body is in: a paragraph carrying its properties, then a new page. */
const sectionBreak = (props) => xml(`<w:p><w:pPr><w:spacing w:after="0"/>${sectionProperties(props)}</w:pPr></w:p>`);

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

const NAMESPACES = ' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
  + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
  + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
  + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

const HEADER_OPEN = `${XML_DECLARATION}<w:hdr${NAMESPACES}>`;
const FOOTER_OPEN = `${XML_DECLARATION}<w:ftr${NAMESPACES}>`;

function headerPart(doc, logo, mark) {
  const hd = doc.header || {};
  const line = [hd.title, hd.product].filter(Boolean).join(' — ');
  const cells = [];
  // 24 px at 96 dpi is the height of the two lines beside it: the logo fits the header
  // that already exists instead of making room for itself. The tool's mark, at the other
  // end, is fitted the same way.
  const MARK = 500;
  if (logo) cells.push(cell(picture(logo.id, logo.index, 'logo', logo.width, logo.height, 90, 24), { width: 1400 }));
  cells.push(cell([
    para(hd.company || '', { bold: true, size: 17, spacingAfter: 0 }),
    para(line, { size: 15, color: '55606B', spacingAfter: 0 }),
  ], { width: CONTENT_WIDTH - (logo ? 1400 : 0) - MARK }));
  cells.push(cell(para([pictureRun(mark.id, mark.index, 'DEDALO', mark.width, mark.height, 26, 24)], { align: 'right', spacingAfter: 0 }), { width: MARK, align: 'center' }));
  const widths = logo ? [1400, CONTENT_WIDTH - 1400 - MARK, MARK] : [CONTENT_WIDTH - MARK, MARK];
  return HEADER_OPEN
    + `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/>`
    + '<w:tblBorders><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B9C0C8"/></w:tblBorders></w:tblPr>'
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    + row(cells) + '</w:tbl>'
    // A table may not be the last thing in a header, a footer or the body: Word calls the
    // file damaged and offers to repair it. An empty paragraph closes them properly.
    + emptyLine() + '</w:hdr>';
}

function footerPart(doc) {
  const hd = doc.header || {};
  const rev = doc.revision || {};
  const left = [hd.documentCode, rev.number ? `Rev. ${rev.number}` : '', formatDate(rev.date)].filter(Boolean).join(' · ');
  const widths = [5000, 3318, 2000];
  return FOOTER_OPEN
    + `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/>`
    + '<w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B9C0C8"/></w:tblBorders></w:tblPr>'
    + `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`
    + row([
      textCell(left, widths[0], { size: 15, color: '55606B' }),
      cell(para([run(hd.confidentiality || '', { size: 15, color: '55606B', bold: true, caps: true })], { spacingAfter: 0 }), { width: widths[1] }),
      cell(para([run('Page ', { size: 15, color: '55606B' }), field('PAGE', '1'), run(' of ', { size: 15, color: '55606B' }), field('NUMPAGES', '1')], { align: 'right', spacingAfter: 0 }), { width: widths[2] }),
    ])
    + '</w:tbl>' + emptyLine() + '</w:ftr>';
}

const styleDefinition = (id, name, { size, bold, italic, color, outline, before, after, base }) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>`
  + (base ? `<w:basedOn w:val="${base}"/>` : '')
  + '<w:qFormat/>'
  + '<w:pPr><w:keepNext/>'
  + `<w:spacing w:before="${before || 0}" w:after="${after || 0}"/>`
  + `${outline != null ? `<w:outlineLvl w:val="${outline}"/>` : ''}</w:pPr>`
  + `<w:rPr>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}`
  + `<w:sz w:val="${size}"/>${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr></w:style>`;

const styles = () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:docDefaults><w:rPrDefault><w:rPr>'
  + '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/>'
  + '</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
  + styleDefinition('Title', 'Title', { size: 52, bold: true, after: 120 })
  + styleDefinition('Heading1', 'heading 1', { size: 28, bold: true, color: '14181D', outline: 0, before: 240, after: 120 })
  + styleDefinition('Heading2', 'heading 2', { size: 24, bold: true, color: '24303C', outline: 1, before: 200, after: 100 })
  + styleDefinition('Heading3', 'heading 3', { size: 21, bold: true, color: '24303C', outline: 2, before: 160, after: 80 })
  + '</w:styles>';

const contentTypes = (media) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + (media.some((m) => m.name.endsWith('.png')) ? '<Default Extension="png" ContentType="image/png"/>' : '')
  + (media.some((m) => m.name.endsWith('.jpeg')) ? '<Default Extension="jpeg" ContentType="image/jpeg"/>' : '')
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
  + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
  + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
  + '</Types>';

const packageRels = () => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rIdDoc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '<Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
  + '<Relationship Id="rIdApp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
  + '</Relationships>';

const REL_TYPE = {
  styles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  header: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
  footer: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
};

const documentRels = (relations) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + relations.map((r) => `<Relationship Id="${r.id}" Type="${REL_TYPE[r.type]}" Target="${esc(r.target)}"/>`).join('')
  + '</Relationships>';

// The document properties have a fixed element order too — category, created, creator,
// modified, revision, subject, title for the core part; Company before Application for the
// extended one. Out of order they are one more reason for Word to offer a repair.
const coreProperties = (doc) => {
  const hd = doc.header || {};
  const rev = doc.revision || {};
  const stamp = `${rev.date || '2020-01-01'}T00:00:00Z`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"'
    + ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<cp:category>${esc(hd.confidentiality || '')}</cp:category>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created>`
    + `<dc:creator>${esc(rev.author || ((hd.signatories || [])[0] || {}).name || '')}</dc:creator>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified>`
    + `<cp:revision>${esc(rev.number || '00')}</cp:revision>`
    + `<dc:subject>${esc(hd.product || '')}</dc:subject>`
    + `<dc:title>${esc(hd.title || 'Test specification')}</dc:title>`
    + '</cp:coreProperties>';
};

const appProperties = (doc) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
  + `<Company>${esc((doc.header || {}).company || '')}</Company>`
  + `<Application>${APP_NAME} — ${APP_TAGLINE}</Application>`
  + '</Properties>';

const formatDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).split('-');
  return d ? `${d}/${m}/${y}` : iso;
};
