# Résumé Analysis LLM Layer (OpenRouter) — Backend Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional, opt-in OpenRouter LLM matcher (`aiMatch`) behind the existing deterministic `matchJd`, with fail-safe fallback, a `useAi` flag on `POST /api/analysis`, report `meta.aiUsed`/`aiModel`, and a `GET /api/analysis/config` capability endpoint.

**Architecture:** A self-contained `engine/openrouter.js` (the only network I/O — plain `fetch`) exposes `complete()` (request + Zod-validate, or throw) and `aiMatch()` (maps LLM skills through the existing `weightOf` formula to the matcher's output shape). The service tries `aiMatch` only when `useAi` and a key are set, and **falls back to `matchJd` on any failure**. No DB migration.

**Tech Stack:** Express, Prisma, Zod, Jest + Supertest, global `fetch` (Node 22). **No new dependency.**

## Global Constraints

- **Provider: OpenRouter** (OpenAI-compatible), not Claude. Config via env: `OPENROUTER_API_KEY` (presence ⇒ AI available), `OPENROUTER_MODEL` (default a free model; configurable), `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`).
- **Fail-safe:** any AI problem — no key, non-2xx, network error, timeout, malformed/schema-invalid output — must throw inside `openrouter.js` and cause the service to **fall back to deterministic `matchJd`**. A run never 500s because of the LLM.
- Deterministic ATS audit + `matchJd` + the **scoring formula** are unchanged; AI only supplies match inputs + skill-gap suggestions.
- `aiMatch` output is shaped exactly like `matchJd` plus suggestions: `{ matchScore, matched: Entry[], missing: Entry[], suggestions: {text,severity,source:'ai'}[], model }`, `Entry = {term,type,jdCount,resumeCount,weight}`.
- LLM request: `temperature: 0`, `max_tokens: 800`, `response_format: { type:'json_schema', json_schema:{...strict} }`, `provider: { require_parameters: true }`, grounding system prompt, ~15s `AbortController` timeout, **single attempt**. Send only résumé text + JD.
- Network client is **mocked** in all tests; no test hits the network or needs a key.
- Tests use the existing harness (`tests/helpers/*`). DB up: `docker compose up -d`; `npm test`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: OpenRouter client + `aiMatch` adapter

**Files:**
- Modify: `src/modules/analysis/engine/match.js` (export `weightOf`)
- Create: `src/modules/analysis/engine/openrouter.js`
- Test: `src/modules/analysis/engine/openrouter.test.js`

**Interfaces:**
- Consumes: `weightOf({ type, jdCount }) → number` from `match.js`.
- Produces: `complete(resumeText, jobDescription) → Promise<{ result: { skills:[{term,type,present}], suggestions:[{text,severity}] }, model: string }>` (throws on any failure); `aiMatch(resumeText, jobDescription) → Promise<{ matchScore, matched, missing, suggestions, model }>`.

- [ ] **Step 1: Export `weightOf` from `match.js`**

In `src/modules/analysis/engine/match.js`, change the export line:

```js
module.exports = { matchJd, extractJdKeywords, weightOf };
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/analysis/engine/openrouter.test.js`:

```js
const { aiMatch, complete } = require('./openrouter');

const okResponse = (payload) => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }) });

beforeEach(() => { process.env.OPENROUTER_API_KEY = 'test-key'; process.env.OPENROUTER_MODEL = 'test/model:free'; });
afterEach(() => { delete process.env.OPENROUTER_API_KEY; delete process.env.OPENROUTER_MODEL; jest.restoreAllMocks(); });

test('aiMatch maps LLM skills to matched/missing + weighted score + ai suggestions', async () => {
  global.fetch = jest.fn().mockResolvedValue(okResponse({
    skills: [
      { term: 'kubernetes', type: 'hard', present: false },
      { term: 'java', type: 'hard', present: true },
      { term: 'communication', type: 'soft', present: true },
    ],
    suggestions: [{ text: 'Add Kubernetes.', severity: 'high' }],
  }));
  const r = await aiMatch('java dev, good communication', 'need java, kubernetes, communication');
  expect(r.matched.map((e) => e.term)).toEqual(expect.arrayContaining(['java', 'communication']));
  expect(r.missing.map((e) => e.term)).toEqual(['kubernetes']);
  expect(r.matchScore).toBeGreaterThan(0);
  expect(r.matchScore).toBeLessThanOrEqual(100);
  expect(r.suggestions[0]).toMatchObject({ severity: 'high', source: 'ai' });
  expect(r.model).toBe('test/model:free');
});

test('complete sends a json_schema request with auth + temperature 0', async () => {
  let captured;
  global.fetch = jest.fn().mockImplementation((url, opts) => { captured = { url, opts }; return Promise.resolve(okResponse({ skills: [], suggestions: [] })); });
  await complete('resume', 'jd');
  expect(String(captured.url)).toContain('/chat/completions');
  expect(captured.opts.headers.Authorization).toBe('Bearer test-key');
  const body = JSON.parse(captured.opts.body);
  expect(body.temperature).toBe(0);
  expect(body.response_format.type).toBe('json_schema');
  expect(body.provider.require_parameters).toBe(true);
  expect(body.model).toBe('test/model:free');
});

test('no API key → throws (caller will fall back)', async () => {
  delete process.env.OPENROUTER_API_KEY;
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('non-2xx response → throws', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('malformed JSON content → throws', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) });
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});

test('schema-violating JSON → throws', async () => {
  global.fetch = jest.fn().mockResolvedValue(okResponse({ skills: [{ term: 'x' }], suggestions: [] })); // missing type/present
  await expect(aiMatch('r', 'j')).rejects.toThrow();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- openrouter.test`
