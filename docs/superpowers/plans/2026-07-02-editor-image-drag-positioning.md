# Editor Image Drag Positioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the image Align buttons and make positioning drag-driven — wrap-mode images re-anchor to the drop point and snap to a column side with text wrapping around them; break images center by default.

**Architecture:** Add a second NodeView drag interaction ("reposition") for the in-flow modes (inline/break/wrap) that moves the image node to the document position under the drop point (`posAtCoords`) and, for wrap, sets the float side; front/behind keep their absolute-move drag. The move + side logic live in small pure helpers for unit testing; the popup drops the align buttons; CSS centers break and adds `shape-outside` for wrap.

**Tech Stack:** React 18, Vite, TipTap 2.x (`@tiptap/extension-image`, `@tiptap/pm`), Vitest 2 + Testing Library (jsdom), Playwright (e2e), Tailwind CSS.

## Global Constraints

- Frontend-only. Work in `/Users/angelito/personal/SmartJobSearchCRM/SmartJobSearchCRM-FE`. No backend/storage changes.
- Branch: `feat/editor-image-wrapping` (already checked out; this continues that branch).
- No new dependencies; TipTap on the `^2.27.2` line; `@tiptap/pm/state` is already used.
- Test runner: `npm test` (= `vitest run`). Focused: `npm test -- <path>`. Full suite must stay pristine after every task (a pre-existing Recharts stderr line is unrelated).
- Pointer-drag interactions are NOT unit-tested (jsdom has no layout — `posAtCoords`/`coordsAtPos` don't work); verified manually/e2e. Pure helpers and popup wiring ARE unit-tested.
- `wrap` values unchanged: `inline | break | wrap-left | wrap-right | front | behind`.
- The `align` attribute and `setImageAlign` command are RETAINED in the extension (backward-compat parse + existing unit tests); only the popup UI drops align. Break centering is CSS, independent of `align`.

---

### Task 1: Remove Align UI, center break, shape-outside wrap

**Files:**
- Modify: `src/components/ImageOptions.jsx`
- Test: `src/components/ImageOptions.test.jsx`
- Modify: `src/index.css` (image rules)

**Interfaces:**
- Consumes: existing `setImageWrap`, `resetImageSize`, `uploadImage`.
- Produces: a popup with the 5 wrap-mode buttons + reset/replace/delete and NO align buttons; "Wrap" defaults to `wrap-left` when not already wrapping.

- [ ] **Step 1: Update the tests**

In `src/components/ImageOptions.test.jsx`:

(a) DELETE the test `'align buttons set the image align'` (the whole `test('align buttons set the image align', ...)` block).

(b) REPLACE the test `'buttons expose hover titles'` with:

```javascript
test('buttons expose hover titles', () => {
  const editor = makeEditor();
  render(<ImageOptions editor={editor} />);
  expect(screen.getByRole('button', { name: 'In line' })).toHaveAttribute('title', 'In line');
});
```

(c) REPLACE the test `'hides align buttons for inline/front/behind modes'` with:

```javascript
test('no align buttons are rendered in any mode', async () => {
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  // break mode (default)
  expect(screen.queryByRole('button', { name: /^align image/i })).toBeNull();
  // switch to wrap — still no align buttons
  await user.click(screen.getByRole('button', { name: 'Wrap text' }));
  expect(screen.queryByRole('button', { name: /^align image/i })).toBeNull();
});

test('Wrap text defaults to wrap-left when not already wrapping', async () => {
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  await user.click(screen.getByRole('button', { name: 'Wrap text' }));
  expect(imgAttrs(editor).wrap).toBe('wrap-left');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/ImageOptions.test.jsx`
Expected: FAIL — align buttons still present / "In line" title assertion vs current align-based code.

- [ ] **Step 3: Rewrite `ImageOptions.jsx`**

Replace the full contents of `src/components/ImageOptions.jsx` with:

```jsx
import { useEffect, useState } from 'react';
import { RotateCcw, RefreshCw, Trash2, Type, Rows3, WrapText, BringToFront, SendToBack } from 'lucide-react';
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
  // Standalone (outside TipTap's BubbleMenu) this component isn't otherwise
  // re-rendered when the editor's active image attrs change, so subscribe to
  // transactions to keep the wrap-mode buttons in sync.
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!editor) return undefined;
    const rerender = () => forceRender((n) => n + 1);
    editor.on('transaction', rerender);
    return () => editor.off('transaction', rerender);
  }, [editor]);

  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const wrap = editor.getAttributes('image').wrap || 'break';
  const isWrap = wrap === 'wrap-left' || wrap === 'wrap-right';

  // Positioning is drag-driven; "Wrap text" keeps the current side if already
  // wrapping, else defaults to wrap-left (dragging then changes the side).
  const applyWrap = (mode) => {
    if (mode === 'wrap') chain().setImageWrap(isWrap ? wrap : 'wrap-left').run();
    else chain().setImageWrap(mode).run();
  };
  const wrapActive = (mode) => (mode === 'wrap' ? isWrap : wrap === mode);

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

- [ ] **Step 4: Update the CSS**

In `src/index.css`:

(a) DELETE these three align rules (currently lines ~43-45):

```css
.tiptap-image[data-align="center"] { margin-left: auto; margin-right: auto; }
.tiptap-image[data-align="right"] { margin-left: auto; }
.tiptap-image[data-align="left"] { margin-right: auto; }
```

(b) ADD a break-centering rule immediately after `.tiptap-image img { ... }` (the `.tiptap-image img` line stays):

```css
.tiptap-image[data-wrap="break"] { margin-left: auto; margin-right: auto; }
```

(c) UPDATE the two wrap float rules to add `shape-outside` (replace the existing `wrap-left`/`wrap-right` lines):

```css
.tiptap-image[data-wrap="wrap-left"] { float: left; margin: 0 1em 0.5em 0; shape-outside: margin-box; }
.tiptap-image[data-wrap="wrap-right"] { float: right; margin: 0 0 0.5em 1em; shape-outside: margin-box; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/components/ImageOptions.test.jsx`
Expected: PASS — no align buttons, wrap defaults to wrap-left, wrap buttons + reset/replace/delete present.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS, pristine. (The extension's own `setImageAlign` tests in `image.test.js` still pass — the command is retained.)

- [ ] **Step 7: Commit**

```bash
git add src/components/ImageOptions.jsx src/components/ImageOptions.test.jsx src/index.css
git commit -m "feat(fe): remove image align buttons; center break, shape-outside wrap"
```

---

### Task 2: Pure reposition helpers

**Files:**
- Create: `src/components/extensions/imageReposition.js`
- Create: `src/components/extensions/imageReposition.test.js`

**Interfaces:**
- Consumes: `@tiptap/pm/state` `NodeSelection`.
- Produces:
  - `sideForX(clientX, midpointX)` → `'wrap-left' | 'wrap-right'`.
  - `repositionImageNode(state, fromPos, toPos, attrsPatch = {})` → a ProseMirror
    `Transaction` that deletes the image node at `fromPos` and reinserts it (with
    `attrsPatch` merged into its attrs) at the mapped `toPos`, selecting it; or
    `null` if there's no image at `fromPos`, or the move is a no-op (same
    position and no attr change).

- [ ] **Step 1: Write the failing tests**

Create `src/components/extensions/imageReposition.test.js`:

```javascript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ResizableImage } from './image';
import { sideForX, repositionImageNode } from './imageReposition';

test('sideForX returns wrap-left left of midpoint and wrap-right right of it', () => {
  expect(sideForX(10, 100)).toBe('wrap-left');
  expect(sideForX(150, 100)).toBe('wrap-right');
});

function editorWithImageInFirstPara() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ResizableImage],
    content: '<p>alpha</p><p>beta</p>',
  });
  editor.commands.setTextSelection(1);
  editor.commands.setImage({ src: 'http://x/a.png' });
  return editor;
}
function imagePos(editor) {
  let pos = null;
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'image') pos = p; });
  return pos;
}
function paraPositions(editor) {
  const paras = [];
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'paragraph') paras.push(p); });
  return paras;
}

