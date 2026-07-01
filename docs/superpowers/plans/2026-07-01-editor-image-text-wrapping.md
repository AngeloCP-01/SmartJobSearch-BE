# Editor Image Text Wrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support five image text-wrapping modes (inline, break, wrap-left, wrap-right, in-front-of-text, behind-text) on editor images, selectable from the image popup, persisted, and printed correctly.

**Architecture:** Make the image node inline (via a default `inline: true` option) so it lives in paragraph text, add a `wrap` attribute (plus `offsetX`/`offsetY` for the absolutely-positioned front/behind modes) that drives CSS, migrate existing block-image documents on load, add a wrap-mode selector to the popup, and add a drag-to-move interaction for front/behind.

**Tech Stack:** React 18, Vite, TipTap 2.x (`@tiptap/extension-image`), Vitest 2 + Testing Library (jsdom), Playwright (e2e), Tailwind CSS.

## Global Constraints

- Frontend-only. Work in `/Users/angelito/personal/SmartJobSearchCRM/SmartJobSearchCRM-FE`. No backend/storage changes.
- Branch: `feat/editor-image-wrapping` (create in the FE repo before Task 1 if not present; the BE docs repo is already on it).
- No new dependencies; TipTap stays on the `^2.27.2` line. Icons come from the already-installed `lucide-react`.
- Test runner: `npm test` (= `vitest run`). Focused: `npm test -- <path>`. Full suite must stay pristine after every task (a pre-existing Recharts stderr line in the suite is unrelated — not a regression).
- Drag interactions (resize and move) are NOT unit-tested — jsdom can't simulate pointer drag (existing convention, see `src/components/extensions/image.js` header). Attribute commands, migration, and popup wiring ARE unit-tested.
- `wrap` values: exactly `inline | break | wrap-left | wrap-right | front | behind`; default `break` (renders identically to today).
- Content is stored as ProseMirror JSON; existing images are top-level block nodes and must keep loading after the schema becomes inline.

---

### Task 1: Inline image node + wrap/offset attributes + commands

**Files:**
- Modify: `src/components/extensions/image.js`
- Test: `src/components/extensions/image.test.js`
- Test (helper fix only): `src/components/ImageOptions.test.jsx`

**Interfaces:**
- Consumes: existing `ResizableImage` (width/height/align attrs; setImageWidth/Align/Size, resetImageSize).
- Produces:
  - Image node is inline (`schema.nodes.image.isInline === true`).
  - Attributes `wrap: string` (default `'break'`), `offsetX: number|null`, `offsetY: number|null`.
  - Commands `setImageWrap(mode)` (clears offsets unless mode is `front`/`behind`) and `setImagePosition({ offsetX, offsetY })`.
  - NodeView reflects `data-wrap` and (for front/behind) `style.left`/`style.top` on the wrapper.

- [ ] **Step 1: Write the failing tests**

In `src/components/extensions/image.test.js`, first REPLACE the `imageNode` helper (line 12) — the image is now nested inside a paragraph, so a top-level `content.find` no longer finds it:

```javascript
const imageNode = (editor) => {
  let found;
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'image') found = n;
    return !found;
  });
  return found;
};
```

Then append these tests:

```javascript
test('image node is inline', () => {
  const editor = makeEditor();
  expect(editor.schema.nodes.image.isInline).toBe(true);
  editor.destroy();
});

test('wrap, offsetX and offsetY attributes round-trip', () => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ResizableImage],
    content: '<p><img src="http://x/a.png" data-wrap="front" data-offset-x="40" data-offset-y="15"></p>',
  });
  const img = imageNode(editor);
  expect(img.attrs.wrap).toBe('front');
  expect(img.attrs.offsetX).toBe(40);
  expect(img.attrs.offsetY).toBe(15);
  editor.destroy();
});

test('setImageWrap sets the wrap mode', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  editor.commands.selectAll();
  editor.commands.setImageWrap('wrap-left');
  expect(imageNode(editor).attrs.wrap).toBe('wrap-left');
  editor.destroy();
});

test('setImageWrap to a flow mode clears any offsets', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  editor.commands.selectAll();
  editor.commands.setImagePosition({ offsetX: 30, offsetY: 20 });
  editor.commands.setImageWrap('inline');
  const img = imageNode(editor);
  expect(img.attrs.wrap).toBe('inline');
  expect(img.attrs.offsetX).toBeNull();
  expect(img.attrs.offsetY).toBeNull();
  editor.destroy();
});

test('setImagePosition sets offsetX and offsetY', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  editor.commands.selectAll();
  editor.commands.setImagePosition({ offsetX: 12, offsetY: 34 });
  const img = imageNode(editor);
  expect(img.attrs.offsetX).toBe(12);
  expect(img.attrs.offsetY).toBe(34);
  editor.destroy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/extensions/image.test.js`
