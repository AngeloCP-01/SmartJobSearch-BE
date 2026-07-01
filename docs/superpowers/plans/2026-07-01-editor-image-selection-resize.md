# Editor Image Selection & Free Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give selected editor images a clear selection state (ring + 8 handles) and replace the Small/Medium/Full presets with Google-Docs-style free-drag resizing plus a Reset-size action.

**Architecture:** Extend the existing `ResizableImage` TipTap extension with a `height` attribute and `setImageSize`/`resetImageSize` commands (Task 1), rebuild its NodeView with 8 selection-gated drag handles + a live dimension badge and add the CSS (Task 2), and update the `ImageOptions` popup to drop presets and add Reset size (Task 3). Task 4 is manual/e2e verification.

**Tech Stack:** React 18, Vite, TipTap 2.x (`@tiptap/extension-image`), Vitest 2 + Testing Library (jsdom), Playwright (e2e), Tailwind CSS.

## Global Constraints

- Frontend-only. Work in `SmartJobSearchCRM-FE`. No backend/storage changes.
- Branch: continue `feat/editor-image-options-popup` (already checked out in both FE and BE repos).
- Package pinning: TipTap stays on the `^2.27.2` line; do not add new deps.
- Test runner: `npm test` (= `vitest run`). Full suite must stay pristine after every task.
- jsdom cannot simulate pointer drag — drag behavior is verified manually / e2e, never in unit tests (existing convention, see `src/components/extensions/image.js` header).
- Selection ring / handle color: sky-blue `#0284c7`. Handle = 10px white square, 1.5px `#0284c7` border.
- Min image size 40px per axis; max width clamped to the editor content column.

---

### Task 1: Extension data model — `height` attribute + `setImageSize`/`resetImageSize`

**Files:**
- Modify: `src/components/extensions/image.js` (attributes + commands only this task)
- Test: `src/components/extensions/image.test.js`

**Interfaces:**
- Consumes: `ResizableImage` (existing), TipTap `Image.extend`.
- Produces:
  - Image node attribute `height: string | null` (e.g. `'420px'`), parsed from
    `el.style.height` / `height` attr, rendered as `{ style: 'height: <value>' }`.
  - Command `setImageSize({ width, height })` → sets both attrs in one
    `updateAttributes('image', { width, height })`.
  - Command `resetImageSize()` → `updateAttributes('image', { width: null, height: null })`.
  - Existing `setImageWidth`, `setImageAlign` unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `src/components/extensions/image.test.js`:

```javascript
test('height attribute round-trips through parse/render', () => {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ResizableImage],
    content: '<img src="http://x/a.png" style="width: 300px; height: 200px">',
  });
  const img = imageNode(editor);
  expect(img.attrs.width).toBe('300px');
  expect(img.attrs.height).toBe('200px');
  editor.destroy();
});

test('setImageSize sets width and height together', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  editor.commands.selectAll();
  editor.commands.setImageSize({ width: '250px', height: '160px' });
  const img = imageNode(editor);
  expect(img.attrs.width).toBe('250px');
  expect(img.attrs.height).toBe('160px');
  editor.destroy();
});

test('resetImageSize clears width and height', () => {
  const editor = makeEditor();
  editor.commands.setImage({ src: 'https://example.test/sig.png' });
  editor.commands.selectAll();
  editor.commands.setImageSize({ width: '250px', height: '160px' });
  editor.commands.resetImageSize();
  const img = imageNode(editor);
  expect(img.attrs.width).toBeNull();
  expect(img.attrs.height).toBeNull();
  editor.destroy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/extensions/image.test.js`
Expected: FAIL — `setImageSize` / `resetImageSize` not a function; `height` attr undefined.

- [ ] **Step 3: Add the `height` attribute**

In `src/components/extensions/image.js`, inside `addAttributes()` return object, add after the `width` block (before `align`):

```javascript
      height: {
        default: null,
        parseHTML: (el) => el.style.height || el.getAttribute('height') || null,
        renderHTML: (attrs) => (attrs.height ? { style: `height: ${attrs.height}` } : {}),
      },
```

- [ ] **Step 4: Add the commands**

In `addCommands()` return object, add after `setImageAlign`:

```javascript
      setImageSize:
        ({ width, height }) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { width, height }),
      resetImageSize:
        () =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { width: null, height: null }),
```

