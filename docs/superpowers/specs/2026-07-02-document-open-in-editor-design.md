# Documents → "Open in Editor" — Design

**Date:** 2026-07-02
**Repos:** BE (`SmartJobSearchCRM-BE`) + FE (`SmartJobSearchCRM-FE`)
**Status:** Implemented (see Revision 2026-07-03 below)

## Revision 2026-07-03 (as-built — DOCX now keeps its formatting)

Live-testing a real résumé showed plain-text DOCX import destroyed all formatting
(a flat wall of text). The as-built behavior changed:

- **DOCX → formatted HTML**, not plain text. The backend uses `mammoth.convertToHtml`
  (preserving bold, bullet/numbered lists, and paragraph structure) and the frontend
  converts that HTML to editor JSON via a new `htmlToProseMirrorDoc` helper. The endpoint
  now returns `{ ok, kind: 'html' | 'text', content }` (not `{ ok, text }`), so the FE
  knows how to build editor content: `html` → `htmlToProseMirrorDoc`; `.md` →
  `markdownToProseMirrorDoc`; PDF/plain → `textToProseMirrorDoc`.
- **DOCX page-header recovery.** Word often stores the contact block (name / title /
  email / links) in the document page header (`word/header*.xml`), which mammoth (body-only)
  drops — silent data loss. `extractRich` reads the header parts via JSZip and prepends them
  (first line as `<h1>`, rest as `<p>`).
- **Still not recovered** (inherent to DOCX text extraction, acceptable — user re-styles in
  the editor): section-heading *sizes* when the doc uses manual bold (not heading styles),
  shape-drawn horizontal rules, exact spacing/centering/tab columns.
- **PDF** stays plain text (PDFs carry no reliable structure). **Markdown** stays formatted.

The rest of this document describes the original design; the sections below are superseded by
the above where they conflict (notably "PDF / DOCX → plain text" and the `{ ok, text }` shape).

## Goal

Let a user turn an **uploaded** document (from the `/documents` page) into an editable
rich-text document in the in-app editor (`/editor/:id`), via an **"Open in Editor"** button
on each document row. This closes the long-deferred "Documents → Editor" roadmap item.

This mirrors the existing **Cover Letter → "Edit in Editor"** flow (V3-11): extract text →
build a ProseMirror/TipTap document → `createAuthoredDocument` → navigate to the editor.

## Scope

Supported source types: **PDF, DOCX, and Markdown (`.md`)**.

- **PDF / DOCX** → **plain text** only. Formatting, images, columns, and layout are lost;
  the content becomes editable paragraphs. This is the only feasible option without a full
  PDF/DOCX→rich-text converter (out of scope).
- **Markdown** → **formatted rich text**. Headings, bold/italic, lists, links, blockquotes,
  code, and horizontal rules become real editor formatting.

Explicitly **out of scope**: legacy `.doc` (the extractor can't read it), `.txt` (trivially
addable later — deferred to keep scope to the three requested types), scanned/image-only PDFs
(no extractable text → handled as an error, see below), preserving PDF/DOCX visual formatting,
and OCR.

## Non-goals / deferred

- Application linking: the new authored document is **standalone** (no application link).
- `.txt` "Open in Editor" (would reuse the plain-text path; deferred).
- Any change to how documents are stored or downloaded.

## Architecture

### Backend — one new endpoint

`GET /api/documents/:id/text` in the existing `documents` module, `userId`-scoped (same
ownership rules as download):

1. Load the document (404 if not found / not owned).
2. Read the bytes from the storage layer (`storage.createReadStream`/existing read path).
3. Run the **existing** `extractText(buffer, mimeType)` from the analysis engine
   (`src/modules/analysis/engine/extract.js`).
4. Respond `{ ok: boolean, text: string }`.
   - `ok: false` when the type is unsupported or extraction yields fewer than `MIN_CHARS`
     characters (scanned/empty PDF, legacy `.doc`).

**Extraction engine change:** extend `extractText` to handle text types in addition to the
current PDF (pdf-parse) and DOCX (mammoth) branches:

- `text/markdown`, `text/x-markdown`, `text/plain` → `buffer.toString('utf8')`, trimmed,
  `ok` if `length >= MIN_CHARS`.

This returns the **raw markdown source** for `.md` (the FE parses its structure). Adding text
branches is harmless to the résumé-analysis caller (it only ever passes PDF/DOCX résumés).

**Upload widening** (so `.md` files can be uploaded in the first place),
`documents.upload.js` `ALLOWED` set:

- add `text/markdown` and `text/x-markdown` (`text/plain` is already allowed).

No new dependency, **no migration**. The document read-shape (`publicSelect`) already exposes
`mimeType` and `originalFilename`, so no service select change.

### Frontend

**New API function** — `src/api/documents.js`:

```js
export async function getDocumentText(id) {
  const { data } = await api.get(`/documents/${id}/text`);
  return data; // { ok, text }
}
```

**New helper** — `src/lib/markdownToProseMirror.js`:

