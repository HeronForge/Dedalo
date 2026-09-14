// Validation panel and stage graph.
import { h, button, card, empty } from '../dom.js';
import { validateDocument, SEVERITY, SEVERITY_LABEL } from '../../model/validate.js';
import { computeIndex, labelOf } from '../../model/codes.js';
import { stageGraph, graphLegend } from '../../render/graph.js';
import { parallelGroups } from '../../model/stages.js';
import { resolveVariant } from '../../model/variants.js';

const SYMBOL = { error: '✕', warning: '!', info: 'i' };

/** Where to take the user when they click an issue. */
const SECTION_OF = {
  stage: 'stages', test: 'stages', step: 'stages',
  point: 'points', variable: 'variables', command: 'commands',
  variant: 'variants', header: 'header',
};

export function validationSection(store) {
  const doc = store.resolvedDoc();
  const { issues, counts } = store.validation();
  const bySeverity = (s) => issues.filter((p) => p.severity === s);

  const block = (severity) => {
    const list = bySeverity(severity);
    if (!list.length) return null;
    return card(`${SEVERITY_LABEL[severity]} (${list.length})`,
      h('ul', { class: 'issue-list' }, ...list.map((p) =>
        h('li', { class: 'issue issue-' + severity },
          h('span', { class: 'dot' }, SYMBOL[severity]),
          h('span', { class: 'issue-text' }, p.message),
          p.where && SECTION_OF[p.where.kind]
            ? button('Go', () => goTo(store, p.where), { class: 'btn-small' })
            : null))));
  };

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Validation')),
    h('p', { class: 'hint' },
      `Errors: ${counts.error} · Warnings: ${counts.warning} · Notices: ${counts.info}. `,
      'Nothing here blocks editing: these checks exist so no inconsistency survives into the issued document.'),
    issues.length ? null : empty('No problem found.'),
    block(SEVERITY.ERROR), block(SEVERITY.WARNING), block(SEVERITY.INFO),
    ...variantBlocks(store, issues));
}

/**
 * Every variant, checked as the document it resolves to. The checks above run on what is on
 * screen — the base, or the one variant selected — and a variant that sets a lower limit above
 * the upper one, or drops a stage another one waits for, was invisible until somebody happened
 * to select it. What is listed here is what a variant adds to the picture: an issue the base
 * already has is not repeated under every variant.
 */
function variantBlocks(store, baseIssues) {
  const base = store.state.doc;
  const variants = base.variants || [];
  if (!variants.length) return [];
  const known = new Set(baseIssues.map((p) => p.message));
  return variants.map((v) => {
    const resolved = resolveVariant(base, v.id).doc;
    const own = validateDocument(resolved, { history: store.state.history, base })
      .issues.filter((p) => !known.has(p.message) && p.severity !== SEVERITY.INFO);
    return card(`Variant «${v.name || '(unnamed)'}»${own.length ? ` (${own.length})` : ''}`,
      own.length
        ? h('ul', { class: 'issue-list' }, ...own.map((p) =>
            h('li', { class: 'issue issue-' + p.severity },
              h('span', { class: 'dot' }, SYMBOL[p.severity]),
              h('span', { class: 'issue-text' }, p.message),
              p.where && SECTION_OF[p.where.kind]
                ? button('Go', () => { store.set({ variantId: v.id }); goTo(store, p.where); }, { class: 'btn-small', title: 'Select this variant and open the element' })
                : null)))
        : h('p', { class: 'empty' }, 'Nothing of its own: resolved through this variant, the document has no issue the base does not have.'));
  });
}

function goTo(store, where) {
  const section = SECTION_OF[where.kind];
  store.set({ section, selection: { section, id: where.id, kind: where.kind } });
}

export function graphSection(store) {
  const doc = store.resolvedDoc();
  const codes = store.codes();
  const index = computeIndex(doc);
  const groups = parallelGroups(doc).filter((g) => g.length > 1);

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Stage graph')),
    (doc.stages || []).length
      ? h('div', {},
          h('div', { class: 'graph-box' }, stageGraph(doc, {
            codes,
            onClick: (id) => store.set({ section: 'stages', selection: { section: 'stages', id, kind: 'stage' } }),
          })),
          h('ul', { class: 'legend' }, ...graphLegend().map((l) => h('li', {}, h('span', { class: 'legend-seg ' + l.className }), l.text))),
          card('Stages that may run in parallel',
            groups.length
              ? h('ul', { class: 'plain-list' }, ...groups.map((g) => h('li', {}, g.map((id) => labelOf(codes, index, id, 30)).join('  +  '))))
              : empty('No two stages can run at the same time: the sequence is fully ordered.')))
      : empty('No stage defined.'));
}