Note: TipTap merges multiple `renderHTML` style fragments; `width` and `height`
each emit their own `style:` fragment and TipTap concatenates them, so both
inline styles render together on the `<img>`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/extensions/image.test.js`
Expected: PASS (all image extension tests, including the 2 pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/components/extensions/image.js src/components/extensions/image.test.js
git commit -m "feat(fe): image height attr + setImageSize/resetImageSize commands"
```

---

### Task 2: NodeView rebuild — 8 selection-gated handles, drag resize, dimension badge + CSS

**Files:**
- Modify: `src/components/extensions/image.js` (replace `addNodeView()`)
- Modify: `src/index.css` (image selection/handle/badge styles + print rules, lines ~41-47 and ~55-67)

**Interfaces:**
- Consumes: `height`/`width`/`align` attrs and the commit pattern from Task 1.
- Produces: DOM contract for CSS — wrapper `div.tiptap-image` gains
  `data-selected="true"` when selected; 8 child `span.tiptap-image__handle`
  each with `data-handle` ∈ `{nw,n,ne,e,se,s,sw,w}`; a floating
  `span.tiptap-image__dim` badge appended to `document.body` during drag.

- [ ] **Step 1: Replace `addNodeView()`**

In `src/components/extensions/image.js`, replace the entire `addNodeView()` method with:

```javascript
  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement('div');
      dom.className = 'tiptap-image';
      if (current.attrs.align) dom.setAttribute('data-align', current.attrs.align);

      const img = document.createElement('img');
      img.src = current.attrs.src;
      if (current.attrs.alt) img.alt = current.attrs.alt;
      dom.style.width = current.attrs.width || '';
      dom.style.height = current.attrs.height || '';
      img.style.width = '100%';
      img.style.height = '100%';
      dom.appendChild(img);

      const badge = document.createElement('span');
      badge.className = 'tiptap-image__dim';
      badge.contentEditable = 'false';

      const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      const handleEls = HANDLES.map((h) => {
        const el = document.createElement('span');
        el.className = 'tiptap-image__handle';
        el.dataset.handle = h;
        el.contentEditable = 'false';
        dom.appendChild(el);
        return el;
      });

      let cleanup = null;
      const startDrag = (handle, e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = dom.getBoundingClientRect();
        const startX = e.clientX;
        const startY = e.clientY;
        const startW = rect.width;
        const startH = rect.height;
        const ratio =
          img.naturalWidth && img.naturalHeight
            ? img.naturalWidth / img.naturalHeight
            : startW / startH || 1;
        const isCorner = handle.length === 2;
        const west = handle.includes('w');
        const north = handle.includes('n');
        const changesW = isCorner || handle === 'e' || handle === 'w';
        const changesH = isCorner || handle === 'n' || handle === 's';
        const maxW = dom.parentElement?.clientWidth || Infinity;

        document.body.appendChild(badge);

        const onMove = (ev) => {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          let w = startW;
          let h = startH;
          if (isCorner) {
            w = Math.max(40, startW + (west ? -dx : dx));
            if (w > maxW) w = maxW;
            h = Math.max(40, w / ratio);
          } else if (changesW) {
            w = Math.max(40, Math.min(maxW, startW + (west ? -dx : dx)));
          } else if (changesH) {
            h = Math.max(40, startH + (north ? -dy : dy));
          }
          dom.style.width = `${Math.round(w)}px`;
          if (changesH || isCorner) dom.style.height = `${Math.round(h)}px`;
          const shown = dom.getBoundingClientRect();
          badge.textContent = `${Math.round(shown.width)} × ${Math.round(shown.height)}`;
          badge.style.left = `${ev.clientX + 12}px`;
          badge.style.top = `${ev.clientY + 12}px`;
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          badge.remove();
          cleanup = null;
          if (typeof getPos === 'function') {
            const pos = getPos();
            const width = dom.style.width || null;
            const height = dom.style.height || null;
            editor
              .chain()
              .command(({ tr, state }) => {
                const attrs = state.doc.nodeAt(pos)?.attrs ?? current.attrs;
                tr.setNodeMarkup(pos, undefined, { ...attrs, width, height });
                return true;
              })
              .run();
          }
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        cleanup = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          badge.remove();
        };
      };

      handleEls.forEach((el) => {
        el.addEventListener('pointerdown', (e) => startDrag(el.dataset.handle, e));
      });

      return {
        dom,
        update(updated) {
          if (updated.type.name !== current.type.name) return false;
          current = updated;
          if (updated.attrs.align) dom.setAttribute('data-align', updated.attrs.align);
          else dom.removeAttribute('data-align');
          dom.style.width = updated.attrs.width || '';
          dom.style.height = updated.attrs.height || '';
          img.src = updated.attrs.src;
          return true;
        },
        selectNode() {
          dom.dataset.selected = 'true';
        },
        deselectNode() {
          delete dom.dataset.selected;
        },
        destroy() {
          if (cleanup) cleanup();
        },
      };
    };
  }
```

