# Documents → "Open in Editor" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Open in Editor" button to the Documents page that converts an uploaded PDF/DOCX (plain text) or Markdown (formatted rich text) into a new authored document opened in the editor.

**Architecture:** A new `GET /api/documents/:id/text` endpoint reuses the existing analysis `extractText` engine (extended to decode text/markdown) to return `{ ok, text }`. The frontend converts that text to a ProseMirror/TipTap doc — `markdownToProseMirrorDoc` (marked → `generateJSON`) for `.md`, the existing `textToProseMirrorDoc` for PDF/DOCX — then reuses the cover-letter flow (`createAuthoredDocument` → navigate to `/editor/:id`).

**Tech Stack:** Node/Express + Prisma (BE), Jest + supertest (BE tests); React + TanStack Query + TipTap v2 (FE), Vitest + MSW (FE tests); `marked` (new FE dependency).

## Global Constraints

- BE tests run with `npm test` (`NODE_OPTIONS=--experimental-vm-modules jest`), serial; the Postgres test DB is required (existing harness).
- FE tests run with `npx vitest run`.
- No database migration. No change to the document read-shape (`publicSelect` already exposes `mimeType` + `originalFilename`).
- `extractText` returns `{ text, ok }`; `ok` is `text.length >= MIN_CHARS` (30).
- Type mapping `DocumentType → AuthoredDocType`: `Resume→Resume`, `CoverLetter→CoverLetter`, `Other→Note` (the authored enum has no `Other`).
- Button is gated on the filename extension (`.pdf`/`.docx`/`.md`, case-insensitive), not MIME.
- Commit after each task. Conventional-commit messages. Append the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- BE repo: `SmartJobSearchCRM-BE/`. FE repo: `SmartJobSearchCRM-FE/`. Paths below are relative to each repo root.

---

## File Structure

**BE (`SmartJobSearchCRM-BE/`):**
- Modify `src/modules/analysis/engine/extract.js` — add a text/markdown/plain decode branch.
- Modify `src/modules/analysis/engine/extract.test.js` — markdown test.
- Modify `src/modules/documents/documents.upload.js` — allow markdown MIME.
- Modify `src/modules/documents/documents.service.js` — `getText(userId, id)`.
- Modify `src/modules/documents/documents.controller.js` — `getText` handler.
- Modify `src/modules/documents/documents.routes.js` — `GET /:id/text`.
- Modify `tests/documents.test.js` — endpoint + markdown-upload tests.

**FE (`SmartJobSearchCRM-FE/`):**
- Create `src/lib/markdownToProseMirror.js` (+ `src/lib/markdownToProseMirror.test.js`).
- Modify `src/api/documents.js` — `getDocumentText`.
- Modify `src/pages/Documents.jsx` — button, handler, error state, `mapType`, upload `accept`/copy.
- Modify `src/pages/Documents.test.jsx` — visibility + happy-path + error tests.
- Modify `package.json` — add `marked`.

---

## Task 1 (BE): Extend `extractText` to decode text/markdown

