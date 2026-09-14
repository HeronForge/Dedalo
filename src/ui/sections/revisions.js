// Revision history: issuing, change record and comparison between two versions.
import { h, button, card, empty, table, modal, confirm, toast, formatDate } from '../dom.js';
import {
  issueRevision, revisionDocument, changeRecord, comparableVersions,
  consolidateRevision, successorOf, isNumberIssued, nextNumber, completeChanges, STATUS_LABEL, STATUS,
  isDraft, openDraft, editedSinceIssue,
} from '../../history/revisions.js';
import { compare, groupByChapter, diffCounts } from '../../history/diff.js';
import { migrate } from '../../model/schema.js';

// Comparison selection: survives redraws.
const comparison = { a: '', b: '__current__', result: null };

export function revisionsSection(store) {
  const { doc, history } = store.state;
  const rows = changeRecord(doc, history);

  // The actions live on the row they act on: the draft is the one that can be frozen, an
  // issued revision is the one that can be corrected, restored or merged forward. A button
  // over the table had to explain in words which row it meant.
  const revisionTable = table(['Rev.', 'Date', 'Author', 'Reason', 'Status', ''],
    rows.map((r) => h('tr', { class: r.issued ? '' : 'row-draft' },
      h('td', {}, r.number || '—'),
      h('td', {}, formatDate(r.date)),
      h('td', {}, r.author || '—'),
      h('td', {}, r.reason || '—'),
      h('td', {}, STATUS_LABEL[r.status] || r.status),
      h('td', { class: 'row-actions' }, r.issued
        ? [
            button('Edit…', () => editDialog(store, r.number), { class: 'btn-small', title: 'Change what the record says: date, author, reason, status' }),
            button('Restore into draft', () => restore(store, r.number), { class: 'btn-small', title: 'Bring this content back into the working draft' }),
            button('Merge forward', () => consolidate(store, r.number), { class: 'btn-small', title: 'Drop this revision: its changes become part of the following one' }),
          ]
        : button('Validate…', () => issueDialog(store), {
            class: 'btn-small btn-primary',
            title: 'Freeze this draft as a revision',
          })))));

  // An issued document has no draft, and gets none until asked: the one button under the
  // record opens it. Edited meanwhile — the copy says «Rev. 01, issued» and is not — the
  // button is the way out, and the line above it says why.
  const draft = isDraft(doc);
  const edited = !draft && editedSinceIssue(doc, history);
  const next = draft ? null : openDraft(doc, history).revision.number;

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Revisions')),
    card('Change record',
      h('p', { class: 'hint' },
        draft
          ? 'The last row is the draft: the copy being worked on, which nothing outside this file has seen. '
          : `The document is revision ${(doc.revision || {}).number || '—'}, as issued: there is no draft until one is opened. `,
        'Every other row is frozen — its content cannot change, which is what makes it a revision — ',
        'while what the record says about it can still be corrected.'),
      revisionTable,
      draft ? null : h('div', { class: 'draft-actions' },
        edited
          ? h('p', { class: 'hint hint-warning' }, `The document has been changed since revision ${(doc.revision || {}).number} was issued: open the draft those changes belong to, or restore the revision.`)
          : null,
        button(`New draft (Rev. ${next})`, () => startDraft(store), {
          class: ['btn-small', edited && 'btn-primary'],
          title: 'Open the next draft: the working copy carries on under the next number',
        }))),
    card('Compare two versions', comparePanel(store)));
}

/**
 * The shortcut in the command bar, which is not quite the same act as the button on the
 * revisions page.
 *
 * While the document is still a draft, freezing it is a decision to take in front of the
 * change record — what the previous revisions were, who signed them, which of them is still
 * waiting for approval — and none of that is visible from the toolbar. So the shortcut
 * explains itself and offers the page; from the page the dialog opens straight away, because
 * there the record is already on screen.
 */
