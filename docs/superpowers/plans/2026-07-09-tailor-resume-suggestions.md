# Tailor Résumé — RAG-grounded Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Tailor Résumé" feature that returns a RAG-grounded checklist of concrete edits to make a selected résumé fit a job's description, with a hard no-fabrication guarantee.

**Architecture:** A new `POST /api/analysis/tailor` endpoint mirrors the cover-letter service: it loads an application + résumé, retrieves the most JD-relevant chunks across all the user's documents via `rag.service.retrieve()`, feeds them as "grounded evidence" to `openrouter.generateJson()` for structured suggestions, and applies a server-side backstop that drops any "add" suggestion not cited to a real retrieved document. The frontend adds a dedicated page cloned from `CoverLetter.jsx`.

**Tech Stack:** Node/Express + Prisma + Zod (backend, Jest + Supertest tests); React + React Query + TanStack + Tailwind (frontend, Vitest + MSW + React Testing Library).

## Global Constraints

- No fabrication: the feature may only suggest adding experience/skills present in the user's retrieved documents. `add` suggestions must cite the source document in `groundedIn`; the server drops uncited `add`s.
- Everything is `userId`-scoped (application, document, retrieval) — reuse the existing `findFirst({ where: { id, userId } })` guards.
- Output is ephemeral: nothing is persisted server-side (mirror `generateCoverLetter`, not `run`).
- Reuse existing helpers verbatim: `readBuffer`, `extractText`, `humanize`, error classes (`NotFoundError`, `ValidationError`, `AppError`), `openrouter.generateJson`, `rag.service.retrieve`.
- `DocumentType` enum is `Resume | CoverLetter | Other`; tailoring notes save as `Other`.
- Prose fields returned to the client are run through `humanize()` (same AI-tell scrubbing the cover letter uses).

---

## File Structure

**Backend (`SmartJobSearchCRM-BE/`)**
- Modify `src/modules/analysis/analysis.schema.js` — add `tailorSchema`, `tailoringSuggestionSchema`, `tailoringResultSchema`.
- Modify `src/modules/analysis/analysis.service.js` — add `generateTailoringSuggestions`; import `retrieve` + `generateJson` + `tailoringResultSchema`.
- Modify `src/modules/analysis/analysis.controller.js` — add `tailor` handler.
- Modify `src/modules/analysis/analysis.routes.js` — register `POST /tailor`.
- Modify `tests/analysis.test.js` — add the tailoring integration tests + mock `rag.service`.

**Frontend (`SmartJobSearchCRM-FE/`)**
- Modify `src/api/analysis.js` — add `tailorResume`.
- Create `src/pages/TailorResume.jsx` — the page.
- Create `src/pages/TailorResume.test.jsx` — the FE tests.
- Modify `src/App.jsx` — lazy import + route `/tailor`.
- Modify `src/components/Layout.jsx` — nav entry.

---

## Task 1: Backend — `POST /api/analysis/tailor`

**Files:**
- Modify: `src/modules/analysis/analysis.schema.js`
- Modify: `src/modules/analysis/analysis.service.js`
- Modify: `src/modules/analysis/analysis.controller.js`
- Modify: `src/modules/analysis/analysis.routes.js`
- Test: `tests/analysis.test.js`

**Interfaces:**
- Consumes: `rag.service.retrieve(userId, queryText, { topK }) → Promise<{ documentId, content, similarity }[]>`; `openrouter.generateJson(messages, zodSchema) → Promise<{ data, model }>`; existing `readBuffer`, `extractText(buffer, mimeType) → { text, ok }`, `humanize(text)`, error classes.
- Produces: `service.generateTailoringSuggestions(userId, { applicationId, documentId }) → Promise<{ suggestions: Suggestion[], meta }>` where `Suggestion = { kind: 'add'|'emphasize'|'rephrase'|'remove', text, why, groundedIn, severity: 'high'|'medium'|'low' }` and `meta = { companyName, position, documentName, model, evidenceCount }`. Route: `POST /api/analysis/tailor` body `{ applicationId: uuid, documentId: uuid }` → 201 with that payload.

- [ ] **Step 1: Add the mock for `rag.service` and the failing integration tests**

At the top of `tests/analysis.test.js`, below the existing openrouter mock (line 8-9), add a mock for the RAG service and require its functions:

