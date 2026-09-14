// Stable internal identifiers: they never change for the whole life of an entity.
// They are the key for diffing, variant overlays and cross references.

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Ten characters of a 36-letter alphabet: 3.7e15 ids, so a document that reaches ten thousand
 * entities across its revisions has a chance of a clash too small to write down — six gave it
 * one in forty. Bytes that would favour the first four letters (256 is not a multiple of 36)
 * are thrown away rather than folded.
 */
const LENGTH = 10;
const UNBIASED = 252; // the largest multiple of 36 below 256

export function newId(prefix) {
  let s = '';
  while (s.length < LENGTH) {
    const buf = new Uint8Array(LENGTH * 2);
    (globalThis.crypto || {}).getRandomValues
      ? globalThis.crypto.getRandomValues(buf)
      : buf.forEach((_, i) => (buf[i] = Math.floor(Math.random() * 256)));
    for (const b of buf) if (b < UNBIASED && s.length < LENGTH) s += ALPHABET[b % ALPHABET.length];
  }
  return `${prefix}_${s}`;
}

/** Six characters is what earlier builds wrote; both shapes stay valid for good. */
export const isId = (v) => typeof v === 'string' && /^[a-z]+_[a-z0-9]{6,10}$/.test(v);