export function issueFromToolbar(store) {
  const revision = store.state.doc.revision || {};
  if (!isDraft(store.state.doc)) {
    // Nothing to validate: the document is the revision it says. What the tick can offer
    // here is the next draft.
    const next = openDraft(store.state.doc, store.state.history).revision.number;
    const m = modal({
      title: `Revision ${revision.number || '—'} is issued`,
      content: h('div', {},
        h('p', {}, 'The document is the revision on its cover, as it was validated. There is nothing to validate until a new draft is opened and worked on.'),
        editedSinceIssue(store.state.doc, store.state.history)
          ? h('p', { class: 'hint hint-warning' }, 'It has been changed since: those changes belong to a draft.')
          : null),
      actions: [
        button('Cancel', () => m.close()),
        button(`New draft (Rev. ${next})`, () => { m.close(); startDraft(store); }, { class: 'btn-primary' }),
      ],
    });
    return;
  }

  const issued = (store.state.history.revisions || []).length;
  const m = modal({
    title: 'The document is still a draft',
    content: h('div', {},
      h('p', {},
        'Revision ', h('strong', {}, revision.number || '—'),
        ' has not been issued yet: it is the copy you are working on. Validating it freezes ',
        'it exactly as it stands now; the next draft opens when you ask for it.'),
      h('p', { class: 'hint' },
        issued
          ? `The change record holds ${issued} issued revision${issued > 1 ? 's' : ''}. `
          : 'Nothing has been issued yet. ',
        'The revisions page shows them all — dates, authors, reasons, and which ones are still ',
        'waiting for approval — and that is where a draft is validated and where those states are set.')),
    actions: [
      button('Cancel', () => m.close()),
      button('Go to the revisions page', () => {
        m.close();
        store.set({ section: 'revisions' });
      }, { class: 'btn-primary' }),
    ],
  });
}

export function issueDialog(store) {
  const { doc, history } = store.state;
  const draftNumber = (doc.revision || {}).number || '';

  const number = h('input', { class: 'inp inp-num', value: draftNumber });
  const author = h('input', { class: 'inp', value: (doc.revision || {}).author || '' });
  const reason = h('textarea', { class: 'inp', rows: 3 }, (doc.revision || {}).reason || '');
  const status = h('select', { class: 'inp' },
    h('option', { value: STATUS.ISSUED }, 'Issued'),
    h('option', { value: STATUS.APPROVED }, 'Approved'));

  // What is about to happen, in the numbers that will result from it. The draft one is
  // working on carries a number of its own, and whether it is the one to freeze or whether
  // the work belongs to the next is a decision, not something to be assumed quietly.
  const outcome = h('p', { class: 'hint' });
  const describe = () => {
    const value = number.value.trim();
    if (isNumberIssued(history, value)) {
      outcome.textContent = `Revision ${value} has already been issued: choose another number.`;
      outcome.className = 'hint hint-warning';
      return false;
    }
    outcome.className = 'hint';
    outcome.textContent = `The document as it stands is frozen as revision ${value || '—'} and stays on it, as issued. `
      + `The next draft (${nextNumber(value)}) opens from the revisions page when work resumes.`;
    return true;
  };
  number.addEventListener('input', describe);
  describe();

  const m = modal({
    title: 'Validate the draft',
    content: h('div', {},
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Revision number'), number),
      outcome,
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Author'), author),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Reason for the revision'), reason),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Status'), status)),
    actions: [
      button('Cancel', () => m.close()),
      button('Validate', async () => {
        if (!describe()) return;
        try {
          // The chosen number belongs to the draft before it is frozen: what gets issued is
          // the document as it stands, under the number the dialog shows.
          store.change((d) => { d.revision = { ...d.revision, number: number.value.trim() }; });
          const res = await issueRevision(store.state.doc, store.state.history,
            { author: author.value, reason: reason.value, status: status.value });
          // One step: the draft's new number and the frozen copy go together, and come back
          // together on an undo.
          store.changeAll((s) => { s.doc.revision = res.doc.revision; s.history = res.history; });
          m.close();
          toast(`Revision ${res.doc.revision.number} validated. Remember to save the file.`, 'ok', 6000);
        } catch (err) {
          toast(err.message, 'error', 9000);
        }
      }, { class: 'btn-primary' }),
    ],
  });
}

/** The next draft, opened by hand: one step, undone as one. */
function startDraft(store) {
  const next = openDraft(store.state.doc, store.state.history);
  store.change((d) => { d.revision = next.revision; });
  toast(`Draft ${next.revision.number} opened.`, 'ok');
}

/**
 * The metadata of an issued revision, after the fact: an approval usually arrives days later,
 * and a reason is sometimes written in a hurry. The content stays frozen — this changes what
 * the record says about the revision, never what the revision contains.
 */
function editDialog(store, number) {
  const revision = (store.state.history.revisions || []).find((r) => r.number === number);
  if (!revision) return;

  const date = h('input', { class: 'inp', type: 'date', value: revision.date || '' });
  const author = h('input', { class: 'inp', value: revision.author || '' });
  const reason = h('textarea', { class: 'inp', rows: 3 }, revision.reason || '');
  const status = h('select', { class: 'inp' },
    ...[STATUS.ISSUED, STATUS.APPROVED, STATUS.DRAFT].map((v) =>
      h('option', { value: v, selected: v === revision.status }, STATUS_LABEL[v])));

  const m = modal({
    title: `Revision ${number}`,
    content: h('div', {},
      h('p', { class: 'hint' },
        'The content of an issued revision cannot change — that is what makes it a revision. ',
        'What the record says about it can: an approval granted later, an author, a reason.'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Date'), date),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Author'), author),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Reason'), reason),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Status'), status)),
    actions: [
      button('Cancel', () => m.close()),
      button('Apply', () => {
        const revisions = (store.state.history.revisions || []).map((r) => (r.number === number
          ? { ...r, date: date.value, author: author.value, reason: reason.value, status: status.value }
          : r));
        store.changeAll((s) => { s.history = { ...s.history, revisions }; });
        m.close();
        toast(`Revision ${number} updated.`, 'ok');
      }, { class: 'btn-primary' }),
    ],
  });
}

