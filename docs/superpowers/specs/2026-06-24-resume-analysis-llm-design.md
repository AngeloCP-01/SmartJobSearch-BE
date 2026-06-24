# Résumé Analysis — LLM Layer (OpenRouter) — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Builds on:** V3-3 (deterministic Résumé Analysis / ATS). Backend + frontend on `main` (BE 131 tests, FE 101 tests).
**Provider:** **OpenRouter** (OpenAI-compatible), chosen over Claude for cost (free models). Not Anthropic.

## Purpose

V3-3's résumé analysis is deterministic and reliable but **dictionary-bounded**: a real skill the job description asks for that isn't in `skills.json` is never detected. This slice (V3-4) adds an **optional, opt-in LLM layer** that replaces only the *semantic* part — extracting the JD's real required skills (incl. ones not in the dictionary), judging which the résumé covers, and writing tailored skill-gap suggestions. The deterministic ATS-friendliness audit and the match-score **weighting formula** stay; the LLM only supplies better inputs. It is **strictly additive and fail-safe**: any problem (no key, error, rate-limit, bad output) falls back to the deterministic matcher, so a run never breaks because of the LLM.

## Scope

**IN:**
- A self-contained **OpenRouter client** + an `aiMatch` adapter in the analysis module (the only network I/O), behind a swappable boundary alongside the existing deterministic `matchJd`.
- A per-run **opt-in** (`useAi`) on `POST /api/analysis`; a capability endpoint so the UI knows whether AI is available.
- Report self-documentation (`meta.aiUsed`, `meta.aiModel`) and AI-sourced suggestions (`source: 'ai'`).
- Frontend "Use AI" toggle (disabled without a key), a consent line, and an AI badge + fallback note on the report.