Expected: FAIL — `Cannot find module './openrouter'`.

- [ ] **Step 4: Implement `openrouter.js`**

Create `src/modules/analysis/engine/openrouter.js`:

```js
const { z } = require('zod');
const { weightOf } = require('./match');

const RESULT_SCHEMA = z.object({
  skills: z.array(z.object({ term: z.string(), type: z.enum(['hard', 'soft']), present: z.boolean() })),
  suggestions: z.array(z.object({ text: z.string(), severity: z.enum(['high', 'medium', 'low']) })),
});

const JSON_SCHEMA = {
  name: 'resume_match',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['skills', 'suggestions'],
    properties: {
      skills: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'type', 'present'],
        properties: { term: { type: 'string' }, type: { type: 'string', enum: ['hard', 'soft'] }, present: { type: 'boolean' } } } },
      suggestions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'severity'],
        properties: { text: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] } } } },
    },
  },
};

const SYSTEM = 'You extract skills to match a résumé against a job description. Use ONLY skills explicitly stated in the job description. Mark a skill present:true only if it clearly appears in the résumé, otherwise present:false. Never invent skills that are not in the job description. Keep suggestions concrete and honest — do not encourage keyword stuffing. Respond with JSON only.';

const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const TIMEOUT_MS = 15000;

async function complete(resumeText, jobDescription) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OpenRouter API key not configured');
  const model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://smart-job-search-crm.local',
        'X-Title': 'Smart Job Search CRM',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 800,
        provider: { require_parameters: true },
        response_format: { type: 'json_schema', json_schema: JSON_SCHEMA },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `JOB DESCRIPTION:\n${jobDescription}\n\nRÉSUMÉ:\n${resumeText}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter request failed: ${res.status}`);
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('OpenRouter returned no content');
    const result = RESULT_SCHEMA.parse(JSON.parse(content));
    return { result, model };
  } finally {
    clearTimeout(timer);
  }
}

async function aiMatch(resumeText, jobDescription) {
  const { result, model } = await complete(resumeText, jobDescription);
  const matched = [];
  const missing = [];
  let total = 0;
  let got = 0;
  for (const s of result.skills) {
    const weight = weightOf({ type: s.type, jdCount: 1 });
    total += weight;
    const entry = { term: s.term, type: s.type, jdCount: 1, resumeCount: s.present ? 1 : 0, weight };
    if (s.present) { matched.push(entry); got += weight; } else { missing.push(entry); }
  }
  const matchScore = total === 0 ? 0 : Math.round((got / total) * 100);
  matched.sort((a, b) => b.weight - a.weight);
  missing.sort((a, b) => b.weight - a.weight);
  const suggestions = result.suggestions.map((x) => ({ text: x.text, severity: x.severity, source: 'ai' }));
  return { matchScore, matched, missing, suggestions, model };
}

module.exports = { complete, aiMatch };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- openrouter.test`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/analysis/engine/match.js src/modules/analysis/engine/openrouter.js src/modules/analysis/engine/openrouter.test.js
git commit -m "feat(analysis): OpenRouter client + aiMatch adapter (fail-safe)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Service integration + `useAi` + config endpoint

**Files:**
- Modify: `src/modules/analysis/analysis.schema.js`
- Modify: `src/modules/analysis/analysis.service.js`
- Modify: `src/modules/analysis/analysis.controller.js`
- Modify: `src/modules/analysis/analysis.routes.js`
- Test: `tests/analysis.test.js` (append)

**Interfaces:**
- Consumes: `aiMatch` (Task 1), existing `matchJd`/`auditAts`/`buildSuggestions`/`extractText`.
- Produces: `POST /api/analysis { …, useAi? }`; report `meta.aiUsed`/`aiModel`; `GET /api/analysis/config → { aiAvailable }`.

