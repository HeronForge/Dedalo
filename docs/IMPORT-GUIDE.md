# Converting an existing specification into DEDALO — guide for a language model

This document has two readers.

- **A language model** that is handed an old test specification (a PDF, a Word file, a scan) and
  has to turn it into the JSON this tool imports. Everything it needs is here: the model of a
  specification, the exact format, and the rules for reading a legacy document.
- **A person** who wants to know how a specification is organised in this tool, what each concept
  means and why. It doubles as the conceptual documentation of the system.

The conversion never has to be perfect on the first pass. What matters is that nothing is
invented: whatever the source does not say must be left empty and flagged, not guessed.

---

## 1. The workflow

1. Open the PDF and this guide, and give both to the model with the prompt in §2.
2. The model returns a single JSON file — call it `spec.json`.
3. Open `test-spec.html` (the empty document), choose **File ▾ → Import data…** in the top bar and
   pick `spec.json`.
   Anything the importer could not resolve is listed on screen; nothing is silently dropped.
4. Upload the pictures in the **Images** section and place the markers on the application points
   (the JSON can name the images, but it cannot carry them).
5. Open **Validation** (the count in the status bar opens it), work through errors and
   warnings, then **Validate** (✔) and **Save** (💾).

Steps 4 and 5 are for a person. Everything else the model can do alone.

---

## 2. The prompt to give the model

> You are converting an existing test specification into the JSON format described in the guide
> I am giving you. Read the whole source document first, then produce **one JSON object and
> nothing else** — no explanation, no markdown fence.
>
> Follow the guide strictly. Do not invent values, limits, connectors or resources: what the
> source does not state must stay empty, and where you are unsure add a line starting with
> `TO CHECK:` to the `note` of the step or the `notes` of the entity — on its own line, so that
> the import can lift it out of the document and into the margin. Keep the wording of the
> source document, in its own language; do not translate, do not reword measurements, do not
> convert units.
>
> Whatever the source contains that the JSON does not — a drawing, a chapter, a table you had
> to flatten, a rule with no place in the format — goes in the `conversion.leftOut` list at the
> end of the object, item by item, with where it was and why it stayed out. A document that
> says what it lacks is complete; one that hides it is not.

Attach: this guide, plus the source specification **as a rendered PDF, not as extracted text**:
some specifications carry meaning in colour and typeface (red for a deleted test, italics for a
value the bench menu may change), and text extraction loses it.

If the source is long, convert it stage by stage and merge the arrays at the end: the format is
flat enough that concatenating `stages` from several passes works, as long as the keys stay
unique.

---

## 3. How a specification is organised here

Seven ideas, and everything else follows from them.

**Application point** — a physical place the bench touches: a connector pin, a test pad, a
button. It carries connector, pin, signal, type of contact and the characteristics of the
connection (max current, contact force, impedance). Steps refer to it by code (`AP-01`), the full
detail lives in an appendix, and it is marked on a picture of the unit.

**Resource** — an instrument the bench must provide: a power supply, a multimeter, a CAN
interface, an actuator. Steps say which resource they need and with what parameters; the document
ends with a table of every resource, where it is applied and how many channels are needed at
once.

**Command** — a message on a communication interface: address, request and response format,
encoding. In a step it appears as a short name (`CMD-02 Read supply voltage`); the addresses live
in an appendix.

**Variable** — a value used in more than one place, or one that changes between product variants:
`Vbatt`, `IquiescentMax`. A step referring to `$Vbatt` follows the variable, so changing it once
changes the whole document.

**Step** — the unit of work. It has a plain description of what the operator or the bench does,
and up to two halves:
- **the stimulus**: what is *applied to* the unit (a voltage, a command, a force);
- **the measurement**: what is *read back from* the unit, with its acceptance criterion.
A step can instead be a **stage call** (see below), or a **table** — the same stimulus and
measurement declared once as columns, and one row per combination — and it can declare a wait
time (a number or a variable), a figure it refers to, and a note. A measurement may be
**computed** from earlier readings instead of taken.

**Test** — a handful of steps that check one thing, with a name and a purpose.

**Stage** — a block of tests, and it comes in two kinds, which is the distinction to get right:
- a **test stage** (`STG-xx`) belongs to the sequence. It runs once, after its prerequisites, and
  may declare which other stages must not run in parallel with it.
- a **setup stage** (`SET-xx`) has no place of its own in the sequence. It runs where a step
  calls it, as many times as it is called: *power up*, *power down*, *load the configuration*,
  *connect the load bank*. It has no prerequisites — it inherits the context of whoever calls it.

A stage may also declare which of its stimuli are **held on exit**: a *power up* routine leaves
the supply on, and the document (and the resource count) has to know it.

---

## 4. The JSON format

One object, these keys, all optional except `stages`. Everything is a **string** unless stated
otherwise — numbers as strings are fine and keep trailing zeros intact.

### 4.1 The version of the format

The first field says which format the file is written in:

```json
{ "format": "tsw-authoring/1" }
```

