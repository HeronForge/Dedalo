// Stylesheet handed to paged.js for pagination.
// It is not in the <head> of the file: if it were, its @page rules would also apply to a
// plain browser print, which instead only has to reproduce the pages paged.js already
// composed (see styles/print.css).

export const pagedStyle = () => `
@page {
  size: A4;
  margin: 22mm 14mm 16mm 14mm;

  @top-left {
    content: element(header);
    vertical-align: bottom;
    padding-bottom: 1.5mm;
    width: 100%;
  }
  /* The footer is two boxes: what the document is on the left, where the reader is on the
     right. The left one stops short of the full width so the page number stays inside the
     text column instead of hanging into the margin. The rule that separates the footer from
     the page is drawn once, on the band that holds both boxes (see styles/print.css), so it
     never breaks between them. */
  @bottom-left {
    content: element(footer);
    vertical-align: top;
    padding-top: 1.5mm;
    width: 82%;
  }
  @bottom-right {
    content: "Page " counter(page) " of " counter(pages);
    font-size: 7.5pt;
    color: #55606b;
    text-align: right;
    vertical-align: top;
    padding-top: 1.5mm;
    white-space: nowrap;
  }
}

/* Wider margins on the cover. Its header and footer are hidden by styles/print.css,
   which acts on the rendered page and is more reliable than a content:none rule here. */
@page :first {
  margin: 22mm 18mm 18mm 18mm;
}

/* The appendices too wide for the page — the commands table, the stage graph — turn the
   page: the same margins and running boxes, the sheet on its side. The graph is then bound
   by the height of the page as much as by its width, or a tall one runs off the foot. */
@page landscape {
  size: A4 landscape;
}
.doc-landscape { page: landscape; }
/* Bound by the height: the graph under its heading must fit the page whole, or the
   paginator, which cannot cut a drawing, leaves it in the overflow where nobody sees it. */
.doc-landscape .doc-graph .graph { width: 100%; height: auto; max-height: 128mm; }

/* Elements repeated on every page. */
.run-header { position: running(header); }
.run-footer { position: running(footer); }

/* Page numbers in the table of contents. */
.doc-toc a::after {
  content: target-counter(attr(href url), page);
  float: right;
  font-variant-numeric: tabular-nums;
}

/* Page breaks: only the cover and the major chapters force a new page, so short
   chapters flow one after the other instead of each wasting a page. */
.doc-cover { break-after: page; }
.doc-chapter-major { break-before: page; }
.doc-h2, .doc-h3, .doc-h4 { break-after: avoid; }
.doc-meta { break-after: avoid; }
.doc-table thead { display: table-header-group; }
.doc-table tr { break-inside: avoid; }
.doc-test { break-inside: auto; }
.doc-figure { break-inside: avoid; }
.doc-note { break-inside: avoid; }
p { orphans: 2; widows: 2; }
`;