- [ ] **Step 1: Widen the Zod schemas**

In `src/modules/analysis/analysis.schema.js`:
- Add `useAi` to `runAnalysisSchema`:

```js
const runAnalysisSchema = z.object({
  applicationId: z.string().uuid(),
  documentId: z.string().uuid(),
  useAi: z.boolean().optional(),
});
```
- Add `aiUsed`/`aiModel` to the report `meta`:

```js
  meta: z.object({
    documentName: z.string(), position: z.string().nullable(),
    jdPresent: z.boolean(), extractionOk: z.boolean(), wordCount: z.number().int(),
    aiUsed: z.boolean(), aiModel: z.string().nullable(),
  }),
```
- Widen `suggestions[].source` from `z.literal('rule')` to:

```js
    text: z.string(), severity: z.enum(['high', 'medium', 'low']), source: z.enum(['rule', 'ai']),
```

- [ ] **Step 2: Write the failing API tests (append to `tests/analysis.test.js`)**

At the **very top** of `tests/analysis.test.js` (before the other requires), add the mock + handle:

```js
jest.mock('../src/modules/analysis/engine/openrouter');
const { aiMatch } = require('../src/modules/analysis/engine/openrouter');
```

Append these tests:

```js
const AI_RESULT = {
  matchScore: 80,
  matched: [{ term: 'rust', type: 'hard', jdCount: 1, resumeCount: 1, weight: 4 }],
  missing: [{ term: 'elixir', type: 'hard', jdCount: 1, resumeCount: 0, weight: 4 }],
  suggestions: [{ text: 'Add Elixir if you have it.', severity: 'high', source: 'ai' }],
  model: 'test/model:free',
};

test('useAi + key + AI success → aiUsed true with AI match + ai suggestions', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  aiMatch.mockResolvedValue(AI_RESULT);
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'We need Rust and Elixir.');
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.aiUsed).toBe(true);
  expect(run.body.report.meta.aiModel).toBe('test/model:free');
  expect(run.body.report.matched.map((e) => e.term)).toContain('rust');
  expect(run.body.report.suggestions.some((s) => s.source === 'ai')).toBe(true);
  delete process.env.OPENROUTER_API_KEY;
});

test('useAi + key + AI throws → falls back to deterministic (never 500)', async () => {
  process.env.OPENROUTER_API_KEY = 'k';
  aiMatch.mockRejectedValue(new Error('rate limited'));
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js and PostgreSQL.');
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.aiUsed).toBe(false);
  expect(typeof run.body.matchScore).toBe('number'); // deterministic match still produced
  delete process.env.OPENROUTER_API_KEY;
});

test('useAi + NO key → deterministic, AI never attempted', async () => {
  delete process.env.OPENROUTER_API_KEY;
  aiMatch.mockReset();
  const { token } = await registerAndLogin();
  const appId = await makeApp(token, 'Node.js role.');
  const docId = await uploadResume(token);
  const run = await agent().post('/api/analysis').set(auth(token)).send({ applicationId: appId, documentId: docId, useAi: true });
  expect(run.status).toBe(201);
  expect(run.body.report.meta.aiUsed).toBe(false);
  expect(aiMatch).not.toHaveBeenCalled();
});

test('GET /api/analysis/config reflects the API key presence', async () => {
  const { token } = await registerAndLogin();
  process.env.OPENROUTER_API_KEY = 'k';
  expect((await agent().get('/api/analysis/config').set(auth(token))).body).toEqual({ aiAvailable: true });
  delete process.env.OPENROUTER_API_KEY;
  expect((await agent().get('/api/analysis/config').set(auth(token))).body).toEqual({ aiAvailable: false });
  expect((await agent().get('/api/analysis/config')).status).toBe(401);
});
```

