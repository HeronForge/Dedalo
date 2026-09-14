// The Word export command: draw the pictures, assemble the file, hand it to the browser.
import { toast } from '../ui/dom.js';
import { download, suggestedFileName } from '../io/file.js';
import { formatBytes } from '../io/images.js';
import { buildDocx } from './docx.js';
import { renderFigures, renderGraphPicture } from './figures.js';

/**
 * Writes the document as a Word file. The pictures are drawn first — Word cannot lay the point
 * markers over an image, so the browser burns them in — then the OOXML parts are assembled.
 */
export async function exportWord(store) {
  const doc = store.resolvedDoc();
  const waiting = toast('Building the Word document…', 'info', 30000);
  try {
    const [images, graph] = await Promise.all([
      renderFigures(doc, store.state.assets, store.state.doc),
      renderGraphPicture(doc, store.state.doc),
    ]);
    const bytes = await buildDocx({
      doc, base: store.state.doc, history: store.state.history,
      variant: store.activeVariant(), images, graph,
    });
    const name = suggestedFileName(doc).replace(/\.html$/, '.docx');
    const saved = download(bytes, name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    waiting.remove();
    toast(`Word document written: ${name} (${formatBytes(saved.bytes)}). Open it and press Ctrl+A then F9 to fill in the table of contents.`, 'ok', 9000);
  } catch (err) {
    waiting.remove();
    toast('The Word export failed: ' + err.message, 'error', 8000);
  }
}
