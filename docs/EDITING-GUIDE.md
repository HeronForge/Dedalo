# Writing a specification by hand — DEDALO

For whoever opens the empty DEDALO file and starts filling it in. It is short on theory and long on
examples; the two parts that repay a careful read are **Variants** and **Revisions**, because
they are the ones people get wrong.

DEDALO opens on the **document**: that is the specification as it will be printed. Every
printed page carries its mark at the right end of the header, and the cover ends with
«Powered by DEDALO», small, in the corner a colophon takes. The
**☰ Sections** button at the top left opens the panel you write from; the 📌 inside it keeps the
panel open while you work. In the command bar, **💾** saves (`Ctrl+S`), **✔** validates the
draft, ↶ ↷ undo and redo, and everything that is not written by hand — opening, printing,
exporting, importing, the notes — is under **File ▾**. The bar at the bottom says whether the
file is saved, counts the problems validation finds (a red plate when there are errors, sand for
warnings; a click opens the panel), the weight of the images, the notes, and what the recovery
copy is doing.

**The trail.** Under the command bar, one line says where you are: the group, the section, and
the element open in it — `Testing › Stages, tests and steps › STG-02 Power up › T-02.01 Supply ›
T-02.01.03`. It follows what you do, including the name you are typing, and every step of it
leads back to what it names. Rest the pointer on a step and the list of what else stands at that
level drops down — the other groups, the other sections, the other stages, the other tests — and
an entry marked › opens what it contains, a level further down, as far as the steps; picking
anything goes there. In the document view the trail follows the **reading** instead: it names the
chapter, the stage and the test at the top of the window, each a way back up, and its entries
open the same way. At its right end sit **Collapse all** / **Expand all** for the chapters.

**The rail.** Beside the scrollbar, a column of small buttons stays put while the content moves.
In every editor section it holds **📄**, the way back to the document at the paragraph you left.
In the document view it holds the book, which turns **Read** on and off, **📝**, which adds a note
(see §7a), **🖨**, which opens the paginated preview to print or save as PDF, and
**ⓘ**, whose card explains every mark on the page — codes, dotted values, blue text, the
coloured tags, the plates under a criterion — drawn exactly as the page draws them.

**Read** puts the interface away and leaves the sheet alone, on the left of the window, with
zoom and full screen on a strip that appears when the pointer moves or the page scrolls; the
trail becomes a plate at the top left that appears and fades with it; Esc comes back, and so
does the rail's ✕. In the grey field at the right of the sheet stand the **contents**: every
chapter and appendix, the one under the eye lit and the stages it holds listed under it. The
column is faint until the pointer rests on it, and a click on any line goes there; its 📌
unpins it, and unpinned it withdraws to the edge of the window and slides out under the
pointer. Going into
Read and back, zooming, or returning from the editor keeps the same line under the top of the
window. A file that is the last issued revision word for word —
the file as it is handed out after validating — opens straight in Read, and in Read nothing
leads into the editor: the codes still open their cards, the way into the editor is gone until
Esc.

**Cards.** Rest the pointer on a code — a point, a command, a resource, an interface, an image,
a test, a step — and its card appears where it stands; the click opens it on the side, or leads
into the editor for the entities that live there. Not on the code of the row you are reading,
where the card would only repeat the row. Text in electric blue is what changes from one variant
to the next: the pointer shows, and the click opens, the value it takes in the base document and
in every variant (see §7).

---

## 1. The order that saves time

Fill things in in this order and you will never have to stop to define something you need.

1. **Header** — company, product, document code. Two minutes, and every printed page gets its
   identification.
2. **Global variables** — the values that repeat or that change between variants.
3. **Test resources** — the instruments the bench must have.
4. **Interfaces and commands** — only if the unit is driven through a bus.
5. **Images**, then **application points** — the physical places the bench touches, marked on
   the pictures.
6. **Stages, tests and steps** — the specification proper.
7. **Variants**, if the product has more than one version.
8. **Validation** (the count in the status bar opens it), then **Validate** (✔), then **Save** (💾).

Steps 2 to 5 are catalogues: the steps refer to them by code (`$Vbatt`, `RES-01`, `AP-03`,
`CMD-02`), so having them ready first means never interrupting the flow of writing a test.

