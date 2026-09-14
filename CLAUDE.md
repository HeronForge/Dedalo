# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run build                  # -> dist/test-spec.html (empty), dist/example.html (small demo), dist/wallbox.html (showcase)
npm run build -- --min         # minified
npm test                       # node --test test/*.test.js
```

Run one test file, or one test by name:

```bash
node --test test/model.test.js
node --test --test-name-pattern="a dangling reference" test/model.test.js
```

There is no linter and no formatter. Match the surrounding style.

To see the app, use the Browser pane with the `specifica` config in `.claude/launch.json`
(serves `dist/` on port 8123) — never `npm`/Bash for a server. Build first; the server
serves the built files, not `src/`.

## What this is

**DEDALO** — a test specification editor for electronic devices that ships as **one
self-contained HTML file**: the file is both the application and the document. The name is
`APP_NAME` in `src/version.js` (with `APP_TAGLINE` for what it does) and is how the project is
referred to everywhere a reader meets it: the About section, the Word file's properties, the
guides. Its mark lives in `build/brand/` (a WebP for the sheet, a PNG for Word) and is embedded
by `node build/brand.mjs` into `src/brand/dedalo.js`, which the sheet's running header and
cover and the Word export import — a data URL, so nothing has to travel beside the file. No install, no network, opened by
double click. `README.md` describes the product; `docs/EDITING-GUIDE.md` and
`docs/IMPORT-GUIDE.md` are the user-facing manuals, and the import guide doubles as the
conceptual documentation of the data model.

## Architecture

### The shell, and why the build looks the way it does

`src/index.html` is a skeleton with placeholder markers. `build/build.mjs` bundles
`src/main.js` with esbuild (IIFE), inlines the four stylesheets and paged.js, and substitutes
them into the markers. The distributed body then holds nothing but three JSON data blocks and
the scripts — the whole interface is built at runtime.

At startup, **before the interface touches the DOM**, `io/file.js` captures the file exactly as
it was opened (`captureShell`). Save rebuilds that captured text, replacing only the three
blocks delimited by `<!--TSW:DOC-->`, `<!--TSW:HISTORY-->`, `<!--TSW:ASSETS-->`, and downloads
the result. The downloaded file is itself openable and editable.

Consequences to respect:
- Nothing may run before `captureShell()` in `main.js`, or the shell captures generated DOM.
- Anything injected into the file must survive `safeInline` / `protect` (`</script` escaping).
  Both the build and the runtime save do this; JSON replacement goes through a **function**
  replacer, because `$&` and `$1` in the data would otherwise corrupt the file.
- `build/demo.mjs` builds `dist/example.html` from pure Node — the images are synthetic SVGs,
  so the example depends on no external file. `test/docx.test.js` imports `buildDemo` too.
- `build/demo-wallbox.mjs` builds `dist/wallbox.html`, the showcase, from the WebP photographs
  in `build/showcase/images/` (already at the size the tool would store them). It is the
  document a demonstration opens, so `test/showcase.test.js` holds it to zero issues in the
  base and in every variant; a change to the model that leaves it with a notice is worth a look.

### Paths are the spine

Every change is expressed as a path anchored to stable ids:
`['stages', '#stg_a1b2', 'tests', '#tc_…', 'name']`. A `#id` segment selects an array element
by its id, so a path survives reordering. The same path lets `model/store.js` write, lets a
variant record a customisation, and lets `history/diff.js` pair two versions. **This is why
variants can change anything without dedicated code per field** — before adding a
field-specific mechanism, check whether a path already does the job.

`model/paths.js` also owns `LABELS`, which turns a field key into readable English. A new
document field needs an entry there, or the change record and the variant list will print the
raw key.

`model/variance.js` turns the overlays inside out: instead of «what does this variant change»,
it answers «does this piece of text depend on the variant at all», keyed by entity id and field.
That is what lets the document and the editor mark variant-dependent text while the **base** is
on screen — the reader who has no other way of knowing. It is always built from the base
document, and the mark is screen-only (`.document-screen .varies`): print is one product.

`model/clone.js` is the other side of the same idea: it duplicates an entity by handing out new
ids for everything inside it and then repointing at the copy whatever inside it named the
original. Nothing there is per-entity either — a new collection is duplicable the day it exists.

Notes (`model/notes.js`, `io/notes.js`, `ui/notes.js`) are deliberately **outside** the
document: they never touch `doc`, never make it dirty, and live in `localStorage` keyed by the
specification's name, with a `tsw-notes/1` JSON file for carrying them (downloaded with Save
when behind, imported with a by-id merge whose decisions are shown first). A note is anchored to
a DOM id of the rendered document plus a fraction — the same idea as `ui/viewpoint.js` — which
is what makes it survive zoom, folding and edits. A `file://` page cannot write a file beside
itself, so «the file next to the specification» is always a download, never a silent write.

Nothing is written to disk while one types, so `io/recovery.js` keeps a copy of the unsaved work
in `localStorage` and `ui/autosave.js` decides when. It is never called a save: the status bar
says «Recovery copy», the dialog says the file on disk is untouched, and that distinction is the
whole point of the feature.

### Steps are read through `stepBlocks`

A step carries its bench work in blocks — a stimulus, a measurement — and a **table step**
carries them as columns instead. `model/schema.js` `stepBlocks(step)` is the one place that
knows the difference: resources, cycle time, validation and the point count all walk it. A
computed measurement is left out of it (it touches nothing). Code that reads `step.stimulus`
or `step.measurement` directly is code that forgot the table step.