Expected: FAIL — `isInline` is false; `wrap`/offset attrs undefined; `setImageWrap`/`setImagePosition` not functions.

- [ ] **Step 3: Make the image inline (default option)**

In `src/components/extensions/image.js`, add an `addOptions` override immediately after `export const ResizableImage = Image.extend({` and before `addAttributes()`:

```javascript
  addOptions() {
    return { ...this.parent?.(), inline: true };
  },
```

(The base `@tiptap/extension-image` derives both `inline()` and `group()` from `this.options.inline`, so this makes every registration inline without a `.configure` call.)

- [ ] **Step 4: Add the attributes**

In `addAttributes()`, add after the `align` block (before the closing `};`):

```javascript
      wrap: {
        default: 'break',
        parseHTML: (el) => el.getAttribute('data-wrap') || 'break',
        renderHTML: (attrs) =>
          attrs.wrap && attrs.wrap !== 'break' ? { 'data-wrap': attrs.wrap } : {},
      },
      offsetX: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-offset-x');
          return v == null ? null : parseFloat(v);
        },
        renderHTML: (attrs) =>
          attrs.offsetX != null ? { 'data-offset-x': attrs.offsetX } : {},
      },
      offsetY: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-offset-y');
          return v == null ? null : parseFloat(v);
        },
        renderHTML: (attrs) =>
          attrs.offsetY != null ? { 'data-offset-y': attrs.offsetY } : {},
      },
```

- [ ] **Step 5: Add the commands**

In `addCommands()`, add after `resetImageSize`:

```javascript
      setImageWrap:
        (wrap) =>
        ({ commands }) => {
          const attrs =
            wrap === 'front' || wrap === 'behind'
              ? { wrap }
              : { wrap, offsetX: null, offsetY: null };
          return commands.updateAttributes(this.name, attrs);
        },
      setImagePosition:
        ({ offsetX, offsetY }) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { offsetX, offsetY }),
```

- [ ] **Step 6: Reflect wrap/offsets in the NodeView**

In `addNodeView()`, add this helper right after the `if (current.attrs.align) dom.setAttribute('data-align', current.attrs.align);` line (≈ image.js:55):

```javascript
      const applyWrap = (attrs) => {
        dom.dataset.wrap = attrs.wrap || 'break';
        if (attrs.wrap === 'front' || attrs.wrap === 'behind') {
          dom.style.left = attrs.offsetX != null ? `${attrs.offsetX}px` : '';
          dom.style.top = attrs.offsetY != null ? `${attrs.offsetY}px` : '';
        } else {
          dom.style.left = '';
          dom.style.top = '';
        }
      };
      applyWrap(current.attrs);
```

Then, inside the returned object's `update(updated)` method, add `applyWrap(updated.attrs);` right before `return true;`:

```javascript
        update(updated) {
          if (updated.type.name !== current.type.name) return false;
          current = updated;
          if (updated.attrs.align) dom.setAttribute('data-align', updated.attrs.align);
          else dom.removeAttribute('data-align');
          dom.style.width = updated.attrs.width || '';
          dom.style.height = updated.attrs.height || '';
          img.src = updated.attrs.src;
          applyWrap(updated.attrs);
          return true;
        },
```

- [ ] **Step 7: Fix the ImageOptions test helper (keep suite green)**

In `src/components/ImageOptions.test.jsx`, the `imgAttrs` helper (line 21) uses a top-level `content.find`, which no longer finds the now-nested image. Replace it with:

