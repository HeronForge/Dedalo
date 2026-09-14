// Which build this is, what it can read, and what changed along the way.
import { h, card, table } from '../dom.js';
import { APP_NAME, APP_TAGLINE, APP_VERSION, CHANGELOG, FORMATS, LICENSE, AUTHOR } from '../../version.js';
import { SCHEMA_VERSION } from '../../model/schema.js';
import { formatTag } from '../../io/format.js';

export function aboutSection(store) {
  const { doc, history } = store.state;

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Version and changelog')),

    card('This build',
      table(['', ''], [
        row('Application', `${APP_NAME} ${APP_VERSION} — ${APP_TAGLINE}`),
        row('Document data schema', `version ${SCHEMA_VERSION}`),
        row('Authoring format', `${formatTag('authoring')} — written and read; reads ${readList('authoring')}`),
        row('Data export format', `${formatTag('export')} — written and read; reads ${readList('export')}`),
      ]),
      h('p', { class: 'hint' },
        'The three numbers answer three questions: which build of the editor you are using, ',
        'the shape of the data inside this file, and the JSON this build can exchange. ',
        'They move independently, and a file written by an older build keeps opening here: ',
        'an import states which version it found and what it upgraded, and refuses outright a ',
        'version newer than this build, rather than reading half of it.')),

    card('This document',
      table(['', ''], [
        row('Title', doc.header.title || '—'),
        row('Document code', doc.header.documentCode || '—'),
        row('Draft revision', `${(doc.revision || {}).number || '—'} (${(history.revisions || []).length} issued before it)`),
        row('Data schema in the file', `version ${doc.schemaVersion || '—'}`),
      ])),

    card('Guides',
      h('ul', { class: 'plain-list' },
        h('li', {}, h('strong', {}, 'docs/EDITING-GUIDE.md'), ' — filling a specification in by hand, with examples; variants and revisions explained.'),
        h('li', {}, h('strong', {}, 'docs/IMPORT-GUIDE.md'), ' — converting an existing specification, written to be handed to a language model together with the source document.')),
      h('p', { class: 'hint' }, 'Both travel next to the two HTML files.')),

    card('Licence and authorship',
      table(['', ''], [
        row('Licence', `${LICENSE.id} — ${LICENSE.name}`),
        row('Author', AUTHOR.name),
        row('Written with', AUTHOR.assistedBy),
        row('Copyright', LICENSE.copyright),
      ]),
      h('p', { class: 'hint' },
        'The licence covers this tool. The specifications written with it belong to whoever writes them. ',
        'The full text travels next to the file as LICENSE, and the pagination engine bundled inside ',
        '(paged.js) carries its own MIT licence.')),

    card('Changelog', ...CHANGELOG.map(release)));
}

const row = (label, value) => h('tr', {}, h('th', { class: 'row-head' }, label), h('td', {}, value));

const readList = (kind) => FORMATS[kind].reads.map((v) => `${FORMATS[kind].id}/${v}`).join(', ');

const release = (entry) => h('div', { class: 'release' },
  h('div', { class: 'release-head' },
    h('strong', {}, entry.version),
    entry.version === APP_VERSION ? h('span', { class: 'badge badge-current' }, 'this build') : null,
    h('span', { class: 'muted' }, entry.date)),
  h('ul', { class: 'release-notes' }, ...entry.changes.map((c) => h('li', {}, c))));
