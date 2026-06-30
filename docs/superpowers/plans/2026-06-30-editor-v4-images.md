# Editor v4 — Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert images into authored documents (signatures, letterheads, logos), aligned and resizable, uploaded to backend storage and served via a public URL so `<img>` loads anywhere.

**Architecture:** Backend — new `Image` Prisma model + `images` module with an auth'd upload (`POST /api/images`) and an unauthenticated public serve (`GET /api/images/:id`) that streams from private storage by UUID. Frontend — extend TipTap's Image node with `width`/`align` + a drag-resize NodeView, plus an "Insert image" upload flow. Foundation for the deferred v5 floating overlay.

**Tech Stack:** Backend — Node/Express (CommonJS), Prisma (PostgreSQL), multer, Jest + Supertest. Frontend — React 18, Vite, TipTap v2, Vitest + Testing Library + MSW.

## Global Constraints

- **Backend** work is in `SmartJobSearchCRM-BE`, **frontend** in `SmartJobSearchCRM-FE`, both on branch `feat/editor-v4-images`.
- **Module pattern:** four files under `src/modules/images/` (`*.upload.js / *.service.js / *.controller.js / *.routes.js`), CommonJS. Mirror `src/modules/documents/`.
- **Storage:** reuse `require('../../shared/storage')` (`save(buffer, key)`, `createReadStream(key)`, `remove(key)`). Do NOT make the bucket public.
- **Public serve:** `GET /api/images/:id` is **unauthenticated** (it's the `<img src>` URL). `POST /api/images` is **auth-required** (`requireAuth`, `req.userId`). The public GET must be registered so auth does not apply to it.
- **Image URL is absolute:** `${PUBLIC_API_URL || <req-derived origin>}/images/:id`. New env var `PUBLIC_API_URL` (full base incl. `/api`).
- **Upload limits:** image mime allowlist `image/png|jpeg|gif|webp` (reject others → 400, **no SVG**); `MAX_BYTES = 5 * 1024 * 1024` (oversize → 400).
- **Errors:** throw `require('../../shared/utils/errors')` classes (`NotFoundError`, `ValidationError`); response shape `{ error: { message, code } }`.
- **TipTap pinned `^2`**; ProseMirror imports from `@tiptap/pm/*`. Additive — `DocumentEditor` `(content,onChange)` contract unchanged; v1–v3 docs unaffected.
- **Tests:** Backend Jest+Supertest with real local storage (set `process.env.UPLOAD_DIR` to a tmp dir before loading the app, like `tests/documents.test.js`). Frontend Vitest + real editors + MSW. Run one BE file: `npm test -- tests/<f>`; one FE file: `npx vitest run <path>`.

## File Structure

**Backend:**
- Modify `prisma/schema.prisma` — `Image` model + `User.images` back-relation; migration.
- Modify `tests/helpers/db.js` — add `image.deleteMany()` to `resetDb`.
- Create `src/modules/images/images.upload.js`, `images.service.js`, `images.controller.js`, `images.routes.js`.
- Modify `src/routes/index.js` — mount `/images`.
- Modify `.env.example` — document `PUBLIC_API_URL`.
- Create `tests/images.test.js`.

**Frontend:**
- Modify `package.json` — add `@tiptap/extension-image@^2`.
- Create `src/api/images.js`.
- Create `src/components/extensions/image.js` (+ `image.test.js`) — extended Image node + resize NodeView.
- Modify `src/components/DocumentEditor.jsx` — register the image extension.
- Modify `src/components/EditorToolbar.jsx` (+ `EditorToolbar.test.jsx`) — Insert image + align controls.
- Modify `src/index.css` — image + handle styling (screen + print).

---

## Task 1: Image model + migration + test reset

**Files:** Modify `prisma/schema.prisma`, `tests/helpers/db.js`; create migration.

**Interfaces:** Produces `prisma.image` with `{ id, userId, storageKey, mimeType, sizeBytes, createdAt }`.

- [ ] **Step 1: Add the model + back-relation**

In `prisma/schema.prisma`, add:
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
Add `images Image[]` to the `User` model's relation fields.

- [ ] **Step 2: Validate, migrate, regenerate**

Run: `npx prisma validate` (expect valid), then `npm run migrate -- --name add_image` (requires the dev Postgres on :5434), then confirm `✔ Generated Prisma Client`.

- [ ] **Step 3: Add to the test reset**

In `tests/helpers/db.js` `resetDb`, add before `await prisma.user.deleteMany();`:
```javascript
  await prisma.image.deleteMany();
```

- [ ] **Step 4: Commit**
```bash
git add prisma/schema.prisma prisma/migrations tests/helpers/db.js
git commit -m "feat(db): add Image model and migration"
```

---

## Task 2: images module (upload + public serve) — TDD

**Files:** Create `src/modules/images/{images.upload.js,images.service.js,images.controller.js,images.routes.js}`; modify `src/routes/index.js`, `.env.example`; test `tests/images.test.js`.

**Interfaces:**
- `POST /api/images` (auth, multipart `file`) → `201 { id, url }`.
- `GET /api/images/:id` (no auth) → streams the bytes with `Content-Type`; `404` unknown id.

- [ ] **Step 1: Write the failing test**

Create `tests/images.test.js`:
```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'img-it-'));
process.env.UPLOAD_DIR = tmpDir;

const { agent } = require('./helpers/testApp');
const { prisma, resetDb } = require('./helpers/db');
const { registerAndLogin } = require('./helpers/auth');

beforeEach(resetDb);
afterAll(async () => { await prisma.$disconnect(); });

const auth = (t) => ({ Authorization: `Bearer ${t}` });
// 1x1 transparent PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('uploads an image and returns an absolute serve url', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/images').set(auth(token))
    .attach('file', PNG, { filename: 'sig.png', contentType: 'image/png' });
  expect(res.status).toBe(201);
  expect(res.body.id).toBeTruthy();
  expect(res.body.url).toMatch(new RegExp(`/images/${res.body.id}$`));
  expect(res.body.storageKey).toBeUndefined();
});

test('requires auth to upload (401)', async () => {
  const res = await agent().post('/api/images')
    .attach('file', PNG, { filename: 'sig.png', contentType: 'image/png' });
  expect(res.status).toBe(401);
});

test('rejects a non-image type (400)', async () => {
  const { token } = await registerAndLogin();
  const res = await agent().post('/api/images').set(auth(token))
    .attach('file', Buffer.from('%PDF-1.4'), { filename: 'x.pdf', contentType: 'application/pdf' });
  expect(res.status).toBe(400);
});

test('serves the image bytes publicly (no auth) with the right content-type', async () => {
  const { token } = await registerAndLogin();
  const up = await agent().post('/api/images').set(auth(token))
    .attach('file', PNG, { filename: 'sig.png', contentType: 'image/png' });
  const res = await agent().get(`/api/images/${up.body.id}`); // no auth header
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('image/png');
  expect(Buffer.from(res.body).equals(PNG)).toBe(true);
});

test('returns 404 for an unknown image id', async () => {
  const res = await agent().get('/api/images/00000000-0000-0000-0000-000000000000');
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run → RED**

Run: `npm test -- tests/images.test.js` → FAIL (404s; route not mounted).

- [ ] **Step 3: multer config**

Create `src/modules/images/images.upload.js`:
```javascript
const multer = require('multer');
const { ValidationError } = require('../../shared/utils/errors');

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;

const handler = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    return cb(new ValidationError('Unsupported image type', []));
  },
}).single('file');

