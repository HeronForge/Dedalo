// "Catalogue" sections: header, description, references, glossary, variables,
// resources, interfaces, commands, images.
import { h, field, button, card, empty, pickFiles, toast, confirm } from '../dom.js';
import { textField, selectField, multiField, textInput, checkInput, withVariant, optionsFrom } from '../fields.js';
import { listEditor, subList } from '../list.js';
import {
  newReference, newVariable, newResource, newInterface, newCommand, newProtocol,
  newCharacteristic, newImage, newSignatory, newGlossaryEntry, VARIABLE_TYPE, VARIABLE_TYPE_LABEL,
} from '../../model/schema.js';
import { undefinedAcronyms } from '../../model/glossary.js';
import { chapterOrder, chapterHasContent, movedOrder } from '../../model/chapters.js';
import { codeOf } from '../../model/codes.js';
import { variableText } from '../../model/variables.js';
import { prepareImage, reencodeAsset, assetUrl, assetsWeight, formatBytes, formatLabel, base64Bytes, canEncodeWebp, SIZE_WARNING_BYTES, MAX_SIDE } from '../../io/images.js';

const CONFIDENTIALITY = ['Confidential – internal use', 'Confidential', 'Restricted', 'Public', 'Unclassified'];

export function headerSection(store) {
  const doc = store.resolvedDoc();
  const logo = doc.header.logoAssetId;
  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Document header')),
    h('p', { class: 'hint' }, 'These fields appear on the cover and in the header and footer of every printed page.'),
    h('div', { class: 'grid-2' },
      card('Identification',
        textField(store, ['header', 'title'], 'Document title'),
        textField(store, ['header', 'documentCode'], 'Document code', { placeholder: 'e.g. SPC-TEST-0042' }),
        textField(store, ['header', 'company'], 'Company'),
        textField(store, ['header', 'project'], 'Project'),
        textField(store, ['header', 'product'], 'Product'),
        selectField(store, ['header', 'confidentiality'], 'Confidentiality',
          CONFIDENTIALITY.map((c) => ({ value: c, label: c })), { blank: false }),
        field('Company logo',
          h('div', { class: 'logo-box' },
            logo ? h('img', { class: 'logo-preview', src: assetUrl(store.state.assets, logo), alt: 'Logo' }) : empty('No logo'),
            h('div', {},
              button(logo ? 'Replace…' : 'Upload…', async () => {
                const [file] = await pickFiles({ accept: 'image/*' });
                if (!file) return;
                const asset = await prepareImage(file);
                store.registerAsset(asset);
                store.write(['header', 'logoAssetId'], asset.id, null);
                store.refresh();
              }, { class: 'btn-small' }),
              logo ? button('Remove', () => { store.write(['header', 'logoAssetId'], '', null); store.refresh(); }, { class: 'btn-small' }) : null)))),
      card('Signatures and working revision',
        // As many as the cover needs: three by default, eight on the ones that come from a
        // big supplier, each a role and a name. The table on the cover follows the list.
        field('Signatories', subList(store, {
          path: ['header', 'signatories'], items: (doc.header || {}).signatories, factory: newSignatory,
          addLabel: '+ signatory',
          row: (s, sp) => h('span', { class: 'row-2' },
            textInput(store, [...sp, 'role'], { placeholder: 'e.g. Verified by (SW)' }),
            textInput(store, [...sp, 'name'], { placeholder: 'Name' })),
        }), { help: 'One column of the signature table each, in this order; four to a row on the cover.' }),
        h('hr', {}),
        textField(store, ['revision', 'number'], 'Revision number'),
        textField(store, ['revision', 'date'], 'Date', { type: 'date' }),
        textField(store, ['revision', 'author'], 'Author of the changes'),
        textField(store, ['revision', 'reason'], 'Reason for the revision', { multiline: true, rows: 2 }),
        h('p', { class: 'hint' }, '«Validate» freezes these fields into the history and moves the draft to the next number.')),
      card('Reading options',
        checkInput(store, ['settings', 'noDirectEditing'], 'No direct editing'),
        h('p', { class: 'hint' },
          'In the document view, a code with no detail card of its own — an image, an interface, ',
          'a test, a step — is a link into the editor, where that entity is defined. ',
          'Tick this and those codes are printed as plain text: a specification handed out to be ',
          'read is not a specification to be stepped into. The detail cards keep working either way.')),
      card('Chapters and appendices',
        h('p', { class: 'hint' }, 'The order the document prints them in. A chapter with nothing in it is not printed, and not numbered: the numbers and the letters follow what is there.'),
        chapterOrderList(store, doc)),

      card('Disclaimer',
        textField(store, ['header', 'disclaimer'], 'Text printed on the cover', {
          multiline: true, rows: 4,
          placeholder: 'e.g. This document contains information owned by Acme Electronics Ltd. Reproduction or disclosure to third parties is not allowed without written authorisation.',
        }),
        h('p', { class: 'hint' }, 'Ownership, distribution limits, liability: whatever legal has to say. It is printed in a box at the foot of the first page, and left out when empty.'))));
}

