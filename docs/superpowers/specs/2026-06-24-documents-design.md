# Documents & Resume Tracking (v3) — Design Spec

**Date:** 2026-06-24
**Status:** Approved
**Builds on:** v1, v1.5, and v2 (Contacts, Analytics, Reminders). Backend + frontend both on `main` (BE 79 tests, FE 73 tests).

## Purpose

A job seeker iterates on multiple résumé and cover-letter versions and needs to know **which version was sent to which application**. v3's first slice adds a **document library** (uploaded files with light metadata) that can be **linked to applications** — a many-to-many that records "this version went to that application." It reuses the established Contact ↔ Application pattern so the feature feels native to the app. Unlike the v2 slices, this introduces **real file upload** (stored on local disk in dev behind a storage abstraction) and a **database migration** (two new tables).

## Scope

**IN:**
- New backend **`documents/`** module: upload / list / download / update-metadata / delete, all `userId`-scoped, with real file storage behind a swappable interface.
- A **`Document` ↔ `Application` many-to-many** (`ApplicationDocument` join), mirroring `ApplicationContact`; link/unlink endpoints and `documents` included on application detail.
- New frontend **Documents page** (`/documents`, sidebar after Contacts) — library list with upload, type pills, download, edit, delete; loading/empty/error states.
- A **Documents section in the application drawer** — list linked docs, link an existing doc, quick-upload-and-link, unlink.

**OUT (deferred):** file **versioning history** (a new upload is a new document), in-browser preview/rendering, full-text search of file contents, sharing/public links, virus scanning, object-storage implementation (the interface is built now; the S3/Blob adapter lands with deployment), replacing a document's file in place (metadata edits only — re-upload for a new file).

## Data

Two new models (real migration), both owned per-user. Mirrors `Contact` / `ApplicationContact`.

### `Document`
| Field | Type | Notes |
|---|---|---|
| `id` | String (uuid) | PK |
| `userId` | String | owner; `onDelete: Cascade` from `User` |
| `name` | String | required label, e.g. "Backend Resume v2" |
| `type` | enum `DocumentType` | `Resume` / `CoverLetter` / `Other` |
| `notes` | String? | optional |
| `originalFilename` | String | as uploaded |
| `mimeType` | String | e.g. `application/pdf` |
| `sizeBytes` | Int | file size |
| `storageKey` | String | opaque key/path the storage layer uses to locate the bytes |
| `createdAt` / `updatedAt` | DateTime | |

Relation: `applicationLinks ApplicationDocument[]`.

### `ApplicationDocument` (join)
Mirrors `ApplicationContact` exactly: `id`, `applicationId` (`onDelete: Cascade`), `documentId` (`onDelete: Cascade`), `createdAt`, `@@unique([applicationId, documentId])`, `@@index([applicationId])`, `@@index([documentId])`. `Application` gains `documentLinks ApplicationDocument[]`.

### `DocumentType` enum
`Resume`, `CoverLetter`, `Other`.

**No change** to existing models beyond the new back-relation on `Application`.

## Storage abstraction

A small `src/shared/storage/` module exposing one interface, so the rest of the code never touches the filesystem directly:

```
save(buffer, key) -> Promise<void>      // write bytes
createReadStream(key) -> ReadStream      // for download
remove(key) -> Promise<void>             // delete bytes (best-effort)
```

- **Dev/local implementation** writes under a base directory from env **`UPLOAD_DIR`** (default `./uploads`, gitignored). `storageKey` is `<userId>/<uuid>-<sanitized originalFilename>`.
- **Tests** point `UPLOAD_DIR` at a temp directory (cleaned up after the run) so no real `uploads/` pollution.
- **Deployment (deferred):** an S3 / Vercel-Blob implementation behind the same interface swaps in with no controller/service change. Out of scope for this slice.

## Backend Changes

### New module `src/modules/documents/`
Layering routes → controller → service like `contacts/`. JWT-protected; the service takes `userId` and filters every query by it. **Upload** handled by **multer** with `memoryStorage` (buffer → `storage.save`), `limits.fileSize = 5 MB`, and a `fileFilter` allowlist.

