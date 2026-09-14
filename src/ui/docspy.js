// Where the reader is inside the document.
//
// The trail at the top of the window says which section of the *editor* is open, and in the
// document view that is one line that never changes while one reads fifteen pages. What is
// wanted there is the other kind of place: the chapter, the stage, the test the eye is on.
//
// It is read from the rendered document rather than from the model, because the document is
// what is being scrolled: its headings are already numbered, already carry the codes, and
// already say exactly what the reader would answer if asked where they are.
import { truncate } from '../model/paths.js';

const HEADINGS = 'h2.doc-h2, h3.doc-h3, h4.doc-h4';
const LEVEL = { H2: 2, H3: 3, H4: 4 };

/** How far below the top of the window a heading counts as passed. */
const LINE = 28;

const position = { chain: [], list: [] };
const listeners = new Set();

/** The chain of headings above the reading line, outermost first. */
export const documentPosition = () => position;

export function onDocumentPosition(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let stopCurrent = null;

/**
 * Follows the reading of a rendered document. The previous watch is dropped: the document
 * view is rebuilt whole at every redraw, and two watches on two copies of the same document
 * would answer with the one nobody is looking at.
 */
export function watchDocument(root) {
  if (stopCurrent) stopCurrent();
  const scroller = root.closest('.content') || document.querySelector('.content');
  if (!scroller) return () => {};

  const list = [...root.querySelectorAll(HEADINGS)].map((el) => ({
    el, level: LEVEL[el.tagName] || 4, label: truncate(headingText(el), 46),
  }));
  position.list = list;

  let frame = 0;
  // The first answer of a new watch goes out even when it names the same place as the last
  // one: the headings are new elements now, and whoever holds the old ones — the contents
  // beside the sheet, which scrolls to them — would be pointing into a document that is gone.
  let fresh = true;
  const update = () => {
    frame = 0;
    // The document was replaced under us: nothing else will say so, so the watch says it here.
    if (!root.isConnected) { stop(); return; }
    const line = scroller.getBoundingClientRect().top + LINE;
    const chain = chainTo(list, lastAbove(list, line));
    if (!fresh && same(chain, position.chain)) return;
    fresh = false;
    position.chain = chain;
    listeners.forEach((f) => f(position));
  };

  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  // Folding a chapter away moves everything under it and fires no scroll of its own.
  root.addEventListener('click', schedule);
  schedule();

  const stop = () => {
    if (frame) cancelAnimationFrame(frame);
    scroller.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    root.removeEventListener('click', schedule);
    if (stopCurrent === stop) stopCurrent = null;
  };
  stopCurrent = stop;
  return stop;
}

/**
 * The last heading whose top is above the reading line. Headings come in the order they are
 * read, so the search halves the list instead of measuring every one of them at every frame:
 * a long specification has a couple of hundred, and this runs while the wheel turns.
 */
function lastAbove(list, line) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].el.getBoundingClientRect().top <= line) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

/**
 * What else stands at the level of a heading, under the same parent: the other chapters, the
 * other stages of the chapter, the other tests of the stage. The trail offers them as the way
 * across, so moving from one stage to the next is not a matter of scrolling until it shows.
 */
export function documentSiblings(item) {
  const list = position.list;
  const i = list.indexOf(item);
  if (i < 0) return [];
  const out = [];
  for (let k = i - 1; k >= 0 && list[k].level >= item.level; k--) if (list[k].level === item.level) out.unshift(list[k]);
  out.push(item);
  for (let k = i + 1; k < list.length && list[k].level >= item.level; k++) if (list[k].level === item.level) out.push(list[k]);
  return out;
}

/**
 * What a heading contains, one level down: the stages of a chapter, the tests of a stage.
 * The menus of the trail go down through these, level by level, without the page moving.
 */
export function documentChildren(item) {
  const list = position.list;
  const i = list.indexOf(item);
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < list.length && list[k].level > item.level; k++) {
    if (list[k].level === item.level + 1) out.push(list[k]);
  }
  return out;
}

/** The chapters of the document on screen, in order. */
export const documentChapters = () => position.list.filter((item) => item.level === 2);

/** From a heading back up to its chapter: the test, the stage it belongs to, the chapter. */
function chainTo(list, i) {
  const out = [];
  let outer = 5;
  for (let k = i; k >= 0; k--) {
    const item = list[k];
    if (item.level >= outer) continue;
    out.unshift(item);
    outer = item.level;
    if (outer <= 2) break;
  }
  return out;
}

const same = (a, b) => a.length === b.length && a.every((x, i) => x.el === b[i].el);

/**
 * What names the heading, which is less than everything written in it: the arrow that folds
 * the section away is a control («▾Appendix F» names nothing), and the purpose of a test is a
 * sentence — in a trail one wants «T-04.01 — Fault codes» and not the paragraph after it.
 */
const ASIDE = 'sec-toggle doc-purpose kpi-badge'.split(' ');

const headingText = (el) => [...el.childNodes]
  .filter((n) => !(n.nodeType === 1 && ASIDE.some((c) => n.classList.contains(c))))
  .map((n) => n.textContent)
  .join('');
