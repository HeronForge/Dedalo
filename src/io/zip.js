// A minimal ZIP writer, because a .docx is a ZIP of XML parts and the whole point of this
// tool is to depend on nothing. Deflate comes from the browser itself when it is available
// (the same CompressionStream the revision history already uses); otherwise entries are
// stored uncompressed, which every unzipper — Word included — reads just as well.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

const toBytes = (data) => (typeof data === 'string' ? encoder.encode(data) : data);

async function deflateRaw(bytes) {
  if (typeof globalThis.CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null; // the browser does not know deflate-raw: fall back to storing
  }
}

/**
 * @param {Array<{name: string, data: Uint8Array|string}>} entries
 * @param {object} [options] `compress: false` stores the entries as they are
 * @returns {Promise<Uint8Array>} the ZIP archive
 */
export async function createZip(entries, { compress = true } = {}) {
  const prepared = [];
  for (const entry of entries) {
    const raw = toBytes(entry.data);
    const deflated = compress ? await deflateRaw(raw) : null;
    const useDeflate = deflated && deflated.length < raw.length;
    prepared.push({
      name: entry.name,
      nameBytes: encoder.encode(entry.name),
      method: useDeflate ? 8 : 0,
      crc: crc32(raw),
      body: useDeflate ? deflated : raw,
      size: raw.length,
    });
  }

  const localSize = prepared.reduce((n, e) => n + 30 + e.nameBytes.length + e.body.length, 0);
  const centralSize = prepared.reduce((n, e) => n + 46 + e.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let offset = 0;

  const u16 = (v) => { view.setUint16(offset, v, true); offset += 2; };
  const u32 = (v) => { view.setUint32(offset, v >>> 0, true); offset += 4; };
  const raw = (bytes) => { out.set(bytes, offset); offset += bytes.length; };

  // A fixed timestamp keeps the output byte for byte reproducible: 2020-01-01 00:00.
  const DOS_TIME = 0;
  const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

  for (const entry of prepared) {
    entry.offset = offset;
    u32(0x04034b50); u16(20); u16(0); u16(entry.method); u16(DOS_TIME); u16(DOS_DATE);
    u32(entry.crc); u32(entry.body.length); u32(entry.size);
    u16(entry.nameBytes.length); u16(0);
    raw(entry.nameBytes);
    raw(entry.body);
  }

  const centralStart = offset;
  for (const entry of prepared) {
    u32(0x02014b50); u16(20); u16(20); u16(0); u16(entry.method); u16(DOS_TIME); u16(DOS_DATE);
    u32(entry.crc); u32(entry.body.length); u32(entry.size);
    u16(entry.nameBytes.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(entry.offset);
    raw(entry.nameBytes);
  }

  // The size of the central directory has to be measured before writing the end record:
  // u16 and u32 advance `offset`, so computing it inline would count the record itself and
  // hand the reader a directory twelve bytes longer than it is. Lenient unzippers rescan and
  // shrug; Word declares the file damaged.
  const centralDirectorySize = offset - centralStart;
  u32(0x06054b50); u16(0); u16(0); u16(prepared.length); u16(prepared.length);
  u32(centralDirectorySize); u32(centralStart); u16(0);

  return out;
}

/**
 * Reads back an archive written here. Only what the tests need: the entry names and their
 * contents, straight from the central directory.
 * @returns {Promise<Map<string, Uint8Array>>}
 */
export async function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Not a ZIP archive: the end of central directory is missing.');

  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const out = new Map();
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(pointer, true) !== 0x02014b50) throw new Error('Damaged central directory.');
    const method = view.getUint16(pointer + 10, true);
    const compressed = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(bytes.subarray(pointer + 46, pointer + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const body = bytes.subarray(start, start + compressed);

    out.set(name, method === 8 ? await inflateRaw(body) : body);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
