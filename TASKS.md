# Backend Tasks (v1)

Spec: `docs/superpowers/specs/2026-06-22-job-search-crm-v1-design.md`
Plan: `docs/superpowers/plans/2026-06-22-backend-v1.md`
Master coordination: `../TASKS.md`

> **Status (2026-06-23):** BE-0…BE-5 ✅ + **v1.5 application-details** ✅ — implemented TDD, reviewed, and merged to `main` (45 tests passing). Only **BE-6 (deploy)** remains.
>
> **v1.5 (application details):** application responses include `company {id,name}`; `PATCH` with `companyId: null` unlinks. Spec: `docs/superpowers/specs/2026-06-23-application-details-design.md`.

> **Update (2026-06-26):** **BE-6 deploy done** — API live on Render + Neon + Supabase (`DEPLOY.md`). Plus a portfolio-readiness pass: **demo seed** (`prisma/seed.js`, seeded to prod), **keep-alive** + **CI** GitHub Actions, and a rewritten portfolio README. Then AI features: **cover-letter generator** + **job-posting auto-import** (`postings` module). Fixed the serial-suite test-DB flake (`connection_limit=1`). Tests **170 passing / 1 skipped — reliably green in CI**. See `TRACKER.md` Notes.
>
> **Update (2026-06-29):** **V3-5 — In-app document editor (BE)** done, reviewed, **PR #1 merged to `main` (CI-green)**. New `authored-documents` CRUD module + `AuthoredDocument` model/migration for rich-text docs authored in-app (separate from the V3-1 uploads module). `userId`-scoped, ownership enforced on read+write, list omits `content`, optional application link. **188 tests** (full suite green). Spec/plan: `docs/superpowers/{specs,plans}/2026-06-29-authored-document-editor*.md`. See `TRACKER.md` Notes.
>
> **Update (2026-06-30):** **V3-6 — Editor v2 (Typography & Page Layout)** is **frontend-only**; this repo carries only the spec + plan (`docs/superpowers/…2026-06-29-editor-v2-typography-page-layout…`), merged to `main`. No backend code/migration. Implementation + 170 tests in `SmartJobSearchCRM-FE`.
>
> **Update (2026-06-30):** **V3-7 — Editor v3 (Tables & Find/Replace)** is **frontend-only**; this repo carries only the spec + plan (`docs/superpowers/…2026-06-30-editor-v3-tables-findreplace…`), merged to `main`. No backend code/migration. Implementation + 184 tests in `SmartJobSearchCRM-FE`. **Heads-up:** the next editor batch (V4 — images) WILL need this repo — a public-URL/storage capability for `<img src>` (new `getPublicUrl` + public bucket/image endpoint). See `TRACKER.md` Notes.
>
> **Update (2026-06-30):** **V3-8 — Editor v4 (Images)** done, reviewed, **merged to local `main` (NOT pushed)**. New `Image` model + migration + an `images` module: auth'd `POST /api/images` and an **unauthenticated** `GET /api/images/:id` public serve (private storage, by UUID, `nosniff`, no public bucket). New `PUBLIC_API_URL` env (required in prod — see `DEPLOY.md`). **193 tests.** Frontend in `SmartJobSearchCRM-FE` (190 tests). **Before deploy:** set `PUBLIC_API_URL` on Render (the `add_image` migration runs on deploy). Spec/plan: `docs/superpowers/…editor-v4-images…`. See `TRACKER.md` Notes.
>
> **Update (2026-07-01):** added dev-only `[editor-debug]` logging (authored-documents PATCH/GET image-node counts + image upload); it proved the image-"not saving" bug was a client-side stale React Query cache (fixed in the FE), not a server bug. Logging kept. **Next task:** a comprehensive request logger (all API calls, success + error, with the error message).
>
> **Update (2026-07-01):** **V3-9 — Editor v5 (Image selection & free-resize)** is **frontend-only**; this repo carries only the spec + plan (`docs/superpowers/…2026-07-01-editor-image-selection-resize…`), merged to `main` and **pushed**. No backend code/migration. Implementation + 200 tests in `SmartJobSearchCRM-FE`.
>
> **Update (2026-07-02):** **V3-10 — Editor v6 (Image text-wrapping, drag positioning & free placement)** is **frontend-only**; this repo carries only the spec + plan (`docs/superpowers/…2026-07-01-editor-image-text-wrapping…`, `…2026-07-01-editor-image-drag-positioning…`, `…2026-07-02-editor-image-free-placement-labels…`), merged to `main` and **pushed**. Delivers the long-deferred v5 floating behind/in-front-of-text signature overlay. No backend code/migration. Implementation + 221 tests in `SmartJobSearchCRM-FE`.
>
> **Update (2026-07-02):** **V3-11 — Cover Letter: Edit in Editor** is **frontend-only, no backend changes** (a cover-letter integration, not an editor version); this repo carries only the spec + plan (`docs/superpowers/…2026-07-02-cover-letter-edit-in-editor…`), merged to `main` and **pushed**. Reuses the existing `POST /authored-documents`. Implementation + 225 tests in `SmartJobSearchCRM-FE`.