```js
jest.mock('../src/modules/rag/rag.service');
const { retrieve, indexDocument } = require('../src/modules/rag/rag.service');
```

Also require `generateJson` alongside the existing openrouter imports (line 9):

```js
const { aiMatch, generateTextWithFallback, generateJson } = require('../src/modules/analysis/engine/openrouter');
```

Because `documents.service` fires `indexDocument(...).catch(...)` on upload, the auto-mock (which returns `undefined`) would throw. Give it a resolved promise in a `beforeEach`:

```js
beforeEach(() => { indexDocument.mockResolvedValue({ chunks: 0 }); });
```

Then append this test block to the end of `tests/analysis.test.js`:

```js
// --- AI résumé tailoring (RAG-grounded) ---

test('tailor returns grounded suggestions and calls retrieve with the JD', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Kafka streaming and PostgreSQL.');
  const docId = await uploadResume(token);

  retrieve.mockResolvedValue([{ documentId: docId, content: 'Built Kafka streaming pipelines at scale.', similarity: 0.9 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'add', text: 'Add your Kafka pipeline work — 250 events/s.', why: 'The JD calls for Kafka streaming.', groundedIn: 'My Resume', severity: 'high' },
      { kind: 'emphasize', text: 'Move PostgreSQL higher.', why: 'Listed as required.', groundedIn: 'this résumé', severity: 'medium' },
    ] },
  });

  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  expect(retrieve).toHaveBeenCalledWith(expect.any(String), 'We need Kafka streaming and PostgreSQL.', { topK: 8 });
  expect(res.body.suggestions).toHaveLength(2);
  expect(res.body.suggestions[0]).toMatchObject({ kind: 'add', groundedIn: 'My Resume', severity: 'high' });
  expect(res.body.meta).toMatchObject({ position: 'Backend Engineer', documentName: 'My Resume', model: 'test/model:free', evidenceCount: 1 });
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor drops an "add" suggestion not grounded in a retrieved document (no fabrication)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Rust.');
  const docId = await uploadResume(token);

  retrieve.mockResolvedValue([{ documentId: docId, content: 'Node.js and PostgreSQL experience.', similarity: 0.8 }]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [
      { kind: 'add', text: 'Add Rust systems programming.', why: 'JD wants Rust.', groundedIn: 'Ghostwriter.pdf', severity: 'high' },
      { kind: 'emphasize', text: 'Emphasize PostgreSQL.', why: 'Adjacent skill.', groundedIn: 'this résumé', severity: 'low' },
    ] },
  });

  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  // The fabricated "add" (grounded in a document that was never retrieved) is removed.
  expect(res.body.suggestions).toHaveLength(1);
  expect(res.body.suggestions[0].kind).toBe('emphasize');
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor still returns suggestions when retrieval is empty', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  retrieve.mockResolvedValue([]);
  generateJson.mockResolvedValue({
    model: 'test/model:free',
    data: { suggestions: [{ kind: 'rephrase', text: 'Lead with impact verbs.', why: 'Reads passively.', groundedIn: 'this résumé', severity: 'medium' }] },
  });
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(201);
  expect(res.body.suggestions).toHaveLength(1);
  expect(res.body.meta.evidenceCount).toBe(0);
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor requires a job description (400)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, undefined);
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(400);
  delete process.env.OPENROUTER_API_KEY;
});

test('tailor needs AI configured → 503, never calls the model, when no key', async () => {
  delete process.env.OPENROUTER_API_KEY;
  generateJson.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role.');
  const docId = await uploadResume(token);
  const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
  expect(res.status).toBe(503);
  expect(generateJson).not.toHaveBeenCalled();
});

test('tailor surfaces a friendly 503 when the AI service fails', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  generateJson.mockReset();
  retrieve.mockReset();
  retrieve.mockResolvedValue([]);
  generateJson.mockRejectedValue(Object.assign(new Error('429 rate limited'), { kind: 'http', status: 429 }));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { token } = await registerAndLogin();
    const appId = await makeApp(token, 'Node.js and PostgreSQL.');
    const docId = await uploadResume(token);
    const res = await agent().post('/api/analysis/tailor').set(auth(token)).send({ applicationId: appId, documentId: docId });
    expect(res.status).toBe(503);
  } finally {
    warn.mockRestore();
    delete process.env.OPENROUTER_API_KEY;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/analysis.test.js -t tailor`
