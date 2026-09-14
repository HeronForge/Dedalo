// Cycle time estimator: how long the sequence takes, and what the figure is made of.
//
// The average time of an instrument is asked for here and nowhere else. It is a bench figure,
// not a requirement: it never appears in the printed specification, and changing it changes
// an estimate, never the document.
import { h, button, card, table, empty } from '../dom.js';
import { textInput } from '../fields.js';
import { codeOf, labelOf, computeIndex } from '../../model/codes.js';
import { estimateCycleTime, formatSeconds } from '../../model/cycletime.js';
import { openForEditing } from '../navigate.js';

export function cycleTimeSection(store) {
  const doc = store.resolvedDoc();
  const codes = store.codes();
  const index = computeIndex(doc);
  const est = estimateCycleTime(doc);
  const saved = est.serial - est.parallel;

  const stageRow = (r) => h('tr', {},
    h('td', { class: 'code' }, codeOf(codes, r.stage.id)),
    h('td', {}, r.stage.name || '(unnamed)'),
    h('td', { class: 'num' }, formatSeconds(r.wait)),
    h('td', { class: 'num' }, formatSeconds(r.commands)),
    h('td', { class: 'num' }, formatSeconds(r.resources)),
    h('td', { class: 'num' }, formatSeconds(r.calls)),
    h('td', { class: 'num total' }, formatSeconds(r.total)));

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Cycle time estimate')),
    h('p', { class: 'hint' },
      'Three figures feed the estimate: the wait declared on a step, the nominal execution time ',
      'of a command, and the average time an instrument is held for one use — the last one is ',
      'asked for below and lives only here. None of it is printed in the specification.'),

    h('div', { class: 'cycle-totals' },
      totalCard('One stage at a time', est.serial, 'Every stage in sequence: the honest worst case.'),
      totalCard('With parallel stages', est.parallel,
        est.truncated
          ? 'The graph is too large to enumerate every group: this is a bound, not a count.'
          : 'Stages that may run together are charged as the longest of them.'),
      totalCard('Saved by running in parallel', saved > 0 ? saved : 0,
        saved > 0
          ? `${Math.round((saved / est.serial) * 100)} % of the serial time.`
          : 'Nothing to gain: see below why no two stages may run together.')),

    // Why there is no gain, when there is none: the constraints that forbid it, named.
    saved > 0 || !est.stages.length ? null : card('Why nothing runs in parallel',
      est.blockers.length
        ? h('ul', { class: 'plain-list' }, ...est.blockers.map((b) => h('li', {},
            h('span', { class: 'code' }, codeOf(codes, b.id)), ' ', b.name || '(unnamed)', ' — ',
            b.mode === 'all'
              ? 'declares that no stage may run alongside it'
              : ['not with ', b.stageIds.map((id) => labelOf(codes, index, id, 26)).join(', ')],
            ' ',
            button('Open', () => openForEditing(store, b.id), { class: 'btn-small' }))))
        : h('p', { class: 'hint' }, 'The prerequisites order every stage one after the other: there is no pair the sequence leaves free.'),
      h('p', { class: 'hint' }, 'Relax one of these and the estimate above changes with it.')),

    (est.missing.resources.length || est.missing.commands.length)
      ? card('What the estimate does not know',
          h('p', { class: 'hint' }, 'These are used by the sequence and carry no time: they count as zero, so the estimate is a floor.'),
          h('ul', { class: 'plain-list' },
            ...est.missing.resources.map((r) => h('li', {},
              h('span', { class: 'code' }, codeOf(codes, r.id)), ' ', r.name || '(unnamed)',
              h('span', { class: 'muted' }, ' — no average time'))),
            ...est.missing.commands.map((c) => h('li', {},
              h('span', { class: 'code' }, codeOf(codes, c.id)), ' ', c.name || '(unnamed)',
              h('span', { class: 'muted' }, ' — no nominal execution time'),
              button('Open', () => openForEditing(store, c.id), { class: 'btn-small' })))))
      : null,

    card('Average time per instrument',
      (doc.resources || []).length
        ? table(['Code', 'Instrument', 'Average time for one use'],
            (doc.resources || []).map((r) => h('tr', {},
              h('td', { class: 'code' }, codeOf(codes, r.id)),
              h('td', {}, r.name || '(unnamed)'),
              h('td', { class: 'cell-time' },
                textInput(store, ['resources', '#' + r.id, 'averageTime'], { placeholder: 'seconds, e.g. 1.5' }),
                h('span', { class: 'muted' }, ' s')))))
        : empty('No resource in the catalogue yet.'),
      h('p', { class: 'hint' }, 'Time the instrument is busy for a single use: settling, ranging, reading. Left empty it counts as zero.')),

    card('Test stages',
      est.stages.length
        ? table(['Code', 'Stage', 'Waits', 'Commands', 'Instruments', 'Setup calls', 'Total'], est.stages.map(stageRow))
        : empty('No test stage yet.')),

    est.setups.length
      ? card('Setup stages',
          h('p', { class: 'hint' }, 'Counted inside every stage that calls them, as many times as it is called.'),
          table(['Code', 'Stage', 'Waits', 'Commands', 'Instruments', 'Setup calls', 'Total'], est.setups.map(stageRow)))
      : null,

    card('How the parallel figure is built',
      est.schedule.length
        ? h('ol', { class: 'plain-list' }, ...est.schedule.map((slot) => h('li', {},
            slot.ids.map((id) => labelOf(codes, index, id, 30)).join(' ‖ '),
            h('span', { class: 'muted' }, ` — ${formatSeconds(slot.seconds)}`))))
        : empty('Nothing to schedule.')));
}

const totalCard = (title, value, note) => h('div', { class: 'total-card' },
  h('div', { class: 'total-title' }, title),
  h('div', { class: 'total-value' }, formatSeconds(value)),
  h('div', { class: 'total-note' }, note));

