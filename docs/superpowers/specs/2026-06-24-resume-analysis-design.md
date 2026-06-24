# Résumé Analysis (ATS) — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Builds on:** v1, v1.5, v2, and v3-1 (Documents) + v3-2 (Activity Log). Backend + frontend both on `main` (BE 108 tests, FE 93 tests).
**Research basis:** `ats-research-report.md` (deep-research synthesis; deterministic TF-IDF/keyword approach + ATS-friendliness signals, with debunked claims excluded).

## Purpose

Give a job seeker an honest, actionable read on a résumé: (1) an **ATS-friendliness audit** (is it parseable, well-sectioned, with contact info, sane length) and (2) a **job-match analysis** against a specific application's job description (overall match score + matched/missing keywords + prioritized suggestions). This is v3's third slice (V3-3), the "AI Resume Match" from `INITIAL_DOC.md` — built **deterministically** (no external API) so it is fast, offline, fully testable, and free. An optional Claude semantic/suggestions layer is explicitly a **future slice**, not this one.

## Scope

**IN:**
- New backend **`analysis/`** module with a pure, offline **scoring engine** (text extraction + ATS-friendliness audit + JD-keyword match + rule-based suggestions) and a persisted, `userId`-scoped `ResumeAnalysis` (one new table, real migration).
- Server-side **text extraction** from PDF + DOCX; **detect-and-warn** on legacy `.doc` and scanned/empty PDFs (extraction failure → a parseability finding, not an error).
- A small **bundled skills dictionary** (`skills.json`) for multi-word skill recognition, synonyms, and hard/soft classification.
- New frontend **`/analysis` page**: pick an application + one of your résumés → run → a rich report (two headline scores, ATS sub-scores, matched/missing keywords, prioritized suggestions) + a history list of past analyses.

**OUT (deferred):** the optional **Claude/LLM layer** (semantic gap analysis + AI-written suggestions) — a later slice; the `suggestions[].source` field reserves an `'ai'` value but only `'rule'` is produced now. Also out: OCR of scanned résumés, a large ESCO/O*NET taxonomy, résumé editing/auto-rewrite, multi-résumé comparison, and any "guaranteed ATS pass" claim.

## Data

One new model (real migration), per-user. Each run is an **immutable snapshot** (re-running produces a new row → the history list). No change to existing models beyond a back-relation on `User`, `Application`, `Document`.

### `ResumeAnalysis`
| Field | Type | Notes |
|---|---|---|
| `id` | String (uuid) | PK |
| `userId` | String | owner; `onDelete: Cascade` |
| `applicationId` | String? | nullable FK, `onDelete: SetNull` — the JD source |
| `documentId` | String? | nullable FK, `onDelete: SetNull` — the résumé |
| `atsScore` | Int | 0–100, overall ATS-friendliness (column for listing/sorting) |
| `matchScore` | Int? | 0–100, null when the application had no `jobDescription` |
| `report` | Json | full structured report, **Zod-validated in app code** (`@default("{}")`) |
| `createdAt` | DateTime | `@default(now())`; history ordering |

Indexes: `@@index([userId, createdAt])`. Relations: `User.resumeAnalyses`, `Application.resumeAnalyses`, `Document.resumeAnalyses` (all `ResumeAnalysis[]`).

### `report` JSON shape (Zod schema `analysisReportSchema`)
```jsonc
{
  "meta": { "documentName": "Backend Resume v2", "position": "Backend Engineer",
            "jdPresent": true, "extractionOk": true, "wordCount": 620 },
  "atsSubScores": { "parseability": 90, "sections": 80, "contactInfo": 100, "formatting": 70, "length": 100 },
  "matched": [ { "term": "node.js", "type": "hard", "jdCount": 4, "resumeCount": 3, "weight": 8 } ],
  "missing": [ { "term": "kubernetes", "type": "hard", "jdCount": 3, "resumeCount": 0, "weight": 6 } ],
  "sectionFindings": [ { "section": "Skills", "present": false } ],
  "suggestions": [ { "text": "Add 'Kubernetes' — it appears 3× in the job description.",
                     "severity": "high", "source": "rule" } ]
}
```
`severity ∈ {high, medium, low}`; `source ∈ {rule, ai}` (only `rule` emitted now). Denormalized `meta.documentName`/`meta.position` keep the history list renderable after the document/application is deleted.