```js
// markdown -> HTML (marked) -> ProseMirror/TipTap JSON (generateJSON)
export function markdownToProseMirrorDoc(md) { ... }
```

- `marked.parse(md)` → HTML.
- `generateJSON(html, extensions)` (from `@tiptap/core`) → `{ type: 'doc', content: [...] }`.
- `extensions` = a stable minimal set covering standard markdown output: `StarterKit`
  (heading, bold, italic, code, lists, blockquote, hr, paragraph), `Link`, `Underline`.
  These node/mark types are a subset of the editor's full extension set, so the editor loads
  the result cleanly (same reasoning as v1 docs being back-compatible). The root is a plain
  `doc` node with no page attributes — `PageDocument`'s attribute defaults apply, exactly like
  `textToProseMirrorDoc` output today.
- New dependency: **`marked`** (small, no transitive deps).

**Documents page** — `src/pages/Documents.jsx`:

- An **"Open in Editor"** button on each document row (next to Download/Edit/Delete), shown
  **only when** `originalFilename` ends in `.pdf`, `.docx`, or `.md` (case-insensitive).
  Gating on the extension is more robust than MIME (browsers report `.md` as `text/markdown`,
  `text/x-markdown`, or `text/plain` inconsistently).
- On click:
  1. `getDocumentText(id)`.
  2. If `!ok` → inline error: *"No selectable text found — this file may be scanned or
     image-only."*
  3. Else build content: `.md` → `markdownToProseMirrorDoc(text)`; `.pdf`/`.docx` →
     `textToProseMirrorDoc(text)`.
  4. `createAuthoredDocument({ title: doc.name, type: mapType(doc.type), content })`.
  5. `navigate('/editor/' + created.id)`.
- **Type mapping** (`DocumentType` → `AuthoredDocType`): `Resume→Resume`,
  `CoverLetter→CoverLetter`, `Other→Note`.
- Loading state on the button while extracting/creating; disable to prevent double-submit.

**Upload form** — same page: widen the file picker `accept` to include `.md,text/markdown`
and update the helper copy ("PDF, DOC, DOCX, or Markdown · up to 5 MB").

### Data flow

```
[Documents row] --click "Open in Editor"-->
  GET /api/documents/:id/text  --> extractText(bytes, mime) --> { ok, text }
    ok:false --> inline error, stop
    ok:true  --> (.md ? markdownToProseMirrorDoc : textToProseMirrorDoc)(text)
             --> POST /authored-documents { title, type, content }
             --> navigate(/editor/:newId)
```

## Error handling

- Unsupported type / empty extraction (`ok:false`) → friendly inline message, no doc created.
- Network / server error on extract or create → generic inline error ("Couldn't open in
  editor. Please try again."). Nothing destructive; the source document is untouched.
- Ownership: `GET /:id/text` returns 404 for another user's document, 401 unauthenticated.

## Testing

**Backend (supertest):**

- PDF fixture → `{ ok:true, text }` containing expected text.
- DOCX fixture → `{ ok:true, text }`.
- Markdown upload → `{ ok:true, text }` returning the raw markdown source.
- Legacy `.doc` (or a scanned/too-short input) → `{ ok:false, text:'' }`.
- Another user's document → 404; unauthenticated → 401.
- Upload allowlist accepts `text/markdown` (widened filter).

Reuses `tests/fixtures/resume.pdf` / `resume.docx`; adds a small markdown fixture/buffer.

**Frontend (Vitest + MSW):**

- `markdownToProseMirrorDoc`: `# H1` → heading node; `**bold**` → bold mark; `- a\n- b` →
  bullet list; a link → link mark. (Pure unit test.)
- Documents page: "Open in Editor" button visible for `.pdf`/`.docx`/`.md`, **hidden** for a
  `.doc`/other row.
- Happy path: click → mocked `getDocumentText` `{ok:true}` → `createAuthoredDocument` called
  with mapped type + content → `useNavigate` called with `/editor/:id` (mirrors the
  cover-letter page test).
- `ok:false` → error message shown, `createAuthoredDocument` **not** called.

## Files

**BE:**
- `src/modules/analysis/engine/extract.js` — add text/markdown/plain branch (+ test).
- `src/modules/documents/documents.upload.js` — allow markdown MIME.
- `src/modules/documents/documents.service.js` — `getText(userId, id)` (fetch + read + extract).
- `src/modules/documents/documents.controller.js` — handler.
- `src/modules/documents/documents.routes.js` — `GET /:id/text` (before any conflicting route).
- Tests: `tests/documents.test.js` (+ extract test).

**FE:**
- `src/api/documents.js` — `getDocumentText`.
- `src/lib/markdownToProseMirror.js` (+ test) — new helper; `marked` dependency.
- `src/pages/Documents.jsx` — button, handler, error state, `mapType`, upload `accept`/copy.
- Reused unchanged: `src/lib/textToProseMirror.js`, `src/api/authoredDocuments.js`.
- Tests: `src/pages/Documents.test.jsx`.
