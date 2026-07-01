# Editor — Image Options Popup + Toolbar Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A floating image-options popup (BubbleMenu) with align/size/replace/delete when an image is selected; move image-align out of the main toolbar; add hover tooltips to all toolbar icon buttons.

**Architecture:** A pure `ImageOptions` component (testable) rendered inside a TipTap `BubbleMenu` in `DocumentEditor`. Size presets are `%` of the page, which requires the `ResizableImage` NodeView to apply width to the image *wrapper* (not the `<img>`). Toolbar `Btn` gains a `title` for hover tooltips; the inline image-align block is removed.

**Tech Stack:** React 18, TipTap v2, Vitest + Testing Library + MSW.

## Global Constraints

- Frontend only, `SmartJobSearchCRM-FE`, branch `feat/editor-image-options-popup`. TipTap pinned `^2`.
- Additive to editor behavior; `DocumentEditor` `(content, onChange)` contract unchanged; image content still serializes/autosaves as before.
- Every icon button exposes BOTH an `aria-label` (tests/a11y) and a `title` (hover tooltip).
- Tests: real editors, no mocks except the image upload (mock `uploadImage` at the module boundary — jsdom's `File.text()` hangs a real axios FormData upload). BubbleMenu floating/positioning is manual/e2e (jsdom can't measure layout). Output pristine.
- Run one FE test: `npx vitest run <path>`; whole suite: `npm run test`.

## File Structure

- Modify `package.json` — add `@tiptap/extension-bubble-menu@^2`.
- Modify `src/components/extensions/image.js` — NodeView applies width to the wrapper; drag-resize updates the wrapper.
- Create `src/components/ImageOptions.jsx` (+ `ImageOptions.test.jsx`).
- Modify `src/components/EditorToolbar.jsx` (+ `EditorToolbar.test.jsx`) — `Btn` gets `title`; remove the image-align block.
- Modify `src/components/DocumentEditor.jsx` — render `<BubbleMenu>` with `<ImageOptions>`.
- Modify `src/index.css` — popup print-hide + image-sizing tweak.

---

## Task 1: Install BubbleMenu extension

**Files:** Modify `package.json`.

- [ ] **Step 1:** `npm install @tiptap/extension-bubble-menu@^2` (must resolve 2.x; STOP+report if v3/ERESOLVE).
- [ ] **Step 2:** `npm run test` → suite still green (191).
- [ ] **Step 3:** Commit:
```bash
git add package.json package-lock.json
git commit -m "chore(fe): add @tiptap/extension-bubble-menu"
```

---

## Task 2: Image width applies to the wrapper (for % sizing)

**Files:** Modify `src/components/extensions/image.js`, `src/index.css`.

**Interfaces:** No command/attribute changes (`setImageWidth`/`setImageAlign` unchanged). The NodeView now sets the width on the `.tiptap-image` wrapper (so `%` is relative to the editor/page), with the `<img>` filling it. `image.test.js` (attribute commands) stays green; the DOM change is manual/e2e.

- [ ] **Step 1: Update the NodeView width handling**

In `src/components/extensions/image.js` `addNodeView()`, change the width application and the drag handlers so width is on the wrapper:

Replace the width-on-create line:
```javascript
      if (node.attrs.width) img.style.width = node.attrs.width;
```
with:
```javascript
      if (node.attrs.width) {
        dom.style.width = node.attrs.width;
        img.style.width = '100%';
      }
```

Replace `onMove`:
```javascript
      const onMove = (e) => {
        const newW = Math.max(40, startW + (e.clientX - startX));
        img.style.width = `${newW}px`;
      };
```
with:
```javascript
      const onMove = (e) => {
        const newW = Math.max(40, startW + (e.clientX - startX));
        dom.style.width = `${newW}px`;
        img.style.width = '100%';
      };
```

In the `onUp` commit, change `width: img.style.width` to `width: dom.style.width`:
```javascript
              tr.setNodeMarkup(pos, undefined, { ...currentAttrs, width: dom.style.width });
```

In the `pointerdown` handler, base the start width on the wrapper:
```javascript
        startW = dom.getBoundingClientRect().width || img.naturalWidth || 200;
```