---

## 1b. Duplicating instead of retyping

Every list in the editor carries a **⧉** next to the arrows, and so does every row of a nested
list — a parameter, a characteristic, a held stimulus. It duplicates the element with everything
inside it and drops the copy right after the original, named «… (copy)» so you can tell the two
apart before you rename them.

Duplicating a stage brings its tests and its steps along. What the copy points at *outside*
itself is kept — the instrument, the application points, the stages that must run first, the
commands — because those still exist and are still the right ones. What it pointed at *inside*
itself follows the copy: a stimulus held on exit names the step of the new stage, not the step of
the one you copied from.

The codes are not copied: they are read from the position in the document, so the duplicate gets
the next one as soon as it lands.

---

## 2. The header

| Field | Example | Where it shows |
|---|---|---|
| Title | `End of line test specification` | cover, running header, tab title |
| Document code | `SPC-TEST-0042` | cover, footer of every page, file name |
| Product | `LCU-200 lighting control unit` | cover, running header |
| Confidentiality | `Confidential – internal use` | footer of every page |
| Logo | any image | cover, and beside the text in the running header, where it is scaled to the two lines already there |
| Disclaimer | ownership, distribution limits | boxed at the foot of the cover, left out when empty |
| No direct editing | tick box | stops the codes in the document from leading into the editor |
| Signatories | `Prepared by · M. Rossi` | signature tables on the cover |

**Signatories** is a list: a role and a name per line, as many as the process asks for. The
cover prints them in the order listed, four to a table with a signature line under each, and
a second table when there are more than four. A new document starts with *Prepared by*,
*Verified by*, *Approved by*; a file written before this opens with the three people it had,
in the same order. A document with no name in any line is reported as an incomplete header.

The **revision** fields underneath (number, date, author, reason) describe the draft you are
working on now — see §8.

---

**Following a code.** In the document view every code is a link, and there are two kinds.

- **A code cited inside a step** — `AP-03`, `RES-02`, `CMD-01`, a stage, a value bound to a
  variable — opens a **detail card** on the right: you read what it means without losing your
  place. These always work.
- **A code where the document defines it** — the row of an appendix, the heading of a stage or
  of a test, the step code in the first column, the line of a variable — takes you **straight to
  the editor**, with that entity selected. There is nothing to pop up: the full detail is already
  on the page, and editing is the only thing left to do with it. Images, interfaces, tests and
  steps lead into the editor from wherever they are cited, too — but a pointer resting on any
  code, those included, shows its card where it stands.

The **📄** button beside the scrollbar — there in every editor section, in the place the
reading button has in the document view — is the way back: it returns to the document at the
paragraph you left, so following a code and coming back costs two clicks and no searching.

Tick **No direct editing** in the header when the file goes out to be read rather than worked
on: the links into the editor become plain text, and the detail cards go on working.

**Chapters and appendices.** The same section lists the chapters of the printed document and
the appendices, in the order they print, with ↑ ↓ to move each among its own kind — a chapter
stays a chapter, an appendix an appendix, and the numbers and letters follow the order. A
chapter with nothing in it — no external reference, no variant, an empty glossary — is marked
*empty, not printed* and left out of the document and of the contents, so a page that says
«none» is never printed. Two appendices, the commands and the stage graph, turn the page:
they print in landscape, on the sheet, in the PDF and in the Word file, because ten columns
and a wide graph do not fit a portrait page.

## 2a. The glossary

A specification is read by people who did not write it, and «check the CP after the RCM
trips» is a sentence only for whoever already knows the product. **Glossary**, in the Document
group, is one line per term — the term as the text writes it, and what it stands for — and
prints as a chapter of its own, in alphabetical order, whatever order the lines were typed in.
Above the list the editor shows the acronyms the prose of the document uses and the glossary
does not explain — words of two to six capitals, part numbers and pins left aside — one press
each to add it. Words in capitals that are not acronyms, «OK», a shouted heading, are simply
left alone. A line without a meaning, or a term explained twice, is a warning.

## 3. Variables: one value, one place

Make a variable when a value **repeats** or **changes between variants**. Leave a number where it
is when it appears once and never moves.