> Note: `makeApp`, `uploadResume`, `auth` already exist in `tests/analysis.test.js` from V3-3.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- analysis.test`
Expected: FAIL — `useAi` ignored (aiUsed undefined / no config route → 404).

- [ ] **Step 4: Update the service**

In `src/modules/analysis/analysis.service.js`, add the require near the top:

```js
const { aiMatch } = require('./engine/openrouter');
```

Replace the `run` function with (the AI branch + meta fields + suggestion merge):

```js
async function run(userId, { applicationId, documentId, useAi }) {
  const application = await prisma.application.findFirst({ where: { id: applicationId, userId } });
  if (!application) throw new NotFoundError('Application not found');
  const document = await prisma.document.findFirst({ where: { id: documentId, userId } });
  if (!document) throw new NotFoundError('Document not found');

  const buffer = await readBuffer(document.storageKey);
  const { text, ok } = await extractText(buffer, document.mimeType);

  const ats = auditAts(text, { mimeType: document.mimeType });
  const jd = application.jobDescription || '';

  let match = null;
  let aiUsed = false;
  let aiModel = null;
  let aiSuggestions = null;

  if (ok && jd.trim()) {
    if (useAi && process.env.OPENROUTER_API_KEY) {
      try {
        const r = await aiMatch(text, jd);
        match = { matchScore: r.matchScore, matched: r.matched, missing: r.missing };
        aiSuggestions = r.suggestions;
        aiUsed = true;
        aiModel = r.model;
      } catch {
        match = matchJd(text, jd); // graceful fallback on any AI failure
      }
    } else {
      match = matchJd(text, jd);
    }
  }

  const meta = {
    documentName: document.name,
    position: application.position ?? null,
    jdPresent: Boolean(jd.trim()),
    extractionOk: ok,
    wordCount: tokenize(text).length,
    aiUsed,
    aiModel,
  };

  let suggestions;
  if (aiUsed) {
    // structural (rule) suggestions always run; skill-gap come from the LLM
    const structural = buildSuggestions({ subScores: ats.subScores, sectionFindings: ats.sectionFindings, missing: [], meta });
    const rank = { high: 0, medium: 1, low: 2 };
    suggestions = [...structural, ...aiSuggestions].sort((a, b) => rank[a.severity] - rank[b.severity]);
  } else {
    suggestions = buildSuggestions({ subScores: ats.subScores, sectionFindings: ats.sectionFindings, missing: match ? match.missing : [], meta });
  }

  const report = analysisReportSchema.parse({
    meta,
    atsSubScores: ats.subScores,
    matched: match ? match.matched : [],
    missing: match ? match.missing : [],
    sectionFindings: ats.sectionFindings,
    suggestions,
  });

  return prisma.resumeAnalysis.create({
    data: {
      userId, applicationId, documentId,
      atsScore: ats.atsScore,
      matchScore: match ? match.matchScore : null,
      report,
    },
    select: rowSelect,
  });
}
```

Add a `config` function and export it (add to the existing `module.exports`):

```js
function config() {
  return { aiAvailable: Boolean(process.env.OPENROUTER_API_KEY) };
}
```
Update the exports line to include `config`: `module.exports = { run, list, getById, remove, config };`

- [ ] **Step 5: Add the controller method**

In `src/modules/analysis/analysis.controller.js`, add and export `config`:

```js
async function config(req, res, next) {
  try { res.json(await service.config()); }
  catch (e) { next(e); }
}
```
Update the exports: `module.exports = { run, list, getById, remove, config };`

- [ ] **Step 6: Add the route (before `/:id`)**

In `src/modules/analysis/analysis.routes.js`, add the config route **before** `router.get('/:id', …)` so `config` isn't captured as an `:id`:

```js
router.get('/', ctrl.list);
router.post('/', validate(runAnalysisSchema), ctrl.run);
router.get('/config', ctrl.config);
router.get('/:id', ctrl.getById);
router.delete('/:id', ctrl.remove);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- analysis.test`
Expected: PASS (the prior 5 analysis tests + 4 new = 9).

- [ ] **Step 8: Run the full backend suite**

Run: `npm test`
Expected: PASS — prior 131 + 6 openrouter + 4 analysis = **141 total**.

- [ ] **Step 9: Commit**

```bash
git add src/modules/analysis/analysis.schema.js src/modules/analysis/analysis.service.js src/modules/analysis/analysis.controller.js src/modules/analysis/analysis.routes.js tests/analysis.test.js
git commit -m "feat(analysis): useAi opt-in + OpenRouter fallback + /config endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** OpenRouter client (fetch, json_schema, provider.require_parameters, temp 0, grounding, timeout) (T1) ✓; validate-or-throw → fallback (T1 + service catch T2) ✓; `aiMatch` mapping via shared `weightOf` formula (T1) ✓; `useAi` flag (T2 schema) ✓; meta `aiUsed`/`aiModel` (T2) ✓; `source:'ai'` widened (T2) ✓; structural-always + skill-gap from AI/rule (T2 service) ✓; `GET /config` capability (T2, before `/:id`) ✓; no key/throws/false-flag all fall back (T2 tests) ✓; no migration ✓; network mocked in all tests ✓.
- **Type consistency:** `aiMatch` returns `{matchScore,matched,missing,suggestions,model}`; the service consumes those exact names; `Entry` shape + `source:'ai'` match the widened `analysisReportSchema`; `weightOf({type,jdCount})` matches its `match.js` definition.
- **Placeholders:** none. `DEFAULT_MODEL` is a real free-model id and overridable via `OPENROUTER_MODEL` (the spec calls the exact model non-load-bearing).