## Backend Changes

### New module `src/modules/analysis/`
Layering routes → controller → service like the other modules; JWT-protected; every query filters by `userId`. The **scoring engine** lives in `src/modules/analysis/engine/` as pure, separately-unit-testable modules; `extract.js` holds the only I/O (reads bytes via the existing `storage` layer).

- `engine/extract.js` — `extractText(buffer, mimeType) → { text, ok }`. **PDF** via `unpdf` (`extractText`), **DOCX** via `mammoth` (`extractRawText`). Legacy `.doc` (`application/msword`) and PDFs that yield empty/near-empty text → `{ text: '', ok: false }` (drives a parseability failure; never throws on unreadable input).
- `engine/ats.js` — `auditAts(text, { mimeType }) → { atsScore, subScores, sectionFindings }`. Sub-scores (0–100): `parseability` (extraction ok + substantive text length, not image-like), `sections` (detect standard headings — experience/work, education, skills, summary/contact — by keyword scan), `contactInfo` (email + phone (+ LinkedIn) via regex), `formatting` (conservative, honest heuristics — fused-token/odd-spacing hints, special-char density, bullet usage), `length` (word count within a ~400–1000 sane 1–2-page band; penalize far outside). `atsScore` = a fixed weighting of the sub-scores (documented in code; e.g. parseability/sections/contact heaviest, formatting/length lighter). `.doc`/unparseable ⇒ `parseability` near 0 and a clear finding.
- `engine/match.js` — `matchJd(resumeText, jobDescription, dict) → { matchScore, matched, missing } | null` (null when JD is empty). Extract JD keywords (lowercase, stopword-filter, unigrams + bigrams; frequency/TF-IDF weight), recognize multi-word skills + hard/soft tags + synonyms from `dict`; match each against the résumé (exact → simple stem → dictionary synonym). `weight` boosts hard skills and JD frequency; `matchScore` = round(100 × Σmatched.weight / Σall.weight). Returns `matched`/`missing` entries with `{term, type, jdCount, resumeCount, weight}`.
- `engine/suggestions.js` — `buildSuggestions({ subScores, sectionFindings, missing, meta }) → suggestion[]`. Rules: each missing **hard** skill with high weight → a `high`-severity "Add X (appears N× in the JD)"; missing standard section → `medium`; no contact email → `high`; length/parseability problems → appropriate severity. All `source: 'rule'`.
- `engine/skills.json` — a curated dictionary (~a few hundred entries): `{ canonical, type: 'hard'|'soft', synonyms: string[] }`. Bundled with the module; extensible.
- `analysis.service.js` — `run(userId, { applicationId, documentId })`: assert the application **and** document belong to the user (else 404); load the document's `storageKey`/`mimeType`/`name` + the application's `jobDescription`/`position`; read bytes via `storage.createReadStream`; `extractText` → `auditAts` + `matchJd` + `buildSuggestions`; assemble + **Zod-validate** the report; persist a `ResumeAnalysis` (with denormalized `meta`) and return it. Plus `list(userId)`, `getById(userId, id)`, `remove(userId, id)`.