```javascript
const imgAttrs = (editor) => {
  let found;
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'image') found = n;
    return !found;
  });
  return found.attrs;
};
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- src/components/extensions/image.test.js src/components/ImageOptions.test.jsx`
Expected: PASS — all image extension + ImageOptions tests green.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 10: Commit**

```bash
git add src/components/extensions/image.js src/components/extensions/image.test.js src/components/ImageOptions.test.jsx
git commit -m "feat(fe): inline image node + wrap/offset attributes and commands"
```

---

### Task 2: Content migration for existing block images

**Files:**
- Create: `src/components/extensions/imageContentMigration.js`
- Create: `src/components/extensions/imageContentMigration.test.js`
- Modify: `src/components/DocumentEditor.jsx:65`

**Interfaces:**
- Consumes: nothing (pure function over ProseMirror JSON).
- Produces: `migrateImageContent(json)` — returns a normalized deep copy of the doc JSON with any block-position `image` node wrapped in a paragraph. Idempotent; does not mutate its input.

- [ ] **Step 1: Write the failing tests**

Create `src/components/extensions/imageContentMigration.test.js`:

```javascript
import { migrateImageContent } from './imageContentMigration';

test('wraps a top-level image node in a paragraph', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { src: 'http://x/a.png' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
    ],
  };
  const out = migrateImageContent(doc);
  expect(out.content[0]).toEqual({
    type: 'paragraph',
    content: [{ type: 'image', attrs: { src: 'http://x/a.png' } }],
  });
  expect(out.content[1]).toEqual(doc.content[1]);
});

test('leaves an image already inside a paragraph untouched', () => {
  const doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'image', attrs: { src: 'http://x/a.png' } }] },
    ],
  };
  const out = migrateImageContent(doc);
  expect(out).toEqual(doc);
});

test('is idempotent', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'image', attrs: { src: 'http://x/a.png' } }],
  };
  const once = migrateImageContent(doc);
  const twice = migrateImageContent(once);
  expect(twice).toEqual(once);
});

test('does not mutate the input', () => {
  const doc = {
    type: 'doc',
    content: [{ type: 'image', attrs: { src: 'http://x/a.png' } }],
  };
  const snapshot = JSON.stringify(doc);
  migrateImageContent(doc);
  expect(JSON.stringify(doc)).toBe(snapshot);
});

test('passes through null/undefined unchanged', () => {
  expect(migrateImageContent(null)).toBeNull();
  expect(migrateImageContent(undefined)).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/extensions/imageContentMigration.test.js`
Expected: FAIL — module/function does not exist.

- [ ] **Step 3: Implement the migration**

Create `src/components/extensions/imageContentMigration.js`:

```javascript
// Existing documents stored images as top-level (block) nodes. The image node
// is now inline, so a top-level image is schema-invalid — wrap each in a
// paragraph on load. Pure + idempotent; never mutates the stored JSON.
export function migrateImageContent(doc) {
  if (!doc || !Array.isArray(doc.content)) return doc;
  return {
    ...doc,
    content: doc.content.map((node) =>
      node && node.type === 'image'
        ? { type: 'paragraph', content: [node] }
        : node
    ),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/extensions/imageContentMigration.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire it into DocumentEditor**

In `src/components/DocumentEditor.jsx`, add the import near the other extension imports (after line 22's `import { ResizableImage } from './extensions/image';`):

```javascript
import { migrateImageContent } from './extensions/imageContentMigration';
```

Then change the `content:` line (currently line 65):

```javascript
    content: migrateImageContent(content) || { type: 'doc', content: [{ type: 'paragraph' }] },
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 7: Commit**

```bash
git add src/components/extensions/imageContentMigration.js src/components/extensions/imageContentMigration.test.js src/components/DocumentEditor.jsx
git commit -m "feat(fe): migrate legacy block images to inline on load"
```

---

### Task 3: CSS for all wrap modes

**Files:**
- Modify: `src/index.css` (image block ≈ lines 41-47; add sheet positioning)

**Interfaces:**
- Consumes: the NodeView `data-wrap` contract from Task 1.
- Produces: rendered wrap behavior; `.editor-sheet` becomes the positioning context for front/behind.

- [ ] **Step 1: Add the wrap-mode CSS**

In `src/index.css`, immediately after the existing `.tiptap-image[data-selected="true"] { outline: ...; }` line (≈ line 47), add:

```css
.editor-sheet { position: relative; }
.tiptap-image[data-wrap="inline"] { display: inline-block; vertical-align: bottom; }
.tiptap-image[data-wrap="wrap-left"] { float: left; margin: 0 1em 0.5em 0; }
.tiptap-image[data-wrap="wrap-right"] { float: right; margin: 0 0 0.5em 1em; }
.tiptap-image[data-wrap="front"] { position: absolute; z-index: 2; }
.tiptap-image[data-wrap="behind"] { position: absolute; z-index: -1; }
```

Note on `behind`: `z-index: -1` (relative to the `position: relative` `.editor-sheet`) paints the image above the sheet's white background but below the normal-flow text — i.e., behind the text. `front` at `z-index: 2` paints over the text.

- [ ] **Step 2: Run the full suite**

Run: `npm test`
Expected: PASS, pristine (CSS-only change, no test impact).

- [ ] **Step 3: Manual browser check**

With the dev server running, on a document with an image, use the DOM/console to set each `data-wrap` value on the `.tiptap-image` wrapper and confirm: `inline` sits in the text line; `wrap-left`/`wrap-right` float with text wrapping around; `front` overlays text; `behind` sits under text. (Controller performs this end-to-end in Task 6 — a spot-check here is enough.)

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(fe): CSS for image wrap modes (inline/wrap/front/behind)"
```

---

### Task 4: Popup wrap-mode selector

**Files:**
- Modify: `src/components/ImageOptions.jsx`
- Test: `src/components/ImageOptions.test.jsx`

**Interfaces:**
- Consumes: `setImageWrap` from Task 1; existing `setImageAlign`, `resetImageSize`, `uploadImage`.
- Produces: popup with a 5-button wrap-mode selector; align buttons shown only for `break`/`wrap-left`/`wrap-right`.

- [ ] **Step 1: Write the failing tests**

In `src/components/ImageOptions.test.jsx`, append:

```javascript
test('renders the five wrap-mode buttons and sets the mode', async () => {
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  for (const name of ['In line', 'Break text', 'Wrap text', 'In front of text', 'Behind text']) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
  await user.click(screen.getByRole('button', { name: 'Behind text' }));
  expect(imgAttrs(editor).wrap).toBe('behind');
});

