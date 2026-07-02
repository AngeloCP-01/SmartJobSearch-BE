# Cover Letter "Edit in Editor" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Edit in Editor" button to the Cover Letter page that converts the generated letter to rich text, creates an AuthoredDocument, and opens it in the TipTap Editor.

**Architecture:** A pure `textToProseMirrorDoc` helper converts plain text to ProseMirror JSON; the Cover Letter page gains an "Edit in Editor" button whose mutation calls the existing `createAuthoredDocument` API and navigates to `/editor/:id`. Frontend-only; no backend changes.

**Tech Stack:** React 18, Vite, React Router, TanStack Query, TipTap 2.x, Vitest 2 + Testing Library (jsdom) + MSW, Tailwind CSS.

## Global Constraints

- Frontend-only. Work in `/Users/angelito/personal/SmartJobSearchCRM/SmartJobSearchCRM-FE`. No backend/storage changes.
- Branch: `feat/cover-letter-open-in-editor` (already checked out in both repos).
- No new dependencies. Icon from the installed `lucide-react` (`SquarePen`).
- Test runner: `npm test` (= `vitest run`). Focused: `npm test -- <path>`. Full suite must stay pristine after every task (a pre-existing Recharts stderr line is unrelated).
- The AuthoredDocument is created with `type: 'CoverLetter'`; title `Cover Letter — <position or "Untitled">`; `content` = the converted JSON; `applicationId` when an application is selected.
- Additive only — the existing textarea, Copy, `.txt` download, and "Save to Documents" flows are untouched.

---

### Task 1: `textToProseMirrorDoc` helper

**Files:**
- Create: `src/lib/textToProseMirror.js`
- Test: `src/lib/textToProseMirror.test.js`

**Interfaces:**
- Produces: `textToProseMirrorDoc(text)` → `{ type: 'doc', content: Array<paragraphNode> }`, one paragraph per line of `text` (blank line → empty paragraph). Handles `null`/`undefined` as empty.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/textToProseMirror.test.js`:

```javascript
import { textToProseMirrorDoc } from './textToProseMirror';

test('wraps each line in a paragraph', () => {
  expect(textToProseMirrorDoc('Hello\nWorld')).toEqual({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'World' }] },
    ],
  });
});

test('blank lines become empty paragraphs', () => {
  expect(textToProseMirrorDoc('A\n\nB').content).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
  ]);
});