```
Vbatt           number   13.5 V    Nominal supply voltage used for testing
IquiescentMax   number   45 mA     Highest current allowed at rest
Protocol        enum     CAN       CAN | LIN
AmbientTemp     range    15 … 30 °C
```

In a step, a value can be a constant or a variable: the `#` / `$` selector next to the field
switches between the two. Referring to `$Vbatt` in fourteen steps means one edit when the
voltage changes, and it is what lets a variant say «here it is 27 V» without touching a step.

The **wait** of a step is a value like the others: `2` with the unit `s`, or `$PilotSettle`,
which prints as `WAIT 500 ms (PilotSettle)` and takes the variable's unit over the one in the
field. A settling time the whole document shares is one variable, and a variant that needs a
longer one changes it once.

---

## 4. Resources, commands, points

**Resource** — what the bench must be able to do, not the model you happen to own. Its
characteristics double as the parameter names offered while writing a step that uses it:

> ✅ `Programmable DC power supply` · Power · Voltage 0 … 32 V · Current 0 … 10 A
> ❌ `Keysight E3631A` (put that in Notes if it matters)

**Application point** — one per physical contact. If the board has a test point with a name
printed on it, put that name in **Connector** (`TP12`): the picture will then show `TP12` on the
marker instead of the point number.

> `AP-01` Battery positive · J1 pin 1 · VBAT · Ø 2 mm spring probe
> Characteristics: Max current 10 A · Contact force 2.5 N · Contact resistance < 20 mΩ

Upload the picture under **Images** — any common format, stored as WebP and resized to 1600 px
on the long side, so a photograph off a phone costs tens of kilobytes rather than megabytes.
SVG drawings are kept as they are. **Optimise**, in that section, re-encodes the pictures of a
document written before this. Then open the point, press **+ Place marker** and click
where it is. Drag to adjust. The same point can be marked on several pictures.

Each marker also carries a **zoom area** — how much of the picture is worth showing around it:
15 % for a connector, 30 % for an area of the board, 100 % for the whole picture. That is what
the reader gets when the point is opened in the document: the crop first, then the whole picture
with the area outlined. In the appendix every picture opens full size, with pan and zoom; the
picture scales, the markers keep their size.

**Protocol** — the grammar the messages obey: what a request looks like, what an answer looks
like, what has to be respected for either to be understood. A CAN line carries application
frames and UDS alike, and a command that does not say which one it speaks cannot be built.
Describe each protocol once; the commands point at it, and the document gives it a chapter.

**Interface** — say which instrument speaks it under **Driven by**, and where the bus touches
the unit under **Connected at**. Every command over that interface then implies its instrument:
a step that sends a command does not have to name one, and the resource table and the cycle
time count it all the same. A step may still name an instrument of its own — a multimeter that
reads while the bus commands — and then both are counted. A step that talks
over a command on that interface then needs those contacts too, and the bench count says so
without anyone repeating them on every step.

**Command** — the short name is what appears in the step; the addresses live in the appendix:

> `CMD-01` Read supply voltage · Vehicle CAN bus · `0x22 0xF1 0x90`
> Request `22 F1 90` · Response `62 F1 90 <uint16>` · Encoding `uint16, LSB = 10 mV`
> Negative response `7F 22 31 — request out of range` · Nominal time `0.2 s`

The **negative response** is what the unit answers when it refuses: without it, a refusal and a
silence look the same on the bench. The **nominal time** is what the exchange usually costs,
and feeds the cycle time estimate.

**Defined in.** A command specified in another document — a CAN matrix, a register map, an
interface control document — names it under **Defined in**, picked among the external
references: the appendix prints «Defined in REF-05», and a command that carries a reference
and no request or response format of its own is listed by the validation as information, not
as a fault — the reader knows which other document to take to the bench. A protocol may name
its reference the same way.

**Decoding.** How the raw answer becomes the value a step judges, written for a person —
`hex → U32, − 3072, ÷ 51.15` — and the **decoded unit** it comes out in. The appendix prints
it under the encoding, and a criterion over that command that states no unit of its own is
read in the decoded unit: `120 ± 5` over a command decoded in mA prints as `120 mA ± 5 mA`.

---

