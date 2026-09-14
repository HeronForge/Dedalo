// Generic paths inside the document.
// A path is an array of segments: either an object key ("stages", "measurement")
// or "#id" to select an array element by its stable id.
// Ids never change, so a path stays valid even when lists are reordered.

const isRef = (seg) => typeof seg === 'string' && seg.startsWith('#');
const idOf = (seg) => seg.slice(1);

function descend(node, seg) {
  if (node == null) return undefined;
  if (isRef(seg)) return Array.isArray(node) ? node.find((e) => e && e.id === idOf(seg)) : undefined;
  return node[seg];
}

export function getAt(root, path) {
  let n = root;
  for (const seg of path) {
    n = descend(n, seg);
    if (n === undefined) return undefined;
  }
  return n;
}

/** Returns the container one level up plus the last segment. */
function container(root, path) {
  if (!path.length) return null;
  const parent = getAt(root, path.slice(0, -1));
  return parent === undefined ? null : { parent, seg: path[path.length - 1] };
}

export function setAt(root, path, value) {
  const c = container(root, path);
  if (!c) return false;
  if (isRef(c.seg)) {
    if (!Array.isArray(c.parent)) return false;
    const i = c.parent.findIndex((e) => e && e.id === idOf(c.seg));
    if (i < 0) return false;
    c.parent[i] = value;
    return true;
  }
  if (c.parent == null || typeof c.parent !== 'object') return false;
  c.parent[c.seg] = value;
  return true;
}

/** Appends an element to the array the path points at. */
export function addAt(root, path, value, index) {
  const arr = getAt(root, path);
  if (!Array.isArray(arr)) return false;
  if (typeof index === 'number' && index >= 0 && index <= arr.length) arr.splice(index, 0, value);
  else arr.push(value);
  return true;
}

export function removeAt(root, path) {
  const c = container(root, path);
  if (!c) return false;
  if (isRef(c.seg)) {
    if (!Array.isArray(c.parent)) return false;
    const i = c.parent.findIndex((e) => e && e.id === idOf(c.seg));
    if (i < 0) return false;
    c.parent.splice(i, 1);
    return true;
  }
  if (c.parent == null || typeof c.parent !== 'object') return false;
  delete c.parent[c.seg];
  return true;
}

export const samePath = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);

/** Readable labels for the technical field names (used by the diff and the overlay list). */
const LABELS = {
  header: 'Header', revision: 'Revision', description: 'Description', settings: 'Settings',
  references: 'References', variables: 'Variables', variants: 'Variants', resources: 'Resources',
  protocols: 'Protocols', interfaces: 'Interfaces', commands: 'Commands', points: 'Application points',
  images: 'Images', stages: 'Stages', tests: 'Tests', steps: 'Steps',
  stimulus: 'Stimulus', measurement: 'Measurement', expected: 'Expected value', parameters: 'Parameters',
  characteristics: 'Characteristics', markers: 'Markers', prerequisites: 'Prerequisites',
  exclusions: 'Parallel exclusions', heldStimuli: 'Stimuli held on exit',
  pointIds: 'Points', resourceId: 'Resource', commandId: 'Command', interfaceId: 'Interface',
  calledStageId: 'Called stage', wait: 'Wait time', note: 'Note', notes: 'Notes',
  name: 'Name', unit: 'Unit', value: 'Value',
  min: 'Minimum', max: 'Maximum', nominal: 'Nominal', tolerance: 'Tolerance',
  toleranceType: 'Tolerance type', mode: 'Mode', variableId: 'Variable', type: 'Type',
  overlay: 'Customisations', code: 'Code', title: 'Title', purpose: 'Purpose',
  connector: 'Connector', pin: 'Pin', signal: 'Signal', contactType: 'Contact type',
  address: 'Address', requestFormat: 'Request format', responseFormat: 'Response format',
  encoding: 'Encoding', example: 'Example', caption: 'Caption', category: 'Category',
  allowedValues: 'Allowed values', assetId: 'Image file', logoAssetId: 'Logo',
  confidentiality: 'Confidentiality', documentCode: 'Document code', company: 'Company',
  project: 'Project', product: 'Product', preparedBy: 'Prepared by', checkedBy: 'Checked by',
  approvedBy: 'Approved by', signatories: 'Signatories', role: 'Role',
  glossary: 'Glossary', term: 'Term', meaning: 'Meaning', chapterOrder: 'Chapter order',
  number: 'Number', date: 'Date', author: 'Author', reason: 'Reason',
  status: 'Status', stepId: 'Step', imageId: 'Image', stageIds: 'Stages', x: 'X', y: 'Y',
  testing: 'Testing',
  // The fields the later versions brought. Without a label here the change record reads
  // «regex» and «protocolId», which is the field name and not what the field means.
  kind: 'Kind', family: 'Family', rules: 'Rules', protocolId: 'Protocol',
  comparison: 'Comparison type', text: 'Expected text', stringComparison: 'Text comparison',
  caseSensitive: 'Case sensitive', regex: 'Regular expression', booleanValue: 'Passing answer',
  kpi: 'Key performance indicator', disclaimer: 'Disclaimer',
  table: 'Table', columns: 'Columns', rows: 'Rows', cells: 'Cells', columnId: 'Column', label: 'Label',
  computed: 'Computed', formula: 'Formula', inputStepIds: 'Inputs',
  referenceId: 'Defined in', decoding: 'Decoding',
  negativeResponse: 'Negative response', nominalTime: 'Nominal execution time',
  averageTime: 'Average time for one use', area: 'Zoom area',
  noDirectEditing: 'No direct editing', schemaVersion: 'Data schema',
};

export const fieldLabel = (key) => LABELS[key] || key;

/**
 * Turns a path into a readable description, resolving ids into names.
 * e.g. ["stages","#stg_a","tests","#tc_b","steps","#stp_c","measurement","expected","max"]
 *  -> Stages › Stage «Power-up» › Test «Supply» › Step 3 › Measurement › Expected value › Maximum
 */
export function readablePath(root, path) {
  const parts = [];
  let node = root;
  let lastCollection = '';
  for (const seg of path) {
    if (typeof seg === 'string' && seg.startsWith('#')) {
      const arr = node;
      const el = Array.isArray(arr) ? arr.find((e) => e && e.id === seg.slice(1)) : null;
      const idx = Array.isArray(arr) ? arr.findIndex((e) => e && e.id === seg.slice(1)) : -1;
      const name = el && (el.name || el.title || el.label || el.description);
      const label = singular(lastCollection);
      parts[parts.length - 1] = name
        ? `${label} «${truncate(name)}»`
        : `${label} ${idx >= 0 ? idx + 1 : '?'}`;
      node = el;
    } else {
      lastCollection = seg;
      parts.push(fieldLabel(seg));
      node = node == null ? undefined : node[seg];
    }
  }
  return parts.join(' › ');
}

const SINGULARS = {
  Stages: 'Stage', Tests: 'Test', Steps: 'Step', Variables: 'Variable', Variants: 'Variant',
  Resources: 'Resource', Interfaces: 'Interface', Commands: 'Command', 'Application points': 'Point',
  Images: 'Image', References: 'Reference', Parameters: 'Parameter',
  Characteristics: 'Characteristic', Markers: 'Marker', 'Stimuli held on exit': 'Held stimulus',
  Customisations: 'Customisation', Signatories: 'Signatory', Glossary: 'Glossary entry',
  Columns: 'Column', Rows: 'Row', Cells: 'Cell',
};

const singular = (key) => {
  const label = fieldLabel(key);
  return SINGULARS[label] || label;
};

export const truncate = (s, n = 40) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
