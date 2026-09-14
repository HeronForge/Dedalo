// The HTML file rewrites itself.
//
// At startup, before the interface touches the DOM, the "shell" is kept in memory:
// the whole file exactly as it was opened. In the distributed file the body holds only
// the data blocks and the scripts (the whole interface is built at runtime), so the shell
// is always clean. On save the data blocks inside the shell are replaced and the result is
// downloaded: a single self-contained file, identical to the original but for the data.
import { migrate } from '../model/schema.js';
import { emptyHistory } from '../history/revisions.js';
import { pruneAssets } from './images.js';
import { exportEnvelope } from './format.js';

let SHELL = '';

/** Must be the very first thing called at startup. */
export function captureShell() {
  SHELL = '<!doctype html>\n' + document.documentElement.outerHTML;
  return SHELL;
}

/** Reads the three data blocks embedded in the file. */
export function readEmbeddedData(root = document) {
  const doc = readBlock(root, 'tsw-doc');
  return {
    doc: migrate(doc.value),
    history: readBlock(root, 'tsw-history').value || emptyHistory(),
    assets: readBlock(root, 'tsw-assets').value || {},
    block: doc, // whether the document block was there at all, and whether it parsed
  };
}

/**
 * A block can be missing, damaged or empty, and the three cases mean different things when a
 * file is opened: telling them apart is what stops an unrelated HTML page from being taken for
 * an empty specification.
 * @returns {{present: boolean, valid: boolean, value: object|null}}
 */
function readBlock(root, id) {
  const el = root.getElementById ? root.getElementById(id) : root.querySelector('#' + id);
  if (!el) return { present: false, valid: false, value: null };
  try {
    return { present: true, valid: true, value: JSON.parse(el.textContent || 'null') };
  } catch {
    return { present: true, valid: false, value: null };
  }
}

/** The shape a document must have to be treated as a specification. */
export const looksLikeSpecification = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value)
  && (typeof value.schemaVersion === 'number' || Array.isArray(value.stages));

/**
 * The JSON as it can sit inside the file. Two things must never appear in it literally: the
 * end of a script element, which would end the block early, and the start of an HTML comment,
 * which is how the blocks are delimited — a step whose description quotes «<!--/TSW:DOC-->»
 * would otherwise be taken for the end of the data at the next save, and everything after it
 * left behind in the body. Both are written as JSON escapes, which JSON.parse reads back as
 * the characters they stand for.
 */
export const protectJson = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1').replace(/<!--/g, '\\u003c!--');

function replaceBlock(html, name, json) {
  const re = new RegExp(`<!--TSW:${name}-->[\\s\\S]*?<!--/TSW:${name}-->`);
  const body = `<script type="application/json" id="tsw-${name.toLowerCase()}">${protectJson(json)}</script>`;
  // Replacement through a function: the JSON may contain $&, $1 and the like, which as a
  // replacement string would be interpreted and would corrupt the saved file.
  return html.replace(re, () => `<!--TSW:${name}-->${body}<!--/TSW:${name}-->`);
}

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Rebuilds the complete file with the current data. */
export function composeFile({ doc, history, assets }) {
  if (!SHELL) throw new Error('Shell not captured: the file cannot be rebuilt.');
  const pruned = pruneAssets(doc, assets, history);
  let html = SHELL;
  html = replaceBlock(html, 'DOC', JSON.stringify(doc));
  html = replaceBlock(html, 'HISTORY', JSON.stringify(history));
  html = replaceBlock(html, 'ASSETS', JSON.stringify(pruned));
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(fileTitle(doc))}</title>`);
  return html;
}

const fileTitle = (doc) => {
  const h = doc.header || {};
  return [h.documentCode, h.title].filter(Boolean).join(' — ') || 'Test specification';
};

/** Suggested file name: CODE_Rev01.html */
export function suggestedFileName(doc) {
  const h = doc.header || {};
  const base = (h.documentCode || h.title || 'test-specification')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const rev = (doc.revision || {}).number || '00';
  return `${base}_Rev${rev}.html`;
}

/** Hands a file to the browser. Every export ends here. */
export function download(data, name, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { name, bytes: blob.size };
}

/** Saves by downloading the rebuilt file. */
export function saveFile(state) {
  return download(composeFile(state), suggestedFileName(state.doc), 'text/html;charset=utf-8');
}

/**
 * Opens another specification file and extracts its data.
 * An unrelated HTML page has no data block: it must be refused, not read as an empty
 * specification that would then replace the work in progress.
 */
export async function openFile(file) {
  const text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'text/html');
  const data = readEmbeddedData(dom);
  if (!data.block.present) throw new Error('This file is not a test specification: it carries no data block.');
  if (!data.block.valid) throw new Error('The data block of this file is damaged: its JSON could not be read.');
  if (!looksLikeSpecification(data.block.value)) throw new Error('The data block of this file does not hold a specification.');
  return { doc: data.doc, history: data.history, assets: data.assets };
}

/**
 * Exports the data alone, for archiving or external comparison. The envelope names the format
 * and the build that wrote it, so whoever opens it later knows what they are holding.
 */
export function exportJson(state) {
  const json = JSON.stringify(exportEnvelope(state), null, 2);
  download(json, suggestedFileName(state.doc).replace(/\.html$/, '.json'), 'application/json');
}

/**
 * Compares the revision history of the opened file with the current one: this warns whoever
 * resumes work from a copy that is not up to date (single editor model).
 *
 * Counting the revisions is not enough — two branches can hold the same number of revisions and
 * still be incompatible — so the sequences are compared entry by entry. When one is not a prefix
 * of the other the two files are two different stories, which is worse than being behind.
 *
 * @returns {'same'|'ahead'|'behind'|'diverged'}
 */
export function compareHistories(currentHistory, otherHistory) {
  const sequence = (h) => ((h && h.revisions) || []).map((r) => `${r.number}|${r.date}|${r.status}`);
  const a = sequence(currentHistory);
  const b = sequence(otherHistory);
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) if (a[i] !== b[i]) return 'diverged';
  if (b.length < a.length) return 'behind';
  if (b.length > a.length) return 'ahead';
  return 'same';
}