test('repositionImageNode moves the image to a new paragraph and patches attrs', () => {
  const editor = editorWithImageInFirstPara();
  const from = imagePos(editor);
  const secondParaInner = paraPositions(editor)[1] + 1; // inside the second paragraph
  const tr = repositionImageNode(editor.state, from, secondParaInner, { wrap: 'wrap-right' });
  expect(tr).not.toBeNull();
  editor.view.dispatch(tr);
  const moved = imagePos(editor);
  const secondPara = paraPositions(editor)[1];
  expect(moved).toBeGreaterThan(secondPara);
  let node = null;
  editor.state.doc.descendants((n) => { if (n.type.name === 'image') node = n; });
  expect(node.attrs.wrap).toBe('wrap-right');
  editor.destroy();
});

test('repositionImageNode returns null when there is no image at fromPos', () => {
  const editor = editorWithImageInFirstPara();
  expect(repositionImageNode(editor.state, 0, 5, {})).toBeNull();
  editor.destroy();
});

test('repositionImageNode returns null for a same-position no-op with no attr change', () => {
  const editor = editorWithImageInFirstPara();
  const from = imagePos(editor);
  expect(repositionImageNode(editor.state, from, from, {})).toBeNull();
  editor.destroy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/extensions/imageReposition.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/components/extensions/imageReposition.js`:

```javascript
import { NodeSelection } from '@tiptap/pm/state';

// Which column side a drop x falls on.
export function sideForX(clientX, midpointX) {
  return clientX < midpointX ? 'wrap-left' : 'wrap-right';
}

// Move the image node at `fromPos` to `toPos`, merging `attrsPatch` into its
// attributes and selecting it. Returns the transaction, or null if there is no
// image at `fromPos` or the move is a same-position no-op with no attr change.
export function repositionImageNode(state, fromPos, toPos, attrsPatch = {}) {
  const node = state.doc.nodeAt(fromPos);
  if (!node || node.type.name !== 'image') return null;

  let tr = state.tr.delete(fromPos, fromPos + node.nodeSize);
  const insertPos = tr.mapping.map(toPos);
  const patchChanges = Object.keys(attrsPatch).some((k) => node.attrs[k] !== attrsPatch[k]);
  if (insertPos === fromPos && !patchChanges) return null;

  const newNode = node.type.create({ ...node.attrs, ...attrsPatch }, node.content, node.marks);
  tr = tr.insert(insertPos, newNode);
  const created = tr.doc.nodeAt(insertPos);
  if (created && created.type.name === 'image') {
    tr = tr.setSelection(NodeSelection.create(tr.doc, insertPos));
  }
  return tr;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/extensions/imageReposition.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 6: Commit**

```bash
git add src/components/extensions/imageReposition.js src/components/extensions/imageReposition.test.js
git commit -m "feat(fe): pure helpers for image reposition (sideForX, repositionImageNode)"
```

---

### Task 3: NodeView reposition drag + drop caret

**Files:**
- Modify: `src/components/extensions/image.js` (imports, NodeView drag dispatcher, destroy)
- Modify: `src/index.css` (drop-caret style + print hide)

**Interfaces:**
- Consumes: `sideForX`, `repositionImageNode` from Task 2; `editor.view.posAtCoords`/`coordsAtPos`.
- Produces: dragging the body of an inline/break/wrap image repositions it (and sets side for wrap); front/behind keep absolute move. A `.tiptap-image__drop-caret` element marks the target during the drag.

- [ ] **Step 1: Add the import**

In `src/components/extensions/image.js`, add after the existing NodeSelection import (line 2):

```javascript
import { sideForX, repositionImageNode } from './imageReposition';
```

- [ ] **Step 2: Add the reposition drag + dispatcher**

In `addNodeView()`, the current code registers `dom.addEventListener('pointerdown', startMove);` (one line, right after the `startMove` function's closing `};`). REPLACE that single line with the reposition routine, the dispatcher, and a native-drag guard:

```javascript
      let repoCleanup = null;
      let dropCaret = null;
      const removeCaret = () => {
        if (dropCaret) { dropCaret.remove(); dropCaret = null; }
      };
      const startReposition = (e) => {
        e.preventDefault();
        if (typeof getPos === 'function') editor.commands.setNodeSelection(getPos());
        const view = editor.view;
        const sheet = dom.closest('.editor-sheet');
        let moved = false;
        let targetPos = null;
        const onMove = (ev) => {
          moved = true;
          const at = view.posAtCoords({ left: ev.clientX, top: ev.clientY });
          if (!at) return;
          targetPos = at.pos;
          const coords = view.coordsAtPos(targetPos);
          if (!dropCaret) {
            dropCaret = document.createElement('div');
            dropCaret.className = 'tiptap-image__drop-caret';
            document.body.appendChild(dropCaret);
          }
          dropCaret.style.left = `${coords.left}px`;
          dropCaret.style.top = `${coords.top}px`;
          dropCaret.style.height = `${Math.max(4, coords.bottom - coords.top)}px`;
        };
        const onUp = (ev) => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          repoCleanup = null;
          removeCaret();
          if (!moved || targetPos == null || typeof getPos !== 'function') return;
          const fromPos = getPos();
          const mode = current.attrs.wrap || 'break';
          const isWrap = mode === 'wrap-left' || mode === 'wrap-right';
          let patch = {};
          if (isWrap) {
            const r = sheet ? sheet.getBoundingClientRect() : null;
            const midX = r ? r.left + r.width / 2 : ev.clientX;
            patch = { wrap: sideForX(ev.clientX, midX) };
          }
          const tr = repositionImageNode(view.state, fromPos, targetPos, patch);
          if (tr) view.dispatch(tr);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        repoCleanup = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          removeCaret();
        };
      };
      const onBodyPointerDown = (e) => {
        const mode = current.attrs.wrap || 'break';
        if (mode === 'front' || mode === 'behind') startMove(e);
        else startReposition(e);
      };
      dom.addEventListener('pointerdown', onBodyPointerDown);
      // Disable the browser's native image drag so it doesn't fight our reposition.
      dom.addEventListener('dragstart', (e) => e.preventDefault());
```

- [ ] **Step 3: Extend `destroy()`**

In the returned object's `destroy()` method, add the reposition teardown:

```javascript
        destroy() {
          if (cleanup) cleanup();
          if (moveCleanup) moveCleanup();
          if (repoCleanup) repoCleanup();
          removeCaret();
        },
```

- [ ] **Step 4: Add the drop-caret CSS**

In `src/index.css`, add after the `.tiptap-image__dim { ... }` rule:

```css
.tiptap-image__drop-caret {
  position: fixed; width: 2px; background: #0284c7; z-index: 50;
  pointer-events: none;
}
```

And in the `@media print { ... }` block, add:

```css
  .tiptap-image__drop-caret { display: none !important; }
```

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS, pristine. (The reposition drag is not unit-tested — jsdom has no layout for `posAtCoords`; this confirms no regression to the helper/popup/attribute tests.)

- [ ] **Step 6: Manual browser check**

With the dev server running, on a document with an image:
- Set Wrap: drag the image → a thin caret follows the drop position; on release it re-anchors near the drop and snaps to the nearer side; text wraps around it.
- Set Break: image is centered; drag moves it to a new text anchor.
- Front/Behind still free-drag absolutely; inline still moves within text.
- A plain click just selects (no move).

- [ ] **Step 7: Commit**

```bash
git add src/components/extensions/image.js src/index.css
git commit -m "feat(fe): drag-to-reposition inline/break/wrap images with drop caret"
```

---

### Task 4: Verification + final review

**Files:** Reference only (verify against the running app).

**Interfaces:** Consumes everything from Tasks 1-3.

- [ ] **Step 1: Full unit suite green**

Run: `npm test`
Expected: PASS, pristine.

- [ ] **Step 2: Browser walkthrough (Playwright MCP / manual)**

On `localhost:5173`, open a document with an image:
- Popup has NO Align buttons; the 5 wrap-mode buttons + reset/replace/delete are present.
- Break image is centered by default.
- Wrap: drag the image → caret indicator; drops re-anchor near the pointer and snap to the nearer side; text wraps around it; reload persists the new anchor + side.
- Break: drag re-anchors vertically; front/behind still free-drag; inline moves in text.
- Plain click selects without moving.
- Print: wrap/break/inline flow, front/behind at offset, no caret/handles/ring.

- [ ] **Step 3: Record outcome**

Note pass/fail per check. If any fail, loop back to the owning task.

---

## Self-Review

**Spec coverage:**
- Remove Align buttons → Task 1 (popup) + CSS align rules removed. ✓
- Break centered by default → Task 1 CSS. ✓
- `align` attr/command retained for compat → untouched in `image.js`; Task 1 only removes UI. ✓
- Wrap `shape-outside` → Task 1 CSS. ✓
- `sideForX` + `repositionImageNode` pure helpers (unit-tested) → Task 2. ✓
- Reposition drag for inline/break/wrap; wrap sets side; drop caret; front/behind unchanged → Task 3. ✓
- posAtCoords null / no-op guards → Task 2 helper (`null` returns) + Task 3 (`if (!at) return`, `moved` gate). ✓
- Native drag disabled → Task 3 `dragstart` preventDefault. ✓
- NodeSelection restored on moved node → Task 2 helper sets it. ✓
- Persistence (node position + wrap in JSON) → automatic; verified Task 4. ✓
- Print hides caret → Task 3 CSS. ✓
- Drag not unit-tested (jsdom) → honored; manual in Task 4. ✓

**Placeholder scan:** none — every step carries concrete code/commands.

**Type consistency:** `sideForX(clientX, midpointX)`, `repositionImageNode(state, fromPos, toPos, attrsPatch)`, the `.tiptap-image__drop-caret` class, and the `wrap` values are used identically across Tasks 2-3. The popup's `applyWrap('wrap')` resolves to `wrap-left`/`wrap-right` before calling `setImageWrap`. ✓