This guide describes **`tsw-authoring/1`**. Always write it: a file with no `format` is read as
the current version and the import says so, but stating it is what keeps the file readable years
from now. A file written in a version newer than the build that opens it is refused with the
reason — never half imported — and older versions keep being read and upgraded, with the upgrade
reported. **Version and changelog** in the editor lists the formats each build reads and writes.

`protocols` describe the grammar of the messages — `name`, `family`, `description`,
`requestFormat`, `responseFormat`, `rules` — and a command names one with `"protocol": "UDS"`.
Put in them what the source says about framing, timings and padding; leave them out entirely
when the source says nothing.

A test may carry `"kpi": true` when the source marks it as a key performance indicator.

An interface may name the instrument that speaks it — `"resource": "CANBENCH"` — and list the
points it is wired to: `"points": ["CAN"]`. With the instrument declared there, a step that
sends a command over that interface needs no `resource` of its own. A command may carry
`"negativeResponse"` (what the unit answers when it refuses) and `"nominalTime"` (seconds); a
resource may carry `"averageTime"` (seconds it is held for one use). All three are optional and
only feed the cycle time estimate and the bench count — never invent them.

The other format the tool reads is `tsw-export/1`, the envelope of **File ▾ → Export data**, which carries
the whole document, its revision history and its images. Use the authoring format to bring a
specification in, the export format to move one between builds or to archive it.

### 4.2 Keys and references

Entities refer to each other through a `key` you choose: short, uppercase, stable, derived from
the name — `VBAT`, `GND`, `PSU`, `DMM`, `READ_VBAT`, `POWER_UP`. Keys are case-insensitive, they
never appear in the printed document, and the importer turns them into internal identifiers.

A variable can also be referenced by its `name`, which is usually what the source quotes.

### 4.3 Skeleton

```json
{
  "format": "tsw-authoring/1",
  "header": { },
  "description": { },
  "references": [ ],
  "glossary": [ ],
  "variables": [ ],
  "resources": [ ],
  "interfaces": [ ],
  "commands": [ ],
  "images": [ ],
  "points": [ ],
  "stages": [ ],
  "variants": [ ],
  "conversion": { }
}
```

### 4.4 Field by field

**`header`** — `title`, `company`, `project`, `product`, `documentCode`, `confidentiality`,
`signatories: [{ role, name }]`, and `revision: { number, date, author, reason }`.
`date` is `YYYY-MM-DD`. Take the revision from the source document's own record: the revision
being converted is the one you write here.

The signatories are printed on the cover in the order given, four to a table, each with a
signature line: `[{ "role": "Prepared by", "name": "M. Rossi" }, { "role": "Verified by
(Quality)", "name": "P. Bianchi" }]`. Write as many as the source has, with the roles the source
uses. The three older keys `preparedBy`, `checkedBy`, `approvedBy` are still read, as the first
three signatories.

**`description`** — `product` (what the unit is) and `testing` (purpose of the test, general
conditions, acceptance rules that apply to everything). Blank lines separate paragraphs.

**`glossary[]`** — `term`, `meaning`: what the acronyms of the text stand for, one line each
(`{ "term": "RCM", "meaning": "Residual current monitor" }`). Printed as a chapter of its own,
alphabetically, and left out while empty. Write a line for every acronym the source uses
without explaining it — the reader of the converted document is the one who cannot guess.

**`settings`** (top level) — `noDirectEditing` (true/false) and `chapterOrder`, a list of
chapter keys in the order the document should print them: `references`, `product`, `testing`,
`glossary`, `variables`, `variants`, `stages`, `setups`, then the appendices `kpi`, `points`,
`protocols`, `commands`, `resources`, `graph`. What the list does not name follows in that
default order; a chapter with nothing in it is not printed. Leave `chapterOrder` out unless
the source has its chapters in another order.

**`references[]`** — `key`, `code`, `title`, `revision`, `notes`. The documents the source
points at. A command or a protocol defined in one of them names it with `"reference": "ICD"`;
the reference is reached by its `key` or by its `code`.

**`variables[]`** — `key`, `name`, `type`, `unit`, `value`, `description`, and for
`type: "range"` also `min` and `max`, for `type: "enum"` also `allowedValues: []`.
`type` is one of `number` (default), `text`, `enum`, `boolean`, `range`.

**`resources[]`** — `key`, `name`, `category`, `notes`,
`characteristics: [{ name, value, unit }]` — what the instrument must be able to do
(`Voltage 0 … 32 V`, `Accuracy ±0.02 %`).

**`interfaces[]`** — `key`, `name`, `type` (`CAN 2.0B`, `UART`…), `notes`,
`parameters: [{ name, value, unit }]` — baud rate, termination, levels, protocol.

**`commands[]`** — `key`, `name`, `interface` (key of an interface), `protocol`, `address`,
`requestFormat`, `responseFormat`, `encoding`, `example`, `notes`, and optionally:
- `"reference": "ICD"` — the document the command is defined in, when the source only names it
  (§5.4). The appendix prints «Defined in REF-04»; a command with a reference and no format is
  listed by the validation as information, not as a fault;
