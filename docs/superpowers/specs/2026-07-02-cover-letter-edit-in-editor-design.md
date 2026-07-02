# Cover Letter — "Edit in Editor" design

Date: 2026-07-02
Scope: frontend-only (SmartJobSearchCRM-FE)
Branch: `feat/cover-letter-open-in-editor`

## Problem

The Cover Letter page generates a plain-text letter (editable in a `<textarea>`,
optionally saved as a `.txt` Document). Users want to open that letter in the
rich TipTap Editor to format and refine it. The Editor stores AuthoredDocuments
(ProseMirror JSON); the cover letter is plain text — so we convert and create a
new AuthoredDocument.

Scope decision (locked with the user): do the Cover Letter path only this round;
opening binary Documents (PDF/DOC/DOCX) in the Editor is out of scope (it would
be a lossy text extraction). The "Edit in Editor" action is additive — the
existing textarea, Copy, .txt download, and "Save to Documents" flows are
untouched.

## Decisions (locked)

- **Frontend-only.** No backend changes — `POST /authored-documents` already
  accepts `{ title, type, content, applicationId }` and `type` includes
  `CoverLetter`.
- Add an **"Edit in Editor"** button to the Cover Letter result actions
  (`src/pages/CoverLetter.jsx`, the row with Copy / .txt / Save to Documents).
- On click: convert the current `letter` text → ProseMirror JSON, create an
  AuthoredDocument, navigate to `/editor/:id`.
- Plain-text→JSON conversion is a small pure, unit-tested helper.

## Architecture

### 1. `src/lib/textToProseMirror.js` — new pure helper

`textToProseMirrorDoc(text)` → a ProseMirror doc:
- Split `String(text ?? '')` on `\n`.
- Each line → `{ type: 'paragraph', content: [{ type: 'text', text: line }] }`;
  a blank line → `{ type: 'paragraph' }` (empty paragraph, for spacing).
- If the result is empty, return a single empty paragraph.
- Return `{ type: 'doc', content: paragraphs }`.

This feeds `DocumentEditor` directly (no images → migration is a no-op; the
`doc` node's `pageSize`/`margin` attrs default via the PageDocument extension).

### 2. `src/pages/CoverLetter.jsx` — "Edit in Editor" button

- Import `useNavigate` (react-router), `createAuthoredDocument` from
  `../api/authoredDocuments`, and `textToProseMirrorDoc`.
- Add an `openInEditor` mutation:
  - `mutationFn`: `createAuthoredDocument({ title, type: 'CoverLetter', content:
    textToProseMirrorDoc(letter), applicationId: applicationId || undefined })`.
    `title` = `` `Cover Letter — ${meta?.position || 'Untitled'}` `` (mirrors the
    existing Save-to-Documents name).
  - `onSuccess(doc)`: invalidate `['authoredDocuments']`, then
    `navigate(`/editor/${doc.id}`)`.
  - `onError`: set the page's existing `error` state (same styling as other
    failures); stay on the page.
- Button placed in the actions row (near Copy / .txt / Save to Documents),
  labeled "Edit in Editor" with a suitable lucide icon (e.g. `PenLine` or
  `FileEdit`), `loading={openInEditor.isPending}`. It is only rendered inside
  the `{letter && (...)}` result block, so it's implicitly gated on a generated
  letter.

## Data flow

Generate → user may edit textarea → click "Edit in Editor" →
`textToProseMirrorDoc(letter)` → `POST /authored-documents` →
`navigate(/editor/:id)` → `EditorDocument` loads the new doc → `DocumentEditor`
renders the letter as editable paragraphs, autosaving via the existing PATCH.

## Error / edge handling

- Empty/whitespace letter: the button only appears with a generated letter;
  `textToProseMirrorDoc('')` still yields a valid single-empty-paragraph doc.
- Create failure: surface via the page `error` alert; no navigation.
- `applicationId` optional: omit when not selected (the letter still opens; the
  AuthoredDocument just isn't linked to an application).

## Testing

Unit (Vitest/jsdom):
- `textToProseMirror.test.js`: multi-line text → one paragraph per line;
  blank lines → empty paragraphs; empty input → `{ type: 'doc', content: [{ type:
  'paragraph' }] }`; a single line → one paragraph with the text.
- `CoverLetter.test.jsx` (extend/added): with a generated letter shown, clicking
  "Edit in Editor" calls `createAuthoredDocument` with `type: 'CoverLetter'`,
  the converted `content`, `title`, and `applicationId`, then navigates to
  `/editor/<newId>` (mock the API + `useNavigate`).

Manual / e2e (Playwright MCP):
- Generate a letter → click "Edit in Editor" → lands on `/editor/:id` with the
  letter as editable paragraphs; formatting works; autosave persists; the
  document appears in the Editor list (type Cover Letter).

## Out of scope (YAGNI)

- Opening binary Documents (PDF/DOC/DOCX) in the Editor (lossy; deferred).
- Backend changes / new endpoints.
- Replacing or removing the existing Save-to-Documents / .txt / textarea flow.
- Rich structure inference (headings, bullet detection) from the plain text —
  paragraphs only.
- Two-way sync between the AuthoredDocument and any saved `.txt` Document.
