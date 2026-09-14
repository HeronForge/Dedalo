// The glossary: what the acronyms of the document stand for, and which ones it uses.
//
// A specification is read by people who did not write it — an operator, a customer, a
// certifier — and «check the CP after the RCM trips» is a sentence only for whoever already
// knows the product. The glossary is a chapter of its own, one line per term; this module
// also finds the acronyms the text uses, so the chapter can be checked against the document
// rather than against memory.

const CODE_LIKE = /^(?:REF|RES|PRT|IF|CMD|AP|FIG|V|STG|SET|T|S)$/;

/**
 * The acronyms the text uses: words of two to six capitals, with no digit — «PWM», «OCPP»,
 * «RCM» — that are not one of the tool's own codes (`STG-04`, `CMD-12`). Case is what makes
 * an acronym: «OCPP» counts, «Ocpp» does not. A token with a digit is a part number, a pin
 * or a register (`TP12`, `RS485`, `CRC16`), and those belong to the appendices, not here.
 * @returns {string[]} unique, in order of first appearance
 */
export function acronymsInText(text) {
  const out = [];
  const seen = new Set();
  const re = /(?<![\w$#-])([A-Z]{2,6})(?![\w-])/g;
  for (const m of String(text || '').matchAll(re)) {
    const word = m[1];
    if (CODE_LIKE.test(word) || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}

/**
 * The prose of the document, in reading order: what is written for a person. Formats,
 * addresses, pins and signals are left out — «OK», «GND», «CRC» there are the thing itself,
 * and a glossary that explains every token of a frame explains nothing.
 */
export function documentTexts(doc) {
  const texts = [];
  const push = (v) => { if (typeof v === 'string' && v) texts.push(v); };
  const h = doc.header || {};
  push(h.title); push(h.product); push(h.project); push(h.disclaimer);
  push((doc.description || {}).product); push((doc.description || {}).testing);
  for (const r of doc.references || []) { push(r.title); push(r.notes); }
  for (const v of doc.variables || []) push(v.description);
  for (const v of doc.variants || []) { push(v.name); push(v.description); }
  for (const r of doc.resources || []) { push(r.name); push(r.category); push(r.notes); for (const c of r.characteristics || []) push(c.name); }
  for (const p of doc.protocols || []) { push(p.name); push(p.family); push(p.description); push(p.notes); }
  for (const i of doc.interfaces || []) { push(i.name); push(i.type); push(i.notes); }
  for (const c of doc.commands || []) { push(c.name); push(c.notes); }
  for (const p of doc.points || []) { push(p.name); push(p.notes); for (const c of p.characteristics || []) push(c.name); }
  for (const i of doc.images || []) { push(i.name); push(i.caption); }
  for (const stage of doc.stages || []) {
    push(stage.name); push(stage.description);
    for (const held of stage.heldStimuli || []) push(held.note);
    for (const t of stage.tests || []) {
      push(t.name); push(t.purpose);
      for (const s of t.steps || []) {
        push(s.description); push(s.note);
        for (const b of [s.stimulus, s.measurement]) {
          if (!b) continue;
          push(b.description);
          if (b.computed) push(b.computed.formula);
        }
        for (const c of (s.table || {}).columns || []) push(c.name);
        for (const r of (s.table || {}).rows || []) push(r.label);
      }
    }
  }
  return texts;
}

/** The acronyms the document uses, unique, in order of first appearance. */
export const acronymsInDocument = (doc) => acronymsInText(documentTexts(doc).join('\n'));

/** The acronyms the document uses and the glossary does not explain. */
export function undefinedAcronyms(doc) {
  const defined = new Set((doc.glossary || []).map((g) => String(g.term || '').trim().toUpperCase()).filter(Boolean));
  return acronymsInDocument(doc).filter((a) => !defined.has(a));
}

/** Glossary entries sorted as the chapter prints them: by term, case-insensitively. */
export const sortedGlossary = (doc) =>
  [...(doc.glossary || [])].sort((a, b) => String(a.term || '').localeCompare(String(b.term || ''), undefined, { sensitivity: 'base' }));
