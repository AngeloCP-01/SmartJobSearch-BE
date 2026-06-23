# Contacts (v2) — Design Spec

**Date:** 2026-06-23
**Status:** Approved
**Builds on:** v1 (`2026-06-22-job-search-crm-v1-design.md`) + v1.5 (`2026-06-23-application-details-design.md`). Backend + frontend both on `main`.

## Purpose

Job seekers deal with recruiters and interviewers as much as with companies and roles. v2's first slice adds a **Contacts** module so the user can track those people — a recruiter at an agency, an in-house interviewer — and connect them to the companies they work at and the applications they touch. It is a full vertical slice (new backend module + new frontend page) that mirrors the existing `companies`/`applications` patterns, and it lays groundwork the later Analytics ("most active contacts") and Reminders ("follow up with X") modules build on.

## Scope

**IN:**
- New **`Contact`** model (per-user) with an optional `companyId` FK and a follow-up date.
- New **`ApplicationContact`** explicit join table — a contact links to many applications, an application has many contacts.
- New backend **`contacts/`** module: full CRUD + application link/unlink endpoints.
- `GET /api/applications/:id` includes the application's linked contacts.
- New frontend **Contacts page** (`/contacts`, sidebar nav): searchable list, create/edit via a right-side drawer (reusing the company picker with inline company create), delete.
- A **Contacts section** in the existing Application Detail Drawer: list linked contacts, link an existing contact (searchable picker + inline quick-create), unlink.

**OUT (deferred):** any reminder *firing* (`followUpDate` is stored and displayed only — Reminders is a later v2 slice), communication/message history log, a per-link "role on this application" field, CSV import, and a company-detail contacts list (no company detail page exists yet). Analytics is a separate v2 slice.

## Data Model

### `Contact` (new, per-user — mirrors `Company`)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `userId` | uuid, fk → User | hard isolation; every query filters by it |
| `companyId` | uuid?, fk → Company | optional; `onDelete: SetNull` (contact survives company deletion) |
| `name` | string | **required** |
| `email` | string? | validated as email when present |
| `position` | string? | their job title (e.g. "Technical Recruiter") |
| `phone` | string? | free text |
| `linkedinUrl` | string? | validated as URL when present |
| `notes` | string? | |
| `followUpDate` | DateTime? | forward-compat with Reminders; does not fire anything |
| `createdAt` | DateTime | |
| `updatedAt` | DateTime | |

Relations: `company Company?`, `applicationLinks ApplicationContact[]`.

### `ApplicationContact` (new, explicit join)
| Field | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `applicationId` | uuid, fk → Application | `onDelete: Cascade` |
| `contactId` | uuid, fk → Contact | `onDelete: Cascade` |
| `createdAt` | DateTime | |

`@@unique([applicationId, contactId])` — a contact can't be linked to the same application twice.

Relations added to existing models: `Application.contactLinks ApplicationContact[]`, `Company.contacts Contact[]`.

One `prisma migrate` adds both new models, the join, and the back-relations.

## Backend Changes

New module `src/modules/contacts/` following the established layering (routes → validate (Zod) → controller → service), every service function taking `userId` and filtering by it.