The notes (`model/notes.js`) are the one thing beside the document that is not in it: the
importer returns them from a conversion (`importAuthoring` → `{ doc, problems, notes }`) with
anchors on the ids the document renders with, and `ui/notes.js` adopts them. They never touch
`doc`, never make it dirty, and never enter the file.

### Store, variants and codes

`createStore` (`model/store.js`) holds `doc`, `history`, `assets`, plus UI state. When a
variant is selected, `write`/`add`/`remove` do **not** touch the base document: they record an
overlay operation on that variant (`recordingVariant`). Ordering is the exception — `move()`
refuses under a variant, because order belongs to the base document.

- `resolvedDoc()` is the base document with the active overlay applied, memoised until the next
  `notify()`. Read from it; write through the store.
- `codes()` numbers against the **base** document, so a stage keeps its code under a variant and
  a gap in the numbering means the variant does not run it.
- `subscribeLight` is for keystrokes: it refreshes the status indicators without redrawing, so
  the focused field survives. `refresh()` forces the full redraw.
- `validation()` is the validation of the resolved document, memoised until the next `notify()`
  — it is the costliest computation and several parts of the interface ask for it. The status
  bar debounces it on the light channel. `parallelGroupsDetailed` (`model/stages.js`) keeps its
  own memo keyed on the stages' ids, kinds, prerequisites and exclusions.
- Undo steps hold `{doc, history}`. A change that touches the history goes through
  `changeAll(fn)` (one step) — `set({history})` delegates to it. `replaceAll(data, {dirty})`
  says whether the file on disk holds the document: open → false, import/new → true.
- Each issued revision records `assetIds`; `pruneAssets(doc, assets, history)` keeps every
  picture any revision uses, and keeps everything when a revision from an older build has not
  yet been completed (`completeAssetIds`, run at startup).

### Module layers, and the DOM boundary

| Folder | Contents | Needs a DOM? |
|---|---|---|
| `model/` | schema, paths, variants, variables, stage graph, resources, cycle time, validation, store | no |
| `history/` | issuing, gzip snapshots, version comparison | no |
| `io/` | file rewriting, opening, format envelope, images, zip, authoring import, recovery draft | no |
| `export/` | `docx.js` writes the .docx ZIP by hand | no |
| `render/` | full document, appendices, SVG graph | **yes** |
| `print/` | paged.js pagination and the page stylesheet | **yes** |
| `ui/` | command bar, navigation, section editors | **yes** |

The modules in the first four rows are what `test/*.test.js` covers — they import cleanly in
Node. `render/`, `print/` and `ui/` build DOM through `ui/dom.js` (`h()` calls
`document.createElement`), so they can only be exercised in the browser.

`render/document.js` and `export/docx.js` are deliberate parallels: the same document, once as
DOM and once as WordprocessingML. A change to how a step reads usually belongs in both.

### Verifying browser-only code

`main.js` exposes `window.TSW` for exactly this: `store`, `composeFile()`, `importData`,
`images` (the encoding pipeline), `recovery` (the safety net: `snapshot()` forces a copy), and
`buildWord()` which returns the .docx bytes without a download. Drive it with `javascript_tool`
in the Browser pane rather than clicking through dialogs. To catch a download without saving a file, wrap `URL.createObjectURL`.

Paged.js pagination is slow and frequently stalls inside the Browser pane — this is the pane,
not the code. Do not treat a stalled preview as a regression without checking a known-good
build the same way.

### Adding an entity to the model

A new collection has to be threaded through more places than is obvious. When adding one, or
when a bug smells like "this kind was forgotten somewhere", check all of:

- `model/schema.js` — constructor, and the collection in `emptyDocument()`
- `model/codes.js` — `PREFIXES` and `computeIndex`
- `model/paths.js` — `LABELS`, and `SINGULARS` if the readable path needs it
- `model/validate.js` — `collectIds` (both `byKind` and the loop below it), `singularKind`
- `history/diff.js` — `CHAPTERS` and the key list in `nameFromId`
- `io/import.js` — the `keys` register (**a missing entry here throws, it does not degrade**),
  `singular`, and the two-pass resolution
- `ui/navigate.js` — `COLLECTIONS`, so a code in the document opens its editor
- `ui/app.js` — `GROUPS`, so the section is reachable
- `render/appendices.js` + `render/document.js`, and the mirror in `export/docx.js`

## Versions

Three numbers move independently, all declared in `src/version.js`:

- `APP_VERSION` — the build. Bump it with a `CHANGELOG` entry at the head of the list.
  `package.json` carries the same number; keep them in step.
- `SCHEMA_VERSION` (`model/schema.js`) — the shape of the data inside the file. Changing it
  means appending to `MIGRATIONS`; **never remove a migration step**, a file written by any
  older build must keep opening.
- `FORMATS` — the interchange JSON (`tsw-authoring/1`, `tsw-export/1`). An older version is
  upgraded and the import says so; a newer one is refused with a reason.

`test/model.test.js` enforces that `CHANGELOG[0].version === APP_VERSION`, that the list is
newest-first without duplicates, and that every entry is a dated list of full sentences.

## Writing style

The prose here is part of the product. The changelog is shown in the editor and is written for
whoever *uses* the tool, not whoever wrote it; comments explain **why** a thing is the way it
is, usually naming the failure that motivated it. Test names are sentences describing the
behaviour under test ("a revision number already issued is refused instead of overwriting it").
Match this register — terse implementation notes read as foreign here.