- [ ] **Step 2: Replace the image CSS block**

In `src/index.css`, replace the "Editor images" block (currently lines 41-47) with:

```css
/* Editor images */
.tiptap-image { position: relative; display: block; width: fit-content; max-width: 100%; }
.tiptap-image[data-align="center"] { margin-left: auto; margin-right: auto; }
.tiptap-image[data-align="right"] { margin-left: auto; }
.tiptap-image[data-align="left"] { margin-right: auto; }
.tiptap-image img { display: block; width: 100%; height: auto; }
.tiptap-image[data-selected="true"] { outline: 2px solid #0284c7; outline-offset: 2px; }

.tiptap-image__handle {
  position: absolute; display: none; width: 10px; height: 10px;
  background: #fff; border: 1.5px solid #0284c7; border-radius: 2px; z-index: 2;
}
.tiptap-image[data-selected="true"] .tiptap-image__handle { display: block; }
.tiptap-image__handle[data-handle="nw"] { top: -5px; left: -5px; cursor: nwse-resize; }
.tiptap-image__handle[data-handle="n"]  { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.tiptap-image__handle[data-handle="ne"] { top: -5px; right: -5px; cursor: nesw-resize; }
.tiptap-image__handle[data-handle="e"]  { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
.tiptap-image__handle[data-handle="se"] { bottom: -5px; right: -5px; cursor: nwse-resize; }
.tiptap-image__handle[data-handle="s"]  { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.tiptap-image__handle[data-handle="sw"] { bottom: -5px; left: -5px; cursor: nesw-resize; }
.tiptap-image__handle[data-handle="w"]  { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }

.tiptap-image__dim {
  position: fixed; z-index: 50; background: #1e293b; color: #fff;
  font-size: 11px; line-height: 1; padding: 3px 6px; border-radius: 4px;
  pointer-events: none; white-space: nowrap;
}
```

- [ ] **Step 3: Update the print rules**

In `src/index.css`, inside the `@media print { … }` block, replace the line:

```css
  .editor-sheet .tiptap-image__handle { display: none !important; }
```

with:

```css
  .editor-sheet .tiptap-image__handle { display: none !important; }
  .tiptap-image[data-selected="true"] { outline: none !important; }
  .tiptap-image__dim { display: none !important; }
```

- [ ] **Step 4: Run the full suite (must stay pristine)**

Run: `npm test`
Expected: PASS — no regressions. (The NodeView change is not unit-tested; this
step confirms the attribute/command tests and all other suites still pass.)

- [ ] **Step 5: Manual browser check**

With the dev server running (`localhost:5173`), open a document with an image:
- Click the image → sky-blue ring + 8 white handles appear; click elsewhere → they vanish.
- Drag a corner → resizes proportionally (no distortion); a `W × H` badge follows the cursor.
- Drag a right/left edge → width only; top/bottom edge → height only (distorts).
- Confirm the badge disappears on release and the size sticks.

- [ ] **Step 6: Commit**

```bash
git add src/components/extensions/image.js src/index.css
git commit -m "feat(fe): 8-handle image resize with selection ring + dimension badge"
```

---

### Task 3: Popup — remove size presets, add Reset size

**Files:**
- Modify: `src/components/ImageOptions.jsx`
- Test: `src/components/ImageOptions.test.jsx`

**Interfaces:**
- Consumes: `resetImageSize` command from Task 1; existing `setImageAlign`,
  `deleteSelection`, `uploadImage`.
- Produces: popup with align (L/C/R) + Reset size + Replace + Delete; no
  Small/Medium/Full buttons.

- [ ] **Step 1: Update the tests**

