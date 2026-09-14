// Example document shipped as dist/example.html: it is used for the checks and works
// as a starting model for whoever opens the tool for the first time.
import {
  emptyDocument, newReference, newSignatory, newVariable, newVariant, newResource, newInterface,
  newCommand, newPoint, newCharacteristic, newImage, newMarker, newStage, newTest,
  newStep, newParameter, newHeldStimulus, newProtocol, constant, variableRef,
  STEP_TYPE, VARIABLE_TYPE, EXCLUSION_MODE, STAGE_KIND,
} from '../src/model/schema.js';
import { OP } from '../src/model/variants.js';
import { compress } from '../src/history/revisions.js';

const with_ = (base, fields) => Object.assign(base, fields);

const characteristic = (name, value, unit = '') => with_(newCharacteristic(), { name, value, unit });

const parameter = (name, value, unit = '') => with_(newParameter(), { name, value, unit });

/** Synthetic image: a stylised board, so the example depends on no external file. */
const BOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">
<rect width="640" height="400" fill="#1f6b3a"/>
<rect x="24" y="24" width="592" height="352" fill="none" stroke="#9fd8b4" stroke-width="2"/>
<rect x="60" y="70" width="150" height="80" rx="6" fill="#26313b"/>
<text x="70" y="118" font-family="monospace" font-size="18" fill="#cfe6d8">MCU</text>
<rect x="430" y="60" width="130" height="60" rx="4" fill="#2b2b2b"/>
<text x="440" y="96" font-family="monospace" font-size="16" fill="#e0e0e0">J1</text>
<rect x="430" y="240" width="130" height="60" rx="4" fill="#2b2b2b"/>
<text x="440" y="276" font-family="monospace" font-size="16" fill="#e0e0e0">J2</text>
<circle cx="150" cy="280" r="34" fill="#c8ccd0"/>
<text x="124" y="286" font-family="monospace" font-size="14" fill="#26313b">SW1</text>
<rect x="250" y="180" width="120" height="46" rx="4" fill="#3a3a3a"/>
<text x="262" y="209" font-family="monospace" font-size="14" fill="#e0e0e0">DRIVER</text>
</svg>`;

/* A deliberately tall wordmark: it shows that the logo fits the header rather than growing it. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160" viewBox="0 0 260 160">
<rect width="260" height="160" fill="#10559a"/>
<circle cx="60" cy="60" r="30" fill="#ffffff"/>
<path d="M45 60 L57 74 L78 46" fill="none" stroke="#10559a" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
<text x="110" y="72" font-family="Georgia, serif" font-size="34" fill="#ffffff">ACME</text>
<text x="20" y="126" font-family="Georgia, serif" font-size="22" fill="#cddff2">ELECTRONICS</text>
</svg>`;

const LOGO_ASSET = {
  id: 'demoacmelogo001',
  mime: 'image/svg+xml',
  data: Buffer.from(LOGO_SVG, 'utf8').toString('base64'),
  width: 260,
  height: 160,
  name: 'acme-logo.svg',
};

const BOARD_ASSET = {
  id: 'demoboardpcb001',
  mime: 'image/svg+xml',
  data: Buffer.from(BOARD_SVG, 'utf8').toString('base64'),
  width: 640,
  height: 400,
  name: 'lcu200-board.svg',
};