**Files:**
- Modify: `src/modules/analysis/engine/extract.js`
- Test: `src/modules/analysis/engine/extract.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `extractText(buffer, mimeType)` now returns `{ ok:true, text }` for `text/markdown`, `text/x-markdown`, and `text/plain` (raw UTF-8, `ok` when `length >= MIN_CHARS`). Unchanged for PDF/DOCX/other.

- [ ] **Step 1: Write the failing test**

Add to `src/modules/analysis/engine/extract.test.js` (after the existing tests, before the closing lines):

```js
test('extracts raw text from a markdown file', async () => {
  const md = Buffer.from('# Backend Engineer\n\nExperienced with **Node.js** and PostgreSQL.');
  const r = await extractText(md, 'text/markdown');
  expect(r.ok).toBe(true);
  expect(r.text).toContain('# Backend Engineer');
  expect(r.text).toContain('**Node.js**');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/analysis/engine/extract.test.js -t markdown`
Expected: FAIL — `r.ok` is `false` (markdown currently hits the `else` → `{ text:'', ok:false }`).

- [ ] **Step 3: Write minimal implementation**

In `src/modules/analysis/engine/extract.js`, add the text constants after the existing `PDF`/`DOCX` constants:

```js
const MD = 'text/markdown';
const MDX = 'text/x-markdown';
const TXT = 'text/plain';
```

Then add a branch inside `extractText`, between the `DOCX` branch and the final `else`:

```js
    } else if (mimeType === MD || mimeType === MDX || mimeType === TXT) {
      text = buffer.toString('utf8');
    } else {
```

(The existing `text = text.trim();` + `ok: text.length >= MIN_CHARS` lines already apply.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/analysis/engine/extract.test.js`
Expected: PASS — all extract tests green (including the new markdown one and the previously un-skipped PDF test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/analysis/engine/extract.js src/modules/analysis/engine/extract.test.js
git commit -m "feat(analysis): extractText decodes markdown/plain text

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2 (BE): Markdown upload + `GET /api/documents/:id/text` endpoint

**Files:**
- Modify: `src/modules/documents/documents.upload.js`
- Modify: `src/modules/documents/documents.service.js`
- Modify: `src/modules/documents/documents.controller.js`
- Modify: `src/modules/documents/documents.routes.js`
- Test: `tests/documents.test.js`

**Interfaces:**
- Consumes: `extractText` from Task 1; `storage.createReadStream`; `assertDocument(userId, id)` (existing, throws `NotFoundError`).
- Produces:
  - `service.getText(userId, id): Promise<{ ok: boolean, text: string }>`.
  - Route `GET /api/documents/:id/text` → `200 { ok, text }`; `404` for another user's doc; `401` unauthenticated.
  - Upload allowlist now accepts `text/markdown` and `text/x-markdown`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/documents.test.js` (after the existing upload tests):

```js
test('accepts a markdown upload', async () => {
  const { token } = await registerAndLogin();
  const res = await upload(token, {
    name: 'Notes', type: 'Other',
    buf: Buffer.from('# Notes\n\nsome content'), filename: 'notes.md', contentType: 'text/markdown',
  });
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ mimeType: 'text/markdown' });
});

test('GET /:id/text returns extracted text for a markdown document', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token, {
    name: 'Notes', type: 'Other',
    buf: Buffer.from('# Backend Engineer\n\nNode.js and PostgreSQL experience.'),
    filename: 'notes.md', contentType: 'text/markdown',
  });
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
  expect(res.body.text).toContain('# Backend Engineer');
});

test('GET /:id/text returns ok:false for an unparseable document', async () => {
  const { token } = await registerAndLogin();
  const created = await upload(token); // the fake PDF buffer can't be parsed
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(token));
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(false);
  expect(res.body.text).toBe('');
});

test('GET /:id/text is 404 for another user\'s document', async () => {
  const a = await registerAndLogin();
  const b = await registerAndLogin();
  const created = await upload(a.token, { buf: Buffer.from('# x\n\ncontent here'), filename: 'x.md', contentType: 'text/markdown' });
  const res = await agent().get(`/api/documents/${created.body.id}/text`).set(auth(b.token));
  expect(res.status).toBe(404);
});

test('GET /:id/text requires authentication (401)', async () => {
  const res = await agent().get('/api/documents/some-id/text');
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/documents.test.js -t "text"`
Expected: FAIL — markdown upload rejected (400) and `/:id/text` returns 404 (route not defined).

- [ ] **Step 3: Widen the upload allowlist**

In `src/modules/documents/documents.upload.js`, extend the `ALLOWED` set:

```js
const ALLOWED = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', // e.g. an AI-generated cover letter saved from the app
  'text/markdown',
  'text/x-markdown',
]);
```

- [ ] **Step 4: Add `getText` to the service**

In `src/modules/documents/documents.service.js`, add the extract import at the top (after the existing requires):

```js
const { extractText } = require('../analysis/engine/extract');
```

Add a stream-to-buffer helper near the top of the module (after `sanitize`):

```js
function readBuffer(key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    storage.createReadStream(key)
      .on('data', (c) => chunks.push(c))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}
