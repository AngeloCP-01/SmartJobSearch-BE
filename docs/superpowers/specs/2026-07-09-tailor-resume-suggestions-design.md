# Tailor Résumé — RAG-grounded tailoring suggestions (RAG part 2)

**Date:** 2026-07-09
**Status:** Design approved
**Builds on:** `2026-07-08-rag-infrastructure-design.md` (RAG part 1),
`2026-07-02-cover-letter-edit-in-editor-design.md` (nearest template)

## Summary

A new **Tailor Résumé** page (mirroring the Cover Letter Generator). The user
picks an application and one of their résumés; the backend returns a **grounded
suggestions checklist** of concrete edits to make that résumé fit the job.

The distinguishing ingredient is RAG grounding: suggestions are anchored in the
user's *real* document content, retrieved across their whole corpus with the job
description as the query. The hard guardrail is **no fabrication** — the feature
may only suggest adding experience/skills that actually appear in the user's
documents, and every such suggestion cites the document it came from.

The output is ephemeral (nothing persisted server-side), exactly like the cover
letter. The user can Copy the list or Save it to Documents.

## Goals / Non-goals

**Goals**
- Turn `retrieve()` (RAG part 1) into a user-visible feature.
- Produce actionable, grounded, no-fabrication résumé tailoring suggestions.
- Reuse the cover-letter template end to end (service shape, error handling,
  page structure, save-to-documents flow).

**Non-goals**
- Rewriting the résumé into a full new document / opening in the editor
  (rejected in favor of a suggestions checklist).
- Persisting tailoring runs as DB rows with history (rejected as heavier than
  the template; the cover-letter ephemeral pattern is used instead).
- Any change to the RAG indexing/retrieval layer — `retrieve()` is consumed
  as-is.

## Architecture & data flow

New service function:
`generateTailoringSuggestions(userId, { applicationId, documentId })`

1. Load the application (`include: { company: true }`) and the selected résumé
   document, both `userId`-scoped. `NotFoundError` if either is missing — same
   guards as `generateCoverLetter`.
2. Require a job description on the application (`ValidationError` if absent).
   Require `OPENROUTER_API_KEY` (`AppError` 503 `AI_UNAVAILABLE`). Extract the
   résumé text via `extractText`; `ValidationError` on scanned/legacy docs
   (`ok === false`).
3. **RAG grounding:** `retrieve(userId, jd, { topK: 8 })` — the most
   JD-relevant chunks across *all* the user's documents. Then one
   `prisma.document.findMany({ where: { userId }, select: { id, name } })` to
   map each chunk's `documentId` → document name, so every chunk carries its
   real source label.
4. Build the prompt (below): JD + full selected résumé + the retrieved grounded
   evidence, each chunk prefixed `[from: <docName>]`.
5. `generateJson(messages, tailoringResultSchema)` — structured output with the
   same model fallback the cover letter uses (`analysis/engine/openrouter.js`).
6. Apply the server-side backstop (below) and sort suggestions high→medium→low.
7. Return `{ suggestions, meta }`. Nothing is stored.

On any AI failure, mirror the cover letter: log with `err.kind` and throw
`AppError('The AI service is busy right now — please try again in a moment.',
503, 'AI_UNAVAILABLE')`.

## Suggestion schema (structured output)

Added to `analysis.schema.js`, validated by `generateJson`:

```js
const tailoringSuggestionSchema = z.object({
  kind: z.enum(['add', 'emphasize', 'rephrase', 'remove']),
  text: z.string(),        // the concrete change to make
  why: z.string(),         // ties it to a specific JD requirement
  groundedIn: z.string(),  // real source: a document name, or "this résumé"
  severity: z.enum(['high', 'medium', 'low']),
});
const tailoringResultSchema = z.object({
  suggestions: z.array(tailoringSuggestionSchema).max(12),
});
```

`groundedIn` is the anti-fabrication anchor:
- `kind: 'add'` → `groundedIn` **must** name the document the supporting
  evidence came from (e.g. `"Resume 2022.pdf"`). An `add` not backed by a
  retrieved chunk is forbidden.
- `emphasize` / `rephrase` / `remove` → `groundedIn` is `"this résumé"` (they
  operate on content already present in the selected résumé).

## Prompt & no-fabrication guardrail

**System prompt** — reuses the cover-letter humanizer rules (no em/en dashes,
no emojis, no curly quotes, avoid AI-tell vocabulary) plus hard grounding rules:

- "You suggest edits to a résumé. You NEVER invent experience, skills,
  employers, dates, or metrics."