export async function buildDemo() {
  const doc = emptyDocument();

  doc.header = {
    title: 'End of line test specification',
    company: 'Acme Electronics Ltd.',
    logoAssetId: LOGO_ASSET.id,
    project: 'P-2451',
    product: 'LCU-200 lighting control unit',
    documentCode: 'SPC-TEST-0042',
    confidentiality: 'Confidential – internal use',
    disclaimer: 'This document contains information owned by Acme Electronics Ltd. It is issued for the sole purpose of testing the LCU-200 and may not be reproduced, disclosed to third parties or used for any other purpose without written authorisation.\n\nThe test limits stated here apply to the production bench described in the appendices. Any deviation must be agreed with the test engineering department before the line is released.',
    signatories: [newSignatory('Prepared by', 'M. Rossi'), newSignatory('Checked by', 'A. Bianchi'), newSignatory('Approved by', 'L. Verdi')],
  };
  doc.revision = { number: '02', date: '2026-08-30', author: 'M. Rossi', reason: 'Added the 24 V variant', status: 'draft' };

  doc.description = {
    product: 'The LCU-200 drives the exterior lighting of the vehicle. It takes its commands from the CAN bus, drives four high current outputs and handles a local service button.\n\nConnector J1 carries supply and bus, connector J2 the power outputs.',
    testing: 'The end of line test covers supply, communication, power outputs and the local mechanical command.\n\nUnless stated otherwise, every measurement is taken at room temperature with a regulated supply.',
  };

  // ---- references
  doc.references = [
    with_(newReference(), { code: 'SPC-HW-0021', title: 'LCU-200 hardware specification', revision: 'Rev. 04' }),
    with_(newReference(), { code: 'ICD-CAN-LCU', title: 'Interface Control Document — vehicle CAN bus', revision: 'Rev. 12' }),
    with_(newReference(), { code: 'PRC-QAL-007', title: 'End of line testing procedure', revision: 'Rev. 02' }),
  ];

  // ---- variables
  const vBatt = with_(newVariable(), { name: 'Vbatt', type: VARIABLE_TYPE.NUMBER, unit: 'V', value: '13.5', description: 'Nominal supply voltage used for testing.' });
  const iQuiescent = with_(newVariable(), { name: 'IquiescentMax', type: VARIABLE_TYPE.NUMBER, unit: 'mA', value: '45', description: 'Highest current allowed at rest.' });
  const protocol = with_(newVariable(), { name: 'Protocol', type: VARIABLE_TYPE.ENUM, allowedValues: ['CAN', 'LIN'], value: 'CAN', description: 'Bus used to talk to the unit during the test.' });
  const ambient = with_(newVariable(), { name: 'AmbientTemp', type: VARIABLE_TYPE.RANGE, unit: '°C', min: '15', max: '30', description: 'Temperature range allowed in the test area.' });
  const debug = with_(newVariable(), { name: 'DebugMode', type: VARIABLE_TYPE.BOOLEAN, value: 'false', description: 'When true, the bench records the full CAN trace.' });
  const fwPattern = with_(newVariable(), {
    name: 'FwPattern', type: VARIABLE_TYPE.TEXT, value: '^LCU200 v\\d+\\.\\d+\\.\\d+$',
    description: 'Accepted shape of the firmware version string; changed here when the release family changes.',
  });
  doc.variables = [vBatt, iQuiescent, protocol, ambient, debug, fwPattern];

  // ---- resources
  const supply = with_(newResource(), {
    name: 'Programmable DC power supply', category: 'Power', averageTime: '1.5',
    characteristics: [characteristic('Voltage', '0 … 32', 'V'), characteristic('Current', '0 … 10', 'A'), characteristic('Current readback', '±0.5', '%')],
  });
  const dmm = with_(newResource(), {
    name: '6½ digit multimeter', category: 'Electrical measurement', averageTime: '0.8',
    characteristics: [characteristic('DC voltage', '0 … 100', 'V'), characteristic('Accuracy', '±0.02', '%')],
  });
  const canBench = with_(newResource(), {
    name: 'Bench CAN interface', category: 'Communication', averageTime: '0.3',
    characteristics: [characteristic('Channels', '2', ''), characteristic('Bit rate', 'up to 1', 'Mbit/s')],
  });
  const actuator = with_(newResource(), {
    name: 'Pneumatic actuator with load cell', category: 'Mechanical actuation', averageTime: '2',
    characteristics: [characteristic('Force', '0 … 50', 'N'), characteristic('Stroke', '0 … 20', 'mm')],
  });
  doc.resources = [supply, dmm, canBench, actuator];

  // ---- interfaces and commands
  const canItf = with_(newInterface(), {
    name: 'Vehicle CAN bus', type: 'CAN 2.0B',
    parameters: [characteristic('Bit rate', '500', 'kbit/s'), characteristic('Termination', '120', 'Ω'), characteristic('Application protocol', 'UDS over ISO-TP', '')],
  });
  const uartItf = with_(newInterface(), {
    name: 'Service console', type: 'UART',
    parameters: [characteristic('Baud rate', '115200', 'bit/s'), characteristic('Frame', '8N1', ''), characteristic('Levels', '3.3', 'V')],
  });
  // Two grammars on the same bus: the application frames the product defines, and UDS.
  const prtApp = with_(newProtocol(), {
    name: 'LCU application frames', family: 'Application specific',
    description: 'The frames the LCU-200 defines for its own functions. They are sent on the vehicle CAN bus outside any diagnostic session and are answered immediately.',
    requestFormat: 'Identifier 0x2E0 + 8 data bytes\nByte 0: service (0x2E write, 0x22 read)\nBytes 1-2: parameter identifier, big endian\nBytes 3-7: payload, padded with 0x00',
    responseFormat: 'Identifier 0x2E8 + 8 data bytes\nByte 0: service + 0x40 on success\nBytes 1-2: parameter identifier echoed\nBytes 3-7: value, padded with 0x00',
    rules: [characteristic('Answer within', '50', 'ms'), characteristic('Padding byte', '0x00', ''), characteristic('Byte order', 'big endian', '')],
    notes: 'No session and no security access: these frames are always available.',
  });
  const prtUds = with_(newProtocol(), {
    name: 'UDS over ISO-TP', family: 'ISO 14229-1 / ISO 15765-2',
    description: 'Diagnostic services, used for the fault memory and the identification data. Requests longer than seven bytes are segmented by ISO-TP.',
    requestFormat: 'Single frame: PCI 0x0n + service + sub-function\nFirst frame: 0x1LLL for a payload longer than 7 bytes, then consecutive frames 0x2n',
    responseFormat: 'Positive: service + 0x40, then the payload\nNegative: 0x7F + service + NRC (0x31 request out of range, 0x22 conditions not correct)',
    rules: [characteristic('P2 server', '50', 'ms'), characteristic('P2* extended', '5000', 'ms'), characteristic('Block size', '8', 'frames'), characteristic('Separation time', '10', 'ms')],
    notes: 'A pending answer (NRC 0x78) restarts the P2* timer: the bench waits, it does not fail the step.',
  });
  doc.protocols = [prtApp, prtUds];

  doc.interfaces = [canItf, uartItf];

  const cmdVbatt = with_(newCommand(), {
    name: 'Read supply voltage', interfaceId: canItf.id, protocolId: prtApp.id, address: '0x22 0xF1 0x90 (DID VBATT)',
    requestFormat: '22 F1 90', responseFormat: '62 F1 90 <uint16>',
    negativeResponse: '7F 22 31 — request out of range',
    encoding: 'uint16, LSB = 10 mV', example: 'Response 62 F1 90 05 46 → 13.50 V', nominalTime: '0.2',
  });
  const cmdLights = with_(newCommand(), {
    name: 'Switch low beam on', interfaceId: canItf.id, protocolId: prtApp.id, address: '0x2E 0x40 0x01',
    requestFormat: '2E 40 01 <state>', responseFormat: '6E 40 01',
    negativeResponse: '7F 2E 22 — conditions not correct (unit not powered)',
    encoding: 'state: 00 = off, 01 = on', nominalTime: '0.15', example: '2E 40 01 01 → switches on',
  });
  const cmdFaults = with_(newCommand(), {
    name: 'Read fault codes', interfaceId: canItf.id, protocolId: prtUds.id, address: '0x19 0x02',
    requestFormat: '19 02 08', responseFormat: '59 02 <DTC list>', encoding: '3 byte DTC plus status', nominalTime: '0.4', example: '59 02 FF → no code stored',
  });
  const cmdVersion = with_(newCommand(), {
    name: 'Read firmware version', interfaceId: uartItf.id, address: 'text command "ver"',
    requestFormat: 'ver\\r\\n', responseFormat: 'LCU200 vX.Y.Z', encoding: 'ASCII', nominalTime: '0.6', example: 'LCU200 v1.4.0',
  });
  doc.commands = [cmdVbatt, cmdLights, cmdFaults, cmdVersion];

  // ---- images and points
  const image = newImage(BOARD_ASSET.id, 'LCU-200 board — component side');
  image.caption = 'Position of the contact points on the test bench.';
  doc.images = [image];

  const ptVbat = with_(newPoint(), {
    name: 'Battery positive', connector: 'J1', pin: '1', signal: 'VBAT', contactType: 'Ø 2 mm spring probe',
    characteristics: [characteristic('Max current', '10', 'A'), characteristic('Contact force', '2.5', 'N'), characteristic('Contact resistance', '< 20', 'mΩ')],
    markers: [{ ...newMarker(image.id, 0.695, 0.19), area: 0.15 }],
  });
  const ptGnd = with_(newPoint(), {
    name: 'Ground', connector: 'J1', pin: '2', signal: 'GND', contactType: 'Ø 2 mm spring probe',
    characteristics: [characteristic('Max current', '10', 'A'), characteristic('Contact force', '2.5', 'N')],
    markers: [newMarker(image.id, 0.83, 0.19)],
  });
  const ptOutput = with_(newPoint(), {
    name: 'Left low beam output', connector: 'J2', pin: '5', signal: 'OUT_LOW_L', contactType: 'Ø 1.5 mm spring probe',
    characteristics: [characteristic('Max current', '6', 'A'), characteristic('Contact force', '1.8', 'N')],
    markers: [newMarker(image.id, 0.7, 0.68)],
  });
  const ptButton = with_(newPoint(), {
    name: 'Service button SW1', connector: '—', pin: '—', signal: 'SW1', contactType: 'Ø 6 mm rubber tip',
    characteristics: [characteristic('Pressing force', '5 ± 1', 'N'), characteristic('Travel', '1.2', 'mm')],
    markers: [newMarker(image.id, 0.235, 0.7)],
  });
  // A test point: the board carries the name TP12 silk-screened next to the pad, so the
  // picture shows TP12 instead of the point number.
  const ptDriver = with_(newPoint(), {
    name: 'Driver output test pad', connector: 'TP12', pin: '—', signal: 'DRV_OUT', contactType: 'Ø 1 mm spring probe',
    characteristics: [characteristic('Max current', '0.1', 'A'), characteristic('Contact force', '1.2', 'N')],
    markers: [newMarker(image.id, 0.487, 0.508)],
  });
  const ptCan = with_(newPoint(), {
    name: 'CAN bus (CANH/CANL)', connector: 'J1', pin: '5 / 6', signal: 'CANH / CANL', contactType: 'Spring probe pair',
    characteristics: [characteristic('Line impedance', '120', 'Ω')],
    markers: [newMarker(image.id, 0.765, 0.255)],
  });
  doc.points = [ptVbat, ptGnd, ptOutput, ptDriver, ptButton, ptCan];

  // Both buses reach the unit through contacts of their own: a step that talks over them
  // needs those points, and the bench count says so without anyone repeating it per step.
  canItf.pointIds = [ptCan.id];
  uartItf.pointIds = [ptCan.id];
  // The instrument that speaks each bus, declared once: the steps below send commands over
  // them without naming it again.
  canItf.resourceId = canBench.id;
  uartItf.resourceId = canBench.id;

  // ---- setup stages: routines the sequence calls, as many times as it needs
  const setPowerUp = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Power up',
    description: 'Bring the unit to its nominal supply voltage and leave it powered.',
  });
  const tstPowerUp = with_(newTest(), { name: 'Supply', purpose: 'Apply the supply and let the unit start.' });
  const stpPowerUp = with_(newStep(STEP_TYPE.STIMULUS), {
    description: 'Power the unit at the nominal test voltage.',
    wait: { value: '2', unit: 's' },
  });
  with_(stpPowerUp.stimulus, {
    description: 'Apply the supply voltage',
    pointIds: [ptVbat.id, ptGnd.id], resourceId: supply.id,
    parameters: [parameter('Voltage', variableRef(vBatt.id), 'V'), parameter('Current limit', constant('5'), 'A')],
  });
  tstPowerUp.steps = [stpPowerUp];
  setPowerUp.tests = [tstPowerUp];
  setPowerUp.heldStimuli = [with_(newHeldStimulus(), { stepId: stpPowerUp.id, note: 'the unit stays powered for whoever called this stage' })];

  const setPowerDown = with_(newStage(STAGE_KIND.SETUP), {
    name: 'Power down',
    description: 'Bring the supply back to zero and leave the unit unpowered.',
  });
  const tstPowerDown = with_(newTest(), { name: 'Supply removal', purpose: 'Remove the supply safely.' });
  const stpPowerDown = with_(newStep(STEP_TYPE.STIMULUS), { description: 'Bring the supply voltage down to zero.' });
  with_(stpPowerDown.stimulus, {
    description: 'Set the supply to zero', pointIds: [ptVbat.id, ptGnd.id], resourceId: supply.id,
    parameters: [parameter('Voltage', constant('0'), 'V')],
  });
  tstPowerDown.steps = [stpPowerDown];
  setPowerDown.tests = [tstPowerDown];

  // ---- test stages: the sequence itself
  const stgPower = with_(newStage(), {
    name: 'Set-up and power-up',
    description: 'Connect the board to the bench, power it up and check the quiescent current.',
  });
  const tstPower = with_(newTest(), { name: 'Supply and current draw', kpi: true, purpose: 'Check that the unit powers up and stays within the quiescent current limit.' });
  const stpCallPowerUp = with_(newStep(STEP_TYPE.STAGE_CALL), { description: 'Power the unit up.' });
  stpCallPowerUp.calledStageId = setPowerUp.id;
  const stpQuiescent = with_(newStep(STEP_TYPE.MEASUREMENT), { description: 'Measure the current drawn at rest.' });
  with_(stpQuiescent.measurement, {
    description: 'Supply current', pointIds: [ptVbat.id], resourceId: supply.id,
    expected: { mode: 'minmax', min: constant('0'), max: variableRef(iQuiescent.id), nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: 'mA' },
  });
  const stpVersion = with_(newStep(STEP_TYPE.MEASUREMENT), { description: 'Read the firmware version from the service console.', note: 'Record the version on the test report.' });
  with_(stpVersion.measurement, {
    description: 'Firmware version', resourceId: '', commandId: cmdVersion.id,
    // A version is text, and what makes it right is its shape. The shape lives in a variable:
    // when the release family changes it is changed there, not in every step that reads it.
    expected: {
      kind: 'string', text: variableRef(fwPattern.id), regex: true, caseSensitive: true,
      stringComparison: 'EQ',
      mode: 'minmax', min: constant(''), max: constant(''), nominal: constant(''),
      tolerance: constant(''), toleranceType: 'absolute', unit: '', booleanValue: 'true',
    },
  });
  tstPower.steps = [stpCallPowerUp, stpQuiescent, stpVersion];
  stgPower.tests = [tstPower];

  const stgLights = with_(newStage(), {
    name: 'Lighting functions',
    description: 'Drive the power outputs over the bus and check the output voltages.',
  });
  stgLights.prerequisites = [stgPower.id];
  const tstLights = with_(newTest(), { name: 'Low beam', kpi: true, purpose: 'Check that the left low beam output switches on when commanded over CAN.' });
  const stpOn = with_(newStep(STEP_TYPE.STIMULUS_MEASUREMENT), {
    description: 'Switch the low beam on over the bus and check the output voltage.',
    wait: { value: '200', unit: 'ms' },
  });
  with_(stpOn.stimulus, {
    description: 'Send the switch-on command', pointIds: [ptCan.id], resourceId: '', commandId: cmdLights.id,
    parameters: [parameter('Requested state', constant('01'), '')],
  });
  with_(stpOn.measurement, {
    description: 'Voltage on the power output', pointIds: [ptOutput.id, ptDriver.id], resourceId: dmm.id,
    expected: { mode: 'nominal', min: constant(''), max: constant(''), nominal: variableRef(vBatt.id), tolerance: constant('5'), toleranceType: 'percent', unit: 'V' },
  });
  const stpOff = with_(newStep(STEP_TYPE.STIMULUS_MEASUREMENT), { description: 'Switch the low beam off and check the output falls back to zero.' });
  with_(stpOff.stimulus, {
    description: 'Send the switch-off command', pointIds: [ptCan.id], resourceId: '', commandId: cmdLights.id,
    parameters: [parameter('Requested state', constant('00'), '')],
  });
  with_(stpOff.measurement, {
    description: 'Residual voltage on the output', pointIds: [ptOutput.id], resourceId: dmm.id,
    // A strictly-less-than, to show the comparison operators at work: the output must fall
    // below the threshold, not merely reach it.
    expected: { mode: 'minmax', comparison: 'LT', min: constant(''), max: constant('0.5'), nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: 'V' },
  });
  tstLights.steps = [stpOn, stpOff];
  stgLights.tests = [tstLights];

  const stgMech = with_(newStage(), {
    name: 'Local mechanical command',
    description: 'Press the service button with a controlled force and check it is recognised.',
  });
  stgMech.prerequisites = [stgPower.id];
  stgMech.exclusions = { mode: EXCLUSION_MODE.LIST, stageIds: [stgLights.id] };
  const tstMech = with_(newTest(), { name: 'Button SW1', purpose: 'Check that a button press is recognised by the firmware.' });
  const stpPress = with_(newStep(STEP_TYPE.STIMULUS), { description: 'Press the service button with a controlled force.', wait: { value: '300', unit: 'ms' } });
  with_(stpPress.stimulus, {
    description: 'Actuate the button', pointIds: [ptButton.id], resourceId: actuator.id,
    parameters: [parameter('Force', constant('5'), 'N'), parameter('Duration', constant('300'), 'ms')],
  });
  const stpRead = with_(newStep(STEP_TYPE.MEASUREMENT), { description: 'Check that the firmware registered the press.' });
  with_(stpRead.measurement, {
    description: 'Button state read over the bus', pointIds: [ptCan.id], resourceId: '', commandId: cmdVbatt.id,
    // Pressed or not pressed: a yes/no, not a number that happens to be 1.
    expected: {
      kind: 'boolean', booleanValue: 'true',
      mode: 'minmax', comparison: 'EQ', min: constant('1'), max: constant(''), nominal: constant(''),
      tolerance: constant(''), toleranceType: 'absolute', unit: '',
      text: '', stringComparison: 'EQ', caseSensitive: true, regex: false,
    },
  });
  tstMech.steps = [stpPress, stpRead];
  stgMech.tests = [tstMech];

  const stgDiag = with_(newStage(), { name: 'Diagnostics', description: 'Read the stored fault codes.' });
  // Reading fault codes over the bus needs nobody else to stand still: the diagnostics stage
  // may run alongside the others, which is what gives the cycle time estimate something to
  // optimise. The mechanical stage is the one with a real conflict, declared below.
  stgDiag.exclusions = { mode: EXCLUSION_MODE.NONE, stageIds: [] };
  stgDiag.prerequisites = [stgPower.id];
  const tstDiag = with_(newTest(), { name: 'Fault codes', purpose: 'Check that no fault code is stored once the tests are done.' });
  const stpDtc = with_(newStep(STEP_TYPE.MEASUREMENT), { description: 'Read the stored fault codes.' });
  with_(stpDtc.measurement, {
    description: 'Number of stored codes', pointIds: [ptCan.id], resourceId: '', commandId: cmdFaults.id,
    expected: { mode: 'minmax', comparison: 'EQ', min: constant('0'), max: constant(''), nominal: constant(''), tolerance: constant(''), toleranceType: 'absolute', unit: 'DTC' },
  });
  tstDiag.steps = [stpDtc];
  stgDiag.tests = [tstDiag];

  const stgClose = with_(newStage(), { name: 'Test close-out', description: 'Remove the stimuli and release the unit.' });
  stgClose.prerequisites = [stgLights.id, stgMech.id, stgDiag.id];
  const tstClose = with_(newTest(), { name: 'Release', purpose: 'Power the unit down and free the bench.' });
  const stpCallPowerDown = with_(newStep(STEP_TYPE.STAGE_CALL), { description: 'Power the unit down.' });
  stpCallPowerDown.calledStageId = setPowerDown.id;
  tstClose.steps = [stpCallPowerDown];
  stgClose.tests = [tstClose];

  doc.stages = [stgPower, stgLights, stgMech, stgDiag, stgClose, setPowerUp, setPowerDown];

  // ---- variants
  const vBase = with_(newVariant(), { name: 'LCU-200 12 V', description: 'Base version, 12 V nominal supply.' });
  const v24 = with_(newVariant(), {
    name: 'LCU-200 24 V',
    description: 'Version for commercial vehicles: 24 V supply and no service button.',
    overlay: [
      { op: OP.SET, path: ['variables', '#' + vBatt.id, 'value'], value: '27' },
      { op: OP.SET, path: ['variables', '#' + iQuiescent.id, 'value'], value: '30' },
      { op: OP.REMOVE, path: ['stages', '#' + stgMech.id] },
      // The close-out waited for the mechanical stage too: without it, that prerequisite goes.
      { op: OP.SET, path: ['stages', '#' + stgClose.id, 'prerequisites'], value: [stgLights.id, stgDiag.id] },
      { op: OP.SET, path: ['stages', '#' + stgLights.id, 'tests', '#' + tstLights.id, 'steps', '#' + stpOff.id, 'measurement', 'expected', 'max'], value: constant('0.8') },
    ],
  });
  doc.variants = [vBase, v24];

  return {
    doc,
    history: { revisions: await pastRevisions(doc, { vBattId: vBatt.id, diagStageId: stgDiag.id, variant24Id: v24.id }) },
    assets: { [BOARD_ASSET.id]: BOARD_ASSET, [LOGO_ASSET.id]: LOGO_ASSET },
  };
}

