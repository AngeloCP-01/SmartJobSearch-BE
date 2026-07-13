# Draft Tailored Résumé in Editor — Design

**Date:** 2026-07-09
**Status:** Approved (brainstorming) → ready for implementation plan
**Repos:** BE (one small change) + FE (primary)
**Builds on:** V3-16 Tailor Résumé (`POST /api/analysis/tailor`, `generateTailoringSuggestions`), V3-5 authored-document editor, V3-7 Find/Replace extension, V3-12 Documents → Open in Editor (`GET /api/documents/:id/text`, `extractRich`).

## Purpose

Turn the (read-only) Tailor Résumé suggestions into an actionable editing session. A **"Draft in Editor"** button on the Tailor Résumé results opens the user's **real résumé, verbatim**, in the TipTap editor as a new editable `AuthoredDocument`, with a **suggestions side panel** docked alongside. Clicking a suggestion scrolls to and highlights the exact snippet of the résumé it targets, so the user can apply the edit by hand.

## Non-negotiable guardrail: no fabrication

The AI never rewrites the résumé. The résumé opens verbatim; the user makes every edit themselves. This is a deliberate continuation of the V3-16 "grounded suggestions, never an auto-rewrite" principle — fabrication is structurally impossible here because no model output is ever written into the résumé draft. `add` suggestions are shown as read-only notes, never applied.

## Flow

```
TailorResume results ──click "Draft in Editor"──▶ fetch résumé rich text (extractRich)
   │                                                create AuthoredDocument (type Resume,
   │  suggestions carried in router nav state       linked to the application)
   ▼
navigate /editor/:id  ──▶ DocumentEditor + TailoringPanel (right dock)
                            click a suggestion ──▶ editor.setSearchTerm(anchor).findNext()
                                                    → highlight + scroll (no-op if not found)
```

## Decisions (from brainstorming)

1. **Output = original résumé + suggestions panel** (no AI rewrite). Chosen over an AI-rewritten draft and over an AI-draft-plus-diff, because it eliminates fabrication risk and needs no second AI call.
2. **Panel behavior = click-to-locate.** Clicking a suggestion highlights the matching résumé text; graceful no-op when it can't be found. (Not a passive checklist; not click-to-apply, which is fragile.)
3. **Locate anchor = a new `anchor` field on the existing tailor call.** The suggestion carries the verbatim résumé snippet it targets, so locate is reliable. (Not best-effort keyword search, which misses `rephrase` items whose `text` is the *new* wording.)
4. **Persistence = ephemeral via router nav state.** The panel is a transient working aid. A reload drops the panel; the saved résumé draft remains. (No sessionStorage, no BE persistence/migration.)

## Backend change (small)

Extend the **existing** `POST /api/analysis/tailor` — no new endpoint, no new AI call.

- **Schema** (`analysis.schema.js`): `tailoringSuggestionSchema` gains `anchor: z.string()`.
  ```
  anchor: verbatim snippet from the CURRENT résumé the suggestion targets
          (emphasize / rephrase / remove); '' for add notes.
  ```
- **Prompt** (`generateTailoringSuggestions` in `analysis.service.js`): require `anchor` to be a short, **single-line**, copied-verbatim quote from the CURRENT RÉSUMÉ (single-line because the find extension cannot match across block boundaries), and `''` for `add`. Add `anchor` to the explicit JSON output-contract line and to the "every suggestion MUST include all fields" line.
- The no-fabrication backstop (an `add` must cite a real retrieved document) is unchanged. `humanize()` is applied to `text`/`why` as today; `anchor` is left verbatim (it must match the résumé exactly).
- Response shape is otherwise unchanged; `meta` is untouched.

## Frontend

### Entry point — `TailorResume.jsx`
Add a **"Draft in Editor"** button beside "Copy all" / "Save to Documents", implemented as a mutation mirroring the cover-letter `openInEditor`. Disabled when `suggestions.length === 0`. On click:
1. `GET /api/documents/:documentId/text` (`extractRich`) → `{ ok, kind, content }` (DOCX fidelity, same as Documents → Open in Editor).
2. Convert by `kind`: `html` → `htmlToProseMirrorDoc`, `.md` → markdown helper, else → `textToProseMirrorDoc`.
3. `createAuthoredDocument({ title: 'Tailored Résumé — ' + (meta.position || 'Untitled'), type: 'Resume', content, applicationId })`.
4. `navigate('/editor/' + doc.id, { state: { tailoring: { suggestions, meta } } })`.

**Shared helper:** extract steps 1–2 (fetch + convert-by-kind) from the existing Documents "Open in Editor" handler into a reusable `openDocumentInEditor(documentId)` helper (returns the ProseMirror content) so both the Documents page and Tailor page use one code path. This is the one targeted refactor of existing code; it removes duplication rather than adding it.

### Carrying suggestions — ephemeral nav state
- `EditorDocument` (route) reads `useLocation().state?.tailoring` and passes it down: `EditorDocument → EditorDocumentForm → DocumentEditor` as an optional `tailoring` prop.
- Absent on every normal editor visit (direct link, Documents open, cover-letter open, reload) → no panel, **zero behavior change**.

### The panel — `TailoringPanel.jsx`
Rendered by `DocumentEditor` beside the existing `FindReplacePanel` (so it holds the `editor` instance). Shown only when a `tailoring` prop is present.
- **Actionable group** (`emphasize` / `rephrase` / `remove`): each row = checkbox (tracks "done", like the Tailor page) + severity dot + kind chip + `text` + `why`.
- **Notes group** ("Not applied"): `add` items, read-only (no anchor, no locate).
- **Click a row** → `editor.chain().setSearchTerm(row.anchor).findNext().run()` → highlight (reusing `.search-match--active`) + scroll. If `anchor` is empty or `matches.length === 0`, show a subtle "couldn't locate — edit manually" hint; the checkbox still works.
- Selecting another row replaces the search term. Closing/unmounting the panel calls `clearSearch()`.
- No new decoration/highlight code — the V3-7 `findReplace` extension provides `setSearchTerm`, `findNext`, `clearSearch`.

## Error handling & edge cases

- **Extraction fails** (scanned PDF / legacy `.doc`) → surface the same error the Open-in-Editor path returns; do **not** create an empty draft.
- **Zero suggestions** → button disabled.
- **`add`-only result** → draft opens; panel shows only the Notes group.
- **Anchor unmatched** in the (possibly reformatted) draft → graceful no-op, never throws.
- **Nav state absent** → editor behaves exactly as today (regression-safe).

## Testing

- **BE:** the tailoring result round-trips the new `anchor` field through `tailoringResultSchema`; existing no-fabrication and fallback tests stay green (network mocked, as the suite already does).
- **FE:**
  - `TailorResume` — "Draft in Editor" creates the doc (mock `extractRich` + `createAuthoredDocument`) and navigates with `state.tailoring`; disabled when no suggestions.
  - `TailoringPanel` — renders the two groups; clicking an actionable row calls `setSearchTerm` + `findNext`; an unmatched/empty anchor shows the hint; `add` items render as notes.
  - `openDocumentInEditor` helper — converts each `kind` to the right ProseMirror content.
  - Regression: `EditorDocument` with no nav state renders no panel and behaves as before.

## Out of scope (YAGNI)

AI rewrite of the résumé; a change/diff view; click-to-apply; persisting the panel (sessionStorage or a BE field/migration); multi-anchor / cross-block matching. All considered and deliberately deferred/rejected during brainstorming.
