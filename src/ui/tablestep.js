// The editor of a table step: the columns as a list, the cells as a grid of plain text.
//
// The whole point is that this does not become a spreadsheet. A column is declared once —
// what it applies or reads, with what, in which unit — in the same list widget every other
// nested thing uses; a cell is one text input in the compact grammar the guide gives («12
// ±0.5», «< 0.8», «recorded»), read into a criterion when the field is left. What the grammar
// cannot say — a criterion that came in from a file as an open two-sided comparison, say —
// is shown as it will print and left alone: a criterion like that belongs in an ordinary step.
import { h, field, button, card, confirm } from './dom.js';
import { textInput, selectInput, multiField, selectField, optionsFrom } from './fields.js';
import { newTableColumn, newTableRow, newTableCell, TABLE_COLUMN_KIND, expectedBadge } from '../model/schema.js';
import { parseCriterion, criterionToShorthand, parseValue, valueToShorthand, cellValueText } from '../model/shorthand.js';
import { variableIndex, expectedText } from '../model/variables.js';
import { computeIndex, labelOf } from '../model/codes.js';
import { cloneEntity, indexAfter } from '../model/clone.js';

/**
 * @param {object} store
 * @param {object} doc the resolved document
 * @param {Map} codes
 * @param {Array} path the path of the step
 * @param {object} step
 */
export function tableEditor(store, doc, codes, path, step) {
  const table = step.table || { columns: [], rows: [] };
  const columns = table.columns || [];
  const rows = table.rows || [];
  const tablePath = [...path, 'table'];
  const variables = variableIndex(doc);
  const byName = (name) => ((doc.variables || []).find((v) => v.name === name) || {}).id || null;
  const nameOf = (id) => (variables.get(id) || {}).name || '';

  // A column added gets a cell in every row; a row added gets a cell for every column: the
  // grid never has a hole the reader has to explain. Each of these writes the table whole, on
  // its own path: one undo step, and under a variant one customisation, however many cells.
  const rewrite = (fn) => {
    const next = JSON.parse(JSON.stringify(table));
    fn(next);
    store.write(tablePath, next, null);
    store.refresh();
  };
  const addColumn = (kind) => rewrite((t) => {
    const column = newTableColumn(kind);
    t.columns.push(column);
    for (const row of t.rows) row.cells.push(newTableCell(column));
  });
  const addRow = () => rewrite((t) => {
    const row = newTableRow();
    row.cells = t.columns.map((c) => newTableCell(c));
    t.rows.push(row);
  });
  const removeColumn = async (column) => {
    if (!(await confirm(`Remove column «${column.name || '(unnamed)'}» and its cells in every row?`, { danger: true, okLabel: 'Remove' }))) return;
    rewrite((t) => {
      t.columns = t.columns.filter((c) => c.id !== column.id);
      for (const row of t.rows) row.cells = row.cells.filter((cell) => cell.columnId !== column.id);
    });
  };

  return h('div', {},
    card('Columns — what every row applies and reads',
      h('p', { class: 'hint' }, 'A column is declared once and shared by every row: its points, its instrument or its command occupy the bench like a stimulus or a measurement block would.'),
      columns.length
        ? h('div', { class: 'sublist' }, ...columns.map((c, i) => columnRow(store, doc, codes, tablePath, c, i, columns, removeColumn)))
        : h('p', { class: 'empty' }, 'No column yet.'),
      h('div', { class: 'toolstrip' },
        button('+ stimulus column', () => addColumn(TABLE_COLUMN_KIND.STIMULUS), { class: 'btn-small' }),
        button('+ measurement column', () => addColumn(TABLE_COLUMN_KIND.MEASUREMENT), { class: 'btn-small' }))),
    card('Rows — one combination each',
      columns.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table grid-editor' },
            h('thead', {}, h('tr', {},
              h('th', {}, 'Row'),
              ...columns.map((c) => h('th', {}, h('span', { class: 'tag' }, c.kind === TABLE_COLUMN_KIND.STIMULUS ? 'APPLY' : 'MEASURE'), ' ', c.name || '(unnamed)', c.unit ? h('span', { class: 'muted' }, ` [${c.unit}]`) : null)),
              h('th', {}, ''))),
            h('tbody', {}, ...rows.map((row) => gridRow(store, doc, codes, tablePath, row, columns, rows, { byName, nameOf, variables })))))
        : h('p', { class: 'empty' }, 'Declare the columns first.'),
      h('div', { class: 'toolstrip' }, button('+ row', addRow, { class: 'btn-small', disabled: !columns.length })),
      h('p', { class: 'hint' },
        'A measurement cell is typed as the specification writes it: «12 ±0.5», «12 ±5%», «< 0.8», «>= 3», «10 … 14», «$Vbat ±5%», «recorded», «yes» / «no»; anything else is the text the unit must answer. The unit is the one the column declares. A stimulus cell is a value or «$Variable».')));
}