```

Add the service function (after `getForDownload`):

```js
async function getText(userId, id) {
  const doc = await assertDocument(userId, id);
  const buffer = await readBuffer(doc.storageKey);
  return extractText(buffer, doc.mimeType); // { text, ok }
}
```

Export it — add `getText` to the module's `module.exports`.

- [ ] **Step 5: Add the controller handler**

In `src/modules/documents/documents.controller.js`, add:

```js
async function getText(req, res, next) {
  try { res.json(await service.getText(req.userId, req.params.id)); }
  catch (e) { next(e); }
}
```

Add `getText` to `module.exports`.

- [ ] **Step 6: Register the route**

In `src/modules/documents/documents.routes.js`, add after the `/:id/file` route:

```js
router.get('/:id/text', ctrl.getText);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest tests/documents.test.js`
Expected: PASS — all documents tests green.

- [ ] **Step 8: Commit**

```bash
git add src/modules/documents/ tests/documents.test.js
git commit -m "feat(documents): GET /:id/text extraction endpoint + markdown upload

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3 (FE): `markdownToProseMirrorDoc` helper

**Files:**
- Create: `src/lib/markdownToProseMirror.js`
- Test: `src/lib/markdownToProseMirror.test.js`
- Modify: `package.json` (add `marked`)

**Interfaces:**
- Consumes: `marked`, `@tiptap/core` `generateJSON`, `@tiptap/starter-kit`, `@tiptap/extension-link`, `@tiptap/extension-underline`.
- Produces: `markdownToProseMirrorDoc(md: string): { type: 'doc', content: [...] }` — a ProseMirror/TipTap JSON document with markdown structure (headings, bold/italic, lists, links) preserved.

- [ ] **Step 1: Install `marked`**

Run (in `SmartJobSearchCRM-FE/`): `npm install marked`
Expected: `marked` added to `package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `src/lib/markdownToProseMirror.test.js`:

```js
import { describe, test, expect } from 'vitest';
import { markdownToProseMirrorDoc } from './markdownToProseMirror';

