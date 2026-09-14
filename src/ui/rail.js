// The buttons beside the scrollbar: the way to the document, and once there, read, notes,
// print and legend.
//
// They belong to the sheet rather than to the trail — one leads back to it, one turns the
// interface off around it, one prints it, one explains its marks — and the sheet is what
// scrolls under them.
// So they sit on the edge of the window, next to the scrollbar, and stay where they are while
// the content moves: quiet enough not to be furniture, plain enough to be found the first time.
import { h } from './dom.js';
import { enterReading, exitReading, isReading } from './reading.js';
import { legend } from './legend.js';
import { noteButton } from './notes.js';
import { printDocument } from './sections/document.js';
import { isOutlinePinned, setOutlinePinned } from './outline.js';

/** The rail: the way back to the document from any editor section, or its own two buttons. */
export function sideRail(store) {
  if (store.state.section !== 'document') {
    // Following a code into the editor is one click; so is returning to the page one was
    // reading, and it is the same button in the same place whichever section one is in.
    return h('div', { class: 'side-rail' },
      h('button', {
        type: 'button', class: 'rail-btn', title: 'Back to the document view',
        onClick: () => store.set({ section: 'document' }),
      }, '📄'));
  }
  const reading = isReading();
  return h('div', { class: 'side-rail' },
    h('button', {
      type: 'button', class: ['rail-btn', reading && 'rail-btn-on'],
      title: reading
        ? 'Back to the editor (Esc)'
        : 'Read: the document alone, with zoom and full screen (Esc to come back)',
      'aria-pressed': reading ? 'true' : 'false',
      onClick: () => (reading ? exitReading() : enterReading(store)),
    }, reading ? '✕' : '📖'),
    noteButton(),
    h('button', {
      type: 'button', class: 'rail-btn', title: 'Print / PDF: the paginated preview',
      onClick: () => printDocument(store),
    }, '🖨️'),
    // In reading mode the contents stand beside the sheet, and their pin is here, in the
    // column, rather than on the panel that withdraws when it is unpinned.
    reading ? outlinePin(store) : null,
    legend());
}

function outlinePin(store) {
  const pinned = isOutlinePinned();
  return h('button', {
    type: 'button', class: ['rail-btn', pinned && 'rail-btn-on'],
    title: pinned
      ? 'Unpin the contents: they withdraw to the edge and come out under the pointer'
      : 'Pin the contents open beside the sheet',
    'aria-pressed': pinned ? 'true' : 'false',
    onClick: () => { setOutlinePinned(!pinned); store.refreshLight(); },
  }, '📌');
}
