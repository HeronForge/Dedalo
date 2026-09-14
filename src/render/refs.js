// The links that hold the document together: a code in a step, the entity it names.
//
// Two kinds, and the difference is what the reader can do with them. A point, a resource, a
// command, a variable or a stage can be explained in place, so its reference opens a detail
// card. An image, an interface, a test or a step cannot: their reference leads to the editor,
// where the entity actually lives — unless the document forbids it (see model settings,
// «no direct editing»), and then it is plain text.
import { h } from '../ui/dom.js';
import { codeOf, labelOf } from '../model/codes.js';
import { fieldVaries, presenceVaries, variableVaries } from '../model/variance.js';

export const interleave = (items, sep) => items.flatMap((e, i) => (i ? [sep, e] : [e]));

export const shorten = (s, n = 26) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/** Code plus name, so the reader gets the meaning without leaving the page. */
export function ref(codes, index, id, max = 26) {
  const code = codeOf(codes, id);
  const name = (index.get(id) || {}).name || '';
  return h('a', { class: 'ref', href: '#ref-' + id, 'data-ref': id, title: name },
    h('span', { class: 'ref-code' }, code || '⟨?⟩'),
    name ? h('span', { class: 'ref-name' }, ' ' + shorten(name, max)) : null);
}

export const cardRef = (ctx, id, max = 26) => ref(ctx.codes, ctx.index, id, max);

/** A reference with no card of its own: the click opens the entity in the editor. */
export function editRef(ctx, id, max = 30) {
  const label = labelOf(ctx.codes, ctx.index, id, max);
  if (!label) return '⟨?⟩';
  if (!ctx.directEditing) return label;
  return h('a', {
    class: 'ref ref-edit', href: '#ref-' + id, 'data-edit': id,
    title: `Open ${label} in the editor`,
  }, label);
}

/**
 * The code of an entity where the document defines it: the appendix row, the heading of a
 * stage, the code column of a step. There is nothing to pop up — the full detail is already
 * on the page — so the click leads to the editor, which is the only thing left to do with it.
 */
export function defRef(ctx, id, text) {
  const label = text != null ? text : codeOf(ctx.codes, id);
  if (!label) return '';
  if (!ctx.directEditing) return label;
  return h('a', {
    class: 'ref ref-edit ref-def', href: '#ref-' + id, 'data-edit': id,
    title: 'Open in the editor',
  }, label);
}

/**
 * A value that is bound to a global variable: the text as it prints, wrapped so the reader
 * can open the variable and see what it is worth and why. A constant stays plain text.
 *
 * When a variant gives that variable another value the reference is marked as well: at the
 * bench «11 V … 14 V» has to say by itself whether it is the limit for every product this
 * document covers or only for the one in front of you.
 */
export function valueRef(ctx, value, text) {
  if (!text) return text;
  const id = value && value.mode === 'variable' ? value.variableId : null;
  if (!id || !ctx.index.has(id)) return text;
  const who = variableVaries(ctx.variance, id);
  return h('a', {
    class: ['ref', 'ref-value', who.length && 'varies'], href: '#ref-' + id, 'data-ref': id,
    title: who.length ? variesTitle(who) : 'Global variable',
  }, text);
}

// ---- what changes from one variant to the next -------------------------------
//
// One mark for all of it: the text itself turns electric blue, a colour nothing else on the
// page wears, so it is found at a glance among codes, tags and plates. What it means is always
// the same — this is not the same for every product — and the mark carries what it is about
// (`data-varies`), so a click or a pointer resting on it can answer with the value of each.

/** Wraps a piece of text that a variant rewrites. Untouched text is returned as it came. */
export function varying(ctx, id, field, ...content) {
  const who = fieldVaries(ctx.variance, id, field);
  if (!who.length) return content.length === 1 ? content[0] : content;
  // A paragraph inside a span is painted on its line boxes alone and reads as a mistake:
  // whole blocks are wrapped in a block of their own.
  const block = content.some((c) => c && c.tagName && BLOCK_TAGS.has(c.tagName));
  return h(block ? 'div' : 'span', {
    class: ['varies', block && 'varies-block'], title: variesTitle(who),
    dataset: { varies: `${id}|${field}` },
  }, ...content);
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'TABLE', 'UL', 'OL', 'SECTION']);

/** The same mark on the code of something a variant does not run, or adds of its own. */
export function presenceMark(ctx, id, node) {
  const { added, removed } = presenceVaries(ctx.variance, id);
  if (!added.length && !removed.length) return node;
  const said = [];
  if (removed.length) said.push(`not run by ${names(removed)}`);
  if (added.length) said.push(`added by ${names(added)}`);
  return h('span', {
    class: 'varies', title: `Depends on the variant — ${said.join('; ')}`, dataset: { varies: `${id}|` },
  }, node);
}

const variesTitle = (who) => `Changes with the variant — ${names(who)}`;

const names = (who) => (who.length > 3 ? `${who.slice(0, 3).join(', ')} and ${who.length - 3} more` : who.join(', '));

/** A list of references as nodes rather than as one joined string. */
export const refList = (ctx, ids, make, separator = ', ', fallback = '—') => {
  const items = (ids || []).map((id) => make(ctx, id));
  return items.length ? interleave(items, separator) : [fallback];
};