> **Update (2026-07-06):** **V3-13 — Documents → Editor: DOCX formatting fidelity** — **real backend work** (merged to local `main`). Closes the V3-12 deferred visual-fidelity gap via a pure HTML post-process on mammoth's output in `engine/extract.js`: `postProcessDocxHtml()` (curated section-label list → `<h2 data-rule="true">`; tab-split lines → borderless `<table class="doc-columns">`) + `normalizeLabel`/`SECTION_LABELS`, and `extractDocxHeader` now centers the contact block from the source `w:jc`. Wrapped so any error falls back to raw mammoth output (never regresses); `extractText` untouched; no new dep, no migration. Added `tests/fixtures/formatted-resume.docx` + an end-to-end integration test. TDD; **BE 217 / 1 skipped** (serial). Frontend (HeadingRule + TableColumns extensions, importer alignment, CSS, print/pagination fix) + 242 tests in `SmartJobSearchCRM-FE`. Final Opus cross-repo review: Ready to merge. Spec/plan: `docs/superpowers/…2026-07-03-docx-open-fidelity…`. See master tracker V3-13.

> **Update (2026-07-07):** **V3-14 — AI speedup: multi-provider routing (Qwen-on-NVIDIA)** — **real backend work** (merged to local `main`). All three AI features (cover-letter, ATS, job auto-fill) ~2–10× faster. Measured the bottleneck (OpenRouter free model ~16 tok/s, not gateway/limits/cold-start). Added a `<provider>:` prefix so one fallback chain spans providers: `resolveProvider(spec)` routes `nvidia:`/`openrouter:` to the right base URL + key (unknown prefix / `:free` suffix → OpenRouter, so back-compat). Primary is now NVIDIA `qwen/qwen3-next-80b-a3b-instruct` (non-reasoning), OpenRouter fallback. Cover letter/ATS ~5s end-to-end (from 13–57s). TDD; **BE 222 tests**. Deploy: set `OPENROUTER_MODEL` chain + `NVIDIA_*` on Render. Config in `.env.example`.

> **Update (2026-07-09):** **V3-15 — RAG retrieval infrastructure** — **real backend work** (merged to local `main`). **PART 1 of 2.** A reusable, `userId`-scoped retrieval layer over uploaded documents: **pgvector** `DocumentChunk` (`public.vector(1024)` + HNSW cosine + FK cascade), a NVIDIA embedding client (`nv-embedqa-e5-v5`, asymmetric `input_type`, reuses the provider routing), pure chunking, `indexDocument`/`reindexAll` (extract→chunk→embed→replace in one tx, idempotent) + an index-on-upload hook (gated on `embeddingConfigured()`, fire-and-forget), `userId`-scoped cosine `retrieve()`, and `POST /api/rag/reindex` + `GET /api/rag/search`. Type/operator schema-qualified (`public.vector`, `OPERATOR(public.<=>)`) so they resolve under the per-worker test `search_path`; globalSetup pre-creates the extension. Built subagent-driven (6 TDD tasks; controller did the pgvector infra inline) + a final Opus review: Ready to merge (isolation + SQL safety verified). **Backend-only — no UI.** **BE 243 tests.** Deploy: enable pgvector on Neon, migrate, set `EMBEDDING_MODEL`, then `POST /api/rag/reindex` to backfill. Spec/plan: `docs/superpowers/…2026-07-08-rag-infrastructure…`. **Part 2 (AI résumé tailoring) not yet spec'd.**

