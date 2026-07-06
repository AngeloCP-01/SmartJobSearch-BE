# DOCX Open-in-Editor Formatting Fidelity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an uploaded DOCX résumé open in the in-app editor looking close to the original — ruled section headings, tab-aligned two-column lines, centered contact block, and compact ~1-page spacing.

**Architecture:** Backend keeps `mammoth.convertToHtml` for the body and runs a pure **HTML post-process** over its output (curated section-label list → ruled `<h2>`; literal tab runs → borderless two-cell table) plus header-centering; all wrapped so it falls back to today's output on any error. Frontend aligns the import converter with the editor schema (Table/TextAlign + a `HeadingRule` extension carrying a `rule` flag) and adds `.tiptap` CSS for the rule, compact spacing, and borderless columns.

**Tech Stack:** Node + Express + Jest (backend); React + TipTap v2 + Vite + Vitest (frontend); `mammoth`, `jszip` already installed.

## Global Constraints

- **Never regress:** every backend transform is wrapped in try/catch and returns mammoth's original HTML on any error. `extractText` (résumé keyword-analysis path) must stay byte-for-byte unchanged.
- **Editable + close, not pixel-perfect.** Imported content stays real editable TipTap nodes.
- Section rules apply to **curated labels only** — never to bold job titles.
- Only **two-segment** tab lines become columns; other tab paragraphs keep as `<p>` with stray tabs stripped.
- Backend tests: `cd SmartJobSearchCRM-BE && npm test -- extract` (Jest, `--experimental-vm-modules`).
- Frontend tests: `cd SmartJobSearchCRM-FE && npm test` (Vitest).
- Return shape of `extractRich` stays `{ ok, kind, content }`; `kind` for DOCX stays `'html'`.
- Fixture already added: `SmartJobSearchCRM-BE/tests/fixtures/formatted-resume.docx`.

---

## Backend (`SmartJobSearchCRM-BE`)

### Task 1: `normalizeLabel` + `SECTION_LABELS`

**Files:**
- Modify: `src/modules/analysis/engine/extract.js`
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Produces: `normalizeLabel(html: string) => string` (lowercased, tag/entity-stripped, trimmed, one trailing `:` removed); `SECTION_LABELS: Set<string>` (normalized labels). Both exported.

- [ ] **Step 1: Write the failing test** — append to `extract.test.js`:

```js
const { normalizeLabel, SECTION_LABELS } = require('./extract');

describe('normalizeLabel', () => {
  test('strips tags, entities, trailing colon, and lowercases', () => {
    expect(normalizeLabel('<strong>SUMMARY </strong>')).toBe('summary');
    expect(normalizeLabel('Technical Skills:')).toBe('technical skills');
    expect(normalizeLabel('DevOps &amp; Testing')).toBe('devops & testing');
  });
  test('SECTION_LABELS holds normalized résumé sections', () => {
    expect(SECTION_LABELS.has('summary')).toBe(true);
    expect(SECTION_LABELS.has('experience')).toBe(true);
    expect(SECTION_LABELS.has('technical skills')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extract`
Expected: FAIL — `normalizeLabel is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `extract.js`, above `extractText`:

```js
const SECTION_LABELS = new Set([
  'summary', 'professional summary', 'profile', 'objective', 'career objective',
  'technical skills', 'skills', 'core competencies', 'experience', 'work experience',
  'professional experience', 'employment history', 'projects', 'education',
  'certifications', 'certifications & licenses', 'awards', 'achievements',
  'publications', 'languages', 'interests', 'references', 'volunteer experience',
  'additional information', 'contact',
]);