- [ ] **Step 2: Update the image CSS**

In `src/index.css`, the `.tiptap-image` rules become (replace the existing `.tiptap-image`/`.tiptap-image img` rules):
```css
.tiptap-image { position: relative; display: block; width: fit-content; max-width: 100%; }
.tiptap-image[data-align="center"] { margin-left: auto; margin-right: auto; }
.tiptap-image[data-align="right"] { margin-left: auto; }
.tiptap-image[data-align="left"] { margin-right: auto; }
.tiptap-image img { display: block; width: 100%; height: auto; }
```
(When no width is set, the wrapper is `fit-content` → the `img { width: 100% }` fills the natural-size wrapper, i.e. natural size. When a width like `50%` is set inline on the wrapper, it overrides `fit-content` → 50% of the editor width, and the img fills it.)

- [ ] **Step 3: Verify**

Run: `npx vitest run src/components/extensions/image.test.js` (2/2 — attribute commands unchanged) then `npm run test` (green).

- [ ] **Step 4: Commit**
```bash
git add src/components/extensions/image.js src/index.css
git commit -m "refactor(fe): apply editor image width to the wrapper so % sizing is page-relative"
```

---

## Task 3: ImageOptions component (TDD)

**Files:** Create `src/components/ImageOptions.jsx` (+ `ImageOptions.test.jsx`).

**Interfaces:** `<ImageOptions editor />` renders align (L/C/R), size (Small 25% / Medium 50% / Full 100%), Replace (upload → swap src), Delete. Each control has `aria-label` + `title`. Assumes an image is node-selected.

- [ ] **Step 1: Write the failing test**

Create `src/components/ImageOptions.test.jsx`:
```javascript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ResizableImage } from './extensions/image';
import * as imagesApi from '../api/images';
import ImageOptions from './ImageOptions';

function makeEditor() {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, ResizableImage],
    content: '<p>x</p>',
  });
  editor.commands.setImage({ src: 'http://x/a.png' });
  let pos = null;
  editor.state.doc.descendants((n, p) => { if (n.type.name === 'image') pos = p; });
  editor.commands.setNodeSelection(pos);
  return editor;
}
const imgAttrs = (editor) => editor.getJSON().content.find((n) => n.type === 'image').attrs;

test('align buttons set the image align', async () => {
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  await user.click(screen.getByRole('button', { name: 'Align image center' }));
  expect(imgAttrs(editor).align).toBe('center');
});

test('size presets set the image width', async () => {
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  await user.click(screen.getByRole('button', { name: /medium/i }));
  expect(imgAttrs(editor).width).toBe('50%');
});

test('delete removes the image', async () => {
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  await user.click(screen.getByRole('button', { name: 'Delete image' }));
  expect(editor.getJSON().content.find((n) => n.type === 'image')).toBeUndefined();
});

test('replace uploads a new file and swaps the src', async () => {
  vi.spyOn(imagesApi, 'uploadImage').mockResolvedValue({ id: 'x', url: 'http://x/new.png' });
  const editor = makeEditor();
  const user = userEvent.setup();
  render(<ImageOptions editor={editor} />);
  await user.upload(screen.getByLabelText('Replace image'), new File(['png'], 'new.png', { type: 'image/png' }));
  await waitFor(() => expect(imgAttrs(editor).src).toBe('http://x/new.png'));
});

test('buttons expose hover titles', () => {
  const editor = makeEditor();
  render(<ImageOptions editor={editor} />);
  expect(screen.getByRole('button', { name: 'Align image left' })).toHaveAttribute('title', 'Align image left');
});
```

- [ ] **Step 2: Run → RED** (`npx vitest run src/components/ImageOptions.test.jsx`).

- [ ] **Step 3: Write the component**