/**
 * The chapters in their order, each with what it holds, and arrows to move it among its
 * kind: a chapter stays a chapter and an appendix an appendix, whatever the order says.
 */
function chapterOrderList(store, doc) {
  const reorderBlocked = !!store.recordingVariant(['settings']);
  const move = (key, delta) => {
    const next = movedOrder(doc, key, delta);
    if (!next) return;
    store.write(['settings', 'chapterOrder'], next, null);
    store.refresh();
  };
  const entries = chapterOrder(doc);
  const item = (c, i, group) => {
    const present = chapterHasContent(c.key, doc);
    return h('li', { class: ['item', !present && 'item-muted'] },
      h('div', { class: 'item-text' },
        h('span', { class: 'tag' }, c.kind === 'chapter' ? 'chapter' : 'appendix'), ' ', c.title,
        present ? null : h('span', { class: 'muted' }, ' — empty, not printed'),
        c.landscape ? h('span', { class: 'muted' }, ' · landscape page') : null),
      h('div', { class: 'item-actions' },
        button('↑', () => move(c.key, -1), { class: 'btn-icon', title: 'Move up', disabled: reorderBlocked || i === 0 }),
        button('↓', () => move(c.key, +1), { class: 'btn-icon', title: 'Move down', disabled: reorderBlocked || i === group.length - 1 })));
  };
  const chapters = entries.filter((c) => c.kind === 'chapter');
  const appendices = entries.filter((c) => c.kind === 'appendix');
  return h('ul', { class: 'list list-compact' },
    ...chapters.map((c, i) => item(c, i, chapters)),
    ...appendices.map((c, i) => item(c, i, appendices)));
}

/**
 * The glossary: what the acronyms of the text stand for. The acronyms the text uses and the
 * glossary does not explain are offered above the list, one press each — the reader of the
 * document is the one who cannot guess them.
 */
export function glossarySection(store) {
  const doc = store.resolvedDoc();
  const missing = undefinedAcronyms(doc);
  const add = (term) => {
    const created = newGlossaryEntry(term);
    store.add(['glossary'], created);
    store.set({ selection: { section: 'glossary', id: created.id } });
  };
  const intro = h('div', {},
    h('p', { class: 'hint' }, 'One line per term, printed as a chapter of its own — in alphabetical order, whatever order they are typed in — and left out of the document while the list is empty.'),
    missing.length
      ? h('div', { class: 'acronym-box' },
          h('div', { class: 'derived-title' }, `${missing.length} acronym${missing.length === 1 ? '' : 's'} in the text with no line here — press one to add it:`),
          h('div', { class: 'acronym-chips' }, ...missing.map((a) => button(a, () => add(a), { class: 'btn-small acronym-chip', title: `Add «${a}» to the glossary` }))),
          h('p', { class: 'hint' }, 'Words in capitals that are not acronyms — «OK», a shouted heading — are simply left alone.'))
      : h('p', { class: 'hint ok-line' }, 'Every acronym the text uses has its line.'));
  return listEditor(store, {
    key: 'glossary', title: 'Glossary', singular: 'Term',
    factory: newGlossaryEntry, intro,
    nameOf: (e) => e.term,
    row: (e) => [h('strong', {}, e.term || '(no term)'), e.meaning ? ` — ${e.meaning}` : ''],
    detail: (e, path) => card('Term',
      textField(store, [...path, 'term'], 'Term', { placeholder: 'e.g. RCM' }),
      textField(store, [...path, 'meaning'], 'Meaning', { multiline: true, rows: 3, placeholder: 'e.g. Residual current monitor: the device that trips the contactor on a leakage current.' })),
  });
}

