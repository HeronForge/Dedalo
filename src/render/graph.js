// Stage dependency graph, drawn in SVG without any library.
//
// The upper band holds the test stages, in the order their prerequisites impose: solid arrows
// are prerequisites. What a stage may not run alongside is written under its box — «not with
// STG-03, STG-07» — rather than drawn: a dashed line from every stage to every stage it
// excludes crossed the arrows until neither could be read. The lower band holds the setup
// stages, which have no place of their own in the sequence: dotted arrows show which step calls
// them, and the same setup stage can be called from several places.
import { svg } from '../ui/dom.js';
import { levels, mutuallyExcluded, callMap, testStages, setupStages } from '../model/stages.js';
import { EXCLUSION_MODE } from '../model/schema.js';

const W = 172;
const H = 44;
const GAP_X = 26;
const GAP_Y = 64;
const MARGIN = 14;
const BAND_GAP = 46;

export function stageGraph(doc, options = {}) {
  const all = doc.stages || [];
  if (!all.length) return svg('svg', { width: 10, height: 10 });

  const codes = options.codes;
  const tests = testStages(doc);
  const setups = setupStages(doc);
  const rows = levels(doc);
  const position = new Map();

  const rowWidth = (n) => n * (W + GAP_X) - GAP_X;
  const widest = Math.max(
    rows.length ? Math.max(...rows.map((r) => rowWidth(r.length))) : 0,
    setups.length ? rowWidth(Math.min(setups.length, 4)) : 0,
    W,
  );

  rows.forEach((row, r) => {
    const offset = (widest - rowWidth(row.length)) / 2;
    row.forEach((id, c) => {
      position.set(id, { x: MARGIN + offset + c * (W + GAP_X), y: MARGIN + r * (H + GAP_Y) });
    });
  });

  const testHeight = rows.length ? rows.length * (H + GAP_Y) - GAP_Y : 0;
  const bandY = MARGIN + testHeight + BAND_GAP;

  // Setup stages: their own band, wrapped over rows of four.
  const perRow = 4;
  const setupRows = Math.ceil(setups.length / perRow);
  setups.forEach((stage, i) => {
    const r = Math.floor(i / perRow);
    const inRow = Math.min(perRow, setups.length - r * perRow);
    const offset = (widest - rowWidth(inRow)) / 2;
    position.set(stage.id, { x: MARGIN + offset + (i % perRow) * (W + GAP_X), y: bandY + 18 + r * (H + 18) });
  });

  const width = widest + MARGIN * 2;
  const height = (setups.length ? bandY + 18 + setupRows * (H + 18) : MARGIN + testHeight) + MARGIN;

  const root = svg('svg', {
    class: 'graph', viewBox: `0 0 ${width} ${height}`, width: '100%',
    height, preserveAspectRatio: 'xMidYMin meet', role: 'img',
    'aria-label': 'Stage dependency graph',
  });

  root.appendChild(svg('defs', {},
    svg('marker', { id: 'tsw-arrow', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      svg('path', { d: 'M0,0 L8,4 L0,8 z', class: 'graph-arrow' })),
    svg('marker', { id: 'tsw-arrow-call', viewBox: '0 0 8 8', refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' },
      svg('path', { d: 'M0,0 L8,4 L0,8 z', class: 'graph-arrow-call' }))));

  // Prerequisites, between test stages.
  for (const stage of tests) {
    const a = position.get(stage.id);
    for (const p of stage.prerequisites || []) {
      const b = position.get(p);
      if (!a || !b) continue;
      root.appendChild(svg('path', {
        class: 'graph-edge', 'marker-end': 'url(#tsw-arrow)',
        d: curve(b.x + W / 2, b.y + H, a.x + W / 2, a.y),
      }));
    }
  }

  // Parallel exclusions, between test stages. Both ends of every exclusion are remembered:
  // being excluded by another stage is the same constraint seen from the other side. A stage
  // that allows nothing alongside says so in three words under its own box, and is not
  // repeated under every other: listing it there would say the same thing eleven times.
  const allowsNone = (s) => (s.exclusions || {}).mode === EXCLUSION_MODE.ALL;
  const notWith = new Map(tests.map((s) => [s.id, []]));
  for (const a of tests) {
    for (const b of tests) {
      if (a.id !== b.id && !allowsNone(b) && mutuallyExcluded(a, b)) notWith.get(a.id).push(b.id);
    }
  }

  // The band that separates the sequence from the routines it calls.
  if (setups.length) {
    root.appendChild(svg('line', { class: 'graph-band', x1: MARGIN, y1: bandY, x2: width - MARGIN, y2: bandY }));
    root.appendChild(svg('text', { class: 'graph-band-label', x: MARGIN, y: bandY - 5 }, 'Setup stages — run only when a step calls them'));
  }

  // Calls: from the calling stage to the setup stage.
  const calls = callMap(doc);
  for (const [calledId, callers] of calls) {
    const target = position.get(calledId);
    if (!target) continue;
    const from = new Set(callers.map((c) => c.stageId));
    for (const callerId of from) {
      const source = position.get(callerId);
      if (!source) continue;
      root.appendChild(svg('path', {
        class: 'graph-call', 'marker-end': 'url(#tsw-arrow-call)',
        d: curve(source.x + W / 2, source.y + H, target.x + W / 2, target.y),
      }));
    }
  }

  // Nodes.
  for (const stage of all) {
    const p = position.get(stage.id);
    if (!p) continue;
    const setup = setups.includes(stage);
    const mode = (stage.exclusions || {}).mode;
    const exclusive = !setup && mode === EXCLUSION_MODE.ALL;
    const others = exclusive ? [] : (notWith.get(stage.id) || []);
    const restricted = !setup && others.length > 0;
    const classes = ['graph-node', setup ? 'graph-node-setup' : '',
      exclusive ? 'graph-node-exclusive' : '', restricted ? 'graph-node-restricted' : ''].filter(Boolean).join(' ');
    const g = svg('g', { class: classes, transform: `translate(${p.x},${p.y})` });
    if (options.onClick) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => options.onClick(stage.id));
    }
    g.appendChild(svg('rect', { width: W, height: H, rx: setup ? 14 : 5 }));
    g.appendChild(svg('text', { x: 8, y: 17, class: 'graph-code' }, codes ? codes.get(stage.id) || '' : ''));
    g.appendChild(svg('text', { x: 8, y: 32, class: 'graph-name' }, cut(stage.name || '(unnamed)', 23)));
    if (setup) {
      const times = (calls.get(stage.id) || []).length;
      g.appendChild(svg('title', {}, times ? `Setup stage, called ${times} time${times > 1 ? 's' : ''}` : 'Setup stage, never called'));
      if (times > 1) g.appendChild(svg('text', { x: W - 8, y: 17, class: 'graph-times', 'text-anchor': 'end' }, `×${times}`));
    } else if (exclusive) {
      g.appendChild(svg('title', {}, 'Allows no other stage in parallel'));
      g.appendChild(svg('text', { x: W / 2, y: H + 12, class: 'graph-note', 'text-anchor': 'middle' }, '⊘ no stage in parallel'));
    } else if (restricted) {
      // The whole list in the tooltip, the codes under the box, on two lines at most: the room
      // under a box is what the arrows leave, and a third line would run into the next row.
      const names = others.map((id) => (codes && codes.get(id)) || '?');
      g.appendChild(svg('title', {}, 'Cannot run in parallel with ' + names.join(', ')));
      const lines = wrapCodes(names, 26);
      lines.forEach((line, i) => g.appendChild(svg('text', {
        x: W / 2, y: H + 12 + i * 11, class: 'graph-note', 'text-anchor': 'middle',
      }, (i === 0 ? '⊘ not with ' : '') + line + (i === lines.length - 1 && lines.hidden ? ` +${lines.hidden}` : ''))));
    }
    root.appendChild(g);
  }

  return root;
}

