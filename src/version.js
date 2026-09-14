// What this build is, what data formats it speaks, and what changed along the way.
//
// Three version numbers live in this file and they answer three different questions:
//  - APP_VERSION      which build of the editor you are looking at;
//  - SCHEMA_VERSION   the shape of the document inside the file (see model/schema.js);
//  - FORMATS          the JSON documents this build can read and write.
// They move independently: a new build that changes nothing about the data leaves the other
// two alone, and a file written by an older build must keep opening here.

export const APP_VERSION = '1.37.0';

// The project's name; what it does is the tagline, so the two are never read as one title.
export const APP_NAME = 'DEDALO';
export const APP_TAGLINE = 'Test Specification Writer';

/** Who wrote this and under what terms. The full text lives in LICENSE, next to the file. */
export const AUTHOR = {
  name: 'D. Tracchi',
  assistedBy: 'Claude (Anthropic)',
};

export const LICENSE = {
  id: 'MIT',
  name: 'MIT License',
  copyright: 'Copyright (c) 2026 D. Tracchi',
  file: 'LICENSE',
};

/**
 * The interchange formats, each with the version this build writes and every version it can
 * still read. Reading an older version is a promise; reading a newer one is impossible, and
 * saying so plainly beats importing half a document.
 */
export const FORMATS = {
  authoring: {
    id: 'tsw-authoring',
    label: 'authoring format',
    writes: 1,
    reads: [1],
    reference: 'docs/IMPORT-GUIDE.md',
  },
  export: {
    id: 'tsw-export',
    label: 'data export',
    writes: 1,
    reads: [1],
    reference: 'docs/EDITING-GUIDE.md',
  },
  // What travels beside a specification without being part of it: the notes, for now.
  notes: {
    id: 'tsw-notes',
    label: 'notes',
    writes: 1,
    reads: [1],
    reference: 'docs/EDITING-GUIDE.md',
  },
};

/**
 * The changelog, newest first. It is shown in the editor, so it is written for whoever uses
 * the tool rather than for whoever wrote it.
 */