- `"decoding": { "formula": "hex → U32, − 3072, ÷ 51.15", "unit": "mA" }` — how the raw answer
  becomes the value a step judges, written for a person, and the unit it comes out in. A
  criterion over that command that states no `unit` is read in the decoding's unit.

`protocols[]` may carry `"reference"` in the same way.

**`images[]`** — `key`, `name`, `caption`. The picture file itself is uploaded by hand after the
import; declare the image anyway if the source marks points on a drawing, so the points can point
at it.

**`points[]`** — `key`, `name`, `connector`, `pin`, `signal`, `contactType`, `notes`,
`characteristics: [{ name, value, unit }]`, and optionally
`markers: [{ image: "BOARD", x: 0.69, y: 0.19 }]` with coordinates between 0 and 1 measured from
the top left corner of the picture. Guess coordinates only if the source drawing makes them
obvious; otherwise leave `markers` out and place them by hand later. A marker may add
`"area": 0.15` — the fraction of the picture shown around the point when a reader opens it
(0.15 a connector, 0.3 an area of the board, 1 the whole picture); left out, it is 0.3.

When the point is a **test point** with a name printed on the board, put that name in
`connector` — `"TP12"`, `"TP-7"`. The picture then shows `TP12` on the marker instead of the
point number, so the drawing speaks the language of the board rather than of this document.

**`stageOrder`** (top level) — `"sequential"` or `"asDeclared"` (default).

**Use `"sequential"` unless the source says otherwise.** A legacy specification is written to be
carried out top to bottom, and that order is part of its meaning even when it is never spelled
out. With `"sequential"` each test stage takes the previous one as its prerequisite, so the
document keeps the sequence of the original; a stage that declares its own `prerequisites` keeps
those, and setup stages are left alone. Choose `"asDeclared"` only when the source really does
allow stages to run in any order, and then say so in the stage descriptions.

**`stages[]`**

```json
{
  "key": "STG_POWER",
  "kind": "test",
  "name": "Set-up and power-up",
  "description": "…",
  "prerequisites": ["OTHER_STAGE"],
  "parallel": { "mode": "none | all | list", "stages": ["OTHER_STAGE"] },
  "heldStimuli": [ { "step": "APPLY_SUPPLY", "note": "supply kept on" } ],
  "tests": [ { "key": "…", "name": "…", "purpose": "…", "steps": [ ] } ]
}
```

`kind` is `test` (default) or `setup`. `parallel.mode` is `none` (no restriction), `all` (nothing
may run alongside) or `list` (only the listed stages may not). Setup stages take neither
`prerequisites` nor `parallel`.

**`steps[]`**

```json
{
  "key": "APPLY_SUPPLY",
  "description": "Power the unit at the nominal test voltage.",
  "type": "stimulus | measurement | stimulusMeasurement | stageCall",
  "wait": { "value": "2", "unit": "s" },
  "note": "…",
  "callStage": "POWER_UP",
  "stimulus": {
    "description": "Apply the supply voltage",
    "points": ["VBAT", "GND"],
    "resource": "PSU",
    "command": null,
    "parameters": [ { "name": "Voltage", "value": "$Vbatt", "unit": "V" } ]
  },
  "measurement": {
    "description": "Supply current",
    "points": ["VBAT"],
    "resource": "PSU",
    "command": "READ_VBAT",
    "expected": { "min": "0", "max": "$IquiescentMax", "unit": "mA" }
  }
}
```

`type` can be left out: a step with both halves is a `stimulusMeasurement`, one with `callStage`
is a `stageCall`, and so on. `key` is needed only when `heldStimuli`, a computed measurement or
a `table` refers to the step.

`wait.value` is a value like any other: `"2"` is two units, `"$PilotSettle"` is the variable,
whose own unit then wins over `wait.unit`. A step may also point at a figure with
`"image": "FRONT"`: the picture is printed small beside the step and opened full size on a
click, and the appendix keeps the markers.

**`table`** — a step of `"type": "table"` runs the same reading for a list of combinations:
the columns say what is applied and what is read, the rows say the combinations.

```json
{
  "description": "Proximity pilot decoding, one row per cable.",
  "type": "table",
  "table": {
    "columns": [
      { "key": "RPP", "kind": "stimulus", "name": "PP resistor", "unit": "Ω", "points": ["PP", "PE"], "resource": "SIM" },
      { "key": "PP", "kind": "measurement", "name": "pp", "unit": "", "command": "GET_PP" },
      { "key": "ILIM", "kind": "measurement", "name": "ilimit", "unit": "A", "command": "GET_ILIMIT" }
    ],
    "rows": [
      { "label": "13 A cable", "cells": { "RPP": "1500", "PP": "13A", "ILIM": "= 13" } },
      { "label": "63 A cable", "cells": { "RPP": "100", "PP": "63A", "ILIM": "= $MaxCurrent" } },
      { "label": "no cable", "cells": { "RPP": "open", "PP": "none", "ILIM": "recorded" } }
    ]
  }
}
```