### Endpoints
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/contacts` | List the user's contacts; `?search` over name + email; includes `company {id, name}` |
| `POST` | `/api/contacts` | Create |
| `GET` | `/api/contacts/:id` | Detail; includes `company {id, name}` and linked applications (`{id, position, company {id,name}}`) |
| `PATCH` | `/api/contacts/:id` | Update |
| `DELETE` | `/api/contacts/:id` | Delete |
| `POST` | `/api/applications/:id/contacts` | Link a contact: body `{ contactId }` |
| `DELETE` | `/api/applications/:id/contacts/:contactId` | Unlink |

- **Ownership:** create/update validate `companyId` ownership when present (reuse the `assertCompany` pattern from applications). Link/unlink verify the user owns **both** the application and the contact before touching the join.
- **Duplicate link** → `409` with the standard error shape (`{ error: { message, code } }`).
- **Company unlink:** `PATCH` with `companyId: null` clears the relation (same nullable-optional pattern as applications' company unlink).
- Extend `applications.service.getById` to `include` linked contacts (`{ id, name, position, company {id,name} }`) so the drawer can render them.

### Validation (Zod)
- `createContactSchema`: `name` required (non-empty); `email` `z.string().email().optional()`; `linkedinUrl` `z.string().url().optional()`; `phone`/`position`/`notes` optional strings; `companyId` `z.string().uuid().optional()`; `followUpDate` ISO datetime optional.
- `updateContactSchema`: all fields optional; `companyId` `z.string().uuid().nullable().optional()` (null clears).
- Link body: `{ contactId: z.string().uuid() }`.

### Backend tests (TDD — `tests/contacts.test.js`)
- CRUD happy paths (create returns the row with `company` included; list; detail; update; delete).
- Validation errors: missing `name`, malformed `email`, malformed `linkedinUrl` → `400` with details.
- Auth required on every route (`401` without token).
- **Cross-user isolation:** user B cannot read/update/delete user A's contact; cannot link A's application or A's contact.
- Company link: set `companyId`, then clear with `companyId: null`.
- Application link/unlink: link → appears on application detail; unlink → gone; duplicate link → `409`; linking a contact or application the user doesn't own → `404`/`403`.
- Extend an applications-detail test to assert linked contacts are included.

## Frontend Changes

### Contacts page (`/contacts`)
- New **sidebar nav item** "Contacts" (lucide `Users` icon), added to the existing sidebar between Companies and Interviews.
- Searchable list of **contact cards** (white, rounded-xl, sky-100 border per DESIGN.md): name (bold), position + company (muted), an email/LinkedIn affordance, and a `followUpDate` **pill** when set (amber if the date is past — visual only, fires nothing).
- **Create / Edit drawer** (right-side, reusing the v1.5 drawer pattern — `role="dialog"`, focus-trapped, `Esc`/backdrop/close to dismiss): fields Name* (text), Email, Position, Phone, LinkedIn URL, Company (the existing searchable company picker **with inline create**), Follow-up date (date input), Notes (textarea). Client guards mirror the server (email/URL format) with inline messages.
- **Actions:** Save → `POST /contacts` (create) or `PATCH /contacts/:id` (edit); on success invalidate `['contacts']` and close. Delete (edit mode) → confirm → `DELETE /contacts/:id`.
- Friendly **empty state** with guidance (matches existing pages).

### Contacts section in the Application Detail Drawer
- Modeled on the existing Interviews section. Lists the application's linked contacts (name · position · company) from the application detail, each with an unlink (×) button → `DELETE /applications/:id/contacts/:contactId`.
- A **"Link contact"** control: a searchable picker over the user's existing contacts (`['contacts']`), plus an **inline quick-create** ("Create new contact") that `POST /contacts` then links it. Link → `POST /applications/:id/contacts`.
- On link/unlink, invalidate the application detail query so the section refreshes.

### API & query keys
- New FE API module `contacts.js`: `listContacts(search?)`, `getContact(id)`, `createContact(body)`, `updateContact(id, body)`, `deleteContact(id)`, `linkContact(applicationId, contactId)`, `unlinkContact(applicationId, contactId)`.
- Query keys: `['contacts']` (list + search), `['contacts', id]` (detail). Application detail (existing key) invalidated on link/unlink. Simple invalidate-on-mutation, matching the drawer's interview pattern (no optimistic updates).
- Built with the **ui-ux-pro-max** skill against DESIGN.md tokens.

### Frontend tests (Vitest + RTL + MSW)
- Contacts page: renders the list; search filters; create issues `POST /contacts` and shows the new contact; edit issues `PATCH /contacts/:id`; delete issues `DELETE /contacts/:id`; email/URL guard blocks save with a visible message.
- Drawer contacts section: renders an application's linked contacts; "Link contact" with an existing contact issues `POST /applications/:id/contacts`; inline quick-create issues `POST /contacts` then links; unlink issues the `DELETE` and removes the row.
- MSW handlers for every new endpoint, matching the backend response/error shape and enum values exactly.

## Architecture Notes

- The `contacts/` backend module is a self-contained vertical slice: routes own URLs/middleware, the controller owns HTTP, the service owns Prisma + business rules, all keyed by `userId`. The link/unlink endpoints live under `applications/:id/contacts` (the application is the resource being modified) but their handlers may live in the contacts module for cohesion — chosen at implementation time to match existing route wiring.
- The contact create/edit drawer is a focused component with a clear interface: `<ContactDrawer contact={c|null} open onClose />` (`null` = create mode), owning its form state and mutations — the Contacts page only controls open/close and which contact. It reuses the existing company-picker component rather than duplicating it.
- `followUpDate` is stored and displayed only; no scheduling, no jobs — the Reminders slice will consume it later.

## Success Criteria

A user can: open Contacts from the sidebar, add a recruiter (name, email, position, phone, LinkedIn, company-or-create-inline, follow-up date, notes), search their contacts, edit and delete one; and from an application's drawer, link an existing contact (or quick-create one) and later unlink it — with the application detail reflecting its contacts. All data is per-user isolated and covered by backend and frontend tests.