In `src/components/ImageOptions.test.jsx`, replace the `'size presets set the image width'` test with:

```javascript
test('reset size clears the image width and height', async () => {
  const editor = makeEditor();
  editor.commands.setImageSize({ width: '250px', height: '160px' });
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  await user.click(screen.getByRole('button', { name: /reset size/i }));
  const attrs = imgAttrs(editor);
  expect(attrs.width).toBeNull();
  expect(attrs.height).toBeNull();
});

test('no size preset buttons are rendered', () => {
  const editor = makeEditor();
  render(<ImageOptions editor={editor} />);
  expect(screen.queryByRole('button', { name: /small/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /medium/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /full/i })).toBeNull();
});
```

Note: `setImageSize` sets attrs on the already-selected image created in the
existing `makeEditor()` helper (which selects the image node).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/ImageOptions.test.jsx`
Expected: FAIL — no "Reset size" button; `/medium/i` button still present.

- [ ] **Step 3: Rewrite `ImageOptions.jsx`**

Replace the full contents of `src/components/ImageOptions.jsx` with:

```jsx
import { AlignLeft, AlignCenter, AlignRight, RotateCcw, RefreshCw, Trash2 } from 'lucide-react';
import { uploadImage } from '../api/images';

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
      <IconBtn label="Align image left" active={align === 'left'} onClick={() => chain().setImageAlign('left').run()}><AlignLeft size={16} /></IconBtn>
      <IconBtn label="Align image center" active={align === 'center'} onClick={() => chain().setImageAlign('center').run()}><AlignCenter size={16} /></IconBtn>
      <IconBtn label="Align image right" active={align === 'right'} onClick={() => chain().setImageAlign('right').run()}><AlignRight size={16} /></IconBtn>
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

Note: the Reset button is a plain `<button>`. The `Replace` control stays a
`<label>` wrapping its hidden file input.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/ImageOptions.test.jsx`
Expected: PASS — reset clears size; no preset buttons; align/replace/delete unchanged.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — pristine.

- [ ] **Step 6: Commit**

```bash
git add src/components/ImageOptions.jsx src/components/ImageOptions.test.jsx
git commit -m "feat(fe): replace image size presets with Reset size action"
```

---

### Task 4: Manual + e2e verification

**Files:**
- Reference only (no code): verify against running app.

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Full unit suite green**

Run: `npm test`
Expected: PASS, no skips beyond pre-existing.

- [ ] **Step 2: Browser walkthrough (Playwright MCP / manual)**

On `localhost:5173`, open the "Test image 2" document (or insert an image):
- Select image → ring + 8 handles visible; deselect → hidden.
- Corner drag → proportional; edge drag → single-axis; badge shows live `W × H`.
- Open popup → no Small/Medium/Full; "Reset size" present.
- Click "Reset size" → image returns to natural dimensions.
- Reload the page → resized dimensions persist (autosave round-trip).
- Print / Save as PDF preview → no ring, handles, or badge in output.

- [ ] **Step 3: Record outcome**

Note pass/fail per check. If any fail, loop back to the owning task rather than
patching forward.

---

## Self-Review

**Spec coverage:**
- Selection ring → Task 2 CSS (`data-selected` outline). ✓
- 8 handles corners+edges, selection-gated → Task 2 NodeView + CSS. ✓
- Corners aspect-locked, edges distortable → Task 2 `startDrag` math. ✓
- Live dimension badge → Task 2 (`tiptap-image__dim`). ✓
- Remove presets + add Reset size → Task 3. ✓
- `height` attribute + `setImageSize`/`resetImageSize` → Task 1. ✓
- Min 40px / max column-width clamp → Task 2 (`Math.max(40, …)`, `maxW`). ✓
- Persistence via autosave, no backend change → Task 2 commit path + Task 4 reload check. ✓
- Print hides ring/handles/badge → Task 2 Step 3. ✓
- jsdom drag caveat honored → drag untested in units; Task 4 covers it. ✓

**Placeholder scan:** none — all steps carry concrete code/commands.

**Type consistency:** `setImageSize({ width, height })`, `resetImageSize()`,
attribute name `height`, DOM contract (`data-selected`, `data-handle`,
`tiptap-image__handle`, `tiptap-image__dim`) are used identically across Tasks
1-3. ✓
