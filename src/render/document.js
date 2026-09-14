// Full rendering of the document: the same structure feeds the on screen preview and the
// paginated print. Steps stay short and point to the appendices through their codes; every
// code carries the name of what it refers to, so the reader rarely has to jump.
import { h, formatDate } from '../ui/dom.js';
import { computeCodes, mergedIndex, codeOf } from '../model/codes.js';
import { variableIndex, valueText, expectedText, variableText } from '../model/variables.js';
import { changeRecord, STATUS_LABEL } from '../history/revisions.js';
import { STEP_TYPE, STEP_TYPE_SHORT, EXCLUSION_MODE, VARIABLE_TYPE_LABEL, TABLE_COLUMN_KIND, blockTag, expectedKind, expectedBadge, expectedCaseNote, expectedTextRef, commandDecoding } from '../model/schema.js';
import { testStages, setupStages, callMap, isSetup, findStep } from '../model/stages.js';
import { blockResources, commandInterfaces } from '../model/resources.js';
import { applyOverlay, describeOperation } from '../model/variants.js';
import { assetUrl } from '../io/images.js';
import { appendixPoints, appendixCommands, appendixResources, appendixGraph, appendixKpi, appendixProtocols } from './appendices.js';
import { directEditingAllowed } from '../ui/navigate.js';
import { ref, editRef, refList, cardRef, defRef, valueRef, varying, presenceMark, interleave } from './refs.js';
import { varianceIndex } from '../model/variance.js';
import { cellValueText } from '../model/shorthand.js';
import { printedChapters } from '../model/chapters.js';
import { sortedGlossary } from '../model/glossary.js';
import { revisionMatrix, cellText } from '../history/matrix.js';
import { DEDALO_LOGO, DEDALO_MARK } from '../brand/dedalo.js';
import { APP_NAME } from '../version.js';
import { lastIssuedDocument } from '../history/revisions.js';

/**
 * @param {object} options { assets, history, variant, base, directEditing }
 *  `directEditing` overrides what the document itself allows: reading mode passes false,
 *  because a sheet one is reading must not lead into the editor by a stray click.
 * @returns {HTMLElement} the document container
 */
export function renderDocument(doc, options = {}) {
  const assets = options.assets || {};
  const history = options.history || { revisions: [] };
  const codes = computeCodes(doc, options.base);
  const index = mergedIndex(doc, options.base);
  const variables = variableIndex(doc);
  const calls = callMap(doc);
  const ctx = { doc, base: options.base || doc, variant: options.variant || null, assets, codes, index, variables, calls,
    // Always read from the base: what varies varies whichever version is on screen, and the
    // reader of the base document is the one with no other way of knowing it.
    variance: varianceIndex(options.base || doc),
    interfaceOfCommand: commandInterfaces(doc),
    directEditing: options.directEditing === undefined ? directEditingAllowed(doc) : !!options.directEditing };
  const chapters = [];
  const body = h('div', { class: 'doc-body' });

  // A chapter's id is its key, not its number: a note anchored to the test description, or a
  // link into it, must still find it when a chapter before it is empty or moved.
  const chapter = ({ key, label, title }, ...content) => {
    const id = 'chap-' + key;
    chapters.push({ number: label, title, id, level: 1 });
    return h('section', { class: 'doc-chapter', id }, h('h2', { class: 'doc-h2' }, `${label}. ${title}`), ...content);
  };
  const stageHints = {
    stages: 'The stages of the sequence, in the order their prerequisites impose. Each step carries its high level description; the codes point to the appendices for the full detail.',
    setups: 'Routines with no place of their own in the sequence: they run where a step calls them, as many times as it is called (power up, power down, load configuration…).',
  };
  const content = {
    references: () => referenceTable(ctx),
    product: () => paragraphs(doc.description.product),
    testing: () => paragraphs(doc.description.testing),
    glossary: () => glossaryTable(ctx),
    variables: () => variableTable(ctx),
    variants: () => variantSection(ctx),
    kpi: () => appendixKpi(ctx),
    points: () => appendixPoints(ctx),
    protocols: () => appendixProtocols(ctx),
    commands: () => appendixCommands(ctx),
    resources: () => appendixResources(ctx),
    graph: () => appendixGraph(ctx),
  };

  // The chapters in the document's order, the empty ones left out — the same list, from the
  // same place, that the Word file prints. The last issue, when it has been read, is what the
  // draft's column of the revision matrix is compared with.
  const lastFrozen = lastIssuedDocument(history);
  const printed = printedChapters(doc, history, lastFrozen);
  const matrixChapter = printed.find((c) => c.key === 'matrix') || null;
  content.matrix = () => matrixTable(ctx, revisionMatrix(doc, history, lastFrozen));
  for (const c of printed) {
    if (c.key === 'stages' || c.key === 'setups') {
      body.appendChild(stageChapter(ctx, chapter, chapters, c, {
        stages: c.key === 'stages' ? testStages(doc) : setupStages(doc), hint: stageHints[c.key],
      }));
    } else if (c.kind === 'chapter') {
      body.appendChild(chapter(c, content[c.key]()));
    } else {
      // The appendices keep their ids by key too; a landscape one says so for the print.
      const id = 'app-' + c.key;
      chapters.push({ number: c.label, title: c.title, id, level: 1 });
      body.appendChild(h('section', { class: ['doc-chapter', 'doc-chapter-major', 'doc-appendix', c.landscape && 'doc-landscape'], id },
        h('h2', { class: 'doc-h2' }, `${c.label} — ${c.title}`), content[c.key]()));
    }
  }

  return h('div', { class: 'document' },
    runningHeader(doc, assets),
    runningFooter(doc),
    cover(doc, assets, options.variant),
    h('section', { class: 'doc-chapter doc-front', id: 'chap-changes' },
      h('h2', { class: 'doc-h2' }, 'Revision history'),
      changeTable(doc, history),
      // The record says why; the matrix says what, line by line — and the reader of the
      // record is told where, because the appendix is the last thing in the document.
      matrixChapter
        ? h('p', { class: 'doc-hint matrix-pointer' }, 'What each revision changed, line by line, is in ',
            h('a', { class: 'ref', href: '#app-matrix' }, `${matrixChapter.label} — ${matrixChapter.title}`), '.')
        : null),
    h('section', { class: 'doc-chapter', id: 'chap-contents' },
      h('h2', { class: 'doc-h2' }, 'Contents'),
      contents(chapters)),
    body);
}