A column is a stimulus or a measurement block declared once — `points`, `resource` or
`command` as in a step — and shared by every row. A cell of a stimulus column is a value or
`"$Variable"`; a cell of a measurement column is a criterion written the compact way, in the
unit the column declares:

| written | read as |
|---|---|
| `12 ±0.5`, `12 +-0.5` | nominal 12, tolerance 0.5 |
| `12 ±5%` | nominal 12, tolerance 5 % |
| `< 0.8`, `<= 0.8`, `> 3`, `>= 3`, `= 13`, `!= 0` | one limit, that comparison |
| `10 … 14`, `10 .. 14`, `10 - 14` | between the two, both ends included |
| `$Vbat ±5%`, `= $Imax` | the variable, in a nominal or a limit |
| `recorded` | recorded, not judged |
| `yes`, `no`, `ok`, `true`, `false` | a boolean |
| anything else | the text the unit must answer, equal and case sensitive |

A cell may also be the `expected` object of an ordinary step — `"ILIM": { "min": "12", "max":
"14" }` — when the criterion needs more than the table above can say; and `cells` may be
written as a list, `[{ "column": "RPP", "value": "1500" }, { "column": "ILIM", "expected":
"= 13" }]`, when that reads better. The table prints as one table on the sheet and in the Word
file; a variant may change one cell; each column occupies the bench like a block; a command in
a column runs once per row for the cycle time. Two or three output columns and a handful of
rows is what a table is for — beyond that, keep one step per row (§5.4).

**Computed measurements** — a measurement worked out from earlier readings, not taken:

```json
{
  "key": "METER_ERR",
  "description": "Metering error against the reference.",
  "measurement": {
    "description": "Metering error",
    "computed": { "formula": "(meter − reference) / reference × 100", "inputs": ["REF_PWR", "METER_PWR"] },
    "expected": { "nominal": "0", "tolerance": "$MeterAcc", "unit": "%" }
  }
}
```

`inputs` are keys of earlier steps of the same test that read something (a measurement or a
table). The measurement names no `points`, no `resource`, no `command`: it touches nothing. The
formula is printed as written; the tool does not evaluate it.

**Prefer `stimulusMeasurement`.** A test step normally does one thing and checks its effect —
apply a voltage and read the current, send a command and read the answer, press a button and
verify the state. Write that as **one** step with both halves: the operator sees the action and
its acceptance criterion side by side, and the document says plainly what caused what. Keep a
lone `stimulus` for an action with nothing to verify (typically inside a setup stage), and a lone
`measurement` for a reading taken with no action of its own (the unit is already in the state the
previous step left it in).

**Values**: a plain string is a constant; a string starting with `$` refers to a variable by key
or name (`"$Vbatt"`). Units always go in `unit`, never inside the value.

**`expected`** — either limits or a nominal value:
- `{ "min": "11", "max": "14", "unit": "V" }` — one of the two may be left out;
- `{ "text": "LCU200 v1.4.0", "stringComparison": "EQ", "caseSensitive": true }` — a text
  answer; `stringComparison` is `EQ`, `NE`, `CONTAINS`, `STARTS` or `ENDS`. Write
  `{ "pattern": "^LCU200 v\\d+$" }` instead when the source states a format rather than a value.
  Both `text` and `pattern` take a value, so `"$FwPattern"` binds the criterion to a variable;
- `{ "boolean": true }` — a yes/no, when the source only says the condition must hold;
- `{ "comparison": "LT", "limit": "0.5", "unit": "V" }` — an explicit comparison type, the set
  TestStand uses:
  - one limit, given as `limit` or in the matching `min`/`max`: `EQ`, `NE`, `GT`, `GE`, `LT`, `LE`;
  - two limits, given as `min` (Low) and `max` (High): `GELE`, `GTLT`, `GELT`, `GTLE` (pass
    between them) and `LTGT`, `LEGE`, `LEGT`, `LTGE` (pass outside them);
  - `EQT` for nominal with tolerance, which is `nominal` + `tolerance` above;
  - `NONE` when the source records a value without judging it.

  Leave `comparison` out when the source does not say: limits alone mean «between them,
  inclusive», or «at least»/«at most» when only one is given;
- `{ "nominal": "$Vbatt", "tolerance": "5", "toleranceType": "percent", "unit": "V" }`,
  `toleranceType` being `absolute` (default) or `percent`.

**`variants[]`** — `key`, `name`, `description`, plus the two cases that cover most documents:
`excludeStages: ["MECH"]` (stages that do not apply to the variant) and
`variableValues: { "Vbatt": "27" }` (values that differ). For a variable of type `range` give
both ends — `"Temp": { "min": "40", "max": "60" }` — since one bare value sets the minimum
only, and the import says so. Anything finer is done in the tool afterwards, by picking the
variant in the top bar and editing.

**`conversion`** — what the conversion is, and what it could not carry:

```json
"conversion": {
  "source": "SPC-TEST-0042 Rev. 07, PDF of 32 pages",
  "leftOut": [
    { "where": "§ 4.2, Figure 3", "what": "the oscilloscope screenshot the pole-zero check compares against", "why": "a picture; declared as image FIG_PZ, to be uploaded" },
    { "where": "§ 9, bus timing", "what": "the G96 bus timing diagrams and their set-up/hold checks", "why": "timing diagrams do not fit a step; the chapter needs a person" }
  ],
  "notes": "Chapters 1–6 converted in this pass; chapters 7–9 in the next."
}
```