// Convert multer's errors (size limit, fileFilter) into our ValidationError (400).
function uploadSingle(req, res, next) {
  handler(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(new ValidationError('Image too large (max 5MB)'));
    if (err.status) return next(err); // already an AppError (e.g. fileFilter ValidationError)
    return next(new ValidationError(err.message || 'Upload failed'));
  });
}

module.exports = uploadSingle;
```

- [ ] **Step 4: service**

Create `src/modules/images/images.service.js`:
```javascript
const crypto = require('crypto');
const prisma = require('../../shared/database/prisma');
const storage = require('../../shared/storage');
const { NotFoundError } = require('../../shared/utils/errors');

const sanitize = (name) => name.replace(/[^\w.\-]/g, '_');

async function create(userId, file) {
  const storageKey = `images/${userId}/${crypto.randomUUID()}-${sanitize(file.originalname)}`;
  await storage.save(file.buffer, storageKey);
  try {
    return await prisma.image.create({
      data: { userId, storageKey, mimeType: file.mimetype, sizeBytes: file.size },
    });
  } catch (e) {
    await storage.remove(storageKey).catch(() => {});
    throw e;
  }
}

// Public serve: looked up by id only (no userId scoping — the URL is the capability).
async function getForServe(id) {
  const image = await prisma.image.findUnique({ where: { id } });
  if (!image) throw new NotFoundError('Image not found');
  return image;
}