export function descriptionSection(store) {
  return h('div', { class: 'section' },
    h('div', { class: 'section-head' }, h('h2', {}, 'Description')),
    card('Product description', textInput(store, ['description', 'product'], {
      multiline: true, rows: 8,
      placeholder: 'What the device is, what it does, which interfaces it exposes…',
    })),
    card('Test description', textInput(store, ['description', 'testing'], {
      multiline: true, rows: 8,
      placeholder: 'Purpose of the test, general acceptance criteria, environmental conditions, bench prerequisites…',
    })));
}

export function referencesSection(store) {
  return listEditor(store, {
    key: 'references', title: 'External references', singular: 'Reference',
    factory: newReference,
    nameOf: (e) => e.title,
    row: (e) => [h('strong', {}, e.code || '(no code)'), ' ', e.title || ''],
    detail: (e, path) => card('Reference',
      textField(store, [...path, 'code'], 'Code'),
      textField(store, [...path, 'title'], 'Title'),
      textField(store, [...path, 'revision'], 'Revision / date'),
      textField(store, [...path, 'notes'], 'Notes', { multiline: true, rows: 3 })),
  });
}

export function variablesSection(store) {
  const intro = h('p', { class: 'hint' },
    'Global variables can be referenced by any parameter or measurement limit. ',
    'Each product variant can redefine their value without touching the steps.');
  return listEditor(store, {
    key: 'variables', title: 'Global variables', singular: 'Variable',
    factory: newVariable, intro,
    row: (e) => [h('strong', {}, e.name || '(unnamed)'), ' = ', variableText(e)],
    detail: (e, path) => card('Variable',
      textField(store, [...path, 'name'], 'Name', { placeholder: 'e.g. Vbatt' }),
      selectField(store, [...path, 'type'], 'Type',
        Object.values(VARIABLE_TYPE).map((t) => ({ value: t, label: VARIABLE_TYPE_LABEL[t] })), { blank: false }),
      ...variableValueFields(store, e, path),
      textField(store, [...path, 'description'], 'Description', { multiline: true, rows: 2 })),
  });
}

function variableValueFields(store, v, path) {
  switch (v.type) {
    case VARIABLE_TYPE.RANGE:
      return [
        textField(store, [...path, 'min'], 'Minimum'),
        textField(store, [...path, 'max'], 'Maximum'),
        textField(store, [...path, 'unit'], 'Unit'),
      ];
    case VARIABLE_TYPE.BOOLEAN:
      return [selectField(store, [...path, 'value'], 'Value', [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }], { blank: false })];
    case VARIABLE_TYPE.ENUM:
      return [allowedValuesField(store, v, path), textField(store, [...path, 'value'], 'Current value')];
    case VARIABLE_TYPE.TEXT:
      return [textField(store, [...path, 'value'], 'Value')];
    default:
      return [textField(store, [...path, 'value'], 'Value'), textField(store, [...path, 'unit'], 'Unit')];
  }
}

function allowedValuesField(store, v, path) {
  const p = [...path, 'allowedValues'];
  const inp = h('input', { class: 'inp', value: (v.allowedValues || []).join(', '), placeholder: 'CAN, LIN, UART' });
  inp.addEventListener('change', () => {
    store.write(p, inp.value.split(',').map((s) => s.trim()).filter(Boolean), null);
    store.refresh();
  });
  return field('Allowed values', withVariant(store, p, inp), { help: 'Comma separated.' });
}