/** A chapter holding stages, one sub-section per stage. */
function stageChapter(ctx, chapter, chapters, entry, { stages, hint }) {
  const section = chapter(entry, h('p', { class: 'doc-hint' }, hint));
  section.classList.add('doc-chapter-major');
  stages.forEach((stage, i) => {
    const sub = `${entry.label}.${i + 1}`;
    // The contents carry the code as well: a reader looking for STG-04 should find it here
    // rather than having to walk the chapter to see which name it wears.
    chapters.push({
      number: sub,
      title: `${codeOf(ctx.codes, stage.id)} ${stage.name || '(unnamed)'}`.trim(),
      id: 'ref-' + stage.id,
      level: 2,
    });
    section.appendChild(h('section', { class: 'doc-sub', id: 'ref-' + stage.id },
      h('h3', { class: 'doc-h3' }, `${sub} `, presenceMark(ctx, stage.id, defRef(ctx, stage.id)),
        varying(ctx, stage.id, 'name', ` — ${stage.name || '(unnamed)'}`)),
      stageBlock(ctx, stage)));
  });
  return section;
}

// ---- elements repeated on every page -----------------------------------------

function runningHeader(doc, assets) {
  const hd = doc.header || {};
  // The company's logo on the left, beside its name; the mark of the tool on the right, small
  // and grey, where a page carries the name of what typeset it.
  return h('div', { class: 'run-header' },
    hd.logoAssetId ? h('img', { class: 'run-logo', src: assetUrl(assets, hd.logoAssetId), alt: '' }) : null,
    h('div', { class: 'run-text' },
      h('div', { class: 'run-company' }, hd.company || ''),
      h('div', { class: 'run-title' }, [hd.title, hd.product].filter(Boolean).join(' — '))),
    h('img', { class: 'run-mark', src: DEDALO_MARK, alt: APP_NAME, title: `Written with ${APP_NAME}` }));
}

function runningFooter(doc) {
  const hd = doc.header || {};
  const r = doc.revision || {};
  // Three parts, each with a job: what the document is, how it must be treated, and — in the
  // margin box next to this one — where the reader is.
  return h('div', { class: 'run-footer' },
    h('span', { class: 'run-doc' },
      hd.documentCode ? h('span', { class: 'run-code' }, hd.documentCode) : null,
      [r.number ? `Rev. ${r.number}` : '', formatDate(r.date)].filter(Boolean)
        .map((t) => ' · ' + t).join('')),
    h('span', { class: 'run-conf' }, hd.confidentiality || ''));
}

// ---- cover -------------------------------------------------------------------

