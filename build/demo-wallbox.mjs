// Showcase document shipped as dist/wallbox.html: an end of line specification for an EV
// charging controller, written to exercise every part of the tool at once — four photographs
// with forty contact points, routines called from several places, a stage graph with real
// parallelism, four kinds of acceptance criterion, three variants that change values, remove
// stages and add tests, and three issued revisions to compare. The small example in demo.mjs
// stays what the checks and a first look need; this one is what a demonstration needs.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  emptyDocument, newReference, newSignatory, newVariable, newVariant, newResource, newInterface,
  newCommand, newPoint, newCharacteristic, newImage, newMarker, newStage, newTest,
  newStep, newParameter, newHeldStimulus, newProtocol, newTableColumn, newTableRow, newTableCell, constant, variableRef,
  STEP_TYPE, VARIABLE_TYPE, EXCLUSION_MODE, STAGE_KIND, TABLE_COLUMN_KIND, newGlossaryEntry,
} from '../src/model/schema.js';
import { parseCriterion, parseValue as parseCellValue } from '../src/model/shorthand.js';
import { OP } from '../src/model/variants.js';
import { compress, assetsUsedBy } from '../src/history/revisions.js';

const here = dirname(fileURLToPath(import.meta.url));

const with_ = (base, fields) => Object.assign(base, fields);

const characteristic = (name, value, unit = '') => with_(newCharacteristic(), { name, value, unit });

/**
 * A value reference from whatever is at hand: a variable object, a value reference already
 * built, or a plain constant. The steps below read better for it.
 */
const ref = (v) => {
  if (v && typeof v === 'object' && v.mode) return v;
  if (v && typeof v === 'object' && v.id) return variableRef(v.id);
  return constant(v == null ? '' : String(v));
};

const parameter = (name, value, unit = '') => with_(newParameter(), { name, value: ref(value), unit });

// ---- acceptance criteria, one helper per way of judging a value -----------------------------

const criterion = (over) => ({
  kind: 'numeric', mode: 'minmax', min: constant(''), max: constant(''),
  nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: '',
  text: constant(''), stringComparison: 'EQ', caseSensitive: true, regex: false,
  booleanValue: 'true',
  ...over,
});

const between = (min, max, unit) => criterion({ min: ref(min), max: ref(max), unit });
const atMost = (max, unit) => criterion({ comparison: 'LE', max: ref(max), unit });
const lessThan = (max, unit) => criterion({ comparison: 'LT', max: ref(max), unit });
const atLeast = (min, unit) => criterion({ comparison: 'GE', min: ref(min), unit });
const exactly = (value, unit) => criterion({ comparison: 'EQ', min: ref(value), unit });
const around = (nominal, tolerance, unit, toleranceType = 'absolute') =>
  criterion({ mode: 'nominal', nominal: ref(nominal), tolerance: ref(tolerance), toleranceType, unit });
const recorded = (unit) => criterion({ comparison: 'NONE', unit });
const text = (value, stringComparison = 'EQ', extra = {}) =>
  criterion({ kind: 'string', text: ref(value), stringComparison, ...extra });
const yes = () => criterion({ kind: 'boolean', booleanValue: 'true' });

// ---- steps ----------------------------------------------------------------------------------

// «1 s» as a constant, or a variable object when the wait is one the document declares.
const waitOf = (wait) => {
  if (!wait) return { value: constant(''), unit: 's' };
  if (typeof wait === 'object') return { value: variableRef(wait.id), unit: wait.unit || 's' };
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|min)$/.exec(wait);
  return { value: constant(m[1]), unit: m[2] };
};

const block = (target, { description = '', points = [], resource = '', command = '', parameters = [] }) =>
  with_(target, { description, pointIds: points.map((p) => p.id), resourceId: resource ? resource.id : '', commandId: command ? command.id : '', parameters });

function stimulus(description, apply, { wait, note = '' } = {}) {
  const s = with_(newStep(STEP_TYPE.STIMULUS), { description, wait: waitOf(wait), note });
  block(s.stimulus, apply);
  return s;
}

function measurement(description, read, { wait, note = '' } = {}) {
  const s = with_(newStep(STEP_TYPE.MEASUREMENT), { description, wait: waitOf(wait), note });
  block(s.measurement, read);
  s.measurement.expected = read.expected;
  return s;
}

function both(description, apply, read, { wait, note = '' } = {}) {
  const s = with_(newStep(STEP_TYPE.STIMULUS_MEASUREMENT), { description, wait: waitOf(wait), note });
  block(s.stimulus, apply);
  block(s.measurement, read);
  s.measurement.expected = read.expected;
  return s;
}

/**
 * A table step: the columns declared once, then one row per combination, each cell written
 * in the compact grammar the guide gives («= 13», «$MaxCurrent ±0», «recorded», «open»).
 * @param {Array<{name, kind, unit, points?, resource?, command?}>} columns
 * @param {Array<[label, ...cells]>} rows one string per column, in the columns' order
 */
function tableStep(description, columns, rows, { wait, note = '', variables = [] } = {}) {
  const s = with_(newStep(STEP_TYPE.TABLE), { description, wait: waitOf(wait), note });
  const variable = (name) => (variables.find((v) => v.name === name) || {}).id || null;
  s.table.columns = columns.map((c) => with_(newTableColumn(c.kind), {
    name: c.name, unit: c.unit || '',
    pointIds: (c.points || []).map((p) => p.id), resourceId: c.resource ? c.resource.id : '', commandId: c.command ? c.command.id : '',
  }));
  s.table.rows = rows.map(([label, ...cells]) => {
    const row = with_(newTableRow(), { label });
    row.cells = s.table.columns.map((column, i) => {
      const cell = newTableCell(column);
      if (column.kind === TABLE_COLUMN_KIND.STIMULUS) cell.value = parseCellValue(cells[i], { variable }).value;
      else cell.expected = parseCriterion(cells[i], { unit: column.unit, variable }).expected;
      return cell;
    });
    return row;
  });
  return s;
}

function call(description, stage, { wait, note = '' } = {}) {
  return with_(newStep(STEP_TYPE.STAGE_CALL), { description, calledStageId: stage.id, wait: waitOf(wait), note });
}

const test = (name, purpose, steps, { kpi = false } = {}) => with_(newTest(), { name, purpose, kpi, steps });

// ---- pictures -------------------------------------------------------------------------------

/**
 * The photographs live beside the builder as WebP, already at the size the tool would store
 * them at: the build stays a pure Node script, and the file it writes is the file the tool
 * would have written.
 */
async function picture(id, file, name, width, height) {
  const data = await readFile(join(here, 'showcase', 'images', file));
  return { id, mime: 'image/webp', data: data.toString('base64'), width, height, name: file };
}

