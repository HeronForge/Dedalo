// The marks of the document, explained where the document is read.
//
// A code in blue, a dotted value, a word in electric blue, six coloured tags: each is a
// convention, and a convention nobody can look up is one people stop trusting. The legend is
// one small sign on the rail beside the scrollbar, and a pointer resting on it shows every mark
// exactly as the page draws it — the same classes, the same stylesheet — beside one line on
// its meaning.
import { h } from './dom.js';

/** The sign and its card. */
export function legend() {
  return h('span', { class: 'legend', title: 'What the marks on the page mean' },
    h('span', { class: 'legend-sign rail-btn', 'aria-label': 'Legend' }, 'ⓘ'),
    h('div', { class: 'legend-pop', role: 'tooltip' },
      h('div', { class: 'legend-title' }, 'Reading the page'),
      // Wrapped as a piece of document, so every sample wears the exact look it has on the page.
      h('div', { class: 'document document-screen legend-doc' }, ...ROWS.map(([sample, meaning]) =>
        h('div', { class: 'legend-row' }, h('div', { class: 'legend-sample' }, sample()), h('div', { class: 'legend-text' }, meaning))))));
}

const ROWS = [
  [() => h('a', { class: 'ref' }, h('span', { class: 'ref-code' }, 'AP-01'), h('span', { class: 'ref-name' }, ' Battery positive')),
    'A reference. Click it for its card; a pointer resting on it previews the card.'],
  [() => h('a', { class: 'ref ref-value' }, '13.5 V (Vbatt)'),
    'A value bound to a global variable, named in brackets. Click it for the variable.'],
  [() => h('span', { class: 'varies' }, '27 V (Vbatt)'),
    'Not the same for every variant. Click it for the value in the base document and in each variant.'],
  [() => h('span', {},
    h('span', { class: 'step-tag step-tag-stim' }, 'APPLY'), ' ',
    h('span', { class: 'step-tag step-tag-meas' }, 'MEASURE')),
    'What the step does to the unit, and what it reads back from it.'],
  [() => h('span', {},
    h('span', { class: 'step-tag step-tag-set' }, 'SET'), ' ',
    h('span', { class: 'step-tag step-tag-get' }, 'GET')),
    'The same, over a bus: written to the unit or read from it with a command.'],
  [() => h('span', {},
    h('span', { class: 'step-tag step-tag-call' }, 'RUN'), ' ',
    h('span', { class: 'step-tag step-tag-wait' }, 'WAIT')),
    'A setup stage run in full at this point; a pause before going on.'],
  [() => h('span', { class: 'step-tag step-tag-computed' }, 'COMPUTED'),
    'A value worked out from earlier readings of the test, by the formula printed; nothing is measured.'],
  [() => h('span', { class: 'sw' }, h('span', { class: 'ref-name' }, 'Drive the socket lock'), ' ', h('span', { class: 'step-param param-set' }, 'Lock on')),
    'What is said to the software — a command and its arguments — in the software\'s font.'],
  [() => h('span', {},
    h('span', { class: 'kind-tag' }, '123'), ' ', h('span', { class: 'kind-tag' }, 'Abc'), ' ',
    h('span', { class: 'kind-tag' }, 'RegEx'), ' ', h('span', { class: 'kind-tag' }, 'DGT')),
    'How a criterion is judged: as a number, as text, against a pattern, as yes or no.'],
  [() => h('span', { class: 'kpi-badge' }, 'KPI'),
    'A test followed line-side as a key performance indicator; gathered in an appendix of its own.'],
  [() => h('span', { class: 'legend-fold' }, '▾ 6. Test stages'),
    'A heading folds its chapter away on a click, and opens it again.'],
];
