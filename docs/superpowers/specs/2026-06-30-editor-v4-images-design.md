# Editor v4 — Images (insert, align, resize) + storage — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming complete)
**Scope:** Cross-cutting — `SmartJobSearchCRM-BE` (Image model + module + public serve endpoint) and `SmartJobSearchCRM-FE` (Image extension + toolbar). Builds on the v1–v3 editor. Spec lives in the BE repo `docs/superpowers/`.

## Goal

Let users insert images into authored documents — signatures, letterheads, logos, photos — and align + resize them. Images are uploaded to backend storage and served via a public URL so `<img src>` loads anywhere (including the deployed app and print/PDF). This is the foundation for the deferred **v5 floating "behind/in-front of text" signature overlay**.

## Decisions & rationale

- **Storage, not base64.** Images upload to the existing storage layer; the document stores only the image URL, keeping the `content` JSON small and autosave cheap. (Base64 was rejected — fine for tiny signatures but bloats large images.)
- **Private storage + an unauthenticated serve endpoint** (not a public Supabase bucket). The bucket stays private; images are served by `GET /api/images/:id` (no auth), keyed by an unguessable UUID. This works identically in dev (local driver) and prod (S3/Supabase) with no bucket reconfiguration, reusing the existing `storage.createReadStream`. Security posture: anyone with the link can view the image (acceptable, accepted by the user) — like a typical image CDN.
- **Inline images only in v4.** Insert + align (left/center/right) + drag-resize. The **floating behind/in-front overlay is deferred to v5** (it needs an absolutely-positioned, drag-positioned NodeView — sizable and mostly manual-tested).
- **SVG excluded** from the upload allowlist (XSS risk via embedded scripts).

## Backend (`SmartJobSearchCRM-BE`)

### `Image` Prisma model
```prisma
model Image {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  storageKey String
  mimeType   String
  sizeBytes  Int
  createdAt  DateTime @default(now())

  @@index([userId])
}
```
Adds a `images Image[]` back-relation on `User`. Real Prisma migration.

### `images` module (`src/modules/images/`)
Mirrors the existing module pattern (`*.controller.js / *.routes.js / *.service.js`), plus an `images.upload.js` multer config like `documents.upload.js`.

- **`POST /api/images`** — auth-required. `multer` memory storage, single `file` field, allowlist `image/png`, `image/jpeg`, `image/gif`, `image/webp` (reject others → 400), `MAX_BYTES = 5 * 1024 * 1024`. Stores the buffer via `storage.save(buffer, key)` with `key = ${userId}/${uuid}-${sanitizedName}`, creates the `Image` row, returns `201 { id, url }`.
- **`GET /api/images/:id`** — **unauthenticated**. Looks up the `Image` by id (404 if missing), sets `Content-Type` from `mimeType`, and streams `storage.createReadStream(storageKey)` to the response (the documents-download streaming pattern, minus auth and minus `Content-Disposition: attachment` — images render inline).
- **Route wiring:** the public `GET /:id` is registered BEFORE any `requireAuth`; `POST /` carries `requireAuth` on the route itself. Registered in `src/routes/index.js` at `/images`.

### URL construction
The returned `url` is **absolute**: `${PUBLIC_API_URL}/images/${id}` where `PUBLIC_API_URL` is a new env var (the API's public base, e.g. `https://smartjobsearch-api.onrender.com/api`), falling back to a request-derived base (`${req.protocol}://${req.get('host')}${req.baseUrl}`) when unset. Absolute because the `<img>` loads cross-origin (Vercel frontend ↔ Render API). Document `GET /api/images/:id` and the new env var in `.env.example` + `DEPLOY.md`.

## Frontend (`SmartJobSearchCRM-FE`)

### Image extension
`@tiptap/extension-image` (pinned `^2`), extended to add:
- `width` attribute (rendered as inline `style="width: …"`; default null = natural size).
- `align` attribute (`left` | `center` | `right`; rendered via display:block + margins, or a wrapper class).
- A **NodeView** rendering the `<img>` plus a corner **drag-to-resize** handle that updates the `width` attribute on pointer drag.
- Commands: `setImageAlign(value)`, `setImageWidth(px)`.

Configured `inline: false` (block images).

### API module + upload flow
- `src/api/images.js` — `uploadImage(file)` → `POST /images` (multipart) → `{ id, url }`.
- **Toolbar "Insert image"** button → a hidden `<input type="file" accept="image/*">` → on select, `uploadImage` → `editor.chain().focus().setImage({ src: url }).run()`. Upload errors surface a message; nothing is inserted on failure.
- **When an image is selected:** align left/center/right controls (set the `align` attr), shown only while an image node is active.

### Styling / print
`.tiptap img { max-width: 100%; }`; alignment maps to block + auto margins. Print CSS keeps the image at its set width/alignment within the sheet.

## Data flow & persistence

Pick file → `POST /images` → `{ id, url }` → `setImage({ src: url })`. The image node (`src`, `width`, `align`) serializes via `editor.getJSON()` → autosaves through the existing PATCH (unchanged). On reload, `<img src>` fetches from the public `GET /images/:id`. v1–v3 documents are unaffected (additive node).

## Error handling & edge cases

- Upload: wrong type → 400; too big → 413/400; network error → surfaced in the UI, no node inserted.
- Public GET: unknown id → 404; stream error after headers → destroy the response (documents pattern).
- **Orphaned images** (uploaded, then removed from the document) remain in storage — **cleanup deferred** (noted; minor storage waste, no correctness impact).
- Drag-resize clamps to a sensible min width; width persists per image.

## Testing

- **Backend** (`tests/images.test.js`, real local storage like `documents.test.js`):
  - `POST /images` requires auth (401 unauth); accepts a PNG and returns `{ id, url }`; rejects a disallowed type (400) and oversize (400/413).
  - `GET /images/:id` is public (no auth) and streams the bytes with the correct `Content-Type`; 404 for unknown id.
  - `url` is absolute and points at the GET endpoint.
- **Frontend:**
  - Image extension attribute commands (`setImageAlign`, `setImageWidth`) on a real headless editor — attributes apply.
  - Insert/upload flow via MSW: mock `POST /images` → clicking "Insert image" + selecting a file inserts an image node whose `src` is the returned url; upload error shows a message and inserts nothing.
  - **Drag-resize** is verified manually / in e2e (jsdom can't simulate pointer drag + layout).
- Optional e2e: insert an image, confirm it renders and persists across reload.

## Out of scope (v5+)

Floating "behind / in front of text" overlay (absolutely-positioned, drag-positioned, z-index) — **v5**. Also: text-wrap/float, cropping/filters, captions, alt-text UI, orphan cleanup/GC, canvas signature drawing, EXIF handling.