/* The wordmark, drawn rather than generated: a flat logo is the one picture a script can make. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120" viewBox="0 0 360 120">
<rect width="360" height="120" rx="14" fill="#0e5c63"/>
<path d="M58 14 L34 66 L54 66 L44 106 L84 50 L62 50 L76 14 Z" fill="#a4e04a"/>
<rect x="96" y="30" width="14" height="24" rx="3" fill="#ffffff"/>
<rect x="118" y="30" width="14" height="24" rx="3" fill="#ffffff"/>
<path d="M88 54 H140 V78 A26 26 0 0 1 114 104 A26 26 0 0 1 88 78 Z" fill="#ffffff"/>
<text x="156" y="72" font-family="Arial, Helvetica, sans-serif" font-size="32" font-weight="700" letter-spacing="1.5" fill="#ffffff">VOLTARIA</text>
<text x="158" y="96" font-family="Arial, Helvetica, sans-serif" font-size="13" letter-spacing="4" fill="#a4e04a">ENERGY</text>
</svg>`;

const LOGO_ASSET = {
  id: 'showcaselogo0001',
  mime: 'image/svg+xml',
  data: Buffer.from(LOGO_SVG, 'utf8').toString('base64'),
  width: 360,
  height: 120,
  name: 'voltaria-logo.svg',
};

export async function buildWallboxDemo() {
  const doc = emptyDocument();

  const assets = {
    [LOGO_ASSET.id]: LOGO_ASSET,
    showcasepcbtop01: await picture('showcasepcbtop01', 'pcb-top.webp', 'pcb-top.webp', 1448, 1086),
    showcasepcbbot01: await picture('showcasepcbbot01', 'pcb-bottom.webp', 'pcb-bottom.webp', 1195, 896),
    showcasefront001: await picture('showcasefront001', 'front.webp', 'front.webp', 1024, 1536),
    showcaseterms001: await picture('showcaseterms001', 'terminals.webp', 'terminals.webp', 1408, 768),
  };

  doc.header = {
    title: 'End of line test specification',
    company: 'Voltaria Energy S.r.l.',
    logoAssetId: LOGO_ASSET.id,
    project: 'P-3120 — Ampère wallbox platform',
    product: 'EVC-22 AC charge controller',
    documentCode: 'TS-EVC-0117',
    confidentiality: 'Confidential – internal use',
    disclaimer: 'This document contains information owned by Voltaria Energy S.r.l. It is issued for the sole purpose of testing the EVC-22 charge controller at the end of the production line and may not be reproduced, disclosed to third parties or used for any other purpose without written authorisation.\n\nThe dielectric strength stage applies hazardous voltages: it is run only on the bench described in the appendices, with the interlocked guard closed, by personnel qualified under WI-HV-002. The limits stated here apply to that bench; any deviation must be agreed with the test engineering department before the line is released.',
    // Eight signatures, as a big supplier's cover carries them: who issued it, department by
    // department, who verified it, and the one who approved it.
    signatories: [
      newSignatory('Issued by (Test Eng.)', 'G. Ferraro'),
      newSignatory('Issued by (HW)', 'P. Colombo'),
      newSignatory('Issued by (SW)', 'L. Marini'),
      newSignatory('Verified by (Quality)', 'S. Moretti'),
      newSignatory('Verified by (Production)', 'A. Rinaldi'),
      newSignatory('Verified by (Safety)', 'M. Greco'),
      newSignatory('Verified by (Customer)', 'R. Fontana'),
      newSignatory('Approved by', 'C. De Luca'),
    ],
  };
  doc.revision = { number: '03', date: '2026-09-10', author: 'G. Ferraro', reason: 'EVC-22 Pro variant, standby power limit tightened to 3 W', status: 'draft' };

  doc.description = {
    product: 'The EVC-22 is the control unit of the Voltaria wallbox family: an AC charging station for electric vehicles in Mode 3 (IEC 61851-1), up to 22 kW on three phases. The controller measures the mains at X1, drives the charging contactor and the socket lock through the on-board relays K1 and K2, generates the Control Pilot signal and reads the Proximity Pilot of the cable, monitors the residual current through the sensor at X2, reads the energy meter over RS-485 (X4) and reports to the charging backend over Ethernet (X3) or Wi-Fi with OCPP 1.6J.\n\nThe front panel — LED ring, RFID reader, display and buzzer — hangs off connector X5. A service console on header J1 gives the bench direct access to every function; it is enabled only in test mode and is closed again before the unit leaves the line.\n\nThe same board serves the whole family: EVC-22 (three phases, 32 A), EVC-11 (three phases, 16 A), EVC-7 S (single phase, 32 A, no RFID reader and no display) and EVC-22 Pro, which adds an LTE modem for sites without a wired network.',
    testing: 'The end of line test runs on the assembled unit in its enclosure, with the front panel fitted and the wiring compartment open. The bed of nails reaches the solder side of the board; the mains, the meter and the residual current loop are reached through the wiring compartment, and the vehicle side through the Type 2 socket, where an EV simulator plays the vehicle.\n\nThe sequence has three blocks. Safety first: the dielectric strength stage runs alone, with the guard closed and nothing else connected. Then the charging functions — supply rails, Control Pilot, Proximity Pilot, contactor and lock, residual current, metering — in the order their prerequisites impose. Finally the front panel, the sensors and the communications, which may run alongside one another because they share nothing but the console.\n\nUnless stated otherwise, every measurement is taken at room temperature with the mains supplied by the isolated programmable source at the nominal test voltage. The fault register is read as a hexadecimal word; the bits are listed with the command that reads it.',
  };

  // ---- references
  // The acronyms the text uses, explained once: the chapter prints them in alphabetical
  // order, and the editor lists the ones the text uses that are not here.
  doc.glossary = [
    ['AC', 'Alternating current — the mains side of the wallbox, single or three phase.'],
    ['DC', 'Direct current — the fault current the RCM detects on the vehicle side, and the bench supplies.'],
    ['EV', 'Electric vehicle.'],
    ['EOL', 'End of line — the test every unit passes before it leaves production.'],
    ['CP', 'Control pilot — the PWM signal between the wallbox and the vehicle (IEC 61851-1).'],
    ['PP', 'Proximity pilot — the resistor in the cable plug that codes its current capability.'],
    ['PE', 'Protective earth.'],
    ['PWM', 'Pulse width modulation — the 1 kHz control pilot signal, whose duty cycle codes the current limit.'],
    ['RCM', 'Residual current monitor — detects an AC or DC leakage current and opens the contactor.'],
    ['RFID', 'Radio frequency identification — the reader that authorises a charge from a tag.'],
    ['UID', 'Unique identifier of an RFID tag.'],
    ['OCPP', 'Open Charge Point Protocol — the messages between the wallbox and the charging backend.'],
    ['JSON', 'JavaScript Object Notation — the text format OCPP messages are written in.'],
    ['LTE', 'Long Term Evolution — the mobile network of the cellular modem.'],
    ['RSSI', 'Received signal strength indicator — how strong the wireless network is, in dBm.'],
    ['UART', 'Universal asynchronous receiver-transmitter — the service serial port.'],
    ['USB', 'Universal serial bus — the service connector on the front panel.'],
    ['RTU', 'Remote terminal unit — the binary framing of Modbus over a serial line.'],
    ['LED', 'Light emitting diode — the ring on the front panel.'],
    ['NTC', 'Negative temperature coefficient thermistor — the temperature sensor of the socket.'],
    ['MCU', 'Microcontroller unit — the processor of the controller board.'],
    ['SELV', 'Safety extra-low voltage — the circuits a person may touch.'],
    ['IEC', 'International Electrotechnical Commission — the standards the references cite.'],
    ['IEEE', 'Institute of Electrical and Electronics Engineers — IEEE 754 is the floating point format of the meter registers.'],
    ['ISO', 'International Organization for Standardization — ISO 14443A is the RFID tag family.'],
  ].map(([term, meaning]) => with_(newGlossaryEntry(), { term, meaning }));

  doc.references = [
    with_(newReference(), { code: 'IEC 61851-1:2017', title: 'Electric vehicle conductive charging system — Part 1: General requirements', revision: 'Ed. 3.0' }),
    with_(newReference(), { code: 'IEC 62955:2018', title: 'Residual direct current detecting device (RDC-DD) for Mode 3 charging', revision: 'Ed. 1.0' }),
    with_(newReference(), { code: 'SPC-HW-EVC-014', title: 'EVC-22 hardware design specification', revision: 'Rev. 06' }),
    with_(newReference(), { code: 'ICD-OCPP-VOL', title: 'Voltaria OCPP 1.6J implementation profile', revision: 'Rev. 03' }),
    with_(newReference(), { code: 'ICD-MB-EM3', title: 'Energy meter EM3-DIN — Modbus register map', revision: 'Rev. 02' }),
    with_(newReference(), { code: 'PRC-QAL-011', title: 'End of line testing procedure', revision: 'Rev. 04' }),
    with_(newReference(), { code: 'WI-HV-002', title: 'Work instruction — dielectric strength testing on the EOL bench', revision: 'Rev. 01', notes: 'Mandatory reading for whoever operates the bench.' }),
  ];
  // A command or a protocol specified elsewhere points at the document by its code.
  const refByCode = (code) => doc.references.find((r) => r.code === code);

  // ---- variables
  const vMains = with_(newVariable(), { name: 'MainsVoltage', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '230', description: 'Phase to neutral test voltage, applied by the programmable source.' });
  const vFreq = with_(newVariable(), { name: 'MainsFrequency', type: VARIABLE_TYPE.NUMBER, unit: 'Hz', value: '50', description: 'Test frequency.' });
  const vPhases = with_(newVariable(), { name: 'Phases', type: VARIABLE_TYPE.ENUM, allowedValues: ['1', '3'], value: '3', description: 'Number of supply phases wired to the unit under test.' });
  const vMaxCurrent = with_(newVariable(), { name: 'MaxCurrent', type: VARIABLE_TYPE.NUMBER, unit: 'A', value: '32', description: 'Rated charging current per phase, as on the nameplate.' });
  const vDuty = with_(newVariable(), { name: 'PwmDuty', type: VARIABLE_TYPE.NUMBER, unit: '%', value: '53.3', description: 'Control Pilot duty cycle that advertises MaxCurrent: duty = I / 0.6 A for currents up to 51 A (IEC 61851-1, table A.8).' });
  const vDutyTol = with_(newVariable(), { name: 'PwmDutyTol', type: VARIABLE_TYPE.NUMBER, unit: '%', value: '1', description: 'Absolute tolerance on the duty cycle, all sources of error included.' });
  const vCpHigh = with_(newVariable(), { name: 'CpHigh', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '12', description: 'Positive level of the Control Pilot, unloaded (state A).' });
  const vCpLow = with_(newVariable(), { name: 'CpLow', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '-12', description: 'Negative level of the Control Pilot.' });
  const vCpTol = with_(newVariable(), { name: 'CpLevelTol', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '0.6', description: 'Tolerance on the Control Pilot levels.' });
  const vSettle = with_(newVariable(), { name: 'PilotSettle', type: VARIABLE_TYPE.NUMBER, unit: 'ms', value: '500', description: 'How long the unit is given to debounce a change of pilot state before it is read back.' });
  const vRcmAc = with_(newVariable(), { name: 'RcmAcTripTimeMax', type: VARIABLE_TYPE.NUMBER, unit: 'ms', value: '300', description: 'Longest time allowed between the injection of 30 mA AC and the opening of the contactor.' });
  const vRcmDc = with_(newVariable(), { name: 'RcmDcTripTimeMax', type: VARIABLE_TYPE.NUMBER, unit: 's', value: '10', description: 'Longest time allowed between the injection of 6 mA DC and the opening of the contactor (IEC 62955).' });
  const vStandby = with_(newVariable(), { name: 'StandbyPowerMax', type: VARIABLE_TYPE.NUMBER, unit: 'W', value: '3', description: 'Highest active power drawn with no vehicle connected and the display idle.' });
  const vMeterAcc = with_(newVariable(), { name: 'MeterAccuracy', type: VARIABLE_TYPE.NUMBER, unit: '%', value: '1', description: 'Largest deviation allowed between the power the controller reads from its meter and the reference analyser.' });
  const vAmbient = with_(newVariable(), { name: 'AmbientTemp', type: VARIABLE_TYPE.RANGE, unit: '°C', min: '18', max: '28', description: 'Temperature range allowed in the test area.' });
  const vFwPattern = with_(newVariable(), { name: 'FwPattern', type: VARIABLE_TYPE.TEXT, value: '^EVC22 v2\\.\\d+\\.\\d+$', description: 'Accepted shape of the firmware version string. Changed here when the release family changes, not in the steps that read it.' });
  const vSsid = with_(newVariable(), { name: 'BenchSsid', type: VARIABLE_TYPE.TEXT, value: 'VOLTARIA-EOL', description: 'Wi-Fi network broadcast by the bench access point.' });
  const vRfidUid = with_(newVariable(), { name: 'RfidTestUid', type: VARIABLE_TYPE.TEXT, value: '04:A3:2F:1C:6E:80:01', description: 'UID of the ISO 14443A test tag mounted on the actuator. When the tag is replaced, this is the only place to change.' });
  const vTrace = with_(newVariable(), { name: 'TraceLogging', type: VARIABLE_TYPE.BOOLEAN, value: 'false', description: 'When true, the bench keeps the full console and OCPP trace of every unit, not only of the failed ones.' });
  doc.variables = [vMains, vFreq, vPhases, vMaxCurrent, vDuty, vDutyTol, vCpHigh, vCpLow, vCpTol, vSettle, vRcmAc, vRcmDc, vStandby, vMeterAcc, vAmbient, vFwPattern, vSsid, vRfidUid, vTrace];

  // ---- resources
  const acSource = with_(newResource(), {
    name: 'Programmable AC source, three phase', category: 'Power', averageTime: '2',
    characteristics: [characteristic('Voltage', '0 … 300', 'V per phase'), characteristic('Current', '0 … 16', 'A per phase'), characteristic('Frequency', '45 … 65', 'Hz'), characteristic('Isolation', 'galvanic, PE switchable', '')],
    notes: 'The neutral of the source is the neutral of the unit under test; the PE of the unit is bonded to the bench PE through the guard interlock.',
  });
  const hipot = with_(newResource(), {
    name: 'Dielectric strength tester', category: 'Safety', averageTime: '4',
    characteristics: [characteristic('Test voltage', '0 … 5', 'kV AC'), characteristic('Trip current', '0.1 … 20', 'mA'), characteristic('Ramp', '0.1 … 10', 's')],
    notes: 'Interlocked with the guard of the fixture: the output is enabled only with the guard closed.',
  });
  const rcmSet = with_(newResource(), {
    name: 'Residual current test set', category: 'Safety', averageTime: '2',
    characteristics: [characteristic('AC injection', '0 … 1000', 'mA'), characteristic('DC injection', '0 … 100', 'mA'), characteristic('Trip timer resolution', '1', 'ms')],
    notes: 'The injection loop is a single turn through the sensor toroid; the timer stops on the mirror contact of the contactor.',
  });
  const dmm = with_(newResource(), {
    name: '6½ digit multimeter', category: 'Electrical measurement', averageTime: '0.8',
    characteristics: [characteristic('DC voltage', '0 … 1000', 'V'), characteristic('AC voltage', '0 … 750', 'V'), characteristic('Resistance', '0 … 100', 'MΩ'), characteristic('Accuracy', '±0.02', '%')],
  });
  const scope = with_(newResource(), {
    name: 'Oscilloscope, 4 channels', category: 'Electrical measurement', averageTime: '1.2',
    characteristics: [characteristic('Bandwidth', '200', 'MHz'), characteristic('Sample rate', '2', 'GS/s'), characteristic('Probes', '10:1, 500 V', '')],
    notes: 'Frequency, duty cycle and levels are read from the built-in measurements, averaged over 16 cycles.',
  });
  const evSim = with_(newResource(), {
    name: 'EV simulator', category: 'Vehicle simulation', averageTime: '0.5',
    characteristics: [characteristic('Pilot states', 'A, B, C, D, E, F', ''), characteristic('PP resistors', '100 / 220 / 680 / 1500', 'Ω'), characteristic('CP load', '2.74 kΩ / 882 Ω with diode', ''), characteristic('Fault injection', 'CP short to PE, mirror contact override', '')],
    notes: 'Plugged into the Type 2 socket with the reference cable; the bench selects the state over USB.',
  });
  const analyser = with_(newResource(), {
    name: 'Reference power analyser', category: 'Electrical measurement', averageTime: '1.5',
    characteristics: [characteristic('Channels', '3 voltage + 3 current', ''), characteristic('Accuracy', 'class 0.1', ''), characteristic('Current range', '0 … 50', 'A')],
  });
  const acLoad = with_(newResource(), {
    name: 'Electronic AC load, three phase', category: 'Load', averageTime: '1',
    characteristics: [characteristic('Current', '0 … 16', 'A per phase'), characteristic('Mode', 'constant current, resistive', ''), characteristic('Power', '12', 'kW')],
    notes: 'Sits on the vehicle side of the simulator: what the contactor switches is what it draws.',
  });
  const colorimeter = with_(newResource(), {
    name: 'Colorimeter probe', category: 'Optical', averageTime: '1',
    characteristics: [characteristic('Readings', 'CIE x, y, luminance, hue', ''), characteristic('Distance', '50', 'mm'), characteristic('Aperture', '10', 'mm')],
    notes: 'On an articulated arm, pointed at the LED ring; the fixture has a black hood around the front panel.',
  });
  const microphone = with_(newResource(), {
    name: 'Measurement microphone with sound level meter', category: 'Acoustic', averageTime: '1',
    characteristics: [characteristic('Range', '30 … 130', 'dB(A)'), characteristic('Weighting', 'A, fast', ''), characteristic('Distance', '100', 'mm')],
  });
  const tagArm = with_(newResource(), {
    name: 'RFID tag actuator', category: 'Mechanical actuation', averageTime: '1.5',
    characteristics: [characteristic('Tag', 'ISO 14443A, 4-byte UID', ''), characteristic('Travel', '0 … 60', 'mm'), characteristic('Positioning', '±1', 'mm')],
    notes: 'Presents the test tag in front of the reader at a programmed distance and withdraws it.',
  });
  const press = with_(newResource(), {
    name: 'Bed of nails fixture', category: 'Fixturing', averageTime: '3',
    characteristics: [characteristic('Probes', '24 spring probes, Ø 1.3 mm', ''), characteristic('Actuation', 'pneumatic, 5 bar', ''), characteristic('Guard', 'interlocked, monitored', '')],
  });
  const decade = with_(newResource(), {
    name: 'Resistance decade box', category: 'Sensor simulation', averageTime: '0.5',
    characteristics: [characteristic('Range', '10 Ω … 1 MΩ', ''), characteristic('Accuracy', '±0.1', '%')],
    notes: 'Stands in for the NTC at X6: 10 kΩ is 25 °C, 3.6 kΩ is 50 °C, 1.25 kΩ is 80 °C (B = 3950 K).',
  });
  const benchComm = with_(newResource(), {
    name: 'Bench communication controller', category: 'Communication', averageTime: '0.3',
    characteristics: [characteristic('Ports', 'UART, RS-485, Ethernet', ''), characteristic('Wi-Fi', 'access point, 2.4 GHz', ''), characteristic('Services', 'OCPP central system simulator, Modbus master', '')],
  });
  const relayMatrix = with_(newResource(), {
    name: 'Fault injection relay matrix', category: 'Fixturing', averageTime: '0.4',
    characteristics: [characteristic('Channels', '8', ''), characteristic('Function', 'opens or shorts a selected input of the unit', '')],
  });
  doc.resources = [acSource, hipot, rcmSet, dmm, scope, evSim, analyser, acLoad, colorimeter, microphone, tagArm, press, decade, benchComm, relayMatrix];

  // ---- protocols
  const prtConsole = with_(newProtocol(), {
    name: 'Service console', family: 'Application specific, text lines',
    description: 'A line-oriented command set on the service UART, available only in test mode. Every command is a line; every answer is a line that starts with OK or ERR. The bench compares the whole answer line, so the format of each answer is part of the specification.',
    requestFormat: '<command> [arguments]\\r\\n\nArguments are separated by single spaces; numbers are decimal unless prefixed by 0x.',
    responseFormat: 'OK [value]\\r\\n on success, the value formatted as the command states\nERR <code> <message>\\r\\n on refusal',
    rules: [characteristic('Answer within', '200', 'ms'), characteristic('Line ending', 'CR LF', ''), characteristic('Case', 'commands lower case, answers as documented', '')],
    notes: 'ERR 10 unknown command · ERR 11 bad argument · ERR 12 out of range · ERR 20 not in test mode · ERR 21 wrong pilot state · ERR 40 already written.',
  });
  const prtModbus = with_(newProtocol(), {
    name: 'Modbus RTU', family: 'Modbus over serial line',
    description: 'The energy meter answers as slave 1 on the RS-485 bus. The bench reads it directly with function 03 (read holding registers); the controller reads the same registers during normal operation.',
    requestFormat: '<slave> 03 <register hi> <register lo> <count hi> <count lo> <CRC16 lo> <CRC16 hi>',
    responseFormat: '<slave> 03 <byte count> <data…> <CRC16 lo> <CRC16 hi>\nException: <slave> 83 <exception code> <CRC16>',
    rules: [characteristic('Baud rate', '9600', 'bit/s'), characteristic('Frame', '8N1', ''), characteristic('Silent interval', '≥ 3.5 characters', ''), characteristic('Byte order', 'big endian, float32 as two registers', '')],
  });
  const prtOcpp = with_(newProtocol(), {
    name: 'OCPP 1.6J', family: 'OCPP JSON over WebSocket',
    referenceId: refByCode('ICD-OCPP-VOL').id,
    description: 'The messages the controller exchanges with the charging backend. On the bench the backend is a simulator that accepts every unit and answers within one second.',
    requestFormat: 'CALL: [2, "<unique id>", "<Action>", {payload}]',
    responseFormat: 'CALLRESULT: [3, "<unique id>", {payload}]\nCALLERROR: [4, "<unique id>", "<error code>", "<description>", {}]',
    rules: [characteristic('Transport', 'ws://, sub-protocol ocpp1.6', ''), characteristic('Charge point id', 'serial number of the unit', ''), characteristic('Answer within', '5', 's')],
    notes: 'The bench matches on fragments of the JSON payload, so the order of the fields does not matter but their spelling does.',
  });
  doc.protocols = [prtConsole, prtModbus, prtOcpp];

  // ---- images
  const imgTop = with_(newImage('showcasepcbtop01', 'Controller board — component side'), {
    caption: 'Reference designators as silk-screened. The board is reached from this side through the terminal block X1, the connectors X2 to X6 and the service header J1.',
  });
  const imgBottom = with_(newImage('showcasepcbbot01', 'Controller board — solder side'), {
    caption: 'The pads the bed of nails lands on. Each pad carries its name in the silk screen; the four pads TP1 to TP4 are also brought out on the component side.',
  });
  const imgFront = with_(newImage('showcasefront001', 'Front panel'), {
    caption: 'The front panel as fitted for the test: LED ring, RFID reader, display, buzzer and the Type 2 socket with its cover open.',
  });
  const imgTerms = with_(newImage('showcaseterms001', 'Wiring compartment'), {
    caption: 'Mains terminals, residual current sensor and energy meter, as reached by the bench harness with the cover removed.',
  });
  doc.images = [imgTop, imgBottom, imgFront, imgTerms];

  // ---- points
  const mk = (image, x, y, area) => ({ ...newMarker(image.id, x, y), area });
  const point = (fields, markers) => with_(newPoint(), { ...fields, markers });
  const probe = 'Ø 1.3 mm spring probe';
  const clip = 'Insulated 4 mm clip';

  // Mains, at the terminal block on the board and at the terminals in the compartment
  const ptL1 = point({ name: 'Mains L1', connector: 'X1', pin: 'L1', signal: 'L1', contactType: clip, characteristics: [characteristic('Max voltage', '300', 'V AC'), characteristic('Max current', '16', 'A')] },
    [mk(imgTop, 0.075, 0.135, 0.15), mk(imgTerms, 0.41, 0.6, 0.25)]);
  const ptL2 = point({ name: 'Mains L2', connector: 'X1', pin: 'L2', signal: 'L2', contactType: clip, characteristics: [characteristic('Max voltage', '300', 'V AC'), characteristic('Max current', '16', 'A')] },
    [mk(imgTop, 0.075, 0.19, 0.15), mk(imgTerms, 0.457, 0.6, 0.25)]);
  const ptL3 = point({ name: 'Mains L3', connector: 'X1', pin: 'L3', signal: 'L3', contactType: clip, characteristics: [characteristic('Max voltage', '300', 'V AC'), characteristic('Max current', '16', 'A')] },
    [mk(imgTop, 0.075, 0.245, 0.15), mk(imgTerms, 0.503, 0.6, 0.25)]);
  const ptN = point({ name: 'Mains neutral', connector: 'X1', pin: 'N', signal: 'N', contactType: clip, characteristics: [characteristic('Max current', '16', 'A')] },
    [mk(imgTop, 0.075, 0.30, 0.15), mk(imgTerms, 0.548, 0.6, 0.25)]);
  const ptPE = point({ name: 'Protective earth', connector: 'Terminal', pin: 'PE', signal: 'PE', contactType: 'Kelvin clip', characteristics: [characteristic('Max current', '25', 'A'), characteristic('Contact resistance', '< 10', 'mΩ')] },
    [mk(imgTerms, 0.593, 0.6, 0.25)]);

  // Inputs and outputs of the terminal block
  const ptCpIn = point({ name: 'Control Pilot input', connector: 'X1', pin: 'IN1', signal: 'CP', contactType: clip, characteristics: [characteristic('Levels', '±12', 'V'), characteristic('Source impedance', '1', 'kΩ')] },
    [mk(imgTop, 0.075, 0.375, 0.15)]);
  const ptPpIn = point({ name: 'Proximity Pilot input', connector: 'X1', pin: 'IN2', signal: 'PP', contactType: clip, characteristics: [characteristic('Pull-up', '330 Ω to 5 V', '')] },
    [mk(imgTop, 0.075, 0.43, 0.15)]);
  const ptMirror = point({ name: 'Contactor mirror contact', connector: 'X1', pin: 'IN3', signal: 'K_MIRROR', contactType: clip, characteristics: [characteristic('Wetting', '12 V, 5 mA', '')], notes: 'Normally closed contact of the charging contactor: closed means the contactor is open.' },
    [mk(imgTop, 0.075, 0.48, 0.15)]);
  const ptTamper = point({ name: 'Tamper switch', connector: 'X1', pin: 'IN4', signal: 'TAMPER', contactType: clip, characteristics: [characteristic('Wetting', '12 V, 5 mA', '')], notes: 'Closed with the cover fitted. The relay matrix opens it on the bench.' },
    [mk(imgTop, 0.075, 0.535, 0.15)]);
  const ptCoil = point({ name: 'Contactor coil output', connector: 'X1', pin: 'OUT1', signal: 'K_COIL', contactType: clip, characteristics: [characteristic('Switched by', 'K1', ''), characteristic('Max current', '2', 'A')] },
    [mk(imgTop, 0.075, 0.605, 0.15)]);
  const ptLock = point({ name: 'Socket lock output', connector: 'X1', pin: 'OUT2', signal: 'LOCK', contactType: clip, characteristics: [characteristic('Switched by', 'K2', ''), characteristic('Voltage', '12', 'V'), characteristic('Max current', '1.5', 'A')] },
    [mk(imgTop, 0.075, 0.66, 0.15)]);

  // Connectors
  const ptRcmSensor = point({ name: 'Residual current sensor', connector: 'X2', pin: '1-4', signal: 'RCM', contactType: 'Sensor as fitted', characteristics: [characteristic('Sensitivity', '6 mA DC / 30 mA AC', '')], notes: 'The injection wire of the test set passes once through the toroid, in the wiring compartment.' },
    [mk(imgTop, 0.65, 0.19, 0.2), mk(imgTerms, 0.5, 0.29, 0.25)]);
  const ptEth = point({ name: 'Ethernet', connector: 'X3', pin: 'RJ45', signal: 'ETH', contactType: 'Bench patch cable', characteristics: [characteristic('Link', '100BASE-TX', '')] },
    [mk(imgTop, 0.885, 0.2, 0.2)]);
  const ptRs485 = point({ name: 'RS-485 meter bus', connector: 'X4', pin: 'A, B, GND', signal: 'RS485', contactType: 'Pluggable terminal', characteristics: [characteristic('Termination', '120', 'Ω'), characteristic('Isolation', '1.5', 'kV')] },
    [mk(imgTop, 0.865, 0.44, 0.15)]);
  const ptPanel = point({ name: 'Front panel connector', connector: 'X5', pin: '1-4', signal: 'PWR, STAT, COM, I/O', contactType: 'Harness as fitted', characteristics: [characteristic('Supply to the panel', '12', 'V'), characteristic('Max current', '0.8', 'A')] },
    [mk(imgTop, 0.855, 0.645, 0.15), mk(imgTerms, 0.375, 0.03, 0.2)]);
  const ptNtc = point({ name: 'Temperature sensor', connector: 'X6', pin: '1-2', signal: 'NTC', contactType: 'Decade box leads', characteristics: [characteristic('Sensor', 'NTC 10 kΩ, B 3950', ''), characteristic('Bias', '3.3 V through 10 kΩ', '')] },
    [mk(imgTop, 0.815, 0.82, 0.15)]);
  const ptJ1 = point({ name: 'Service header', connector: 'J1', pin: '1-6', signal: 'UART, SWD', contactType: 'Pogo pin block', characteristics: [characteristic('Levels', '3.3', 'V'), characteristic('Pinout', '1 GND · 2 3V3 · 3 TX · 4 RX · 5 SWDIO · 6 SWCLK', '')] },
    [mk(imgTop, 0.665, 0.815, 0.15)]);

  // Test pads: the four brought out on both sides carry two markers each
  const pad = (name, tp, signal, extra, markers) => point({ name, connector: tp, pin: '—', signal, contactType: probe, characteristics: extra }, markers);
  const ptTp3v3 = pad('3.3 V rail', 'TP1', '3V3', [characteristic('Max current', '0.1', 'A')], [mk(imgTop, 0.213, 0.855, 0.12), mk(imgBottom, 0.213, 0.64, 0.15)]);
  const ptTp12 = pad('12 V rail', 'TP2', '12V', [characteristic('Max current', '0.1', 'A')], [mk(imgTop, 0.26, 0.855, 0.12), mk(imgBottom, 0.26, 0.64, 0.15)]);
  const ptTpGnd = pad('Logic ground', 'TP3', 'GND', [characteristic('Max current', '1', 'A')], [mk(imgTop, 0.305, 0.855, 0.12), mk(imgBottom, 0.307, 0.64, 0.15)]);
  const ptTpCpAdc = pad('Control Pilot, after the divider', 'TP4', 'CP_ADC', [characteristic('Scale', '0.1 V per V of CP, offset 1.65 V', '')], [mk(imgTop, 0.35, 0.855, 0.12), mk(imgBottom, 0.353, 0.64, 0.15)]);
  const ptTpCoilDrive = pad('K1 coil drive', 'TP10', 'K1_DRV', [characteristic('Levels', '0 / 12', 'V')], [mk(imgBottom, 0.487, 0.60, 0.15)]);
  const ptTpPpAdc = pad('Proximity Pilot, after the divider', 'TP13', 'PP_ADC', [characteristic('Scale', '1:1', '')], [mk(imgBottom, 0.213, 0.73, 0.15)]);
  const ptTpRcm = pad('Residual current sensor output', 'TP14', 'RCM_OUT', [characteristic('Idle level', '2.5', 'V')], [mk(imgBottom, 0.26, 0.73, 0.15)]);
  const ptTpNtc = pad('Temperature sensor, after the divider', 'TP15', 'NTC_ADC', [], [mk(imgBottom, 0.307, 0.73, 0.15)]);
  const ptTpMirror = pad('Mirror contact, debounced', 'TP16', 'K_MIRROR_D', [characteristic('Levels', '0 / 3.3', 'V')], [mk(imgBottom, 0.353, 0.73, 0.15)]);
  const ptTpCpPwm = pad('Control Pilot PWM, before the driver', 'TP18', 'CP_PWM', [characteristic('Levels', '0 / 3.3', 'V')], [mk(imgBottom, 0.397, 0.73, 0.15)]);
  const ptTpZc = pad('Mains zero crossing', 'TP20', 'MAINS_ZC', [characteristic('Levels', '0 / 3.3', 'V'), characteristic('Pulse per', 'half cycle', '')], [mk(imgBottom, 0.877, 0.65, 0.15)]);

  // Front panel
  const ptLedRing = point({ name: 'LED ring', connector: 'Front panel', pin: '—', signal: 'LED', contactType: 'Colorimeter, 50 mm', characteristics: [characteristic('LEDs', '24 × RGB', ''), characteristic('Diameter', '60', 'mm')] },
    [mk(imgFront, 0.5, 0.19, 0.3)]);
  const ptRfid = point({ name: 'RFID reader', connector: 'Front panel', pin: '—', signal: 'RFID', contactType: 'Test tag on the actuator', characteristics: [characteristic('Standard', 'ISO 14443A, 13.56 MHz', ''), characteristic('Read range', '≥ 30', 'mm')] },
    [mk(imgFront, 0.5, 0.34, 0.25)]);
  const ptDisplay = point({ name: 'Display', connector: 'Front panel', pin: '—', signal: 'DISP', contactType: 'Visual, operator', characteristics: [characteristic('Type', 'OLED 128 × 32, monochrome', '')] },
    [mk(imgFront, 0.5, 0.445, 0.25)]);
  const ptBuzzer = point({ name: 'Buzzer', connector: 'Front panel', pin: '—', signal: 'BUZ', contactType: 'Microphone, 100 mm', characteristics: [characteristic('Frequency', '2.7', 'kHz')] },
    [mk(imgFront, 0.5, 0.52, 0.2)]);
  const ptSocketCp = point({ name: 'Socket CP contact', connector: 'Type 2 socket', pin: 'CP', signal: 'CP', contactType: 'Simulator cable', characteristics: [characteristic('Levels', '±12', 'V')] },
    [mk(imgFront, 0.455, 0.652, 0.15)]);
  const ptSocketPp = point({ name: 'Socket PP contact', connector: 'Type 2 socket', pin: 'PP', signal: 'PP', contactType: 'Simulator cable', characteristics: [] },
    [mk(imgFront, 0.525, 0.652, 0.15)]);
  const ptSocketPE = point({ name: 'Socket PE contact', connector: 'Type 2 socket', pin: 'PE', signal: 'PE', contactType: 'Kelvin probe', characteristics: [characteristic('Max current', '25', 'A')] },
    [mk(imgFront, 0.49, 0.68, 0.15)]);
  const ptSocketL1 = point({ name: 'Socket L1 contact', connector: 'Type 2 socket', pin: 'L1', signal: 'L1_OUT', contactType: 'Simulator cable', characteristics: [characteristic('Max current', '32', 'A')] },
    [mk(imgFront, 0.435, 0.683, 0.15)]);
  const ptSocketN = point({ name: 'Socket N contact', connector: 'Type 2 socket', pin: 'N', signal: 'N_OUT', contactType: 'Simulator cable', characteristics: [characteristic('Max current', '32', 'A')] },
    [mk(imgFront, 0.55, 0.683, 0.15)]);
  const ptSocketL2 = point({ name: 'Socket L2 contact', connector: 'Type 2 socket', pin: 'L2', signal: 'L2_OUT', contactType: 'Simulator cable', characteristics: [characteristic('Max current', '32', 'A')] },
    [mk(imgFront, 0.455, 0.71, 0.15)]);
  const ptSocketL3 = point({ name: 'Socket L3 contact', connector: 'Type 2 socket', pin: 'L3', signal: 'L3_OUT', contactType: 'Simulator cable', characteristics: [characteristic('Max current', '32', 'A')] },
    [mk(imgFront, 0.525, 0.71, 0.15)]);
  const ptSocketLock = point({ name: 'Socket lock', connector: 'Type 2 socket', pin: '—', signal: 'LOCK', contactType: 'Visual, simulator cable', characteristics: [characteristic('Actuator', 'motor driven pin', '')], notes: 'The simulator cable reports whether the pin holds it.' },
    [mk(imgFront, 0.5, 0.595, 0.2)]);

  // Wiring compartment
  const ptMeter = point({ name: 'Energy meter, RS-485 terminals', connector: 'DIN rail', pin: 'A, B', signal: 'EM3', contactType: 'Bench harness clips', characteristics: [characteristic('Type', 'EM3-DIN, three phase, class B', ''), characteristic('Modbus address', '1', '')] },
    [mk(imgTerms, 0.615, 0.24, 0.3)]);

  doc.points = [
    ptL1, ptL2, ptL3, ptN, ptPE,
    ptCpIn, ptPpIn, ptMirror, ptTamper, ptCoil, ptLock,
    ptRcmSensor, ptEth, ptRs485, ptPanel, ptNtc, ptJ1,
    ptTp3v3, ptTp12, ptTpGnd, ptTpCpAdc, ptTpCoilDrive, ptTpPpAdc, ptTpRcm, ptTpNtc, ptTpMirror, ptTpCpPwm, ptTpZc,
    ptLedRing, ptRfid, ptDisplay, ptBuzzer,
    ptSocketCp, ptSocketPp, ptSocketPE, ptSocketL1, ptSocketN, ptSocketL2, ptSocketL3, ptSocketLock,
    ptMeter,
  ];

  // ---- interfaces
  const uartItf = with_(newInterface(), {
    name: 'Service console', type: 'UART, 3.3 V',
    parameters: [characteristic('Baud rate', '115200', 'bit/s'), characteristic('Frame', '8N1', ''), characteristic('Flow control', 'none', '')],
    pointIds: [ptJ1.id], resourceId: benchComm.id,
    notes: 'Reached through the pogo pin block on J1. Enabled only in test mode.',
  });
  const ethItf = with_(newInterface(), {
    name: 'Ethernet', type: '100BASE-TX',
    parameters: [characteristic('Addressing', 'DHCP from the bench', ''), characteristic('Backend', 'OCPP simulator on the bench controller', '')],
    pointIds: [ptEth.id], resourceId: benchComm.id,
  });
  const wifiItf = with_(newInterface(), {
    name: 'Wi-Fi', type: 'IEEE 802.11 b/g/n, 2.4 GHz',
    parameters: [characteristic('Security', 'WPA2-PSK', ''), characteristic('Access point', 'bench controller, channel 6', '')],
    pointIds: [], resourceId: benchComm.id,
    notes: 'Over the air: the fixture is not shielded, so the bench access point is the strongest network in the area by design.',
  });
  const rs485Itf = with_(newInterface(), {
    name: 'RS-485 meter bus', type: 'RS-485, half duplex',
    parameters: [characteristic('Baud rate', '9600', 'bit/s'), characteristic('Frame', '8N1', ''), characteristic('Termination', '120 Ω at both ends', '')],
    pointIds: [ptRs485.id, ptMeter.id], resourceId: benchComm.id,
    notes: 'The bench listens on the same pair the controller uses, clipped onto the meter terminals: it can read the meter itself and watch the controller read it.',
  });
  doc.interfaces = [uartItf, ethItf, wifiItf, rs485Itf];

  // ---- commands
  const console_ = (name, address, fields) => with_(newCommand(), { name, interfaceId: uartItf.id, protocolId: prtConsole.id, address, nominalTime: '0.2', ...fields });

  const cmdVersion = console_('Read firmware version', 'ver', {
    requestFormat: 'ver', responseFormat: 'EVC22 vX.Y.Z', encoding: 'ASCII, no OK prefix: the version line is the answer', example: 'EVC22 v2.3.1', nominalTime: '0.3',
  });
  const cmdTestMode = console_('Enter or leave test mode', 'testmode', {
    requestFormat: 'testmode <on|off>', responseFormat: 'OK', negativeResponse: 'ERR 11 bad argument', encoding: 'ASCII',
    example: 'testmode on → OK', notes: 'Outside test mode every other command answers ERR 20.',
  });
  const cmdCpState = console_('Read pilot state', 'cp state', {
    requestFormat: 'cp state', responseFormat: 'OK <state>', encoding: 'state: one letter, A to F', example: 'OK B',
  });
  const cmdCpDuty = console_('Set pilot duty cycle', 'cp duty', {
    requestFormat: 'cp duty <percent|auto>', responseFormat: 'OK', negativeResponse: 'ERR 12 out of range (below 8 % or above 97 %)',
    encoding: 'percent: decimal with one digit, auto restores the value computed from the current limit', example: 'cp duty 16.7 → OK',
  });
  const cmdPp = console_('Read cable current capability', 'pp', {
    requestFormat: 'pp', responseFormat: 'OK <amperes>', encoding: 'integer amperes decoded from the PP resistor; 0 when no cable is detected', example: 'OK 32',
  });
  const cmdIlimit = console_('Read effective current limit', 'ilimit', {
    requestFormat: 'ilimit', responseFormat: 'OK <amperes>', encoding: 'integer amperes: the lower of the cable capability and the rated current of the unit', example: 'OK 32',
  });
  const cmdRelay = console_('Force the contactor', 'relay', {
    requestFormat: 'relay <on|off|auto>', responseFormat: 'OK', negativeResponse: 'ERR 21 wrong pilot state (on requires state C)',
    encoding: 'auto returns the contactor to the charging state machine', example: 'relay auto → OK', nominalTime: '0.3',
  });
  const cmdMirror = console_('Read contactor mirror contact', 'relay mirror', {
    requestFormat: 'relay mirror', responseFormat: 'OK <open|closed>', encoding: 'the state of the contactor as its mirror contact reports it', example: 'OK closed',
  });
  const cmdLock = console_('Drive the socket lock', 'lock', {
    requestFormat: 'lock <on|off>', responseFormat: 'OK', negativeResponse: 'ERR 21 wrong pilot state (on requires a cable, state B or later)', encoding: 'ASCII', example: 'lock on → OK', nominalTime: '0.3',
  });
  const cmdLockState = console_('Read socket lock state', 'lock', {
    requestFormat: 'lock', responseFormat: 'OK <locked|unlocked|jammed>', encoding: 'from the position switch of the lock actuator', example: 'OK locked',
  });
  const cmdFault = console_('Read fault register', 'fault', {
    requestFormat: 'fault', responseFormat: 'OK 0x<hhhh>', encoding: 'bit 0 residual current trip · bit 1 contactor welded · bit 2 over-temperature · bit 3 pilot fault · bit 4 tamper · bit 5 meter lost',
    example: 'OK 0x0000', notes: 'The register is latched: a fault stays until cleared.',
  });
  const cmdFaultClear = console_('Clear fault register', 'fault clear', {
    requestFormat: 'fault clear', responseFormat: 'OK', negativeResponse: 'ERR 22 fault still present', encoding: 'ASCII', example: 'fault clear → OK',
  });
  const cmdLed = console_('Set LED ring colour', 'led', {
    requestFormat: 'led <r> <g> <b>', responseFormat: 'OK', negativeResponse: 'ERR 12 out of range', encoding: 'three integers 0 … 255; the ring shows the colour steadily until the next command', example: 'led 0 0 255 → OK',
  });
  const cmdBuzzer = console_('Sound the buzzer', 'buzzer', {
    requestFormat: 'buzzer <ms>', responseFormat: 'OK', encoding: 'duration in milliseconds, 10 … 5000', example: 'buzzer 500 → OK',
  });
  const cmdDisplayTest = console_('Show the display test pattern', 'display test', {
    requestFormat: 'display test', responseFormat: 'OK', encoding: 'a checkerboard, then the string TEST 1234 in both lines', example: 'display test → OK',
  });
  const cmdRfidLast = console_('Read last RFID tag', 'rfid last', {
    requestFormat: 'rfid last', responseFormat: 'OK <uid|none>', encoding: 'UID as colon separated hexadecimal bytes; none when no tag has been read since the last clear', example: 'OK 04:A3:2F:1C:6E:80:01',
  });
  const cmdRfidClear = console_('Clear last RFID tag', 'rfid clear', {
    requestFormat: 'rfid clear', responseFormat: 'OK', encoding: 'ASCII', example: 'rfid clear → OK',
  });
  const cmdTemp = console_('Read board temperature', 'temp', {
    requestFormat: 'temp', responseFormat: 'OK <celsius>', encoding: 'decimal with one digit, from the NTC at X6', example: 'OK 25.4',
  });
  const cmdTamper = console_('Read tamper switch', 'tamper', {
    requestFormat: 'tamper', responseFormat: 'OK <closed|open>', encoding: 'closed means the cover is fitted', example: 'OK closed',
  });
  const cmdMeterPower = console_('Read active power from the meter', 'meter power', {
    requestFormat: 'meter power', responseFormat: 'OK <watts>', negativeResponse: 'ERR 50 meter not answering', encoding: 'integer watts, total of the three phases, as the controller last read it over RS-485', example: 'OK 6900', nominalTime: '0.5',
  });
  const cmdSnWrite = console_('Write serial number', 'sn write', {
    requestFormat: 'sn write <serial>', responseFormat: 'OK', negativeResponse: 'ERR 40 already written', encoding: 'VE22-YYYY-NNNNNN, written once to the one-time programmable area', example: 'sn write VE22-2026-000123 → OK', nominalTime: '0.4',
  });
  const cmdSnRead = console_('Read serial number', 'sn', {
    requestFormat: 'sn', responseFormat: 'OK <serial>', encoding: 'ASCII', example: 'OK VE22-2026-000123',
  });
  const cmdEthStatus = console_('Read Ethernet status', 'eth status', {
    requestFormat: 'eth status', responseFormat: 'OK <up|down> [address]', encoding: 'link state, then the address obtained by DHCP', example: 'OK up 10.20.0.117',
  });
  const cmdWifiJoin = console_('Join a Wi-Fi network', 'wifi join', {
    requestFormat: 'wifi join <ssid> <passphrase>', responseFormat: 'OK', negativeResponse: 'ERR 30 association failed', encoding: 'ASCII; the command returns once an address has been obtained', example: 'wifi join VOLTARIA-EOL ******** → OK', nominalTime: '4',
  });
  const cmdWifiStatus = console_('Read Wi-Fi status', 'wifi status', {
    requestFormat: 'wifi status', responseFormat: 'OK <connected|idle> [address]', encoding: 'ASCII', example: 'OK connected 10.20.1.44',
  });
  const cmdWifiRssi = console_('Read Wi-Fi signal strength', 'wifi rssi', {
    requestFormat: 'wifi rssi', responseFormat: 'OK <dBm>', encoding: 'signed integer dBm', example: 'OK -52',
  });

  const cmdMeterSerial = with_(newCommand(), {
    name: 'Read meter serial number', interfaceId: rs485Itf.id, protocolId: prtModbus.id, address: 'slave 1, registers 0x0100 … 0x0107',
    requestFormat: '01 03 01 00 00 08 <CRC>', responseFormat: '01 03 10 <16 ASCII bytes> <CRC>', negativeResponse: '01 83 02 — illegal data address',
    encoding: 'ASCII, space padded', example: 'EM3-2026-04471', nominalTime: '0.1',
  });
  const cmdMeterPowerDirect = with_(newCommand(), {
    name: 'Read active power directly from the meter', interfaceId: rs485Itf.id, protocolId: prtModbus.id, address: 'slave 1, registers 0x0034 … 0x0035',
    requestFormat: '01 03 00 34 00 02 <CRC>', responseFormat: '01 03 04 <float32> <CRC>', encoding: 'IEEE 754 float32, watts, big endian', example: '01 03 04 45 D7 A0 00 → 6900.0 W', nominalTime: '0.1',
    notes: 'What the bench reads on its own, to tell a meter fault from a controller fault.',
    // The register map is the meter maker's; how its bytes become watts is said once here.
    referenceId: refByCode('ICD-MB-EM3').id,
    decoding: { formula: 'bytes 3–6 as float32, big endian', unit: 'W' },
  });
  const cmdBoot = with_(newCommand(), {
    name: 'BootNotification', interfaceId: ethItf.id, protocolId: prtOcpp.id, address: 'Action BootNotification',
    requestFormat: '[2, "<id>", "BootNotification", {"chargePointVendor": "Voltaria", "chargePointModel": "EVC-22", "chargePointSerialNumber": "<serial>", "firmwareVersion": "<version>"}]',
    responseFormat: '[3, "<id>", {"status": "Accepted", "currentTime": "<ISO 8601>", "interval": 300}]',
    negativeResponse: '{"status": "Rejected"} — the simulator rejects a unit whose serial number is blank',
    encoding: 'JSON, UTF-8', example: '{"status":"Accepted","currentTime":"2026-09-10T08:14:02Z","interval":300}', nominalTime: '1.5',
    notes: 'Sent by the unit on its own once the link is up: the bench waits for it rather than sending anything.',
  });
  const cmdStatusNotif = with_(newCommand(), {
    name: 'StatusNotification', interfaceId: ethItf.id, protocolId: prtOcpp.id, address: 'Action StatusNotification',
    requestFormat: '[2, "<id>", "StatusNotification", {"connectorId": 1, "errorCode": "NoError", "status": "<status>"}]',
    responseFormat: '[3, "<id>", {}]', encoding: 'JSON, UTF-8', example: '{"connectorId":1,"errorCode":"NoError","status":"Available"}', nominalTime: '1',
    notes: 'Follows the BootNotification within five seconds; the bench matches on the status it carries.',
  });
  const cmdHeartbeat = with_(newCommand(), {
    name: 'Heartbeat over Wi-Fi', interfaceId: wifiItf.id, protocolId: prtOcpp.id, address: 'Action Heartbeat',
    requestFormat: '[2, "<id>", "Heartbeat", {}]', responseFormat: '[3, "<id>", {"currentTime": "<ISO 8601>"}]',
    encoding: 'JSON, UTF-8', example: '{"currentTime":"2026-09-10T08:14:32Z"}', nominalTime: '1',
    notes: 'Triggered by the bench through the simulator (TriggerMessage) once the unit has moved its connection to Wi-Fi.',
  });

  doc.commands = [
    cmdVersion, cmdTestMode, cmdCpState, cmdCpDuty, cmdPp, cmdIlimit, cmdRelay, cmdMirror, cmdLock, cmdLockState,
    cmdFault, cmdFaultClear, cmdLed, cmdBuzzer, cmdDisplayTest, cmdRfidLast, cmdRfidClear, cmdTemp, cmdTamper,
    cmdMeterPower, cmdSnWrite, cmdSnRead, cmdEthStatus, cmdWifiJoin, cmdWifiStatus, cmdWifiRssi,
    cmdMeterSerial, cmdMeterPowerDirect, cmdBoot, cmdStatusNotif, cmdHeartbeat,
  ];

  // ---- setup stages: the routines the sequence calls ----------------------------------------

  const setEngage = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Engage fixture',
    description: 'Lower the bed of nails onto the board and check that the probes have landed.',
  });
  const stpEngage = stimulus('Close the guard and lower the press onto the board.',
    { description: 'Actuate the press', resource: press, parameters: [parameter('Pressure', '5', 'bar'), parameter('Ambient temperature', vAmbient, '°C')] },
    { wait: '1 s', note: 'The bench reads its own thermometer and refuses to engage outside the ambient range.' });
  const stpContact = measurement('Check that the probes have landed: resistance between the logic ground pad and the PE terminal.',
    { description: 'Ground continuity through the probes', points: [ptTpGnd, ptPE], resource: dmm, expected: lessThan('0.5', 'Ω') },
    { note: 'The logic ground is bonded to PE on the board: an open circuit here is a probe that did not land, not a board fault.' });
  setEngage.tests = [test('Contact', 'Bring the probes onto the pads and prove they touch.', [stpEngage, stpContact])];
  setEngage.heldStimuli = [with_(newHeldStimulus(), { stepId: stpEngage.id, note: 'the press stays down until Release fixture is called' })];

  const setRelease = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Release fixture',
    description: 'Raise the press and free the unit.',
  });
  const stpRelease = stimulus('Raise the press and open the guard.',
    { description: 'Release the press', resource: press, parameters: [parameter('Pressure', '0', 'bar')] }, { wait: '1 s' });
  setRelease.tests = [test('Release', 'Free the unit for the operator.', [stpRelease])];

  const setPowerUp = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Power up',
    description: 'Apply the mains at the nominal test voltage, let the unit boot and open the service console.',
  });
  const stpMainsOn = stimulus('Apply the mains on all phases at the nominal test voltage.',
    { description: 'Set the AC source', points: [ptL1, ptL2, ptL3, ptN, ptPE], resource: acSource,
      parameters: [parameter('Voltage', vMains, 'V'), parameter('Frequency', vFreq, 'Hz'), parameter('Phases', vPhases), parameter('Current limit', '16', 'A')] },
    { wait: '3 s', note: 'Three seconds is the boot time with the display splash; the console answers only after it.' });
  const stpTestModeOn = both('Open the service console in test mode.',
    { description: 'Enter test mode', command: cmdTestMode, parameters: [parameter('Mode', 'on')] },
    { description: 'Console answer', command: cmdTestMode, expected: text('OK') });
  setPowerUp.tests = [test('Mains and console', 'Power the unit and make the console available to every later step.', [stpMainsOn, stpTestModeOn])];
  setPowerUp.heldStimuli = [with_(newHeldStimulus(), { stepId: stpMainsOn.id, note: 'the mains stays on for whoever called this stage' })];

  const setPowerDown = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Power down and discharge',
    description: 'Remove the mains and wait for the internal supplies to fall before anyone touches the unit.',
  });
  const stpMainsOff = stimulus('Set the AC source to zero on every phase.',
    { description: 'Set the AC source', points: [ptL1, ptL2, ptL3, ptN], resource: acSource, parameters: [parameter('Voltage', '0', 'V')] }, { wait: '5 s' });
  const stpDischarged = measurement('Check that the bus has discharged.',
    { description: 'Residual voltage L1 to N', points: [ptL1, ptN], resource: dmm, expected: lessThan('30', 'V') });
  setPowerDown.tests = [test('Discharge', 'Make the unit safe to handle.', [stpMainsOff, stpDischarged])];

  const setStateB = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Vehicle connected, state B',
    description: 'Have the simulator present a vehicle that is connected but not yet ready to charge, with a 32 A cable.',
  });
  const stpStateB = both('Set the simulator to state B with the 32 A cable resistor and check that the unit sees it.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPp, ptSocketPE], resource: evSim,
      parameters: [parameter('CP load', '2.74 kΩ + diode'), parameter('PP resistor', '220', 'Ω')] },
    { description: 'Pilot state read on the console', command: cmdCpState, expected: text('OK B') },
    // The settling time is a variable: every state change waits the same, and one place says how long.
    { wait: vSettle });
  setStateB.tests = [test('State B', 'Connect the simulated vehicle.', [stpStateB])];
  setStateB.heldStimuli = [with_(newHeldStimulus(), { stepId: stpStateB.id, note: 'the simulator stays in state B; the caller moves it on' })];

  // ---- test stages: the sequence ------------------------------------------------------------

  // 1. Safety, alone
  const stgSafety = with_(newStage(), {
    name: 'Fixture and dielectric strength',
    description: 'Engage the fixture and apply the dielectric strength test before anything else is connected. Runs alone: the hazardous voltage rules out every other stage.',
    exclusions: { mode: EXCLUSION_MODE.ALL, stageIds: [] },
  });
  const stpCallEngage = call('Engage the fixture.', setEngage);
  const stpHipotPe = both('Apply the test voltage between the joined mains terminals and PE, and read the leakage current.',
    { description: 'Hipot mains to PE', points: [ptL1, ptL2, ptL3, ptN, ptPE], resource: hipot,
      parameters: [parameter('Voltage', '2500', 'V AC'), parameter('Ramp', '2', 's'), parameter('Dwell', '1', 's'), parameter('Trip current', '5', 'mA')] },
    { description: 'Leakage current at the end of the dwell', points: [ptPE], resource: hipot, expected: lessThan('5', 'mA') },
    { note: 'WI-HV-002 applies. The tester ramps down on its own; the next step waits for it.' });
  const stpHipotSelv = both('Apply the test voltage between the joined mains terminals and the logic ground, and read the leakage current.',
    { description: 'Hipot mains to SELV', points: [ptL1, ptL2, ptL3, ptN, ptTpGnd], resource: hipot,
      parameters: [parameter('Voltage', '3000', 'V AC'), parameter('Ramp', '2', 's'), parameter('Dwell', '1', 's'), parameter('Trip current', '2', 'mA')] },
    { description: 'Leakage current at the end of the dwell', points: [ptTpGnd], resource: hipot, expected: lessThan('2', 'mA') },
    { wait: '2 s' });
  const stpPeBond = both('Pass a test current from the PE terminal to the PE contact of the socket and read the resistance.',
    { description: 'Earth bond current', points: [ptPE, ptSocketPE], resource: hipot, parameters: [parameter('Current', '25', 'A DC'), parameter('Duration', '2', 's')] },
    { description: 'Earth bond resistance', points: [ptPE, ptSocketPE], resource: hipot, expected: atMost('100', 'mΩ') });
  stgSafety.tests = [
    test('Fixture engagement', 'Bring the unit onto the probes.', [stpCallEngage]),
    test('Dielectric strength', 'Prove the insulation between the mains and everything a person can touch.', [stpHipotPe, stpHipotSelv], { kpi: true }),
    test('Protective earth continuity', 'Prove that the socket PE is bonded to the PE terminal.', [stpPeBond]),
  ];

  // 2. Power up
  const stgPower = with_(newStage(), {
    name: 'Power up and supply rails',
    description: 'Power the unit, check the internal supplies and the standby power, identify the firmware and write the serial number.',
    prerequisites: [stgSafety.id],
  });
  const stpCallPowerUp = call('Power the unit up.', setPowerUp);
  const stp3v3 = measurement('Measure the 3.3 V rail on its pad.',
    { description: '3.3 V rail', points: [ptTp3v3, ptTpGnd], resource: dmm, expected: around('3.3', '3', 'V', 'percent') });
  const stp12v = measurement('Measure the 12 V rail on its pad.',
    { description: '12 V rail', points: [ptTp12, ptTpGnd], resource: dmm, expected: around('12', '5', 'V', 'percent') });
  const stpPanelSupply = measurement('Measure the supply delivered to the front panel.',
    { description: 'Front panel supply, X5 pin 1 to pin 3', points: [ptPanel], resource: dmm, expected: around('12', '5', 'V', 'percent') });
  const stpZc = measurement('Check the mains zero-crossing pulses on their pad: two per cycle.',
    { description: 'Zero-crossing pulse frequency', points: [ptTpZc, ptTpGnd], resource: scope, expected: around('100', '1', 'Hz', 'percent') },
    { note: 'Twice the mains frequency: the firmware times the contactor on these pulses.' });
  const stpStandby = measurement('Read the active power drawn from the mains with no vehicle connected.',
    { description: 'Standby power, sum of the phases', points: [ptL1, ptL2, ptL3, ptN], resource: analyser, expected: atMost(vStandby, 'W') },
    { wait: '2 s', note: 'The display dims after the splash; the wait lets it.' });
  const stpVersion = measurement('Read the firmware version from the console.',
    { description: 'Firmware version', command: cmdVersion, expected: text(vFwPattern, 'EQ', { regex: true }) },
    { note: 'Record the version on the test report.' });
  const stpSnWrite = both('Write the serial number printed on the label.',
    { description: 'Write the serial number', command: cmdSnWrite, parameters: [parameter('Serial', 'from the label, scanned')] },
    { description: 'Console answer', command: cmdSnWrite, expected: text('OK') },
    { note: 'A unit that answers ERR 40 has been through the line before: it goes to rework, not to a retest.' });
  const stpSnRead = measurement('Read the serial number back.',
    { description: 'Serial number', command: cmdSnRead, expected: text('OK VE22-', 'STARTS') });
  stgPower.tests = [
    test('Power up', 'Apply the mains and open the console.', [stpCallPowerUp]),
    test('Supply rails', 'Check every internal supply the rest of the sequence relies on.', [stp3v3, stp12v, stpPanelSupply, stpZc], { kpi: true }),
    test('Standby power', 'Check the consumption at rest against the product limit.', [stpStandby]),
    test('Identification', 'Identify the firmware and give the unit its serial number.', [stpVersion, stpSnWrite, stpSnRead]),
  ];

  // 3. Control Pilot
  const stgCp = with_(newStage(), {
    name: 'Control Pilot',
    description: 'Check the pilot signal in state A, the PWM in state B, the duty cycle against the current limit, and the reaction to states C and E.',
    prerequisites: [stgPower.id],
  });
  const stpCpStateA = measurement('With no vehicle connected, read the pilot level at the socket.',
    { description: 'CP level, state A', points: [ptSocketCp, ptSocketPE], resource: dmm, expected: around(vCpHigh, vCpTol, 'V') },
    { note: 'The simulator is still in state A from the fixture engagement: nothing has connected a vehicle yet.' });
  const stpCpInput = measurement('Measure the same level at the board input: proves the wiring from the socket to X1.',
    { description: 'CP level at the board input, state A', points: [ptCpIn, ptSocketPE], resource: dmm, expected: around(vCpHigh, vCpTol, 'V') });
  const stpCallStateB = call('Connect the simulated vehicle.', setStateB);
  const stpPwmFreq = measurement('Measure the PWM frequency at the socket.',
    { description: 'PWM frequency', points: [ptSocketCp, ptSocketPE], resource: scope, expected: around('1000', '0.5', 'Hz', 'percent') });
  const stpPwmDuty = measurement('Measure the duty cycle: it advertises the rated current of the unit.',
    { description: 'PWM duty cycle', points: [ptSocketCp, ptSocketPE], resource: scope, expected: around(vDuty, vDutyTol, '%') });
  const stpPwmHigh = measurement('Measure the positive level of the PWM.',
    { description: 'PWM high level', points: [ptSocketCp, ptSocketPE], resource: scope, expected: around('9', vCpTol, 'V') },
    { note: 'In state B the vehicle loads the pilot: +9 V, not +12 V.' });
  const stpPwmLow = measurement('Measure the negative level of the PWM.',
    { description: 'PWM low level', points: [ptSocketCp, ptSocketPE], resource: scope, expected: around(vCpLow, vCpTol, 'V') });
  const stpPwmAdc = measurement('Check the divided pilot on its pad, the value the firmware actually reads.',
    { description: 'CP after the divider, high level', points: [ptTpCpAdc, ptTpGnd], resource: scope, expected: between('2.4', '2.7', 'V') });
  const stpPwmLogic = measurement('Check the PWM before the driver, on the MCU pad: the same duty cycle at logic level.',
    { description: 'PWM duty cycle at the MCU pad', points: [ptTpCpPwm, ptTpGnd], resource: scope, expected: around(vDuty, vDutyTol, '%') },
    { note: 'A duty cycle right here and wrong at the socket is the driver; wrong here too is the firmware.' });
  const stpDuty16 = both('Set the duty cycle to 16.7 % (10 A) and measure it.',
    { description: 'Set the duty cycle', command: cmdCpDuty, parameters: [parameter('Duty', '16.7', '%')] },
    { description: 'PWM duty cycle', points: [ptSocketCp, ptSocketPE], resource: scope, expected: around('16.7', vDutyTol, '%') },
    { wait: '200 ms' });
  const stpDuty96 = both('Set the duty cycle to 96 % (digital communication requested) and measure it.',
    { description: 'Set the duty cycle', command: cmdCpDuty, parameters: [parameter('Duty', '96', '%')] },
    { description: 'PWM duty cycle', points: [ptSocketCp, ptSocketPE], resource: scope, expected: around('96', vDutyTol, '%') },
    { wait: '200 ms' });
  const stpDutyAuto = both('Return the duty cycle to the value the firmware computes.',
    { description: 'Restore the duty cycle', command: cmdCpDuty, parameters: [parameter('Duty', 'auto')] },
    { description: 'Console answer', command: cmdCpDuty, expected: text('OK') });
  const stpStateC = both('Move the simulator to state C and check that the unit follows.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '882 Ω + diode')] },
    { description: 'Pilot state', command: cmdCpState, expected: text('OK C') },
    { wait: '500 ms' });
  const stpStateE = both('Short the pilot to PE at the simulator and check that the unit reports state E.',
    { description: 'Pilot fault', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('Fault injection', 'CP short to PE')] },
    { description: 'Pilot state', command: cmdCpState, expected: text('OK E') },
    { wait: '500 ms' });
  const stpFaultCp = measurement('Read the fault register: only the pilot fault bit may be set.',
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0008') });
  const stpBackToB = both('Remove the fault, return to state B and clear the register.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '2.74 kΩ + diode'), parameter('Fault injection', 'none')] },
    { description: 'Pilot state', command: cmdCpState, expected: text('OK B') },
    { wait: '500 ms' });
  const stpFaultClearCp = both('Clear the fault register.',
    { description: 'Clear the register', command: cmdFaultClear },
    { description: 'Fault register after clearing', command: cmdFault, expected: text('OK 0x0000') });
  stgCp.tests = [
    test('Pilot level, state A', 'Check the unloaded pilot before a vehicle is connected.', [stpCpStateA, stpCpInput]),
    test('PWM in state B', 'Check the pilot signal a vehicle would see: frequency, duty cycle and levels.', [stpCallStateB, stpPwmFreq, stpPwmDuty, stpPwmHigh, stpPwmLow, stpPwmLogic, stpPwmAdc], { kpi: true }),
    test('Duty cycle follows the command', 'Check that the firmware sets the duty cycle it is asked for, at both ends of the range.', [stpDuty16, stpDuty96, stpDutyAuto]),
    test('States C and E', 'Check that the unit follows the vehicle into state C and detects a pilot fault.', [stpStateC, stpStateE, stpFaultCp, stpBackToB, stpFaultClearCp]),
  ];

  // 4. Proximity Pilot
  const stgPp = with_(newStage(), {
    name: 'Proximity Pilot',
    description: 'Check that the unit decodes the cable capability from the PP resistor, for every cable it may meet.',
    prerequisites: [stgCp.id],
  });
  // One matrix instead of seven steps: every cable the unit may meet is a row, and what is
  // applied and read is declared once, in the columns. The current limit is judged where
  // the answer is settled — a 13 A cable caps it, a 63 A cable leaves the nameplate in charge,
  // which the EVC-11 variant changes — and recorded elsewhere.
  const stpPpTable = tableStep('Select each PP resistor in turn and read the cable capability and the effective current limit.',
    [
      { name: 'PP resistor', kind: TABLE_COLUMN_KIND.STIMULUS, unit: 'Ω', points: [ptSocketPp, ptSocketPE], resource: evSim },
      { name: 'Cable capability (pp)', kind: TABLE_COLUMN_KIND.MEASUREMENT, unit: 'A', command: cmdPp },
      { name: 'Effective limit (ilimit)', kind: TABLE_COLUMN_KIND.MEASUREMENT, unit: 'A', command: cmdIlimit },
    ], [
      ['1500 Ω / 13 A cable', '1500', '= 13', '= 13'],
      ['680 Ω / 20 A cable', '680', '= 20', 'recorded'],
      ['100 Ω / 63 A cable', '100', '= 63', '= $MaxCurrent'],
      ['Open / no cable', 'open', '= 0', 'recorded'],
      ['220 Ω / 32 A cable', '220', '= 32', 'recorded'],
    ], { wait: '300 ms', variables: [vMaxCurrent], note: 'Three hundred milliseconds between the resistor and the reading: the PP input is filtered.' });
  const stpPpInput = measurement('Measure the PP voltage at the board input with the 32 A resistor in place: proves the wiring from the socket to X1.',
    { description: 'PP at the board input', points: [ptPpIn, ptSocketPE], resource: dmm, expected: between('1.9', '2.1', 'V') });
  const stpPpAdc = measurement('Check the divided PP on its pad with the 32 A resistor back in place.',
    { description: 'PP after the divider', points: [ptTpPpAdc, ptTpGnd], resource: dmm, expected: between('1.9', '2.1', 'V') });
  stgPp.tests = [
    test('Cable capability', 'Decode every standard cable, and the absence of one.', [stpPpTable, stpPpInput, stpPpAdc]),
  ];

  // 5. Contactor and lock
  const stgContactor = with_(newStage(), {
    name: 'Contactor and socket lock',
    description: 'Drive the socket lock, close the contactor by going to state C, check the socket outputs and the mirror contact, and prove that a welded contactor is detected.',
    prerequisites: [stgPp.id],
  });
  const stpLockOn = both('Lock the socket and check that the pin holds the simulator cable.',
    { description: 'Drive the lock', command: cmdLock, parameters: [parameter('Lock', 'on')] },
    { description: 'The simulator cable reports that it is held', points: [ptSocketLock], resource: evSim, expected: yes() },
    { wait: '800 ms' });
  const stpLockState = measurement('Read the lock position on the console.',
    { description: 'Lock position', command: cmdLockState, expected: text('OK locked') });
  const stpLockVoltage = measurement('Measure the lock output while the actuator runs.',
    { description: 'Lock output during actuation', points: [ptLock, ptTpGnd], resource: dmm, expected: around('12', '10', 'V', 'percent') },
    { note: 'Taken on the next actuation cycle; the actuator runs for 600 ms.' });
  const stpLockOff = both('Unlock the socket and read the lock position.',
    { description: 'Drive the lock', command: cmdLock, parameters: [parameter('Lock', 'off')] },
    { description: 'Lock position', command: cmdLockState, expected: text('OK unlocked') },
    { wait: '800 ms' });
  const stpToC = both('Move the simulator to state C: the unit locks the socket and closes the contactor on its own.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '882 Ω + diode')] },
    { description: 'Mirror contact', command: cmdMirror, expected: text('OK closed') },
    { wait: '1.5 s' });
  const stpCoilVoltage = measurement('Measure the contactor coil output.',
    { description: 'Coil voltage, OUT1 to N', points: [ptCoil, ptN], resource: dmm, expected: around(vMains, '10', 'V', 'percent') });
  const stpCoilDrive = measurement('Check the K1 drive on its pad.',
    { description: 'K1 drive level', points: [ptTpCoilDrive, ptTpGnd], resource: dmm, expected: atLeast('11', 'V') });
  const stpOutL1 = measurement('Measure the voltage on the socket L1 contact.',
    { description: 'Socket L1 to N', points: [ptSocketL1, ptSocketN], resource: dmm, expected: around(vMains, '10', 'V', 'percent') });
  const stpOutL2 = measurement('Measure the voltage on the socket L2 contact.',
    { description: 'Socket L2 to N', points: [ptSocketL2, ptSocketN], resource: dmm, expected: around(vMains, '10', 'V', 'percent') });
  const stpOutL3 = measurement('Measure the voltage on the socket L3 contact.',
    { description: 'Socket L3 to N', points: [ptSocketL3, ptSocketN], resource: dmm, expected: around(vMains, '10', 'V', 'percent') });
  const stpMirrorPad = measurement('Check the debounced mirror signal on its pad.',
    { description: 'Mirror contact, debounced', points: [ptTpMirror, ptTpGnd], resource: dmm, expected: lessThan('0.4', 'V') });
  const stpBackToB2 = both('Return to state B: the contactor must open.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '2.74 kΩ + diode')] },
    { description: 'Mirror contact', command: cmdMirror, expected: text('OK open') },
    { wait: '500 ms' });
  const stpOutOff = measurement('Check that the socket is dead again.',
    { description: 'Socket L1 to N, contactor open', points: [ptSocketL1, ptSocketN], resource: dmm, expected: lessThan('5', 'V') });
  const stpWeld = both('Hold the mirror input closed while the contactor is open, as a welded contactor would, and read the fault register.',
    { description: 'Mirror contact override', points: [ptMirror], resource: relayMatrix, parameters: [parameter('Channel 3', 'short')] },
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0002') },
    { wait: '1 s' });
  const stpWeldRelease = both('Release the override and clear the register.',
    { description: 'Mirror contact override', points: [ptMirror], resource: relayMatrix, parameters: [parameter('Channel 3', 'open')] },
    { description: 'Fault register after clearing', command: cmdFaultClear, expected: text('OK') },
    { wait: '300 ms' });
  stgContactor.tests = [
    test('Socket lock', 'Drive the lock both ways and read its position.', [stpLockOn, stpLockState, stpLockVoltage, stpLockOff]),
    test('Contactor closing', 'Go to state C and check the contactor, its coil and every socket phase.', [stpToC, stpCoilVoltage, stpCoilDrive, stpOutL1, stpOutL2, stpOutL3, stpMirrorPad, stpBackToB2, stpOutOff], { kpi: true }),
    test('Welded contactor detection', 'Prove that a contactor that does not open is reported.', [stpWeld, stpWeldRelease]),
  ];

  // 6. Residual current
  const stgRcm = with_(newStage(), {
    name: 'Residual current monitoring',
    description: 'Inject a residual current through the sensor with the contactor closed and time its opening, for AC and for DC.',
    prerequisites: [stgContactor.id],
  });
  const stpRcmIdle = measurement('Read the sensor output at rest.',
    { description: 'Sensor output, no current', points: [ptTpRcm, ptTpGnd], resource: dmm, expected: around('2.5', '0.05', 'V') });
  const stpRcmToC = both('Close the contactor by moving to state C.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '882 Ω + diode')] },
    { description: 'Mirror contact', command: cmdMirror, expected: text('OK closed') },
    { wait: '1.5 s' });
  const stpRcmAc = both('Inject 30 mA AC through the sensor and time the opening of the contactor.',
    { description: 'AC injection', points: [ptRcmSensor], resource: rcmSet, parameters: [parameter('Current', '30', 'mA AC'), parameter('Frequency', vFreq, 'Hz')] },
    { description: 'Trip time, injection to mirror contact', points: [ptMirror], resource: rcmSet, expected: atMost(vRcmAc, 'ms') });
  const stpRcmAcFault = measurement('Read the fault register: the residual current bit must be set.',
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0001') });
  const stpRcmReset = both('Return to state B, clear the register and close the contactor again.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '2.74 kΩ + diode')] },
    { description: 'Fault register after clearing', command: cmdFaultClear, expected: text('OK') },
    { wait: '500 ms' });
  const stpRcmToC2 = both('Close the contactor again.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '882 Ω + diode')] },
    { description: 'Mirror contact', command: cmdMirror, expected: text('OK closed') },
    { wait: '1.5 s' });
  const stpRcmDc = both('Inject 6 mA DC through the sensor and time the opening of the contactor.',
    { description: 'DC injection', points: [ptRcmSensor], resource: rcmSet, parameters: [parameter('Current', '6', 'mA DC')] },
    { description: 'Trip time, injection to mirror contact', points: [ptMirror], resource: rcmSet, expected: atMost(vRcmDc, 's') },
    { note: 'IEC 62955 allows ten seconds at 6 mA; the bench times out at twelve.' });
  const stpRcmDcFault = measurement('Read the fault register.',
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0001') });
  const stpRcmEnd = both('Return to state B and clear the register.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '2.74 kΩ + diode')] },
    { description: 'Fault register after clearing', command: cmdFaultClear, expected: text('OK') },
    { wait: '500 ms' });
  stgRcm.tests = [
    test('Sensor at rest', 'Check the sensor before anything flows through it.', [stpRcmIdle]),
    test('AC residual current', 'Trip on 30 mA AC within the time allowed.', [stpRcmToC, stpRcmAc, stpRcmAcFault, stpRcmReset], { kpi: true }),
    test('DC residual current', 'Trip on 6 mA DC within the time allowed.', [stpRcmToC2, stpRcmDc, stpRcmDcFault, stpRcmEnd], { kpi: true }),
  ];

  // 7. Metering
  const stgMeter = with_(newStage(), {
    name: 'Energy metering',
    description: 'Read the meter over RS-485, then load the socket and compare what the controller reads from its meter with the reference analyser.',
    prerequisites: [stgContactor.id],
    exclusions: { mode: EXCLUSION_MODE.LIST, stageIds: [stgRcm.id] },
  });
  const stpMeterSerial = measurement('Read the meter serial number directly on the bus.',
    { description: 'Meter serial number', command: cmdMeterSerial, expected: text('EM3-', 'STARTS') });
  const stpMeterIdle = measurement('Read the power the controller sees with nothing connected.',
    { description: 'Active power from the meter, no load', command: cmdMeterPower, expected: atMost('5', 'W') });
  const stpLoadOn = both('Close the contactor and draw 10 A per phase through the socket.',
    { description: 'Simulator state and load', points: [ptSocketCp, ptSocketPE, ptSocketL1, ptSocketL2, ptSocketL3, ptSocketN], resource: evSim,
      parameters: [parameter('CP load', '882 Ω + diode')] },
    { description: 'Mirror contact', command: cmdMirror, expected: text('OK closed') },
    { wait: '1.5 s' });
  const stpLoadSet = stimulus('Set the electronic load.',
    { description: 'Load current', points: [ptSocketL1, ptSocketL2, ptSocketL3, ptSocketN], resource: acLoad,
      parameters: [parameter('Current', '10', 'A per phase'), parameter('Phases', vPhases)] },
    { wait: '2 s' });
  const stpRefPower = measurement('Record the active power measured by the reference analyser.',
    { description: 'Reference active power', points: [ptL1, ptL2, ptL3, ptN], resource: analyser, expected: recorded('W') },
    { note: 'Recorded, not judged: the next step judges the meter against it.' });
  const stpMeterPower = measurement('Read the active power from the controller, to be judged against the reference in the next step.',
    { description: 'Active power from the meter, under load', command: cmdMeterPower, expected: recorded('W') },
    { note: 'Recorded: the error is computed from this reading and the reference.' });
  // The judgement is on the error between the two readings, not on either of them: a
  // computed measurement, with the accuracy the product claims as its tolerance.
  const stpMeterError = measurement('Compute the metering error from the two readings and judge it against the accuracy the product claims.',
    { description: 'Metering error', expected: around('0', vMeterAcc, '%') });
  stpMeterError.measurement.computed = { formula: '(meter − reference) / reference × 100', inputStepIds: [stpRefPower.id, stpMeterPower.id] };
  const stpMeterDirect = measurement('Read the same register directly on the bus, to separate a meter fault from a controller fault.',
    { description: 'Active power read by the bench', command: cmdMeterPowerDirect, expected: around('6900', vMeterAcc, 'W', 'percent') });
  const stpLoadOff = stimulus('Remove the load.',
    { description: 'Load current', points: [ptSocketL1, ptSocketL2, ptSocketL3, ptSocketN], resource: acLoad, parameters: [parameter('Current', '0', 'A per phase')] },
    { wait: '500 ms' });
  const stpMeterBackToB = both('Return to state B.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', '2.74 kΩ + diode')] },
    { description: 'Mirror contact', command: cmdMirror, expected: text('OK open') },
    { wait: '500 ms' });
  stgMeter.tests = [
    test('Meter communication', 'Prove that the meter answers on the bus and that the controller reads it.', [stpMeterSerial, stpMeterIdle]),
    test('Active power accuracy', 'Compare the meter with the reference under a known load.', [stpLoadOn, stpLoadSet, stpRefPower, stpMeterPower, stpMeterError, stpMeterDirect, stpLoadOff, stpMeterBackToB], { kpi: true }),
  ];

  // 8. Front panel
  const stgHmi = with_(newStage(), {
    name: 'Front panel',
    description: 'Drive the LED ring, the buzzer and the display from the console and measure what comes out; open the tamper switch and check that it is reported.',
    prerequisites: [stgPower.id],
  });
  const ledStep = (name, r, g, b, hue) => both(`Set the ring to ${name} and read its hue.`,
    { description: 'LED colour', command: cmdLed, parameters: [parameter('R', String(r)), parameter('G', String(g)), parameter('B', String(b))] },
    { description: `Hue, ${name}`, points: [ptLedRing], resource: colorimeter, expected: around(String(hue), '10', '°') },
    { wait: '300 ms' });
  const stpLedBlue = ledStep('blue', 0, 0, 255, 240);
  // The first step of the ring test points the operator at the front panel picture.
  stpLedBlue.imageId = imgFront.id;
  const stpLedGreen = ledStep('green', 0, 255, 0, 120);
  const stpLedRed = ledStep('red', 255, 0, 0, 0);
  const stpLedWhite = both('Set the ring to white and read its luminance.',
    { description: 'LED colour', command: cmdLed, parameters: [parameter('R', '255'), parameter('G', '255'), parameter('B', '255')] },
    { description: 'Luminance, white', points: [ptLedRing], resource: colorimeter, expected: atLeast('40', 'cd/m²') },
    { wait: '300 ms' });
  const stpLedOff = both('Switch the ring off.',
    { description: 'LED colour', command: cmdLed, parameters: [parameter('R', '0'), parameter('G', '0'), parameter('B', '0')] },
    { description: 'Luminance, off', points: [ptLedRing], resource: colorimeter, expected: lessThan('0.5', 'cd/m²') },
    { wait: '300 ms' });
  const stpBuzzer = both('Sound the buzzer for half a second and read the level.',
    { description: 'Buzzer', command: cmdBuzzer, parameters: [parameter('Duration', '500', 'ms')] },
    { description: 'Sound pressure level at 100 mm', points: [ptBuzzer], resource: microphone, expected: atLeast('70', 'dB(A)') },
    { wait: '100 ms' });
  const stpDisplay = both('Show the test pattern and have the operator confirm it.',
    { description: 'Display test pattern', command: cmdDisplayTest },
    { description: 'Operator confirms a full checkerboard and the text TEST 1234 with no missing pixel', points: [ptDisplay], expected: yes() },
    { note: 'The one manual step of the sequence: the bench shows the operator what to expect.' });
  const stpTamperOpen = both('Open the tamper input and read it.',
    { description: 'Tamper switch override', points: [ptTamper], resource: relayMatrix, parameters: [parameter('Channel 4', 'open')] },
    { description: 'Tamper switch', command: cmdTamper, expected: text('OK open') },
    { wait: '300 ms' });
  const stpTamperFault = measurement('Read the fault register: the tamper bit must be set.',
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0010') });
  const stpTamperClose = both('Close the tamper input again and clear the register.',
    { description: 'Tamper switch override', points: [ptTamper], resource: relayMatrix, parameters: [parameter('Channel 4', 'closed')] },
    { description: 'Fault register after clearing', command: cmdFaultClear, expected: text('OK') },
    { wait: '300 ms' });
  stgHmi.tests = [
    test('LED ring', 'Check the three primaries, the brightness of white and that off is off.', [stpLedBlue, stpLedGreen, stpLedRed, stpLedWhite, stpLedOff], { kpi: true }),
    test('Buzzer', 'Check that the buzzer can be heard.', [stpBuzzer]),
    test('Display', 'Check every pixel of the display.', [stpDisplay]),
    test('Tamper switch', 'Check that opening the cover is reported.', [stpTamperOpen, stpTamperFault, stpTamperClose]),
  ];

  // 9. RFID
  const stgRfid = with_(newStage(), {
    name: 'RFID reader',
    description: 'Present the test tag to the reader at the guaranteed range and check that its UID is read.',
    prerequisites: [stgPower.id],
  });
  const stpRfidClear = both('Forget any tag read so far.',
    { description: 'Clear the last tag', command: cmdRfidClear },
    { description: 'Last tag after clearing', command: cmdRfidLast, expected: text('OK none') });
  const stpTagNear = both('Present the tag at 10 mm and read its UID.',
    { description: 'Tag position', points: [ptRfid], resource: tagArm, parameters: [parameter('Distance', '10', 'mm')] },
    { description: 'Last tag read', command: cmdRfidLast, expected: text(vRfidUid, 'ENDS') },
    { wait: '1 s' });
  const stpTagRange = both('Withdraw the tag, clear, and present it again at the guaranteed range.',
    { description: 'Tag position', points: [ptRfid], resource: tagArm, parameters: [parameter('Distance', '30', 'mm')] },
    { description: 'Last tag read', command: cmdRfidLast, expected: text(vRfidUid, 'ENDS') },
    { wait: '1 s', note: 'The actuator withdraws to 60 mm and the bench sends rfid clear before moving in again.' });
  const stpTagAway = both('Withdraw the tag.',
    { description: 'Tag position', points: [ptRfid], resource: tagArm, parameters: [parameter('Distance', '60', 'mm')] },
    { description: 'Clear the last tag', command: cmdRfidClear, expected: text('OK') },
    { wait: '500 ms' });
  stgRfid.tests = [
    test('Tag read', 'Read the test tag up close and at the guaranteed range.', [stpRfidClear, stpTagNear, stpTagRange, stpTagAway], { kpi: true }),
  ];

  // 10. Temperature
  const stgTemp = with_(newStage(), {
    name: 'Temperature monitoring',
    description: 'Stand a decade box in for the NTC, check the reading at two temperatures and the over-temperature fault at a third.',
    prerequisites: [stgPower.id],
    // The over-temperature fault lands in the same register the pilot, contactor, residual
    // current and tamper tests read exactly: none of them may run while it is raised.
    exclusions: { mode: EXCLUSION_MODE.LIST, stageIds: [stgCp.id, stgContactor.id, stgRcm.id, stgHmi.id] },
  });
  const tempStep = (ohm, celsius, tol) => both(`Set the decade box to ${ohm} Ω (${celsius} °C) and read the temperature.`,
    { description: 'NTC resistance', points: [ptNtc], resource: decade, parameters: [parameter('Resistance', String(ohm), 'Ω')] },
    { description: 'Board temperature', command: cmdTemp, expected: around(String(celsius), String(tol), '°C') },
    { wait: '1 s' });
  const stpTemp25 = tempStep(10000, 25, 1.5);
  const stpNtcAdc = measurement('Check the divided sensor voltage on its pad at 25 °C.',
    { description: 'NTC after the divider', points: [ptTpNtc, ptTpGnd], resource: dmm, expected: around('1.65', '0.03', 'V') });
  const stpTemp50 = tempStep(3600, 50, 2);
  const stpTemp80 = both('Set the decade box to 1250 Ω (80 °C) and read the fault register.',
    { description: 'NTC resistance', points: [ptNtc], resource: decade, parameters: [parameter('Resistance', '1250', 'Ω')] },
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0004') },
    { wait: '2 s', note: 'The firmware filters the reading over one second before raising the fault.' });
  const stpTempBack = both('Return to 25 °C and clear the register.',
    { description: 'NTC resistance', points: [ptNtc], resource: decade, parameters: [parameter('Resistance', '10000', 'Ω')] },
    { description: 'Fault register after clearing', command: cmdFaultClear, expected: text('OK') },
    { wait: '2 s' });
  stgTemp.tests = [
    test('Sensor reading', 'Check the temperature at two points of the curve.', [stpTemp25, stpNtcAdc, stpTemp50]),
    test('Over-temperature fault', 'Check that a hot board is reported.', [stpTemp80, stpTempBack]),
  ];

  // 11. Communications
  const stgComms = with_(newStage(), {
    name: 'Communications',
    description: 'Bring the unit onto the bench network over Ethernet and let it announce itself to the backend simulator; then move it to Wi-Fi and do the same.',
    prerequisites: [stgPower.id],
  });
  const stpEthLink = measurement('Check that the Ethernet link is up and an address has been obtained.',
    { description: 'Ethernet status', command: cmdEthStatus, expected: text('OK up', 'STARTS') },
    { wait: '2 s' });
  const stpBoot = measurement('Wait for the BootNotification and check that the simulator accepted the unit.',
    { description: 'BootNotification answer', command: cmdBoot, parameters: [parameter('Keep the trace', vTrace)], expected: text('"status":"Accepted"', 'CONTAINS') });
  const stpStatusNotif = measurement('Wait for the StatusNotification that follows the boot.',
    { description: 'StatusNotification payload', command: cmdStatusNotif, expected: text('"status":"Available"', 'CONTAINS') },
    { wait: '5 s' });
  const stpWifiJoin = both('Join the bench network.',
    { description: 'Join the network', command: cmdWifiJoin, parameters: [parameter('SSID', vSsid), parameter('Passphrase', 'from the bench configuration')] },
    { description: 'Console answer', command: cmdWifiJoin, expected: text('OK') });
  const stpWifiStatus = measurement('Check the Wi-Fi association.',
    { description: 'Wi-Fi status', command: cmdWifiStatus, expected: text('OK connected', 'STARTS') },
    { wait: '1 s' });
  const stpWifiRssi = measurement('Read the signal strength of the bench access point as the unit sees it.',
    { description: 'Wi-Fi RSSI', command: cmdWifiRssi, expected: atLeast('-70', 'dBm') },
    { note: 'A weak signal here is a missing antenna connection, not a weak access point.' });
  const stpHeartbeat = measurement('Trigger a Heartbeat over Wi-Fi and check that it is answered.',
    { description: 'Heartbeat answer', command: cmdHeartbeat, expected: text('"currentTime"', 'CONTAINS') });
  stgComms.tests = [
    test('Ethernet and OCPP', 'Prove the wired path to the backend end to end.', [stpEthLink, stpBoot, stpStatusNotif], { kpi: true }),
    test('Wi-Fi', 'Prove the wireless path to the backend end to end.', [stpWifiJoin, stpWifiStatus, stpWifiRssi, stpHeartbeat]),
  ];

  // 12. Close-out
  const stgClose = with_(newStage(), {
    name: 'Close-out',
    description: 'Check that nothing is left in the fault register, leave test mode, power the unit down and free it.',
    prerequisites: [stgRcm.id, stgMeter.id, stgHmi.id, stgRfid.id, stgTemp.id, stgComms.id],
  });
  const stpFinalFault = measurement('Read the fault register one last time.',
    { description: 'Fault register', command: cmdFault, expected: text('OK 0x0000') });
  const stpStateA = both('Disconnect the simulated vehicle.',
    { description: 'Simulator state', points: [ptSocketCp, ptSocketPp, ptSocketPE], resource: evSim, parameters: [parameter('CP load', 'none'), parameter('PP resistor', 'open')] },
    { description: 'Pilot state', command: cmdCpState, expected: text('OK A') },
    { wait: '500 ms' });
  const stpTestModeOff = both('Leave test mode: the console closes and the unit is a product again.',
    { description: 'Leave test mode', command: cmdTestMode, parameters: [parameter('Mode', 'off')] },
    { description: 'Console answer', command: cmdTestMode, expected: text('OK') });
  const stpCallPowerDown = call('Power the unit down.', setPowerDown);
  const stpCallRelease = call('Release the fixture.', setRelease);
  stgClose.tests = [
    test('Final checks', 'Leave the unit as the customer will find it.', [stpFinalFault, stpStateA, stpTestModeOff]),
    test('Release', 'Power down and free the bench.', [stpCallPowerDown, stpCallRelease]),
  ];

  doc.stages = [
    stgSafety, stgPower, stgCp, stgPp, stgContactor, stgRcm, stgMeter, stgHmi, stgRfid, stgTemp, stgComms, stgClose,
    setEngage, setRelease, setPowerUp, setPowerDown, setStateB,
  ];

  // ---- variants -----------------------------------------------------------------------------

  const path = (...segments) => segments.map((s) => (s && typeof s === 'object' && s.id ? '#' + s.id : s));

  const vBase = with_(newVariant(), { name: 'EVC-22', description: 'Base version: three phases, 32 A, 22 kW. Everything in this document applies as written.' });

  // Only values change: the marks in the document show which limits depend on the variant.
  const v11 = with_(newVariant(), {
    name: 'EVC-11',
    description: 'Three phases, 16 A, 11 kW. Same board and same sequence; the current limit and the duty cycle that advertises it are the only differences.',
    overlay: [
      { op: OP.SET, path: path('variables', vMaxCurrent, 'value'), value: '16' },
      { op: OP.SET, path: path('variables', vDuty, 'value'), value: '26.7' },
      { op: OP.SET, path: path('variables', vDuty, 'description'), value: 'Control Pilot duty cycle that advertises MaxCurrent: 16 A / 0.6 A = 26.7 % (IEC 61851-1, table A.8).' },
    ],
  });

  // Whole stages and steps go, and what depended on them is repointed.
  const v7 = with_(newVariant(), {
    name: 'EVC-7 S',
    description: 'Single phase, 32 A, 7.4 kW, in the compact enclosure: no RFID reader and no display. L2 and L3 are not fitted, and the meter is single phase.',
    overlay: [
      { op: OP.SET, path: path('variables', vPhases, 'value'), value: '1' },
      { op: OP.REMOVE, path: path('stages', stgRfid) },
      { op: OP.SET, path: path('stages', stgClose, 'prerequisites'), value: [stgRcm.id, stgMeter.id, stgHmi.id, stgTemp.id, stgComms.id] },
      { op: OP.REMOVE, path: path('stages', stgContactor, 'tests', stgContactor.tests[1], 'steps', stpOutL2) },
      { op: OP.REMOVE, path: path('stages', stgContactor, 'tests', stgContactor.tests[1], 'steps', stpOutL3) },
      { op: OP.REMOVE, path: path('stages', stgHmi, 'tests', stgHmi.tests[2]) },
      { op: OP.REMOVE, path: path('points', ptRfid) },
      { op: OP.REMOVE, path: path('points', ptDisplay) },
      // No reader, no tag: the variable would be reported as unused under this variant.
      { op: OP.REMOVE, path: path('variables', vRfidUid) },
      { op: OP.SET, path: path('stages', stgMeter, 'tests', stgMeter.tests[1], 'steps', stpMeterPower, 'measurement', 'expected', 'nominal'), value: constant('2300') },
      { op: OP.SET, path: path('stages', stgMeter, 'tests', stgMeter.tests[1], 'steps', stpMeterDirect, 'measurement', 'expected', 'nominal'), value: constant('2300') },
      { op: OP.SET, path: path('stages', stgPower, 'tests', stgPower.tests[2], 'steps', stpStandby, 'measurement', 'description'), value: 'Standby power, single phase' },
      { op: OP.SET, path: path('points', ptMeter, 'characteristics', ptMeter.characteristics[0], 'value'), value: 'EM1-DIN, single phase, class B' },
    ],
  });

  // A variant that adds: a command the base does not know, and a test that uses it.
  const cmdLte = console_('Read LTE modem status', 'lte status', {
    requestFormat: 'lte status', responseFormat: 'OK <registered|searching|off> <dBm>', encoding: 'registration state, then the signal strength as a signed integer', example: 'OK registered -83', nominalTime: '0.3',
    notes: 'Fitted on the Pro version only.',
  });
  const cmdLteRssi = console_('Read LTE signal strength', 'lte rssi', {
    requestFormat: 'lte rssi', responseFormat: 'OK <dBm>', encoding: 'signed integer dBm', example: 'OK -83',
  });
  const stpLteStatus = measurement('Check that the modem has registered on the bench cell.',
    { description: 'LTE status', command: cmdLte, expected: text('OK registered', 'STARTS') },
    { wait: '10 s', note: 'The bench runs a private LTE cell; registration takes up to ten seconds from power up.' });
  const stpLteRssi = measurement('Read the signal strength of the bench cell.',
    { description: 'LTE RSSI', command: cmdLteRssi, expected: atLeast('-95', 'dBm') });
  const tstLte = test('LTE modem', 'Prove that the modem registers and that its antenna is connected.', [stpLteStatus, stpLteRssi]);
  const vPro = with_(newVariant(), {
    name: 'EVC-22 Pro',
    description: 'The EVC-22 with an LTE modem for sites without a wired network. Everything of the base applies, plus the modem test.',
    overlay: [
      { op: OP.ADD, path: path('commands'), value: cmdLte },
      { op: OP.ADD, path: path('commands'), value: cmdLteRssi },
      { op: OP.ADD, path: path('stages', stgComms, 'tests'), value: tstLte },
      { op: OP.SET, path: path('variables', vStandby, 'value'), value: '4.5' },
      { op: OP.SET, path: path('variables', vStandby, 'description'), value: 'Highest active power drawn with no vehicle connected and the display idle. The modem, registered and idle, accounts for the extra 1.5 W.' },
    ],
  });
  doc.variants = [vBase, v11, v7, vPro];

  return {
    doc,
    history: { revisions: await pastRevisions(doc, { rcmStageId: stgRcm.id, dcTestId: stgRcm.tests[2].id, proVariantId: vPro.id, standbyId: vStandby.id }) },
    assets,
  };
}

/**
 * Three issued revisions, so the comparison has something to show from the first click:
 * rev 00 before the residual current stage, rev 01 with it but without the DC injection,
 * rev 02 the document as it was before the Pro variant and the tighter standby limit.
 */