function cover(doc, assets, variant) {
  const hd = doc.header || {};
  const r = doc.revision || {};
  const row = (label, value) => h('tr', {}, h('th', {}, label), h('td', {}, value || '—'));
  return h('section', { class: 'doc-cover' },
    hd.logoAssetId ? h('img', { class: 'cover-logo', src: assetUrl(assets, hd.logoAssetId), alt: '' }) : null,
    h('div', { class: 'cover-company' }, hd.company || ''),
    h('h1', { class: 'cover-title' }, hd.title || 'Test specification'),
    h('div', { class: 'cover-product' }, [hd.product, hd.project].filter(Boolean).join(' · ')),
    variant ? h('div', { class: 'cover-variant' }, `Variant: ${variant.name || ''}`) : null,
    h('table', { class: 'doc-table cover-data' },
      h('tbody', {},
        row('Document code', hd.documentCode),
        row('Revision', [r.number, STATUS_LABEL[r.status] || r.status].filter(Boolean).join(' — ')),
        row('Date', formatDate(r.date)),
        row('Confidentiality', hd.confidentiality))),
    ...signatureTables(hd.signatories),
    // The disclaimer closes the cover, where whoever receives the document reads it first.
    hd.disclaimer ? h('div', { class: 'cover-disclaimer' }, paragraphs(hd.disclaimer)) : null,
    // The tool's logo closes the cover, centred and large enough to be read as a logo, under
    // the two words that say what it is doing there.
    h('div', { class: 'cover-mark' }, h('div', { class: 'cover-mark-label' }, 'Powered by'), h('img', { src: DEDALO_LOGO, alt: APP_NAME })));
}

/**
 * The signature table, one column per signatory. Beyond four the columns would be too narrow
 * to sign in, so the list is cut into tables of four, one under the other.
 */
function signatureTables(signatories) {
  const list = (signatories || []).filter(Boolean);
  if (!list.length) return [];
  const tables = [];
  for (let i = 0; i < list.length; i += 4) {
    const chunk = list.slice(i, i + 4);
    tables.push(h('table', { class: 'doc-table cover-signatures' },
      h('thead', {}, h('tr', {}, ...chunk.map((s) => h('th', {}, s.role || '')))),
      h('tbody', {},
        h('tr', {}, ...chunk.map((s) => h('td', {}, s.name || ''))),
        h('tr', { class: 'signature-row' }, ...chunk.map(() => h('td', {}, 'Signature'))))));
  }
  return tables;
}

// ---- front matter ------------------------------------------------------------

function changeTable(doc, history) {
  // `data-rev` is what lets the viewer put a selector in this table without the printed
  // document ever knowing about it: an attribute costs nothing on paper.
  const rows = changeRecord(doc, history).map((r) => h('tr', {
    class: 'rev-row', dataset: { rev: r.issued ? r.number : '', draft: r.issued ? '' : '1' },
  },
    h('td', {}, r.number || '—'),
    h('td', {}, formatDate(r.date)),
    h('td', {}, r.author || '—'),
    h('td', {}, r.reason || '—'),
    h('td', {}, STATUS_LABEL[r.status] || r.status)));
  return h('table', { class: 'doc-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Rev.'), h('th', {}, 'Date'), h('th', {}, 'Author'), h('th', {}, 'Reason'), h('th', {}, 'Status'))),
    h('tbody', {}, ...rows));
}

const contents = (chapters) =>
  h('ul', { class: 'doc-toc' }, ...chapters.map((c) =>
    h('li', { class: 'toc-item toc-l' + c.level },
      h('a', { href: '#' + c.id }, h('span', { class: 'toc-num' }, c.number), h('span', { class: 'toc-title' }, c.title)))));

// ---- chapters ----------------------------------------------------------------

const paragraphs = (value) =>
  h('div', {}, ...String(value || '').split(/\n{2,}/).filter(Boolean)
    .map((p) => h('p', {}, ...p.split('\n').map((line, i) => [i ? h('br', {}) : null, line]).flat().filter(Boolean))));

/**
 * The revision matrix: one column per revision that changed something, one row per thing
 * changed, grouped by chapter, the cell saying what that revision did to it. The row label is
 * the readable place of the change; the cell is coloured by kind, as the comparison tool is.
 */
// Under the number of the working copy's column: «draft» while it is one; an issued document
// edited without a draft has a column too, and it says so rather than repeat the date.
const columnDate = (c) => (c.draft ? (c.status === 'draft' ? 'draft' : 'changed since issue') : formatDate(c.date));

