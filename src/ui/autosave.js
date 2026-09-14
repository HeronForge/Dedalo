// The safety net: a copy of the work kept in the browser while one types.
//
// It is not a save and it is never called one. The file on disk changes only when it is
// downloaded again; what this does is make sure that a crash, a closed tab or a machine that
// reboots does not cost the session. Everything it needs is in io/recovery.js — this file is
// the part that has to know about timers, the status bar and the question asked on opening.
import { h, button, modal, toast } from './dom.js';
import {
  safeStorage, identityKey, docFingerprint, saveDraft, saveAssets, findDraft, dropDraft, pruneDrafts,
} from '../io/recovery.js';

/** Often enough that little is lost, rarely enough that nobody feels it while typing. */
const SNAPSHOT_INTERVAL = 15000;

/**
 * There is one editor per window, so there is one net. The status bar reads it to say whether
 * the work is covered, which is the only thing anybody needs to know about it.
 */
const net = { on: false, reason: '', at: '', pictures: true };

export const recoveryStatus = () => net;

export function setupRecovery(store, { storage = safeStorage(), interval = SNAPSHOT_INTERVAL } = {}) {
  if (!storage) {
    net.on = false;
    net.reason = 'this browser keeps no storage for a file opened this way';
    return { stop() {}, found: false };
  }

  let key = identityKey(store.state.doc);
  let base = docFingerprint(store.state.doc);
  let openedAssets = store.state.assets;
  let changed = false;
  let paused = true;     // until the question about an older draft has been answered
  let recovering = false; // the draft is being put back: it is not what the file on disk holds
  net.on = true;
  net.reason = '';

  const found = findDraft(storage, store.state.doc);
  pruneDrafts(storage, { except: key });

  const snapshot = () => {
    if (!net.on || paused || !store.state.dirty || !changed) return;
    const doc = store.state.doc; // the base document: a variant is recorded inside it
    const header = doc.header || {};
    const at = new Date().toISOString();
    const written = saveDraft(storage, key, {
      at,
      base,
      title: header.title || '',
      code: header.documentCode || '',
      revision: (doc.revision || {}).number || '',
      doc,
      history: store.state.history,
    });
    if (!written.ok) {
      // Trying again every fifteen seconds would only repeat the failure. Better to say once,
      // in the status bar, that from here on the work is not covered.
      net.on = false;
      net.reason = written.reason;
      store.refreshLight();
      changed = false;
      return;
    }
    net.at = at;
    // The pictures are the heavy half and they are already in the file that is open: only a
    // pool that has grown since then has anything the file could not give back.
    if (store.state.assets !== openedAssets) net.pictures = saveAssets(storage, key, store.state.assets).ok;
    // The status bar has something new to say and the document has not changed: the light
    // channel refreshes it without redrawing the section under the cursor. It also runs the
    // listener below, which is why what has still to be written is cleared afterwards.
    store.refreshLight();
    changed = false;
  };

  /** The document agrees with a file on disk again: the draft has nothing left to protect. */
  const settle = () => {
    dropDraft(storage, key);
    key = identityKey(store.state.doc);
    base = docFingerprint(store.state.doc);
    openedAssets = store.state.assets;
    changed = false;
    net.at = '';
    net.pictures = true;
  };

  /**
   * Puts a draft back on the screen. The copy is written again at once: between the moment the
   * work reappears and the next turn of the clock it would otherwise be covered by nothing,
   * and that is the worst quarter of a minute to lose it in.
   */
  const restore = (draft) => {
    recovering = true;
    store.replaceAll({
      doc: draft.doc,
      history: draft.history || store.state.history,
      assets: draft.assets || store.state.assets,
    });
    store.markDirty();
    recovering = false;
    paused = false;
    snapshot();
  };

  store.subscribeLight(() => { changed = true; });
  store.subscribe(() => {
    // `replaceAll` says the document is clean, and during a recovery that is the one thing it
    // is not: what came back is exactly what the file on disk does not have.
    if (recovering || store.state.dirty) return;
    if (net.at || identityKey(store.state.doc) !== key) settle();
  });

  const timer = setInterval(snapshot, interval);
  // The last keystrokes before the window goes: both of these fire where the timer no longer
  // will, and a snapshot is a single write.
  const onLeave = () => snapshot();
  const onHide = () => { if (document.visibilityState === 'hidden') snapshot(); };
  window.addEventListener('beforeunload', onLeave);
  document.addEventListener('visibilitychange', onHide);

  if (found) askAbout(store, storage, found, { restore, dismiss: () => { paused = false; } });
  else paused = false;

  return {
    stop() {
      clearInterval(timer);
      window.removeEventListener('beforeunload', onLeave);
      document.removeEventListener('visibilitychange', onHide);
    },
    snapshot,
    // Whether the session opens with a question: whoever has work to recover came to edit.
    found: !!found,
  };
}

/**
 * What to do with the work of a session that ended badly. It is asked, never decided: the
 * draft may be the two hours that were lost, or it may be older than the file just opened,
 * and only the person who wrote it knows which.
 */
function askAbout(store, storage, draft, { restore, dismiss }) {
  const stale = draft.base !== docFingerprint(store.state.doc);
  const m = modal({
    title: 'Unsaved changes were found from a previous session',
    content: h('div', {},
      h('p', {}, `This browser kept a copy of the work on ${dayOf(draft.at)} at ${clockOf(draft.at)}`,
        draft.revision ? ` — ${[draft.code, draft.title].filter(Boolean).join(' ')} rev. ${draft.revision}.` : '.'),
      h('p', {}, 'It was kept because the changes had not been saved: the file on disk is the one it always was. ',
        'Recovering puts those changes back on the screen, where they still have to be saved.'),
      stale
        ? h('p', { class: 'warn-line' },
            'Careful: the draft was written from a different version of this file than the one now open. ',
            'Compare it against what you expect before you save over anything.')
        : null,
      draft.assets
        ? null
        : h('p', { class: 'hint' }, 'The pictures come from the file you have open: the draft carries the text.')),
    actions: [
      button('Not now', () => { m.close(); dismiss(); }, { title: 'Leave the draft where it is and decide later' }),
      button('Discard the draft', () => {
        dropDraft(storage, draft.key);
        m.close();
        dismiss();
      }, { class: 'btn-danger' }),
      button('Recover the changes', () => {
        m.close();
        restore(draft);
        toast('Changes recovered. They are on the screen only: save the file to keep them.', 'ok', 8000);
      }, { class: 'btn-primary' }),
    ],
  });
}

const pad = (n) => String(n).padStart(2, '0');

export const clockOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const dayOf = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
