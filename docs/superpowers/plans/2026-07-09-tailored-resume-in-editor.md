# Draft Tailored Résumé in Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Draft in Editor" button on Tailor Résumé that opens the user's real résumé verbatim in the TipTap editor with a click-to-locate suggestions panel — no AI rewrite.

**Architecture:** One small backend change adds a verbatim `anchor` snippet to each tailoring suggestion (existing `POST /api/analysis/tailor` call, no new endpoint). The frontend reuses the existing Documents→Editor extraction path (via a new shared helper), carries the suggestions to the editor through router navigation state, and renders a `TailoringPanel` that drives the existing Find/Replace extension to highlight each suggestion's anchor.

**Tech Stack:** BE — Node/Express, Zod. FE — React, TanStack Query, React Router, TipTap/ProseMirror, Vitest + Testing Library. Spec: `SmartJobSearchCRM-BE/docs/superpowers/specs/2026-07-09-tailored-resume-in-editor-design.md`.

## Global Constraints

- **No fabrication:** the AI never rewrites the résumé. The résumé opens verbatim; `anchor` is a copied-verbatim résumé snippet and is NEVER passed through `humanize()`. `add` suggestions are read-only notes.
- **`anchor` is single-line and short** (the Find/Replace index inserts a `\n` between blocks, so a match cannot cross block boundaries).
- **Regression-safe:** the editor with no navigation state must behave exactly as today (no panel, no layout change).
- **TDD, DRY, YAGNI, frequent commits.** Network is mocked in tests (the suites already do this).
- Two repos: BE = `SmartJobSearchCRM-BE/`, FE = `SmartJobSearchCRM-FE/`. Run tests from each repo root. BE serial test run: `npx jest --runInBand`. FE: `npx vitest run`.

---

### Task 1: BE — add verbatim `anchor` to tailoring suggestions

**Repo:** BE
**Files:**
- Modify: `src/modules/analysis/analysis.schema.js` (add `anchor` to `tailoringSuggestionSchema`)
- Modify: `src/modules/analysis/analysis.service.js` (prompt lines in `generateTailoringSuggestions`)
- Test: `tests/analysis.test.js` (add one route test)

**Interfaces:**
- Produces: each object in the `/api/analysis/tailor` response `suggestions[]` now has `anchor: string` (`''` for `add`). `meta` unchanged.

- [ ] **Step 1: Write the failing test**

Add to `tests/analysis.test.js` after the existing `test('tailor returns grounded suggestions ...')` block (near line 282):

```js
test('tailor returns the verbatim anchor per suggestion (add anchor is empty)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need PostgreSQL.');
  const docId = await uploadResume(token);

  retrieve.mockResolvedValue([{ documentId: docId, content: 'x', similarity: 0.9 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'rephrase', text: 'Use "architected" instead of "built".', why: 'Stronger verb.', groundedIn: 'this résumé', anchor: 'built REST APIs', severity: 'low' },
      { kind: 'add', text: 'Mention Docker.', why: 'The JD asks for it.', groundedIn: 'My Resume', anchor: '', severity: 'high' },
    ] },
  });

  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  const byKind = Object.fromEntries(res.body.suggestions.map((s) => [s.kind, s]));
  expect(byKind.rephrase.anchor).toBe('built REST APIs'); // verbatim, not humanized
  expect(byKind.add.anchor).toBe('');
  delete process.env.OPENROUTER_API_KEY;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --runInBand -t 'verbatim anchor'`