function matrixTable(ctx, { columns, groups }) {
  const head = h('tr', {},
    h('th', { class: 'matrix-where' }, 'What changed'),
    ...columns.map((c) => h('th', { class: ['matrix-col', c.draft && 'matrix-col-draft'] },
      `Rev. ${c.number || '—'}`, h('div', { class: 'matrix-col-date' }, columnDate(c)))));
  // The row names its element by code, with the card every code has, when the element is
  // still in the document; what was removed is named in words, there being nothing to open.
  const rowLabel = (r) => {
    const code = r.id ? codeOf(ctx.codes, r.id) : '';
    if (!code) return r.where;
    const rest = r.where.slice(r.where.lastIndexOf('»') + 1).replace(/^\s*›\s*/, '');
    // A variable's code is its name: printing the name after it would say it twice.
    const named = code.startsWith('$')
      ? h('a', { class: 'ref', href: '#ref-' + r.id, 'data-ref': r.id }, h('span', { class: 'ref-code' }, code))
      : cardRef(ctx, r.id, 30);
    return h('span', {}, named, rest ? h('span', { class: 'muted' }, ` › ${rest}`) : null);
  };
  const body = groups.flatMap((g) => [
    h('tr', { class: 'matrix-chapter' }, h('th', { colspan: columns.length + 1 }, g.chapter)),
    ...g.rows.map((r) => h('tr', {},
      h('td', { class: 'matrix-where' }, rowLabel(r)),
      ...columns.map((c) => {
        const change = r.cells.get(c.number);
        if (!change) return h('td', { class: 'matrix-empty' });
        const { tag, text } = cellText(change);
        // What the card under a resting pointer needs, on the cell itself: the two values in
        // full, and which two versions they belong to.
        return h('td', {
          class: ['matrix-cell', 'matrix-' + tag],
          dataset: { changeRev: c.number, changePrev: c.previous, changeTag: tag, changeWhere: r.where, changeBefore: change.before || '', changeAfter: change.after || '', changeDraft: c.draft ? '1' : '' },
        }, h('span', { class: ['tag', 'tag-' + tag] }, tag), ' ', text);
      }))),
  ]);
  return h('div', {},
    h('p', { class: 'doc-hint' }, 'One column per revision that changed something, one row per thing changed. A cell says what that revision did to it; a long text is not quoted but counted, and the comparison tool shows it in full. The first issue records nothing: everything was new in it.'),
    h('table', { class: 'doc-table doc-table-matrix' }, h('thead', {}, head), h('tbody', {}, ...body)));
}

/** The glossary, one line per term, in alphabetical order whatever order they were typed in. */
function glossaryTable(ctx) {
  const entries = sortedGlossary(ctx.doc).filter((g) => String(g.term || '').trim());
  return h('table', { class: 'doc-table doc-table-glossary' },
    h('thead', {}, h('tr', {}, h('th', { class: 'col-term' }, 'Term'), h('th', {}, 'Meaning'))),
    h('tbody', {}, ...entries.map((g) => h('tr', { id: 'ref-' + g.id },
      h('td', { class: 'col-term' }, varying(ctx, g.id, 'term', g.term)),
      h('td', {}, varying(ctx, g.id, 'meaning', g.meaning || ''))))));
}

function referenceTable(ctx) {
  const { doc } = ctx;
  const refs = doc.references || [];
  if (!refs.length) return h('p', { class: 'doc-empty' }, 'No external references.');
  return h('table', { class: 'doc-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Code'), h('th', {}, 'Reference'), h('th', {}, 'Title'), h('th', {}, 'Revision'), h('th', {}, 'Notes'))),
    h('tbody', {}, ...refs.map((r) => h('tr', { id: 'ref-' + r.id },
      h('td', { class: 'code' }, defRef(ctx, r.id)), h('td', {}, r.code || ''), h('td', {}, r.title || ''),
      h('td', {}, r.revision || ''), h('td', {}, r.notes || '')))));
}

function variableTable(ctx) {
  const { doc } = ctx;
  const vars = doc.variables || [];
  if (!vars.length) return h('p', { class: 'doc-empty' }, 'No global variables.');
  return h('table', { class: 'doc-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Type'), h('th', {}, 'Value'), h('th', {}, 'Description'))),
    h('tbody', {}, ...vars.map((v) => h('tr', { id: 'ref-' + v.id },
      h('td', { class: 'code' }, presenceMark(ctx, v.id, defRef(ctx, v.id))),
      h('td', {}, VARIABLE_TYPE_LABEL[v.type] || v.type),
      // The value of a variable is the first thing a variant redefines, and the mark here is
      // what tells the reader that the number three pages down is not the same for everyone.
      h('td', {}, varying(ctx, v.id, 'value', variableText(v))),
      h('td', {}, v.description || '')))));
}

