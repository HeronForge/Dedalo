// Document appendices: application points, commands and interfaces,
// test resources with the concurrent channels, stage graph.
import { h } from '../ui/dom.js';
import { commandDecoding } from '../model/schema.js';
import { assetUrl } from '../io/images.js';
import { resourceSummary } from '../model/resources.js';
import { codeOf, labelOf, markerLabel } from '../model/codes.js';
import { expectedText } from '../model/variables.js';
import { expectedCell, decodingUnit } from './document.js';
import { editRef, cardRef, refList, defRef } from './refs.js';
import { stageGraph, graphLegend } from './graph.js';

const table = (headers, rows) =>
  h('table', { class: 'doc-table' },
    h('thead', {}, h('tr', {}, ...headers.map((t) => h('th', {}, t)))),
    h('tbody', {}, ...rows));

const characteristicsText = (list) =>
  (list || []).filter((c) => c.name || c.value).map((c) => `${c.name} ${c.value}${c.unit ? ' ' + c.unit : ''}`).join(' · ');

/** Appendix of the application points: summary table plus the images with the markers. */
export function appendixPoints(ctx) {
  const { doc, assets, codes, index } = ctx;
  const points = doc.points || [];
  const rows = points.map((p) => h('tr', { id: 'ref-' + p.id },
    h('td', { class: 'code col-code-nowrap' }, defRef(ctx, p.id)),
    h('td', {}, p.name || ''),
    h('td', {}, [p.connector, p.pin && `pin ${p.pin}`].filter(Boolean).join(' ')),
    h('td', {}, p.signal || ''),
    h('td', {}, p.contactType || ''),
    h('td', {}, characteristicsText(p.characteristics)),
    h('td', {}, ...refList(ctx, (p.markers || []).map((m) => m.imageId).filter((id) => isImage(doc, id)),
      (c, id) => editRef(c, id, 18), ', ', '—')),
    h('td', {}, p.notes || '')));

  const figures = (doc.images || []).map((img) => {
    const markers = [];
    for (const p of points) for (const m of p.markers || []) if (m.imageId === img.id) markers.push({ p, m });
    return h('figure', { class: 'doc-figure', id: 'ref-' + img.id },
      h('div', { class: 'doc-figure-canvas' },
        h('img', { src: assetUrl(assets, img.assetId), alt: img.name || '' }),
        // Short labels on the image: the number of the point, or the TP name when the point
        // is a test point and already has one printed on the board.
        ...markers.map(({ p, m }) => {
          const label = markerLabel(p, codeOf(codes, p.id));
          return h('span', {
            class: ['doc-marker', label.length > 2 && 'doc-marker-wide'],
            title: labelOf(codes, index, p.id, 40),
            style: { left: m.x * 100 + '%', top: m.y * 100 + '%' },
          }, label);
        })),
      h('figcaption', {}, defRef(ctx, img.id), ` ${img.name || ''}${img.caption ? ' — ' + img.caption : ''}`));
  });

  return h('div', {},
    points.length
      ? table(['Code', 'Name', 'Connector', 'Signal', 'Contact', 'Connection characteristics', 'Fig.', 'Notes'], rows)
      : h('p', { class: 'doc-empty' }, 'No application point defined.'),
    ...figures);
}

const isImage = (doc, id) => (doc.images || []).some((x) => x.id === id);

/**
 * The grammar of the messages, once. A command names its protocol and stays a line; whoever
 * has to build the frame reads the rules here instead of finding them scattered over fifty
 * command rows, or worse, not finding them at all.
 */
export function appendixProtocols(ctx) {
  const { doc, codes } = ctx;
  const protocols = doc.protocols || [];
  if (!protocols.length) return h('p', { class: 'doc-empty' }, 'No protocol described.');

  return h('div', {}, ...protocols.map((p) => h('div', { class: 'doc-protocol', id: 'ref-' + p.id },
    h('h3', { class: 'doc-h3' }, defRef(ctx, p.id), ` — ${p.name || '(unnamed)'}`,
      p.family ? h('span', { class: 'doc-purpose' }, ' · ' + p.family) : null),
    p.description ? h('p', {}, p.description) : null,
    h('table', { class: 'doc-table' }, h('tbody', {},
      p.referenceId ? h('tr', {}, h('th', { class: 'row-head' }, 'Defined in'), h('td', {}, cardRef(ctx, p.referenceId, 40))) : null,
      p.requestFormat ? h('tr', {}, h('th', { class: 'row-head' }, 'Request'), h('td', {}, ...multiline(p.requestFormat))) : null,
      p.responseFormat ? h('tr', {}, h('th', { class: 'row-head' }, 'Response'), h('td', {}, ...multiline(p.responseFormat))) : null,
      (p.rules || []).filter((r) => r.name || r.value).length
        ? h('tr', {}, h('th', { class: 'row-head' }, 'Rules'), h('td', {}, ...bulletList(characteristicsList(p.rules))))
        : null,
      p.notes ? h('tr', {}, h('th', { class: 'row-head' }, 'Notes'), h('td', {}, p.notes)) : null,
      // A protocol nobody speaks is worth saying too: it is either dead weight or a gap.
      h('tr', {}, h('th', { class: 'row-head' }, 'Used by'),
        h('td', {}, ...refList(ctx, (doc.commands || []).filter((c) => c.protocolId === p.id).map((c) => c.id),
          (c, id) => cardRef(c, id, 30), ', ', 'no command yet'))))))));
}