describe('markdownToProseMirrorDoc', () => {
  test('converts headings, bold, lists, and links to ProseMirror JSON', () => {
    const doc = markdownToProseMirrorDoc('# Title\n\n**bold** and [site](https://a.com)\n\n- one\n- two');
    expect(doc.type).toBe('doc');
    const json = JSON.stringify(doc);
    expect(json).toContain('"type":"heading"');
    expect(json).toContain('"type":"bold"');
    expect(json).toContain('"type":"bulletList"');
    expect(json).toContain('"type":"link"');
  });

  test('handles empty / nullish input without throwing', () => {
    const doc = markdownToProseMirrorDoc('');
    expect(doc.type).toBe('doc');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/markdownToProseMirror.test.js`
Expected: FAIL — module `./markdownToProseMirror` not found.

- [ ] **Step 4: Write the implementation**

Create `src/lib/markdownToProseMirror.js`:

```js
// Convert markdown into a ProseMirror/TipTap document so an uploaded .md file
// opens in the editor with real formatting (headings, bold, lists, links).
// marked (markdown -> HTML) + TipTap generateJSON (HTML -> ProseMirror JSON).
// The extension set is a stable subset of the editor's; the resulting node/mark
// types all exist in DocumentEditor, so it loads cleanly (like textToProseMirror).
import { marked } from 'marked';
import { generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';

const extensions = [StarterKit, Link, Underline];

export function markdownToProseMirrorDoc(md) {
  const html = marked.parse(String(md ?? ''), { async: false });
  return generateJSON(html, extensions);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/markdownToProseMirror.test.js`
Expected: PASS — both tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/markdownToProseMirror.js src/lib/markdownToProseMirror.test.js
git commit -m "feat(fe): markdownToProseMirrorDoc helper (marked + generateJSON)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4 (FE): "Open in Editor" on the Documents page

**Files:**
- Modify: `src/api/documents.js`
- Modify: `src/pages/Documents.jsx`
- Test: `src/pages/Documents.test.jsx`

**Interfaces:**
- Consumes: `getDocumentText(id)`; `textToProseMirrorDoc` (existing, `src/lib/textToProseMirror.js`); `markdownToProseMirrorDoc` (Task 3); `createAuthoredDocument` (existing); `useNavigate`.
- Produces: an "Open in Editor" button on `.pdf`/`.docx`/`.md` rows that creates an authored document and navigates to `/editor/:id`.

- [ ] **Step 1: Add the API function**

In `src/api/documents.js`, add:

```js
export async function getDocumentText(id) {
  const { data } = await api.get(`/documents/${id}/text`);
  return data; // { ok, text }
}
```

- [ ] **Step 2: Write the failing tests**

In `src/pages/Documents.test.jsx`, add these mocks near the top (after the imports, before `renderPage`):

```js
import { vi } from 'vitest';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig()),
  useNavigate: () => navigateMock,
}));
vi.mock('../api/authoredDocuments', () => ({ createAuthoredDocument: vi.fn() }));
```

Add this import with the other imports:

```js
import { createAuthoredDocument } from '../api/authoredDocuments';
```

Add these tests at the end of the file:

```js
const OPENABLE_DOCS = [
  { id: 'd1', name: 'Resume PDF', type: 'Resume', originalFilename: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 1000 },
  { id: 'd2', name: 'Legacy Doc', type: 'Other', originalFilename: 'old.doc', mimeType: 'application/msword', sizeBytes: 1000 },
];

test('shows "Open in Editor" only for supported types', async () => {
  server.use(http.get(`${API}/documents`, () => HttpResponse.json(OPENABLE_DOCS)));
  renderPage();
  await waitFor(() => expect(screen.getByText('Resume PDF')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /open resume pdf in editor/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /open legacy doc in editor/i })).not.toBeInTheDocument();
});

test('Open in Editor creates an authored document and navigates to it', async () => {
  navigateMock.mockReset();
  createAuthoredDocument.mockReset().mockResolvedValue({ id: 'ad9' });
  server.use(
    http.get(`${API}/documents`, () => HttpResponse.json([OPENABLE_DOCS[0]])),
    http.get(`${API}/documents/d1/text`, () => HttpResponse.json({ ok: true, text: 'Backend engineer resume text.' })),
  );
  renderPage();
  await waitFor(() => expect(screen.getByText('Resume PDF')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: /open resume pdf in editor/i }));

  await waitFor(() => expect(createAuthoredDocument).toHaveBeenCalled());
  const body = createAuthoredDocument.mock.calls[0][0];
  expect(body.title).toBe('Resume PDF');
  expect(body.type).toBe('Resume');
  expect(body.content.type).toBe('doc');
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/editor/ad9'));
});