function variantSection(ctx) {
  // The matrix is a statement about the base document and every variant of it, so it is read
  // from the base even while a variant is on screen. Built from the resolved document it
  // would quietly drop the rows that variant removes — the very rows one is looking for.
  const doc = ctx.base || ctx.doc;
  const variants = doc.variants || [];
  const stages = doc.stages || [];
  const resolved = new Map(variants.map((v) => [v.id, applyOverlay(doc, v).doc]));
  const shownVariant = ctx.variant ? ctx.variant.id : null;

  const matrix = h('table', { class: 'doc-table' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Stage'),
      ...variants.map((v) => h('th', { class: v.id === shownVariant ? 'variant-shown' : null }, v.name || '')))),
    h('tbody', {}, ...stages.map((stage) => h('tr', {},
      h('td', {}, cardRef(ctx, stage.id, 48)),
      ...variants.map((v) => {
        const runs = (resolved.get(v.id).stages || []).some((x) => x.id === stage.id);
        return h('td', { class: ['center', v.id === shownVariant && 'variant-shown', !runs && 'variant-out'] },
          runs ? '✓' : '—');
      })))));

  const details = variants.map((v) => h('div', { class: 'doc-variant', id: 'ref-' + v.id },
    h('h3', { class: 'doc-h3' }, defRef(ctx, v.id), ` — ${v.name || '(unnamed)'}`,
      v.id === shownVariant ? h('span', { class: 'kpi-badge' }, 'shown') : null),
    v.description ? h('p', {}, v.description) : null,
    (v.overlay || []).length
      ? h('table', { class: 'doc-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Action'), h('th', {}, 'Where'), h('th', {}, 'Value'))),
          h('tbody', {}, ...v.overlay.map((op) => {
            const d = describeOperation(doc, op);
            return h('tr', {}, h('td', {}, d.action), h('td', {}, d.where), h('td', {}, d.value));
          })))
      : h('p', { class: 'doc-empty' }, 'No difference from the base document.')));

  return h('div', {},
    // What the reader is holding, said once and plainly.
    ctx.variant
      ? h('p', { class: 'doc-meta' },
          h('span', { class: 'meta-label' }, 'This copy: '),
          `variant ${ctx.variant.name || ''} — the stages marked ✓ in its column are the ones it runs, `,
          'and the codes are those of the base document, so a gap means a stage this variant leaves out.')
      : null,
    matrix, ...details);
}

// ---- stages, tests, steps ----------------------------------------------------

function stageBlock(ctx, stage) {
  const { codes, calls } = ctx;
  // Every code in the meta line is a link: to the card where there is one, to the editor
  // otherwise. A prerequisite one cannot follow is a prerequisite one does not check.
  const held = (stage.heldStimuli || []).flatMap((hs, i) => {
    const step = findStep(stage, hs.stepId);
    const entry = step
      ? [editRef(ctx, step.id, 40), hs.note ? ` (${hs.note})` : null]
      : ['⟨step not found⟩'];
    return i ? ['; ', ...entry] : entry;
  }).filter((x) => x != null);

  // One compact meta line instead of a table: same information, a fraction of the space.
  const items = [];
  if (isSetup(stage)) {
    const callers = calls.get(stage.id) || [];
    items.push(metaItem('Kind', 'setup stage — runs only when a step calls it'));
    items.push(metaItem('Called by', callers.length
      ? refList(ctx, callers.map((c) => c.stepId), (c, id) => editRef(c, id, 34), '; ')
      : 'nobody yet'));
  } else {
    const e = stage.exclusions || {};
    const parallel = e.mode === EXCLUSION_MODE.ALL
      ? ['no stage in parallel']
      : e.mode === EXCLUSION_MODE.LIST
        ? ['not with ', ...refList(ctx, e.stageIds, cardRef)]
        : ['unrestricted'];
    items.push(metaItem('Prerequisites', refList(ctx, stage.prerequisites, cardRef, ', ', 'none')));
    items.push(metaItem('Parallel', parallel));
  }
  items.push(metaItem('Held on exit', held.length ? held : ['none, every stimulus is removed']));

  return h('div', {},
    stage.description ? varying(ctx, stage.id, 'description', ...[].concat(paragraphs(stage.description))) : null,
    h('p', { class: ['doc-meta', isSetup(stage) && 'doc-meta-setup'] }, ...items),
    ...(stage.tests || []).map((test) => h('div', { class: 'doc-test', id: 'ref-' + test.id },
      h('h4', { class: 'doc-h4' }, presenceMark(ctx, test.id, defRef(ctx, test.id)),
        varying(ctx, test.id, 'name', ` — ${test.name || '(unnamed test)'}`),
        test.kpi ? h('span', { class: 'kpi-badge' }, 'KPI') : null,
        test.purpose ? h('span', { class: 'doc-purpose' }, varying(ctx, test.id, 'purpose', ' · ' + test.purpose)) : null),
      stepTable(ctx, test))));
}

const metaItem = (label, value) =>
  h('span', { class: 'meta-item' }, h('span', { class: 'meta-label' }, label + ': '), ...[].concat(value));

function stepTable(ctx, test) {
  const steps = test.steps || [];
  if (!steps.length) return h('p', { class: 'doc-empty' }, 'No steps.');
  return h('table', { class: 'doc-table doc-table-steps' }, stepTableHead(), h('tbody', {}, ...steps.map((s) => stepRow(ctx, s))));
}