## 5. Stages: the sequence and the routines

Two kinds, and picking the right one is the single most useful decision in the document.

**Test stage (`STG-xx`)** — a block of the sequence. It runs once, after its prerequisites.
Say what must come first («Deve essere preceduto da») and what may not run alongside it.

**Setup stage (`SET-xx`)** — a routine with no place of its own: it runs where a step calls it,
as many times as it is called. *Power up*, *power down*, *load the configuration*, *connect the
load bank*.

> Writing «apply the supply voltage» at the top of six stages is the sign you want a setup
> stage: write it once as `SET-01 Power up`, and let the six stages call it.

A stage can declare which of its stimuli stay applied when it ends — **held on exit**. A power-up
routine leaves the supply on, and the document (and the count of bench channels) needs to know.

---

## 6. Steps: what you apply, what you read

A step has a plain description and up to two halves:

- **Stimulus** — what is *applied to* the unit: a voltage, a force, a command.
- **Measurement** — what is *read back from* it, with its acceptance criterion.

**A command is a different act.** When a half of the step names a communication command it
prints **SET** (written to the unit) or **GET** (read from it), in its own colour, instead of
APPLY or MEASURE. It then states no instrument and no application point: both belong to the
interface the command speaks over, declared once there. The editor shows what that interface
brings — instrument, contacts — with a button to open it, and the parameters become the
**arguments of the command**, printed in the command colour.

Prefer a single step carrying both: the operator sees the action and its criterion together.

> **Description** Switch the low beam on over the bus and check the output voltage
> **Stimulus** Send the switch-on command · `RES-03 Bench CAN interface` · Requested state 01
> · `CMD-02 Switch low beam on` `@ AP-05 CAN bus`
> **Wait** 200 ms
> **Measurement** Voltage on the power output · `RES-02 6½ digit multimeter`
> `@ AP-03 Left low beam output` — acceptance `$Vbatt ± 5 %`

Each line reads in the order the work happens: what is done, the instrument and the command
that do it, then the place, after an **@** on a pale blue ground. What is said to the software —
the command and its arguments — is set in the software's font, a monospace, so a line that
mixes a probe and a message tells the two apart before it is read. The wait sits between the
stimulus and the measurement, and the acceptance criterion has its own column in the table.

Under the fields, **In the document** shows the row exactly as it will be printed, and follows
what you type: if it reads awkwardly there, it will read awkwardly at the bench.

The acceptance criterion comes in two shapes:

| Shape | Fill in | Reads as |
|---|---|---|
| Limits | Type `GELE`, Low `0`, High `$IquiescentMax`, unit `mA` | `0 mA … 45 mA (IquiescentMax)` |
| Nominal | Type `EQT`, Nominal `$Vbatt`, Tolerance `5`, Percent | `13.5 V (Vbatt) ± 5 %` |

**How it is judged.** A measurement is not always a number. **Evaluated as** picks one of
three, and the document marks each with a badge so they are never read as the same thing:

| Evaluated as | Plate | Fill in | Prints |
|---|---|---|---|
| Numeric | `123` | a comparison type and its limits | `11 V … 14 V` |
| Text | `Abc` | a comparison and the expected text | `= "LCU200 v1.4.0"` |
| Text, as a pattern | `RegEx` | a regular expression | `/^v\d+$/` |
| Yes / no | `DGT` | which answer passes | `TRUE` |

The plate is grey and sits centred under the value: the page already spends colour where colour
means something. A comparison that ignores case adds one more line saying so — **silence means
case matters**.

A text criterion compares **equal, not equal, contains, starts with or ends with**, and carries
two flags: **case sensitive** (on by default — a specification says exactly what the unit must
answer) and **regular expression**, which turns the value into a pattern and takes the place of
the comparison. A pattern that does not compile is reported by validation rather than failing
on the bench.

**The comparison type** for a numeric criterion. One list, the set TestStand uses, with its own codes:

| Type | Passes when | Prints |
|---|---|---|
| `EQ (==)` | `Value = Limit` | `= 5 V` |
| `GELE (>=<=)` | `Low ≤ Value ≤ High` | `11 V … 14 V` |
| `EQT (==+/-)` | `Nominal − Tol ≤ Value ≤ Nominal + Tol` | `13.5 V ± 5 %` |
| `NE (!=)` | `Value ≠ Limit` | `≠ 0 V` |
| `GT (>)` · `GE (>=)` | `Value > Limit` · `Value ≥ Limit` | `> 12 V` · `≥ 12 V` |
| `LT (<)` · `LE (<=)` | `Value < Limit` · `Value ≤ Limit` | `< 0.5 V` · `≤ 0.5 V` |
| `GTLT (><)` | `Low < Value < High` | `>11 V … <14 V` |
| `GELT (>=<)` · `GTLE (><=)` | one end excluded | `11 V … <14 V` · `>11 V … 14 V` |
| `LTGT (<>)` | `Value < Low or Value > High` | `< 2 V or > 10 V` |
| `LEGE (<=>=)` · `LEGT (<=>)` · `LTGE (<>=)` | outside, one end included | `≤ 2 V or ≥ 10 V` |
| `NONE` | nothing is judged | `recorded, no pass/fail` |

A one-limit type shows **one** field, called *Limit*: there is no second box to wonder about,
and changing the type moves the value to where the new one reads it. The strict symbol is
printed only on the end that excludes, so the common case stays as short as it was.

Choosing nothing is a choice too: a criterion that states no type means what it has always
meant — both limits filled is «between them, inclusive», one limit alone is «at least» or «at
most». Documents written before this keep reading exactly as they did.

A step of type **Stage call** runs a setup stage and has no halves of its own.

### The table step

When the same reading is taken for a list of combinations — five cable resistors, one code and
one current limit read for each — one step of type **Table** replaces five that would differ
by a number. Its **columns** are declared once, in the same list every nested thing uses: a
stimulus column or a measurement column, its name, its unit, and what it works with — points
and an instrument, or a command. Its **rows** are the combinations: a label and one cell per
column, in a grid of plain text.

> **Description** Proximity pilot decoding, one row per cable
> **Columns** APPLY PP resistor [Ω] · `AP-07 PP` `AP-08 PE` · `RES-04 Cable simulator`
> MEASURE pp · `CMD-11 Read pp` — MEASURE ilimit [A] · `CMD-12 Read current limit`
> **Rows** 13 A cable · `1500` · `13A` · `= 13` — 63 A cable · `100` · `63A` · `= $MaxCurrent`

A stimulus cell is a value or `$Variable`. A measurement cell is typed as the specification
writes it, in the unit the column declares, and read into a criterion when you leave the
field; under it, the criterion as it will print:

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

What the grammar cannot say — a criterion that came in from a file as an open two-sided
comparison, say — is shown as it will print, with a ⚠, and left alone: a criterion like that
belongs in an ordinary step. The table prints as one table on the sheet and in the Word file,
across the whole width of the step row — its code and kind sit at the right of the description,
above it, and there is no acceptance column beside it, the criteria being in its cells;
a variant may change one cell, and the cell is marked like any varying value; each column
occupies the bench like a stimulus or a measurement block would, and a command in a column
runs once per row for the cycle time. Adding a column adds a cell to every row and adding a
row a cell for every column: the grid never has a hole. Two or three output columns and a
handful of rows is what a table is for; beyond that, one step per row reads better.

### A measurement computed from earlier readings

A metering error is not read from the meter: it is worked out from the meter's reading and
the reference's. Tick **Computed from earlier readings** on the measurement, and instead of an
instrument the editor asks for the **formula**, written as the document should print it —
`(meter − reference) / reference × 100` — and for the **steps it reads from**, among the
earlier steps of the same test that read something. The document tags it `COMPUTED`, prints
the formula and the step codes, and judges it by the ordinary criterion. Validation refuses an
input that comes after the computation or reads nothing, and a computed measurement that still
names an instrument, a point or a command — two stories about one number.

### A figure on a step

**Figure** on a step points at one of the images: «see the front panel». It prints small under
the acceptance column with its code, opens full size with its markers on a click, and in the
Word file is named by code — the picture itself stays in the appendix, where the points keep
their markers.

---

## 7. Variants: one document, several products

A variant is **not** a copy of the document. It is a list of differences from it — the base
document stays the only source, and a variant says «here, this changes».