#### Endpoints
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/documents` | Multipart `file` + `name` + `type` + `notes?` → store file + create record (201) |
| `GET` | `/api/documents` | List the user's documents; optional `?search` (over `name`) and `?type` |
| `GET` | `/api/documents/:id/file` | Stream the bytes (`userId`-scoped); sets `Content-Type` + `Content-Disposition: attachment; filename="…"` |
| `PATCH` | `/api/documents/:id` | Update `name` / `type` / `notes` only (not the file) |
| `DELETE` | `/api/documents/:id` | Delete record + remove file from storage; links cascade |
| `POST` | `/api/applications/:id/documents` | Body `{ documentId }` → link (duplicate → 409) |
| `DELETE` | `/api/applications/:id/documents/:documentId` | Unlink (idempotent → 204) |

`GET /api/applications/:id` now returns a `documents` array (each `{ id, name, type, originalFilename, mimeType, sizeBytes }`), mapped from `documentLinks` exactly like `contacts`.

#### Validation & errors
- Allowed mime types: `application/pdf`, `application/msword` (`.doc`), `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`). Anything else → **400**.
- File over 5 MB → **400** (multer limit surfaced via the error middleware).
- Missing file on create → **400**. Zod validates `name` (required, ≤200), `type` (enum), `notes` (≤20000).
- All reads/writes/deletes are `userId`-scoped; another user's document → **404** on read/download/update/delete and **404** when linking.

#### Linking semantics (mirror contacts)
- Linking verifies both the application and the document belong to the user (else 404); duplicate link → **409**.
- Unlink is idempotent → **204** even if not linked.
- Deleting a document removes its file and cascades its `ApplicationDocument` rows; deleting an application cascades its links (files untouched — the document lives on in the library).

### Backend tests (TDD)
**`tests/documents.test.js`** (Jest + Supertest, real DB, temp `UPLOAD_DIR`):
- Auth: any endpoint without a token → 401.
- Upload a small PDF fixture buffer → 201 with metadata (`name`, `type`, `originalFilename`, `mimeType`, `sizeBytes`); list returns it.
- Reject a disallowed type (e.g. `text/plain`) → 400; reject an over-5 MB buffer → 400; missing file → 400.
- Download `GET /:id/file` returns the exact bytes with the right `Content-Type`.
- Update metadata (name/type/notes) → 200; delete → 204, record gone and file removed from disk.
- Cross-user isolation: user B can't list/download/update/delete user A's document (404).

**`tests/applications.test.js`** (extend): link a document to an application → it appears on application detail; duplicate link → 409; unlink → 204 (idempotent); can't link another user's document/application → 404; deleting a document removes the link (cascade).

## Frontend Changes

### Documents page (`/documents`)
- New **sidebar nav item** "Documents" (lucide `FileText`), placed **directly after Contacts**. Route guarded like other authenticated pages; page `src/pages/Documents.jsx`.
- **Library list** (cards per `DESIGN.md`): each row shows `name`, a **type pill** (Resume = sky, Cover Letter = green, Other = slate), `notes`, file size, and **Download** / edit / delete controls. `?search` over name (like Contacts).
- **Upload form:** file picker + `name` + `type` select + optional `notes` → `POST /api/documents` as `multipart/form-data`. Client-side guard mirrors the server allowlist + 5 MB; loading / empty ("No documents yet") / error states.

### Application drawer — Documents section
Mirrors the drawer's Contacts section: list documents linked to this application (name + type pill + Download), **link an existing** document (picker), inline **quick-upload-and-link**, and **unlink** per row. Surfaces backend validation `details` like the other drawer sections.

### Download
The app authenticates API calls with an in-memory **Bearer token** (not a cookie), so a raw `<a href>` to `/documents/:id/file` wouldn't send it. Download therefore goes **through the api client**: fetch the file as a **blob** (`responseType: 'blob'`), create an object URL, and trigger a save with the document's `originalFilename`. The endpoint stays a normal `requireAuth` route.

### API & query keys
- New FE module `src/api/documents.js`: `listDocuments(search)`, `createDocument(formData)`, `updateDocument(id, body)`, `deleteDocument(id)`, `downloadDocument(id)` (blob), `linkDocument(applicationId, documentId)`, `unlinkDocument(applicationId, documentId)`.
- Query key `['documents']` for the page; the drawer reuses the application-detail query for linked docs (same as contacts). Mutations invalidate `['documents']` and the relevant application detail.
- Built with **ui-ux-pro-max** against `DESIGN.md`.

### Frontend tests (Vitest + RTL + MSW)
- **Documents page:** renders the library from a mock payload (name + type pill); the upload form submits `multipart/form-data` carrying the file + fields; empty / loading / error states; Download triggers the blob fetch.
- **Drawer Documents section:** lists linked docs; "link existing" issues the link request; unlink issues the unlink; quick-upload-and-link issues create + link.
- MSW handlers for the documents endpoints and the application link/unlink, matching the backend shapes.

## Architecture Notes

- The `documents/` module is a self-contained vertical slice (routes own URL/middleware/multer, controller owns HTTP, service owns Prisma + storage orchestration keyed by `userId`). File bytes never touch the controller logic beyond handing multer's buffer to the storage layer.
- **Storage is abstracted behind one interface** so the dev local-disk adapter and a future object-storage adapter are interchangeable; the database stores only an opaque `storageKey`. This keeps the deployment/storage decision decoupled from this slice.
- The Document ↔ Application link reuses the existing join pattern rather than inventing a new one, keeping application detail's shape (`contacts`, now also `documents`) uniform.
- "Which version went where" is captured by the **links**, not by per-application file copies — one uploaded document, many application links.

## Success Criteria

A signed-in user can open **Documents**, upload a résumé/cover-letter (PDF/DOC/DOCX, ≤5 MB) with a name, type, and notes, see it in their library, download it, edit its metadata, and delete it. From an application's drawer they can link an existing document or upload-and-link one, see which documents are attached, and unlink. All data is strictly per-user. Covered by backend tests (upload/validation/download/CRUD + isolation + linking) and frontend tests (library rendering + multipart upload + states + link/unlink + download).