const stepTableHead = () => h('thead', {}, h('tr', {},
  h('th', { class: 'col-code' }, 'Step'),
  h('th', {}, 'Action and detail'),
  h('th', { class: 'col-expected' }, 'Acceptance')));

function stepRow(ctx, s) {
  // No column for the wait: most steps have none, and a column of dashes costs every page a
  // strip of width. Where there is one it says so on its own line, like the other actions.
  // The criterion has a column of its own: it is what the operator compares against, and
  // reading it down the page beats hunting for it at the end of a sentence.
  // A table step carries its criteria in its own cells, one per row: it takes the whole
  // width of the row. Its code and kind stay at the left, where every other step has them,
  // with the description beside them on the same line — no row of their own above the table.
  const expected = s.measurement ? expectedText(s.measurement, ctx.variables, decodingUnit(ctx, s.measurement)) : '';
  if (s.type === STEP_TYPE.TABLE) {
    return h('tr', { id: 'ref-' + s.id, class: 'row-table-step' },
      h('td', { colspan: 3, class: 'col-wide' },
        h('div', { class: 'table-step-head' },
          h('div', { class: 'table-step-code' },
            h('div', { class: 'code' }, presenceMark(ctx, s.id, defRef(ctx, s.id))),
            h('div', { class: 'step-kind' }, STEP_TYPE_SHORT[s.type] || '')),
          h('div', { class: 'table-step-text' },
            h('div', { class: 'step-descr' }, varying(ctx, s.id, 'description', s.description || '')),
            // The wait right under the description, where every other step has it: beside
            // the code block, in the height the two lines of the code block have anyway.
            waitLine(ctx, s))),
        tableBlock(ctx, s),
        s.note ? h('div', { class: 'step-note' }, varying(ctx, s.id, 'note', s.note)) : null,
        stepFigure(ctx, s)));
  }
  return h('tr', { id: 'ref-' + s.id },
    h('td', { class: 'col-code' },
      h('div', { class: 'code' }, presenceMark(ctx, s.id, defRef(ctx, s.id))),
      h('div', { class: 'step-kind' }, STEP_TYPE_SHORT[s.type] || '')),
    h('td', {},
      h('div', { class: 'step-descr' }, varying(ctx, s.id, 'description', s.description || '')),
      stepDetail(ctx, s),
      s.note ? h('div', { class: 'step-note' }, varying(ctx, s.id, 'note', s.note)) : null),
    h('td', { class: 'col-expected' },
      expected ? expectedCell(ctx, s.measurement, expected, s.id) : h('span', { class: 'muted' }, '—'),
      stepFigure(ctx, s)));
}

/** The unit a command's decoding gives, for a criterion over that command that states none. */
export function decodingUnit(ctx, block) {
  if (!block || !block.commandId) return '';
  const command = (ctx.doc.commands || []).find((c) => c.id === block.commandId);
  return commandDecoding(command).unit || '';
}

/**
 * The figure a step points at, small, under its acceptance column: the code says which
 * picture, and on screen a click opens it full size with its markers, as in the appendix.
 * No crop and no area — the step says «see this picture», the appendix says where on it.
 */
function stepFigure(ctx, step) {
  if (!step.imageId) return null;
  const image = (ctx.doc.images || []).find((i) => i.id === step.imageId);
  if (!image) return h('div', { class: 'step-figure step-figure-missing' }, '⟨missing image⟩');
  const src = assetUrl(ctx.assets, image.assetId);
  return h('figure', { class: 'step-figure', dataset: { figure: image.id } },
    src ? h('img', { src, alt: image.name || '' }) : null,
    h('figcaption', {}, varying(ctx, step.id, 'imageId', cardRef(ctx, image.id, 24))));
}

/** The wait, when there is one: the same shape as APPLY and MEASURE, and nothing when not. */
function waitLine(ctx, step) {
  const w = step.wait || {};
  const text = valueText(w.value, ctx.variables, w.unit);
  if (!text) return null;
  return h('div', { class: 'step-line step-line-wait' },
    h('span', { class: 'step-tag step-tag-wait' }, 'WAIT'), ' ',
    varying(ctx, step.id, 'wait', valueRef(ctx, w.value, text)));
}

/**
 * The very row the document prints, for a single step. The step editor keeps one under the
 * fields: writing a step is writing a sentence somebody reads at the bench, and guessing how
 * the pieces come together is what makes those sentences awkward.
 */
export function renderStepPreview(doc, step, options = {}) {
  const ctx = {
    doc,
    assets: options.assets || {},
    codes: computeCodes(doc, options.base),
    index: mergedIndex(doc, options.base),
    variables: variableIndex(doc),
    calls: callMap(doc),
    variance: varianceIndex(options.base || doc),
    interfaceOfCommand: commandInterfaces(doc),
    directEditing: directEditingAllowed(doc),
  };
  return h('div', { class: 'document document-preview-inline' },
    h('table', { class: 'doc-table doc-table-steps' }, stepTableHead(), h('tbody', {}, stepRow(ctx, step))));
}

