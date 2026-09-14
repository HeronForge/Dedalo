// Paginated preview and PDF printing.
// The document is composed by render/document.js and paginated by paged.js inside the same
// page: what you see on screen is exactly what comes out of the printer.
import { h, button, toast } from '../ui/dom.js';
import { renderDocument } from '../render/document.js';
import { pagedStyle } from './paged-style.js';

const CONTAINER_ID = 'tsw-print';

let running = false;
let previewer = null;

/** The repeated «superseded» mark, as a tiled background image. */
export function watermark(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="300">`
    + `<text x="20" y="190" transform="rotate(-24 230 150)" font-family="Segoe UI, Arial, sans-serif"`
    + ` font-size="30" font-weight="700" fill="rgba(179,38,30,0.11)">SUPERSEDED - ${escapeXml(label)}</text></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Composes the paginated document.
 * @returns {Promise<HTMLElement>} the container of the pages
 */
export async function composePreview({ doc, base, assets, history, variant, obsolete }) {
  if (!window.Paged || !window.Paged.Previewer) throw new Error('Pagination engine not available.');
  const content = renderDocument(doc, { assets, history, variant, base });
  // A printed copy of a superseded revision that looks exactly like the current one is the
  // accident this whole feature could cause: it is watermarked, on paper too.
  const container = h('div', { id: CONTAINER_ID, class: ['print-container', obsolete && 'print-obsolete'] });
  if (obsolete) container.style.setProperty('--obsolete-label', watermark(obsolete));
  document.body.appendChild(container);
  previewer = new window.Paged.Previewer();
  await previewer.preview(content, [{ 'tsw-print.css': pagedStyle() }], container);
  return container;
}

/** Opens the paginated preview full screen, with the print button. */
export async function openPreview(data) {
  if (running) return;
  running = true;
  const waiting = toast('Paginating…', 'info', 60000);
  document.body.classList.add('print-mode');
  try {
    const container = await composePreview(data);
    const pages = container.querySelectorAll('.pagedjs_page').length;
    const bar = h('div', { class: 'preview-bar' },
      h('span', {}, `Paginated preview — ${pages} pages`),
      button('Print / Save as PDF', () => window.print(), { class: 'btn-primary' }),
      button('Close preview', closePreview));
    document.body.appendChild(bar);
    waiting.remove();
  } catch (err) {
    waiting.remove();
    closePreview();
    toast('Pagination failed: ' + err.message, 'error', 8000);
  } finally {
    running = false;
  }
}

export function closePreview() {
  document.body.classList.remove('print-mode');
  // The pagination engine keeps its own work area and stylesheets alive: without tearing
  // them down, a second preview in the same session walks over stale nodes.
  if (previewer) {
    try { previewer.chunker && previewer.chunker.destroy(); } catch { /* already gone */ }
    try { previewer.polisher && previewer.polisher.destroy(); } catch { /* already gone */ }
    previewer = null;
  }
  const c = document.getElementById(CONTAINER_ID);
  if (c) c.remove();
  document.querySelectorAll('.preview-bar').forEach((b) => b.remove());
  // paged.js injects its own stylesheets: they must go, or they pollute the editor.
  document.querySelectorAll('style[data-pagedjs-inserted-styles]').forEach((s) => s.remove());
}

