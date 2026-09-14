// The table of contents beside the sheet, in reading mode only.
//
// Reading leaves the sheet alone at the left of the window and a grey field at its right, and
// the one thing a reader of fifteen pages wants there is to know where they are and to get
// somewhere else without scrolling for it. So the chapters stand in that field, the one being
// read lit, and under it the stages it holds. It is drawn faint — dark grey on the dark
// field, part of the background until it is wanted — and comes alive under the pointer.
//
// It reads the same headings the trail reads (ui/docspy.js): the numbered, coded headings of
// the rendered document, so it says what the document says and follows its folding and its
// redraws without a model of its own.
import { h } from './dom.js';
import { documentPosition, onDocumentPosition, documentChapters, documentChildren } from './docspy.js';

let panel = null;
let list = null; // the column of entries inside the panel
let drawnFrom = null; // the heading list the panel was built from, to know when it changed
let unsubscribe = null;

/**
 * Pinned, the column stands where it is. Unpinned it withdraws to the edge of the window,
 * a sliver that says it is there, and comes out under the pointer: for the reader whose
 * window is not wide enough for the sheet and the column both, or who wants the field
 * empty. The pin is a button on the rail (ui/rail.js), with the others; the choice is
 * kept, like the zoom, in the browser.
 */
export function isOutlinePinned() {
  try { return localStorage.getItem('tsw.read.outline') !== 'loose'; } catch { return true; }
}

export function setOutlinePinned(on) {
  try { localStorage.setItem('tsw.read.outline', on ? 'pinned' : 'loose'); } catch { /* not kept */ }
  if (panel) panel.classList.toggle('read-outline-loose', !on);
}

/** Puts the outline beside the sheet and keeps it in step with the reading. */
export function mountOutline() {
  if (panel) return;
  list = h('div', { class: 'outline-list' });
  panel = h('nav', { class: ['read-outline', !isOutlinePinned() && 'read-outline-loose'], 'aria-label': 'Contents' },
    h('div', { class: 'outline-title' }, 'Contents'),
    list);
  document.body.appendChild(panel);
  draw();
  unsubscribe = onDocumentPosition(draw);
}

export function unmountOutline() {
  if (unsubscribe) unsubscribe();
  if (panel) panel.remove();
  panel = null;
  list = null;
  drawnFrom = null;
  unsubscribe = null;
}

/**
 * The list is rebuilt only when the document under it was — a redraw hands the watch a new
 * list of headings; a plain scroll moves the light alone. The entries of the open chapter
 * are the exception: they come and go with the chapter, so that the panel stays a column
 * of chapters and not a column of every stage of the specification.
 */
function draw() {
  if (!panel) return;
  const { chain, list: headings } = documentPosition();
  const chapter = chain[0] || null;
  const inner = chain[1] || null;
  if (headings !== drawnFrom || panel.dataset.chapter !== key(chapter)) {
    drawnFrom = headings;
    panel.dataset.chapter = key(chapter);
    list.replaceChildren(...documentChapters().flatMap((item) => [
      entry(item, 'outline-chapter'),
      ...(item === chapter ? documentChildren(item).map((child) => entry(child, 'outline-inner')) : []),
    ]));
  }
  for (const el of list.children) {
    const here = el.item === chapter || el.item === inner;
    el.classList.toggle('outline-here', here);
    // The lit line is kept in sight inside the panel too, when the list is longer than it.
    if (here && el.item === inner) el.scrollIntoView({ block: 'nearest' });
  }
}

const key = (item) => (item ? item.label : '');

function entry(item, cls) {
  const el = h('button', {
    type: 'button', class: ['outline-entry', cls], title: item.el.textContent.trim(),
    onClick: () => jumpTo(item),
  }, item.label);
  el.item = item;
  return el;
}

/**
 * To the heading, with the reading line of the watch in mind: scrolled to the very top the
 * heading would count as passed and the light would fall on the entry after it, which is
 * not what one just clicked.
 */
function jumpTo(item) {
  const scroller = item.el.closest('.content') || document.documentElement;
  const top = item.el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
  scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
}