Expected: FAIL — `byKind.rephrase.anchor` is `undefined` (schema strips the unknown key / service doesn't pass it through).

- [ ] **Step 3: Add `anchor` to the schema**

In `src/modules/analysis/analysis.schema.js`, update `tailoringSuggestionSchema`:

```js
const tailoringSuggestionSchema = z.object({
  kind: z.enum(['add', 'emphasize', 'rephrase', 'remove']),
  text: z.string(),
  why: z.string(),
  groundedIn: z.string(),
  anchor: z.string().optional().default(''), // verbatim résumé snippet; '' for add
  severity: z.enum(['high', 'medium', 'low']),
});
```

- [ ] **Step 4: Update the prompt to request `anchor`**

In `src/modules/analysis/analysis.service.js`, inside the `system` array in `generateTailoringSuggestions`:

Add this line immediately after the `'kind "emphasize", "rephrase", and "remove" operate only on the CURRENT RÉSUMÉ; ...'` line:

```js
    'For "emphasize", "rephrase", and "remove", also set "anchor" to a SHORT snippet (under ~10 words, on ONE line) copied VERBATIM from the CURRENT RÉSUMÉ that the edit targets, so it can be located in the text. For "add", set "anchor" to an empty string.',
```

Replace the exact-shape output-contract line with (adds `anchor` to the shape):

```js
    'Return ONLY one minified JSON object, with no markdown, code fences, or commentary, of exactly this shape: {"suggestions":[{"kind":"add|emphasize|rephrase|remove","text":"the concrete edit","why":"one sentence on why it matters for THIS job","groundedIn":"a document name, or the words this résumé","anchor":"a verbatim snippet from the current résumé, or empty string for add","severity":"high|medium|low"}]}.',
```

Replace the "all fields" line with (adds `anchor`):

```js
    'Every suggestion object MUST include all six fields: kind, text, why, groundedIn, anchor, severity. Never omit "why".',
```

Do NOT change the `suggestions` mapping — `anchor` passes through untouched because the map only rewrites `text`/`why`:
```js
.map((s) => ({ ...s, text: humanize(s.text), why: humanize(s.why) }))
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest --runInBand -t 'verbatim anchor'`
Expected: PASS.

- [ ] **Step 6: Run the full analysis suite (no regressions)**

Run: `npx jest --runInBand tests/analysis.test.js`
Expected: PASS (all existing tailor/cover-letter/analysis tests still green).

- [ ] **Step 7: Commit**

```bash
git add src/modules/analysis/analysis.schema.js src/modules/analysis/analysis.service.js tests/analysis.test.js
git commit -m "feat(analysis): add verbatim anchor to tailoring suggestions"
```

---

### Task 2: FE — shared `fetchEditorContent` helper (extract from Documents)

**Repo:** FE
**Files:**
- Create: `src/lib/openDocumentInEditor.js`
- Modify: `src/pages/Documents.jsx` (use the helper in `onOpenInEditor`)
- Test: `src/lib/openDocumentInEditor.test.js`

**Interfaces:**
- Produces: `fetchEditorContent(documentId: string, filename: string): Promise<{ ok: false } | { ok: true, content: ProseMirrorDoc }>`. Consumed by Task 5 and by `Documents.jsx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/openDocumentInEditor.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchEditorContent } from './openDocumentInEditor';
import { getDocumentText } from '../api/documents';

vi.mock('../api/documents', () => ({ getDocumentText: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe('fetchEditorContent', () => {
  it('converts DOCX html to a ProseMirror doc', async () => {
    getDocumentText.mockResolvedValue({ ok: true, kind: 'html', content: '<p>Hi</p>' });
    const r = await fetchEditorContent('d1', 'resume.docx');
    expect(r.ok).toBe(true);
    expect(r.content.type).toBe('doc');
  });

  it('converts markdown by extension', async () => {
    getDocumentText.mockResolvedValue({ ok: true, kind: 'text', content: '# Hi' });
    const r = await fetchEditorContent('d1', 'resume.md');
    expect(r.ok).toBe(true);
    expect(r.content.type).toBe('doc');
  });

  it('falls back to plain text', async () => {
    getDocumentText.mockResolvedValue({ ok: true, kind: 'text', content: 'plain line' });
    const r = await fetchEditorContent('d1', 'resume.pdf');
    expect(r.content.content[0].content[0].text).toBe('plain line');
  });

  it('returns ok:false when the file has no selectable text', async () => {
    getDocumentText.mockResolvedValue({ ok: false });
    const r = await fetchEditorContent('d1', 'scan.pdf');
    expect(r).toEqual({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/openDocumentInEditor.test.js`
Expected: FAIL — `fetchEditorContent` is not defined (module missing).

- [ ] **Step 3: Create the helper**

Create `src/lib/openDocumentInEditor.js`:

```js
import { getDocumentText } from '../api/documents';
import { textToProseMirrorDoc } from './textToProseMirror';
import { markdownToProseMirrorDoc } from './markdownToProseMirror';
import { htmlToProseMirrorDoc } from './htmlToProseMirror';

const extOf = (filename) => (String(filename).match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

// Fetch an uploaded document's text and convert it to a ProseMirror/TipTap doc
// for the editor. DOCX returns as HTML (formatting preserved), .md as raw
// markdown, PDF/plain as raw text. Returns { ok: false } when the file has no
// selectable text (scanned / image-only) so callers never open an empty draft.
export async function fetchEditorContent(documentId, filename) {
  const { ok, kind, content: raw } = await getDocumentText(documentId);
  if (!ok) return { ok: false };
  let content;
  if (kind === 'html') content = htmlToProseMirrorDoc(raw);
  else if (extOf(filename) === 'md') content = markdownToProseMirrorDoc(raw);
  else content = textToProseMirrorDoc(raw);
  return { ok: true, content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/openDocumentInEditor.test.js`
Expected: PASS.

- [ ] **Step 5: Refactor `Documents.jsx` to use the helper**

In `src/pages/Documents.jsx`:

Add the import (near the other `../lib` imports):
```js
import { fetchEditorContent } from '../lib/openDocumentInEditor';
```

Replace the body of `onOpenInEditor` (the fetch + convert block) so it delegates to the helper:
```js
  async function onOpenInEditor(doc) {
    setError(null);
    setOpeningId(doc.id);
    try {
      const { ok, content } = await fetchEditorContent(doc.id, doc.originalFilename);
      if (!ok) {
        setError('No selectable text found — this file may be scanned or image-only.');
        return;
      }
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

Remove the now-unused imports from `Documents.jsx`: `textToProseMirrorDoc`, `markdownToProseMirrorDoc`, `htmlToProseMirrorDoc`, and `getDocumentText` — ONLY if no other code in the file references them (search the file first; `extOf` is still used by `OPENABLE` filtering at line ~234, so KEEP `extOf`).

- [ ] **Step 6: Run the Documents suite (no regressions)**

Run: `npx vitest run src/pages/Documents.test.jsx src/lib/openDocumentInEditor.test.js`
Expected: PASS with **no edit to `Documents.test.jsx`** — it drives `/documents/:id/text` via MSW, and the helper still calls `getDocumentText` (same endpoint), so the Open-in-Editor tests are unaffected.

- [ ] **Step 7: Commit**

```bash
git add src/lib/openDocumentInEditor.js src/lib/openDocumentInEditor.test.js src/pages/Documents.jsx
git commit -m "refactor(fe): extract fetchEditorContent helper for opening docs in the editor"
```

---

### Task 3: FE — `TailoringPanel` component (click-to-locate)

**Repo:** FE
**Files:**
- Create: `src/components/TailoringPanel.jsx`
- Test: `src/components/TailoringPanel.test.jsx`

**Interfaces:**
- Consumes: an `editor` (TipTap instance with the `findReplace` commands `setSearchTerm`/`findNext`/`clearSearch` from Task V3-7's extension) and `tailoring = { suggestions: Array<{kind,text,why,groundedIn,anchor,severity}>, meta }`.
- Produces: `<TailoringPanel editor tailoring onClose />` default export. Consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `src/components/TailoringPanel.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TailoringPanel from './TailoringPanel';
import { searchKey } from './extensions/findReplace';

vi.mock('./extensions/findReplace', () => ({
  searchKey: { getState: vi.fn(() => ({ matches: [{ from: 1, to: 5 }] })) },
}));

function makeEditor() {
  const calls = [];
  const chain = {};
  ['setSearchTerm', 'findNext', 'clearSearch'].forEach((m) => {
    chain[m] = (...a) => { calls.push([m, ...a]); return chain; };
  });
  chain.run = () => {};
  return { editor: { chain: () => chain, state: {} }, calls };
}

const tailoring = {
  meta: { position: 'Backend Engineer', companyName: 'Acme' },
  suggestions: [
    { kind: 'rephrase', text: 'Use "architected".', why: 'Stronger.', groundedIn: 'this résumé', anchor: 'built REST APIs', severity: 'low' },
    { kind: 'add', text: 'Mention Docker.', why: 'JD asks for it.', groundedIn: 'My Resume', anchor: '', severity: 'high' },
  ],
};

describe('TailoringPanel', () => {
  it('renders actionable suggestions and add-items as notes', () => {
    const { editor } = makeEditor();
    render(<TailoringPanel editor={editor} tailoring={tailoring} onClose={() => {}} />);
    expect(screen.getByText('Use "architected".')).toBeInTheDocument();
    expect(screen.getByText('Mention Docker.')).toBeInTheDocument();
    expect(screen.getByText(/Notes/i)).toBeInTheDocument(); // notes group header
  });

  it('locates a suggestion by its anchor on click', () => {
    const { editor, calls } = makeEditor();
    render(<TailoringPanel editor={editor} tailoring={tailoring} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Use "architected".'));
    expect(calls).toContainEqual(['setSearchTerm', 'built REST APIs']);
    expect(calls).toContainEqual(['findNext']);
  });

  it('shows a hint when the anchor cannot be located', () => {
    searchKey.getState.mockReturnValueOnce({ matches: [] });
    const { editor } = makeEditor();
    render(<TailoringPanel editor={editor} tailoring={tailoring} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Use "architected".'));
    expect(screen.getByText(/couldn't locate/i)).toBeInTheDocument();
  });

  it('clears the search when closed', () => {
    const { editor, calls } = makeEditor();
    const onClose = vi.fn();
    render(<TailoringPanel editor={editor} tailoring={tailoring} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close suggestions'));
    expect(calls).toContainEqual(['clearSearch']);
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/TailoringPanel.test.jsx`
Expected: FAIL — `TailoringPanel` module missing.

- [ ] **Step 3: Implement the component**

Create `src/components/TailoringPanel.jsx`:

```jsx
import { useState } from 'react';
import { X } from 'lucide-react';
import { searchKey } from './extensions/findReplace';

const dot = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-400' };
const kindLabel = { add: 'Add', emphasize: 'Emphasize', rephrase: 'Rephrase', remove: 'Remove' };

// A working-aid side panel shown in the editor when arriving from Tailor Résumé.
// Lists the AI suggestions; clicking one highlights the verbatim résumé snippet
// it targets (via the Find/Replace extension). It NEVER edits the résumé — the
// user applies every change by hand. `add` items are read-only notes.
export default function TailoringPanel({ editor, tailoring, onClose }) {
  const [checked, setChecked] = useState({});
  const [missId, setMissId] = useState(null);
  if (!editor || !tailoring) return null;

  const { suggestions = [], meta } = tailoring;
  const actionable = suggestions.filter((s) => s.kind !== 'add');
  const notes = suggestions.filter((s) => s.kind === 'add');

  const locate = (s, id) => {
    if (!s.anchor) { setMissId(id); return; }
    editor.chain().setSearchTerm(s.anchor).findNext().run();
    const found = (searchKey.getState(editor.state)?.matches.length || 0) > 0;
    setMissId(found ? null : id);
  };
  const close = () => { editor.chain().clearSearch().run(); onClose?.(); };

  return (
    <aside className="w-72 shrink-0 rounded-xl border border-sky-100 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Tailoring suggestions</h2>
        <button type="button" aria-label="Close suggestions" className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={close}>
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {meta?.position && <p className="mb-2 text-xs text-slate-400">{meta.position}{meta.companyName && meta.companyName !== 'the company' ? ` · ${meta.companyName}` : ''}</p>}

      {actionable.length === 0 && notes.length === 0 && (
        <p className="text-sm text-slate-500">No suggestions.</p>
      )}

      <ul className="flex flex-col gap-2">
        {actionable.map((s, i) => (
          <li key={`a${i}`} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                aria-label={`Done: ${s.text}`}
                className="mt-1 h-4 w-4 shrink-0"
                checked={Boolean(checked[`a${i}`])}
                onChange={() => setChecked((c) => ({ ...c, [`a${i}`]: !c[`a${i}`] }))}
              />
              <button type="button" className={`text-left ${checked[`a${i}`] ? 'opacity-50' : ''}`} onClick={() => locate(s, `a${i}`)}>
                <span className="mb-0.5 flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${dot[s.severity]}`} aria-hidden="true" />
                  <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">{kindLabel[s.kind]}</span>
                </span>
                <span className="block text-sm font-medium text-slate-800">{s.text}</span>
                <span className="block text-xs text-slate-500">{s.why}</span>
              </button>
            </div>
            {missId === `a${i}` && (
              <p className="mt-1 text-xs italic text-amber-600">Couldn't locate this in the résumé — edit manually.</p>
            )}
          </li>
        ))}
      </ul>

      {notes.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Notes (not applied)</h3>
          <ul className="flex flex-col gap-2">
            {notes.map((s, i) => (
              <li key={`n${i}`} className="rounded-lg border border-slate-200 bg-white p-2">
                <p className="text-sm font-medium text-slate-800">{s.text}</p>
                <p className="text-xs text-slate-500">{s.why}</p>
                <p className="mt-0.5 text-xs italic text-slate-400">Grounded in {s.groundedIn}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/TailoringPanel.test.jsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/TailoringPanel.jsx src/components/TailoringPanel.test.jsx
git commit -m "feat(fe): TailoringPanel with click-to-locate suggestions"
```

---

### Task 4: FE — thread `tailoring` nav state into the editor

**Repo:** FE
**Files:**
- Modify: `src/pages/EditorDocument.jsx` (read `location.state`, pass down)
- Modify: `src/components/DocumentEditor.jsx` (accept `tailoring` prop, render `TailoringPanel`)
- Test: `src/components/DocumentEditor.test.jsx` (panel shows with prop, absent without)

**Interfaces:**
- Consumes: `TailoringPanel` (Task 3).
- Produces: `DocumentEditor({ content, onChange, tailoring })` — `tailoring` optional; when present renders the panel beside the sheet.

- [ ] **Step 1: Write the failing test**

Add to `src/components/DocumentEditor.test.jsx`:

```jsx
it('renders the tailoring panel when tailoring is provided', async () => {
  const tailoring = {
    meta: { position: 'Backend Engineer' },
    suggestions: [{ kind: 'rephrase', text: 'Use "architected".', why: 'Stronger.', groundedIn: 'this résumé', anchor: 'built', severity: 'low' }],
  };
  render(<DocumentEditor content={{ type: 'doc', content: [] }} onChange={() => {}} tailoring={tailoring} />);
  expect(await screen.findByText('Tailoring suggestions')).toBeInTheDocument();
});

it('renders no tailoring panel by default', async () => {
  render(<DocumentEditor content={{ type: 'doc', content: [] }} onChange={() => {}} />);
  expect(await screen.findByLabelText('Page size')).toBeInTheDocument(); // editor mounted
  expect(screen.queryByText('Tailoring suggestions')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/DocumentEditor.test.jsx`
Expected: FAIL — the first new test can't find "Tailoring suggestions" (prop not handled).

- [ ] **Step 3: Wire the prop + render the panel in `DocumentEditor.jsx`**

Add the import near the other component imports:
```js
import TailoringPanel from './TailoringPanel';
```

Change the signature and add local visibility state (next to the existing `searchOpen` state near line 39):
```js
export default function DocumentEditor({ content, onChange, tailoring }) {
  const [page, setPage] = useState(() => pageOf(content));
  const [searchOpen, setSearchOpen] = useState(false);
  const [showTailoring, setShowTailoring] = useState(Boolean(tailoring));
```

Replace the canvas backdrop block (lines ~130-134) so the sheet and panel sit in a flex row when the panel is shown:
```jsx
      <div className="editor-canvas-backdrop rounded-b-xl border border-t-0 border-sky-100 bg-slate-100 p-6">
        <div className={tailoring && showTailoring ? 'flex flex-wrap items-start gap-4' : ''}>
          <div className={sheetClass}>
            <EditorContent editor={editor} />
          </div>
          {tailoring && showTailoring && (
            <TailoringPanel editor={editor} tailoring={tailoring} onClose={() => setShowTailoring(false)} />
          )}
        </div>
      </div>
```

- [ ] **Step 4: Pass nav state through `EditorDocument.jsx`**

Add `useLocation` to the router import:
```js
import { useParams, useLocation, Link } from 'react-router-dom';
```

In the `EditorDocument` route component, read the nav state and pass it to the form:
```js
export default function EditorDocument() {
  const { id } = useParams();
  const location = useLocation();
  const tailoring = location.state?.tailoring || null;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['authored-document', id],
    queryFn: () => getAuthoredDocument(id),
  });

  if (isLoading) return <Spinner center />;
  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Couldn't load this document.
      </div>
    );
  }
  if (!data) return null;

  return <EditorDocumentForm id={id} initialDoc={data} tailoring={tailoring} />;
}
```

Update `EditorDocumentForm` to accept and forward the prop:
```js
function EditorDocumentForm({ id, initialDoc, tailoring }) {
```
and the render call at the bottom of the form:
```jsx
      <DocumentEditor content={content} onChange={setContent} tailoring={tailoring} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/DocumentEditor.test.jsx`
Expected: PASS (both new tests + existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/pages/EditorDocument.jsx src/components/DocumentEditor.jsx src/components/DocumentEditor.test.jsx
git commit -m "feat(fe): thread tailoring nav state into the editor and render the panel"
```

---

### Task 5: FE — "Draft in Editor" button on Tailor Résumé

**Repo:** FE
**Files:**
- Modify: `src/pages/TailorResume.jsx`
- Test: `src/pages/TailorResume.test.jsx`

**Interfaces:**
- Consumes: `fetchEditorContent` (Task 2), `createAuthoredDocument`, `useNavigate`. Navigates to `/editor/:id` with `{ state: { tailoring: { suggestions, meta } } }` (Task 4 reads it).

- [ ] **Step 1: Write the failing test**

The existing `TailorResume.test.jsx` renders the page WITHOUT a Router and drives the API via MSW (`server.use(...)`). Task 5 makes the component import `useNavigate`, so a file-wide `react-router-dom` mock is **required** — without it the four existing tests would throw on render. Add these three module mocks at the top of the file (after the existing `vi.mock('../api/documents', ...)`), plus the two imports:

```jsx
import { fetchEditorContent } from '../lib/openDocumentInEditor';
import { createAuthoredDocument } from '../api/authoredDocuments';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigateMock }));
vi.mock('../lib/openDocumentInEditor', () => ({ fetchEditorContent: vi.fn() }));
vi.mock('../api/authoredDocuments', () => ({ createAuthoredDocument: vi.fn() }));
```

Add this test (concrete — reuses the file's existing `renderPage`/`pickBoth` helpers and MSW pattern):

```jsx
test('Draft in Editor opens the résumé with the suggestions in nav state', async () => {
  navigateMock.mockReset();
  fetchEditorContent.mockResolvedValue({ ok: true, content: { type: 'doc', content: [] } });
  createAuthoredDocument.mockResolvedValue({ id: 'authored-1' });
  server.use(http.post(`${API}/analysis/tailor`, () => HttpResponse.json({
    suggestions: [{ kind: 'rephrase', text: 'Use "architected".', why: 'Stronger.', groundedIn: 'this résumé', anchor: 'built REST APIs', severity: 'low' }],
    meta: { position: 'Backend Engineer', companyName: 'Acme', documentName: 'My Resume', model: 'm', evidenceCount: 0 },
  }, { status: 201 })));

  const user = userEvent.setup();
  renderPage();
  await pickBoth(user);
  await user.click(screen.getByRole('button', { name: /tailor/i }));
  await screen.findByText('Use "architected".');

  await user.click(screen.getByRole('button', { name: /draft in editor/i }));

  await waitFor(() => expect(createAuthoredDocument).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'Resume', content: { type: 'doc', content: [] } }),
  ));
  expect(navigateMock).toHaveBeenCalledWith(
    '/editor/authored-1',
    expect.objectContaining({ state: expect.objectContaining({ tailoring: expect.objectContaining({ suggestions: expect.any(Array) }) }) }),
  );
});
```

Note: `/tailor/i` still uniquely matches the submit button — "Draft in Editor" does not contain "tailor".

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/TailorResume.test.jsx`
Expected: FAIL — no "Draft in Editor" button exists.

- [ ] **Step 3: Add the button + mutation to `TailorResume.jsx`**

Add imports:
```js
import { useNavigate } from 'react-router-dom';
import { SquarePen } from 'lucide-react';
import { fetchEditorContent } from '../lib/openDocumentInEditor';
import { createAuthoredDocument } from '../api/authoredDocuments';
```

Inside the component, add the navigate hook and mutation (near the other mutations):
```js
  const navigate = useNavigate();

  const draft = useMutation({
    mutationFn: async () => {
      const doc = documents.find((d) => d.id === documentId);
      const { ok, content } = await fetchEditorContent(documentId, doc?.originalFilename);
      if (!ok) {
        const e = new Error('no-text');
        e.friendly = 'No selectable text found in this résumé (it may be scanned or image-only).';
        throw e;
      }
      return createAuthoredDocument({
        title: `Tailored Résumé — ${meta?.position || 'Untitled'}`,
        type: 'Resume',
        content,
        applicationId: applicationId || undefined,
      });
    },
    onSuccess: (created) => {
      setError(null);
      navigate(`/editor/${created.id}`, { state: { tailoring: { suggestions, meta } } });
    },
    onError: (e) => setError(e.friendly || 'Could not open the résumé in the editor.'),
  });
```

Add the button to the results header action row (beside "Copy all" / "Save to Documents", around line 127-134):
```jsx
              <Button type="button" onClick={() => draft.mutate()} loading={draft.isPending} disabled={suggestions.length === 0}>
                <SquarePen size={16} aria-hidden="true" /> Draft in Editor
              </Button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/TailorResume.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full FE suite (no regressions)**

Run: `npx vitest run`
Expected: PASS (all suites green, build-clean).

- [ ] **Step 6: Commit**

```bash
git add src/pages/TailorResume.jsx src/pages/TailorResume.test.jsx
git commit -m "feat(fe): Draft in Editor button on Tailor Résumé"
```

---

## Final verification (after all tasks)

- [ ] BE full suite serial: `cd SmartJobSearchCRM-BE && npx jest --runInBand` → green.
- [ ] FE full suite: `cd SmartJobSearchCRM-FE && npx vitest run` → green.
- [ ] Manual/e2e (the anchor highlight + scroll can't be exercised in jsdom): run both dev servers, Tailor a résumé against an application with a JD, click **Draft in Editor**, confirm the résumé opens verbatim, click a suggestion, confirm the matching text highlights and scrolls into view, and confirm an `add` item appears under Notes with no highlight.
- [ ] Request a whole-branch review (superpowers:requesting-code-review) before merge.

## Notes for the implementer

- `anchor` must stay verbatim — never run it through `humanize()` (that would break the literal match).
- The Find/Replace index separates blocks with `\n`, so a match can't span two paragraphs; that's why the prompt constrains `anchor` to a short single line. A miss is expected sometimes and is handled gracefully (the "couldn't locate" hint).
- Do not add persistence — the panel is intentionally ephemeral (nav state only). A reload dropping the panel is by design; the saved résumé draft remains.
- Keep the editor's no-state path untouched; Task 4's second test guards that.
