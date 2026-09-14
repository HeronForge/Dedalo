// Pictures for the Word export.
//
// Word has no way to lay markers over a picture the way the browser does with absolute
// positioning, and it does not read SVG reliably either. So the browser draws each figure —
// the image with its markers burnt in, and the stage graph — onto a canvas and hands over PNG
// bytes. Everything here needs a DOM; the Word writer itself does not.
import { computeCodes, codeOf, markerLabel } from '../model/codes.js';
import { assetUrl } from '../io/images.js';
import { stageGraph } from '../render/graph.js';

const MAX_WIDTH = 1400; // enough for print, small enough to keep the .docx sane

/** Loads a data URL into an image element. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The picture could not be read.'));
    img.src = src;
  });
}

async function canvasToPng(canvas) {
  const dataUrl = canvas.toDataURL('image/png');
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { data: bytes, mime: 'image/png', width: canvas.width, height: canvas.height };
}

/** The red marker of the printed document, drawn by hand. */
function drawMarker(ctx, label, x, y, scale) {
  const fontSize = Math.max(10, Math.round(13 * scale));
  ctx.font = `bold ${fontSize}px Consolas, monospace`;
  const textWidth = ctx.measureText(label).width;
  const padding = fontSize * 0.45;
  const w = Math.max(fontSize * 1.7, textWidth + padding * 2);
  const h = fontSize * 1.5;
  const radius = label.length > 2 ? fontSize * 0.35 : h / 2;

  ctx.beginPath();
  const left = x - w / 2;
  const top = y - h / 2;
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + w, top, left + w, top + h, radius);
  ctx.arcTo(left + w, top + h, left, top + h, radius);
  ctx.arcTo(left, top + h, left, top, radius);
  ctx.arcTo(left, top, left + w, top, radius);
  ctx.closePath();
  ctx.fillStyle = '#d4342a';
  ctx.fill();
  ctx.lineWidth = Math.max(1, scale);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + fontSize * 0.05);
}

/**
 * One PNG per document image, markers included, plus the logo under the key "logo".
 * @returns {Promise<Map<string, {data: Uint8Array, mime: string, width: number, height: number}>>}
 */
export async function renderFigures(doc, assets, base) {
  const codes = computeCodes(doc, base);
  const out = new Map();

  for (const image of doc.images || []) {
    const url = assetUrl(assets, image.assetId);
    if (!url) continue;
    try {
      const source = await loadImage(url);
      const scale = Math.min(1, MAX_WIDTH / (source.naturalWidth || source.width || MAX_WIDTH));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round((source.naturalWidth || source.width) * scale));
      canvas.height = Math.max(1, Math.round((source.naturalHeight || source.height) * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

      const markerScale = canvas.width / 640;
      for (const point of doc.points || []) {
        for (const marker of point.markers || []) {
          if (marker.imageId !== image.id) continue;
          drawMarker(ctx, markerLabel(point, codeOf(codes, point.id)), marker.x * canvas.width, marker.y * canvas.height, markerScale);
        }
      }
      out.set(image.id, await canvasToPng(canvas));
    } catch {
      // A picture that cannot be drawn is simply left out: the export goes on without it.
    }
  }

  const logoId = (doc.header || {}).logoAssetId;
  if (logoId) {
    try {
      const source = await loadImage(assetUrl(assets, logoId));
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 400 / (source.naturalWidth || 400));
      canvas.width = Math.max(1, Math.round((source.naturalWidth || 200) * scale));
      canvas.height = Math.max(1, Math.round((source.naturalHeight || 80) * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      out.set('logo', await canvasToPng(canvas));
    } catch { /* no logo in the Word header, then */ }
  }

  return out;
}

/** The stage graph as a picture: the SVG is drawn onto a canvas and handed over as PNG. */
export async function renderGraphPicture(doc, base) {
  if (!(doc.stages || []).length) return null;
  try {
    const codes = computeCodes(doc, base);
    const svg = stageGraph(doc, { codes });
    const viewBox = (svg.getAttribute('viewBox') || '0 0 800 600').split(/\s+/).map(Number);
    const width = viewBox[2] || 800;
    const height = viewBox[3] || 600;

    // A standalone SVG needs its own size and the styles it relies on, since the page
    // stylesheet does not travel with it into the canvas.
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = GRAPH_STYLE;
    svg.insertBefore(style, svg.firstChild);

    const source = new XMLSerializer().serializeToString(svg);
    const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
    const image = await loadImage(url);

    const scale = Math.min(2, MAX_WIDTH / width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToPng(canvas);
  } catch {
    return null;
  }
}

const GRAPH_STYLE = `
.graph-node rect { fill: #f4f7fa; stroke: #7a8592; stroke-width: 1; }
.graph-node-exclusive rect { stroke: #8c2020; stroke-width: 2.5; }
.graph-node-setup rect { fill: #f3f0fa; stroke: #5b4b9a; stroke-dasharray: 4 3; }
.graph-code { font-size: 11px; fill: #10559a; font-family: Consolas, monospace; }
.graph-name { font-size: 12px; fill: #1c2530; font-family: "Segoe UI", Arial, sans-serif; }
.graph-times { font-size: 10px; fill: #5b4b9a; font-family: Consolas, monospace; }
.graph-edge { fill: none; stroke: #5a6b7d; stroke-width: 1.4; }
.graph-arrow { fill: #5a6b7d; }
.graph-arrow-call { fill: #5b4b9a; }
.graph-call { fill: none; stroke: #5b4b9a; stroke-width: 1.2; stroke-dasharray: 2 3; }
.graph-note { font-size: 9.5px; fill: #8c2020; font-family: "Segoe UI", Arial, sans-serif; paint-order: stroke; stroke: #fff; stroke-width: 3px; stroke-linejoin: round; }
.graph-band { stroke: #c3ccd6; stroke-width: 1; stroke-dasharray: 6 4; }
.graph-band-label { font-size: 11px; fill: #62707e; font-family: "Segoe UI", Arial, sans-serif; }
`;
