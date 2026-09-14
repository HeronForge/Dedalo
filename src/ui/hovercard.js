// A preview under the pointer, for what a click would open on the side.
//
// The side panel is the right place to read a command in full; it is the wrong place to
// glance at one. A pointer resting on a code for a moment gets the same card in a small
// window next to it, and moving on takes it away — nothing to close, nothing that stays.
//
// Two things are kept apart on purpose: the card that is showing, and the card that is about
// to. A code is made of two spans, and the pointer settling on it crosses from one to the other;
// that crossing fires a leave and an enter, and an implementation that let the leave start a
// hide which then cancelled the pending show is what made the card come "sometimes". So a
// leave that stays inside the code is ignored, and the delayed hide only ever takes away what
// is showing — never what is waiting.
import { h } from './dom.js';

const SHOW_AFTER = 380; // ms the pointer has to rest before the first card appears
const SHOW_NEXT = 140;  // ms for the next one while a card is already up: the reader is browsing
const HIDE_AFTER = 220; // ms of grace to move from the code onto the card itself

let pop = null;       // the one window, reused
let anchor = null;    // the element the window explains
let pending = null;   // the element a window is waiting to appear for
let showTimer = 0;
let hideTimer = 0;

/**
 * Watches a rendered document for the pointer resting on something that has a card.
 * @param {HTMLElement} root the rendered document
 * @param {string} selector what has a card
 * @param {(el: HTMLElement) => (Node|null)} content the card for that element, or nothing
 * @returns {() => void} stops watching
 */
export function hoverCards(root, selector, content) {
  const onOver = (ev) => {
    const el = ev.target.closest(selector);
    if (!el || !root.contains(el)) return;
    if (el === pending) return;                   // still settling on the same code
    if (el === anchor) { clearTimeout(hideTimer); return; } // back on the one showing
    clearTimeout(showTimer);
    pending = el;
    showTimer = setTimeout(() => {
      pending = null;
      show(el, content(el));
    }, pop ? SHOW_NEXT : SHOW_AFTER);
  };
  const onOut = (ev) => {
    const el = ev.target.closest(selector);
    if (!el) return;
    // From one part of the code to another: the pointer has not left it.
    const to = ev.relatedTarget;
    if (to instanceof Node && el.contains(to)) return;
    if (el === pending) { clearTimeout(showTimer); pending = null; }
    if (el === anchor) scheduleHide();
  };
  // A click opens the real thing. A scroll of the page moves the ground from under a card that
  // is showing, so that one goes; a scroll inside the card is somebody reading a long one to
  // the end. Neither touches a card that is waiting to appear.
  const onClick = () => hide();
  const onScroll = (ev) => { if (!(pop && ev.target instanceof Node && pop.contains(ev.target))) dismiss(); };
  root.addEventListener('mouseover', onOver);
  root.addEventListener('mouseout', onOut);
  root.addEventListener('click', onClick, true);
  document.addEventListener('scroll', onScroll, true);
  return () => {
    root.removeEventListener('mouseover', onOver);
    root.removeEventListener('mouseout', onOut);
    root.removeEventListener('click', onClick, true);
    document.removeEventListener('scroll', onScroll, true);
    hide();
  };
}

function show(el, node) {
  dismiss();
  if (!node) return;
  anchor = el;
  pop = h('div', { class: 'hover-card', role: 'tooltip' }, node);
  // Resting on the card keeps it: what it says may be longer than a glance.
  pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  pop.addEventListener('mouseleave', scheduleHide);
  document.body.appendChild(pop);
  place(pop, el);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(dismiss, HIDE_AFTER);
}

/** Takes everything away: the card showing and the one waiting. */
function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  pending = null;
  dismiss();
}

/** Takes the card away, and nothing else: whatever is waiting to show still will. */
function dismiss() {
  clearTimeout(hideTimer);
  if (pop) pop.remove();
  pop = null;
  anchor = null;
}

/** Under the element when there is room, above it otherwise; never off the window. */
function place(win, el) {
  const r = el.getBoundingClientRect();
  const w = win.offsetWidth;
  const hgt = win.offsetHeight;
  const margin = 8;
  const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin);
  let top = r.bottom + 6;
  if (top + hgt > window.innerHeight - margin) top = Math.max(margin, r.top - hgt - 6);
  win.style.left = `${Math.round(left)}px`;
  win.style.top = `${Math.round(top)}px`;
}