/**
 * Two already issued revisions, so the example lets you try the comparison right away:
 * rev 00 without the diagnostics stage, rev 01 without the 24 V variant.
 */
async function pastRevisions(doc, { vBattId, diagStageId, variant24Id }) {
  const clone = (v) => JSON.parse(JSON.stringify(v));

  const rev00 = clone(doc);
  rev00.revision = { number: '00', date: '2026-05-12', author: 'M. Rossi', reason: 'First issue', status: 'issued' };
  rev00.stages = rev00.stages.filter((s) => s.id !== diagStageId);
  for (const s of rev00.stages) {
    s.prerequisites = (s.prerequisites || []).filter((p) => p !== diagStageId);
    for (const t of s.tests || []) t.steps = (t.steps || []).filter((p) => p.calledStageId !== diagStageId);
  }
  rev00.variants = [];
  const vb = rev00.variables.find((v) => v.id === vBattId);
  if (vb) vb.value = '13.2';

  const rev01 = clone(doc);
  rev01.revision = { number: '01', date: '2026-07-03', author: 'M. Rossi', reason: 'Added the final diagnostics stage', status: 'approved' };
  rev01.variants = rev01.variants.filter((v) => v.id !== variant24Id);

  return [
    { number: '00', date: rev00.revision.date, author: rev00.revision.author, reason: rev00.revision.reason, status: 'issued', snapshot: await compress(JSON.stringify(rev00)) },
    { number: '01', date: rev01.revision.date, author: rev01.revision.author, reason: rev01.revision.reason, status: 'approved', snapshot: await compress(JSON.stringify(rev01)) },
  ];
}