export function resourcesSection(store) {
  const intro = h('p', { class: 'hint' },
    'The resource catalogue feeds the summary table at the end of the document: stimuli and ',
    'measurements refer to a resource and state the parameters they need from it.');
  return listEditor(store, {
    key: 'resources', title: 'Test resources', singular: 'Resource',
    factory: newResource, intro,
    row: (e) => [h('strong', {}, e.name || '(unnamed)'), e.category ? ` · ${e.category}` : ''],
    detail: (e, path) => card('Resource',
      textField(store, [...path, 'name'], 'Name', { placeholder: 'e.g. Programmable DC power supply' }),
      textField(store, [...path, 'category'], 'Category', { placeholder: 'e.g. Power, Electrical measurement, Mechanical actuation' }),
      field('Required characteristics', subList(store, {
        path: [...path, 'characteristics'], items: e.characteristics, factory: newCharacteristic,
        addLabel: '+ characteristic',
        row: (c, cp) => h('span', { class: 'row-3' },
          textInput(store, [...cp, 'name'], { placeholder: 'Name (e.g. Max voltage)' }),
          textInput(store, [...cp, 'value'], { placeholder: 'Value (e.g. 30)' }),
          textInput(store, [...cp, 'unit'], { placeholder: 'Unit' })),
      })),
      textField(store, [...path, 'notes'], 'Notes', { multiline: true, rows: 2 })),
  });
}

/**
 * Protocols: the grammar the messages obey. A command says which one it speaks and stays
 * short; the reader who has to build the frame reads it here.
 */
export function protocolsSection(store) {
  const intro = h('p', { class: 'hint' },
    'A bus carries more than one grammar — application frames and UDS on the same CAN line — ',
    'and a command that does not say which one it speaks cannot be built. Describe each of ',
    'them once here; the commands point at them.');
  return listEditor(store, {
    key: 'protocols', title: 'Communication protocols', singular: 'Protocol',
    factory: newProtocol, intro,
    row: (e) => [h('strong', {}, e.name || '(unnamed)'), e.family ? ` · ${e.family}` : ''],
    detail: (e, path) => card('Protocol',
      textField(store, [...path, 'name'], 'Name', { placeholder: 'e.g. UDS over ISO-TP' }),
      textField(store, [...path, 'family'], 'Family / standard', { placeholder: 'e.g. ISO 14229, application specific, Modbus RTU' }),
      selectField(store, [...path, 'referenceId'], 'Defined in (external reference)', optionsFrom(doc.references, codes, 'code'),
        { help: 'The document that specifies the protocol, when this one only names it.' }),
      textField(store, [...path, 'description'], 'What it is', {
        multiline: true, rows: 3,
        placeholder: 'What this protocol is used for on this product, and what a reader has to know before writing a message.',
      }),
      textField(store, [...path, 'requestFormat'], 'Request format', {
        multiline: true, rows: 4,
        placeholder: 'How a request is composed: header, service identifier, payload, padding…',
      }),
      textField(store, [...path, 'responseFormat'], 'Response format', {
        multiline: true, rows: 4,
        placeholder: 'How an answer is composed, positive and negative alike.',
      }),
      field('Rules and parameters', subList(store, {
        path: [...path, 'rules'], items: e.rules, factory: newCharacteristic,
        addLabel: '+ rule',
        row: (c, cp) => h('span', { class: 'row-3' },
          textInput(store, [...cp, 'name'], { placeholder: 'e.g. Timeout P2' }),
          textInput(store, [...cp, 'value'], { placeholder: 'e.g. 50' }),
          textInput(store, [...cp, 'unit'], { placeholder: 'Unit' })),
      }), { help: 'Timings, padding, addressing, byte order: what has to be respected for a message to be understood.' }),
      textField(store, [...path, 'notes'], 'Notes', { multiline: true, rows: 2 })),
  });
}

