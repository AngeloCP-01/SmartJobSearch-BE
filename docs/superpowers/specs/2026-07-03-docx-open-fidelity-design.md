# Design — Documents → Editor: DOCX formatting fidelity ("open as original")

**Date:** 2026-07-03
**Repos:** `SmartJobSearchCRM-BE` (extraction), `SmartJobSearchCRM-FE` (rendering)
**Builds on:** `2026-07-02-document-open-in-editor-design.md` (the "Open in Editor" path this refines)

## Problem

When a user opens an uploaded DOCX résumé in the in-app editor, the content is
correct but the **formatting drifts from the original**. Comparing the original
DOCX (rendered to PDF) against the current editor view, four gaps stand out:

| # | Element | Original DOCX | Current editor | Root cause |
|---|---------|---------------|----------------|------------|
| 1 | Section headings | `SUMMARY`, `EXPERIENCE`, … each have a **full-width horizontal rule** beneath them | Plain bold paragraph, no rule | The rules are a résumé *convention* — the file has no border data to read (see Investigation) |
| 2 | Two-column line | `Mobile: …` (left) ⇢ `Databases: …` (right), tab-aligned on one line | Runs together: "React Native Databases:" | Word **tab stops** survive as literal `\t` in mammoth's HTML, which the browser collapses to a single space |
| 3 | Line spacing | Tight; fits ~1 page | Loose paragraph gaps; spills to 2+ pages | The editor's `prose` **inter-paragraph margins**, not the source (source is a modest 1.15 line-height) |
| 4 | Heading semantics | Section labels are distinct headings | Emitted as bold `<p>`, not headings | mammoth maps manual-bold labels to bold paragraphs, not headings |

Header/contact-block recovery (name/title/email/links) already works
(`extractDocxHeader`, shipped in V3-12). Bold/italic and bullet/numbered **lists**
also already work (mammoth). This design closes the four formatting gaps above.

## Investigation (why the approach is what it is)

Parsing the real `docs/Fullstack-Software-Developer.docx` (`word/document.xml`,
`styles.xml`, `header1.xml`) established the ground truth the design depends on:

- **No paragraph borders and no paragraph styles anywhere in the body.** The
  section labels are plain bold runs; the horizontal rules visible in the goal
  PDF are **not encoded in the file**. → Section headings must be identified by
  **inference**, not by reading a border. Decision: a **curated résumé-section
  label list** (high precision; a bold job title is never mislabeled).
- **Tab columns are real and survive mammoth**: mammoth emits the Word tab stops
  as literal `\t` characters inside the `<p>` (verified in its output). → Tab
  columns can be detected directly on the HTML string — **no `document.xml`
  parsing required.**
- **The contact block is centered** via `w:jc="center"`, but it lives in
  `word/header1.xml` (which `extractDocxHeader` already reads), not the body. →
  Center the recovered header block when its source paragraphs are centered.

Consequence: the entire backend change is a **pure HTML post-process** on
mammoth's output plus header-centering. No new `document.xml` walker, far fewer
failure modes than the first draft of this spec assumed.

## Goal

**Editable + close ("as-imported").** Imported content stays real, editable
TipTap content (paragraphs, headings, lists, tables you can retype). Push visual
fidelity as close to the original as feasible for all four gaps. Not a goal:
pixel-perfect reproduction, or preserving DOCX visually at the expense of
editability.

## Chosen approach — mammoth + HTML post-process

Keep `mammoth.convertToHtml` for the body — it is genuinely strong at the hard
parts (bold/italic and bullet/numbered **lists** via `numbering.xml`). Then run
a **string post-process** over its HTML to close the gaps, and center the
recovered header. **Safety net:** the post-process is wrapped in try/catch — any
problem returns mammoth's original HTML, so it can **never regress**.
`extractText` (the résumé keyword-analysis path) is untouched.

## Backend design (`src/modules/analysis/engine/extract.js`)

### 1. `SECTION_LABELS` — curated set (module constant)

Normalized (lowercase, trimmed, trailing `:` removed) résumé section labels:

```
summary, professional summary, profile, objective, career objective,
technical skills, skills, core competencies, experience, work experience,
professional experience, employment history, projects, education,
certifications, certifications & licenses, awards, achievements, publications,
languages, interests, references, volunteer experience, additional information,
contact
```

`normalizeLabel(s)` = strip HTML tags → decode entities → trim →
collapse internal whitespace → strip a single trailing `:` → lowercase.

### 2. `postProcessDocxHtml(html)` — new exported helper

Walks the top-level `<p>…</p>` blocks of mammoth's output (its output is flat and
predictable) and rewrites specific paragraphs:

- **Section heading:** if `normalizeLabel(innerText) ∈ SECTION_LABELS` →
  `<h2 data-rule="true">…innerHTML…</h2>` (closes #1 + #4 together).
- **Tab-column line:** else if the paragraph's inner HTML contains a run of one
  or more tab characters (`\t+`) that splits it into a **non-empty left and
  non-empty right** segment → emit a borderless two-cell table:
  `<table class="doc-columns"><tbody><tr><td>{left}</td><td>{right}</td></tr></tbody></table>`
  (closes #2). Only the **first** tab run is used (two columns). A paragraph with
  only a leading/trailing tab (empty other side) is **not** a column line — strip
  the stray tab(s) and keep it a `<p>`.
- **Otherwise:** strip any stray tab characters, keep the `<p>` unchanged.

Inline marks inside a rewritten paragraph are preserved (we rewrite the wrapper /
split on tabs, never the inner formatting). Wrapped in try/catch → returns the
input `html` unchanged on any error.

### 3. `extractDocxHeader` — center the recovered block

When a header paragraph's source has `w:jc="center"`, emit its line centered so
the contact block matches the original:
`<h1 style="text-align:center">…</h1>` / `<p style="text-align:center">…</p>`.
(The existing per-line loop already has each `<w:p>` chunk; read its `w:jc`.)
Left-aligned headers stay left-aligned (faithful, not forced-center).

### 4. `extractRich` — DOCX branch wiring

```
const headerHtml = await extractDocxHeader(buffer);              // now may be centered
const body = (await mammoth.convertToHtml({ buffer })).value || '';
const html = headerHtml + postProcessDocxHtml(body);            // post-process
// ok measured on stripped-text length, as today
return { ok, kind: 'html', content: html };
```

Return shape unchanged: `{ ok, kind: 'html', content }`.

Gap #3 (compact spacing) is **not** a backend concern — handled once as FE CSS.

## Frontend design (`SmartJobSearchCRM-FE`)

### (a) Align the import converter with the editor schema — REQUIRED

`src/lib/htmlToProseMirror.js` currently loads only
`[StarterKit, Link, Underline]`, so `<table>` nodes and `text-align` styles are
**silently dropped** by `generateJSON`. Expand its extension set to the exact
node/mark types `DocumentEditor` renders that the post-process now emits:

```
[ StarterKit, Link, Underline, TextAlign,
  Table, TableRow, TableHeader, TableCell,
  HeadingRule ]   // the extension below; adds the `rule` attr to headings
```

Still a strict subset of the editor's extensions, so imported docs load cleanly.
Without this, the new `<table>`, centered header, and heading rule would not
survive import.

### (b) `HeadingRule` extension — persist the rule flag

`src/components/extensions/headingRule.js`, matching the repo's existing
`FontSize`/`LineHeight` pattern (an `Extension` with `addGlobalAttributes`, not a
node subclass):

```js
import { Extension } from '@tiptap/core';
export const HeadingRule = Extension.create({
  name: 'headingRule',
  addGlobalAttributes() {
    return [{
      types: ['heading'],
      attributes: {
        rule: {
          default: false,
          parseHTML: (el) => el.getAttribute('data-rule') === 'true',
          renderHTML: (attrs) => (attrs.rule ? { 'data-rule': 'true' } : {}),
        },
      },
    }];
  },
});
```

Registered in **both** `DocumentEditor` (extensions array) and
`htmlToProseMirror` so the flag round-trips through the existing save/load PATCH.
Draws the rule **only** on headings the backend marked — never every heading.

### (c) CSS — rule, compact spacing, borderless columns (`src/index.css`)

Scoped to `.tiptap` / the editor sheet, screen **and** `@media print` (so the
printed PDF matches):

- `.tiptap h2[data-rule="true"] { border-bottom: 1px solid #333; padding-bottom: 2px; }`
- Tighten paragraph / heading / list-item margins to résumé density (gap #3 — the
  change that returns it to ~1 page). Scope carefully so authoring new docs and
  task-lists (which already override spacing) are unaffected.
- `.tiptap table.doc-columns, .tiptap table.doc-columns td { border: none; }` +
  auto layout, so the imported tab-column table reads as aligned columns, not a
  data grid. (Note: existing `.tiptap table` CSS sets collapse/borders — the
  `.doc-columns` variant must override them.)

No toolbar or UX changes. This only affects how imported DOCX content lands and
renders; authoring new documents is unaffected.

## Data flow

```
Documents row "Open in Editor"
  → GET /api/documents/:id/text
      → extractRich(buffer, DOCX)
          → extractDocxHeader      (contact block, centered when source is)
          → mammoth.convertToHtml  (body: bold/italic/lists)
          → postProcessDocxHtml    (curated headings→h2[data-rule], tab line→table)
          → { ok, kind:'html', content }
  → FE: htmlToProseMirrorDoc(content)   [schema now incl. Table/TextAlign/HeadingRule]
  → createAuthoredDocument → navigate /editor/:id
  → DocumentEditor renders (h2 rules, columns, compact spacing, print-matched)
```

## Testing

TDD + subagent pattern, matching prior editor batches. Most tests operate on
**HTML strings** (no binary fixtures needed); one integration test uses the real
DOCX.

- **BE unit (`extract.test.js`):**
  - `normalizeLabel`: strips tags/entities/colon/case (`'<strong>SUMMARY </strong>'`
    → `'summary'`).
  - `postProcessDocxHtml`:
    - `<p><strong>SUMMARY </strong></p>` → `<h2 data-rule="true">…</h2>`.
    - a curated label with a trailing colon (`Technical Skills`) → `<h2 data-rule>`.
    - a **non-label** bold job title (`Software Developer (Full Stack…)`) stays a
      `<p>` (no false rule).
    - a `\t`-split line (`Mobile…\t\t\tDatabases…`) → `table.doc-columns` with two
      cells; a leading/trailing-only tab line stays a `<p>` with tabs stripped.
  - `extractDocxHeader`: a centered source line → `text-align:center`.
  - `extractRich` DOCX branch integration on the real
    `Fullstack-Software-Developer.docx` fixture: asserts a ruled `<h2>` for
    SUMMARY, the columns table for Mobile/Databases, and the centered contact
    block.
  - **Fallback:** `postProcessDocxHtml` on malformed input returns it unchanged;
    a mammoth failure path still yields today's behavior.
- **FE unit:**
  - `htmlToProseMirrorDoc` preserves `<h2 data-rule="true">` (→ heading node
    `rule:true`), preserves a `<table>` (not dropped), preserves centered
    alignment.
  - `HeadingRule` round-trips (`parseHTML` true ↔ `renderHTML` emits `data-rule`).
- **Verification:** re-open the sample DOCX in the running app;
  screenshot-compare against the goal PDF (rules present, ~1-page density,
  Mobile/Databases columns aligned).

## Known limits (honest, carried forward)

- Section rules are drawn on **recognized** labels only (curated list); an
  unusual/custom section label imports as a plain bold paragraph (user can style
  it). No false rules on job titles.
- Only **two-segment** tab lines become columns; 3+ tab stops fall through as a
  normal paragraph.
- Exact font sizes / pixel metrics are not reproduced (editable-close, not
  pixel-perfect).
- **PDF** uploads stay plain text (no reliable structure) — unchanged.
- `.doc` (legacy) and `.txt` open remain out of scope.