function stepDetail(ctx, step) {
  const { codes, index } = ctx;
  if (step.type === STEP_TYPE.STAGE_CALL) {
    return h('div', { class: 'step-line step-line-call' },
      h('span', { class: 'step-tag step-tag-call' }, 'RUN'), ' ',
      varying(ctx, step.id, 'calledStageId', ref(codes, index, step.calledStageId)),
      h('span', { class: 'muted' }, ' — the setup stage runs in full, then the sequence continues here'));
  }
  // A table step draws its own row (see `stepRow`): the wait beside the code, then the table.
  if (step.type === STEP_TYPE.TABLE) return tableBlock(ctx, step);
  // Apply, then wait, then measure: the order the operator works in. A wait with nothing
  // applied still comes before the measurement, because that is when it is spent.
  const lines = [];
  if (step.stimulus) lines.push(blockLine(ctx, step, 'stimulus', step.stimulus));
  lines.push(waitLine(ctx, step));
  if (step.measurement) lines.push(blockLine(ctx, step, 'measurement', step.measurement));
  return h('div', {}, ...lines.filter(Boolean));
}

/**
 * The matrix of a table step: one column per definition, headed by what the column applies
 * or reads and what it does it with, one row per combination, the label first. A stimulus
 * cell is the value applied; a measurement cell is the criterion, in the notation and with
 * the plate the acceptance column uses, so the two read alike wherever they are.
 */
function tableBlock(ctx, step) {
  const { codes, index, variables, interfaceOfCommand } = ctx;
  const table = step.table || {};
  const columns = table.columns || [];
  const rows = table.rows || [];
  if (!columns.length || !rows.length) return h('p', { class: 'doc-empty' }, 'The table has no rows or no columns yet.');

  const head = columns.map((c) => {
    const kind = c.kind === TABLE_COLUMN_KIND.STIMULUS ? 'stimulus' : 'measurement';
    const command = !!c.commandId;
    const tone = command ? (kind === 'stimulus' ? 'set' : 'get') : (kind === 'stimulus' ? 'stim' : 'meas');
    const points = command ? [] : (c.pointIds || []).map((id) => ref(codes, index, id));
    const resources = command ? [] : blockResources(c, interfaceOfCommand).map((id) => ref(codes, index, id));
    return h('th', { class: 'grid-col' },
      h('div', {}, h('span', { class: ['step-tag', 'step-tag-' + tone] }, blockTag(kind, c)), ' ',
        varying(ctx, c.id, 'name', c.name || '(unnamed column)'), c.unit ? h('span', { class: 'muted' }, ` [${c.unit}]`) : null),
      resources.length || command || points.length
        ? h('div', { class: 'grid-col-refs' },
            ...resources.flatMap((r) => [r, ' ']),
            command ? h('span', { class: 'sw' }, ref(codes, index, c.commandId)) : null,
            points.length ? h('span', { class: 'step-at' }, h('span', { class: 'step-at-inner' }, h('span', { class: 'at-sign' }, '@'), ' ', ...interleave(points, ', '))) : null)
        : null);
  });

  const cellOf = (row, c) => {
    const cell = (row.cells || []).find((x) => x.columnId === c.id);
    if (!cell) return h('td', { class: 'grid-cell muted' }, '—');
    if (c.kind === TABLE_COLUMN_KIND.STIMULUS) {
      const text = cellValueText(cell.value, variables, c.unit);
      return h('td', { class: 'grid-cell' }, varying(ctx, cell.id, 'value', text ? valueRef(ctx, cell.value, text) : h('span', { class: 'muted' }, '—')));
    }
    const measurement = { expected: cell.expected };
    const text = expectedText(measurement, variables, decodingUnit(ctx, c));
    // The plate beside the value rather than under it: the rows of a table are many and
    // short, and a second line in every cell doubled the height of the whole thing.
    return h('td', { class: 'grid-cell grid-cell-expected' },
      text
        ? varying(ctx, cell.id, 'expected', h('span', { class: 'expected-cell expected-inline' },
            h('strong', {}, ...expectedNodes(ctx, measurement, text)), ' ',
            h('span', { class: 'kind-tag kind-tag-inline' }, expectedBadge(cell.expected))))
        : h('span', { class: 'muted' }, '—'));
  };

  return h('div', { class: 'step-grid' },
    h('table', { class: 'doc-table doc-table-grid' },
      h('thead', {}, h('tr', {}, h('th', { class: 'grid-label' }, ''), ...head)),
      h('tbody', {}, ...rows.map((row) => h('tr', { id: 'ref-' + row.id },
        h('td', { class: 'grid-label' }, varying(ctx, row.id, 'label', row.label || '')),
        ...columns.map((c) => cellOf(row, c)))))));
}