**Creating one.** *Product variants* → **+ Variant**, give it a name (`LCU-200 24 V`).

**Two ways to state a difference:**

1. **The matrix**, for the two frequent cases. Untick a stage and it does not apply to that
   variant; type a different value next to a variable and that variant uses it.

2. **Editing in variant mode**, for everything else. Pick the variant in the top bar: an amber
   ribbon appears and *every change you make is recorded as a difference of that variant*, never
   on the base document. Change a limit, a point, a command, add a step, delete a test — each
   edit becomes one line in the variant's list of customisations.

A customised field shows an amber border and a ↺ button that drops the customisation and
returns the field to the base value.

**What varies is marked, always.** Anything a variant makes different is written in
**electric blue** wherever it is read: a limit that comes from a variable some variant
redefines, a step a variant rewrites, the code of a stage a variant does not run. The mark does
not depend on what is selected in the top bar — reading the base document is exactly when
nothing else would tell you. **Click** the blue text and a card opens with the value it takes in
the base document and in every variant, side by side; resting the pointer on it shows the same
table without the click. In the editor the same blue marks a field some variant rewrites; under
an active variant that field keeps the stronger amber frame and its ↺.

It is a screen mark. On paper the document is one product and prints as it always did.

> **Example.** The 24 V version: `Vbatt` becomes `27`, `IquiescentMax` becomes `30`, the
> mechanical stage does not apply, and the residual voltage on the output allows `0.8 V` instead
> of `0.5 V`. Four lines in the variant, nothing duplicated.

**Codes under a variant.** A stage keeps the code it has in the base document: a variant that
does not run the mechanical stage shows STG-01, STG-02, STG-04, and the gap is how the document
says that stage is not run here. The matrix always lists every stage of the base document, with
a ✓ or a — per variant, so what a variant leaves out is visible instead of missing.

**What a variant cannot do:** change the order of things. Order belongs to the base document, so
the reorder arrows are disabled while a variant is active — leave the variant and reorder there.

**Reading a variant.** The selector in the top bar shows the document resolved for that variant:
what you see is what the operator of that product gets, printed and exported included. The
printed document carries a matrix of which stage applies to which variant, plus the list of
differences of each one.

---

**KPI.** Any test can be flagged **KPI** — a result somebody follows line-side. It changes
nothing about how the test runs; it marks the test in the document and gathers it, with the
criterion each of its measurements is judged by, into an appendix of its own.

## 7a. Notes in the margin

A note is a coloured mark in the right margin of the sheet, with a name and a text behind it.
It is **not** part of the specification: a specification is what gets signed and printed, a
note is what somebody thinks about it while reading, and the two never share a file.

**Writing one.** Press **📝** beside the scrollbar, then click the sheet at the height of the
line — in the document view or in Read, it is the same. A dialog asks for the name, the kind,
the colour and the text; name and colour are remembered, so from the second note on it only
asks for the text. Resting the pointer on a mark shows who wrote what and when; a click opens
it to edit or delete.

**Kinds.** A note is one of four things, each with the colour it is born with and a glyph on
the mark, so the margin reads without a pointer on it:

| Kind | Mark | For |
|---|---|---|
| Note | blue, plain | a remark, a question, a reminder |
| To check | amber, `?` | something the document says that has to be verified against the source or the product |
| Condition | violet, `!` | a circumstance under which the line applies, or does not |
| Left out | red, `–` | something the source had that this document has not |

Choosing a kind paints the note in its colour; a swatch pressed afterwards still wins. The
count at the bottom of the window reads «Notes 18 · 13 to check» while anything is left to
check, and opens the notes by kind: press a kind there to take it off the sheet for a while,
or put it back — a filter, not a deletion. A conversion imported from an authoring file brings
its notes this way (see the import guide, §7): what it left out, what is to be checked, the
conditions, signed «Import» and anchored to the element each was written on. A notes file
written before kinds existed reads as plain notes.

The mark is attached to the element under the click — the step, the test, the chapter — by
the id the document draws it with, not to a height in pixels: zoom, fold a chapter, add a step
above, and it follows the line. A note whose element was deleted is not lost: it sits at the
top of the sheet with a dashed outline, marked *detached*.

