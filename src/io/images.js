// Embedded images: re-compression, content hash and shared pool.
// The pool is indexed by hash, so the same image used several times weighs once
// and the stored revisions carry no copies of it.

export const MAX_SIDE = 1600;
export const JPEG_QUALITY = 0.85;
export const WEBP_QUALITY = 0.85;
export const SIZE_WARNING_BYTES = 20 * 1024 * 1024;

const VECTOR = 'image/svg+xml';

export const FORMAT_LABEL = {
  'image/webp': 'WebP',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  [VECTOR]: 'SVG',
};

export const formatLabel = (mime) => FORMAT_LABEL[mime] || (mime || '').replace('image/', '').toUpperCase() || '—';

/**
 * Whether this browser can write WebP from a canvas. Every current one can; Safari before
 * 16.4 cannot, and there it falls back to PNG or JPEG rather than storing something broken.
 * No library is involved either way: the encoders are the browser's own.
 */
let webpEncoder = null;
export function canEncodeWebp() {
  if (webpEncoder === null) {
    try {
      const probe = document.createElement('canvas');
      probe.width = 1;
      probe.height = 1;
      webpEncoder = probe.toDataURL('image/webp').startsWith('data:image/webp');
    } catch {
      webpEncoder = false;
    }
  }
  return webpEncoder;
}

const encode = (canvas, mime, quality, width, height) => {
  const url = canvas.toDataURL(mime, quality);
  // A browser that cannot write the format hands back a PNG without saying so.
  const actual = url.slice(5, url.indexOf(';'));
  return { mime: actual, data: url.slice(url.indexOf(',') + 1), width, height };
};

async function decode(file) {
  try {
    return await createImageBitmap(file);
  } catch {
    return null; // a vector without intrinsic size, or a format this browser cannot read
  }
}

/**
 * The size of a picture the bitmap decoder would not take — an SVG, typically. The dimensions
 * are what gives the detail views their proportions, so it is worth one more attempt.
 */
function measure(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (value) => { URL.revokeObjectURL(url); resolve(value); };
    img.onload = () => done({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
    img.onerror = () => done({ width: 0, height: 0 });
    img.src = url;
  });
}

/**
 * Reads a File and returns the asset ready for the pool.
 *
 * Any common format goes in; what comes out is whichever encoding is smallest, WebP first —
 * it is typically a third of the JPEG and a fifth of the PNG at the same quality, and the
 * whole document travels as one file, so every kilobyte is one the reader waits for.
 * A vector image is left alone: rasterising it would throw away the reason it is a vector.
 */
export async function prepareImage(file) {
  const original = await fileAsBase64(file);
  const bitmap = await decode(file);

  if ((file.type || '') === VECTOR) {
    const size = bitmap ? { width: bitmap.width, height: bitmap.height } : await measure(file);
    return withId({ mime: VECTOR, data: original.data, name: file.name, ...size }, original);
  }
  if (!bitmap) throw new Error('this browser cannot read that image format');

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close && bitmap.close();

  const withAlpha = hasTransparency(ctx, w, h);
  const candidates = [];
  if (canEncodeWebp()) candidates.push(encode(canvas, 'image/webp', WEBP_QUALITY, w, h));
  // The fallback keeps what the picture needs: PNG where there is transparency, JPEG where
  // there is not. It also wins outright on the rare drawing that PNG stores better.
  candidates.push(encode(canvas, withAlpha ? 'image/png' : 'image/jpeg', JPEG_QUALITY, w, h));
  // Re-encoding does not always pay: an image already well compressed and small enough is
  // kept exactly as it was uploaded.
  if (scale === 1) {
    candidates.push({ mime: file.type || 'application/octet-stream', data: original.data, width: bitmap.width, height: bitmap.height });
  }

  const best = candidates.reduce((a, b) => (b.data.length < a.data.length ? b : a));
  return withId({ ...best, name: file.name }, original);
}

/** The asset, its identity, and what the re-encoding cost or saved. */
async function withId(asset, original) {
  asset.id = await contentHash(asset.data);
  asset.sourceBytes = base64Bytes(original.data);
  return asset;
}

/**
 * Re-encodes an image already in the pool, keeping its id: the id names the picture, and the
 * issued revisions refer to it by that name. Recomputing it would strand them.
 */
export async function reencodeAsset(asset) {
  if (!asset || asset.mime === VECTOR) return null;
  const bitmap = await decode(dataUrlToBlob(asset));
  if (!bitmap) return null;

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close && bitmap.close();

  const candidates = [];
  if (canEncodeWebp()) candidates.push(encode(canvas, 'image/webp', WEBP_QUALITY, w, h));
  if (hasTransparency(ctx, w, h)) candidates.push(encode(canvas, 'image/png', JPEG_QUALITY, w, h));
  if (!candidates.length) return null;

  const best = candidates.reduce((a, b) => (b.data.length < a.data.length ? b : a));
  if (best.data.length >= asset.data.length) return null; // nothing to gain
  return { ...asset, ...best };
}

function dataUrlToBlob(asset) {
  const binary = atob(asset.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: asset.mime });
}

export const base64Bytes = (data) => Math.ceil(((data || '').length * 3) / 4);

function hasTransparency(ctx, w, h) {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(4, Math.floor(data.length / 4 / 20000) * 4);
    for (let i = 3; i < data.length; i += step) if (data[i] < 255) return true;
    return false;
  } catch {
    return true; // with a tainted canvas we stay on PNG, which loses nothing
  }
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result);
      resolve({ data: s.slice(s.indexOf(',') + 1) });
    };
    fr.readAsDataURL(file);
  });
}

/** SHA-256 of the content: two identical images share the same pool entry. */
export async function contentHash(base64) {
  const bytes = new TextEncoder().encode(base64);
  if (!globalThis.crypto || !crypto.subtle) return 'img' + simpleHash(base64);
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function simpleHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

export const assetUrl = (assets, id) => {
  const a = assets && assets[id];
  return a ? `data:${a.mime};base64,${a.data}` : '';
};

export const assetsWeight = (assets) =>
  Object.values(assets || {}).reduce((n, a) => n + base64Bytes(a.data), 0);

/** Drops from the pool the images the document no longer references. */
export function pruneAssets(doc, assets, history) {
  const used = new Set();
  if (doc.header && doc.header.logoAssetId) used.add(doc.header.logoAssetId);
  for (const img of doc.images || []) if (img.assetId) used.add(img.assetId);
  // Every issued revision still shows the pictures it was issued with. A revision that does
  // not say which ones — issued by an earlier build, not yet completed on opening — means the
  // answer is unknown, and the pool is kept whole rather than guessed at.
  for (const r of (history && history.revisions) || []) {
    if (!Array.isArray(r.assetIds)) return { ...(assets || {}) };
    for (const id of r.assetIds) used.add(id);
  }
  const out = {};
  for (const [id, a] of Object.entries(assets || {})) if (used.has(id)) out[id] = a;
  return out;
}

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