**OUT (deferred):** using the LLM for the ATS-friendliness audit (stays deterministic — it's about parseability/formatting, not semantics), LLM-generated résumé rewrites, streaming, multi-model ensembles/voting, caching of LLM responses, and any retry/backoff beyond a single attempt + fallback.

## Architecture

The V3-3 engine already isolates the matcher, so this is **one swappable piece**:

- **Unchanged & deterministic:** `extract`, `ats` audit, the **scoring formula** (`weightOf` + `got/total`), and the deterministic `matchJd` (now the *fallback* and the no-AI path).
- **New `engine/openrouter.js`:** a thin client (`complete(...)`) + `aiMatch(resumeText, jobDescription)`. The LLM extracts JD skills + coverage + suggestions; `aiMatch` maps them through the **existing weighting formula** to produce a `matchScore` and `matched`/`missing` shaped identically to `matchJd`, plus `suggestions` (`source: 'ai'`).
- **Service branch:** `run(userId, { applicationId, documentId, useAi })`:
  - Compute the deterministic ATS audit (always).
  - If `useAi === true` **and** `OPENROUTER_API_KEY` is set **and** extraction succeeded → try `aiMatch`; on success use its match + AI suggestions, set `meta.aiUsed = true`, `meta.aiModel = <model>`.
  - On **any** failure (no key, thrown error, timeout, rate-limit, schema-invalid output) **or** `useAi` false → use deterministic `matchJd` + rule suggestions, `meta.aiUsed = false`, `meta.aiModel = null`.
- **Suggestions:** the deterministic **ATS-structural** suggestions (missing email / missing section / parseability) always run. The **skill-gap** suggestions come from the LLM when AI succeeded, else the rule engine. The two lists are concatenated (structural first by severity).

`openrouter.js` depends only on `fetch` (and the engine's `weightOf`); the service depends on it one-directionally — no cycle.

## OpenRouter client & LLM contract

### Config (env)
- `OPENROUTER_API_KEY` — presence ⇒ "AI available". Absent ⇒ toggle disabled, AI never attempted.
- `OPENROUTER_MODEL` — default a free instruct model that supports structured outputs (e.g. a current `:free` model from `openrouter.ai/models?supported_parameters=structured_outputs`); **configurable** so the exact id isn't load-bearing.
- `OPENROUTER_BASE_URL` — default `https://openrouter.ai/api/v1`.

### Request (`POST {base}/chat/completions`)
- Headers: `Authorization: Bearer <key>`, `Content-Type: application/json`, plus OpenRouter's recommended `HTTP-Referer` / `X-Title` (app attribution).
- Body: `model`, `temperature: 0`, `max_tokens` (tight, ~800), `messages` (system + user), `response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }`, and `provider: { require_parameters: true }` so OpenRouter routes only to providers that honor the schema (else it errors → we fall back).
- **Grounding prompt:** system = "You extract skills for résumé/JD matching. Only use skills explicitly present in the job description. Mark a skill `present` only if it clearly appears in the résumé. Never invent skills. Output JSON only." User = the JD text and the résumé text (clearly delimited). We send **only** the extracted résumé text + JD — no account data.
- **Reliability:** an `AbortController` **timeout (~15s)**; **single attempt** (no retry — fall back fast). Any non-2xx, network error, or timeout → throw → fallback.

### LLM output schema (Zod-validated — never trusted)
```jsonc
{
  "skills": [ { "term": "kubernetes", "type": "hard", "present": false } ],   // type: 'hard'|'soft'
  "suggestions": [ { "text": "…", "severity": "high" } ]                      // severity: high|medium|low
}
```
`complete()` parses the model's JSON and validates it against `openRouterResultSchema`. **If parsing or validation fails, it throws** → the service falls back. (Free-model structured-output support is uneven; validate-or-fall-back is the safety net.)

### `aiMatch` mapping
Maps `skills` → entries `{ term, type, jdCount: 1, resumeCount: present ? 1 : 0, weight: weightOf({type, jdCount:1}) }`; `matched` = present, `missing` = absent; `matchScore = round(100 × Σ present.weight / Σ all.weight)` (the existing formula). Returns `{ matchScore, matched, missing, suggestions: suggestions.map(s => ({ ...s, source: 'ai' })) }`.

## API & data changes

- **`POST /api/analysis`** body gains optional **`useAi: z.boolean().optional()`** (default false). Same `userId`-scoping, same 201 response (now possibly AI-produced).
- **Report `meta`** gains `aiUsed: boolean` and `aiModel: string | null` (added to `analysisReportSchema.meta`). `suggestions[].source` already permits `'ai'`. **No DB migration** — both live in the existing `report` Json; `atsScore`/`matchScore` columns unchanged.
- **New `GET /api/analysis/config`** → `{ aiAvailable: boolean }` = `Boolean(process.env.OPENROUTER_API_KEY)`. JWT-protected; never exposes the key.
- **No new dependency** — uses global `fetch` (Node 22).

## Backend tests (TDD)

The OpenRouter client is **mocked** — no real network, fully deterministic.
- **`aiMatch` unit** (stubbed `complete`): valid `{skills,suggestions}` → correct `matched`/`missing`, `matchScore` via the shared formula, `source:'ai'` suggestions; a schema-invalid response from `complete` propagates as a throw.
- **`openrouter` client unit** (mocked `fetch`): builds the correct request (model, temperature 0, `response_format` json_schema, `provider.require_parameters`, auth header); parses a valid response; a non-2xx / network error / timeout / non-JSON / schema-violating body → throws cleanly.
- **Service/API** (`tests/analysis.test.js`, with `engine/openrouter` `jest.mock`ed):
  - `useAi:true` + key + client returns valid → 201, `meta.aiUsed:true`, `aiModel` set, AI matched/missing + `source:'ai'` suggestions.
  - `useAi:true` + client **throws** → 201, `meta.aiUsed:false`, **deterministic** match (never 500).
  - `useAi:true` + **no key** → deterministic, `aiUsed:false` (client never called).
  - `useAi:false`/omitted → deterministic (unchanged V3-3 behavior).
  - ATS audit + structural suggestions present on **all** paths.
  - `GET /api/analysis/config` reflects the key env var; auth required (401 without token).

## Frontend changes

- **`/analysis` run panel:** a **"Use AI" toggle** (off by default). On mount, `useQuery(['analysisConfig'])` → `GET /analysis/config`; if `aiAvailable === false` the toggle is **disabled** with a hint ("Set an OpenRouter API key to enable AI analysis"). When checked, `runAnalysis` sends `useAi: true`.
- **Consent line** (shown when the toggle is checked): *"AI analysis sends your résumé text and the job description to OpenRouter. Free models may be served by providers that can use inputs for training — review your OpenRouter privacy settings."* — honest and accurate to OpenRouter's free-model data policy.
- **`AnalysisReport`:** when `meta.aiUsed` is true, a small **AI badge** (lucide `Sparkles`) near the Match score; if AI was requested but `meta.aiUsed` is false, a subtle **fallback note** ("AI was unavailable — showing keyword-based match"); `source:'ai'` suggestions may carry a tiny "AI" tag. Matched/missing chips render unchanged.
- **API module:** `getAnalysisConfig()` → `{ aiAvailable }` (key `['analysisConfig']`); `runAnalysis({ applicationId, documentId, useAi })` forwards the flag.

### Frontend tests
- Toggle disabled when `aiAvailable:false`; enabled + checked → `runAnalysis` posts `useAi:true` (assert body) and the report shows the AI badge; consent line appears when checked.
- A report with `meta.aiUsed:false` after an AI request shows the fallback note.
- Default MSW handler for `GET /analysis/config`.

## Architecture notes & constraints (OpenRouter, verified 2026-06)

- **Free-tier limits:** ~20 req/min on `:free` models; **50 requests/day** (→ 1000/day after a one-time $10 credit purchase); **failed attempts count** toward the quota; free routes can be provider-rate-limited at peak. The fail-fast + deterministic fallback absorbs all of this, and the UI frames AI as "best-effort."
- **Structured outputs** are only on supported models; `provider: { require_parameters: true }` ensures routing to a provider that honors the schema, and Zod validation catches anything that slips through.
- **Privacy:** OpenRouter doesn't log prompts by default, but **free models may be served by providers that use inputs for training** — hence the explicit per-run consent line; we send only résumé + JD text.
- **Determinism for tests:** the network client is always mocked; no test depends on a key or the network. With a real key, AI output isn't perfectly reproducible (model-dependent), which is exactly why the deterministic scores/audit remain authoritative and AI is opt-in.

## Success Criteria

With an `OPENROUTER_API_KEY` set, a signed-in user can flip **"Use AI"** on the Analysis page and run an analysis whose matched/missing skills and suggestions come from the LLM's semantic reading of the JD (catching skills absent from `skills.json`), shown with an AI badge; the ATS audit and score formula are unchanged. Without a key, or on any AI failure/rate-limit, the toggle is disabled or the run transparently falls back to the deterministic engine — never erroring. All behavior is covered by tests with the network client mocked, so the suite stays offline and deterministic.
