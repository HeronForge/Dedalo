// Writes src/brand/dedalo.js from the files in build/brand/: the DEDALO logo (with its name,
// for the cover) and its mark (the D alone, for the running header), each as a WebP for the
// sheet and as a PNG for Word, embedded as data so the file carries them without a file
// beside it.
//
// The pictures themselves are made from the logo PNGs once (Pillow does it in one line:
// `Image.open(png).resize(...).save('dedalo.webp', quality=86)`); this script only embeds
// them. Run it again when a file changes:  node build/brand.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'src', 'brand', 'dedalo.js');

const webp = (name) => { const b = readFileSync(join(here, 'brand', name)); return { b, ...webpSize(b) }; };
const png = (name) => { const b = readFileSync(join(here, 'brand', name)); return { b, width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
const logo = webp('dedalo.webp');
const mark = webp('dedalo-mark.webp');
const logoPng = png('dedalo.png');
const markPng = png('dedalo-mark.png');

const js = `// The DEDALO logo and mark, as the build embeds them from build/brand/ — written by
// build/brand.mjs, run it again when a file there changes. The logo carries the name and goes
// on the cover; the mark is the D alone and goes in the running header. Kept as a module
// rather than an asset so that Node, which has no canvas and no fetch of a local file, can put
// them into the Word file as well as the sheet — and Word shows no WebP, so each travels once
// more as a PNG, as bare base64.
export const DEDALO_LOGO = 'data:image/webp;base64,${logo.b.toString('base64')}';
export const DEDALO_LOGO_SIZE = { width: ${logo.width}, height: ${logo.height} };
export const DEDALO_MARK = 'data:image/webp;base64,${mark.b.toString('base64')}';
export const DEDALO_MARK_SIZE = { width: ${mark.width}, height: ${mark.height} };
export const DEDALO_LOGO_PNG = '${logoPng.b.toString('base64')}';
export const DEDALO_LOGO_PNG_SIZE = { width: ${logoPng.width}, height: ${logoPng.height} };
export const DEDALO_MARK_PNG = '${markPng.b.toString('base64')}';
export const DEDALO_MARK_PNG_SIZE = { width: ${markPng.width}, height: ${markPng.height} };
`;
writeFileSync(target, js);
console.log(`src/brand/dedalo.js  logo ${logo.width}×${logo.height} (${logo.b.length} B webp, ${logoPng.b.length} B png); mark ${mark.width}×${mark.height} (${mark.b.length} B webp, ${markPng.b.length} B png)`);

/** The size in a WebP header: the lossy (VP8), lossless (VP8L) or extended (VP8X) form. */
function webpSize(b) {
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: (b.readUIntLE(24, 3)) + 1, height: (b.readUIntLE(27, 3)) + 1 };
  throw new Error('not a WebP file');
}