/** Appendix of the communication commands and of the interfaces. */
export function appendixCommands(ctx) {
  const { doc, codes, index } = ctx;
  const interfaces = (doc.interfaces || []).map((i) => h('tr', { id: 'ref-' + i.id },
    h('td', { class: 'code' }, defRef(ctx, i.id)),
    h('td', {}, i.name || ''),
    h('td', {}, i.type || ''),
    h('td', {}, characteristicsText(i.parameters)),
    // Where the bus touches the unit: a step that talks over it needs these contacts.
    h('td', {}, ...refList(ctx, i.pointIds, (c, id) => cardRef(c, id, 26))),
    h('td', {}, i.notes || '')));

  const commands = (doc.commands || []).map((c) => h('tr', { id: 'ref-' + c.id },
    h('td', { class: 'code' }, defRef(ctx, c.id)),
    // Where the command is defined, when it is defined in another document: the reader will
    // have to open that one at the bench, and the row says so.
    h('td', {}, c.name || '', c.referenceId ? h('div', { class: 'cmd-defined' }, 'Defined in ', cardRef(ctx, c.referenceId, 30)) : null),
    h('td', {}, c.interfaceId ? editRef(ctx, c.interfaceId, 24) : '—'),
    h('td', {}, c.protocolId ? cardRef(ctx, c.protocolId, 24) : '—'),
    h('td', {}, c.address || ''),
    h('td', {}, multiline(c.requestFormat)),
    h('td', {},
      multiline(c.responseFormat),
      // The refusal belongs next to the answer it replaces, not in a column of its own.
      c.negativeResponse
        ? h('div', { class: 'cmd-negative' }, h('span', { class: 'cmd-negative-tag' }, 'NEG'), ' ', ...multiline(c.negativeResponse))
        : null),
    h('td', {}, c.encoding || '',
      // From the raw answer to the value a step judges, and in which unit.
      commandDecoding(c).formula || commandDecoding(c).unit
        ? h('div', { class: 'cmd-decoding' }, h('span', { class: 'cmd-decoding-tag' }, 'Decoding'), ' ',
            [commandDecoding(c).formula, commandDecoding(c).unit ? `→ ${commandDecoding(c).unit}` : ''].filter(Boolean).join(' '))
        : null),
    h('td', { class: 'col-time' }, c.nominalTime ? `${c.nominalTime} s` : '—'),
    h('td', {}, multiline(c.example))));

  return h('div', {},
    h('h3', { class: 'doc-h3' }, 'Interfaces'),
    interfaces.length
      ? table(['Code', 'Name', 'Type', 'Requirements', 'Connected at', 'Notes'], interfaces)
      : h('p', { class: 'doc-empty' }, 'No interface defined.'),
    h('h3', { class: 'doc-h3' }, 'Commands'),
    commands.length
      ? table(['Code', 'Command', 'Interface', 'Protocol', 'Address', 'Request', 'Response', 'Encoding', 'Time', 'Example'], commands)
      : h('p', { class: 'doc-empty' }, 'No command defined.'));
}

const multiline = (t) => String(t || '').split('\n').map((line, i, a) => [line, i < a.length - 1 ? h('br', {}) : null]).flat().filter(Boolean);