#### Endpoints
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/analysis` | Body `{ applicationId, documentId }` → run + persist → `201` with the analysis (scores + `report`) |
| `GET` | `/api/analysis` | History list, newest-first — slim items `{ id, atsScore, matchScore, documentName, position, createdAt }` |
| `GET` | `/api/analysis/:id` | Full analysis incl. `report` (404 if not the user's) |
| `DELETE` | `/api/analysis/:id` | Remove one (`204`; 404 if not the user's) |

Validation: Zod body schema for `POST` (`applicationId`, `documentId` uuids); the assembled `report` is Zod-validated before persist (defends the `Json` column). All reads/writes `userId`-scoped; another user's application/document/analysis → 404. An unparseable résumé yields a **`201` with a parseability-failure report**, never a 500.

#### New dependencies
`unpdf` (PDF text extraction) and `mammoth` (DOCX). No LLM/AI SDK in this slice.

### Backend tests (TDD)
- **Engine unit tests (pure, no DB — the bulk):** `ats.test.js` (résumé-like text scores parseability/sections/contact higher than empty/garbled; email/phone + heading detection; length bands), `match.test.js` (JD keyword extraction; multi-word + synonym + stemmed matching via the dict; hard-weighted `matchScore`; matched/missing with counts; empty JD → null), `suggestions.test.js` (missing high-weight hard skill → high-severity; missing section/email → suggestions), `extract.test.js` (tiny fixture PDF/DOCX buffers → text; empty/image-like → `ok:false`).
- **API tests `tests/analysis.test.js`:** auth 401; `POST` with an application that has a JD + an uploaded résumé → 201 with `atsScore`, numeric `matchScore`, Zod-valid `report`; application **without** a JD → `matchScore: null` + full audit; `GET` lists it; `GET /:id` returns the report; `DELETE` → 204; cross-user isolation (B can't run-against / read / delete A's data → 404); a `.doc`/unparseable upload → 201 parseability-failure report (not 500). `resetDb` clears `resumeAnalysis`.

## Frontend Changes

### `/analysis` page
- New **sidebar nav item "Analysis"** (lucide `ScanSearch`), after Activity. Route `/analysis`, page `src/pages/Analysis.jsx`.
- **Run panel:** an **Application** picker (user's applications) + a **Résumé** picker (user's documents) + **"Run analysis"** → `POST /api/analysis`. If the selected application has no `jobDescription`, an inline note: "Match scoring needs a job description — the ATS audit will still run." Loading + error (`role="alert"`) states.
- **Report view** (after a run or when opening a history item): two **headline scores** — ATS-friendliness and Match — as color-banded rings/large numbers (red/amber/green) with honest sub-text ("guidance, not a guaranteed ATS pass"); an **ATS sub-scores** row (parseability/sections/contact/formatting/length) as small bars; **Matched** and **Missing** keyword chip lists (hard emphasized; missing chips show JD frequency); a prioritized **Suggestions** list (severity-colored, lucide icons); a **parseability warning banner** when `meta.extractionOk` is false.
- **History list:** past analyses (document name · position · date · both scores), each opening its report; delete affordance.

### API & query keys
- `src/api/analysis.js`: `runAnalysis({applicationId, documentId})`, `listAnalyses()`, `getAnalysis(id)`, `deleteAnalysis(id)`.
- Query keys `['analyses']` (list) + `['analysis', id]`. `runAnalysis` success invalidates `['analyses']`.
- Shared `ScoreRing`/`ScoreBar` + a `report` renderer reused by the just-ran result and history items. Built per `DESIGN.md` (ui-ux-pro-max; sky/green palette, cards, pills, visible focus rings).

### Frontend tests (Vitest + RTL + MSW)
- **Analysis page:** run panel renders both pickers; "Run analysis" issues `POST /analysis` and renders the returned report (both scores, matched/missing chips, suggestions); the no-JD note shows for a JD-less application; history list renders and opening an item shows its report; loading/empty/error states.
- **Report/score components:** a score renders in the correct color band; an `extractionOk:false` report shows the warning banner.
- A default `GET /api/analysis` MSW handler so nav/page tests don't error.

## Architecture Notes

- The `analysis/` module is a self-contained vertical slice; its **engine is pure** (text in, scores out), so the scoring logic is unit-tested without a DB or files — the only I/O is `extract.js` reading bytes through the existing `storage` layer. This keeps the bulk of the feature fast and deterministic to test.
- **Persist immutable snapshots** (scores as columns + full `report` in a Zod-validated `Json` column) rather than recomputing: results are stable, listable as history, and survive the underlying résumé/application changing or being deleted (nullable FKs + denormalized `meta`).
- **Determinism by construction:** no randomness, no external calls — identical inputs give identical scores, which is what makes the engine trustworthy and testable. The future Claude layer is additive and gated, so it can't compromise this core.
- **Honesty:** scores are presented as guidance; the UI never claims a guaranteed ATS pass, and suggestions push relevant/truthful additions, not keyword stuffing (per the research's ethics findings).

## Success Criteria

A signed-in user opens **Analysis**, picks one of their applications and one of their résumés, and runs an analysis. They get an ATS-friendliness score with sub-scores, and — when the application has a job description — a match score with matched vs missing keywords (hard skills emphasized) and a prioritized list of concrete, rule-based suggestions; an unreadable/image-based résumé yields a clear parseability warning instead of an error. Past analyses are listed and reopenable. Everything is per-user, computed offline/deterministically, and covered by engine unit tests (extraction + ATS audit + match + suggestions) and API/UI tests (run + persist + history + isolation + the no-JD and unparseable paths).