function normalizeLabel(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, '')                 // strip tags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim()             // collapse whitespace
    .replace(/:$/, '')                       // drop one trailing colon
    .trim()
    .toLowerCase();
}
```

Add `normalizeLabel, SECTION_LABELS` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- extract`
Expected: PASS (existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(extract): normalizeLabel + curated SECTION_LABELS"
```

---

### Task 2: `postProcessDocxHtml` — promote curated headings

**Files:**
- Modify: `src/modules/analysis/engine/extract.js`
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Consumes: `normalizeLabel`, `SECTION_LABELS` (Task 1).
- Produces: `postProcessDocxHtml(html: string) => string` (exported). This task handles heading promotion only; Task 3 extends it for tab columns.

- [ ] **Step 1: Write the failing test:**

```js
const { postProcessDocxHtml } = require('./extract');

describe('postProcessDocxHtml — headings', () => {
  test('promotes a curated label paragraph to a ruled h2', () => {
    const out = postProcessDocxHtml('<p><strong>SUMMARY </strong></p><p>body text here</p>');
    expect(out).toContain('<h2 data-rule="true">');
    expect(out).toContain('body text here');
    expect(out).not.toMatch(/<p><strong>SUMMARY/);
  });
  test('leaves a non-label bold job title as a paragraph', () => {
    const html = '<p><strong>Software Developer (Full Stack / Backend-Focused)</strong></p>';
    expect(postProcessDocxHtml(html)).toBe(html);
  });
  test('returns input unchanged on malformed input', () => {
    expect(postProcessDocxHtml('not really <p html')).toBe('not really <p html');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extract`
Expected: FAIL — `postProcessDocxHtml is not a function`.

- [ ] **Step 3: Write minimal implementation** — in `extract.js`:

```js
// Rewrite specific paragraphs of mammoth's DOCX HTML to recover formatting it
// drops. Best-effort: returns the input unchanged on any error (never regresses).
function postProcessDocxHtml(html) {
  try {
    return String(html ?? '').replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (whole, inner) => {
      if (SECTION_LABELS.has(normalizeLabel(inner))) {
        return `<h2 data-rule="true">${inner}</h2>`;
      }
      return whole;
    });
  } catch {
    return html;
  }
}
```

Add `postProcessDocxHtml` to `module.exports`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- extract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(extract): postProcessDocxHtml promotes curated labels to ruled h2"
```

---

### Task 3: `postProcessDocxHtml` — tab lines → borderless columns

**Files:**
- Modify: `src/modules/analysis/engine/extract.js`
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Extends `postProcessDocxHtml` (Task 2). No new export.

- [ ] **Step 1: Write the failing test:**

```js
describe('postProcessDocxHtml — tab columns', () => {
  test('splits a tab-separated line into a borderless two-cell table', () => {
    const html = '<p><strong>Mobile:</strong> Android\t\t\t<strong>Databases:</strong> MySQL</p>';
    const out = postProcessDocxHtml(html);
    expect(out).toContain('<table class="doc-columns">');
    expect(out).toContain('<td><strong>Mobile:</strong> Android</td>');
    expect(out).toContain('<td><strong>Databases:</strong> MySQL</td>');
    expect(out).not.toContain('\t');
  });
  test('a trailing-only tab stays a paragraph with the tab stripped', () => {
    const out = postProcessDocxHtml('<p>Frontend: React, HTML, CSS\t</p>');
    expect(out).toBe('<p>Frontend: React, HTML, CSS</p>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extract`
Expected: FAIL — no `table.doc-columns` produced.

- [ ] **Step 3: Write minimal implementation** — update the paragraph callback in `postProcessDocxHtml` so that, after the heading check, it handles tabs:

```js
function postProcessDocxHtml(html) {
  try {
    return String(html ?? '').replace(/<p\b[^>]*>([\s\S]*?)<\/p>/g, (whole, inner) => {
      if (SECTION_LABELS.has(normalizeLabel(inner))) {
        return `<h2 data-rule="true">${inner}</h2>`;
      }
      const m = inner.match(/^([\s\S]*?\S)\t+([\s\S]*)$/); // first tab run w/ content on left
      if (m) {
        const left = m[1].trim();
        const right = m[2].replace(/\t+/g, ' ').trim();     // fold any further tabs on the right
        if (left && right) {
          return `<table class="doc-columns"><tbody><tr><td>${left}</td><td>${right}</td></tr></tbody></table>`;
        }
      }
      if (inner.includes('\t')) {                            // stray leading/trailing tab, no columns
        return `<p>${inner.replace(/\t+/g, ' ').trim()}</p>`;
      }
      return whole;
    });
  } catch {
    return html;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- extract`
Expected: PASS (Task 2 heading tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(extract): tab lines become borderless two-column tables"
```

---

### Task 4: `extractDocxHeader` centers the contact block

**Files:**
- Modify: `src/modules/analysis/engine/extract.js:37-61` (`extractDocxHeader`)
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Changes `extractDocxHeader` output only: lines whose source `<w:p>` has `w:jc="center"` get `style="text-align:center"`. Signature unchanged.

- [ ] **Step 1: Write the failing test** (builds a tiny header zip in-memory with JSZip, already imported in the test file):

```js
describe('extractDocxHeader centering', () => {
  test('centers header lines whose source paragraph is centered', async () => {
    const doc = new JSZip();
    doc.file('word/header1.xml',
      '<?xml version="1.0"?><w:hdr xmlns:w="x">' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Angelito C. Paa</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Software Developer</w:t></w:r></w:p>' +
      '</w:hdr>');
    const buf = await doc.generateAsync({ type: 'nodebuffer' });
    const html = await extractDocxHeader(buf);
    expect(html).toContain('<h1 style="text-align:center">Angelito C. Paa</h1>');
    expect(html).toContain('<p style="text-align:center">Software Developer</p>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extract`
Expected: FAIL — header emitted without `text-align:center`.

- [ ] **Step 3: Write minimal implementation** — rework the per-chunk loop in `extractDocxHeader` to also capture `w:jc`, and carry alignment through to the emitted HTML. Replace the loop + return with:

```js
    const items = []; // { text, centered }
    for (const name of names) {
      const xml = await zip.file(name).async('string');
      for (const chunk of xml.split(/<w:p[ >]/).slice(1)) {
        const text = [...chunk.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
          .map((m) => m[1]).join('')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .trim();
        const centered = /<w:jc[^>]*w:val="center"/.test(chunk);
        if (text && !seen.has(text)) { seen.add(text); items.push({ text, centered }); }
      }
    }
    if (!items.length) return '';
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const style = (c) => (c ? ' style="text-align:center"' : '');
    const [first, ...rest] = items;
    return `<h1${style(first.centered)}>${esc(first.text)}</h1>`
      + rest.map((it) => `<p${style(it.centered)}>${esc(it.text)}</p>`).join('');
```

(Remove the now-unused `lines` array declaration; keep `seen`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- extract`
Expected: PASS (existing `extractDocxHeader`/`extractRich` tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(extract): center recovered header lines when source is centered"
```

---

### Task 5: Wire `extractRich` + real-fixture integration test

**Files:**
- Modify: `src/modules/analysis/engine/extract.js` (`extractRich` DOCX branch, ~line 78-84)
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Consumes: `postProcessDocxHtml` (Tasks 2-3), centered `extractDocxHeader` (Task 4).
- Produces: no signature change — `extractRich(buffer, DOCX)` now returns formatted HTML.

- [ ] **Step 1: Write the failing test:**

```js
describe('extractRich — DOCX formatting fidelity', () => {
  test('formats the real résumé: ruled headings, columns, centered contact', async () => {
    const r = await extractRich(fixture('formatted-resume.docx'), DOCX);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('html');
    expect(r.content).toContain('<h2 data-rule="true">'); // SUMMARY etc.
    expect(r.content).toContain('<table class="doc-columns">'); // Mobile/Databases
    expect(r.content).toContain('text-align:center'); // contact block
    expect(r.content).not.toContain('\t'); // tabs consumed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- extract`
Expected: FAIL — `extractRich` still returns raw mammoth HTML (no `data-rule`/`doc-columns`).

- [ ] **Step 3: Write minimal implementation** — in the DOCX branch of `extractRich`:

```js
    if (mimeType === DOCX) {
      const headerHtml = await extractDocxHeader(buffer);         // centered contact block
      const body = (await mammoth.convertToHtml({ buffer })).value || '';
      const html = headerHtml + postProcessDocxHtml(body);        // recover headings + columns
      const textLen = html.replace(/<[^>]+>/g, '').trim().length;
      return { ok: textLen >= MIN_CHARS, kind: 'html', content: html };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- extract` then the full suite `npm test`
Expected: PASS; full BE suite green (1 pre-existing skip).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(extract): extractRich applies DOCX formatting recovery"
```

---

## Frontend (`SmartJobSearchCRM-FE`)

### Task 6: `HeadingRule` extension

**Files:**
- Create: `src/components/extensions/headingRule.js`
- Test: `src/components/extensions/headingRule.test.js`

**Interfaces:**
- Produces: `HeadingRule` (a TipTap `Extension`) adding a boolean `rule` attribute to `heading` nodes, parsed from `data-rule="true"` and rendered back.

- [ ] **Step 1: Write the failing test** — round-trip via a minimal editor schema:

```js
import { describe, test, expect } from 'vitest';
import { generateJSON, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { HeadingRule } from './headingRule';

const ext = [StarterKit, HeadingRule];

describe('HeadingRule', () => {
  test('parses data-rule into a heading rule attribute', () => {
    const json = generateJSON('<h2 data-rule="true">SUMMARY</h2>', ext);
    expect(json.content[0].attrs.rule).toBe(true);
  });
  test('renders the rule attribute back to data-rule', () => {
    const json = generateJSON('<h2 data-rule="true">SUMMARY</h2>', ext);
    expect(generateHTML(json, ext)).toContain('data-rule="true"');
  });
  test('a plain heading has rule=false and no data-rule', () => {
    const json = generateJSON('<h2>Plain</h2>', ext);
    expect(json.content[0].attrs.rule).toBe(false);
    expect(generateHTML(json, ext)).not.toContain('data-rule');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- headingRule`
Expected: FAIL — cannot resolve `./headingRule`.

- [ ] **Step 3: Write minimal implementation** — `src/components/extensions/headingRule.js`:

```js
import { Extension } from '@tiptap/core';

// Adds a boolean `rule` attribute to heading nodes, round-tripped as
// data-rule="true". Set by the DOCX importer on recognized section headings so
// CSS can draw the résumé section divider only where the source had one.
export const HeadingRule = Extension.create({
  name: 'headingRule',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          rule: {
            default: false,
            parseHTML: (el) => el.getAttribute('data-rule') === 'true',
            renderHTML: (attrs) => (attrs.rule ? { 'data-rule': 'true' } : {}),
          },
        },
      },
    ];
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- headingRule`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/extensions/headingRule.js src/components/extensions/headingRule.test.js
git commit -m "feat(editor): HeadingRule extension (data-rule attribute on headings)"
```

---

### Task 7: Align import converter + register in editor

**Files:**
- Modify: `src/lib/htmlToProseMirror.js`
- Modify: `src/components/DocumentEditor.jsx:40-65` (extensions array)
- Test: `src/lib/htmlToProseMirror.test.js`

**Interfaces:**
- Consumes: `HeadingRule` (Task 6).
- Produces: `htmlToProseMirrorDoc` now preserves headings-with-rule, tables, and centered alignment.

- [ ] **Step 1: Write the failing test** — append to `htmlToProseMirror.test.js`:

```js
  test('preserves a ruled heading, a table, and centered alignment', () => {
    const html =
      '<h2 data-rule="true">SUMMARY</h2>' +
      '<table class="doc-columns"><tbody><tr><td>Mobile</td><td>Databases</td></tr></tbody></table>' +
      '<p style="text-align:center">Angelito C. Paa</p>';
    const doc = htmlToProseMirrorDoc(html);
    const json = JSON.stringify(doc);
    expect(json).toContain('"rule":true');
    expect(json).toContain('"type":"table"');
    expect(json).toContain('"textAlign":"center"');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- htmlToProseMirror`
Expected: FAIL — table dropped, `rule`/`textAlign` absent (converter lacks those extensions).

- [ ] **Step 3: Write minimal implementation** — replace the imports/extensions in `src/lib/htmlToProseMirror.js`:

```js
import { generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { HeadingRule } from '../components/extensions/headingRule';

const extensions = [
  StarterKit,
  Link,
  Underline,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  HeadingRule,
];
```

Then register `HeadingRule` in `DocumentEditor.jsx` — add the import and put it in the extensions array (near `FindReplace`):

```js
import { HeadingRule } from './extensions/headingRule';
// ...in extensions: [ ... , FindReplace, HeadingRule ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- htmlToProseMirror` then full suite `npm test`
Expected: PASS; full FE suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/htmlToProseMirror.js src/components/DocumentEditor.jsx src/lib/htmlToProseMirror.test.js
git commit -m "feat(editor): import DOCX tables, centered text, and ruled headings"
```

---

### Task 8: CSS — rule, compact spacing, borderless columns

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `h2[data-rule="true"]` and `table.doc-columns` produced by the backend + importer. No JS.

- [ ] **Step 1: Add the rule + borderless-columns styles** — in `src/index.css`, near the existing `/* Editor tables */` block:

```css
/* Imported DOCX: section-heading rule (only where the source had one) */
.tiptap h2[data-rule="true"] {
  border-bottom: 1px solid #333;
  padding-bottom: 2px;
}
/* Imported DOCX: tab-stop two-column line — borderless, auto width */
.tiptap table.doc-columns,
.tiptap table.doc-columns td {
  border: none;
}
.tiptap table.doc-columns { width: 100%; table-layout: auto; margin: 0; }
.tiptap table.doc-columns td { padding: 0; vertical-align: top; }
```

- [ ] **Step 2: Add compact résumé spacing** — in `src/index.css`, scoped to `.tiptap`, tightening prose margins without touching task-list overrides:

```css
/* Résumé-tight spacing so imported/authored docs fit ~1 page */
.tiptap p { margin: 0.15rem 0; }
.tiptap h1, .tiptap h2, .tiptap h3 { margin: 0.5rem 0 0.15rem; }
.tiptap ul:not([data-type="taskList"]),
.tiptap ol { margin: 0.15rem 0; }
.tiptap li { margin: 0.05rem 0; }
```

- [ ] **Step 3: Mirror the styles for print** — inside the existing `@media print { ... }` block (around `src/index.css:86`), so the "Print / Save as PDF" output matches:

```css
  .tiptap h2[data-rule="true"] { border-bottom: 1px solid #000; }
  .tiptap table.doc-columns, .tiptap table.doc-columns td { border: none; }
```

- [ ] **Step 4: Verify in the running app**

Run: `npm run dev`, open Documents, click "Open in Editor" on the sample résumé.
Expected: SUMMARY/EXPERIENCE/etc. show a full-width rule; the Mobile/Databases line sits in two aligned columns; the name/contact block is centered; the document is visibly compact (~1 page). Compare against `SmartJobSearchCRM-BE/docs/screencapture-...docx-2-pdf...pdf`.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat(editor): CSS for section rule, compact spacing, borderless columns"
```

---

## Self-review notes (spec coverage)

- Gap #1 (rules) + #4 (headings): Tasks 1, 2, 6, 7, 8 (curated `<h2 data-rule>` + CSS).
- Gap #2 (tab columns): Tasks 3, 7, 8 (`table.doc-columns`).
- Gap #3 (compact spacing): Task 8.
- Contact centering: Tasks 4, 7, 8 (`text-align:center`).
- Never-regress safety net: Task 2/3 try-catch + Task 5 (full suite green). `extractText` untouched (no task modifies it).
- Import-schema alignment (else new markup is dropped): Task 7.
