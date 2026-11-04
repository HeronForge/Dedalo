// Checking for a newer build: the comparison, the reminder's clock, and what the file that
// comes out of an update is made of.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareVersions, isNewer, readAnnouncement, fetchAnnouncement, buildUpdatedFile,
  rememberCheck, lastChecked, checkOverdue, daysSinceCheck, CHECK_INTERVAL_DAYS,
} from '../src/io/update.js';
import { emptyDocument, newStage } from '../src/model/schema.js';
import { emptyHistory } from '../src/history/revisions.js';

const DAY = 24 * 60 * 60 * 1000;

/** A storage that behaves like the browser's, in memory. */
function memory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('a version is newer only when its numbers say so, and an unreadable one never is', () => {
  assert.equal(isNewer('1.38.0', '1.37.1'), true);
  assert.equal(isNewer('1.37.10', '1.37.9'), true, 'ten is after nine, not before it');
  assert.equal(isNewer('1.37.1', '1.37.1'), false);
  assert.equal(isNewer('1.37.0', '1.37.1'), false);
  assert.equal(isNewer('2.0', '1.99.99'), true);
  // Something that is not a version cannot claim to be an update.
  assert.equal(isNewer('latest', '1.37.1'), false);
  assert.equal(compareVersions('1.37', '1.37.0'), 0, 'a missing number is a zero');
});

test('an announcement is read for what can be trusted, and a page that is not one yields nothing', () => {
  const read = readAnnouncement({
    version: '1.38.0', date: '2026-11-20', changes: ['A line.', 7],
    app: 'https://heronforge.github.io/Dedalo/test-spec.html',
  });
  assert.equal(read.version, '1.38.0');
  assert.deepEqual(read.changes, ['A line.'], 'only sentences survive');
  assert.ok(read.app);
  // The address becomes the program the reader opens next: only the project's own host.
  assert.equal(readAnnouncement({ version: '1.38.0', app: 'https://example.com/evil.html' }).app, '');
  assert.equal(readAnnouncement({ version: 'nightly' }), null);
  assert.equal(readAnnouncement('<html>a captive portal</html>'), null);
  assert.equal(readAnnouncement(null), null);
});

test('a network that does not answer is reported, never thrown', async () => {
  const refused = await fetchAnnouncement(async () => { throw new Error('Failed to fetch'); });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Failed to fetch/);

  const notFound = await fetchAnnouncement(async () => ({ ok: false, status: 404 }));
  assert.equal(notFound.ok, false);
  assert.match(notFound.error, /404/);

  const fine = await fetchAnnouncement(async () => ({ ok: true, json: async () => ({ version: '1.38.0' }) }));
  assert.equal(fine.ok, true);
  assert.equal(fine.announcement.version, '1.38.0');
});

test('the reminder waits a quarter, and a file never checked is not scolded for it', () => {
  const storage = memory();
  // Never checked: nothing is overdue, because nothing was promised.
  assert.equal(checkOverdue(storage), false);
  assert.equal(lastChecked(storage), null);
  assert.equal(daysSinceCheck(storage), null);

  const now = Date.UTC(2026, 10, 4);
  rememberCheck(storage, { at: now, version: '1.37.1' });
  assert.equal(checkOverdue(storage, now + 10 * DAY), false);
  assert.equal(daysSinceCheck(storage, now + 10 * DAY), 10);
  assert.equal(checkOverdue(storage, now + (CHECK_INTERVAL_DAYS - 1) * DAY), false);
  assert.equal(checkOverdue(storage, now + CHECK_INTERVAL_DAYS * DAY), true);
  // A storage the browser refuses keeps nothing and asks nothing.
  assert.equal(rememberCheck(null, { at: now }), false);
  assert.equal(checkOverdue(null), false);
});

test('the updated file is the new build carrying this document, and the old file is untouched', async () => {
  const doc = emptyDocument();
  doc.header.documentCode = 'TS-001';
  doc.header.title = 'Lamp control unit';
  doc.stages = [Object.assign(newStage(), { name: 'Power' })];
  const state = { doc, history: emptyHistory(), assets: {} };

  const build = ['<!doctype html><html><head><title>DEDALO</title></head><body>',
    '<!--TSW:DOC--><script type="application/json" id="tsw-doc">null</script><!--/TSW:DOC-->',
    '<!--TSW:HISTORY--><script type="application/json" id="tsw-history">null</script><!--/TSW:HISTORY-->',
    '<!--TSW:ASSETS--><script type="application/json" id="tsw-assets">null</script><!--/TSW:ASSETS-->',
    '<script>/* the new build */</script></body></html>'].join('');

  const announcement = readAnnouncement({ version: '1.38.0', app: 'https://heronforge.github.io/Dedalo/test-spec.html' });
  const { html, name } = await buildUpdatedFile(state, announcement, async () => ({ ok: true, text: async () => build }));

  assert.match(name, /^TS-001_Rev00_v1\.38\.0\.html$/, 'a new file beside the old one, named for the build');
  assert.ok(html.includes('/* the new build */'), 'the program is the new one');
  assert.ok(html.includes('Lamp control unit'), 'the document is this one');
  const embedded = JSON.parse(html.match(/id="tsw-doc">([\s\S]*?)<\/script>/)[1]);
  assert.equal(embedded.stages.length, 1);
  assert.equal(embedded.header.documentCode, 'TS-001');

  // Anything that is not a build is refused before a file is handed to anybody.
  await assert.rejects(
    () => buildUpdatedFile(state, announcement, async () => ({ ok: true, text: async () => '<html>a login page</html>' })),
    /not a DEDALO build/,
  );
  await assert.rejects(
    () => buildUpdatedFile(state, announcement, async () => ({ ok: false, status: 503 })),
    /503/,
  );
  await assert.rejects(() => buildUpdatedFile(state, { version: '1.38.0', app: '' }), /where the build is/);
});
