// Reading mode: the document alone, with nothing of the editor around it.
//
// Zoom rather than font size. The document is dimensioned in print units — points for the
// type, millimetres for the figures — so that what is on the screen is what comes out of the
// printer. Changing the font size would move the text and leave the pictures, the markers and
// the column widths where they were, which is a different document, not a larger one. `zoom`
// enlarges the sheet as a whole and keeps every proportion, exactly like the paper being held
// closer.
import { h, button, toast } from './dom.js';
import { pinViewpoint, keepingViewpoint } from './viewpoint.js';
import { mountOutline, unmountOutline } from './outline.js';

const MIN = 0.6;
const MAX = 2.5;
const STEP = 1.1;
const HIDE_AFTER = 2600; // ms of stillness before the controls fade away

const clamp = (v) => Math.min(MAX, Math.max(MIN, v));

function readZoom() {
  try {
    const v = Number(localStorage.getItem('tsw.read.zoom'));
    return v ? clamp(v) : 1;
  } catch { return 1; }
}

function writeZoom(v) {
  try { localStorage.setItem('tsw.read.zoom', String(v)); } catch { /* no preference kept */ }
}

let session = null; // the one reading session, if open

/** Whether the document is being read rather than edited. */
export const isReading = () => !!session;

/**
 * Hides the interface and leaves the document, with a strip of controls that shows itself
 * when the pointer moves and gets out of the way when it stops.
 */
export function enterReading(store) {
  if (session) return session;
  let zoom = readZoom();
  const readout = h('span', { class: 'read-readout' }, '100 %');

  // The zoom lives on the body as a custom property, not on the sheet: the interface redraws
  // the sheet whenever anything changes, and an inline style would go with it.
  const apply = () => {
    document.body.style.setProperty('--read-zoom', String(zoom));
    readout.textContent = `${Math.round(zoom * 100)} %`;
    writeZoom(zoom);
    // Whatever is drawn over the sheet in the sheet's own pixels — the notes in the margin —
    // has to be placed again: the sheet just changed size under it.
    document.dispatchEvent(new Event('tsw:relayout'));
  };
  // The sheet scales around the top left corner; the reader was looking somewhere else. What
  // was under the top edge before the zoom is put back there after it.
  const setZoom = (v) => { zoom = clamp(v); keepingViewpoint(scroller(), apply); };

  /** The sheet as wide as the window allows: the useful setting on a laptop screen. */
  const fitWidth = () => {
    const area = document.querySelector('.content');
    const sheet = document.querySelector('.doc-preview');
    if (!area || !sheet) return;
    const natural = sheet.getBoundingClientRect().width / zoom; // the sheet at 100 %
    if (natural > 0) setZoom((area.clientWidth - 24) / natural);
  };

  const fullscreenButton = button('⛶', toggleFullscreen, { class: 'btn-icon', title: 'Full screen (F)' });

  const bar = h('div', { class: 'read-bar' },
    button('−', () => setZoom(zoom / STEP), { class: 'btn-icon', title: 'Smaller (−)' }),
    readout,
    button('+', () => setZoom(zoom * STEP), { class: 'btn-icon', title: 'Larger (+)' }),
    button('Fit width', fitWidth, { class: 'btn-small', title: 'As wide as the window (W)' }),
    button('100 %', () => setZoom(1), { class: 'btn-small', title: 'Actual size (0)' }),
    h('span', { class: 'read-sep' }),
    fullscreenButton,
    button('✕ Exit reading', () => exitReading(), { class: 'btn-small' }));

  const hint = h('div', { class: 'read-hint' }, 'Reading mode — move the pointer for the controls, Esc to leave');

  // `zoom` is what every current browser understands; on an old one the mode still works and
  // the browser's own zoom does the job, so say that rather than leave dead buttons.
  if (!CSS.supports('zoom', '1.5')) {
    toast('This browser cannot scale the sheet: use its own zoom (Ctrl and + or −). Reading mode works all the same.', 'warning', 7000);
  }

  // What is under the top edge is noted before the layout changes, and the redraw that follows
  // puts it back under the top edge of the new one.
  pinViewpoint(scroller());
  document.body.classList.add('reading-mode');
  document.body.appendChild(bar);
  document.body.appendChild(hint);
  // The contents in the grey field beside the sheet: reading is the one mode with that field.
  mountOutline();
  apply();

  // The controls are always there and never in the way: they come back with the pointer.
  let timer = null;
  const show = () => {
    bar.classList.add('read-bar-on');
    // The trail at the top comes and goes with the controls: it is the other half of the same
    // chrome, and reading with a plate hanging over the sheet is not reading the document alone.
    document.body.classList.add('read-chrome');
    clearTimeout(timer);
    timer = setTimeout(() => {
      bar.classList.remove('read-bar-on');
      document.body.classList.remove('read-chrome');
    }, HIDE_AFTER);
  };
  const onMove = () => show();
  const onKey = (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName || '');
    if (editing) return;
    // In full screen the first Escape belongs to the browser: leaving the mode as well would
    // take away two things when one was asked for.
    if (ev.key === 'Escape') { if (!document.fullscreenElement) { ev.preventDefault(); exitReading(); } return; }
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); setZoom(zoom * STEP); show(); }
    else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); setZoom(zoom / STEP); show(); }
    else if (ev.key === '0') { ev.preventDefault(); setZoom(1); show(); }
    else if (ev.key.toLowerCase() === 'w') { ev.preventDefault(); fitWidth(); show(); }
    else if (ev.key.toLowerCase() === 'f') { ev.preventDefault(); toggleFullscreen(); }
  };
  const onFullscreen = () => {
    const on = !!document.fullscreenElement;
    fullscreenButton.classList.toggle('btn-on', on);
    fullscreenButton.title = on ? 'Leave full screen (F)' : 'Full screen (F)';
    show();
  };

  document.addEventListener('mousemove', onMove);
  // Moving through the document is exactly when one wonders where one is, and a wheel turned
  // without touching the mouse moves no pointer: the scroll calls the controls back too.
  document.addEventListener('scroll', onMove, true);
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('fullscreenchange', onFullscreen);
  setTimeout(() => hint.classList.add('read-hint-out'), 2200);
  show();

  session = {
    close() {
      clearTimeout(timer);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('scroll', onMove, true);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('fullscreenchange', onFullscreen);
      pinViewpoint(scroller());
      document.body.classList.remove('reading-mode');
      document.body.classList.remove('read-chrome');
      document.body.style.removeProperty('--read-zoom');
      bar.remove();
      hint.remove();
      unmountOutline();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      session = null;
      if (store) store.refresh();
    },
  };
  // The sheet is drawn again for reading — the links that lead into the editor are left out,
  // and the trail at the top names the document rather than the panel it was opened from —
  // once the session exists, since that is what the document view asks about.
  if (store) store.refresh();
  return session;
}

/** The element that scrolls: the sheet lives in it in both modes. */
const scroller = () => document.querySelector('.content') || document.documentElement;

export function exitReading() {
  if (session) session.close();
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  const request = document.documentElement.requestFullscreen
    ? document.documentElement.requestFullscreen()
    : Promise.reject(new Error('not supported here'));
  // Some embedded browsers refuse it outright. Saying so beats a button that does nothing:
  // reading mode itself works either way, only windowed.
  request.catch(() => toast('The browser did not allow full screen. Reading mode stays in the window.', 'warning', 6000));
}