Create `src/components/ImageOptions.jsx`:
```jsx
import { useRef } from 'react';
import { AlignLeft, AlignCenter, AlignRight, RefreshCw, Trash2 } from 'lucide-react';
import { uploadImage } from '../api/images';

const SIZES = [
  { label: 'Small', title: 'Small (25%)', value: '25%' },
  { label: 'Medium', title: 'Medium (50%)', value: '50%' },
  { label: 'Full', title: 'Full width (100%)', value: '100%' },
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
  const fileRef = useRef(null);
  if (!editor) return null;
  const chain = () => editor.chain().focus();
  const align = editor.getAttributes('image').align;
  const width = editor.getAttributes('image').width;

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
      {SIZES.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-label={s.title}
          title={s.title}
          aria-pressed={width === s.value || undefined}
          onClick={() => chain().setImageWidth(s.value).run()}
          className={`h-8 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${width === s.value ? 'bg-sky-100 text-sky-700' : ''}`}
        >
          {s.label}
        </button>
      ))}
      <span className="mx-0.5 h-5 w-px bg-slate-200" />
      <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100" title="Replace image">
        <RefreshCw size={14} aria-hidden="true" /> Replace
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Replace image" className="sr-only" onChange={onReplace} />
      </label>
      <IconBtn label="Delete image" onClick={() => chain().deleteSelection().run()}><Trash2 size={16} /></IconBtn>
    </div>
  );
}
```

- [ ] **Step 4: Run → GREEN** (`npx vitest run src/components/ImageOptions.test.jsx`, 5/5).

- [ ] **Step 5: Commit**
```bash
git add src/components/ImageOptions.jsx src/components/ImageOptions.test.jsx
git commit -m "feat(fe): ImageOptions popup content (align/size/replace/delete)"
```

---

## Task 4: Toolbar tooltips + remove image-align (TDD)

**Files:** Modify `src/components/EditorToolbar.jsx`, `src/components/EditorToolbar.test.jsx`.

**Interfaces:** `Btn` renders `title={label}` (hover tooltip) in addition to `aria-label`. The inline image-align block (shown when `editor.isActive('image')`) is removed (now in the popup). The "Insert image" button stays.

- [ ] **Step 1: Update the tests first**

In `src/components/EditorToolbar.test.jsx`:
(a) **Remove** the test `align-image buttons appear only when an image is selected` (image-align moved to the popup).
(b) Append a tooltip test:
```javascript
test('toolbar icon buttons have a hover title matching their label', () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  render(<EditorToolbar editor={editor} />);
  expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('title', 'Bold');
});
```

- [ ] **Step 2: Run → RED/failing** (`npx vitest run src/components/EditorToolbar.test.jsx`) — the tooltip test fails (no `title` yet); the removed test is gone.

- [ ] **Step 3: Add `title` to `Btn` and remove the image-align block**

In `src/components/EditorToolbar.jsx`, in the `Btn` component, add `title={label}` next to `aria-label`:
```jsx
      aria-label={label}
      title={label}
      aria-pressed={active ?? undefined}
```