async function consolidate(store, number) {
  const { doc, history } = store.state;
  const into = successorOf(doc, history, number);
  if (!into) return;
  const target = into.isDraft ? `the current draft (Rev. ${into.number})` : `Rev. ${into.number}`;
  const ok = await confirm(
    `Drop Rev. ${number} from the record? Its changes stay in the document: from now on they count as part of ${target}, `
    + 'and the reason for the change is carried over. The snapshot of Rev. ' + number + ' is lost, so it can no longer be compared or restored.',
    { danger: true, okLabel: 'Merge forward' });
  if (!ok) return;
  const res = consolidateRevision(doc, history, number);
  store.changeAll((s) => { s.doc.revision = res.doc.revision; s.history = res.history; });
  toast(`Rev. ${number} merged into ${target}.`, 'ok', 6000);
  // The revision that took the changes over records them again, for the revision matrix.
  const completed = await completeChanges(store.state.history);
  if (completed) { store.state.history = completed; store.refresh(); }
}

async function restore(store, number) {
  const rev = (store.state.history.revisions || []).find((r) => r.number === number);
  if (!rev) return;
  if (!(await confirm(`Bring the content of revision ${number} back into the current draft? Unissued changes will be lost.`, { danger: true, okLabel: 'Restore' }))) return;
  const old = await revisionDocument(rev);
  store.change((doc) => {
    const currentRevision = doc.revision;
    Object.keys(doc).forEach((k) => delete doc[k]);
    Object.assign(doc, migrate(old));
    doc.revision = currentRevision; // the draft keeps its own number
  });
  toast(`Content of revision ${number} restored into the draft.`, 'ok');
}

function comparePanel(store) {
  const { doc, history } = store.state;
  const versions = comparableVersions(doc, history);
  if (versions.length < 2) return empty('At least one issued revision is needed to compare.');
  if (!versions.some((v) => v.id === comparison.a)) comparison.a = versions[0].id;

  const select = (value, onChange) => {
    const el = h('select', { class: 'inp' }, ...versions.map((v) => h('option', { value: v.id, selected: v.id === value }, v.label)));
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };

  const result = h('div', { class: 'compare-result' });
  if (comparison.result) result.appendChild(differencesTable(comparison.result));

  return h('div', {},
    h('div', { class: 'toolstrip' },
      select(comparison.a, (v) => { comparison.a = v; }),
      h('span', {}, '→'),
      select(comparison.b, (v) => { comparison.b = v; }),
      button('Compare', async () => {
        const a = await documentFor(store, comparison.a);
        const b = await documentFor(store, comparison.b);
        if (!a || !b) { toast('Version not available.', 'error'); return; }
        comparison.result = { differences: compare(a, b), a: comparison.a, b: comparison.b };
        store.refresh();
      }, { class: 'btn-primary' })),
    result);
}

async function documentFor(store, id) {
  if (id === '__current__') return store.state.doc;
  const rev = (store.state.history.revisions || []).find((r) => r.number === id);
  return rev ? revisionDocument(rev) : null;
}

/**
 * One difference as a row: what kind, where, what it was, what it became. Shared with the
 * document viewer, which shows the same rows for a single entity.
 */
export const differenceRow = (d) => h('tr', {},
  h('td', {}, h('span', { class: 'tag tag-' + d.type }, d.typeLabel)),
  h('td', {}, d.where),
  h('td', { class: 'cell-before' }, d.before || '—'),
  h('td', { class: 'cell-after' }, d.after || '—'));

export const DIFFERENCE_HEADERS = ['Type', 'Where', 'Before', 'After'];

function differencesTable({ differences, a, b }) {
  if (!differences.length) return empty('The two versions are identical.');
  const c = diffCounts(differences);
  const groups = groupByChapter(differences);
  return h('div', {},
    h('p', { class: 'hint' },
      `Comparing ${versionLabel(a)} → ${versionLabel(b)}: `,
      `${c.added} added, ${c.removed} removed, ${c.changed} changed, ${c.moved} moved.`),
    ...groups.map(([chapter, list]) => card(chapter,
      table(DIFFERENCE_HEADERS, list.map(differenceRow)))));
}

const versionLabel = (id) => (id === '__current__' ? 'current draft' : `Rev. ${id}`);