export function interfacesSection(store) {
  const doc = store.resolvedDoc();
  const codes = store.codes();
  return listEditor(store, {
    key: 'interfaces', title: 'Communication interfaces', singular: 'Interface',
    factory: newInterface,
    row: (e) => [h('strong', {}, e.name || '(unnamed)'), e.type ? ` · ${e.type}` : ''],
    detail: (e, path) => card('Interface',
      textField(store, [...path, 'name'], 'Name', { placeholder: 'e.g. Service console' }),
      textField(store, [...path, 'type'], 'Type', { placeholder: 'UART, CAN, SPI, I²C, Ethernet…' }),
      field('Interface requirements', subList(store, {
        path: [...path, 'parameters'], items: e.parameters, factory: newCharacteristic,
        addLabel: '+ requirement',
        row: (c, cp) => h('span', { class: 'row-3' },
          textInput(store, [...cp, 'name'], { placeholder: 'e.g. Baud rate' }),
          textInput(store, [...cp, 'value'], { placeholder: 'e.g. 115200' }),
          textInput(store, [...cp, 'unit'], { placeholder: 'Unit' })),
      }), { help: 'Baud rate, protocol, electrical levels, termination…' }),
      // The bus reaches the unit somewhere: a step that talks over this interface needs those
      // contacts, exactly as it needs the ones its own stimulus names.
      selectField(store, [...path, 'resourceId'], 'Driven by (test resource)', optionsFrom(doc.resources, codes),
        { help: 'The instrument that speaks this bus. Every command over this interface uses it, so no step has to name it again.' }),
      multiField(store, [...path, 'pointIds'], 'Connected at (application points)', optionsFrom(doc.points, codes),
        { help: 'Where the interface is wired to the unit. A step using a command over it needs these points too, and the bench count says so.' }),
      textField(store, [...path, 'notes'], 'Notes', { multiline: true, rows: 2 })),
  });
}

export function commandsSection(store) {
  const doc = store.resolvedDoc();
  const codes = store.codes();
  const intro = h('p', { class: 'hint' },
    'In the steps a command shows up as a short description with its code: addresses and ',
    'formatting are read here and in the command appendix.');
  return listEditor(store, {
    key: 'commands', title: 'Communication commands', singular: 'Command',
    factory: newCommand, intro,
    row: (e) => [h('span', { class: 'code' }, codeOf(codes, e.id)), ' ', h('strong', {}, e.name || '(unnamed)')],
    detail: (e, path) => card('Command',
      textField(store, [...path, 'name'], 'Name / short description', { placeholder: 'e.g. Read battery voltage' }),
      selectField(store, [...path, 'interfaceId'], 'Interface', optionsFrom(doc.interfaces, codes)),
      selectField(store, [...path, 'protocolId'], 'Protocol', optionsFrom(doc.protocols, codes),
        { help: 'The grammar this command is written in. Its formatting rules are described once in the protocols chapter, not repeated here.' }),
      textField(store, [...path, 'address'], 'Address / identifier', { placeholder: 'e.g. 0x18DAF110, register 0x2A' }),
      textField(store, [...path, 'requestFormat'], 'Request format', { multiline: true, rows: 2 }),
      textField(store, [...path, 'responseFormat'], 'Response format', { multiline: true, rows: 2 }),
      textField(store, [...path, 'negativeResponse'], 'Negative response (optional)', {
        multiline: true, rows: 2,
        placeholder: 'e.g. 7F 22 31 — request out of range',
        help: 'What the unit answers when it refuses. Without it a refusal and a timeout look the same on the bench.',
      }),
      textField(store, [...path, 'encoding'], 'Encoding / scaling', { placeholder: 'e.g. uint16, LSB = 10 mV' }),
      // From the raw answer to the value a step judges, written for a person; the unit is
      // what a criterion over this command is read in when it states none of its own.
      h('div', { class: 'field-row' },
        textField(store, [...path, 'decoding', 'formula'], 'Decoding', { placeholder: 'e.g. hex → U32, − 3072, ÷ 51.15' }),
        textField(store, [...path, 'decoding', 'unit'], 'Decoded unit', { placeholder: 'e.g. mA' })),
      selectField(store, [...path, 'referenceId'], 'Defined in (external reference)', optionsFrom(doc.references, codes, 'code'),
        { help: 'When the command is specified in another document and only named here. A command with a reference and no request or response format is listed as such in validation.' }),
      textField(store, [...path, 'nominalTime'], 'Nominal execution time (s)', {
        placeholder: 'e.g. 0.25',
        help: 'How long the command usually takes, request to answer. Used by the cycle time estimator.',
      }),
      textField(store, [...path, 'example'], 'Example', { multiline: true, rows: 2 }),
      textField(store, [...path, 'notes'], 'Notes', { multiline: true, rows: 2 })),
  });
}