test('empty or nullish input yields a single empty paragraph', () => {
  const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
  expect(textToProseMirrorDoc('')).toEqual(empty);
  expect(textToProseMirrorDoc(null)).toEqual(empty);
  expect(textToProseMirrorDoc(undefined)).toEqual(empty);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/textToProseMirror.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helper**

Create `src/lib/textToProseMirror.js`:

```javascript
// Convert plain text (e.g. a generated cover letter) into a ProseMirror/TipTap
// document: one paragraph per line, blank lines as empty paragraphs. Feeds
// DocumentEditor directly (no images, so no migration needed).
export function textToProseMirrorDoc(text) {
  const content = String(text ?? '')
    .split('\n')
    .map((line) =>
      line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' },
    );
  return { type: 'doc', content };
}
```

(`''.split('\n')` is `['']`, so empty input yields exactly one empty paragraph.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/textToProseMirror.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/textToProseMirror.js src/lib/textToProseMirror.test.js
git commit -m "feat(fe): textToProseMirrorDoc helper (plain text -> TipTap JSON)"
```

---

### Task 2: "Edit in Editor" button on the Cover Letter page

**Files:**
- Modify: `src/pages/CoverLetter.jsx`
- Test: `src/pages/CoverLetter.test.jsx`

**Interfaces:**
- Consumes: `textToProseMirrorDoc` (Task 1); `createAuthoredDocument` from `../api/authoredDocuments`; `useNavigate` from `react-router-dom`.
- Produces: an "Edit in Editor" button (rendered with a generated letter) that creates an AuthoredDocument and navigates to `/editor/:id`.

- [ ] **Step 1: Write the failing test**

In `src/pages/CoverLetter.test.jsx`, add the mock + import near the top (after the existing `vi.mock('../api/documents', ...)` block):

```javascript
const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importActual) => ({
  ...(await importActual()),
  useNavigate: () => navigateMock,
}));
vi.mock('../api/authoredDocuments', () => ({ createAuthoredDocument: vi.fn() }));
```

Add the import alongside the other imports at the top:

```javascript
import { createAuthoredDocument } from '../api/authoredDocuments';
```

Then append this test:

```javascript
test('Edit in Editor creates a CoverLetter AuthoredDocument and navigates to it', async () => {
  navigateMock.mockReset();
  createAuthoredDocument.mockReset().mockResolvedValue({ id: 'ad7' });
  server.use(http.post(`${API}/analysis/cover-letter`, () => HttpResponse.json({
    coverLetter: 'Dear Hiring Team,\n\nI am excited to apply.',
    meta: { position: 'Backend Engineer', companyName: 'Acme', documentName: 'My Resume', model: 'm' },
  }, { status: 201 })));
  renderPage();
  await screen.findByRole('option', { name: 'Backend Engineer' });
  await screen.findByRole('option', { name: 'My Resume' });
  await userEvent.selectOptions(screen.getByLabelText('Application'), 'a1');
  await userEvent.selectOptions(screen.getByLabelText('Résumé'), 'd1');
  await userEvent.click(screen.getByRole('button', { name: /generate/i }));
  await screen.findByLabelText('Cover letter');
  await userEvent.click(screen.getByRole('button', { name: /edit in editor/i }));
  await waitFor(() => expect(createAuthoredDocument).toHaveBeenCalled());
  const body = createAuthoredDocument.mock.calls[0][0];
  expect(body.type).toBe('CoverLetter');
  expect(body.title).toBe('Cover Letter — Backend Engineer');
  expect(body.applicationId).toBe('a1');
  expect(body.content.type).toBe('doc');
  expect(body.content.content[0].content[0].text).toBe('Dear Hiring Team,');
  await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/editor/ad7'));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/pages/CoverLetter.test.jsx`
Expected: FAIL — no "Edit in Editor" button.

- [ ] **Step 3: Add imports to `CoverLetter.jsx`**

At the top of `src/pages/CoverLetter.jsx`:
- Add `SquarePen` to the existing lucide import (line 3):

```javascript
import { PenLine, Copy, Download, Check, Sparkles, Save, SquarePen } from 'lucide-react';
```

- Add these imports after the existing import block (after line 7's `import Button ...`):

```javascript
import { useNavigate } from 'react-router-dom';
import { createAuthoredDocument } from '../api/authoredDocuments';
import { textToProseMirrorDoc } from '../lib/textToProseMirror';
```

- [ ] **Step 4: Add the navigate hook + mutation**

In the `CoverLetter` component, right after `const qc = useQueryClient();` (line 29), add:

```javascript
  const navigate = useNavigate();
```

After the `saveDoc` mutation block (ends ~line 73), add:

```javascript
  // Convert the current letter to rich text, create an editable AuthoredDocument
  // (linked to the application), and open it in the TipTap Editor.
  const openInEditor = useMutation({
    mutationFn: () => createAuthoredDocument({
      title: `Cover Letter — ${meta?.position || 'Untitled'}`,
      type: 'CoverLetter',
      content: textToProseMirrorDoc(letter),
      applicationId: applicationId || undefined,
    }),
    onSuccess: (doc) => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['authoredDocuments'] });
      navigate(`/editor/${doc.id}`);
    },
    onError: (e) => setError(e.response?.data?.error?.message || 'Could not open the cover letter in the editor.'),
  });
```

- [ ] **Step 5: Add the button**

In the actions row, insert the "Edit in Editor" button between the `.txt` download `Button` and the "Save to Documents" `Button` (i.e. after the `Download` button block that ends `</Button>` around line 128, before the `saveDoc` button):

```jsx
              <Button type="button" variant="subtle" onClick={() => openInEditor.mutate()} loading={openInEditor.isPending}>
                <SquarePen size={16} aria-hidden="true" /> Edit in Editor
              </Button>
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -- src/pages/CoverLetter.test.jsx`
Expected: PASS — including the existing filename/generate/save/AI tests (the new `react-router-dom` mock preserves the real module via `importActual`, so nothing else breaks).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 8: Commit**

```bash
git add src/pages/CoverLetter.jsx src/pages/CoverLetter.test.jsx
git commit -m "feat(fe): 'Edit in Editor' button opens a cover letter in the TipTap editor"
```

---

### Task 3: Verification

**Files:** Reference only (verify against the running app).

- [ ] **Step 1: Full unit suite green**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 2: Browser walkthrough (Playwright MCP / manual)**

On `localhost:5173` (log in via "Try the live demo" if the session expired):
- Go to Cover Letter, pick an application with a job description + a résumé, Generate.
- Optionally edit the textarea, then click **Edit in Editor**.
- Confirm it navigates to `/editor/:id`, the letter shows as editable paragraphs, formatting works, and autosave persists.
- Confirm the new doc appears in the Editor list as a Cover Letter, and the existing Copy / .txt / Save-to-Documents actions still work.

- [ ] **Step 3: Record outcome**

Note pass/fail per check. If any fail, loop back to the owning task.

---

## Self-Review

**Spec coverage:**
- `textToProseMirrorDoc` helper (paragraphs, blank lines, empty input) → Task 1. ✓
- "Edit in Editor" button: convert → create AuthoredDocument (`type: CoverLetter`, title, content, applicationId) → navigate `/editor/:id` → Task 2. ✓
- Additive; existing flows untouched → Task 2 inserts a button, changes no existing handler. ✓
- Error surfaced via page `error` state → Task 2 mutation `onError`. ✓
- No backend changes → none in plan. ✓
- Frontend-only, no new deps → helper + button, `SquarePen` from installed lucide. ✓

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `textToProseMirrorDoc(text)` returns `{ type: 'doc', content }` used verbatim as the create `content`; `createAuthoredDocument(body)` body shape matches the API (`{ title, type, content, applicationId }`); `navigate('/editor/'+doc.id)` uses the created doc's `id`. ✓