- "You may only suggest ADDING something if it appears in the GROUNDED EVIDENCE
  below. Every 'add' must cite, in `groundedIn`, the exact document name it came
  from. If the evidence does not support a job requirement, say nothing about it
  — do not fabricate to fill a gap."
- "emphasize / rephrase / remove operate only on the CURRENT RÉSUMÉ; set their
  `groundedIn` to \"this résumé\"."

**User message** — three clearly delimited blocks:
`JOB DESCRIPTION`, `CURRENT RÉSUMÉ` (selected doc's extracted text), and
`GROUNDED EVIDENCE (real content from your documents)` — the retrieved chunks,
each line prefixed `[from: <docName>]`.

**Server-side backstop (defense in depth, does not trust the model):** after
parsing, drop any `add` suggestion whose `groundedIn` does not match a real
document name from the retrieved set (case-insensitive, trimmed). Even a
misbehaving model cannot surface a fabricated "add".

**Empty-retrieval edge case:** if `retrieve()` returns no chunks (corpus not
indexed, or only the one résumé exists), the evidence block reads "none" and the
model is limited to emphasize/rephrase/remove on the current résumé. The feature
still returns useful output rather than erroring.

## API surface

**Backend**
- `analysis.schema.js`: add `tailorSchema` (`applicationId`, `documentId` — both
  `z.string().uuid()`; identical to `coverLetterSchema`) plus
  `tailoringSuggestionSchema` / `tailoringResultSchema`.
- `analysis.service.js`: add `generateTailoringSuggestions`; import `retrieve`
  from `../rag/rag.service`. Reuse `readBuffer`, `extractText`, and the existing
  error classes. Export the new function.
- `analysis.controller.js`: add `tailor` handler (201 JSON, mirrors
  `generateCoverLetter`).
- `analysis.routes.js`: `router.post('/tailor', validate(tailorSchema),
  ctrl.tailor);` placed above the `/:id` routes.
- Config: unchanged — the FE reuses `GET /analysis/config` (`aiAvailable`) to
  gate the button.

**Frontend**
- `api/analysis.js`: `tailorResume({ applicationId, documentId })` →
  `POST /analysis/tailor`.
- New `pages/TailorResume.jsx`, cloning `CoverLetter.jsx`'s structure:
  - Two selects (Application, Résumé), a Generate button gated on
    `aiAvailable`, and the `noJd` warning when the chosen application has no JD.
  - Results render as a **checklist** of suggestion cards: a severity dot, a
    `kind` badge, the `text`, muted `why`, and a "grounded in {groundedIn}"
    citation line. Local checkbox state lets the user tick items off.
  - Actions: **Copy all** (formats the list to plain text) and **Save to
    Documents** (reuse `createDocument` + `linkDocument`, saved as
    `Tailoring Notes — <role>.txt`, `type: 'Other'` — the `DocumentType` enum
    is `Resume | CoverLetter | Other`, and tailoring notes are neither a résumé
    nor a cover letter).
- Nav + route: add **Tailor Résumé** to `Layout.jsx` nav and a route in
  `App.jsx`, adjacent to Cover Letter.

## Testing (TDD)

**Service tests** — mock `retrieve`, `extractText`, and `generateJson`:
- JD missing → `ValidationError`.
- No `OPENROUTER_API_KEY` → `AppError` 503 `AI_UNAVAILABLE`.
- `retrieve` is called with the application's JD as the query text.
- **Backstop:** an `add` suggestion whose `groundedIn` is not among the
  retrieved document names is dropped from the result.
- Empty retrieval still returns emphasize/rephrase suggestions (no throw).
- AI failure → 503 `AI_UNAVAILABLE`.

**Frontend tests** (`TailorResume.test.jsx`, mirroring `CoverLetter.test.jsx`):
- Renders returned suggestions with their citations.
- Generate disabled when `aiAvailable` is false.
- `noJd` warning shown for a JD-less application.
- Copy and Save wired to their handlers.

Follows the repo's existing Jest + React Testing Library patterns.

## Reuse summary

| Concern | Reused from |
| --- | --- |
| Service guards, `readBuffer`, error shapes, humanizer prompt rules | `analysis.service.generateCoverLetter` |
| Structured output + model fallback | `analysis/engine/openrouter.generateJson` |
| Cross-corpus retrieval | `rag.service.retrieve` (part 1) |
| Page layout, selects, `aiAvailable`/`noJd` gating, Save-to-Documents | `pages/CoverLetter.jsx` |
| Validation middleware, route registration | `analysis.routes.js` |