/** Appendix of the resources: required characteristics and concurrent channels. */
export function appendixResources(ctx) {
  const { doc, codes } = ctx;
  const { rows, groups, truncated } = resourceSummary(doc);
  if (!rows.length) return h('p', { class: 'doc-empty' }, 'No resource required.');

  const body = rows.map((r) => h('tr', { id: 'ref-' + r.resource.id },
    h('td', { class: 'code col-code-nowrap' }, defRef(ctx, r.resource.id)),
    h('td', {}, r.resource.name || ''),
    h('td', {}, r.resource.category || ''),
    h('td', {}, ...bulletList(characteristicsList(r.resource.characteristics))),
    h('td', {}, r.usedParameters.join(', ')),
    h('td', {}, pointsCell(r, ctx)),
    h('td', { class: 'center' }, h('strong', {}, String(r.maxChannels)))));

  const parallel = groups.filter((g) => g.length > 1);

  return h('div', {},
    table(['Code', 'Resource', 'Category', 'Required characteristics', 'Parameters used', 'Applied on', 'Max channels'], body),
    h('div', { class: 'doc-note' },
      h('strong', {}, 'How to read the channel count. '),
      'Inside a stage a resource needs one channel per distinct application point it is used on ',
      '(worst case: every connection present on the bench at the same time); a use with no declared point counts as one. ',
      'What a setup stage uses is charged to the test stages that call it. ',
      'A step that speaks through a command also occupies the points its interface is wired to. ',
      'Stimuli held on exit keep occupying their channels in the stages that depend on that stage. ',
      '«Max channels» is the largest sum of channels over all groups of test stages that may run in parallel. ',
      truncated
        ? h('strong', {}, 'The stage graph is too large to enumerate every parallel group: the figures above are the worst case — every stage at once — and not an exact count.')
        : parallel.length
          ? `Parallel groups: ${parallel.map((g) => g.map((id) => codeOf(codes, id) || '?').join(' + ')).join('; ')}.`
          : 'No two stages may run in parallel: the sequence is fully ordered.'));
}

/**
 * Every application point the resource is applied on, with code and name. Numbered, because
 * the count is the point of the column: the reader is sizing a bench.
 */
function pointsCell(row, ctx) {
  const items = row.points.map((id) => cardRef(ctx, id, 34));
  if (!items.length && !row.usesWithoutPoint) return '—';
  return h('div', {},
    items.length ? h('ol', { class: 'cell-list' }, ...items.map((t) => h('li', {}, t))) : null,
    row.usesWithoutPoint
      ? h('div', { class: 'cell-note' }, `${row.usesWithoutPoint} use${row.usesWithoutPoint > 1 ? 's' : ''} with no declared point`)
      : null);
}

const characteristicsList = (list) =>
  (list || []).filter((c) => c.name || c.value).map((c) => `${c.name} ${c.value}${c.unit ? ' ' + c.unit : ''}`);

const bulletList = (items) =>
  [items.length ? h('ul', { class: 'cell-list cell-list-bullets' }, ...items.map((t) => h('li', {}, t))) : '—'];

/**
 * Appendix of the key performance indicators: the tests somebody follows, with what each of
 * them measures and against what. It is a reading of the specification, not a second source:
 * every figure here is the one written in the step.
 */
export function appendixKpi(ctx) {
  const { doc, codes, index, variables } = ctx;
  const rows = [];
  for (const stage of doc.stages || []) {
    for (const test of stage.tests || []) {
      if (!test.kpi) continue;
      const measurements = [];
      for (const step of test.steps || []) {
        if (!step.measurement) continue;
        measurements.push({ step, criterion: expectedText(step.measurement, variables) });
      }
      rows.push({ stage, test, measurements });
    }
  }
  if (!rows.length) return h('p', { class: 'doc-empty' }, 'No test is marked as a key performance indicator.');

  return h('div', {},
    h('p', { class: 'doc-hint' },
      'The tests followed line-side, with the criterion each of them is judged by. ',
      'A test appears here because it carries the KPI flag; the figures are the ones its steps state.'),
    table(['Test', 'Stage', 'What it establishes', 'Measured', 'Acceptance'],
      rows.flatMap(({ stage, test, measurements }) => {
        const span = Math.max(1, measurements.length);
        return (measurements.length ? measurements : [null]).map((m, i) => h('tr', { id: i ? null : 'ref-kpi-' + test.id },
          i ? null : h('td', { class: 'code col-code-nowrap', rowspan: span }, codeOf(codes, test.id)),
          i ? null : h('td', { rowspan: span }, test.name || '(unnamed test)', h('div', { class: 'muted' }, labelOf(codes, index, stage.id, 30))),
          i ? null : h('td', { rowspan: span }, test.purpose || '—'),
          h('td', {}, m ? (m.step.measurement.description || labelOf(codes, index, m.step.id, 24)) : h('em', {}, 'no measurement in this test')),
          h('td', { class: 'col-expected' }, m && m.criterion
            ? expectedCell(ctx, m.step.measurement, m.criterion, m.step.id)
            : '—')));
      })));
}

/** Appendix with the stage dependency graph. */
export function appendixGraph({ doc, codes }) {
  if (!(doc.stages || []).length) return h('p', { class: 'doc-empty' }, 'No stage defined.');
  return h('div', { class: 'doc-graph' },
    stageGraph(doc, { codes }),
    h('ul', { class: 'legend' }, ...graphLegend().map((l) => h('li', {}, h('span', { class: 'legend-seg ' + l.className }), l.text))));
}