module.exports = { create, getForServe };
```

- [ ] **Step 5: controller**

Create `src/modules/images/images.controller.js`:
```javascript
const service = require('./images.service');
const storage = require('../../shared/storage');
const { ValidationError } = require('../../shared/utils/errors');

function imageUrl(req, id) {
  const base = (process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}/api`).replace(/\/$/, '');
  return `${base}/images/${id}`;
}

async function create(req, res, next) {
  try {
    if (!req.file) throw new ValidationError('No file uploaded');
    const image = await service.create(req.userId, req.file);
    res.status(201).json({ id: image.id, url: imageUrl(req, image.id) });
  } catch (e) { next(e); }
}

async function serve(req, res, next) {
  try {
    const image = await service.getForServe(req.params.id);
    const stream = storage.createReadStream(image.storageKey);
    stream.on('open', () => {
      res.setHeader('Content-Type', image.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    });
    stream.on('error', (err) => {
      if (res.headersSent) return res.destroy(err);
      return next(err);
    });
    stream.pipe(res);
  } catch (e) { next(e); }
}

module.exports = { create, serve };
```

- [ ] **Step 6: routes**

Create `src/modules/images/images.routes.js`:
```javascript
const { Router } = require('express');
const { requireAuth } = require('../../shared/middleware/auth');
const uploadSingle = require('./images.upload');
const ctrl = require('./images.controller');

const router = Router();

// Public, unauthenticated image serving (this is the <img src> URL).
router.get('/:id', ctrl.serve);

// Authenticated upload.
router.post('/', requireAuth, uploadSingle, ctrl.create);

module.exports = router;
```

- [ ] **Step 7: register + env**

In `src/routes/index.js`, add the import and mount (alongside the others):
```javascript
const imagesRoutes = require('../modules/images/images.routes');
```
```javascript
router.use('/images', imagesRoutes);
```

In `.env.example`, add:
```bash
# Public base URL of THIS API (used to build absolute <img> URLs for editor images).
# Include the /api path, e.g. https://smartjobsearch-api.onrender.com/api
# Falls back to the request host when unset.
# PUBLIC_API_URL="https://smartjobsearch-api.onrender.com/api"
```

- [ ] **Step 8: Run → GREEN + full suite**

Run: `npm test -- tests/images.test.js` (5/5), then `npm test` (no regressions).

- [ ] **Step 9: Commit**
```bash
git add src/modules/images src/routes/index.js .env.example tests/images.test.js
git commit -m "feat(api): images module — auth upload + public serve endpoint"
```

---

## Task 3: Install TipTap Image extension (frontend)

**Files:** Modify `package.json`.

- [ ] **Step 1:** Run `npm install @tiptap/extension-image@^2` (must resolve to 2.x; STOP+report if it resolves v3 or ERESOLVE).
- [ ] **Step 2:** `npm run test` → existing suite passes.
- [ ] **Step 3:** Commit:
```bash
git add package.json package-lock.json
git commit -m "chore(fe): add @tiptap/extension-image"
```

---

## Task 4: Frontend images API module

**Files:** Create `src/api/images.js`.

**Interfaces:** `uploadImage(file)` → `POST /images` (multipart) → `{ id, url }`.

- [ ] **Step 1: Write the module**

Create `src/api/images.js`:
```javascript
import api from './client';

export async function uploadImage(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/images', form);
  return data; // { id, url }
}
```

- [ ] **Step 2: Commit** (exercised by the toolbar test in Task 6)
```bash
git add src/api/images.js
git commit -m "feat(fe): images upload API client"
```

---

## Task 5: Extended Image node + resize NodeView — TDD

**Files:** Create `src/components/extensions/image.js` (+ `image.test.js`).

**Interfaces:** `ResizableImage` (extends `@tiptap/extension-image`) with attributes `width`, `align`, commands `setImageWidth(value)` / `setImageAlign(value)`, and a NodeView with a corner drag-resize handle. `setImage({ src })` (inherited) inserts an image.

- [ ] **Step 1: Write the failing test**

Create `src/components/extensions/image.test.js`:
```javascript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ResizableImage } from './image';

function makeEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ResizableImage],
    content: '<p>x</p>',
  });
}
const imageNode = (editor) => editor.getJSON().content.find((n) => n.type === 'image');

test('setImage inserts an image node with the given src', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  expect(imageNode(editor).attrs.src).toBe('https://example.test/sig.png');
  editor.destroy();
});

test('setImageWidth and setImageAlign update the selected image', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  editor.commands.selectAll();
  editor.commands.setImageWidth('220px');
  editor.commands.setImageAlign('center');
  const img = imageNode(editor);
  expect(img.attrs.width).toBe('220px');
  expect(img.attrs.align).toBe('center');
  editor.destroy();
});
```

- [ ] **Step 2: Run → RED** (`npx vitest run src/components/extensions/image.test.js`).

- [ ] **Step 3: Write the extension**

Create `src/components/extensions/image.js`:
```javascript
import Image from '@tiptap/extension-image';

// Image node extended with width + align attributes and a corner drag-resize
// handle (vanilla NodeView). Inline-resize is verified manually / in e2e
// (jsdom can't simulate pointer drag); the attribute commands are unit-tested.
export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => el.style.width || el.getAttribute('width') || null,
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}` } : {}),
      },
      align: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-align'),
        renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageWidth:
        (width) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { width }),
      setImageAlign:
        (align) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'tiptap-image';
      if (node.attrs.align) dom.setAttribute('data-align', node.attrs.align);

      const img = document.createElement('img');
      img.src = node.attrs.src;
      if (node.attrs.alt) img.alt = node.attrs.alt;
      if (node.attrs.width) img.style.width = node.attrs.width;
      dom.appendChild(img);

      const handle = document.createElement('span');
      handle.className = 'tiptap-image__handle';
      handle.contentEditable = 'false';
      dom.appendChild(handle);

      let startX = 0;
      let startW = 0;
      const onMove = (e) => {
        const newW = Math.max(40, startW + (e.clientX - startX));
        img.style.width = `${newW}px`;
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (typeof getPos === 'function') {
          editor
            .chain()
            .command(({ tr }) => {
              tr.setNodeMarkup(getPos(), undefined, { ...node.attrs, width: img.style.width });
              return true;
            })
            .run();
        }
      };
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = img.getBoundingClientRect().width || img.naturalWidth || 200;
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });

      return { dom };
    };
  },
});
```

- [ ] **Step 4: Run → GREEN** (`npx vitest run src/components/extensions/image.test.js`, 2/2).

- [ ] **Step 5: Commit**
```bash
git add src/components/extensions/image.js src/components/extensions/image.test.js
git commit -m "feat(fe): resizable Image node (width/align attrs + drag handle)"
```

---

## Task 6: Toolbar insert + align + DocumentEditor wiring — TDD

**Files:** Modify `src/components/DocumentEditor.jsx`, `src/components/EditorToolbar.jsx` (+ `EditorToolbar.test.jsx`), `src/index.css`.

**Interfaces:** Toolbar gains an **Insert image** control (`aria-label="Insert image"`) that uploads via `uploadImage` and inserts the node; align left/center/right buttons (`aria-label` "Align image left/center/right") shown only when an image is selected.

- [ ] **Step 1: Register the extension in DocumentEditor**

In `src/components/DocumentEditor.jsx`, import and register:
```javascript
import { ResizableImage } from './extensions/image';
```
Add `ResizableImage,` to the `extensions` array (after the table extensions).

- [ ] **Step 2: Write the failing test (append to EditorToolbar.test.jsx)**

Add imports to `src/components/EditorToolbar.test.jsx`:
```javascript
import { http, HttpResponse } from 'msw';
import { server, API } from '../test/server';
import { ResizableImage } from './extensions/image';
```
Add `ResizableImage,` to the shared `useTestEditor` extensions array.

Append:
```javascript
test('insert image uploads the file and inserts an image node', async () => {
  server.use(http.post(`${API}/images`, () =>
    HttpResponse.json({ id: 'img1', url: 'http://localhost:4000/api/images/img1' }, { status: 201 })));
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  render(<EditorToolbar editor={editor} />);

  const file = new File(['png-bytes'], 'sig.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText('Insert image'), file);

  await waitFor(() => {
    const img = editor.getJSON().content.find((n) => n.type === 'image');
    expect(img?.attrs.src).toBe('http://localhost:4000/api/images/img1');
  });
});

test('align-image buttons appear only when an image is selected', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const { rerender } = render(<EditorToolbar editor={editor} />);
  expect(screen.queryByRole('button', { name: /align image center/i })).toBeNull();

  editor.commands.setImage({ src: 'http://localhost:4000/api/images/img1' });
  editor.commands.selectAll();
  rerender(<EditorToolbar editor={editor} />);
  expect(screen.getByRole('button', { name: /align image center/i })).toBeInTheDocument();
});
```
(Ensure `waitFor` is imported from `@testing-library/react` at the top of the test file — add it to the existing import.)

- [ ] **Step 3: Run → RED** (`npx vitest run src/components/EditorToolbar.test.jsx`).

- [ ] **Step 4: Add the controls to EditorToolbar**

In `src/components/EditorToolbar.jsx`:
(a) Add imports: `Image as ImageIcon` to the lucide import, and:
```javascript
import { useRef } from 'react';
import { uploadImage } from '../api/images';
```
(b) Inside the component (after `setLink`), add the upload handler + a hidden file input ref:
```javascript
  const fileRef = useRef(null);
  const onPickImage = () => fileRef.current?.click();
  const onImageFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await uploadImage(file);
      chain().setImage({ src: url }).run();
    } catch {
      window.alert('Could not upload the image.');
    }
  };
