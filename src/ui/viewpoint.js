// Where the reader is, as something that survives a redraw and a change of layout.
//
// A scroll offset is a number of pixels, and a number of pixels means something only in the
// layout it was measured in. Reading mode takes the toolbar away and scales the sheet; coming
// back puts them back; a redraw after an edit moves a paragraph by a line. The same offset then
// lands the reader somewhere else. What is kept instead is the element under the top edge of
// the window and how far into it that edge sits — and after the redraw the window is put back
// on that element, wherever the new layout has moved it.
//
// Every entity the document draws carries its id in the DOM (`ref-…`, `chap-…`), so there is
// always something to hold on to; when there is not — an editor section, a deleted stage — the
// offset is used as it always was.

/**
 * @param {HTMLElement} scroller the element that scrolls
 * @returns {{scrollTop: number, id?: string, fraction?: number}}
 */
export function captureViewpoint(scroller) {
  const point = { scrollTop: scroller.scrollTop };
  const line = scroller.getBoundingClientRect().top + 1;
  const marks = [...scroller.querySelectorAll('[id]')];
  const i = lastAbove(marks, line);
  if (i < 0) return point;
  const r = marks[i].getBoundingClientRect();
  if (r.height <= 0) return point;
  return { ...point, id: marks[i].id, fraction: (line - r.top) / r.height };
}

/** Puts the window back on what it was showing, in whatever layout it finds. */
export function restoreViewpoint(scroller, point) {
  if (!point) return;
  const el = point.id ? scroller.querySelector('#' + cssEscape(point.id)) : null;
  if (!el) { scroller.scrollTop = point.scrollTop; return; }
  const r = el.getBoundingClientRect();
  const top = scroller.getBoundingClientRect().top;
  scroller.scrollTop += (r.top - top) + (point.fraction || 0) * r.height - 1;
}

/**
 * A viewpoint taken now, for the redraw that is about to happen. Reading mode changes the
 * layout before it asks for the redraw, and a viewpoint taken during that redraw would already
 * be measuring the new layout against the old offset; so it is taken first, and the redraw
 * collects it here instead of taking its own.
 */
let pinned = null;

export function pinViewpoint(scroller) {
  pinned = captureViewpoint(scroller);
}

export function takePinnedViewpoint() {
  const p = pinned;
  pinned = null;
  return p;
}

/** Keeps the view still across a change of layout that involves no redraw: a zoom. */
export function keepingViewpoint(scroller, change) {
  const point = captureViewpoint(scroller);
  change();
  restoreViewpoint(scroller, point);
}

/**
 * The last element whose top is above the line. Elements come in document order, so their
 * tops are sorted and the search halves the list instead of measuring all of it.
 */
function lastAbove(list, line) {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].getBoundingClientRect().top <= line) { found = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return found;
}

const cssEscape = (s) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'));