export function imagesSection(store) {
  const doc = store.resolvedDoc();
  const images = doc.images || [];
  const weight = assetsWeight(store.state.assets);

  const upload = async () => {
    const files = await pickFiles({ accept: 'image/*', multiple: true });
    let before = 0;
    let after = 0;
    for (const file of files) {
      try {
        const asset = await prepareImage(file);
        store.registerAsset(asset);
        store.add(['images'], newImage(asset.id, file.name.replace(/\.[^.]+$/, '')));
        before += asset.sourceBytes || 0;
        after += base64Bytes(asset.data);
      } catch (err) {
        toast(`Image «${file.name}» was not loaded: ${err.message}`, 'error');
      }
    }
    if (after) {
      toast(before > after
        ? `${files.length} image${files.length > 1 ? 's' : ''} embedded: ${formatBytes(before)} → ${formatBytes(after)} (${Math.round((1 - after / before) * 100)} % less).`
        : `${files.length} image${files.length > 1 ? 's' : ''} embedded (${formatBytes(after)}).`, 'ok', 6000);
    }
    store.refresh();
  };

  /** Re-encodes what is already in the pool — for documents written before WebP was used. */
  const optimise = async () => {
    const assets = store.state.assets || {};
    const before = assetsWeight(assets);
    let changed = 0;
    // The id comes from the pool key, not from the asset: it names the picture, and the
    // issued revisions refer to it by that name, so re-encoding must not change it.
    for (const [id, asset] of Object.entries(assets)) {
      const better = await reencodeAsset(asset);
      if (better) { store.registerAsset({ ...better, id }); changed++; }
    }
    store.refresh();
    const after = assetsWeight(store.state.assets);
    toast(changed
      ? `${changed} image${changed > 1 ? 's' : ''} re-encoded: ${formatBytes(before)} → ${formatBytes(after)}.`
      : 'Nothing to gain: the images are already stored in the smallest form this browser can write.', 'ok', 7000);
  };

  const cards = images.map((img) => {
    const path = ['images', '#' + img.id];
    const asset = (store.state.assets || {})[img.assetId] || {};
    return h('div', { class: 'image-card' },
      h('img', { class: 'preview', src: assetUrl(store.state.assets, img.assetId), alt: img.name || '' }),
      h('div', {},
        h('p', { class: 'hint image-facts' },
          h('span', { class: 'tag' }, formatLabel(asset.mime)), ' ',
          asset.width ? `${asset.width}×${asset.height} · ` : '',
          formatBytes(base64Bytes(asset.data)),
          asset.sourceBytes && asset.sourceBytes > base64Bytes(asset.data)
            ? h('span', { class: 'muted' }, ` (from ${formatBytes(asset.sourceBytes)})`)
            : null),
        textField(store, [...path, 'name'], 'Name'),
        textField(store, [...path, 'caption'], 'Caption', { multiline: true, rows: 2 }),
        button('Delete image', async () => {
          if (await confirm('Delete the image? The markers of the points using it will lose their reference.', { danger: true, okLabel: 'Delete' })) {
            store.remove(path);
            store.refresh();
          }
        }, { class: 'btn-small btn-danger' })));
  });

  return h('div', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', {}, 'Images'),
      h('div', { class: 'head-actions' },
        images.length ? button('Optimise', optimise, { title: 'Re-encode the images already embedded, keeping their references' }) : null,
        button('+ Upload images…', upload, { class: 'btn-primary' }))),
    h('p', { class: 'hint' },
      'Any common format goes in — JPEG, PNG, WebP, GIF, BMP. Pictures are resized to ',
      `${MAX_SIDE} px on the long side and stored as `,
      canEncodeWebp()
        ? h('strong', {}, 'WebP')
        : h('strong', {}, 'PNG or JPEG (this browser cannot write WebP)'),
      ', or in their original form when that is already smaller. Vector images (SVG) are kept as they are. ',
      `Current image weight: ${formatBytes(weight)}.`,
      weight > SIZE_WARNING_BYTES ? h('strong', {}, ' The file is getting heavy: consider reducing the number of images.') : null),
    images.length ? h('div', { class: 'image-grid' }, ...cards) : empty('No image uploaded.'));
}