async function pastRevisions(doc, { rcmStageId, dcTestId, proVariantId, standbyId }) {
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const standby = (d, value) => { const v = d.variables.find((x) => x.id === standbyId); if (v) v.value = value; };
  const withoutPro = (d) => { d.variants = d.variants.filter((v) => v.id !== proVariantId); };

  const rev00 = clone(doc);
  rev00.revision = { number: '00', date: '2026-03-16', author: 'G. Ferraro', reason: 'First issue', status: 'issued' };
  rev00.stages = rev00.stages.filter((s) => s.id !== rcmStageId);
  for (const s of rev00.stages) s.prerequisites = (s.prerequisites || []).filter((p) => p !== rcmStageId);
  for (const s of rev00.stages) if (s.exclusions) s.exclusions.stageIds = (s.exclusions.stageIds || []).filter((p) => p !== rcmStageId);
  rev00.variants = [];
  standby(rev00, '5');

  const rev01 = clone(doc);
  rev01.revision = { number: '01', date: '2026-05-22', author: 'G. Ferraro', reason: 'Residual current monitoring stage; EVC-11 and EVC-7 S variants', status: 'approved' };
  for (const s of rev01.stages) if (s.id === rcmStageId) s.tests = s.tests.filter((t) => t.id !== dcTestId);
  withoutPro(rev01);
  standby(rev01, '5');

  const rev02 = clone(doc);
  rev02.revision = { number: '02', date: '2026-07-14', author: 'S. Moretti', reason: 'DC residual current test added; KPI tests marked', status: 'approved' };
  withoutPro(rev02);
  standby(rev02, '5');

  // Each revision records the pictures it shows, as an issue by this build would.
  const issued = async (d) => ({ number: d.revision.number, date: d.revision.date, author: d.revision.author, reason: d.revision.reason, status: d.revision.status, assetIds: assetsUsedBy(d), snapshot: await compress(JSON.stringify(d)) });
  return [await issued(rev00), await issued(rev01), await issued(rev02)];
}
