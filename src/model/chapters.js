// The chapters and appendices of the printed document: which exist, in what order, and
// which have anything to say.
//
// The sheet and the Word file are two renderings of one list, and this is the list. A
// chapter with nothing in it is not printed — a page that says «No external references»
// tells the reader nothing the absence of the page would not — and the order is the
// document's to set (`settings.chapterOrder`), because a customer's template may want the
// glossary first or the variants last. What the setting does not name comes after, in the
// order below, so a file written before a chapter existed still prints it.
import { testStages, setupStages } from './stages.js';
import { resourceSummary } from './resources.js';
import { matrixHasContent, matrixIsWide } from '../history/matrix.js';

/** Every chapter the document can have, in the default order. `landscape` says which ones turn the page. */
export const CHAPTERS = [
  { key: 'references', kind: 'chapter', title: 'External references' },
  { key: 'product', kind: 'chapter', title: 'Product description' },
  { key: 'testing', kind: 'chapter', title: 'Test description' },
  { key: 'glossary', kind: 'chapter', title: 'Glossary' },
  { key: 'variables', kind: 'chapter', title: 'Global variables' },
  { key: 'variants', kind: 'chapter', title: 'Product variants' },
  { key: 'stages', kind: 'chapter', title: 'Test stages', major: true },
  { key: 'setups', kind: 'chapter', title: 'Setup stages', major: true },
  { key: 'kpi', kind: 'appendix', title: 'Key performance indicators' },
  { key: 'points', kind: 'appendix', title: 'Application points' },
  { key: 'protocols', kind: 'appendix', title: 'Communication protocols' },
  { key: 'commands', kind: 'appendix', title: 'Commands and interfaces', landscape: true },
  { key: 'resources', kind: 'appendix', title: 'Test resources' },
  { key: 'graph', kind: 'appendix', title: 'Stage graph', landscape: true },
  // Last, and turned only when it has grown wide: what each revision changed, line by line.
  { key: 'matrix', kind: 'appendix', title: 'Revision matrix', landscape: (doc, history, last) => matrixIsWide(doc, history, last) },
];

const byKey = new Map(CHAPTERS.map((c) => [c.key, c]));

/**
 * Whether a chapter has anything to print. The history and the last issued document matter
 * to the revision matrix alone.
 */
export function chapterHasContent(key, doc, history = null, lastFrozen = null) {
  const d = doc || {};
  switch (key) {
    case 'matrix': return matrixHasContent(d, history, lastFrozen);
    case 'references': return (d.references || []).length > 0;
    case 'product': return !!String((d.description || {}).product || '').trim();
    case 'testing': return !!String((d.description || {}).testing || '').trim();
    case 'glossary': return (d.glossary || []).some((g) => String(g.term || '').trim());
    case 'variables': return (d.variables || []).length > 0;
    case 'variants': return (d.variants || []).length > 0;
    case 'stages': return testStages(d).length > 0;
    case 'setups': return setupStages(d).length > 0;
    case 'kpi': return (d.stages || []).some((s) => (s.tests || []).some((t) => t.kpi));
    case 'points': return (d.points || []).length > 0;
    case 'protocols': return (d.protocols || []).length > 0;
    case 'commands': return (d.commands || []).length > 0 || (d.interfaces || []).length > 0;
    case 'resources': return resourceSummary(d).rows.length > 0;
    case 'graph': return (d.stages || []).length > 0;
    default: return false;
  }
}

/**
 * The chapters in the order the document prints them: the setting first, then whatever it
 * does not name, in the default order. Chapters and appendices keep to their own halves —
 * an appendix is numbered by letter and comes after the numbered chapters, whatever the
 * setting says.
 * @returns {Array<{key, kind, title, major?, landscape?}>}
 */
export function chapterOrder(doc) {
  const wanted = Array.isArray(((doc || {}).settings || {}).chapterOrder) ? doc.settings.chapterOrder : [];
  const seen = new Set();
  const ordered = [];
  for (const key of wanted) {
    const c = byKey.get(key);
    if (c && !seen.has(key)) { seen.add(key); ordered.push(c); }
  }
  for (const c of CHAPTERS) if (!seen.has(c.key)) ordered.push(c);
  return [...ordered.filter((c) => c.kind === 'chapter'), ...ordered.filter((c) => c.kind === 'appendix')];
}

/**
 * The chapters the document prints, in order, with their number or letter, and whether each
 * turns the page — decided here once, for the sheet and for the Word file alike.
 */
export function printedChapters(doc, history = null, lastFrozen = null) {
  let number = 0;
  let letter = 0;
  return chapterOrder(doc).filter((c) => chapterHasContent(c.key, doc, history, lastFrozen)).map((c) => ({
    ...c,
    landscape: typeof c.landscape === 'function' ? c.landscape(doc, history, lastFrozen) : !!c.landscape,
    label: c.kind === 'chapter' ? String(++number) : 'Appendix ' + String.fromCharCode(65 + letter++),
  }));
}

/**
 * The order with one chapter moved one place up or down among its own kind, as the setting
 * should record it: the full list, so that what the setting says is what the reader sees.
 */
export function movedOrder(doc, key, delta) {
  const all = chapterOrder(doc);
  const kind = (byKey.get(key) || {}).kind;
  const group = all.filter((c) => c.kind === kind).map((c) => c.key);
  const i = group.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= group.length) return null;
  [group[i], group[j]] = [group[j], group[i]];
  return kind === 'chapter'
    ? [...group, ...all.filter((c) => c.kind === 'appendix').map((c) => c.key)]
    : [...all.filter((c) => c.kind === 'chapter').map((c) => c.key), ...group];
}