**Where they live.** Notes are kept in the browser as they are written — nothing is asked, and
the specification is not made dirty by them. They travel in a file of their own, the
specification's name with the extension `.json` (`SPC-TEST-0042_Rev02.json`), which downloads
together with the specification at the next **Save** whenever the notes have changed, or on
demand from **File ▾ → Export notes**. Keep the two files together. The status bar counts the
notes and marks them with • while the file is behind what the browser holds.

> A page opened by double click cannot write a file beside itself — every browser refuses it —
> so the notes file is downloaded, exactly as the specification is. What the browser holds is
> what you see; the file is how it is carried to a colleague, to another machine, or into the
> folder where the specification lives.

**Reading somebody else's.** **File ▾ → Import notes…** reads a notes file into the document,
merged with yours by id: what is new comes in, and where both of you have the same note the
later change wins. Every decision is listed — taken from the file, kept as yours, new, and
which ones point at something the document no longer draws — and nothing happens until you
press **Apply**. Notes written on another specification, or on another revision of this one,
are refused with the reason: a revision moves and renumbers things, and notes written on it
would sit beside the wrong lines.

### Validating the variants

The **Validation** panel checks the document as it stands on screen — the base, or the variant
selected in the top bar — and then, underneath, **every variant** as the document it resolves
to. Each variant lists only what it adds to the picture: a lower limit set above the upper one,
a stage dropped that another one still waits for, a setup stage left with nobody to call it. An
issue the base already has is not repeated under every variant. **Go** selects that variant and
opens the element.

## 7b. Reading a version

The **revision history** in the document view carries a **Read** column: one radio per row.
The row you pick is the version on screen; the row above it is what the differences are
measured against, and both are marked so the pair is visible at a glance.

The draft is a row like the others, and it is the one selected when the document opens: what
has changed since the last issue is therefore visible without asking for it.

Where something changed, a small pin sits in the margin — **Δ** for a change, **+** for an
addition. Click it and the side panel lists what changed there, with the previous content
labelled **obsolete**: it is kept so the change can be read, not for use. What a version
deleted is counted in the line under the table; it cannot be pinned to a document that no
longer contains it.

While an issued revision is on screen the page is framed in red, carries a banner with the way
back to the draft, and is watermarked **SUPERSEDED** — printing it keeps the watermark, so a
paper copy of an old revision can never pass for the current one. The change record shows what
that revision carried; the versions issued after it are listed underneath, marked «after this
version», and remain selectable.

The differences are never printed: a specification is the specification, not a comparison.

## 7c. Cycle time

**Cycle time estimate** puts three figures together: the wait declared on a step, the nominal
execution time of a command, and the average time each instrument is held for one use — that
last one is asked for in the estimator and lives only there, because a mean is a bench figure
and nobody signs off a mean.

It gives two totals: **one stage at a time**, the honest worst case, and **with parallel
stages**, where stages that may run together (the same groups the resource count uses) are
charged as the longest of them. When the two coincide the page says why, naming the stages
whose exclusions forbid every pair — the equality is a result, not an omission. What has no time declared is listed rather than guessed: the
estimate is a floor, and it says so.

## 8. Revisions: draft, issued, compared

**The draft** is what you are editing. Its number, date, author and reason are the fields under
the header; they describe the revision you are preparing.

**Validate** — the **✔** in the command bar, and the button on the draft row of the change
record — freezes the draft: number, date, author, reason and status are written into an
immutable snapshot inside the file. The document then **is** that revision: its cover says
«Rev. 01 — Approved», the change record ends with it, and no draft exists until you ask for one.
A version validated as final needs nothing more. When work resumes, **New draft** — the button
under the change record, also offered by the ✔ — opens Rev. 02 as a draft, and the record shows
it again as the last row. Editing an issued document without opening the draft is reported as
an error by validation, because the cover would say «issued» over something that is not what
was issued. Saving the file and validating a revision are two different acts, which is why they
are two different buttons. From then on that revision can be compared and restored, and it
appears in the change record printed on the second page.

