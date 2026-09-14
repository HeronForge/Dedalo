// Application state.
//
// Every change goes through here and is expressed on a path (see paths.js).
// When a variant is selected the same change does not touch the base document but is
// recorded as a customisation of that variant: this is how a variant can add, change or
// remove anything without dedicated code for each field.
import { getAt, setAt, addAt, removeAt, samePath } from './paths.js';
import { computeCodes } from './codes.js';
import { resolveVariant, recordOverride, OP } from './variants.js';
import { varianceIndex } from './variance.js';
import { emptyDocument } from './schema.js';
import { emptyHistory } from '../history/revisions.js';
import { validateDocument } from './validate.js';

const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

const UNDO_LIMIT = 60;
const COALESCE_WINDOW = 1200; // ms within which several keystrokes on one field are a single undo

export function createStore(data) {
  const listeners = new Set();
  const lightListeners = new Set();
  const st = {
    doc: data.doc || emptyDocument(),
    history: data.history || emptyHistory(),
    assets: data.assets || {},
    variantId: '',
    // The file opens on the document: most of the people who receive it come to read it,
    // and whoever came to edit is one click away from any section.
    section: 'document',
    selection: null,
    dirty: false,
  };
  let undo = [];
  let redo = [];
  let lastCoalesce = { key: null, time: 0 };
  let resolvedCache = null;
  let varianceCache = null;
  let validationCache = null;

  // "Light" changes (keystrokes) do not redraw the interface: they only refresh the
  // status indicators, so the field being typed into keeps the focus.
  const notify = (light) => {
    resolvedCache = null;
    varianceCache = null;
    validationCache = null;
    lightListeners.forEach((f) => f(st));
    if (!light) listeners.forEach((f) => f(st));
  };

  const api = {
    state: st,

    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },

    subscribeLight(f) { lightListeners.add(f); return () => lightListeners.delete(f); },

    /** Forces a full redraw (used when leaving a text field). */
    refresh() { notify(false); },

    /**
     * Refreshes the indicators alone, for something that changed around the document rather
     * than inside it — the recovery copy has just been written, and the status bar says so.
     * The full redraw would take the focus out of the field being typed into.
     */
    refreshLight() { notify(true); },

    /**
     * The codes of the document, always numbered on the base one: under a variant a stage
     * keeps the code it has in the base document, and the gaps say what the variant leaves out.
     */
    codes() {
      return computeCodes(api.resolvedDoc(), st.doc);
    },

    /**
      * What the variants make different, read from the base document: the answer is the same
      * whether the base or one of the variants is on screen, which is the point of it.
      */
    variance() {
      if (!varianceCache) varianceCache = varianceIndex(st.doc);
      return varianceCache;
    },

    /**
     * The validation of the document on screen, computed once per change however many parts
     * of the interface ask for it: the bar at the bottom, the panel, the document view. It is
     * the costliest thing the editor does on a large document, and it was being done twice
     * per redraw and once per keystroke.
     */
    validation() {
      if (!validationCache) validationCache = validateDocument(api.resolvedDoc(), { history: st.history, base: st.doc });
      return validationCache;
    },

    /** Document resolved for the selected variant (or the base one). */
    resolvedDoc() {
      if (!resolvedCache) resolvedCache = resolveVariant(st.doc, st.variantId).doc;
      return resolvedCache;
    },

    activeVariant() {
      return st.variantId ? (st.doc.variants || []).find((v) => v.id === st.variantId) || null : null;
    },

    /**
     * The variant that records changes, when one is active.
     * The definition of the variants themselves is never variant specific:
     * editing it always writes on the base document.
     */
    recordingVariant(path) {
      if (path && path[0] === 'variants') return null;
      return api.activeVariant();
    },

    /** Free form change of the base document (used where paths are not convenient). */
    change(fn, coalesceKey, light) {
      pushUndo(coalesceKey);
      fn(st.doc);
      st.dirty = true;
      notify(light);
    },

    /**
     * A change to the document and its history together, as one step: validating a draft
     * moves the revision number and adds the frozen copy at once, and an undo that put back
     * the number and left the copy would leave a number the record says is taken.
     */
    changeAll(fn) {
      pushUndo(null);
      fn(st);
      st.dirty = true;
      notify();
    },

    /** Reads a value from the resolved document. */
    read(path) { return getAt(api.resolvedDoc(), path); },

    /** Writes a value: on the base document, or as a customisation of the active variant. */
    write(path, value, coalesceKey, light) {
      const variant = api.recordingVariant(path);
      pushUndo(coalesceKey);
      if (variant) recordOverride(variant, OP.SET, path, clone(value));
      else setAt(st.doc, path, value);
      st.dirty = true;
      notify(light);
    },

    /** Appends an element to a collection. */
    add(path, entity, index) {
      const variant = api.recordingVariant(path);
      pushUndo(null);
      if (variant) variant.overlay.push({ op: OP.ADD, path, value: clone(entity), index });
      else addAt(st.doc, path, entity, index);
      st.dirty = true;
      notify();
      return entity;
    },

    /** Removes an element. Within a variant, an element the variant itself added is un-added. */
    remove(path) {
      const variant = api.recordingVariant(path);
      pushUndo(null);
      if (variant) {
        const id = lastId(path);
        const iAdd = variant.overlay.findIndex((o) => o.op === OP.ADD && o.value && o.value.id === id && samePath(o.path, path.slice(0, -1)));
        if (iAdd >= 0) {
          variant.overlay.splice(iAdd, 1);
          variant.overlay = variant.overlay.filter((o) => !underPath(o.path, path));
        } else {
          variant.overlay = variant.overlay.filter((o) => !underPath(o.path, path));
          variant.overlay.push({ op: OP.REMOVE, path });
        }
      } else {
        removeAt(st.doc, path);
      }
      st.dirty = true;
      notify();
    },

    /**
     * Moves an element inside its array. Order belongs to the base document: a variant says
     * what changes, not in which sequence things are read, so with a variant active the move
     * is refused instead of quietly editing the base underneath it.
     */
    move(arrayPath, id, delta) {
      if (api.recordingVariant(arrayPath)) return false;
      const arr = getAt(st.doc, arrayPath);
      if (!Array.isArray(arr)) return false;
      const i = arr.findIndex((e) => e.id === id);
      const j = i + delta;
      // Already at the edge: nothing moves, so nothing is recorded — not an undo step, not an
      // unsaved change the file would be said to have.
      if (i < 0 || j < 0 || j >= arr.length) return false;
      pushUndo(null);
      arr.splice(j, 0, arr.splice(i, 1)[0]);
      st.dirty = true;
      notify();
      return true;
    },

    /** True when the field is customised by the active variant. */
    isOverridden(path) {
      const v = api.recordingVariant(path);
      return !!(v && v.overlay.some((o) => samePath(o.path, path)));
    },

    /** Drops the variant customisation on that path. */
    resetOverride(path) {
      const v = api.activeVariant();
      if (!v) return;
      pushUndo(null);
      v.overlay = v.overlay.filter((o) => !samePath(o.path, path));
      st.dirty = true;
      notify();
    },

    set(fields) {
      // The history is document, not screen: a change to it is a step like any other.
      if ('history' in fields) { api.changeAll((s) => { s.history = fields.history; }); const { history, ...rest } = fields; fields = rest; }
      Object.assign(st, fields);
      notify();
    },

    /**
     * Says that the file on disk is no longer the document in hand. `set` alone does not:
     * it also carries what section is open, which is nobody's business but the screen's.
     */
    markDirty() { st.dirty = true; notify(); },

    /**
     * Another document altogether. Whether the file on disk holds it is for the caller to say:
     * a file just opened is on disk, an import or a new document is nowhere but on the screen,
     * and calling that «saved» is how a tab gets closed on an hour of work.
     */
    replaceAll({ doc, history, assets }, { dirty = false } = {}) {
      pushUndo(null);
      st.doc = doc;
      st.history = history;
      st.assets = assets;
      st.variantId = '';
      st.dirty = dirty;
      notify();
    },

    registerAsset(asset) {
      // A pool keyed by hash is only as good as the keys: an asset without one would land
      // under «undefined» and quietly replace the previous nameless picture.
      if (!asset || !asset.id) throw new Error('an image cannot enter the pool without its id');
      // sourceBytes travels with the picture: it is what the Images section shows as the
      // weight the original had before it was re-encoded.
      st.assets = { ...st.assets, [asset.id]: {
        mime: asset.mime, data: asset.data, width: asset.width, height: asset.height,
        name: asset.name, ...(asset.sourceBytes ? { sourceBytes: asset.sourceBytes } : {}),
      } };
      st.dirty = true;
      notify();
    },

    undo() {
      if (!undo.length) return false;
      redo.push(snapshot());
      restore(undo.pop());
      lastCoalesce = { key: null, time: 0 };
      notify();
      return true;
    },

    redo() {
      if (!redo.length) return false;
      undo.push(snapshot());
      restore(redo.pop());
      notify();
      return true;
    },

    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    markSaved() { st.dirty = false; notify(); },
  };

  function pushUndo(coalesceKey) {
    const now = Date.now();
    if (coalesceKey && lastCoalesce.key === coalesceKey && now - lastCoalesce.time < COALESCE_WINDOW) {
      lastCoalesce.time = now;
      return;
    }
    lastCoalesce = { key: coalesceKey || null, time: now };
    undo.push(snapshot());
    if (undo.length > UNDO_LIMIT) undo.shift();
    redo = [];
  }

  // What an undo step holds: the document, copied, and the history, by reference — every
  // change to the history replaces it with a new object rather than editing it in place, so
  // the reference is as good as a copy and costs nothing.
  const snapshot = () => ({ doc: clone(st.doc), history: st.history });
  const restore = (step) => {
    st.doc = step.doc;
    st.history = step.history;
    st.dirty = true;
  };

  return api;
}

const lastId = (path) => {
  const last = path[path.length - 1];
  return typeof last === 'string' && last.startsWith('#') ? last.slice(1) : null;
};

const underPath = (path, prefix) => prefix.every((s, i) => path[i] === s);
