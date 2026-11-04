// File › Check for updates: the only place where this file talks to the network.
//
// The act is the reader's, always — see io/update.js for why nothing checks on its own. What
// is added here is the order the steps have to happen in, which is the part that protects the
// work: the file in hand is never rewritten and never replaced. A newer build is downloaded
// empty, the document is written into it, and the result is saved as a *new* file beside the
// old one. Unsaved changes are settled first, because what the new file would otherwise carry
// is the document as it was at the last save, not the one on screen.
import { h, button, modal, toast, formatDate } from './dom.js';
import { APP_NAME, APP_VERSION } from '../version.js';
import {
  fetchAnnouncement, buildUpdatedFile, isNewer, rememberCheck, lastChecked, daysSinceCheck,
  checkOverdue, CHECK_INTERVAL_DAYS, RELEASE_PAGE,
} from '../io/update.js';
import { download } from '../io/file.js';

/** The browser's storage, or nothing: a file opened where storage is refused still updates. */
function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Whether the quiet line in the status bar should appear. */
export const updateOverdue = () => checkOverdue(storage());

/** How long it has been, for the line that says so. */
export const updateAge = () => daysSinceCheck(storage());

const stampLine = () => {
  const at = lastChecked(storage());
  if (!at) return 'This file has never been checked against the project.';
  const days = daysSinceCheck(storage());
  const when = formatDate(new Date(at).toISOString().slice(0, 10));
  return days === 0 ? `Last checked today (${when}).` : `Last checked ${days} day${days === 1 ? '' : 's'} ago (${when}).`;
};

/**
 * The dialog. It opens saying what it is about to do and does nothing until the button is
 * pressed: the reader who opened the menu out of curiosity leaves having sent no request.
 */
export function checkForUpdates(store, { save } = {}) {
  const body = h('div', {});
  const actions = h('span', {});
  const m = modal({ title: 'Check for updates', content: body, actions: [actions] });

  const show = (...nodes) => { body.replaceChildren(...nodes.filter(Boolean)); };
  const act = (...nodes) => { actions.replaceChildren(...nodes.filter(Boolean)); };

  const offer = () => {
    show(
      h('p', {}, `This file is ${APP_NAME} ${APP_VERSION}. Checking asks the project's page on GitHub `,
        'which build is the latest one. Nothing is sent: the question is which version exists, and ',
        'the answer is a version number.'),
      h('p', { class: 'hint' }, stampLine(), ' Nothing is ever checked on its own — only when you ask here.'),
    );
    act(
      button('Close', () => m.close()),
      button('Check now', run, { class: 'btn-primary' }),
    );
  };

  const run = async () => {
    show(h('p', {}, 'Asking the project…'));
    act(button('Close', () => m.close()));
    const { ok, announcement, error } = await fetchAnnouncement();
    if (!ok) {
      // A bench machine with no route out is the ordinary case: say what happened and where
      // to look by hand, rather than dress a missing network as a failure of the tool.
      show(
        h('p', {}, 'The project could not be reached: ', h('strong', {}, error), '.'),
        h('p', { class: 'hint' }, 'A machine with no way out to the internet is the normal case for a test bench. ',
          'The latest build is always at ', h('a', { href: RELEASE_PAGE, target: '_blank', rel: 'noreferrer' }, RELEASE_PAGE), '.'),
      );
      return;
    }
    rememberCheck(storage(), { version: announcement.version });
    store.refreshLight();
    if (!isNewer(announcement.version, APP_VERSION)) {
      show(
        h('p', {}, h('strong', {}, `${APP_NAME} ${APP_VERSION}`), ' is the latest build.'),
        h('p', { class: 'hint' }, 'Checked just now; the next reminder is in ', String(CHECK_INTERVAL_DAYS), ' days.'),
      );
      return;
    }
    found(announcement);
  };

  const found = (announcement) => {
    const dirty = store.state.dirty;
    show(
      h('p', {}, h('strong', {}, `${APP_NAME} ${announcement.version}`), announcement.date ? ` · ${formatDate(announcement.date)}` : '',
        ' is available. This file is ', APP_VERSION, '.'),
      announcement.changes.length
        ? h('ul', { class: 'update-changes' }, ...announcement.changes.slice(0, 8).map((c) => h('li', {}, c)))
        : null,
      h('p', {}, 'Updating downloads the new build with this document already inside it, as a new file. ',
        'The file you are reading is not touched and not replaced: keep it until the new one has opened and ',
        'you have seen your document in it.'),
      dirty
        ? h('p', { class: 'hint hint-warning' }, 'There are unsaved changes. Save first, or the new file would carry the document as it was at the last save.')
        : h('p', { class: 'hint' }, 'The document is saved: the new file will carry exactly what is on screen.'),
      !announcement.app
        ? h('p', { class: 'hint hint-warning' }, 'The announcement does not name a build to download. Get it from ',
            h('a', { href: RELEASE_PAGE, target: '_blank', rel: 'noreferrer' }, RELEASE_PAGE), '.')
        : null,
    );
    act(
      button('Not now', () => m.close()),
      dirty && save
        ? button('Save first', () => { save(store); found(announcement); }, { class: 'btn-primary' })
        : announcement.app
          ? button(`Download ${APP_NAME} ${announcement.version} with this document`, () => fetchBuild(announcement), { class: 'btn-primary' })
          : null,
    );
  };

  const fetchBuild = async (announcement) => {
    show(h('p', {}, `Downloading ${APP_NAME} ${announcement.version} and writing this document into it…`),
      h('p', { class: 'hint' }, 'A build is about a megabyte and a half; with pictures the file that comes out is larger.'));
    act(button('Close', () => m.close()));
    try {
      const { html, name } = await buildUpdatedFile(store.state, announcement);
      const { bytes } = download(html, name, 'text/html;charset=utf-8');
      show(
        h('p', {}, h('strong', {}, name), ' has been downloaded.'),
        h('p', {}, 'Open it and check that the document is all there — the revisions, the pictures, the variants. ',
          'Only then is the old file safe to replace with it. Notes live in this browser and follow the specification, ',
          'not the file, so they are found again by the new one.'),
        h('p', { class: 'hint' }, `${APP_NAME} ${announcement.version} · ${Math.round(bytes / 1024)} KB`),
      );
    } catch (err) {
      show(
        h('p', {}, 'The update could not be prepared: ', h('strong', {}, err.message), '.'),
        h('p', { class: 'hint' }, 'Nothing was changed here. The build can also be downloaded by hand from ',
          h('a', { href: RELEASE_PAGE, target: '_blank', rel: 'noreferrer' }, RELEASE_PAGE),
          ', and this document carried into it by saving this file and opening it there.'),
      );
    }
  };

  offer();
}

/** The quiet line in the status bar, when a check is three months old. */
export function updateButton(store, commands) {
  const days = updateAge();
  return h('button', {
    type: 'button', class: 'status-issues status-update',
    title: `The last check for a newer build was ${days} days ago. Click to check now — nothing is ever checked on its own.`,
    onClick: () => checkForUpdates(store, commands),
  }, 'Updates unchecked');
}

/** Said once when the editor opens, quietly, instead of opening anything by itself. */
export function remindAboutUpdates() {
  if (!updateOverdue()) return;
  toast(`It has been ${updateAge()} days since this file was checked against the project. File › Check for updates asks — nothing is ever checked on its own.`, 'info', 9000);
}
