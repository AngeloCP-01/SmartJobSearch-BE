# In-App Rich-Text Document Editor (TipTap) — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorming complete)
**Scope:** Cross-cutting — `SmartJobSearchCRM-BE` (Prisma model + module) and `SmartJobSearchCRM-FE` (editor UI). Spec lives in BE because the foundational data model anchors there.

## Goal

Let users create, edit, and format rich-text documents (resumes, cover letters, notes) entirely inside the app, with a Google-Docs-like toolbar. Documents are optionally linked to a job application. No Google API, no OAuth — free, self-hosted, content stored in our own database.

## Background & key decision

The user's screenshot showed the Google Docs toolbar and asked whether an API exists so we don't rebuild it. Important finding surfaced during brainstorming: **Google offers no embeddable, editable Docs editor.** The Docs API is backend-only (JSON `batchUpdate`), Drive embeds are read-only previews, and "editing" bounces users to docs.google.com. The only way to get the exact in-app toolbar experience from the screenshot is an **embedded editor library**. Decision: **TipTap** (headless ProseMirror, MIT, best React support, Tailwind-styleable toolbar).

A second finding: the codebase **already has** a `Document` model + `documents` module, but it stores **uploaded binary files** (`originalFilename`, `mimeType`, `sizeBytes`, `storageKey`, `documents.upload.js`) and feeds the `ResumeAnalysis`/ATS flow. Authored rich-text is a genuinely different concept.

**Decision:** Add a **new, separate** `AuthoredDocument` model and `authored-documents` module rather than extend the upload `Document` model. Rationale: avoids nullable-file-field branching across `documents.service.js`/`documents.upload.js`, keeps the working upload + ATS flow untouched, and matches the modular-monolith style. The ATS tie-in (analyzing an authored resume) is recoverable later via a small bridge action — not worth coupling the two models now.

## Architecture

- **Frontend:** React + Vite. New TipTap-based `<DocumentEditor>` component with a Tailwind toolbar (core tools). New "Documents" list page + editor route. React Query for data and debounced autosave.
- **Backend:** New `authored-documents` module mirroring the existing per-module file pattern (`*.controller.js / *.routes.js / *.schema.js / *.service.js`). New Prisma `AuthoredDocument` model.
- **Content format:** TipTap/ProseMirror **JSON** in a `content Json` column (round-trips perfectly for re-editing). Not HTML.

## Data model (new)

```prisma
enum AuthoredDocType {
  Resume
  CoverLetter
  Note
}

model AuthoredDocument {
  id            String          @id @default(uuid())
  userId        String
  user          User            @relation(fields: [userId], references: [id], onDelete: Cascade)
  title         String
  type          AuthoredDocType @default(Note)
  content       Json            // TipTap/ProseMirror JSON
  applicationId String?         // optional link to a job application
  application   Application?    @relation(fields: [applicationId], references: [id], onDelete: SetNull)
  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  @@index([userId])
  @@index([applicationId])
}
```

Also adds a back-relation field on `Application` (e.g. `authoredDocuments AuthoredDocument[]`). Names are provisional and easy to rename. Migration created via Prisma.

## Backend API

Base path `/api/authored-documents`, auth-protected, user-scoped (ownership checks like other modules):

| Method | Path  | Purpose |
|--------|-------|---------|
| GET    | `/`   | List current user's docs (id, title, type, applicationId, updatedAt) |
| POST   | `/`   | Create (title, type, optional applicationId, initial content) |
| GET    | `/:id`| Fetch one (full content) |
| PATCH  | `/:id`| Update title/type/content/applicationId — autosave target |
| DELETE | `/:id`| Delete |

Validation via the existing `*.schema.js` pattern. All queries scoped by `userId`; `:id` routes verify ownership and 404 otherwise.

## Frontend

- **`<DocumentEditor>`** — TipTap `useEditor` with StarterKit + Underline + Link + TextAlign extensions. Core toolbar (matching the screenshot's essentials): bold, italic, underline, strikethrough; H1–H3 + paragraph; bullet & numbered lists; link; left/center/right align; undo/redo. Styled with Tailwind.
- **Autosave** — debounced (~1.5s after typing stops) React Query mutation to `PATCH /:id`; header shows `Saving… / Saved`.
- **Documents page** (route e.g. `/documents`) — list with title/type/updated, "New document" button, open + delete. New docs are created then routed to `/documents/:id`.
- **Print / PDF export** — a "Print / Save as PDF" button using print-scoped CSS that renders only the document content; the user uses the browser's native print → Save as PDF. No extra library.
- **Optional (phase 2):** attach/jump to related docs from the application detail view.

## Testing

- **Backend:** service + route tests — CRUD, auth/ownership enforcement, validation — following the existing module test style.
- **Frontend:** component tests for toolbar commands (bold toggles mark, list inserts node), autosave debounce + mutation (MSW), list-page render. Optional Playwright e2e: create → type → format → reload → content persisted.

## Out of scope for v1

Fonts / font-size, text color / highlight, images, tables, find-replace, comments, real-time collaboration, and the authored-resume → ATS bridge. All addable in later iterations.
