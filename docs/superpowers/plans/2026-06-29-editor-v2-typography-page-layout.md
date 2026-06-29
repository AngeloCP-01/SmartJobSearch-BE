# Editor v2 — Typography & Page Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add font family, font size, text color & highlight, and a paper-style page canvas (page size + margins) to the in-app document editor, so authored documents look like real résumés/letters and print to match.

**Architecture:** Frontend-only, layered onto the v1 editor. New TipTap v2 extensions (TextStyle, FontFamily, Color, Highlight, a custom FontSize, a custom page-aware Document) wired into `DocumentEditor`; new toolbar controls in `EditorToolbar`; a paper-sheet canvas + page-setup selects + print CSS. Page size/margins are stored as attributes on the ProseMirror root `doc` node, so they ride inside the existing `content` JSON and autosave via the v1 PATCH — **no backend, API, or migration changes.**

**Tech Stack:** React 18, Vite, Tailwind v4, TipTap v2 (`^2.27.2`), Vitest + Testing Library.

## Global Constraints

- **All work is in `SmartJobSearchCRM-FE`** on branch `feat/editor-v2-typography`. No backend changes.
- **TipTap pinned to the `^2` line** — every new TipTap package installs as `@^2`. (v3's StarterKit bundles Underline/Link/TextStyle differently and would collide.)
- **Back-compatible:** v1 documents have no doc-node `attrs` and no font/size/color marks. The custom Document extension supplies attribute defaults (`pageSize: 'Letter'`, `margin: 'Normal'`); missing marks render as the canvas base font. No data migration.
- **Page settings storage:** attributes on the root `doc` node only (inside `content` JSON). Do NOT add backend fields.
- **Test hygiene:** real TipTap editors in tests (no mocks); output must be pristine. For React-mounted editors (`useEditor`) wrap transaction-causing calls in `act()` and use `userEvent.setup()` (the existing `EditorToolbar.test.jsx` pattern). For headless extension unit tests use `new Editor({ element: document.createElement('div'), ... })` from `@tiptap/core` (no React, no act needed).
- **Tailwind arbitrary classes** for page dims (`w-[8.5in]`, `p-[1in]`, etc.) must appear as complete literal strings in source (in the constants map) so Tailwind's scanner emits them — never construct them by string concatenation.
- Run one focused test file with `npx vitest run <path>`; the whole suite with `npm run test`.

## File Structure

- Modify `index.html` — add a Google Fonts `<link>` (Inter, Lato, Merriweather).
- Modify `package.json` — add TipTap text-style/font-family/color/highlight (`^2`).
- Create `src/components/extensions/fontSize.js` (+ `fontSize.test.js`) — custom font-size mark on TextStyle.
- Create `src/components/extensions/pageDocument.js` (+ `pageDocument.test.js`) — Document extension with `pageSize`/`margin` attrs + `setPageSettings` command.
- Create `src/components/editorConstants.js` — shared fonts, sizes, highlight swatches, page dims, margin presets.
- Modify `src/components/EditorToolbar.jsx` (+ `EditorToolbar.test.jsx`) — font family / size / color / highlight controls.
- Modify `src/components/DocumentEditor.jsx` (+ new `DocumentEditor.test.jsx`) — register extensions, paper canvas, page-setup bar, dynamic `@page` style.
- Modify `src/index.css` — print rules for the paper sheet + chrome hiding.
- (Optional) Modify `e2e/editor.spec.js` — set a font + page size, confirm persistence.

---

## Task 1: Install extensions + load Google Fonts

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `index.html`

**Interfaces:**
- Produces: `@tiptap/extension-text-style`, `@tiptap/extension-font-family`, `@tiptap/extension-color`, `@tiptap/extension-highlight` available for import; Inter/Lato/Merriweather web fonts loaded.

- [ ] **Step 1: Install the TipTap packages (pinned to v2)**

Run:
```bash
npm install @tiptap/extension-text-style@^2 @tiptap/extension-font-family@^2 @tiptap/extension-color@^2 @tiptap/extension-highlight@^2
```
Expected: four packages added at `^2.x`, no peer-dependency errors. If npm resolves anything to v3, STOP and report — they must be 2.x to match the existing TipTap install.

- [ ] **Step 2: Add the Google Fonts link**

In `index.html`, immediately after the existing Plus Jakarta Sans `<link ... rel="stylesheet" />` (the one with `family=Plus+Jakarta+Sans`), add:

```html
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lato:wght@400;700&family=Merriweather:wght@400;700&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 3: Verify the suite still passes**

Run: `npm run test`
Expected: existing tests PASS (157), output unaffected.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json index.html
git commit -m "chore(fe): add TipTap text-style/font-family/color/highlight + Google Fonts"
```

---

## Task 2: FontSize extension (TDD)

**Files:**
- Create: `src/components/extensions/fontSize.js`
- Test: `src/components/extensions/fontSize.test.js`

**Interfaces:**
- Consumes: `@tiptap/core`, the `textStyle` mark (from TextStyle).
- Produces: `FontSize` extension adding a `fontSize` attribute to `textStyle`, with commands `setFontSize(size)` and `unsetFontSize()`. `editor.getAttributes('textStyle').fontSize` reflects the set size.

- [ ] **Step 1: Write the failing test**

Create `src/components/extensions/fontSize.test.js`:

```javascript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import { FontSize } from './fontSize';

function makeEditor() {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, TextStyle, FontSize],
    content: '<p>hello world</p>',
  });
}

test('setFontSize applies a font-size to the textStyle mark', () => {
  const editor = makeEditor();
  editor.commands.selectAll();
  editor.commands.setFontSize('14pt');
  expect(editor.getAttributes('textStyle').fontSize).toBe('14pt');
  editor.destroy();
});

test('unsetFontSize clears the font-size', () => {
  const editor = makeEditor();
  editor.commands.selectAll();
  editor.commands.setFontSize('14pt');
  editor.commands.unsetFontSize();
  expect(editor.getAttributes('textStyle').fontSize ?? null).toBe(null);
  editor.destroy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/extensions/fontSize.test.js`
Expected: FAIL — cannot resolve `./fontSize`.

- [ ] **Step 3: Write the extension**

Create `src/components/extensions/fontSize.js`:

```javascript
import { Extension } from '@tiptap/core';

// Adds a `fontSize` attribute to the textStyle mark (TipTap v2 has no official
// font-size extension). Requires @tiptap/extension-text-style to be registered.
export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return { types: ['textStyle'] };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => element.style.fontSize || null,
            renderHTML: (attributes) =>
              attributes.fontSize ? { style: `font-size: ${attributes.fontSize}` } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    };
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/extensions/fontSize.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/extensions/fontSize.js src/components/extensions/fontSize.test.js
git commit -m "feat(fe): custom TipTap FontSize extension"
```

---

## Task 3: Page-aware Document extension (TDD)

**Files:**
- Create: `src/components/extensions/pageDocument.js`
- Test: `src/components/extensions/pageDocument.test.js`

**Interfaces:**
- Consumes: `@tiptap/extension-document`, prosemirror transaction `setDocAttribute`.
- Produces: `PageDocument` (a `Document.extend`) with root-node attributes `pageSize` (default `'Letter'`) and `margin` (default `'Normal'`), plus a `setPageSettings({ pageSize?, margin? })` command that sets the doc-node attributes (participates in history → triggers `onUpdate`). Replaces StarterKit's bundled Document.

- [ ] **Step 1: Write the failing test**

Create `src/components/extensions/pageDocument.test.js`:

```javascript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { PageDocument } from './pageDocument';

function makeEditor(content) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit.configure({ document: false }), PageDocument],
    content: content || '<p>hi</p>',
  });
}

test('the document defaults to Letter / Normal', () => {
  const editor = makeEditor();
  expect(editor.state.doc.attrs.pageSize).toBe('Letter');
  expect(editor.state.doc.attrs.margin).toBe('Normal');
  editor.destroy();
});

test('setPageSettings updates the document attributes', () => {
  const editor = makeEditor();
  editor.commands.setPageSettings({ pageSize: 'A4', margin: 'Wide' });
  expect(editor.state.doc.attrs.pageSize).toBe('A4');
  expect(editor.state.doc.attrs.margin).toBe('Wide');
  editor.destroy();
});

test('setPageSettings can update a single setting', () => {
  const editor = makeEditor();
  editor.commands.setPageSettings({ margin: 'Narrow' });
  expect(editor.state.doc.attrs.pageSize).toBe('Letter'); // unchanged
  expect(editor.state.doc.attrs.margin).toBe('Narrow');
  editor.destroy();
});

test('a doc loaded without attrs still reports defaults (v1 back-compat)', () => {
  const editor = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
  expect(editor.state.doc.attrs.pageSize).toBe('Letter');
  expect(editor.state.doc.attrs.margin).toBe('Normal');
  editor.destroy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/extensions/pageDocument.test.js`
Expected: FAIL — cannot resolve `./pageDocument`.

- [ ] **Step 3: Write the extension**

Create `src/components/extensions/pageDocument.js`:

```javascript
import Document from '@tiptap/extension-document';

// The root document node, extended to carry page-layout settings as attributes
// so they live inside the content JSON (no backend change) and autosave for free.
export const PageDocument = Document.extend({
  addAttributes() {
    return {
      pageSize: {
        default: 'Letter',
        parseHTML: (element) => element.getAttribute('data-page-size') || 'Letter',
        renderHTML: (attributes) => ({ 'data-page-size': attributes.pageSize }),
      },
      margin: {
        default: 'Normal',
        parseHTML: (element) => element.getAttribute('data-margin') || 'Normal',
        renderHTML: (attributes) => ({ 'data-margin': attributes.margin }),
      },
    };
  },

  addCommands() {
    return {
      setPageSettings:
        (settings) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            Object.entries(settings).forEach(([key, value]) => tr.setDocAttribute(key, value));
          }
          return true;
        },
    };
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/extensions/pageDocument.test.js`
Expected: PASS. (If `tr.setDocAttribute` is unavailable in the installed prosemirror-state, STOP and report — do not silently swap in a different mechanism without flagging it.)

- [ ] **Step 5: Commit**

```bash
git add src/components/extensions/pageDocument.js src/components/extensions/pageDocument.test.js
git commit -m "feat(fe): page-aware Document extension (pageSize/margin attrs + setPageSettings)"
```

---

## Task 4: Editor constants + toolbar typography controls (TDD)

**Files:**
- Create: `src/components/editorConstants.js`
- Modify: `src/components/EditorToolbar.jsx`
- Test: `src/components/EditorToolbar.test.jsx`

**Interfaces:**
- Consumes: `FONTS`, `FONT_SIZES`, `HIGHLIGHT_COLORS` from `editorConstants`; the editor's FontFamily/FontSize/Color/Highlight commands.
- Produces: `EditorToolbar` renders, in addition to the v1 controls — a **Font family** `<select aria-label="Font family">`, a **Font size** `<select aria-label="Font size">`, a **Text color** `<input type="color" aria-label="Text color">`, a **Highlight** `<input type="color" aria-label="Highlight color">` + a **Remove highlight** button. Each control reflects the current selection's marks and dispatches the matching command.

- [ ] **Step 1: Create the shared constants**

Create `src/components/editorConstants.js`:

```javascript
// Curated, ATS-safe font stacks (web-safe + a few Google Fonts loaded in index.html).
export const FONTS = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Garamond', value: 'Garamond, "Times New Roman", serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Inter', value: 'Inter, sans-serif' },
  { label: 'Lato', value: 'Lato, sans-serif' },
  { label: 'Merriweather', value: 'Merriweather, serif' },
];

export const FONT_SIZES = ['8pt', '9pt', '10pt', '10.5pt', '11pt', '12pt', '14pt', '16pt', '18pt', '24pt', '36pt'];

export const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];

// Page geometry. Class strings are complete literals so Tailwind emits them.
export const PAGE_SIZES = [
  { label: 'Letter', value: 'Letter' },
  { label: 'A4', value: 'A4' },
];
export const MARGINS = [
  { label: 'Normal', value: 'Normal' },
  { label: 'Narrow', value: 'Narrow' },
  { label: 'Wide', value: 'Wide' },
];
export const PAGE_WIDTH_CLASS = { Letter: 'w-[8.5in]', A4: 'w-[210mm]' };
export const MARGIN_PAD_CLASS = { Normal: 'p-[1in]', Narrow: 'p-[0.5in]', Wide: 'p-[1.5in]' };
```

- [ ] **Step 2: Write the failing tests (extend the toolbar test)**

In `src/components/EditorToolbar.test.jsx`, replace the imports + `useTestEditor` helper at the top with the version below (adds the new extensions so the toolbar's typography controls have something to act on), and append the four new tests. Keep the existing bold/bullet/empty tests unchanged.

Replace the top block:

```javascript
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { renderHook } from '@testing-library/react';
import { FontSize } from './extensions/fontSize';
import EditorToolbar from './EditorToolbar';

afterEach(cleanup);

function useTestEditor() {
  return useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }] },
  });
}
```

Append the new tests:

```javascript
test('font family select applies the chosen font', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  await act(async () => { editor.commands.selectAll(); });
  const user = userEvent.setup();
  render(<EditorToolbar editor={editor} />);

  await user.selectOptions(screen.getByLabelText('Font family'), 'Georgia, serif');
  expect(editor.getAttributes('textStyle').fontFamily).toBe('Georgia, serif');
});

test('font size select applies the chosen size', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  await act(async () => { editor.commands.selectAll(); });
  const user = userEvent.setup();
  render(<EditorToolbar editor={editor} />);

  await user.selectOptions(screen.getByLabelText('Font size'), '14pt');
  expect(editor.getAttributes('textStyle').fontSize).toBe('14pt');
});

test('text color input applies a color', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  await act(async () => { editor.commands.selectAll(); });
  render(<EditorToolbar editor={editor} />);

  await act(async () => {
    fireEvent.input(screen.getByLabelText('Text color'), { target: { value: '#ff0000' } });
  });
  expect(editor.getAttributes('textStyle').color).toBe('#ff0000');
});

test('highlight color input toggles a highlight mark', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  await act(async () => { editor.commands.selectAll(); });
  render(<EditorToolbar editor={editor} />);

  await act(async () => {
    fireEvent.input(screen.getByLabelText('Highlight color'), { target: { value: '#fef08a' } });
  });
  expect(editor.isActive('highlight')).toBe(true);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/components/EditorToolbar.test.jsx`
Expected: FAIL — the new controls don't exist yet (`getByLabelText('Font family')` not found).

- [ ] **Step 4: Add the controls to the toolbar**

In `src/components/EditorToolbar.jsx`:

(a) Add imports at the top (after the existing lucide import):

```javascript
import { Highlighter } from 'lucide-react';
import { FONTS, FONT_SIZES } from './editorConstants';
```

(b) Inside `EditorToolbar`, after the existing `setLink` definition, add helpers that read current marks:

```javascript
  const currentFont = editor.getAttributes('textStyle').fontFamily || '';
  const currentSize = editor.getAttributes('textStyle').fontSize || '';
  const currentColor = editor.getAttributes('textStyle').color || '#000000';

  const onFont = (value) => {
    if (value) chain().setFontFamily(value).run();
    else chain().unsetFontFamily().run();
  };
  const onSize = (value) => {
    if (value) chain().setFontSize(value).run();
    else chain().unsetFontSize().run();
  };
```

(c) Add a new control group before the closing `</div>` of the toolbar (after the alignment buttons), as a new wrapped row of controls:

```jsx
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <select
        aria-label="Font family"
        value={currentFont}
        onChange={(e) => onFont(e.target.value)}
        className="h-8 rounded-md border border-slate-200 bg-white px-1 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
      </select>
      <select
        aria-label="Font size"
        value={currentSize}
        onChange={(e) => onSize(e.target.value)}
        className="h-8 rounded-md border border-slate-200 bg-white px-1 text-sm text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
      >
        <option value="">Size</option>
        {FONT_SIZES.map((s) => <option key={s} value={s}>{s.replace('pt', '')}</option>)}
      </select>
      <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100" title="Text color">
        <span className="text-sm font-semibold text-slate-700" aria-hidden="true">A</span>
        <input
          type="color"
          aria-label="Text color"
          value={currentColor}
          onChange={(e) => chain().setColor(e.target.value).run()}
          className="sr-only"
        />
      </label>
      <label className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md hover:bg-slate-100" title="Highlight">
        <Highlighter size={16} aria-hidden="true" />
        <input
          type="color"
          aria-label="Highlight color"
          onChange={(e) => chain().toggleHighlight({ color: e.target.value }).run()}
          className="sr-only"
        />
      </label>
      <Btn label="Remove highlight" onClick={() => chain().unsetHighlight().run()}><Highlighter size={16} className="opacity-40" /></Btn>
```

Note: the `Btn` component and the existing imports remain. `chain()` is the existing `() => editor.chain().focus()` helper.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/EditorToolbar.test.jsx`
Expected: PASS (existing + 4 new), output pristine (no act warnings).

- [ ] **Step 6: Commit**

```bash
git add src/components/editorConstants.js src/components/EditorToolbar.jsx src/components/EditorToolbar.test.jsx
git commit -m "feat(fe): toolbar font family/size/color/highlight controls"
```

---

## Task 5: DocumentEditor integration — extensions, paper canvas, page setup, print

**Files:**
- Modify: `src/components/DocumentEditor.jsx`
- Test: `src/components/DocumentEditor.test.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: all extensions (Tasks 2–3), `editorConstants` (Task 4), `EditorToolbar`.
- Produces: `DocumentEditor` mounts the full v2 editor (page-aware Document + typography marks), renders a **page-setup bar** (Page size + Margins selects, `aria-label`s "Page size" / "Margins") + the toolbar inside an `.editor-chrome` wrapper, and a gray backdrop containing a white **sheet** whose width/padding come from the doc's `pageSize`/`margin` attributes. Emits `onChange(editor.getJSON())` on every edit (unchanged contract). Renders a print `@page` style matching the current page size.

- [ ] **Step 1: Write the failing test**

Create `src/components/DocumentEditor.test.jsx`:

```javascript
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentEditor from './DocumentEditor';

test('renders the page-setup selects defaulting to Letter / Normal', async () => {
  render(<DocumentEditor content={{ type: 'doc', content: [{ type: 'paragraph' }] }} onChange={() => {}} />);
  // useEditor mounts asynchronously; wait for the controls.
  expect(await screen.findByLabelText('Page size')).toHaveValue('Letter');
  expect(screen.getByLabelText('Margins')).toHaveValue('Normal');
});

test('changing the page size updates the sheet width and emits onChange', async () => {
  const onChange = vi.fn();
  render(<DocumentEditor content={{ type: 'doc', content: [{ type: 'paragraph' }] }} onChange={onChange} />);
  const pageSize = await screen.findByLabelText('Page size');

  const user = userEvent.setup();
  await act(async () => { await user.selectOptions(pageSize, 'A4'); });

  expect(screen.getByLabelText('Page size')).toHaveValue('A4');
  // The sheet element carries the A4 width class.
  expect(document.querySelector('.editor-sheet')).toHaveClass('w-[210mm]');
  expect(onChange).toHaveBeenCalled();
});

test('seeds the sheet from existing page attributes in content', async () => {
  render(
    <DocumentEditor
      content={{ type: 'doc', attrs: { pageSize: 'A4', margin: 'Wide' }, content: [{ type: 'paragraph' }] }}
      onChange={() => {}}
    />,
  );
  expect(await screen.findByLabelText('Page size')).toHaveValue('A4');
  expect(document.querySelector('.editor-sheet')).toHaveClass('w-[210mm]', 'p-[1.5in]');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/DocumentEditor.test.jsx`
Expected: FAIL — no "Page size" control / `.editor-sheet` yet.

- [ ] **Step 3: Rewrite DocumentEditor**

Replace `src/components/DocumentEditor.jsx` with:

```jsx
import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import EditorToolbar from './EditorToolbar';
import { FontSize } from './extensions/fontSize';
import { PageDocument } from './extensions/pageDocument';
import { PAGE_SIZES, MARGINS, PAGE_WIDTH_CLASS, MARGIN_PAD_CLASS } from './editorConstants';

function pageOf(content) {
  return {
    pageSize: content?.attrs?.pageSize || 'Letter',
    margin: content?.attrs?.margin || 'Normal',
  };
}

export default function DocumentEditor({ content, onChange }) {
  const [page, setPage] = useState(() => pageOf(content));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, document: false }),
      PageDocument,
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      FontFamily,
      FontSize,
      Color,
      Highlight.configure({ multicolor: true }),
    ],
    content: content || { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: { class: 'tiptap min-h-[9in] focus:outline-none prose max-w-none' },
    },
    onUpdate: ({ editor }) => {
      setPage({ pageSize: editor.state.doc.attrs.pageSize, margin: editor.state.doc.attrs.margin });
      onChange?.(editor.getJSON());
    },
  });

  const setPageSetting = (patch) => editor?.chain().focus().setPageSettings(patch).run();

  const sheetClass = `editor-sheet mx-auto bg-white shadow-md ${PAGE_WIDTH_CLASS[page.pageSize]} ${MARGIN_PAD_CLASS[page.margin]}`;

  return (
    <div className="document-print-area">
      {/* Per-document print page size; margin handled by the sheet padding. */}
      <style>{`@media print { @page { size: ${page.pageSize}; margin: 0; } }`}</style>

      <div className="editor-chrome rounded-t-xl border border-b-0 border-sky-100 bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-sky-100 px-3 py-1.5 text-sm text-slate-600">
          <label className="inline-flex items-center gap-1">
            Page size
            <select
              aria-label="Page size"
              value={page.pageSize}
              onChange={(e) => setPageSetting({ pageSize: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {PAGE_SIZES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1">
            Margins
            <select
              aria-label="Margins"
              value={page.margin}
              onChange={(e) => setPageSetting({ margin: e.target.value })}
              className="rounded-md border border-slate-200 bg-white px-1 py-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
              {MARGINS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </label>
        </div>
        <EditorToolbar editor={editor} />
      </div>

      <div className="editor-canvas-backdrop rounded-b-xl border border-t-0 border-sky-100 bg-slate-100 p-6">
        <div className={sheetClass}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update the print CSS**

In `src/index.css`, replace the entire existing `@media print { … }` block with:

```css
@media print {
  body * { visibility: hidden; }
  .document-print-area, .document-print-area * { visibility: visible; }
  .document-print-area { position: absolute; inset: 0; }
  /* Hide the page-setup bar + toolbar; print only the sheet. */
  .editor-chrome { display: none !important; }
  .editor-canvas-backdrop { background: none !important; border: 0 !important; padding: 0 !important; }
  .editor-sheet { box-shadow: none !important; margin: 0 !important; }
  .editor-sheet .tiptap { min-height: 0 !important; }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/DocumentEditor.test.jsx`
Expected: PASS.

- [ ] **Step 6: Run the editor-page + full suite (no regressions)**

Run: `npx vitest run src/pages/EditorDocument.test.jsx` then `npm run test`
Expected: PASS (the v1 editor-page tests still pass against the new DocumentEditor; full suite green, pristine).

- [ ] **Step 7: Commit**

```bash
git add src/components/DocumentEditor.jsx src/components/DocumentEditor.test.jsx src/index.css
git commit -m "feat(fe): paper canvas, page setup, and typography wiring in DocumentEditor"
```

---

## Task 6 (optional): e2e — font + page size persist across reload

**Files:**
- Modify: `e2e/editor.spec.js`

**Interfaces:**
- Consumes: the running app (demo flow as in the existing spec).
- Produces: a check that a chosen font + page size survive a reload.

- [ ] **Step 1: Add the assertions**

In `e2e/editor.spec.js`, after the existing "type … see Saved … reload" flow (before or after the persisted-text assertion), add:

```javascript
  // Typography + page layout persist across reload.
  await page.getByLabel('Page size').selectOption('A4');
  await expect(page.getByText(/saving…/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/saving…/i)).toBeHidden({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel('Page size')).toHaveValue('A4');
```

- [ ] **Step 2: Confirm the spec still parses/collects**

Run: `npx playwright test e2e/editor.spec.js --list`
Expected: the spec is discovered. (Live run needs the full stack; deferred to CI/manual.)

- [ ] **Step 3: Commit**

```bash
git add e2e/editor.spec.js
git commit -m "test(e2e): assert font/page-size persistence in the editor"
```

---

## Self-Review

**Spec coverage:**
- Font family → Task 1 (FontFamily dep), Task 4 (toolbar select). ✓
- Font size → Task 2 (extension), Task 4 (toolbar select). ✓
- Text color & highlight → Task 1 (deps), Task 4 (color/highlight inputs). ✓
- Page size + margins (paper canvas) → Task 3 (PageDocument), Task 5 (canvas + page-setup bar + dynamic `@page`). ✓
- Stored in `content` JSON, no backend → Task 3 (doc-node attrs), no migration anywhere. ✓
- Back-compat with v1 docs → Task 3 defaults + Task 5 `pageOf` fallback + Task 5 Step 6 (v1 editor-page tests still pass). ✓
- Google Fonts loaded → Task 1. ✓
- Print matches → Task 5 (dynamic `@page` + sheet padding + chrome hidden). ✓
- Tests (real editors, pristine) → Tasks 2–5; optional e2e Task 6. ✓

**Placeholder scan:** none — every code step is complete. The one risk flagged explicitly (Task 3 Step 4) is `tr.setDocAttribute` availability, with a STOP-and-report instruction rather than a silent fallback.

**Type/name consistency:** `FontSize`, `PageDocument`, `setPageSettings`, `setFontSize/unsetFontSize`, constants `FONTS/FONT_SIZES/HIGHLIGHT_COLORS/PAGE_SIZES/MARGINS/PAGE_WIDTH_CLASS/MARGIN_PAD_CLASS`, `.editor-chrome/.editor-canvas-backdrop/.editor-sheet`, aria-labels `Font family/Font size/Text color/Highlight color/Page size/Margins` — used identically across tasks. The `DocumentEditor` `(content, onChange)` contract is unchanged, so the v1 `EditorDocument` page keeps working without edits.

**Known notes:** Page setup is rendered inside `DocumentEditor`'s own chrome bar (encapsulating the editor) rather than the page's title row — same document-level intent, cleaner boundary, and keeps `DocumentEditor`'s interface unchanged. `prose max-w-none` is retained; inline font/size/color marks override prose defaults.