Expected: FAIL — `POST /api/analysis/tailor` is unregistered, so responses are 404 (not the asserted 201/400/503).

- [ ] **Step 3: Add the schemas**

In `src/modules/analysis/analysis.schema.js`, add after `coverLetterSchema` (line 12):

```js
const tailorSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
});

const tailoringSuggestionSchema = z.object({
  kind: z.enum(['add', 'emphasize', 'rephrase', 'remove']),
  text: z.string(),
  why: z.string(),
  groundedIn: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
});

const tailoringResultSchema = z.object({
  suggestions: z.array(tailoringSuggestionSchema).max(12),
});
```

Update the exports line at the bottom:

```js
module.exports = {
  runAnalysisSchema, coverLetterSchema, tailorSchema,
  analysisReportSchema, tailoringResultSchema,
};
```

- [ ] **Step 4: Add the service function**

In `src/modules/analysis/analysis.service.js`, extend the openrouter import (line 10) to include `generateJson`:

```js
const { aiMatch, generateTextWithFallback, generateJson } = require('./engine/openrouter');
```

Add two imports near the top (after line 10):

```js
const { retrieve } = require('../rag/rag.service');
const { tailoringResultSchema } = require('./analysis.schema');
```

Add this function after `generateCoverLetter` (after line 201):

```js
// AI-generated résumé tailoring suggestions, grounded in the user's real
// documents via RAG. Retrieves the most JD-relevant chunks across the whole
// corpus, feeds them as evidence, and enforces no-fabrication: an "add" that
// isn't cited to a retrieved document is dropped server-side. Ephemeral like
// the cover letter — nothing is stored.
async function generateTailoringSuggestions(userId, { applicationId, documentId }) {
  const application = await prisma.application.findFirst({
    where: { id: applicationId, userId }, include: { company: true },
  });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const jd = (application.jobDescription || '').trim();
  if (!jd) throw new ValidationError('This application has no job description — add one to get tailoring suggestions.');
  if (!process.env.OPENROUTER_API_KEY) throw new AppError('AI is not configured on the server.', 503, 'AI_UNAVAILABLE');

  const buffer = await readBuffer(document.storageKey);
  const { text: resumeText, ok } = await extractText(buffer, document.mimeType);
  if (!ok) throw new ValidationError('Could not read text from that résumé (scanned PDFs and legacy .doc files are not supported).');

  // RAG grounding: most JD-relevant chunks across ALL the user's documents.
  const chunks = await retrieve(userId, jd, { topK: 8 });
  const docs = await prisma.document.findMany({ where: { userId }, select: { id: true, name: true } });
  const nameById = new Map(docs.map((d) => [d.id, d.name]));
  const evidence = chunks.map((c) => ({ name: nameById.get(c.documentId) || 'a document', content: c.content }));
  const sourceNames = new Set(evidence.map((e) => e.name.trim().toLowerCase()));
  const evidenceBlock = evidence.length
    ? evidence.map((e) => `[from: ${e.name}] ${e.content}`).join('\n')
    : 'none';

  const companyName = application.company?.name || 'the company';
  const position = application.position || 'the role';
  const system = [
    'You are an expert résumé coach. You suggest concrete edits to make a résumé fit a specific job.',
    'You NEVER invent experience, skills, employers, dates, or metrics.',
    'You may only suggest ADDING something (kind "add") if it appears in the GROUNDED EVIDENCE below. Every "add" MUST set groundedIn to the exact document name it came from. If the evidence does not support a job requirement, say nothing about it — do not fabricate to fill a gap.',
    'kind "emphasize", "rephrase", and "remove" operate only on the CURRENT RÉSUMÉ; set their groundedIn to "this résumé".',
    'severity is "high" for gaps that clearly cost the candidate the match, "medium" for meaningful improvements, "low" for polish.',
    'Return at most 12 suggestions, most important first.',
    // Humanizer rules (from the "Signs of AI writing" guide):
    'Write like a real person. Do NOT use em dashes or en dashes (use commas, periods, or parentheses), emojis, or curly quotes.',
    'Avoid AI-tell vocabulary such as: passionate, thrilled, excited, delve, leverage, robust, dynamic, seamless, spearheaded, elevate, resonate. Prefer plain verbs.',
  ].join(' ');
  const user = `JOB DESCRIPTION:\n${jd}\n\nCURRENT RÉSUMÉ:\n${resumeText}\n\nGROUNDED EVIDENCE (real content from your documents):\n${evidenceBlock}`;

  let result;
  try {
    result = await generateJson([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], tailoringResultSchema);
  } catch (err) {
    console.warn(`[tailor] AI generation failed (kind=${err.kind || 'unknown'}): ${err.message}`);
    throw new AppError('The AI service is busy right now — please try again in a moment.', 503, 'AI_UNAVAILABLE');
  }

  const rank = { high: 0, medium: 1, low: 2 };
  const suggestions = result.data.suggestions
    // No-fabrication backstop: an "add" must cite a real retrieved document.
    .filter((s) => s.kind !== 'add' || sourceNames.has((s.groundedIn || '').trim().toLowerCase()))
    .map((s) => ({ ...s, text: humanize(s.text), why: humanize(s.why) }))
    .sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    suggestions,
    meta: { companyName, position, documentName: document.name, model: result.model, evidenceCount: evidence.length },
  };
}
```