> **Update (2026-07-09):** **V3-16 — Tailor Résumé (RAG part 2 of 2)** — **real backend work** (merged `a6b99e3`). Consumes V3-15's `retrieve()`: `POST /api/analysis/tailor` → `generateTailoringSuggestions` retrieves the most JD-relevant chunks across the user's docs and returns `{kind:add|emphasize|rephrase|remove, text, why, groundedIn, severity}` suggestions. **Suggestions-only**, with a server-side **no-fabrication backstop** (an `add` is dropped unless `groundedIn` cites a real retrieved document; the display placeholder can't bypass it). Ephemeral. Friendly 503 when AI/retrieval is unavailable. Subagent-driven + final Opus review: Ready to merge. **BE tests green.** Deploy: `OPENROUTER_API_KEY` + `NVIDIA_OPENAI_KEY` + stabilized `OPENROUTER_MODEL`. Spec/plan: `docs/superpowers/…2026-07-09-tailor-resume-suggestions…`.

> **Update (2026-07-13):** **V3-17 — Draft Tailored Résumé in Editor** — backend part (merged `80dacb9`, pushed). The existing `POST /api/analysis/tailor` now returns a verbatim **`anchor`** snippet per suggestion (`''` for `add`; schema null-tolerant) so the FE editor can locate it in the résumé. No new endpoint/AI call; no-fabrication backstop unchanged; `anchor` never humanized. Rest of the feature is frontend (opens résumé verbatim + click-to-locate panel, no AI rewrite). Subagent-driven (5 TDD tasks) + final Opus review + a browser e2e that caught/fixed a stale-match locate bug (FE). **BE 25 analysis tests.** Spec/plan: `docs/superpowers/…2026-07-09-tailored-resume-in-editor…`.

> **Update (2026-07-13):** **Production deploy sync + graceful storage errors** — **real backend work** (pushed, live). Got prod current with V3-14→17. Live check found Tailor/Analysis 500'ing; root cause was the **free Supabase Storage project auto-pausing after ~7 days idle** (DB is on Neon, so app use never touches Supabase). Resuming fixed it; re-verified the whole AI/RAG/editor stack live. **Code (`a0a3c9e`):** shared `storage.readBuffer` → friendly **503 `STORAGE_UNAVAILABLE`** instead of a raw 500 across analysis/tailor/cover-letter/RAG/doc-open (replaced 3 duplicated copies) + storage tests. **Config/docs (`2001364`, `dd800f9`):** completed `render.yaml` env blueprint (`NVIDIA_OPENAI_KEY`/`EMBEDDING_MODEL`/`NVIDIA_BASE_URL`/`PUBLIC_API_URL` + stabilized `OPENROUTER_MODEL`), `.env.example`, and the Supabase-pause gotcha + R2 prevention in `DEPLOY.md`. Graceful 503 verified in prod. Follow-up (optional): move storage to Cloudflare R2 to avoid the pause.

> Granular per-step tasks lived in the implementation plan above; this file is the milestone summary.

## BE-0 — Scaffold
- Express app + server bootstrap (`app.js` / `server.js`)
- Prisma init + `schema.prisma` with User, RefreshToken, Company, Application, Interview + enums
- `docker-compose.yml` (Postgres), `.env.example`
- Shared middleware: error handler, zod `validate`, request logging
- Jest + Supertest harness against a test database

## BE-1 — Auth
- Models wired: User, RefreshToken
- `POST /auth/register`, `/login`, `/refresh`, `/logout`; `GET /auth/me`
- Password hashing (bcrypt/argon2), JWT access token, refresh token in httpOnly cookie + rotation
- `auth` middleware (extracts/validates access token → `userId`)

## BE-2 — Companies
- CRUD `/companies` + `?search=`
- Per-user isolation enforced in service layer

## BE-3 — Applications
- CRUD `/applications` (+ `?status=`)
- `PATCH /applications/:id/status` for Kanban moves
- FK to Company; status enum validation

## BE-4 — Interviews
- CRUD `/interviews` (+ `?applicationId=`)
- FK to Application; type/result enums

## BE-5 — Dashboard
- `GET /dashboard/summary`: total applications, count-by-status, upcoming interviews

## BE-6 — Deploy ☑ *(live since 2026-06-25)*
- Render web service (free) + Neon Postgres + Supabase Storage (S3 driver); `render.yaml` blueprint. API: `https://smartjobsearch-api.onrender.com/api`.
- Production env/secrets, CORS origin; migrations run automatically on deploy (`prisma migrate deploy` in the start command).
- See `DEPLOY.md` for the full walkthrough + gotchas (CORS origin exactness, `NODE_ENV=production`, the Supabase Storage auto-pause).