```
(c) Add the Insert-image control next to the table button (a label-wrapped hidden input so tests find it by label):
```jsx
      <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-slate-600 hover:bg-slate-100" title="Insert image">
        <ImageIcon size={16} aria-hidden="true" />
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Insert image" className="sr-only" onChange={onImageFile} />
      </label>
      {editor.isActive('image') && (
        <>
          <Btn label="Align image left" active={editor.isActive('image', { align: 'left' })} onClick={() => chain().setImageAlign('left').run()}><AlignLeft size={16} /></Btn>
          <Btn label="Align image center" active={editor.isActive('image', { align: 'center' })} onClick={() => chain().setImageAlign('center').run()}><AlignCenter size={16} /></Btn>
          <Btn label="Align image right" active={editor.isActive('image', { align: 'right' })} onClick={() => chain().setImageAlign('right').run()}><AlignRight size={16} /></Btn>
        </>
      )}
```
(`AlignLeft/AlignCenter/AlignRight` and `Btn` are already imported/defined in the toolbar. The `onPickImage` helper is optional — the label+input opens the picker natively.)

- [ ] **Step 5: Image CSS (screen + print)**

In `src/index.css` (outside print), add:
```css
/* Editor images */
.tiptap-image { position: relative; display: block; width: fit-content; max-width: 100%; }
.tiptap-image[data-align="center"] { margin-left: auto; margin-right: auto; }
.tiptap-image[data-align="right"] { margin-left: auto; }
.tiptap-image[data-align="left"] { margin-right: auto; }
.tiptap-image img { display: block; max-width: 100%; height: auto; }
.tiptap-image__handle { position: absolute; right: -5px; bottom: -5px; width: 12px; height: 12px; background: #0284c7; border: 1px solid #fff; border-radius: 2px; cursor: nwse-resize; }
```
Inside the `@media print { … }` block, add (hide the resize handle when printing):
```css
  .editor-sheet .tiptap-image__handle { display: none !important; }
```

- [ ] **Step 6: Run → GREEN + full suite**

Run: `npx vitest run src/components/EditorToolbar.test.jsx` then `npm run test` (green, pristine; v1–v3 editor tests unaffected).

- [ ] **Step 7: Commit**
```bash
git add src/components/DocumentEditor.jsx src/components/EditorToolbar.jsx src/components/EditorToolbar.test.jsx src/index.css
git commit -m "feat(fe): insert-image upload flow + align controls in the editor"
```

---

## Task 7 (optional): e2e — insert an image

**Files:** Modify `e2e/editor.spec.js`.

- [ ] **Step 1:** In the existing editor test, after the create/type flow, add (using a fixture file or a generated data-URL file via Playwright's `setInputFiles` with a buffer):
```javascript
  // Insert an image.
  await page.getByLabel('Insert image').setInputFiles({
    name: 'sig.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
  });
  await expect(page.locator('.tiptap-image img')).toBeVisible();
```
- [ ] **Step 2:** `npx playwright test e2e/editor.spec.js --list` (discovered; live run deferred).
- [ ] **Step 3:** Commit:
```bash
git add e2e/editor.spec.js
git commit -m "test(e2e): insert an image in the editor"
```

---

## Self-Review

**Spec coverage:**
- Image model + migration → Task 1. ✓
- Auth upload + public unauth serve + absolute URL → Task 2 (routes order: public GET before requireAuth on POST). ✓
- Mime allowlist (no SVG) + size limit → Task 2 (`images.upload.js`). ✓
- TipTap Image + width/align + drag-resize NodeView → Tasks 3, 5. ✓
- Insert-image upload flow + align controls → Task 6. ✓
- Image/print CSS → Task 6. ✓
- Additive / contract unchanged → Task 6 Step 6 (v1–v3 tests pass). ✓
- Tests (BE upload/serve/404/auth; FE attr commands + MSW insert + align gating) → Tasks 2, 5, 6; drag-resize manual/e2e (Task 7). ✓
- Orphan cleanup deferred; SVG excluded; floating overlay → v5. ✓ (documented)

**Placeholder scan:** No TBD/TODO; full code in every code step. Image-align buttons reuse the toolbar's existing `Btn` + lucide `AlignLeft/Center/Right` (already imported), with `aria-label`s the tests assert.

**Type/name consistency:** `Image` model fields, `images.service` (`create`, `getForServe`), controller (`create`, `serve`, `imageUrl`), routes (`GET /:id` public, `POST /` auth), `PUBLIC_API_URL`, FE `uploadImage` → `{ id, url }`, `ResizableImage` (`setImageWidth`/`setImageAlign`), toolbar aria-labels (`Insert image`, `Align image left/center/right`), CSS (`.tiptap-image`, `.tiptap-image__handle`) — consistent across tasks. `setImage` is the inherited TipTap command.

**Known manual-test surface:** the drag-resize NodeView (pointer drag) — covered by manual/e2e, with the `width`/`align` attribute commands unit-tested.