Add `generateTailoringSuggestions` to the `module.exports` object (line 207):

```js
module.exports = { run, generateCoverLetter, generateTailoringSuggestions, list, getById, remove, config };
```

- [ ] **Step 5: Add the controller handler**

In `src/modules/analysis/analysis.controller.js`, add after `generateCoverLetter` (line 10):

```js
async function tailor(req, res, next) {
  try { res.status(201).json(await service.generateTailoringSuggestions(req.userId, req.body)); }
  catch (e) { next(e); }
}
```

Add `tailor` to `module.exports` (line 28):

```js
module.exports = { run, generateCoverLetter, tailor, list, getById, remove, config };
```

- [ ] **Step 6: Register the route**

In `src/modules/analysis/analysis.routes.js`, import `tailorSchema` (line 4) and add the route above `/:id` (after line 12):

```js
const { runAnalysisSchema, coverLetterSchema, tailorSchema } = require('./analysis.schema');
```

```js
router.post('/tailor', validate(tailorSchema), ctrl.tailor);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/analysis.test.js -t tailor`
Expected: PASS (all 6 tailoring tests). Then run the full file to confirm no regressions in the existing cover-letter/analysis tests: `npx jest tests/analysis.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/analysis tests/analysis.test.js
git commit -m "feat(analysis): RAG-grounded résumé tailoring suggestions endpoint"
```

---

## Task 2: Frontend — Tailor Résumé page

**Files:**
- Modify: `SmartJobSearchCRM-FE/src/api/analysis.js`
- Create: `SmartJobSearchCRM-FE/src/pages/TailorResume.jsx`
- Create: `SmartJobSearchCRM-FE/src/pages/TailorResume.test.jsx`
- Modify: `SmartJobSearchCRM-FE/src/App.jsx`
- Modify: `SmartJobSearchCRM-FE/src/components/Layout.jsx`

**Interfaces:**
- Consumes: `POST /api/analysis/tailor` → `{ suggestions: { kind, text, why, groundedIn, severity }[], meta: { position, companyName, documentName, model, evidenceCount } }`; existing FE apis `listApplications`, `getApplication`, `listDocuments`, `createDocument`, `linkDocument`, `getAnalysisConfig`; `Button` component.
- Produces: `api/analysis.tailorResume({ applicationId, documentId }) → Promise<payload>`; a `TailorResume` default-export page mounted at route `/tailor` and linked from the primary nav.

> All commands in this task run from `SmartJobSearchCRM-FE/`.

- [ ] **Step 1: Write the failing FE tests**

Create `src/pages/TailorResume.test.jsx`:

```jsx
import { http, HttpResponse } from 'msw';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server, API } from '../test/server';
import TailorResume from './TailorResume';
import { createDocument, linkDocument } from '../api/documents';

// Keep real listDocuments (drives the dropdown via MSW); mock only the writes.
vi.mock('../api/documents', async (importActual) => ({
  ...(await importActual()),
  createDocument: vi.fn(),
  linkDocument: vi.fn(),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><TailorResume /></QueryClientProvider>);
}

beforeEach(() => {
  createDocument.mockReset();
  linkDocument.mockReset();
  server.use(
    http.get(`${API}/applications`, () => HttpResponse.json([{ id: 'a1', position: 'Backend Engineer', status: 'Applied' }])),
    http.get(`${API}/documents`, () => HttpResponse.json([{ id: 'd1', name: 'My Resume', type: 'Resume' }])),
    http.get(`${API}/analysis/config`, () => HttpResponse.json({ aiAvailable: true })),
    http.get(`${API}/applications/a1`, () => HttpResponse.json({ id: 'a1', position: 'Backend Engineer', jobDescription: 'Kafka role' })),
  );
});

async function pickBoth(user) {
  await screen.findByRole('option', { name: 'Backend Engineer' });
  await screen.findByRole('option', { name: 'My Resume' });
  await user.selectOptions(screen.getByLabelText('Application'), 'a1');
  await user.selectOptions(screen.getByLabelText('Résumé'), 'd1');
}

test('generates and renders grounded tailoring suggestions', async () => {
  server.use(http.post(`${API}/analysis/tailor`, () => HttpResponse.json({
    suggestions: [
      { kind: 'add', text: 'Add your Kafka pipeline work.', why: 'The JD requires Kafka.', groundedIn: 'My Resume', severity: 'high' },
      { kind: 'emphasize', text: 'Move PostgreSQL up.', why: 'Listed as required.', groundedIn: 'this résumé', severity: 'medium' },
    ],
    meta: { position: 'Backend Engineer', companyName: 'Acme', documentName: 'My Resume', model: 'test/model:free', evidenceCount: 1 },
  }, { status: 201 })));

  const user = userEvent.setup();
  renderPage();
  await pickBoth(user);
  await user.click(screen.getByRole('button', { name: /tailor/i }));

  expect(await screen.findByText('Add your Kafka pipeline work.')).toBeInTheDocument();
  expect(screen.getByText('Move PostgreSQL up.')).toBeInTheDocument();
  expect(screen.getByText(/grounded in My Resume/i)).toBeInTheDocument();
});

test('Generate is disabled when AI is unavailable', async () => {
  server.use(http.get(`${API}/analysis/config`, () => HttpResponse.json({ aiAvailable: false })));
  renderPage();
  await screen.findByRole('option', { name: 'Backend Engineer' });
  await waitFor(() => expect(screen.getByRole('button', { name: /tailor/i })).toBeDisabled());
});

test('warns when the chosen application has no job description', async () => {
  server.use(http.get(`${API}/applications/a1`, () => HttpResponse.json({ id: 'a1', position: 'Backend Engineer', jobDescription: '' })));
  const user = userEvent.setup();
  renderPage();
  await screen.findByRole('option', { name: 'Backend Engineer' });
  await user.selectOptions(screen.getByLabelText('Application'), 'a1');
  expect(await screen.findByText(/no job description/i)).toBeInTheDocument();
});

test('Save to Documents writes a notes doc linked to the application', async () => {
  createDocument.mockResolvedValue({ id: 'newdoc' });
  linkDocument.mockResolvedValue({});
  server.use(http.post(`${API}/analysis/tailor`, () => HttpResponse.json({
    suggestions: [{ kind: 'emphasize', text: 'Move PostgreSQL up.', why: 'Required.', groundedIn: 'this résumé', severity: 'medium' }],
    meta: { position: 'Backend Engineer', companyName: 'Acme', documentName: 'My Resume', model: 'm', evidenceCount: 0 },
  }, { status: 201 })));

  const user = userEvent.setup();
  renderPage();
  await pickBoth(user);
  await user.click(screen.getByRole('button', { name: /tailor/i }));
  await screen.findByText('Move PostgreSQL up.');
  await user.click(screen.getByRole('button', { name: /save to documents/i }));

  await waitFor(() => expect(createDocument).toHaveBeenCalled());
  expect(linkDocument).toHaveBeenCalledWith('a1', 'newdoc');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/TailorResume.test.jsx`
Expected: FAIL — `./TailorResume` module does not exist (import error).

- [ ] **Step 3: Add the API function**

In `src/api/analysis.js`, add after `generateCoverLetter` (line 14):

```js
export async function tailorResume({ applicationId, documentId }) {
  const { data } = await api.post('/analysis/tailor', { applicationId, documentId });
  return data;
}
```

- [ ] **Step 4: Create the page**

Create `src/pages/TailorResume.jsx`:

```jsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Wand2, Copy, Check, Save, Sparkles } from 'lucide-react';
import { listApplications, getApplication } from '../api/applications';
import { listDocuments, createDocument, linkDocument } from '../api/documents';
import { getAnalysisConfig, tailorResume } from '../api/analysis';
import Button from '../components/Button';

const selectClass = 'rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';

const dot = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-slate-400' };
const kindLabel = { add: 'Add', emphasize: 'Emphasize', rephrase: 'Rephrase', remove: 'Remove' };

// Format suggestions as plain text for Copy / Save-to-Documents.
export function suggestionsToText(suggestions, meta) {
  const header = `Tailoring notes — ${meta?.position || 'Untitled'}${meta?.companyName && meta.companyName !== 'the company' ? ` @ ${meta.companyName}` : ''}`;
  const lines = suggestions.map((s, i) =>
    `${i + 1}. [${kindLabel[s.kind]}] ${s.text}\n   Why: ${s.why}\n   Grounded in: ${s.groundedIn}`);
  return `${header}\n\n${lines.join('\n\n')}\n`;
}

function notesFilename(position) {
  const clean = (position || 'Untitled').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
  return `Tailoring Notes — ${clean}.txt`;
}

export default function TailorResume() {
  const qc = useQueryClient();
  const [applicationId, setApplicationId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [suggestions, setSuggestions] = useState(null);
  const [meta, setMeta] = useState(null);
  const [checked, setChecked] = useState({});
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: applications = [] } = useQuery({ queryKey: ['applications'], queryFn: listApplications });
  const { data: documents = [] } = useQuery({ queryKey: ['documents'], queryFn: () => listDocuments() });
  const { data: aiConfig } = useQuery({ queryKey: ['analysisConfig'], queryFn: getAnalysisConfig });
  const aiAvailable = Boolean(aiConfig?.aiAvailable);
  const { data: appDetail } = useQuery({
    queryKey: ['application', applicationId],
    queryFn: () => getApplication(applicationId),
    enabled: Boolean(applicationId),
  });
  const noJd = Boolean(appDetail) && !appDetail.jobDescription;

  const generate = useMutation({
    mutationFn: () => tailorResume({ applicationId, documentId }),
    onSuccess: (data) => {
      setSuggestions(data.suggestions); setMeta(data.meta); setChecked({});
      setError(null); setCopied(false); setSaved(false);
    },
    onError: (e) => setError(e.response?.data?.error?.message || 'Could not generate tailoring suggestions. Please try again.'),
  });

  const saveDoc = useMutation({
    mutationFn: async () => {
      const text = suggestionsToText(suggestions, meta);
      const fd = new FormData();
      fd.append('file', new File([text], notesFilename(meta?.position), { type: 'text/plain' }));
      fd.append('name', `Tailoring Notes — ${meta?.position || 'Untitled'}`);
      fd.append('type', 'Other');
      const doc = await createDocument(fd);
      if (applicationId) await linkDocument(applicationId, doc.id);
      return doc;
    },
    onSuccess: () => {
      setSaved(true); setError(null); setTimeout(() => setSaved(false), 2500);
      qc.invalidateQueries({ queryKey: ['documents'] });
      if (applicationId) qc.invalidateQueries({ queryKey: ['application', applicationId] });
    },
    onError: (e) => setError(e.response?.data?.error?.message || 'Could not save the notes to Documents.'),
  });

  function onGenerate(e) {
    e.preventDefault();
    if (!applicationId || !documentId) { setError('Pick an application and a résumé.'); return; }
    generate.mutate();
  }
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(suggestionsToText(suggestions, meta));
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Tailor Résumé</h1>
      <p className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500">
        <Sparkles size={15} aria-hidden="true" /> AI suggestions grounded in your real documents — nothing invented.
      </p>

      <form className="mb-6 rounded-xl border border-sky-100 bg-white p-4 shadow-sm" onSubmit={onGenerate}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm font-medium text-slate-600">
            Application
            <select aria-label="Application" className={`${selectClass} mt-1`} value={applicationId} onChange={(e) => setApplicationId(e.target.value)}>
              <option value="">Select an application…</option>
              {applications.map((a) => <option key={a.id} value={a.id}>{a.position}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-sm font-medium text-slate-600">
            Résumé
            <select aria-label="Résumé" className={`${selectClass} mt-1`} value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">Select a résumé…</option>
              {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <Button type="submit" loading={generate.isPending} disabled={!aiAvailable}>
            <Wand2 size={16} aria-hidden="true" /> {generate.isPending ? 'Tailoring…' : 'Tailor'}
          </Button>
        </div>
        {!aiAvailable && <p className="mt-2 text-xs text-slate-400">AI is unavailable — set an OpenRouter API key on the server to enable it.</p>}
        {noJd && <p className="mt-2 text-xs text-amber-700">This application has no job description — add one so suggestions can be tailored to the role.</p>}
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </form>

      {suggestions && (
        <div className="rounded-xl border border-sky-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              {meta ? `${meta.position} · ${meta.companyName}` : 'Suggestions'}
            </h2>
            <div className="flex items-center gap-2">
              <Button type="button" variant="subtle" onClick={onCopy}>
                {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? 'Copied' : 'Copy all'}
              </Button>
              <Button type="button" onClick={() => saveDoc.mutate()} loading={saveDoc.isPending}>
                {saved ? <Check size={16} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} {saved ? 'Saved' : 'Save to Documents'}
              </Button>
            </div>
          </div>

          {suggestions.length === 0 ? (
            <p className="text-sm text-slate-500">No changes suggested — this résumé already fits the role well.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((s, i) => (
                <li key={i} className="flex gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <input
                    type="checkbox"
                    aria-label={`Done: ${s.text}`}
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={Boolean(checked[i])}
                    onChange={() => setChecked((c) => ({ ...c, [i]: !c[i] }))}
                  />
                  <div className={checked[i] ? 'opacity-50' : ''}>
                    <div className="mb-0.5 flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${dot[s.severity]}`} aria-hidden="true" />
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">{kindLabel[s.kind]}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-800">{s.text}</p>
                    <p className="text-xs text-slate-500">{s.why}</p>
                    <p className="mt-0.5 text-xs italic text-slate-400">Grounded in {s.groundedIn}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-400">
            {meta?.model ? `AI-generated · ${meta.model} · ` : ''}Suggestions only — you decide what to apply.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Register the route and nav entry**