const curve = (x1, y1, x2, y2) => {
  const dy = Math.max(18, (y2 - y1) / 2);
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
};

const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/**
 * The codes on at most two lines of `width` characters, the first one shorter by the words
 * before it. What does not fit is counted, and the tooltip carries the whole list.
 */
function wrapCodes(names, width) {
  const lines = [];
  let line = '';
  let room = width - 'not with '.length;
  let i = 0;
  for (; i < names.length; i += 1) {
    const next = line ? line + ', ' + names[i] : names[i];
    if (next.length <= room) { line = next; continue; }
    if (lines.length === 1) break;
    lines.push(line + ',');
    line = names[i];
    room = width;
  }
  if (i === names.length) lines.push(line);
  else if (line) lines.push(line);
  lines.hidden = names.length - i;
  return lines;
}

/** Graph legend, used both on screen and in print. */
export const graphLegend = () => [
  { className: 'graph-edge', text: 'arrow: mandatory prerequisite' },
  { className: 'graph-call', text: 'dotted: a step calls this setup stage' },
  { className: 'graph-node-setup', text: 'rounded box: setup stage, runs only when called' },
  { className: 'graph-node-exclusive', text: 'thick border: allows no stage in parallel' },
  { className: 'graph-node-restricted', text: '⊘ not with…: the stages it cannot run alongside' },
];