test('Open in Editor shows an error when no text can be extracted', async () => {
  createAuthoredDocument.mockReset();
  server.use(
    http.get(`${API}/documents`, () => HttpResponse.json([OPENABLE_DOCS[0]])),
    http.get(`${API}/documents/d1/text`, () => HttpResponse.json({ ok: false, text: '' })),
  );
  renderPage();
  await waitFor(() => expect(screen.getByText('Resume PDF')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: /open resume pdf in editor/i }));

  await waitFor(() => expect(screen.getByText(/no selectable text found/i)).toBeInTheDocument());
  expect(createAuthoredDocument).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/pages/Documents.test.jsx`
Expected: FAIL — no "Open in Editor" button exists.

- [ ] **Step 4: Implement the button + handler**

In `src/pages/Documents.jsx`:

Add to the imports:

```js
import { useNavigate } from 'react-router-dom';
import { FilePenLine } from 'lucide-react';
import { listDocuments, createDocument, deleteDocument, downloadDocument, getDocumentText } from '../api/documents';
import { textToProseMirrorDoc } from '../lib/textToProseMirror';
import { markdownToProseMirrorDoc } from '../lib/markdownToProseMirror';
import { createAuthoredDocument } from '../api/authoredDocuments';
```

(Replace the existing `../api/documents` import line with the one above; keep the `FileText, ...` lucide import and add `FilePenLine` to it or import separately as shown.)

Add these module-level helpers near the top of the file (after `fmtSize`):

```js
const OPENABLE = new Set(['pdf', 'docx', 'md']);
const extOf = (filename) => (String(filename).match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
const AUTHORED_TYPE = { Resume: 'Resume', CoverLetter: 'CoverLetter', Other: 'Note' };
```

Inside the `Documents` component, add navigation + state (after the existing `useState` hooks):

```js
const navigate = useNavigate();
const [openingId, setOpeningId] = useState(null);
```

Add the handler (after `onDownload`):

```js
async function onOpenInEditor(doc) {
  setError(null);
  setOpeningId(doc.id);
  try {
    const { ok, text } = await getDocumentText(doc.id);
    if (!ok) {
      setError('No selectable text found — this file may be scanned or image-only.');
      return;
    }
    const content = extOf(doc.originalFilename) === 'md'
      ? markdownToProseMirrorDoc(text)
      : textToProseMirrorDoc(text);
    const created = await createAuthoredDocument({
      title: doc.name,
      type: AUTHORED_TYPE[doc.type] || 'Note',
      content,
    });
    navigate(`/editor/${created.id}`);
  } catch {
    setError("Couldn't open in editor. Please try again.");
  } finally {
    setOpeningId(null);
  }
}
```

In the row action buttons (the `<div className="flex shrink-0 items-center gap-1">` block), add — before the Download button — the conditional Open-in-Editor button:

```jsx
{OPENABLE.has(extOf(d.originalFilename)) && (
  <Button variant="subtle" aria-label={`Open ${d.name} in editor`}
    disabled={openingId === d.id} onClick={() => onOpenInEditor(d)}>
    <FilePenLine size={16} aria-hidden="true" />
  </Button>
)}
```

- [ ] **Step 5: Widen the upload picker to accept markdown**

In the same file, update the file `<input>` `accept` attribute and the helper copy:

```jsx
accept=".pdf,.doc,.docx,.md,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown"
```

And change the empty-state helper line:

```jsx
<span className="block text-xs text-slate-500">PDF, DOC, DOCX, or Markdown · up to 5 MB</span>
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/pages/Documents.test.jsx`
Expected: PASS — visibility, happy-path, and error tests green.

- [ ] **Step 7: Run the full FE suite (no regressions)**

Run: `npx vitest run`
Expected: PASS — full suite green (was 225; now higher).

- [ ] **Step 8: Commit**

```bash
git add src/api/documents.js src/pages/Documents.jsx src/pages/Documents.test.jsx
git commit -m "feat(fe): 'Open in Editor' button on the Documents page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] BE: `npm test` — full suite green.
- [ ] FE: `npx vitest run` — full suite green.
- [ ] Manual smoke (optional, needs full stack): upload a `.md` → "Open in Editor" → opens formatted in the editor; upload a real PDF → opens as plain-text paragraphs; a scanned PDF → shows the "no selectable text" message.

## Self-review notes (coverage against spec)

- Spec "BE endpoint" → Task 2. "Extraction engine change (markdown)" → Task 1. "Upload widening" → Task 2 (Step 3) + Task 4 (Step 5, FE picker). "markdownToProseMirrorDoc" → Task 3. "Documents page button/handler/error/type-map" → Task 4. "getDocumentText API" → Task 4 (Step 1). "Testing" (BE supertest + FE Vitest) → Tasks 1–4. No spec requirement left unmapped.