In `src/App.jsx`, add the lazy import after the `CoverLetter` import (line 22):

```js
const TailorResume = lazy(() => import('./pages/TailorResume'));
```

Add the route after the `/cover-letter` route (line 44):

```jsx
<Route path="/tailor" element={<TailorResume />} />
```

In `src/components/Layout.jsx`, add `Wand2` to the lucide import (line 3), then add a nav item after the Cover Letter entry (line 33):

```js
{ to: '/tailor', label: 'Tailor Résumé', icon: Wand2 },
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/pages/TailorResume.test.jsx`
Expected: PASS (all 4 tests).

- [ ] **Step 7: Commit**

```bash
git add src/api/analysis.js src/pages/TailorResume.jsx src/pages/TailorResume.test.jsx src/App.jsx src/components/Layout.jsx
git commit -m "feat(fe): Tailor Résumé page — RAG-grounded suggestions checklist"
```

---

## Self-Review

**Spec coverage:**
- Data flow (load → guard → retrieve → prompt → generateJson → backstop → return) → Task 1 Step 4. ✓
- Suggestion schema (`kind/text/why/groundedIn/severity`, max 12) → Task 1 Step 3. ✓
- No-fabrication prompt rules + server backstop → Task 1 Step 4 (system prompt + `.filter`), tested in Step 1 (drop test). ✓
- Empty-retrieval edge case → Task 1 Step 4 (`evidenceBlock = 'none'`), tested in Step 1. ✓
- API surface (schema/service/controller/route, reuse `/config`) → Task 1 Steps 3-6. ✓
- FE page cloned from CoverLetter with checklist, Copy, Save-to-Documents (`type: 'Other'`), nav + route → Task 2. ✓
- Testing (service: JD-missing, no-key, backstop, empty, AI-fail, retrieve-called; FE: render, disabled, noJd, save) → Task 1 Step 1, Task 2 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `generateTailoringSuggestions` signature and `{ suggestions, meta }` shape match between service (Task 1), controller, tests, and FE consumer (Task 2). `tailoringResultSchema` / `tailorSchema` names consistent across schema, service import, and route import. `generateJson` returns `{ data, model }` — service reads `result.data.suggestions` and `result.model`, matching the mock in Step 1 and the real `openrouter.generateJson`. ✓