`source` names the document converted, with its revision and form. `leftOut` lists, one entry
each, everything the source contains that the JSON does not (§5.5 says what must go there);
`where` is the place in the source, `what` the content, `why` the reason. `notes` is free text
for whatever else the reader of the converted document should know.

None of it goes into the document. The document keeps what is signed; what the conversion has
to say about it goes to the **notes** — the coloured marks in the right margin of the sheet,
kept outside the specification in a file of their own (see the editing guide, §7a). Each
`leftOut` entry becomes a «left out» note at the top of the test description, named after its
`where`; `notes` becomes a plain note there; `source` becomes the reason of the draft's revision
record when the file gives none. The import report says how many notes came and offers their
file. Write the block even when `leftOut` is empty: it says the conversion was checked, not
that the question was forgotten.

The same rule lifts the marked lines out of the free-text fields: a line of a step `note`, a
test `purpose`, a stage `description`, or the `notes`/`description` of a variable, a command, a
protocol, an interface, a resource, a point or a reference that **starts with** `TO CHECK:` or
`CONDITION:` leaves the field and becomes a note of that kind, anchored to the element. Put
each on its own line. `TIMING:` lines stay where they are: a timing is a requirement of the
test. A marker in the middle of a sentence is left alone.

---

## 5. Reading a legacy specification

### 5.1 What becomes what

| In the source | In the JSON |
|---|---|
| "Apply 13.5 V to J1.1 / J1.2" | a step with `stimulus`, `points: ["VBAT","GND"]`, a `Voltage` parameter |
| "Check that the current stays below 45 mA" | a `measurement` with `expected.max` |
| "Measure 13.5 V ± 5 % on J2.5" | `expected.nominal` + `tolerance` + `toleranceType: "percent"` |
| "Wait 2 s" attached to an action | `wait` on that step, not a step of its own |
| "Send command 0x22 F1 90" | a `command`, referenced from the step |
| "Repeat the power-up procedure" | a **setup stage**, called by a `stageCall` step |
| "This test requires test 3 to be complete" | `prerequisites` |
| "Cannot be executed together with the vibration test" | `parallel: { mode: "list", stages: [...] }` |
| "Leave the unit powered" at the end of a block | `heldStimuli` |
| A table of instruments | `resources` |
| A drawing with numbered test points | `images` + `points` |
| "For the 24 V version, use 27 V" | a `variant` with `variableValues` |

### 5.2 Rules that matter

**One step, one action.** If a paragraph applies a stimulus and checks three different things,
that is one step with a stimulus and three steps of measurement — or one step per measured
quantity. Never pack two acceptance criteria into one step: each measurement has exactly one.

**Tell apart what is applied and what is read.** Verbs that change the state of the unit
(*apply, set, send, press, connect, disconnect*) belong to `stimulus`. Verbs that observe it
(*measure, check, verify, read, confirm*) belong to `measurement`. When one sentence does both,
split it into the two halves of the same step.

**Make a variable when a value repeats or varies.** A number that appears in more than one step,
or that the source says changes with the product version, becomes a variable and every use
becomes `$Name`. A number that appears once and never changes stays a constant.

**Look for the routines.** Legacy specifications repeat "power the unit up", "power it down",
"load the test configuration" in every chapter. Each of those is one **setup stage**, called from
where it is used. This is usually the single biggest simplification of the conversion, and it is
what makes the resource count come out right.

**Order and prerequisites.** Keep the steps in the order of the source, and set
`"stageOrder": "sequential"` so the stages keep theirs. Explicit prerequisites still come from
sentences like "after completing…", "with the unit already powered", from the numbering of the
chapters, or from the fact that a stage measures something a previous stage set up: write those
on the stage, and they override the sequence.

**Units.** Copy them as they are, in `unit`. Do not convert mA to A, do not normalise decimal
separators beyond turning a decimal comma into a dot when the value is a number.

**Notes.** Anything the source says that does not fit a field — cautions, references to another
document, operator instructions — goes into the step `note` or the entity `notes`.

**Uncertainty.** Where the source is ambiguous or silent, leave the field empty and write a line
starting with `TO CHECK:` in the `note` or `notes` of the element, on its own line. The import
lifts it out of the document and into the margin as a «to check» note, where the reader finds
it beside the element and the count at the bottom of the window says how many are left. A
specification with twenty honest gaps is useful; one with twenty invented numbers is dangerous.

### 5.3 What not to do

- Do not invent limits, tolerances, connectors, pins or instruments.
- Do not merge two measurements into one because they look similar.
- Do not translate or rewrite the descriptions: keep the source wording and language.
- Do not put a unit inside a value (`"13.5 V"` is wrong, `value: "13.5"` + `unit: "V"` is right).
- Do not create a variable for a value used once.
- Do not use a `stageCall` to point at a test stage: only setup stages are called.
- Do not output anything but the JSON object.

