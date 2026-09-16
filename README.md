# DEDALO — Test Specification Writer

<img src="build/brand/dedalo.png" alt="DEDALO" width="120" align="right">

**DEDALO** writes **test specifications for electronic devices** in a single self-contained HTML file:
the file is the application and the document at the same time. Whoever receives it opens it
with a double click — nothing to install, no network — reads it, navigates it, edits it and
prints it to PDF.

## Using it

Three files to try, live on GitHub Pages — no build required:

1. [`test-spec.html`](https://heronforge.github.io/Dedalo/test-spec.html) — empty document, the
   one to start from.
2. [`example.html`](https://heronforge.github.io/Dedalo/example.html) — a small complete example
   (LCU-200 lighting control unit) with two issued revisions, two variants, an image with markers
   and populated appendices.
3. [`wallbox.html`](https://heronforge.github.io/Dedalo/wallbox.html) — the showcase: the end of
   line specification of an EV charging controller, with four photographs and forty contact
   points, routines called from several places, stages that run in parallel, every kind of
   acceptance criterion, three variants and three issued revisions to compare.

Save the page (browser's Save As, or right-click a link above → Save link as) to get a local
copy, or build your own with `npm run build` — see [Development](#development) below; the same
three files land in `dist/`, which is generated and not checked into the repository.

Open it with a double click. **Save** (the 💾 in the command bar) rebuilds the whole file with
the current data and downloads it: the downloaded file replaces the original one and can itself
be opened and edited. `Ctrl+S` saves, `Ctrl+Z` / `Ctrl+Y` undo and redo.

A file that is the last issued revision word for word — the file as it is handed out — opens
straight in reading mode, where nothing leads into the editor; Esc brings the editor back.

Between one save and the next the unsaved work is copied into the browser's own storage every
few seconds, and the editor offers it back when the file is opened again after a crash or a
window closed by mistake. It is a net, not a save: the file on disk changes when you download
it and not before, and the status bar says which of the two you are looking at.

Browsers: recent Chrome, Edge, Firefox; Safari from 16.4.

## What the document contains

- **Header** — company, product, document code, confidentiality, and the signatories — as many
  as the process asks for, each with a role, printed four to a table on the cover; it feeds the
  cover and the header and footer of every printed page.
- **Global variables** — numbers with a unit, text, enumerations, booleans, ranges. Every
  parameter and every measurement limit can reference them instead of repeating a number.
- **Notes** — coloured marks in the margin, with a name, a kind and a text, placed by clicking
  the sheet at the height of a line and attached to that line through zoom and edits. A note
  is a remark, something to check, a condition or something left out, each with its colour and
  its glyph; the count at the bottom says how many are still to check. Not part of the
  specification: kept in the browser as they are written, carried in a file of their own
  (`<specification>.json`) that downloads with Save, and merged by id when a colleague's file is
  imported — with the merge shown before it is applied.
- **Variant-dependent text** — whatever a variant makes different is written in electric blue
  wherever it is read, whether the base document or a variant is on screen; a click on it lists
  the value it takes in the base document and in every variant. Screen only: on paper the
  document is one product.
- **Product variants** — a variant is a set of operations on the base document: anything can be
  added, changed or removed. The matrix covers the frequent cases (stage applicable or not,
  different variable value); for everything else you pick the variant in the top bar and edit
  the document: each change becomes a customisation of that variant, marked with an orange
  frame and undone with ↺.
- **Resources, interfaces, commands, application points, images** — the catalogues the steps
  refer to through a code (`RES-01`, `CMD-02`, `AP-03`…). On the images only the number of the
  point is drawn, so the markers stay small; the full name is one hover or one click away. A
  command or a protocol specified in another document says so — «Defined in REF-05» — and a
  command may state its decoding, the unit a criterion over it is read in when it states none.
- **Test stages and setup stages** — `STG-xx` are the stages of the sequence: each runs once, in
  the order its prerequisites allow. `SET-xx` are routines with no place of their own — power up,
  power down, load configuration — which run only where a step calls them, as many times as they
  are called. The two kinds are numbered apart, listed apart in the editor and in the document,
  and drawn in two bands in the graph, so nobody has to guess which is which.
- **Tests → steps** — the step carries the high level description; the detail is split into
  `APPLY` (what is put on the unit) and `MEASURE` (what is read back from it), each with its
  points, resource, parameters, command and an optional wait time — a number or a variable. A
  step may be a **table**: the columns declare what is applied and read once, the rows are the
  combinations, one criterion per cell typed as the specification writes it (`12 ±0.5`,
  `< 0.8`, `$Imax`, `recorded`). A measurement may be **computed** from earlier readings, with
  its formula printed and its inputs named. A step may point at a **figure**, printed small
  beside it and opened full size.
- **Constraints** — prerequisites between stages, parallel exclusions, stimuli held on exit.
  They are checked (cycles, recursion, dangling references) and drawn in the stage graph.
- **Glossary** — what the acronyms of the text stand for, a chapter of its own; the editor
  lists the acronyms the prose uses and the glossary does not explain, one press each to add.
- **Appendices** — application points with the images and their markers, commands and
  interfaces, resources with the concurrent channel count, stage graph. The chapters and the
  appendices print in the order the document sets, empty ones left out; the commands and the
  graph print in landscape, on paper and in Word.

A line under the toolbar says where you are — the section, the stage, the test, the step — and
every step of it leads back to what it names, or drops the list of its neighbours and what they
contain; in the document, and in reading mode, it follows the reading and names the chapter
under the eye. Beside the scrollbar, a column of buttons stays put while the content moves: the
way back to the document, reading mode, a note, print, the legend of the marks. In reading mode
the contents stand in the grey field beside the sheet, the chapter being read lit, every line a
way there. Everything that can be
added can also be duplicated: **⧉** copies an element with everything inside it, references outwards kept and
references inwards moved onto the copy.

In the printed document the steps stay short and refer to the appendices through their codes;
on screen, clicking a code opens the detail card without losing your place and resting the
pointer on it previews the card, a click on a heading folds a chapter away (with **Collapse
all** / **Expand all** at the end of the trail for the whole document), and a click on the stage
graph opens it full size. None of that touches the printed document, which always carries
everything.

On the pictures a marker shows the number of the point — `03` — unless the point is a **test
point**: when its connector names one (`TP12`, `TP-7`), the marker shows that name instead, so
the drawing speaks the language printed on the board.

### Compact by design

A test specification is read at the bench, so the printed output is tuned for density: only the
cover, the stages chapter and the appendices start on a new page, the stage constraints are one
line instead of a table, and the step table keeps three columns (step, action and detail, wait).
The same content that used to take 15 pages now takes 10, setup stages chapter included.

Every reference carries **both the code and the name** of what it points at — `AP-01 Battery
positive`, `STG-01 Set-up and power-up` — so the reader rarely has to jump to the appendix to
know what a code means. Long names are truncated; the code never is, and it never wraps.

The resource appendix says where each resource is **applied** — the application points, with code
and name — rather than which stages use it; the channel count is summarised in one column, and
what a setup stage uses is charged to the test stages that call it.

## Guides, versions and changelog

[`docs/EDITING-GUIDE.md`](docs/EDITING-GUIDE.md) is for whoever fills a specification in by hand:
short, example driven, with variants and revisions explained at length. The **Version and
changelog** section of the editor shows which build you are using, the data schema of the file
and the JSON formats that build reads and writes.

Three version numbers answer three questions and move independently: the **build** of the editor,
the **data schema** inside the file, and the **interchange formats** (`tsw-authoring/1`,
`tsw-export/1`). A file from an older build opens and is upgraded, and the import says what it
upgraded; a file from a newer one is refused with the reason instead of being half read.

## Word export

**Word (.docx)** writes the same document as a real Word file: heading styles (so the navigation
pane works and the table of contents fills itself in with Ctrl+A, F9), tables with repeating
header rows, A4 page setup, a running header with company and product and a footer with document
code, revision, confidentiality and «Page X of Y».

A .docx is a ZIP of XML parts, so it is written here directly — no library, nothing to download,
the file stays self-contained. Word cannot lay the point markers over a picture the way the
browser does, so the browser draws each figure onto a canvas first — image plus markers, and the
stage graph — and the resulting PNGs are embedded.

## Converting an existing specification

Old specifications usually exist as PDFs. [`docs/IMPORT-GUIDE.md`](docs/IMPORT-GUIDE.md) is written
to be handed to a language model together with the source document: it explains the model of a
specification, gives the exact JSON format and the rules for reading a legacy text (what becomes a
stimulus and what a measurement, when a repeated block is a setup stage, when a value deserves a
variable, and above all not to invent what the source does not say).

The model returns one `spec.json`; **Import data…** loads it and lists whatever it could not
resolve. What the conversion has to say beside the document — what it left out, what is to be
checked, the conditions — does not go into the document: it comes in as notes in the margin,
signed «Import», with their file offered from the report. Pictures cannot travel in the JSON:
upload them afterwards and place the markers.
[`docs/example-spec.json`](docs/example-spec.json) is a complete, importable example.

The same guide doubles as the conceptual documentation of DEDALO, and the import also accepts a
previous **Export data** file, so the JSON is a round-trip format.

## Revisions

You work on a draft. **Validate** (the ✔ in the command bar) freezes an immutable snapshot
(number, date, author, reason, status); the document then *is* that revision, with no draft
until **New draft** opens the next one — a final version needs none. The history stays inside the file,
compressed, and feeds the change record and the comparison between two versions, which produces
the list of differences grouped by chapter.

The last appendix of the printed document is the **revision matrix**: one column per revision
that changed something, one row per thing changed, each cell saying what that revision did to
it — added, changed from what to what, removed, moved — coloured by kind; a long text is counted
rather than quoted. The change record on the second page points at it.

**Merge forward** consolidates two revisions into one: the chosen revision leaves the record and
what it changed simply belongs to the revision that follows it, which already contains those
changes. The reason for the change is carried over, so the record keeps its meaning; the snapshot
of the dropped revision is gone, so it can no longer be compared or restored.

The model is single editor: whoever edits issues the revision and redistributes the file. When a
file with fewer issued revisions is opened, the application warns.

## Development

```bash
npm install
npm run build      # produces dist/test-spec.html, dist/example.html and dist/wallbox.html
npm test           # tests of the pure modules (paths, variants, validation, resources, diff)
```

`npm run build -- --min` produces the minified version.

Sources in `src/`:

| Folder | Contents |
|---|---|
| `model/` | data schema, paths, variants, variables, stage graph, resources, validation, store |
| `history/` | issuing and revision history (native gzip), version comparison |
| `io/` | file rewriting, opening, images and asset pool |
| `ui/` | command bar, navigation, section editors |
| `render/` | full document, appendices, SVG graph |
| `print/` | pagination with paged.js and the page stylesheet |

Two things to know before touching the code:

- **The shell.** At startup, before the interface touches the DOM, `io/file.js` keeps the file in
  memory exactly as it was opened. On save it replaces only the three data blocks delimited by
  the `<!--TSW:DOC-->`, `<!--TSW:HISTORY-->`, `<!--TSW:ASSETS-->` markers. That is why the body of
  the distributed file holds nothing but the data and the scripts: the whole interface is built
  at runtime.
- **Paths.** Every change is expressed as a path anchored to the stable ids of the entities
  (`['stages', '#stg_a1b2', 'tests', '#tc_…', 'name']`). The same path lets the store write, lets
  a variant record a customisation and lets the diff pair two versions: it is the reason variants
  can change anything without dedicated code.