```
Rev. 00   12/05/2026   M. Rossi   First issue                          Issued
Rev. 01   03/07/2026   M. Rossi   Added the final diagnostics stage    Approved
Rev. 02   30/08/2026   M. Rossi   Added the 24 V variant               Draft   ← you are here
```

A draft whose number is already issued is refused: change the number before validating.

**Compare two versions** — pick two entries and you get the list of differences grouped by
chapter, each with what it was and what it became. Useful before issuing: it is the answer to
«what exactly am I signing off».

**The revision matrix** — the last appendix of the printed document, once a revision has
changed something: one column per revision that changed anything (the first issue records
nothing, everything was new in it) and the draft when it differs from the last issue, one row
per thing changed, grouped by chapter, and in each cell what that revision did to it — *added*,
*changed* with the old and the new value, *removed*, *moved* — coloured by kind. A value that
does not fit a cell is not quoted but counted: «text changed (48 → 61 words)», and the
comparison tool shows the words. The change record on the second page points at the
appendix. With three columns or more the appendix turns the page. Each issued revision keeps
its record inside the file; a file written before this gets the record when it is opened.

**Merge forward** consolidates two revisions into one. The chosen revision leaves the record and
what it changed becomes part of the one that follows, which already contains it; the reason is
carried over. Use it to tidy a string of small issues into one. The snapshot of the dropped
revision is gone, so it can no longer be compared or restored.

**Restore into draft** brings the content of an issued revision back into the draft, keeping the
draft's own number. Your unissued work is replaced, so save first if it matters.

**One editor at a time.** The file is the document: whoever edits, issues the revision and
redistributes the file. When you open a file with fewer issued revisions than the one you were
using, or with the same numbers but different content, the tool says so — decide which copy is
the good one before going on.

---

## 9. Saving, and the versions of the file

Nothing is written anywhere until you press **Save** — the **💾** in the command bar, or
`Ctrl+S`: the editor holds the changes, and the file on disk is still the previous one. Unsaved
changes are stated in the toolbar, in the status bar and in the tab title. The status bar also
counts the problems validation finds — a red plate when there are errors, sand for warnings,
*✓ No issues* otherwise — and a click on it opens the validation panel. Saving downloads the
rebuilt file — `SPC-TEST-0042_Rev02.html` — which replaces the one you started from, and the
notes file beside it when the notes have changed (see §7a).

### The recovery copy

Between one save and the next, nothing at all is written to disk — so every few seconds the
unsaved work is copied into the browser's own storage, and when the file is opened again after a
crash, a tab closed by mistake or a machine that rebooted overnight, the editor offers those
changes back. Recovering puts them on the screen: they are still unsaved, and you still have to
press **Save**.

The status bar says what the net is doing — *Recovery copy 14:32*, or *⚠ No recovery copy* when
the browser keeps nothing for a file opened this way, which is a reason to save more often. The
pictures already in the file are not copied, because the file you have open still has them; the
ones you add during the session are, unless the storage is too small for them, and the status bar
then reads *(text only)*.

It is a net, not a save. The file on disk changes when you download it and not before. The
copy is offered only to the file it came from — by its place, its code and its title, and for a
document that has no code or title yet, by its content as well — so on a shared machine nobody
is offered somebody else's unsaved work.

Two more versions live in the file, and **Version and changelog** shows all of them:

- the **build** of the editor that wrote it;
- the **data schema** of the document inside it. A file written by an older build opens here and
  is upgraded silently; the import states what it upgraded.

**File ▾ → Export data (JSON)** writes the same content as JSON, wrapped in an envelope that names the format
(`tsw-export/1`) and the build. **Import data…**, in the same menu, reads that back, and also the authoring format
(`tsw-authoring/1`) described in `IMPORT-GUIDE.md`. A file written in a format newer than your
build is refused with the reason rather than half read.

---

## 10. Before issuing a revision

- **Validation** shows no errors, and every warning is one you have decided to live with.
- Every point is marked on a picture, every measurement has an acceptance criterion.
- The repeated routines are setup stages, and something calls them.
- The prerequisites tell the true order, and the stage graph looks like the sequence you mean.
- The reason for the revision says what changed, in a line someone else will understand.
- Then: **Validate** (✔), **Save** (💾), and distribute the downloaded file — with its notes file, if there is one.
