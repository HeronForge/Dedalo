// Application startup.
// The very first thing is capturing the "shell" of the file: the file exactly as it was
// opened, before the interface builds anything in the DOM.
import { captureShell, readEmbeddedData, composeFile } from './io/file.js';
import { importData } from './io/import.js';
import { buildDocx } from './export/docx.js';
import { renderFigures, renderGraphPicture } from './export/figures.js';
import { prepareImage, reencodeAsset, canEncodeWebp } from './io/images.js';
import { createStore } from './model/store.js';
import { mountApp } from './ui/app.js';
import { setupRecovery } from './ui/autosave.js';
import { enterReading } from './ui/reading.js';
import { setupNotes, adoptNotes } from './ui/notes.js';
import { documentPosition } from './ui/docspy.js';
import { draftIsReleased, completeAssetIds, completeChanges, warmLastRevision } from './history/revisions.js';
import { h } from './ui/dom.js';

function start() {
  captureShell();
  const data = readEmbeddedData(document);
  const store = createStore(data);

  const root = h('div', { id: 'tsw-root' });
  document.body.appendChild(root);
  // The notes of whoever opens the file, kept in the browser, before the interface is built:
  // the document view draws them with the sheet.
  setupNotes(store);
  mountApp(store, root);

  // The safety net comes last: it asks about the work of a session that ended badly, and the
  // question belongs on top of an interface that is already there.
  const recovery = setupRecovery(store);

  // Revisions from before the pictures were recorded beside them get the record now, in the
  // background, so that the next save can tell which pictures are still in use. It changes
  // nothing anybody sees, so it neither counts as a change nor asks for a redraw.
  completeAssetIds(store.state.history)
    .then((history) => { if (history && history !== store.state.history) store.state.history = history; })
    // The same for the record of what each revision changed, which the revision matrix
    // prints; and the last issue is read into memory so the draft's column can be drawn.
    // Both may change what the sheet shows, so the sheet is drawn again once they are done.
    .then(() => completeChanges(store.state.history))
    .then((history) => { if (history && history !== store.state.history) store.state.history = history; })
    .then(() => warmLastRevision(store.state.history))
    .then(() => store.refresh())
    .catch(() => { /* an unreadable snapshot keeps the pool whole, which is the safe side */ });

  // A file that is the last issued revision word for word is a file being handed out, and
  // whoever opens it came to read: it opens on the sheet alone. A file with work in it —
  // edited since the issue, or with a draft to recover — opens on the editor as before.
  if (!recovery.found) {
    draftIsReleased(store.state.doc, store.state.history)
      .then((released) => { if (released && !store.state.dirty && store.state.section === 'document') enterReading(store); })
      .catch(() => { /* an unreadable snapshot is reported where it is read, not here */ });
  }

  window.addEventListener('beforeunload', (e) => {
    if (!store.state.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // Minimal surface for inspection and diagnostics from the browser console.
  window.TSW = {
    store,
    recovery,
    composeFile: () => composeFile(store.state),
    importData,
    // The notes a conversion brings, taken as the notes of the document on screen: the last
    // step of File › Import, callable without the file dialog.
    adoptNotes: (notes) => adoptNotes(store, notes),
    // Where the reader is in the rendered document, as the trail and the contents see it.
    documentPosition,
    // The picture pipeline, so an encoding can be tried from the console without a file dialog.
    images: { prepareImage, reencodeAsset, canEncodeWebp },
    // The Word file as bytes, without downloading it: handy to check an export from the console.
    buildWord: async () => {
      const doc = store.resolvedDoc();
      const [images, graph] = await Promise.all([renderFigures(doc, store.state.assets, store.state.doc), renderGraphPicture(doc, store.state.doc)]);
      return buildDocx({ doc, base: store.state.doc, history: store.state.history, variant: store.activeVariant(), images, graph });
    },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
