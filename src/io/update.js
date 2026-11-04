// Whether a newer build of DEDALO exists — asked, never volunteered.
//
// The file is opened by double click, from a folder, often on a bench machine that has no
// business talking to the internet, and a page that phoned home on its own would be the one
// thing nobody could justify to whoever approved the tool. So nothing here runs by itself:
// every function in this module is called from File › Check for updates, and the only trace
// kept is the date of the last check, so the interface can say — quietly, after three months —
// that it has been a while.
//
// The update itself is not an install. There is nothing to install: the build is the file. So
// the newest empty build is fetched whole and the document, the history and the pictures of
// the file in hand are written into it, which produces a new file to save beside the old one.
// The old file is never touched: if anything at all went wrong, the previous version is still
// sitting in the folder, openable, with the same data in it.
import { pruneAssets } from './images.js';
import { composeInto, suggestedFileName } from './file.js';

/** Where the two things it needs live: what the latest version is, and the build itself. */
export const UPDATE_URL = 'https://raw.githubusercontent.com/HeronForge/Dedalo/main/update.json';
export const RELEASE_PAGE = 'https://github.com/HeronForge/Dedalo';

const LAST_CHECK_KEY = 'tsw.update.checked';

/** How long a check stays fresh. A quarter: long enough not to nag, short enough to matter. */
export const CHECK_INTERVAL_DAYS = 90;

const DAY = 24 * 60 * 60 * 1000;

/**
 * Compares two version strings the way the changelog numbers them: 1.37.10 is newer than
 * 1.37.9, and anything unparsable sorts as older than everything, so a malformed answer from
 * the network can never claim to be an update.
 * @returns {number} negative when a is older, positive when a is newer, 0 when they match
 */
export function compareVersions(a, b) {
  const parts = (v) => String(v || '').trim().split('.').map((n) => (/^\d+$/.test(n) ? Number(n) : -1));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Whether `candidate` is a build later than the one running. */
export const isNewer = (candidate, current) => compareVersions(candidate, current) > 0;

/** When the last check happened, as a number of milliseconds, or null when never. */
export function lastChecked(storage) {
  try {
    const raw = storage && storage.getItem(LAST_CHECK_KEY);
    const at = raw ? Number(JSON.parse(raw).at) : 0;
    return at > 0 ? at : null;
  } catch {
    return null;
  }
}

/** Remembers that a check happened, and what it found. */
export function rememberCheck(storage, { at = Date.now(), version = '' } = {}) {
  try {
    if (!storage) return false;
    storage.setItem(LAST_CHECK_KEY, JSON.stringify({ at, version }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether it is time to suggest a check. A file opened for the first time on a machine has no
 * stamp at all: that is not «overdue», it is a first use, and greeting somebody with a warning
 * they have done nothing to deserve is how a warning stops being read. The clock starts at the
 * first check.
 */
export function checkOverdue(storage, now = Date.now()) {
  const at = lastChecked(storage);
  if (!at) return false;
  return now - at >= CHECK_INTERVAL_DAYS * DAY;
}

/** How long ago the last check was, in whole days, or null when there was never one. */
export function daysSinceCheck(storage, now = Date.now()) {
  const at = lastChecked(storage);
  return at ? Math.floor((now - at) / DAY) : null;
}

/**
 * What the published `update.json` says, reduced to what can be trusted: strings, a list of
 * sentences, and an address on the project's own host. A file that says something else — a
 * captive portal's login page, a proxy's error — yields nothing rather than a half-read update.
 */
export function readAnnouncement(value) {
  if (!value || typeof value !== 'object') return null;
  const version = String(value.version || '').trim();
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  const app = String(value.app || '').trim();
  return {
    version,
    date: String(value.date || '').trim(),
    changes: Array.isArray(value.changes) ? value.changes.filter((c) => typeof c === 'string') : [],
    // Only from the project's own site: this address is fetched and the answer becomes the
    // program the reader will open next, so a redirected one is not worth being lenient about.
    app: /^https:\/\/heronforge\.github\.io\/Dedalo\//.test(app) ? app : '',
  };
}

/**
 * Asks the project what the latest build is. Network failures are returned, not thrown: a
 * bench machine with no route out is the normal case, not an error to apologise for.
 * @returns {Promise<{ok: boolean, announcement: object|null, error: string}>}
 */
export async function fetchAnnouncement(fetchImpl = fetch, url = UPDATE_URL) {
  try {
    const res = await fetchImpl(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, announcement: null, error: `the server answered ${res.status}` };
    const announcement = readAnnouncement(await res.json());
    if (!announcement) return { ok: false, announcement: null, error: 'the answer was not an update announcement' };
    return { ok: true, announcement, error: '' };
  } catch (err) {
    return { ok: false, announcement: null, error: err && err.message ? err.message : 'no answer' };
  }
}

/**
 * The newest build with this document inside it. The build arrives empty — it is the file one
 * would download to start a new specification — and the three data blocks are written into it
 * exactly as a save writes them into the file in hand.
 * @returns {Promise<{html: string, name: string}>}
 */
export async function buildUpdatedFile(state, announcement, fetchImpl = fetch) {
  if (!announcement || !announcement.app) throw new Error('The announcement does not say where the build is.');
  const res = await fetchImpl(announcement.app, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The build could not be downloaded: the server answered ${res.status}.`);
  const shell = await res.text();
  if (!/<!--TSW:DOC-->/.test(shell)) throw new Error('What was downloaded is not a DEDALO build: it has no data block.');
  const pruned = pruneAssets(state.doc, state.assets, state.history);
  return {
    html: composeInto(shell, { ...state, assets: pruned }),
    name: suggestedFileName(state.doc).replace(/\.html$/, `_v${announcement.version}.html`),
  };
}