### 5.4 Special cases, and where each one goes

Real specifications keep producing the same handful of things the format has no obvious slot
for. Each has a place; none is a reason to invent a field or to drop the content silently.

**Many signatories.** The header takes a list: one entry per person, with the role the source
gives — `"signatories": [{ "role": "Issued by (HW)", "name": "F. Pulcino" }, { "role":
"Verified by (Quality)", "name": "M. Neri" }, …]`. Nobody is dropped and nobody shares a box;
the cover prints four per table and as many tables as it takes.

**Part numbers and product codes.** Several codes for the same unit (the maker's, the
customer's, the platform's) go in `header.product` after the name, or in `description.product`
when there are many with their meaning. Codes that differ *per variant* go in the variant's
`description`.

**Repeated routines and preconditions.** «Power the unit», «start the network», «send these
frames every 100 ms for the whole test» — a `setup` stage, called where it is used, with
`heldStimuli` for whatever must stay applied. A block of periodic messages that every test case
requires is one setup stage with the frames as held stimuli, not a paragraph repeated in every
test.

**Tests written as a matrix** (rows of input combinations, columns of outputs). When the same
few readings are taken for each row — a resistor applied, a code and a current limit read, five
cables — write one **table step** (§4.4): the columns declare the inputs and the outputs once,
each row is one combination with its criteria in the compact notation. Beyond three or four
output columns, or when the rows differ in what they read, keep one step per row and write the
row's expected pattern as a **text criterion** exactly as the table prints it — `"expected":
{ "text": "+ - - + - -" }` — with the column legend (which output is which, what `+` and `-`
mean) in the test `purpose`. Either way the table stays readable and nothing is lost.

**Criteria computed from several readings** (a gain from sixteen peaks, a linearity, a
calibration byte from a frequency). Each reading is a measurement with `"comparison": "NONE"` —
recorded, not judged — and a `key`. The result is one more measurement step whose measurement
is `computed` (§4.4): the formula in the source's words, the keys of the readings as `inputs`,
the source's criterion as `expected`, and no `resource`, `points` or `command`. The bench
computes; the document says from what.

**Instructions that refer to a picture** — «the signal must look like the figure», «connect as
in the layout», a connector drawing. Declare the figure in `images[]` with the source's own
caption (`"name": "Figure 3 — filter output"`), so it is uploaded after the import and printed
in the appendix, point the step at it with `"image": "FIG3"` so it prints small beside the
step, and write the criterion as `{ "boolean": true }`. A drawing that carries pin numbers is
also a source of `points`: read what is legible, and list the rest in `leftOut`.

**Timing between steps** — «wait 2 s» is a `wait` on the step it follows, and a wait the
source gives as a parameter («Ton», «the settling time») is `"wait": { "value": "$Ton" }`;
«at most 2 s between steps 4 and 10», «the reply within 3.5 s» is a `note` on the last step
concerned, starting with `TIMING:` — it stays in the document, being a requirement.
**Conditions** — «only at the first power-on after flashing», «optional», «skipped at plant X»,
«only for SW 7.4» — are a line starting with `CONDITION:` in the step `note`, which the import
turns into a «condition» note in the margin; when the condition is a version of the product or
a plant, it is a `variant` instead, and the step is excluded there.

**Commands defined in another document** (a CAN matrix, a protocol spec, a register map).
Create the command anyway: `name` and `address` from the source, `requestFormat` and
`responseFormat` empty, and `"reference": "<key of the reference>"` — adding the document to
`references[]`. The appendix prints «Defined in REF-nn», and the validation lists such commands
as information rather than as a fault. A step must be able to name the command; the formats are
filled in later from the other document, or never, when the reference is enough. When the
source says how the answer is read — «hex to unsigned, minus 3072, divided by 51.15, in mA» —
that is the command's `decoding`, and the criteria over it may then leave their `unit` out.

**An estimated duration on a test** («tempo stimato 1 s», «must not exceed 5 minutes»). There is
no duration field on a test: write it at the end of the test `purpose`, in brackets, in the
source's words. A limit on the whole sequence goes in `description.testing`; the cycle time
estimate of the tool is what it is checked against.

**Several products in one document** — two boards, a board and its display, three assemblies.
One document holds one product. When the products share most of the sequence and differ by
what is skipped or by values (test modes, hardware options, a plant), they are one document with
`variants`. When each has its own sequence, they are one file each, and each file's
`conversion.notes` says which part of the source it covers.

**Requirements for the bench itself** — its software, its HMI, the log file, the report, the
self-test, how failures are handled. They are not steps: a short version goes in
`description.testing`, the rest in `leftOut`.

**Tables of what may run together.** The format declares what may *not*: for every stage the
table allows alongside others, list in `parallel.stages` the stages the table does not allow.

### 5.5 Limits: when to stop, and how to say what stayed out

Fidelity falls with size. These limits are where a conversion stops approximating and starts
declaring:

- **One pass, one chapter or phase, at most about 60 steps.** A longer source is converted in
  passes, one per phase (ICT, then FCT, then FMT; or one chapter at a time), and the arrays
  are merged at the end. A pass never summarises the chapters it did not reach: it names them
  in `conversion.notes` as not yet converted.
- **A source with no checkable outcome** — a paragraph that describes a test without saying what
  passes — becomes a step with `"expected": { "boolean": true }` and a `TO CHECK:` note, never
  a limit made up to fill the field.
- **A criterion that needs more than one formula, or a formula the source does not state**, is
  not computed for it: the readings are recorded (`"comparison": "NONE"`) and the criterion is
  a `TO CHECK:`.
- **A drawing that must be read** (pinouts, waveforms, layouts, timing diagrams) is declared as
  an image and listed in `leftOut` with what it holds; it is not transcribed from guesswork.
- **Meaning carried by colour or typeface alone** — a deleted test shown in red, a menu-settable
  value in italics — is kept only when the rendered page was given; from extracted text it is
  listed in `leftOut` as unreadable, and the entry says the source uses colour.
- **More than about 20 % of the stages differing between two products** means two files, not
  one with variants.

Every item that hits a limit goes in `conversion.leftOut`, with its place in the source. That is
the rule that keeps the converted document coherent: what it contains is faithful, and what it
does not contain is written where its reader will look — the import report, and the margin of
the test description, as «left out» notes that travel with the document without being part of
it.

---

## 6. Worked example

A complete, minimal specification: one setup stage, one test stage that calls it, one variant,
and the conversion block that says what stayed out.
The file `docs/example-spec.json` holds the same content, ready to import.

```json
{
  "format": "tsw-authoring/1",
  "stageOrder": "sequential",
  "settings": { "noDirectEditing": false },
  "header": {
    "title": "End of line test specification",
    "company": "Acme Electronics Ltd.",
    "product": "LCU-200 lighting control unit",
    "documentCode": "SPC-TEST-0042",
    "disclaimer": "text printed in a box at the foot of the cover, when the source has one",
    "confidentiality": "Confidential – internal use",
    "signatories": [ { "role": "Prepared by", "name": "M. Rossi" }, { "role": "Verified by", "name": "P. Bianchi" }, { "role": "Approved by", "name": "L. Verdi" } ],
    "revision": { "number": "00", "date": "2026-05-12", "author": "M. Rossi", "reason": "Converted from SPC-TEST-0042 Rev. 07 (PDF)" }
  },
  "description": {
    "product": "The LCU-200 drives the exterior lighting of the vehicle.",
    "testing": "End of line test: supply, communication and power outputs.\n\nEvery measurement is taken at room temperature."
  },
  "references": [
    { "key": "HW", "code": "SPC-HW-0021", "title": "LCU-200 hardware specification", "revision": "Rev. 04" }
  ],
  "variables": [
    { "key": "VBATT", "name": "Vbatt", "type": "number", "unit": "V", "value": "13.5", "description": "Nominal supply voltage used for testing." },
    { "key": "IQMAX", "name": "IquiescentMax", "type": "number", "unit": "mA", "value": "45", "description": "Highest current allowed at rest." }
  ],
  "resources": [
    { "key": "PSU", "name": "Programmable DC power supply", "category": "Power",
      "characteristics": [ { "name": "Voltage", "value": "0 … 32", "unit": "V" }, { "name": "Current", "value": "0 … 10", "unit": "A" } ] },
    { "key": "CANIF", "name": "Bench CAN interface", "category": "Communication",
      "characteristics": [ { "name": "Channels", "value": "2" } ] }
  ],
  "interfaces": [
    { "key": "CAN", "name": "Vehicle CAN bus", "type": "CAN 2.0B",
      "parameters": [ { "name": "Bit rate", "value": "500", "unit": "kbit/s" }, { "name": "Termination", "value": "120", "unit": "Ω" } ] }
  ],
  "commands": [
    { "key": "READ_VBAT", "name": "Read supply voltage", "interface": "CAN", "address": "0x22 0xF1 0x90",
      "requestFormat": "22 F1 90", "responseFormat": "62 F1 90 <uint16>", "encoding": "uint16, LSB = 10 mV",
      "reference": "HW", "decoding": { "formula": "uint16 × 10", "unit": "mV" } }
  ],
  "images": [ { "key": "BOARD", "name": "LCU-200 board — component side", "caption": "Contact points on the bench." } ],
  "points": [
    { "key": "VBAT", "name": "Battery positive", "connector": "J1", "pin": "1", "signal": "VBAT", "contactType": "Ø 2 mm spring probe",
      "characteristics": [ { "name": "Max current", "value": "10", "unit": "A" } ],
      "markers": [ { "image": "BOARD", "x": 0.69, "y": 0.19 } ] },
    { "key": "GND", "name": "Ground", "connector": "J1", "pin": "2", "signal": "GND", "contactType": "Ø 2 mm spring probe" },
    { "key": "CANBUS", "name": "CAN bus (CANH/CANL)", "connector": "J1", "pin": "5 / 6", "signal": "CANH / CANL" }
  ],
  "stages": [
    {
      "key": "POWER_UP", "kind": "setup", "name": "Power up",
      "description": "Bring the unit to its nominal supply voltage and leave it powered.",
      "heldStimuli": [ { "step": "APPLY_SUPPLY", "note": "the unit stays powered for whoever called this stage" } ],
      "tests": [ {
        "name": "Supply", "purpose": "Apply the supply and let the unit start.",
        "steps": [ {
          "key": "APPLY_SUPPLY",
          "description": "Power the unit at the nominal test voltage.",
          "wait": { "value": "2", "unit": "s" },
          "stimulus": {
            "description": "Apply the supply voltage",
            "points": ["VBAT", "GND"], "resource": "PSU",
            "parameters": [ { "name": "Voltage", "value": "$Vbatt", "unit": "V" }, { "name": "Current limit", "value": "5", "unit": "A" } ]
          }
        } ]
      } ]
    },
    {
      "key": "STG_POWER", "kind": "test", "name": "Set-up and power-up",
      "description": "Power the unit up and check the quiescent current.",
      "tests": [ {
        "name": "Supply and current draw", "purpose": "Check the unit powers up within the quiescent current limit.",
        "steps": [
          { "description": "Power the unit up.", "callStage": "POWER_UP" },
          { "description": "Measure the current drawn at rest.",
            "measurement": {
              "description": "Supply current", "points": ["VBAT"], "resource": "PSU",
              "expected": { "min": "0", "max": "$IquiescentMax", "unit": "mA" }
            } },
          { "description": "Ask the unit for its supply voltage and check the answer.",
            "type": "stimulusMeasurement",
            "note": "TO CHECK: the source does not give a tolerance for this reading.",
            "stimulus": {
              "description": "Send the read request", "points": ["CANBUS"], "resource": "CANIF", "command": "READ_VBAT"
            },
            "measurement": {
              "description": "Supply voltage reported by the unit", "points": ["CANBUS"], "resource": "CANIF", "command": "READ_VBAT",
              "expected": { "nominal": "$Vbatt", "tolerance": "5", "toleranceType": "percent", "unit": "V" }
            } },
          { "description": "Read the supply voltage at three supply levels.",
            "type": "table",
            "wait": { "value": "1", "unit": "s" },
            "table": {
              "columns": [
                { "key": "VSUP", "kind": "stimulus", "name": "Supply", "unit": "V", "points": ["VBAT", "GND"], "resource": "PSU" },
                { "key": "VREAD", "kind": "measurement", "name": "Reported voltage", "unit": "V", "command": "READ_VBAT" }
              ],
              "rows": [
                { "label": "low", "cells": { "VSUP": "9", "VREAD": "9 ±5%" } },
                { "label": "nominal", "cells": { "VSUP": "$Vbatt", "VREAD": "$Vbatt ±5%" } },
                { "label": "high", "cells": { "VSUP": "16", "VREAD": "16 ±5%" } }
              ]
            } }
        ]
      } ]
    }
  ],
  "variants": [
    { "key": "V12", "name": "LCU-200 12 V", "description": "Base version." },
    { "key": "V24", "name": "LCU-200 24 V", "description": "Commercial vehicles.", "variableValues": { "Vbatt": "27", "IquiescentMax": "30" } }
  ],
  "conversion": {
    "source": "SPC-TEST-0042 Rev. 07 (PDF, 12 pages)",
    "leftOut": [
      { "where": "§ 3, Figure 1", "what": "the drawing of the bench with the probe positions", "why": "a picture; declared as image BOARD, to be uploaded and marked by hand" }
    ]
  }
}
```

---

## 7. Before importing, and after

**Check before importing** — every `key` used in a reference exists; no two entities share a key;
each `measurement` has an `expected` or a `TO CHECK:` line; an action and the check that follows
it are one `stimulusMeasurement` step, not two; `stageOrder` is set; every repeated routine is a
setup stage and is called; units are in `unit`; nothing was invented; every `TO CHECK:` and
`CONDITION:` is on a line of its own; the `conversion` block is there, and everything the
source has that the JSON does not is in its `leftOut`.

**After importing** — the tool tells you what it could not resolve, and how many notes came
with the conversion. Then:

1. **Images**: upload the pictures — any common format; they are re-encoded as WebP and resized
   automatically — then open **Application points** and place the markers.
2. **Validation**: work through the panel. Warnings about missing acceptance criteria and points
   not marked on any image are the normal residue of a conversion.
3. **The notes in the margin**: the count at the bottom says «Notes 18 · 13 to check» and opens
   them by kind. Settle each «to check» against the source and delete the note, or turn it into
   a value; read each «condition»; read the «left out» notes at the top of the test description
   and decide, item by item, whether the item stays out or is brought in by hand. `TIMING:`
   lines are still in the step notes, being requirements.
4. **Validate** (✔) with a reason such as "Converted from <source> Rev. <n>", and **Save** (💾):
   the notes file goes with it, named like the specification with `.json`.

The imported file is a normal specification from that moment on: it prints, it compares versions,
it carries its variants.