/** One declared column: kind, name, unit, and what it works with. */
function columnRow(store, doc, codes, tablePath, column, i, columns, removeColumn) {
  const cp = [...tablePath, 'columns', '#' + column.id];
  const command = (doc.commands || []).find((c) => c.id === column.commandId);
  const itf = command ? (doc.interfaces || []).find((x) => x.id === command.interfaceId) : null;
  const index = computeIndex(doc);
  const commandSelect = selectInput(store, [...cp, 'commandId'], optionsFrom(doc.commands, codes));
  commandSelect.addEventListener('change', () => {
    if (commandSelect.value) { store.write([...cp, 'resourceId'], '', null); store.write([...cp, 'pointIds'], [], null); }
    store.refresh();
  });
  const reorderBlocked = !!store.recordingVariant(tablePath);
  return h('div', { class: 'subrow subrow-column' },
    h('div', { class: 'column-head' },
      selectInput(store, [...cp, 'kind'], [
        { value: TABLE_COLUMN_KIND.STIMULUS, label: 'Stimulus — applied' },
        { value: TABLE_COLUMN_KIND.MEASUREMENT, label: 'Measurement — read back' },
      ], { blank: false }),
      textInput(store, [...cp, 'name'], { placeholder: 'e.g. PP resistor, ilimit' }),
      textInput(store, [...cp, 'unit'], { placeholder: 'Unit' }),
      button('↑', () => store.move([...tablePath, 'columns'], column.id, -1), { class: 'btn-icon', title: 'Move left', disabled: reorderBlocked || i === 0 }),
      button('↓', () => store.move([...tablePath, 'columns'], column.id, +1), { class: 'btn-icon', title: 'Move right', disabled: reorderBlocked || i === columns.length - 1 }),
      button('✕', () => removeColumn(column), { class: 'btn-icon btn-danger', title: 'Remove the column and its cells' })),
    h('div', { class: 'column-refs' },
      field(column.kind === TABLE_COLUMN_KIND.STIMULUS ? 'Command — SET' : 'Command — GET', commandSelect),
      command
        ? h('div', { class: 'derived' },
            h('div', { class: 'derived-title' }, 'From the interface of this command'),
            itf
              ? h('span', {}, 'Interface: ', labelOf(codes, index, itf.id, 30), ' · Instrument: ',
                  itf.resourceId ? labelOf(codes, index, itf.resourceId, 30) : h('strong', {}, 'none declared'))
              : h('span', { class: 'hint' }, 'This command names no interface.'))
        : h('div', { class: 'field-row' },
            multiField(store, [...cp, 'pointIds'], 'Application points', optionsFrom(doc.points, codes)),
            selectField(store, [...cp, 'resourceId'], 'Resource', optionsFrom(doc.resources, codes)))));
}

/** One row of the grid: its label, one input per column, and the row's own buttons. */
function gridRow(store, doc, codes, tablePath, row, columns, rows, { byName, nameOf, variables }) {
  const rp = [...tablePath, 'rows', '#' + row.id];
  const reorderBlocked = !!store.recordingVariant(tablePath);
  const cellsPath = [...rp, 'cells'];
  return h('tr', {},
    h('td', { class: 'grid-label-cell' }, textInput(store, [...rp, 'label'], { placeholder: 'e.g. 1500 Ω / 13 A' })),
    ...columns.map((column) => {
      const cell = (row.cells || []).find((c) => c.columnId === column.id);
      return h('td', {}, cellInput(store, doc, cellsPath, column, cell, { byName, nameOf, variables }));
    }),
    h('td', { class: 'grid-row-actions' },
      button('⧉', () => store.add([...tablePath, 'rows'], cloneEntity(row), indexAfter(rows, row.id)), { class: 'btn-icon', title: 'Duplicate this row' }),
      button('↑', () => store.move([...tablePath, 'rows'], row.id, -1), { class: 'btn-icon', title: 'Move up', disabled: reorderBlocked }),
      button('↓', () => store.move([...tablePath, 'rows'], row.id, +1), { class: 'btn-icon', title: 'Move down', disabled: reorderBlocked }),
      button('✕', () => store.remove(rp), { class: 'btn-icon btn-danger', title: 'Remove the row' })));
}

/**
 * One cell: a text input in the compact grammar, read into the model when the field is left.
 * Under it, the criterion as it will print, so what was typed can be checked at a glance.
 */
function cellInput(store, doc, cellsPath, column, cell, { byName, nameOf, variables }) {
  const stimulus = column.kind === TABLE_COLUMN_KIND.STIMULUS;
  const shorthand = !cell ? '' : stimulus ? valueToShorthand(cell.value, nameOf) : criterionToShorthand(cell.expected, nameOf);
  // What the grammar cannot say is shown, not edited: the file it came from said more.
  if (shorthand === null) {
    return h('div', { class: 'grid-cell-fixed', title: 'This criterion cannot be written in the compact grammar: it stays as it came in. Use an ordinary step to change it.' },
      h('span', { class: 'tag' }, '⚠'), ' ', expectedText({ expected: cell.expected }, variables));
  }
  const input = h('input', { class: 'inp inp-cell', value: shorthand, placeholder: stimulus ? 'value or $Var' : '12 ±0.5 · < 0.8 · yes' });
  const commit = () => {
    const next = cell ? { ...cell } : newTableCell(column);
    if (stimulus) next.value = parseValue(input.value, { variable: byName }).value;
    else next.expected = parseCriterion(input.value, { unit: column.unit, variable: byName }).expected;
    if (cell) store.write([...cellsPath, '#' + cell.id], next, null);
    else store.add(cellsPath, next);
    store.refresh();
  };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } });
  const preview = !cell ? '' : stimulus ? cellValueText(cell.value, variables, column.unit) : expectedText({ expected: cell.expected }, variables);
  return h('div', { class: 'grid-cell-edit' },
    input,
    cell && !stimulus && preview
      ? h('div', { class: 'grid-cell-read' }, preview, ' ', h('span', { class: 'tag' }, expectedBadge(cell.expected)))
      : cell && stimulus && preview ? h('div', { class: 'grid-cell-read' }, preview) : null);
}