test('hides align buttons for inline/front/behind modes', async () => {
  const editor = makeEditor();
  editor.commands.setImageWrap('front');
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  expect(screen.queryByRole('button', { name: 'Align image left' })).toBeNull();
  // Switch to a flow mode → align reappears.
  await user.click(screen.getByRole('button', { name: 'Break text' }));
  expect(screen.getByRole('button', { name: 'Align image left' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/ImageOptions.test.jsx`
Expected: FAIL — wrap-mode buttons don't exist.

- [ ] **Step 3: Rewrite `ImageOptions.jsx`**

Replace the full contents of `src/components/ImageOptions.jsx` with:

```jsx
import {
  AlignLeft, AlignCenter, AlignRight, RotateCcw, RefreshCw, Trash2,
  Type, Rows3, WrapText, BringToFront, SendToBack,
} from 'lucide-react';
import { uploadImage } from '../api/images';

const WRAP_MODES = [
  { mode: 'inline', label: 'In line', icon: Type },
  { mode: 'break', label: 'Break text', icon: Rows3 },
  { mode: 'wrap', label: 'Wrap text', icon: WrapText },
  { mode: 'front', label: 'In front of text', icon: BringToFront },
  { mode: 'behind', label: 'Behind text', icon: SendToBack },
];

function IconBtn({ label, active, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active ?? undefined}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${active ? 'bg-sky-100 text-sky-700' : ''}`}
    >
      {children}
    </button>
  );
}

export default function ImageOptions({ editor }) {
  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const align = editor.getAttributes('image').align;
  const wrap = editor.getAttributes('image').wrap || 'break';
  // "Wrap text" resolves to a side; keep the current side if already wrapping,
  // else default to wrap-left. Align buttons then switch the side.
  const isWrap = wrap === 'wrap-left' || wrap === 'wrap-right';
  const showAlign = wrap === 'break' || isWrap;

  const applyWrap = (mode) => {
    if (mode === 'wrap') {
      chain().setImageWrap(align === 'right' ? 'wrap-right' : 'wrap-left').run();
    } else {
      chain().setImageWrap(mode).run();
    }
  };

  const wrapActive = (mode) => (mode === 'wrap' ? isWrap : wrap === mode);

  const setAlign = (side) => {
    if (isWrap) chain().setImageWrap(side === 'right' ? 'wrap-right' : 'wrap-left').run();
    else chain().setImageAlign(side).run();
  };

  const onReplace = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { url } = await uploadImage(file);
      chain().updateAttributes('image', { src: url }).run();
    } catch {
      window.alert('Could not upload the image.');
    }
  };

  return (
    <div className="image-options flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-md">
      {WRAP_MODES.map(({ mode, label, icon: Icon }) => (
        <IconBtn key={mode} label={label} active={wrapActive(mode)} onClick={() => applyWrap(mode)}>
          <Icon size={16} />
        </IconBtn>
      ))}
      {showAlign && (
        <>
          <span className="mx-0.5 h-5 w-px bg-slate-200" />
          <IconBtn label="Align image left" active={align === 'left' || wrap === 'wrap-left'} onClick={() => setAlign('left')}><AlignLeft size={16} /></IconBtn>
          {!isWrap && (
            <IconBtn label="Align image center" active={align === 'center'} onClick={() => setAlign('center')}><AlignCenter size={16} /></IconBtn>
          )}
          <IconBtn label="Align image right" active={align === 'right' || wrap === 'wrap-right'} onClick={() => setAlign('right')}><AlignRight size={16} /></IconBtn>
        </>
      )}
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <button
        type="button"
        aria-label="Reset size"
        title="Reset to original size"
        onClick={() => chain().resetImageSize().run()}
        className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <RotateCcw size={14} aria-hidden="true" /> Reset size
      </button>
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100" title="Replace image">
        <RefreshCw size={14} aria-hidden="true" /> Replace
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Replace image" className="sr-only" onChange={onReplace} />
      </label>
      <IconBtn label="Delete image" onClick={() => chain().deleteSelection().run()}><Trash2 size={16} /></IconBtn>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/ImageOptions.test.jsx`
Expected: PASS — wrap buttons present, `Behind text` sets `wrap: 'behind'`, align hidden for front and reappears for break.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 6: Commit**

```bash
git add src/components/ImageOptions.jsx src/components/ImageOptions.test.jsx
git commit -m "feat(fe): image popup wrap-mode selector"
```

---

### Task 5: Free-drag move for front/behind

**Files:**
- Modify: `src/components/extensions/image.js` (NodeView — add a move drag)
- Modify: `src/index.css` (move cursor for front/behind)

**Interfaces:**
- Consumes: `setImagePosition` from Task 1; `applyWrap` and the NodeView from Tasks 1.
- Produces: dragging the image body when `wrap ∈ {front, behind}` repositions it and commits `offsetX`/`offsetY`.

- [ ] **Step 1: Add the move-drag to the NodeView**

In `src/components/extensions/image.js`, inside `addNodeView()`, add a second cleanup ref and a move-drag routine. After the existing `let cleanup = null;` line (≈ image.js:80), add:

```javascript
      let moveCleanup = null;
      const startMove = (e) => {
        if (current.attrs.wrap !== 'front' && current.attrs.wrap !== 'behind') return;
        e.preventDefault();
        if (typeof getPos === 'function') editor.commands.setNodeSelection(getPos());
        const startX = e.clientX;
        const startY = e.clientY;
        const startLeft = parseFloat(dom.style.left) || 0;
        const startTop = parseFloat(dom.style.top) || 0;
        const sheet = dom.closest('.editor-sheet');
        const onMove = (ev) => {
          let nx = startLeft + (ev.clientX - startX);
          let ny = startTop + (ev.clientY - startY);
          if (sheet) {
            const maxX = Math.max(0, sheet.clientWidth - dom.offsetWidth);
            const maxY = Math.max(0, sheet.clientHeight - dom.offsetHeight);
            nx = Math.max(0, Math.min(nx, maxX));
            ny = Math.max(0, Math.min(ny, maxY));
          }
          dom.style.left = `${Math.round(nx)}px`;
          dom.style.top = `${Math.round(ny)}px`;
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          moveCleanup = null;
          if (typeof getPos === 'function') {
            const pos = getPos();
            const offsetX = parseFloat(dom.style.left) || 0;
            const offsetY = parseFloat(dom.style.top) || 0;
            editor
              .chain()
              .command(({ tr, state }) => {
                const attrs = state.doc.nodeAt(pos)?.attrs ?? current.attrs;
                tr.setNodeMarkup(pos, undefined, { ...attrs, offsetX, offsetY });
                return true;
              })
              .run();
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        moveCleanup = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
      };
      dom.addEventListener('pointerdown', startMove);
```

The resize handles already call `e.stopPropagation()` in `startDrag`, so a handle pointerdown never triggers `startMove`.

- [ ] **Step 2: Clean up the move listener on destroy**

In the returned object's `destroy()` method, add `moveCleanup` teardown:

```javascript
        destroy() {
          if (cleanup) cleanup();
          if (moveCleanup) moveCleanup();
        },
```

- [ ] **Step 3: Add the move cursor**

In `src/index.css`, after the `behind` rule added in Task 3, add:

```css
.tiptap-image[data-wrap="front"], .tiptap-image[data-wrap="behind"] { cursor: move; }
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, pristine. (Move drag is not unit-tested — jsdom can't simulate pointer drag; this confirms no regression to the attribute/command/migration tests.)

- [ ] **Step 5: Manual browser check**

With the dev server running, set an image to In-front and Behind, drag its body → it repositions and the position sticks after release. (Controller does the full walkthrough in Task 6.)

- [ ] **Step 6: Commit**

```bash
git add src/components/extensions/image.js src/index.css
git commit -m "feat(fe): drag to reposition in-front/behind images"
```

---

### Task 6: Verification + final review

**Files:** Reference only (verify against the running app).

**Interfaces:** Consumes everything from Tasks 1-5.

- [ ] **Step 1: Full unit suite green**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 2: Browser walkthrough (Playwright MCP / manual)**

On `localhost:5173`, open a document with an image and, via the popup:
- Set each of the 5 modes; confirm: inline sits in the text line; break shows text above/below; wrap-left/right float with text wrapping around; front overlays text; behind sits under text.
- Align buttons appear only for break (L/C/R) and wrap (L/R); hidden for inline/front/behind.
- Front and behind: drag the image body → it moves and the position persists.
- Reload the page → mode + position persist.
- Confirm a legacy document (image previously stored as a top-level block node) still loads and renders as a break image.
- Print / Save as PDF preview → front/behind at their positions, flow modes flow, no handles/ring/badge.

- [ ] **Step 3: Record outcome**

Note pass/fail per check. If any fail, loop back to the owning task.

---

## Self-Review

**Spec coverage:**
- Inline node + `wrap`/`offsetX`/`offsetY` attrs + commands → Task 1. ✓
- Load-time migration of legacy block images → Task 2. ✓
- CSS for all 5 modes + sheet positioning → Task 3 (behind uses `z-index:-1`, a refinement of the spec's "z-index 0 + text above" that achieves behind-text without touching text z-index). ✓
- Popup 5-mode selector + align visibility → Task 4. ✓
- Free-drag for front/behind (`setImagePosition`) → Tasks 1 (command) + 5 (interaction). ✓
- Persistence (attrs in JSON autosave) → automatic; verified Task 6. ✓
- Print handling → existing print rules hide handles/ring/badge; absolute images print at offset — verified Task 6. ✓
- Drag not unit-tested (jsdom) → honored in Tasks 1/5; manual in Task 6. ✓

**Placeholder scan:** none — every step carries concrete code/commands.

**Type consistency:** `wrap` values, `offsetX`/`offsetY`, `setImageWrap`,
`setImagePosition`, `migrateImageContent`, and the DOM contract
(`data-wrap`, `data-offset-x/y`, `.editor-sheet`) are used identically across
Tasks 1-5. The `WRAP_MODES` UI uses `mode: 'wrap'` which `applyWrap` resolves to
`wrap-left`/`wrap-right` before calling `setImageWrap` (never passes the literal
`'wrap'` to the command). ✓