Remove the image-align block (currently after the Insert-image label):
```jsx
      {editor.isActive('image') && (
        <>
          <Btn label="Align image left" active={editor.isActive('image', { align: 'left' })} onClick={() => chain().setImageAlign('left').run()}><AlignLeft size={16} /></Btn>
          <Btn label="Align image center" active={editor.isActive('image', { align: 'center' })} onClick={() => chain().setImageAlign('center').run()}><AlignCenter size={16} /></Btn>
          <Btn label="Align image right" active={editor.isActive('image', { align: 'right' })} onClick={() => chain().setImageAlign('right').run()}><AlignRight size={16} /></Btn>
        </>
      )}
```
(Delete those lines entirely. Leave the `AlignLeft/AlignCenter/AlignRight` imports — they're still used by the text-align buttons.)

- [ ] **Step 4: Run → GREEN** (`npx vitest run src/components/EditorToolbar.test.jsx`) then `npm run test` (green, pristine).

- [ ] **Step 5: Commit**
```bash
git add src/components/EditorToolbar.jsx src/components/EditorToolbar.test.jsx
git commit -m "feat(fe): toolbar hover tooltips; move image-align to the popup"
```

---

## Task 5: Wire the BubbleMenu into DocumentEditor + print CSS

**Files:** Modify `src/components/DocumentEditor.jsx`, `src/index.css`.

**Interfaces:** When an image is selected, a floating popup (`ImageOptions`) shows anchored to it.

- [ ] **Step 1: Render the BubbleMenu**

In `src/components/DocumentEditor.jsx`:
(a) Add imports:
```javascript
import { useEditor, EditorContent, BubbleMenu } from '@tiptap/react';
import ImageOptions from './ImageOptions';
```
(replace the existing `import { useEditor, EditorContent } from '@tiptap/react';`).
(b) Inside the returned JSX, add the BubbleMenu right after `<EditorContent editor={editor} />` (still inside the sheet or the `.document-print-area` — placing it inside `.document-print-area` is fine):
```jsx
        <div className={sheetClass}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {editor && (
        <BubbleMenu editor={editor} shouldShow={({ editor }) => editor.isActive('image')} tippyOptions={{ placement: 'top' }}>
          <ImageOptions editor={editor} />
        </BubbleMenu>
      )}
```
(Insert the BubbleMenu block just before the final `</div>` that closes `.document-print-area`.)

- [ ] **Step 2: Print CSS — hide the popup**

In `src/index.css`, inside the `@media print { … }` block, add:
```css
  .image-options, [data-tippy-root] { display: none !important; }
```

- [ ] **Step 3: Verify the suite (esp. DocumentEditor.test.jsx) still passes**

Run: `npx vitest run src/components/DocumentEditor.test.jsx` then `npm run test`.
Expected: all green, pristine. **Risk:** the TipTap `BubbleMenu` mounts a tippy instance in jsdom. If `DocumentEditor.test.jsx` now errors or logs warnings because of the BubbleMenu, do NOT delete the test — instead make the BubbleMenu jsdom-safe: confirm whether it throws; if it only warns, that's a finding to resolve (e.g. guard rendering the BubbleMenu when `typeof window !== 'undefined' && window.matchMedia` — already polyfilled — or wrap in a try). Report exactly what happens so the controller can decide. Prefer the smallest change that keeps the tests pristine without weakening them.

- [ ] **Step 4: Commit**
```bash
git add src/components/DocumentEditor.jsx src/index.css
git commit -m "feat(fe): floating image-options popup (BubbleMenu) in the editor"
```

---

## Task 6 (optional): e2e — image popup

**Files:** Modify `e2e/editor.spec.js`.

- [ ] **Step 1:** After inserting an image, click it and assert the popup appears + a size preset changes the width:
```javascript
  await page.locator('.tiptap-image img').click();
  await expect(page.getByRole('button', { name: 'Align image center' })).toBeVisible();
  await page.getByRole('button', { name: /medium/i }).click();
```
- [ ] **Step 2:** `npx playwright test e2e/editor.spec.js --list` (discovered; live run deferred).
- [ ] **Step 3:** Commit.

---

## Self-Review

**Spec coverage:**
- Floating popup (BubbleMenu) with align/size/replace/delete → Tasks 3, 5. ✓
- `%` size presets working page-relative → Task 2 (wrapper width). ✓
- Toolbar hover tooltips (`title`) → Task 4. ✓
- Remove duplicate image-align icons from the toolbar → Task 4. ✓
- Print hides the popup → Task 5. ✓
- Tests (ImageOptions commands + tooltip; DocumentEditor still green) → Tasks 3, 4, 5. ✓
- Behind/in-front overlay stays out (v5). ✓

**Placeholder scan:** No TBD/TODO; complete code in every step. Task 5 Step 3 flags the one real risk (BubbleMenu in jsdom) with a concrete verification + resolution path rather than a placeholder.

**Type/name consistency:** `ImageOptions`, `setImageAlign`/`setImageWidth` (existing), `updateAttributes('image', …)`, `deleteSelection`, aria-labels (`Align image left/center/right`, `Small (25%)`/`Medium (50%)`/`Full width (100%)`, `Replace image`, `Delete image`), `Btn` `title={label}`, CSS `.image-options` / `.tiptap-image` — consistent across tasks. `BubbleMenu` from `@tiptap/react` backed by `@tiptap/extension-bubble-menu` (Task 1).

**Known manual-test surface:** the BubbleMenu floating/positioning and the drag-resize handle — both Playwright/manual (jsdom can't do layout); the command logic and tooltips are unit-tested.
