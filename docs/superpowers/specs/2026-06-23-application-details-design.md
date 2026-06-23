# Application Details (v1.5) — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Builds on:** v1 (`2026-06-22-job-search-crm-v1-design.md`). Backend + frontend both on `main`.

## Purpose

v1 ships a one-field "quick add" for applications, so a tracked application only shows its position — even though the backend `Application` model already stores company, salary, dates, source, job description, and notes. This slice surfaces those fields through an **application detail/edit drawer**, makes the Kanban cards informative, and turns an application into the hub for its interviews. Mostly frontend; two small backend changes.

## Scope

**IN:**
- Right-side **drawer** to view/edit an application (all fields) and create one from scratch.
- Company picker in the drawer: select an existing company **or create one inline**.
- The application's **interviews** listed in the drawer, with inline add/delete.
- Kanban cards show **company name** + a **salary chip**.
- Backend: include `company {id, name}` on application responses; allow **unlinking** a company.

**OUT (deferred):** resume/file attachments (v3), rich-text editor (plain textareas), bulk edit, status history/activity-log timeline (later module), Contacts/Analytics (v2).

## Backend Changes

### 1. Include company on application responses
- `applications.service.list` and `applications.service.getById` add a Prisma `include: { company: { select: { id: true, name: true } } }`.
- Response shape gains `company: { id, name } | null` alongside the existing `companyId`.
- `create`, `update`, `updateStatus` may also return the included company for consistency (return the row with the same `include`).

### 2. Allow unlinking a company
- `updateApplicationSchema`: `companyId` becomes `z.string().uuid().nullable().optional()`.
- `applications.service.assertCompany(userId, companyId)`: skip the ownership check when `companyId` is `null` or `undefined`; only validate when a non-null id is provided. A `null` `companyId` in a `PATCH` clears the relation (Prisma sets the FK null).

No other backend changes — `create`/`update` already accept `position, status, applicationDate, salaryMin, salaryMax, source, jobDescription, notes`; the salary `min ≤ max` refine already exists; inline company creation reuses `POST /companies`; the drawer's interviews reuse `GET/POST/DELETE /interviews`.

### Backend tests (TDD)
- `GET /applications` and `GET /applications/:id` include `company {id,name}` when linked, and `company: null` when not.
- `PATCH /applications/:id` with `{ companyId: null }` unlinks (subsequent read shows `company: null`, `companyId: null`).
- Existing isolation/validation tests still pass.

## Frontend Changes

### Drawer component (`ApplicationDrawer`)
- A right-side panel (`role="dialog"`, `aria-modal`, focus-trapped, `Esc`/backdrop/close-button to dismiss) over the board.
- **Two modes:**
  - **Edit** — opened by clicking a card's open affordance; pre-filled from the application.
  - **Create** — opened by a "New application" button on the board; empty form.
- **Fields:** Position* (text), Company (searchable select of the user's companies + "Create new company" inline), Status (the 9 statuses), Applied date (date input), Salary min / max (number), Source (text), Job description (textarea), Notes (textarea). Read-only created/updated shown in edit mode.
- **Actions:** Save → `POST /applications` (create) or `PATCH /applications/:id` (edit); on success invalidate `['applications']` and close. Delete (edit mode) → confirm → `DELETE /applications/:id`. Client guard: if both salaries set, require min ≤ max (with an inline message); the backend also enforces it.
- **Inline company create:** a "Create new company" affordance opens a tiny name input; submitting calls `POST /companies`, invalidates `['companies']`, and selects the new company in the picker.

### Interviews section (in the drawer, edit mode)
- Lists the application's interviews via `GET /interviews?applicationId=<id>` (query key `['interviews', applicationId]`), each showing type + result + interviewer, with a delete button.
- A compact add row: type (select) + optional interviewer + optional date → `POST /interviews` with the application's id; invalidates `['interviews', applicationId]`.

### Board / card changes (`Applications.jsx`)
- Each card shows position (bold), **company name** (muted, from the included `company`), and a **salary chip** (e.g. `$90k–$110k`) when set.
- An explicit **open** control on the card (icon button, `aria-label`) opens the drawer in edit mode — separate from the drag handle so dragging and opening don't conflict.
- A **"New application"** button opens the drawer in create mode (the one-field quick-add form stays for fast capture).

### Frontend tests (Vitest + MSW)
- Clicking a card's open control opens the drawer pre-filled with the application's fields.
- Editing a field and saving issues the correct `PATCH /applications/:id` and closes the drawer.
- Create-from-drawer issues `POST /applications` with the entered fields.
- Inline company create: `POST /companies` then the new company is selected.
- Salary guard: min > max blocks save with a visible message.
- Interviews section: listing renders the application's interviews; adding posts to `/interviews` with the application id; delete removes one.
- Card renders the company name and salary chip from the included `company`.

## Architecture Notes

- The drawer is a focused, self-contained component with a clear interface: `<ApplicationDrawer application={app|null} open onClose />` (a `null` application = create mode). It owns its form state and mutations; the board just controls open/close and which application.
- The drawer pre-fills from the application object passed in (already in the board's `['applications']` cache), so no single-application GET is needed; interviews are fetched separately. Reuse existing API modules; add `updateApplication(id, body)` to `applications.js` (create already exists).
- Query keys: `['applications']` (board + invalidation), `['companies']` (picker), `['interviews', applicationId]` (drawer interviews).

## Success Criteria

A user can: quick-add an application, click it open, set its company (or create one inline), fill salary/date/source/description/notes, save, see the company + salary on the card, add an interview to it from the drawer, unlink a company, and delete the application — all without leaving the board.