/**
 * One line for the stimulus, one for the measurement, each opening with its own label:
 * what is applied to the unit and what is read back from it must never be mistaken.
 */
function blockLine(ctx, step, kind, block) {
  const { codes, index, variables, interfaceOfCommand } = ctx;
  const isStimulus = kind === 'stimulus';
  const command = !!block.commandId;
  // SET and GET rather than APPLY and MEASURE: what travels over a bus is a different act
  // from what touches a pad, and it now looks like one.
  const tag = blockTag(kind, block);
  const tone = command ? (isStimulus ? 'set' : 'get') : (isStimulus ? 'stim' : 'meas');

  // The parameters of a command are its arguments, and they take its colour.
  const parameters = (block.parameters || []).filter((p) => p.name)
    .map((p) => h('span', { class: ['step-param', 'param-' + tone] },
      h('span', { class: 'param-name' }, p.name), ' ',
      varying(ctx, p.id, 'value', valueRef(ctx, p.value, valueText(p.value, variables, p.unit) || '—'))));

  // A command carries its own instrument and its own contacts, through the interface it
  // speaks: the step neither states them nor repeats them.
  const points = command ? [] : (block.pointIds || []).map((id) => ref(codes, index, id));
  const resources = command ? [] : blockResources(block, interfaceOfCommand).map((id) => ref(codes, index, id));

  // Computed: the formula as written, and the readings it is computed from, as step refs.
  if (kind === 'measurement' && block.computed) {
    return h('div', { class: 'step-line step-line-computed' },
      h('span', { class: 'step-tag step-tag-computed' }, 'COMPUTED'), ' ',
      varying(ctx, step.id, 'measurement.description', block.description || ''),
      block.computed.formula ? h('span', { class: 'step-formula' }, ' = ', varying(ctx, step.id, 'measurement.computed.formula', block.computed.formula)) : null,
      (block.computed.inputStepIds || []).length
        ? h('span', { class: 'muted' }, ' from ', ...interleave((block.computed.inputStepIds || []).map((id) => editRef(ctx, id, 40)), ', '))
        : null);
  }
  return h('div', { class: ['step-line', 'step-line-' + tone] },
    h('span', { class: ['step-tag', 'step-tag-' + tone] }, tag), ' ',
    varying(ctx, step.id, kind + '.description', block.description || ''),
    ...resources.flatMap((r) => [' · ', r]),
    command ? h('span', { class: 'sw' }, ' · ', ref(codes, index, block.commandId)) : null,
    ...parameters.flatMap((p) => [' ', p]),
    points.length
      ? h('span', { class: 'step-at' },
          h('span', { class: 'step-at-inner' }, h('span', { class: 'at-sign' }, '@'), ' ', ...interleave(points, ', ')))
      : null);
}

/**
 * The criterion, then what kind of answer it judges, then — only when it is not the default —
 * that case does not matter. The mark is grey and set under the value on purpose: the page
 * already carries colour where colour means something, and a fourth palette would say nothing.
 */
export function expectedCell(ctx, measurement, text, stepId) {
  const e = measurement.expected || {};
  const note = expectedCaseNote(e);
  return h('span', { class: 'expected-cell' },
    // The mark goes on the criterion itself: the plate that says «123» is the same whichever
    // product is on the bench, and painting it too would only make the row look busy.
    varying(ctx, stepId, 'measurement.expected', h('strong', {}, ...expectedNodes(ctx, measurement, text))),
    h('span', { class: 'kind-tag' }, expectedBadge(e)),
    note ? h('span', { class: 'kind-note' }, note) : null);
}

/**
 * The acceptance criterion with its variables clickable. The text is the one the printer
 * gets; only the parts that come from a variable become links.
 */
function expectedNodes(ctx, block, text) {
  const e = ((block || {}).measurement || block || {}).expected || {};
  const kind = expectedKind(e);
  if (kind === 'boolean') return [text];
  // A text criterion carries one value, and it too can come from a variable.
  const bound = (kind === 'string' ? [expectedTextRef(e)] : [e.nominal, e.tolerance, e.min, e.max])
    .filter((v) => v && v.mode === 'variable');
  if (!bound.length) return [text];
  const names = new Map();
  for (const v of bound) {
    const variable = ctx.index.get(v.variableId);
    if (variable && variable.name) names.set(`(${variable.name})`, v);
  }
  // The variable shows in the text as «(Name)»: that is the piece worth making clickable.
  const parts = String(text).split(/(\([^()]*\))/g).filter((s) => s !== '');
  return parts.map((part) => (names.has(part) ? valueRef(ctx, names.get(part), part) : part));
}