export const CHANGELOG = [
  {
    version: '1.37.0',
    date: '2026-09-13',
    changes: [
      'The cover is signed by as many people as the process asks for. The three fixed lines — prepared, verified, approved — give way to a list of signatories, each with a role and a name, printed in tables of four across in the order they are listed; a document with more than four gets a second table. A file written with the three fields opens with the same three people, in the same order.',
      'A wait may follow a variable: «WAIT $PilotSettle» prints as «500 ms (PilotSettle)», reads as the variable\'s value in the variable\'s unit, and changes with the variant like every other value. A wait that was a number stays a number.',
      'The table step. When the same reading is taken for a list of combinations — five cable resistors, one current limit each — the step is one table: the columns say what is applied and what is read, with which instrument or command and in which unit; the rows say the combinations, one criterion per cell, typed as the specification writes it («12 ±0.5», «< 0.8», «10 … 14», «$Imax», «recorded», «yes»). The table prints as one, on the sheet and in the Word file; a variant may change one cell; every column occupies the bench like a block would; a command in a column runs once per row for the cycle time.',
      'A measurement may be computed from earlier readings — the metering error from the meter\'s reading and the reference\'s — with its formula written as the document should print it and the steps it reads from. It is tagged COMPUTED, names no instrument, and is judged by the ordinary criterion. Validation refuses an input that comes after it or reads nothing.',
      'A step may point at a figure: printed small under its criterion with its code, opened full size with its markers on a click, named by code in the Word file. The points keep their own markers in the appendix.',
      'A command or a protocol may say where it is defined — «Defined in REF-04» — when its specification is another document: the appendices print it, and validation counts as information the commands that carry a reference and no format of their own. A command may also state its decoding: how the raw answer becomes the value a step judges, and in which unit — a criterion over that command that states no unit is read in that one.',
      'A conversion no longer writes into the document. What the authoring file left out, its remarks, and every «TO CHECK:» or «CONDITION:» line of a step, a test, a variable, a command, a resource or a point become notes in the margin — the line leaves the field, «TIMING:» stays — signed «Import», anchored to the element they were written on and to the test description for what was left out. The import report says how many came and offers their file. Importing the same file again does not write the margin twice.',
      'Notes have a kind: a plain note, something to check, a condition, something left out. Each has its colour and a glyph on the mark; the dialog asks for it; the count at the bottom says «3 to check» and opens the notes by kind, where a kind can be taken off the sheet for a while. A notes file written before kinds existed reads as plain notes.',
      'A table step takes the acceptance column too: its criteria are in its own cells, and a dash beside them said nothing. On the sheet and in the Word file alike.',
      'The stage graph no longer draws a dashed red line from every stage to every stage it cannot run alongside — with a dozen stages the lines hid the arrows. Each stage now says it in words under its box, «⊘ not with STG-03, STG-05», the whole list in the tooltip; a stage that allows nothing in parallel says so once under its own box instead of being repeated under every other.',
      'A glossary: what the acronyms of the text stand for, one line per term, printed as a chapter of its own in alphabetical order and left out while empty. The editor lists the acronyms the prose uses and the glossary does not explain — words of capitals, part numbers and pins aside — one press each to add; a line without a meaning, or a term explained twice, is a warning.',
      'The chapters and the appendices print in the order the document sets, from the header section, each among its own kind; a chapter with nothing in it — no reference, no variant, no setup stage — is not printed and not numbered, so no page ever says «none».',
      'The commands appendix and the stage graph print in landscape: on the paginated sheet, in the PDF and in the Word file, where each gets a section of its own with the page turned. The graph is bounded by the height of that page — a tall one used to be left where the paginator puts what it cannot cut, which is nowhere the reader looks.',
      'A table step takes the whole width of the row, code column included: its code and kind sit at the right of the description, above the table.',
      'What is said to the software — a command in a step and its arguments, a command at the head of a table column — is set in the software\'s font, so a line that mixes a probe and a message tells the two apart at a glance. On the sheet and in Word.',
      'A revision matrix closes the printed document: one column per revision that changed something — and the draft, when it differs from the last issue — one row per thing changed, grouped by chapter, each cell saying what that revision did to it, added, changed from what to what, removed or moved, coloured by kind. A text too long for a cell is counted rather than quoted, «text changed (48 → 61 words)». The change record on the second page points at the appendix, which turns the page once it has three columns. Every revision now keeps its record inside the file; a file written before this gets it when it opens.',
      'Printing from the browser keeps the landscape appendices whole: the browser prints one paper size for the whole job, so a landscape sheet is turned onto a portrait page and the page asks the viewer to turn it back — a landscape page in the PDF, nothing scaled or huddled at the left. In the cells of a table step the plate that says how a criterion is judged follows the value on the same line, and every row of the table is one line.',
      'Validating a draft no longer opens the next one by itself: the document becomes the revision it was validated as — «Rev. 01, approved» on the cover, the record ending with it — and stays so until New draft, under the change record or offered by the ✔, opens the next number. A version that is final needs no draft after it. An issued document edited without a draft is flagged as an error.',
      'Print / PDF is a button on the rail beside the scrollbar, with reading, the notes and the legend, and no longer a word at the end of the trail. In reading mode the contents of the document stand in the grey field at the right of the sheet: every chapter and appendix, the one being read lit and the stages it holds under it; the column stays faint until the pointer rests on it, a click on a line goes there, and its pin lets it withdraw to the edge of the window and come out under the pointer.',
      'The legend on the rail explains the COMPUTED tag and the font of what is said to the software; a table step prints its wait right under its description, beside the code, with no line of its own.',
      'The project has a name: DEDALO. Its mark stands at the right end of every printed header and closes the cover with «Powered by DEDALO», small and grey, in the sheet, the PDF and the Word file alike; the About section, the file properties and the guides call the tool by its name.',
      'The data schema moves to 2, in one step: the three header fields become the signatory list and every wait becomes a value reference. Every file written by an earlier build opens, and the import report says what was upgraded.',
    ],
  },
  {
    version: '1.36.0',
    date: '2026-09-13',
    changes: [
      'A second example ships with the tool: wallbox.html, the end of line specification of an EV charging controller. Forty contact points on four photographs, routines called from several places, stages that run in parallel, every kind of acceptance criterion, three variants — one that changes values, one that removes a stage and two points, one that adds a command and a test — and three issued revisions to compare. The small example stays for a first look.',
      'A contact point an interface is wired to counts as used whenever a step sends a command over that interface, as the resource count has always held. Validation no longer lists the bus contacts as points no step uses.',
      'The comparison of two versions reports as moved only what changed place among the elements both versions have. A stage inserted in the middle of the sequence is one addition; the stages after it, pushed down a place, are no longer listed as moved one by one.',
      'An authoring file may end with a «conversion» block: the source it was converted from and, item by item, what the source contains that the file does not. The import lists every item in its report and writes the block at the end of the testing description, so the document says what its source had that it does not. The conversion guide gains a chapter on the special cases real specifications keep producing — more signatories than fields, tests written as matrices, criteria computed from several readings, figures a check refers to, timing and conditions, commands defined elsewhere — and the limits beyond which a conversion declares rather than approximates.',
    ],
  },
  {
    version: '1.35.1',
    date: '2026-09-13',
    changes: [
      'A recovery copy is offered only to the file it came from. A document that has no code and no title yet is told apart by where it was opened from and by what it held, so on a shared machine the unsaved work of somebody who started from the same empty file is never offered as yours.',
      'A text that quotes the file\'s own markers — «</script», «<!--/TSW:DOC-->» — no longer disturbs the next save: the data is written with JSON escapes for them, and the build applies the same escape, which it had been declaring and not doing.',
      'The authoring import keeps its promise not to fail on a bad entry: a null or a bare string where an entity was expected is skipped and listed with its place, and the rest of the file comes in.',
      'Moving an element that is already at the edge of its list no longer counts as a change: nothing to undo, nothing to save.',
      'A document that came in from an import, or was just created, is unsaved and says so — it exists on the screen and nowhere else. Before it, the bar read «Saved» and the tab could be closed on it without a word.',
      'Importing a file asks first whenever the document on screen has something to lose — its issued revisions, its pictures, its stages — and says what, not only when there are unsaved changes.',
      'Undo covers the change record: an undo after validating the draft puts back the number and takes the frozen copy with it, instead of leaving a number the record says is taken. Merging forward and editing a revision\'s record undo the same way.',
      'A picture an issued revision still shows is never dropped from the file when the draft stops using it. Every revision records which pictures it uses; revisions issued by earlier builds get the record when the file opens, and until then nothing is dropped.',
      'A nominal criterion without a tolerance is an error, and prints as «13.5 V ± ⟨missing tolerance⟩» rather than as a bare number that reads, at the bench, as an exact equality.',
      'The validation panel checks every variant, not only the one on screen: each variant lists what it adds to the picture — a lower limit set above the upper one, a stage dropped that another one waits for — with a way to it.',
      'The validation behind the count at the bottom runs once per change rather than twice per redraw and once per keystroke, and the search for the stages that may run in parallel — exponential in the exclusions, a quarter of a second on thirty stages excluding each other in pairs — is computed only when a stage, a prerequisite or an exclusion changes.',
      'Identifiers are ten characters instead of six: room for millions without a clash. The six-character ones of every earlier file stay valid.',
      'When the browser storage is full, the recovery copy makes room from stale drafts only, never from another document\'s unsaved work.',
      'The authoring import takes «comparison: EQT» without a nominal for what it is — an empty nominal criterion, said — instead of quietly reading the limits as an interval, and a variant value for a range variable can set both ends: { "min": …, "max": … }.',
    ],
  },
  {
    version: '1.35.0',
    date: '2026-09-12',
    changes: [
      'Notes. Press 📝 beside the scrollbar and click the sheet at the height of a line: a coloured mark appears in the right margin, with a name and a text behind it — a pointer resting on it shows them, a click edits them. The mark stays with that line through zoom, folding and edits, because it is attached to the element of the document, not to a height.',
      'Notes are not part of the specification and never make it dirty: they are kept in the browser as they are written, without asking, and they travel in a file of their own — the specification\'s name with .json — which downloads with the next Save when the notes have changed, or from File › Export notes. Name and colour are remembered from one note to the next.',
      'File › Import notes reads somebody else\'s notes file into the document, merged by id: what is new comes in, and where both have a note the later change wins. Every such decision is shown before it is applied. Notes written on another specification or another revision are refused, with the reason.',
      'What changes from one variant to the next is now written in electric blue — the text itself, not a wash behind it — so it is found at a glance among codes and tags. A click on it opens the value it takes in the base document and in every variant, side by side; a pointer resting on it shows the same table without the click.',
      'A pointer resting on any code shows its card where it stands — the command, the point, the resource, and now the interface, the image, the test and the step too, which had no card before; a long card scrolls under the pointer. The click still opens the card on the side, or the editor, as before.',
      'The row between the trail and the sheet is gone. Fold, unfold and Print / PDF sit at the end of the trail, Read is on the rail beside the scrollbar, Word stays in the File menu where it already was. The sheet starts right under the trail.',
      'While editing, the sheet sits in the middle of the window as a sheet does; in reading mode alone it sits on the left, leaving the room on the right to the cards that open there.',
      'A file that is the last issued revision word for word opens straight in reading mode: it is the file being handed out, and whoever opens it came to read. A file edited since the issue, or with work to recover, opens on the editor as before.',
      'In reading mode nothing leads into the editor, whatever the document allows on screen: the codes still open their cards, the Edit button is gone.',
      'The command bar is lighter: Save and Validate are a floppy and a tick with their words in the tooltip, the way back to the document has moved to the button beside the scrollbar — the same place in every editor section — and the count of problems has moved to the status bar, where it is a red plate when there are errors, sand for warnings, and a click opens the validation panel.',
      'Quiet buttons beside the scrollbar that stay put while the sheet moves, in the document view and in reading mode alike: one turns reading mode on and off, one adds a note, and a small ⓘ explains every mark on the page — codes, dotted values, blue text, the coloured tags, the plates under a criterion, KPI — drawn exactly as the page draws them.',
      'No card on a code where its entity is defined — the heading of a stage, the row of a step or of a command — nor on a variable in brackets that has nothing to add: a card that repeats the line under it is noise. The blue mark around such a code still answers with its table.',
      'The trail knows its neighbours: a pointer resting on any of its steps drops the list of what else stands at that level — the other groups, the other sections, the other stages of the chapter, the other tests of the stage — and resting on one of those opens what it contains, a level further down, as far as the steps. Picking anything goes there, and a test or a step picked this way opens its stage in the tree.',
      'Going into reading mode and coming back keeps the same line under the top of the window, and so does a zoom: what is kept is the element under the top edge, not a number of pixels that meant something only in the previous layout. Coming back from the editor keeps its place the same way.',
      'The Commands appendix no longer runs past the edge of the sheet: its ten columns wrap where they used to hold the line, on screen and on paper alike.',
    ],
  },
  {
    version: '1.34.0',
    date: '2026-09-04',
    changes: [
      'Anything can be duplicated: the ⧉ next to the arrows copies a stage with its tests and its steps, a resource, an application point, a parameter — the copy lands next to the original and carries new identifiers, so the two are separate elements from the first keystroke.',
      'What a duplicate points at outside itself is kept — the instrument, the points, the commands — while what it pointed at inside itself follows the copy: a stimulus held on exit names the step of the new stage.',
      'A line under the toolbar says where you are, from the group of sections down to the step, and every step of it leads back to what it names.',
      'In the document that line follows the reading instead: the chapter, the stage and the test under the eye, each of them a way back up. It is there in reading mode as well, as a plate at the top left that comes back with the pointer and with the scroll, like the zoom controls.',
      'Whatever a variant makes different is marked on a sand background where it is read: a limit that comes from a variable a variant redefines, a step it rewrites, a stage it does not run. The mark is there whether the base document or a variant is on screen — the reader of the base one is the one with no other way of knowing — and hovering it names the variants concerned.',
      'The same mark appears in the editor, on a field some variant rewrites, so a value that is not the same for every product never looks like the only one there is. Under an active variant the field keeps the stronger amber frame it always had.',
      'None of this reaches the paper: a printed document is one product, and prints as it always did.',
      'The unsaved work is copied into the browser every few seconds and offered back when the file is opened again after a crash or a window closed by mistake. It is not a save: the file on disk still changes only when you save it, and the status bar says which of the two you are looking at.',
    ],
  },
  {
    version: '1.33.0',
    date: '2026-09-04',
    changes: [
      'A specification written with protocols now imports: the importer kept no register for them, so the first protocol declared stopped the whole file — and the conversion guide asks for them.',
      'A global variable read only by a text criterion is no longer reported as used by nobody: the check that looks for its readers was still looking only at the numeric limits.',
      'A change to a protocol appears in the comparison under its own chapter, with the protocol named instead of its identifier.',
      'The change record names the fields the recent versions added — comparison type, expected text, passing answer, nominal execution time — where it used to print the internal field name.',
    ],
  },
  {
    version: '1.32.0',
    date: '2026-09-03',
    changes: [
      'The button that freezes a draft is called «Validate», in the command bar and on the draft row: freezing a draft is the act of validating it, and that is the word the process uses.',
      'A text criterion — plain comparison or pattern — takes a constant or a global variable, the same choice a numeric limit has. A firmware release, or the shape of one, is declared once and read by every step that checks it; the document prints the value with the variable name after it, and the name is clickable.',
    ],
  },
  {
    version: '1.31.0',
    date: '2026-09-01',
    changes: [
      'In the revisions page every action sits on the row it acts on: the draft carries «Save as new rev.», an issued revision carries the corrections it allows. The button over the table and the paragraph that had to explain which row it meant are gone.',
    ],
  },
  {
    version: '1.30.0',
    date: '2026-09-01',
    changes: [
      'The «Save as new rev.» shortcut in the command bar explains what freezing a draft means and offers the revisions page, where the whole record is in view, or cancel. The button on that page opens the dialog straight away.',
    ],
  },
  {
    version: '1.29.0',
    date: '2026-09-01',
    changes: [
      'Saving a revision asks for its number and says what will follow: which number is frozen and which one the draft continues with, checked against the ones already issued.',
      'The record of an issued revision can be corrected afterwards — date, author, reason, status — while its content stays frozen.',
    ],
  },
  {
    version: '1.28.0',
    date: '2026-09-01',
    changes: [
      'A pattern criterion prints as the pattern alone: the plate under it already says it is one.',
      'The heading of the acceptance column is centred over the values it heads.',
      'The contents name each stage by its code as well, so a reader looking for STG-04 finds it there.',
    ],
  },
  {
    version: '1.27.0',
    date: '2026-09-01',
    changes: [
      'The acceptance criterion sits in the middle of its cell, across and down, with the plate a little below it.',
      'The parameter names offered while typing are the ones tied to the instrument in use — what it declares and what has been used with it — and they follow a change of instrument at once.',
    ],
  },
  {
    version: '1.26.0',
    date: '2026-09-01',
    changes: [
      'The kind of a criterion is a grey plate under the value, centred and without colour: 123 for a number, Abc for text, RegEx for a pattern, DGT for a yes/no.',
      'A text comparison that ignores case says so on a line of its own; silence means case matters.',
    ],
  },
  {
    version: '1.25.0',
    date: '2026-09-01',
    changes: [
      'A measurement can be judged as text — equal, not equal, contains, starts or ends with, or matching a regular expression — with a case sensitive flag.',
      'A measurement can also be judged as a yes/no: the document says which answer passes.',
      'The three kinds are told apart in the document by a small grey plate under the criterion: 123, Abc, RegEx, DGT.',
      '«Issue revision» is now «Save as new rev.», and the button sits in the command bar next to Save.',
    ],
  },
  {
    version: '1.24.0',
    date: '2026-09-01',
    changes: [
      'Codes no longer shift under a variant: a stage keeps the code it has in the base document, and a gap in the numbering is how the document says a stage is not run here.',
      'The variant matrix is always read from the base document: with a variant on screen it used to drop the very rows one was looking for, and could not name what the variant removes.',
      'A variant is validated against the base document, so its own removals stop being reported as customisations that cannot be applied.',
      'What a version changed is marked by a thicker, brighter bar in the margin; the page keeps its white background.',
    ],
  },
  {
    version: '1.23.0',
    date: '2026-09-01',
    changes: [
      'Protocols: the grammar the messages obey is described once — request, response, rules — and every command says which one it speaks. New chapter of its own in the document.',
      'Any test can be marked KPI, and the tests somebody follows line-side are gathered in an appendix with the criterion each of them is judged by.',
      'The application points of a step start a line of their own, under what is done.',
      'What a version changed is washed in colour across its whole width, not only pinned in the margin.',
    ],
  },
  {
    version: '1.22.0',
    date: '2026-09-01',
    changes: [
      'A half of a step that speaks over a bus reads SET or GET, in colours of its own, instead of APPLY or MEASURE: a command no longer looks like a probe on a pad.',
      'A command block states neither instrument nor application points: both come from the interface it speaks over, and the editor shows them there with a way to open it.',
      'Parameters of a command are its arguments — labelled as such in the editor, and printed in the colour of the command.',
    ],
  },
  {
    version: '1.21.0',
    date: '2026-09-01',
    changes: [
      'An interface declares the instrument that speaks it, and every command over that interface implies it: a step sending a command no longer has to name the instrument, and the bench count and the cycle time include it anyway.',
      'A step whose command has no instrument — neither its own nor the interface one — is reported by validation.',
      'Resource parameters are set apart like the application points, on a sand ground rather than a blue one.',
    ],
  },
  {
    version: '1.20.0',
    date: '2026-09-01',
    changes: [
      'A stage that excludes another wears the same red dash on its own box in the graph, so the constraint is visible without following the line between them.',
      'A step reads in the order it is worked: what is done, then the instrument and the command that do it, then the place, marked with an @ on a pale blue ground.',
      'The wait sits between the stimulus and the measurement, where it is actually spent.',
      'The acceptance criterion has a column of its own again, on screen, in print and in Word.',
    ],
  },
  {
    version: '1.19.0',
    date: '2026-09-01',
    changes: [
      'Reading an issued revision now shows the change record that revision carried: the versions that came after it are listed apart, marked «after this version», and stay selectable.',
      'A superseded revision is impossible to mistake for the current one: red frame, a sticky banner with the way back, and «SUPERSEDED» across the page — on paper as well, so a printed copy says it too.',
    ],
  },
  {
    version: '1.18.0',
    date: '2026-09-01',
    changes: [
      'The version selector moved into the revision history: one radio per row, the row being read marked as such and the row above it marked as what it is compared with.',
      'The draft is a version like the others and is selected by default, so what has changed since the last issue is visible on opening.',
      'Differences are pinned in the margin instead of colouring the text: the pin opens the list of changes, with the previous content labelled as superseded.',
      'The cycle time estimate says why nothing runs in parallel when nothing does, naming the stages whose exclusions forbid it.',
    ],
  },
  {
    version: '1.17.0',
    date: '2026-09-01',
    changes: [
      'An interface declares the application points it is wired to, and a step that speaks through it occupies them — counted like the resources a called setup stage uses.',
      'A command carries its nominal execution time and, optionally, the negative response the unit gives when it refuses.',
      'New «Cycle time estimate»: waits, command times and an average time per instrument give the sequence run one stage at a time and with the stages that may run together.',
      'The viewer can be switched to an issued revision, and what that revision changed is marked in place — red and underlined for a change, green for an addition.',
      'A detail card offers a button that opens the entity in the editor, so every reference leads somewhere.',
      'Steps read shorter: an arrow instead of «to»/«at», the wait as a box of its own after the description, and the wait column gone.',
      'Resource parameter names and units are suggested from the ones already in use, and from what the chosen instrument declares.',
    ],
  },
  {
    version: '1.16.0',
    date: '2026-09-01',
    changes: [
      'The comparison types are now the complete TestStand set, named and described as TestStand names them: the type first, its code beside it, the condition spelled out.',
      'Added the four types that pass outside their limits (LTGT, LEGE, LEGT, LTGE) and «NONE», which records a value and judges nothing.',
      'One list instead of two: nominal with tolerance is the EQT type, and the fields on screen follow the type chosen.',
    ],
  },
  {
    version: '1.15.0',
    date: '2026-09-01',
    changes: [
      'Comparison types for a numeric measurement, optional: a criterion that states none keeps the meaning it always had, so documents written earlier read exactly as before.',
      'A one limit type shows a single field called «Limit», and changing the type moves the value to where the new one reads it.',
      'Shorter text in the specification: «> 12 V», «= 5 V», «11 V … 14 V», with the strict symbol printed only on the end that excludes.',
    ],
  },
  {
    version: '1.14.0',
    date: '2026-09-01',
    changes: [
      '«Document» button in the command bar: one click into the editor, one click back.',
      'Every section remembers where it was scrolled, so coming back to the document lands on the paragraph one left, not at the top.',
      'Fixed the button styling: a state written as a list of classes was collapsed into one unusable name, which is why the Save button never turned amber when there were unsaved changes.',
    ],
  },
  {
    version: '1.13.0',
    date: '2026-09-01',
    changes: [
      'Every code in the document is now a link, its own definition included: the appendix rows, the headings of stages and tests, the step codes and the variables table all open the entity in the editor.',
      'A value bound to a global variable opens the variable: the number one reads is the number one may need to check.',
      'A code inside a foldable heading no longer folds the chapter instead of following the link.',
    ],
  },
  {
    version: '1.12.0',
    date: '2026-09-01',
    changes: [
      'Cross references became links: to the detail card where the entity has one, straight into the editor where it has not.',
      'Prerequisites, parallel exclusions, held stimuli, callers, the variant matrix and the resource appendix carry links instead of plain codes.',
      'New «No direct editing» option in the document header: the links into the editor become plain text, for a document handed out to be read. The detail cards keep working.',
    ],
  },
  {
    version: '1.11.0',
    date: '2026-09-01',
    changes: [
      'Reading mode: the document alone, with the interface out of the way and a strip of controls that appears with the pointer and fades when it stops.',
      'Zoom of the whole sheet — type, tables and figures together — with «Fit width», full screen, and the level remembered between sessions.',
    ],
  },
  {
    version: '1.10.0',
    date: '2026-09-01',
    changes: [
      'Pictures are embedded as WebP: any common format goes in, and a photograph that weighed megabytes now weighs tens of kilobytes.',
      'The Images section states the format, the size and what each picture weighed before, and «Optimise» re-encodes the pictures of a document written earlier.',
      'Vector images are kept as vectors, and the Word export keeps writing PNG, which every version of Word reads.',
    ],
  },
  {
    version: '1.9.0',
    date: '2026-08-30',
    changes: [
      'The logo sits beside the text in the page header, where the pagination engine used to push it above.',
      'Footer of the printed page rebuilt: document, confidentiality and page number share one rule and no longer run into each other.',
      'New «Disclaimer» field, printed in a box at the foot of the cover and carried into Word.',
      'Every application point marker defines the area of the picture worth showing: opening a point gives the crop first, then the whole picture with that area outlined.',
      'The pictures of the appendix open full size like the stage graph, with pan and zoom; the picture scales, the markers keep their size.',
      'The tool is released under the MIT licence — D. Tracchi, written with the assistance of Claude.',
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-30',
    changes: [
      'The step editor shows the row as the document will print it, refreshed as you type.',
      'Stage names and their prerequisites wrap in the tree instead of being cut off.',
      'The company name is set in the typeface of the document, on the cover and on every page.',
      'A logo in the page header is fitted to the two lines beside it and no longer makes the header taller, in print and in Word alike.',
    ],
  },
  {
    version: '1.7.0',
    date: '2026-08-30',
    changes: [
      'The list of sections is a panel that opens on demand and can be pinned open; the document gets the whole width.',
      'The command bar holds one row: what is used now and then moved into the File menu, which no longer repeats the buttons of the document view.',
      'The variant selector is readable: dark text on white, with a label of its own.',
    ],
  },
  {
    version: '1.6.0',
    date: '2026-08-30',
    changes: [
      'Version and changelog page, with the data formats this build reads and writes.',
      'The import and export JSON now carries its format version, and older versions keep being read.',
      'Opening the file lands on the document viewer instead of the header editor.',
      'Unsaved changes are now stated in the toolbar, in the tab title and on the Save button.',
      'New guide for filling a specification in by hand (docs/EDITING-GUIDE.md).',
    ],
  },
  {
    version: '1.5.0',
    date: '2026-08-30',
    changes: [
      'Word export (.docx): heading styles, repeating table headers, running header and footer with «Page X of Y», embedded figures.',
      'The figures reach Word with their markers drawn in, the stage graph as a picture.',
    ],
  },
  {
    version: '1.4.0',
    date: '2026-08-30',
    changes: [
      'Chapters and stages fold away in the viewer; the stage graph opens full size.',
      'A test point is marked on the image with its own TP name instead of the point number.',
      'The resource appendix lists the application points, numbered, and the required characteristics as bullets.',
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-30',
    changes: [
      'Import of a JSON written in the authoring format, with every unresolved reference reported.',
      'Guide for converting an existing specification with the help of a language model.',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-30',
    changes: [
      'Application points are coded AP-xx, no longer TP-xx, which now belongs to the test points themselves.',
      'Setup stages (SET-xx): routines a step calls on demand, kept apart from the test sequence everywhere.',
      'Two revisions can be consolidated into one with «Merge forward».',
      'Resource table: where each resource is applied, and the concurrent channels charged to the calling stage.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-30',
    changes: [
      'The whole system in English, data model included.',
      'The printed document is denser: same content, a third fewer pages.',
      'Every reference carries the code and the name of what it points at.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-30',
    changes: [
      'First version: a single self-contained HTML file that is the editor and the document at once.',
      'Stages, tests and steps; application points on images; resources, commands and interfaces.',
      'Product variants as an overlay on the base document; issued revisions with comparison.',
      'Paginated print through paged.js, with header, footer and page numbers.',
    ],
  },
];

/** "1.6.0" -> [1, 6, 0], for comparing versions rather than strings. */
export const parseVersion = (v) => String(v || '0').split('.').map((n) => Number(n) || 0);

export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  }
  return 0;
}
