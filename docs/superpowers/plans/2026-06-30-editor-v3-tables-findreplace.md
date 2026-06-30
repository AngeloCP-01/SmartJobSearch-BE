# Editor v3 — Tables & Find/Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tables, a find & replace panel, and task-list checkboxes to the in-app document editor — moving it closer to Google Docs. All frontend; new content serializes into the existing `content` JSON and autosaves via the v1 PATCH.

**Architecture:** Layer new TipTap v2 extensions (Table set, TaskList/TaskItem) plus a custom ProseMirror Find&Replace extension onto the existing `DocumentEditor`/`EditorToolbar`. A `FindReplacePanel` renders in the editor chrome. No backend, API, or migration changes.

**Tech Stack:** React 18, Vite, Tailwind v4, TipTap v2 (`^2.27.2`), ProseMirror (`@tiptap/pm`), Vitest + Testing Library.

## Global Constraints

- **All work is in `SmartJobSearchCRM-FE`** on branch `feat/editor-v3-tables-findreplace`. No backend changes.
- **TipTap pinned to `^2`** — every new TipTap package installs as `@^2`.
- **Additive only:** v1/v2 documents must keep parsing/rendering; the `DocumentEditor` `(content, onChange)` contract is unchanged. Tables/task lists serialize via `editor.getJSON()` and autosave through the existing PATCH. Find/replace is transient (never persisted).
- **ProseMirror imports** come from the TipTap re-exports: `@tiptap/pm/state` (`Plugin`, `PluginKey`, `TextSelection`), `@tiptap/pm/view` (`Decoration`, `DecorationSet`). Do not add raw `prosemirror-*` packages.
- **Test hygiene:** real editors (no mocks). Headless extension tests use `new Editor({ element: document.createElement('div'), … })` from `@tiptap/core`. React-mounted editor tests wrap transaction-causing calls in `act()` and use `userEvent.setup()` (the v2 pattern). Output pristine.
- Run one focused test file with `npx vitest run <path>`; the whole suite with `npm run test`.

## File Structure

- Modify `package.json` — add the 6 TipTap extensions (`@^2`).
- Modify `src/components/DocumentEditor.jsx` — register new extensions; hold `searchOpen` state; render `FindReplacePanel`; Ctrl/Cmd-F handler; pass `onToggleSearch` to the toolbar.
- Modify `src/components/EditorToolbar.jsx` (+ `EditorToolbar.test.jsx`) — table controls, checklist toggle, search button (`onToggleSearch` prop).
- Create `src/components/extensions/findReplace.js` (+ `findReplace.test.js`) — custom ProseMirror find/replace extension.
- Create `src/components/FindReplacePanel.jsx` (+ `FindReplacePanel.test.jsx`) — the panel UI.
- Modify `src/index.css` — search-match highlight styles + minimal print table borders.
- (Optional) Modify `e2e/editor.spec.js`.

---

## Task 1: Install table + task-list extensions

**Files:** Modify `package.json` (via `npm install`)

**Interfaces:** Produces `@tiptap/extension-table`, `-table-row`, `-table-header`, `-table-cell`, `-task-list`, `-task-item` available for import.

- [ ] **Step 1: Install (pinned to v2)**

Run:
```bash
npm install @tiptap/extension-table@^2 @tiptap/extension-table-row@^2 @tiptap/extension-table-header@^2 @tiptap/extension-table-cell@^2 @tiptap/extension-task-list@^2 @tiptap/extension-task-item@^2
```
Expected: six packages at `^2.x`, no peer-dep errors. If any resolves to v3, STOP and report.

- [ ] **Step 2: Verify the suite still passes**

Run: `npm run test`
Expected: existing tests PASS (170).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(fe): add TipTap table + task-list extensions"
```

---

## Task 2: Tables — register + toolbar controls + print CSS (TDD)

**Files:**
- Modify: `src/components/DocumentEditor.jsx`
- Modify: `src/components/EditorToolbar.jsx`
- Test: `src/components/EditorToolbar.test.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: Table extensions (Task 1).
- Produces: `DocumentEditor` registers `Table.configure({ resizable: true })` + `TableRow` + `TableHeader` + `TableCell`. `EditorToolbar` shows an always-present **Insert table** button (`aria-label="Insert table"`, inserts a 3×3 with header row) and, **only when the selection is in a table**, a table-edit group with buttons `aria-label`: "Add column", "Delete column", "Add row", "Delete row", "Toggle header row", "Delete table".

- [ ] **Step 1: Write the failing tests (append to EditorToolbar.test.jsx)**

First, broaden the shared `useTestEditor` in `src/components/EditorToolbar.test.jsx` to register the table extensions. Replace its `import`/helper top block additions: add these imports near the other TipTap imports:

```javascript
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
```

and add to the `extensions` array inside `useTestEditor` (after `Highlight.configure(...)`):

```javascript
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
```

Append these tests:

```javascript
test('insert table button creates a table', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  render(<EditorToolbar editor={editor} />);

  await user.click(screen.getByRole('button', { name: /insert table/i }));
  expect(editor.isActive('table')).toBe(true);
});

test('table-edit buttons are hidden outside a table and shown inside', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  const { rerender } = render(<EditorToolbar editor={editor} />);

  expect(screen.queryByRole('button', { name: /add column/i })).toBeNull();

  await user.click(screen.getByRole('button', { name: /insert table/i }));
  rerender(<EditorToolbar editor={editor} />);
  expect(screen.getByRole('button', { name: /add column/i })).toBeInTheDocument();
});

test('add row increases the table row count', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  render(<EditorToolbar editor={editor} />);

  await user.click(screen.getByRole('button', { name: /insert table/i }));
  const rowsBefore = editor.getJSON().content.find((n) => n.type === 'table').content.length;
  rerender(<EditorToolbar editor={editor} />);
  await user.click(screen.getByRole('button', { name: /add row/i }));
  const rowsAfter = editor.getJSON().content.find((n) => n.type === 'table').content.length;
  expect(rowsAfter).toBe(rowsBefore + 1);
});
```

(Note: the third test references `rerender` — destructure it: `const { rerender } = render(...)`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/EditorToolbar.test.jsx`
Expected: FAIL — no "Insert table" button.

- [ ] **Step 3: Register the table extensions in DocumentEditor**

In `src/components/DocumentEditor.jsx`, add imports:

```javascript
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
```

and add to the `extensions` array (after `Highlight.configure({ multicolor: true })`):

```javascript
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
```

- [ ] **Step 4: Add the table controls to EditorToolbar**

In `src/components/EditorToolbar.jsx`:

(a) Add icon import: add `Table as TableIcon` to the lucide import.

(b) Before the toolbar's closing `</div>`, add:

```jsx
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <Btn label="Insert table" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} /></Btn>
      {editor.isActive('table') && (
        <>
          <button type="button" aria-label="Add column" onClick={() => chain().addColumnAfter().run()} className="h-8 rounded-md px-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Col+</button>
          <button type="button" aria-label="Delete column" onClick={() => chain().deleteColumn().run()} className="h-8 rounded-md px-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Col−</button>
          <button type="button" aria-label="Add row" onClick={() => chain().addRowAfter().run()} className="h-8 rounded-md px-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Row+</button>
          <button type="button" aria-label="Delete row" onClick={() => chain().deleteRow().run()} className="h-8 rounded-md px-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Row−</button>
          <button type="button" aria-label="Toggle header row" onClick={() => chain().toggleHeaderRow().run()} className="h-8 rounded-md px-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">Header</button>
          <button type="button" aria-label="Delete table" onClick={() => chain().deleteTable().run()} className="h-8 rounded-md px-1.5 text-xs font-medium text-red-600 hover:bg-red-50">Delete</button>
        </>
      )}
```

- [ ] **Step 5: Add table styling (screen + print) to index.css**

In `src/index.css`, after the `@theme`/`body` block (outside `@media print`), add:

```css
/* Editor tables */
.tiptap table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
.tiptap th, .tiptap td { border: 1px solid #cbd5e1; padding: 4px 8px; vertical-align: top; }
.tiptap th { background: #f1f5f9; font-weight: 600; }
```

And inside the existing `@media print { … }` block, add (so printed tables keep borders):

```css
  .editor-sheet table, .editor-sheet th, .editor-sheet td { border: 1px solid #94a3b8 !important; }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/components/EditorToolbar.test.jsx`
Expected: PASS, pristine.

- [ ] **Step 7: Run the full suite + commit**

Run: `npm run test` (expected: green, pristine)

```bash
git add src/components/DocumentEditor.jsx src/components/EditorToolbar.jsx src/components/EditorToolbar.test.jsx src/index.css
git commit -m "feat(fe): tables in the editor (insert + edit toolbar, print borders)"
```

---

## Task 3: Task-list checkboxes (TDD)

**Files:**
- Modify: `src/components/DocumentEditor.jsx`
- Modify: `src/components/EditorToolbar.jsx`
- Test: `src/components/EditorToolbar.test.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: TaskList/TaskItem (Task 1).
- Produces: a toolbar **Checklist** toggle (`aria-label="Checklist"`, `toggleTaskList`, `aria-pressed` from `isActive('taskList')`).

- [ ] **Step 1: Write the failing test (append to EditorToolbar.test.jsx)**

Add imports to the test:
```javascript
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
```
Add to `useTestEditor` extensions: `TaskList,` and `TaskItem.configure({ nested: true }),`.

Append:
```javascript
test('checklist button toggles a task list', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  await act(async () => { editor.commands.selectAll(); });
  const user = userEvent.setup();
  render(<EditorToolbar editor={editor} />);

  await user.click(screen.getByRole('button', { name: /checklist/i }));
  expect(editor.isActive('taskList')).toBe(true);
});
```

- [ ] **Step 2: Run → RED**

Run: `npx vitest run src/components/EditorToolbar.test.jsx`
Expected: FAIL — no "Checklist" button.

- [ ] **Step 3: Register + toolbar button**

In `src/components/DocumentEditor.jsx` add imports:
```javascript
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
```
and to the extensions array (after the Table extensions): `TaskList,` and `TaskItem.configure({ nested: true }),`.

In `src/components/EditorToolbar.jsx`, add `ListChecks` to the lucide import, and add a button in the lists group (next to Bullet/Numbered list):
```jsx
      <Btn label="Checklist" active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()}><ListChecks size={16} /></Btn>
```

- [ ] **Step 4: Task-list CSS**

In `src/index.css` (outside print), add:
```css
.tiptap ul[data-type="taskList"] { list-style: none; padding-left: 0; }
.tiptap ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5rem; }
.tiptap ul[data-type="taskList"] li > label { margin-top: 0.2rem; }
```

- [ ] **Step 5: Run → GREEN + commit**

Run: `npx vitest run src/components/EditorToolbar.test.jsx` then `npm run test` (green, pristine)

```bash
git add src/components/DocumentEditor.jsx src/components/EditorToolbar.jsx src/components/EditorToolbar.test.jsx src/index.css
git commit -m "feat(fe): task-list checkboxes in the editor"
```

---

## Task 4: Find & Replace extension (TDD)

**Files:**
- Create: `src/components/extensions/findReplace.js`
- Test: `src/components/extensions/findReplace.test.js`

**Interfaces:**
- Consumes: `@tiptap/core`, `@tiptap/pm/state`, `@tiptap/pm/view`.
- Produces: `FindReplace` extension + exported `searchKey` (PluginKey). Plugin state `{ searchTerm, replaceTerm, caseSensitive, matches:[{from,to}], activeIndex, decorations }`. Commands: `setSearchTerm(t)`, `setReplaceTerm(t)`, `setCaseSensitive(b)`, `findNext()`, `findPrev()`, `replaceCurrent()`, `replaceAll()`, `clearSearch()`. `searchKey.getState(editor.state)` exposes `matches`/`activeIndex` for the UI.

- [ ] **Step 1: Write the failing test**

Create `src/components/extensions/findReplace.test.js`:

```javascript
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FindReplace, searchKey } from './findReplace';

function makeEditor(html) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, FindReplace],
    content: html || '<p>the cat sat on the mat, the cat ran with the dog</p>',
  });
}
const st = (editor) => searchKey.getState(editor.state);

test('setSearchTerm finds all case-insensitive matches', () => {
  const editor = makeEditor();
  editor.commands.setSearchTerm('the');
  expect(st(editor).matches.length).toBe(3);
  editor.destroy();
});

test('case sensitivity narrows matches', () => {
  const editor = makeEditor('<p>The the THE</p>');
  editor.commands.setSearchTerm('the');
  expect(st(editor).matches.length).toBe(3);
  editor.commands.setCaseSensitive(true);
  expect(st(editor).matches.length).toBe(1);
  editor.destroy();
});

test('findNext and findPrev move and wrap the active index', () => {
  const editor = makeEditor();
  editor.commands.setSearchTerm('the');
  expect(st(editor).activeIndex).toBe(0);
  editor.commands.findNext();
  expect(st(editor).activeIndex).toBe(1);
  editor.commands.findPrev();
  editor.commands.findPrev();
  expect(st(editor).activeIndex).toBe(2); // wrapped from 0 → 2
  editor.destroy();
});

test('replaceCurrent replaces only the active match', () => {
  const editor = makeEditor('<p>cat cat cat</p>');
  editor.commands.setSearchTerm('cat');
  editor.commands.setReplaceTerm('dog');
  editor.commands.replaceCurrent();
  expect(editor.getText()).toBe('dog cat cat');
  editor.destroy();
});

test('replaceAll replaces every match in one undo step', () => {
  const editor = makeEditor('<p>cat cat cat</p>');
  editor.commands.setSearchTerm('cat');
  editor.commands.setReplaceTerm('dog');
  editor.commands.replaceAll();
  expect(editor.getText()).toBe('dog dog dog');
  editor.commands.undo();
  expect(editor.getText()).toBe('cat cat cat');
  editor.destroy();
});

test('clearSearch empties the matches', () => {
  const editor = makeEditor();
  editor.commands.setSearchTerm('the');
  editor.commands.clearSearch();
  expect(st(editor).matches.length).toBe(0);
  editor.destroy();
});
```

- [ ] **Step 2: Run → RED**

Run: `npx vitest run src/components/extensions/findReplace.test.js`
Expected: FAIL — cannot resolve `./findReplace`.

- [ ] **Step 3: Write the extension**

Create `src/components/extensions/findReplace.js`:

```javascript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const searchKey = new PluginKey('findReplace');

// Build a flat text string for the doc with a position map back to PM positions.
// A newline separator between blocks prevents matches from crossing block bounds
// and gives each separator a stable anchor position.
function buildIndex(doc) {
  let text = '';
  const map = [];
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text.length; i += 1) {
        text += node.text[i];
        map.push(pos + i);
      }
    } else if (node.isBlock && text.length > 0 && text[text.length - 1] !== '\n') {
      text += '\n';
      map.push(pos);
    }
  });
  return { text, map };
}

function findMatches(doc, term, caseSensitive) {
  if (!term) return [];
  const { text, map } = buildIndex(doc);
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  const matches = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    const from = map[idx];
    const to = map[idx + needle.length - 1] + 1;
    matches.push({ from, to });
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return matches;
}

const INITIAL = {
  searchTerm: '',
  replaceTerm: '',
  caseSensitive: false,
  matches: [],
  activeIndex: 0,
  decorations: DecorationSet.empty,
};

export const FindReplace = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchKey,
        state: {
          init: () => ({ ...INITIAL }),
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(searchKey);
            let next = meta ? { ...value, ...meta } : value;
            if (meta || tr.docChanged) {
              const matches = findMatches(newState.doc, next.searchTerm, next.caseSensitive);
              const activeIndex = matches.length ? Math.min(next.activeIndex, matches.length - 1) : 0;
              const decorations = matches.length
                ? DecorationSet.create(
                    newState.doc,
                    matches.map((m, i) =>
                      Decoration.inline(m.from, m.to, {
                        class: i === activeIndex ? 'search-match search-match--active' : 'search-match',
                      }),
                    ),
                  )
                : DecorationSet.empty;
              next = { ...next, matches, activeIndex, decorations };
            } else if (tr.mapping && value.decorations !== DecorationSet.empty) {
              next = { ...next, decorations: value.decorations.map(tr.mapping, tr.doc) };
            }
            return next;
          },
        },
        props: {
          decorations(state) {
            return searchKey.getState(state).decorations;
          },
        },
      }),
    ];
  },

  addCommands() {
    const setMeta = (patch) => ({ state, dispatch }) => {
      if (dispatch) dispatch(state.tr.setMeta(searchKey, patch));
      return true;
    };
    const gotoIndex = (compute) => ({ state, dispatch }) => {
      const s = searchKey.getState(state);
      if (!s.matches.length) return false;
      const activeIndex = compute(s.activeIndex, s.matches.length);
      if (dispatch) {
        const m = s.matches[activeIndex];
        const tr = state.tr.setMeta(searchKey, { activeIndex });
        tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView();
        dispatch(tr);
      }
      return true;
    };
    return {
      setSearchTerm: (term) => setMeta({ searchTerm: term, activeIndex: 0 }),
      setReplaceTerm: (term) => setMeta({ replaceTerm: term }),
      setCaseSensitive: (caseSensitive) => setMeta({ caseSensitive, activeIndex: 0 }),
      clearSearch: () => setMeta({ searchTerm: '', matches: [], activeIndex: 0 }),
      findNext: () => gotoIndex((i, n) => (i + 1) % n),
      findPrev: () => gotoIndex((i, n) => (i - 1 + n) % n),
      replaceCurrent: () => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        const m = s.matches[s.activeIndex];
        if (!m) return false;
        if (dispatch) dispatch(state.tr.insertText(s.replaceTerm, m.from, m.to));
        return true;
      },
      replaceAll: () => ({ state, dispatch }) => {
        const s = searchKey.getState(state);
        if (!s.matches.length) return false;
        if (dispatch) {
          const tr = state.tr;
          // last → first so earlier positions stay valid as we splice
          [...s.matches].reverse().forEach((m) => tr.insertText(s.replaceTerm, m.from, m.to));
          dispatch(tr);
        }
        return true;
      },
    };
  },
});
```

- [ ] **Step 4: Run → GREEN**

Run: `npx vitest run src/components/extensions/findReplace.test.js`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/components/extensions/findReplace.js src/components/extensions/findReplace.test.js
git commit -m "feat(fe): custom find & replace ProseMirror extension"
```

---

## Task 5: Find/Replace panel + DocumentEditor integration (TDD)

**Files:**
- Create: `src/components/FindReplacePanel.jsx`
- Test: `src/components/FindReplacePanel.test.jsx`
- Modify: `src/components/DocumentEditor.jsx`
- Modify: `src/components/EditorToolbar.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `FindReplace`/`searchKey` (Task 4).
- Produces: `<FindReplacePanel editor onClose />` with `aria-label`s "Find", "Replace", buttons "Previous match"/"Next match"/"Replace"/"Replace all"/"Match case"/"Close find"; shows a count ("3 of 12" / "No results"). `DocumentEditor` registers `FindReplace`, holds `searchOpen`, renders the panel when open, opens it on Ctrl/Cmd-F, and passes `onToggleSearch` to `EditorToolbar`, which renders a **Search** button (`aria-label="Find and replace"`).

- [ ] **Step 1: Write the failing test**

Create `src/components/FindReplacePanel.test.jsx`:

```javascript
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { renderHook } from '@testing-library/react';
import { FindReplace } from './extensions/findReplace';
import FindReplacePanel from './FindReplacePanel';

function useTestEditor() {
  return useEditor({ extensions: [StarterKit, FindReplace], content: '<p>cat cat cat</p>' });
}

test('typing a term shows the match count', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  render(<FindReplacePanel editor={editor} onClose={() => {}} />);

  await user.type(screen.getByLabelText('Find'), 'cat');
  expect(screen.getByText(/1 of 3/i)).toBeInTheDocument();
});

test('Replace all updates the document and reports no results', async () => {
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  render(<FindReplacePanel editor={editor} onClose={() => {}} />);

  await user.type(screen.getByLabelText('Find'), 'cat');
  await user.type(screen.getByLabelText('Replace'), 'dog');
  await user.click(screen.getByRole('button', { name: /replace all/i }));
  expect(editor.getText()).toBe('dog dog dog');
});

test('Close clears the search and calls onClose', async () => {
  const onClose = vi.fn();
  const { result } = renderHook(() => useTestEditor());
  const editor = result.current;
  const user = userEvent.setup();
  render(<FindReplacePanel editor={editor} onClose={onClose} />);

  await user.type(screen.getByLabelText('Find'), 'cat');
  await user.click(screen.getByRole('button', { name: /close find/i }));
  expect(onClose).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run → RED**

Run: `npx vitest run src/components/FindReplacePanel.test.jsx`
Expected: FAIL — cannot resolve `./FindReplacePanel`.

- [ ] **Step 3: Write the panel**

Create `src/components/FindReplacePanel.jsx`:

```jsx
import { useState } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { searchKey } from './extensions/findReplace';

export default function FindReplacePanel({ editor, onClose }) {
  const [term, setTerm] = useState('');
  const [replace, setReplace] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  if (!editor) return null;

  const state = searchKey.getState(editor.state) || { matches: [], activeIndex: 0 };
  const count = state.matches.length;
  const label = count ? `${state.activeIndex + 1} of ${count}` : term ? 'No results' : '';

  const onFind = (v) => { setTerm(v); editor.chain().setSearchTerm(v).run(); };
  const onReplaceChange = (v) => { setReplace(v); editor.chain().setReplaceTerm(v).run(); };
  const toggleCase = () => { const n = !caseSensitive; setCaseSensitive(n); editor.chain().setCaseSensitive(n).run(); };
  const close = () => { editor.chain().clearSearch().run(); onClose(); };

  const inputClass = 'h-8 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500';
  const btnClass = 'h-8 rounded-md px-2 text-xs font-medium text-slate-600 hover:bg-slate-100';

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-sky-100 bg-sky-50 px-3 py-1.5">
      <input aria-label="Find" className={inputClass} placeholder="Find" value={term} onChange={(e) => onFind(e.target.value)} />
      <span className="min-w-[4rem] text-xs text-slate-500">{label}</span>
      <button type="button" aria-label="Previous match" className={btnClass} onClick={() => editor.chain().findPrev().run()}><ChevronUp size={16} /></button>
      <button type="button" aria-label="Next match" className={btnClass} onClick={() => editor.chain().findNext().run()}><ChevronDown size={16} /></button>
      <input aria-label="Replace" className={inputClass} placeholder="Replace with" value={replace} onChange={(e) => onReplaceChange(e.target.value)} />
      <button type="button" className={btnClass} onClick={() => editor.chain().replaceCurrent().run()}>Replace</button>
      <button type="button" className={btnClass} onClick={() => editor.chain().replaceAll().run()}>Replace all</button>
      <button type="button" aria-label="Match case" aria-pressed={caseSensitive} className={`${btnClass} ${caseSensitive ? 'bg-sky-100 text-sky-700' : ''}`} onClick={toggleCase}>Aa</button>
      <button type="button" aria-label="Close find" className={btnClass} onClick={close}><X size={16} /></button>
    </div>
  );
}
```

- [ ] **Step 4: Run → GREEN (panel test)**

Run: `npx vitest run src/components/FindReplacePanel.test.jsx`
Expected: PASS (3/3), pristine. If `act()` warnings appear from typing, the `userEvent.setup()` path should already wrap them; if any remain, wrap the offending interaction in `act()` as in the v2 tests (do not weaken assertions).

- [ ] **Step 5: Wire into EditorToolbar (Search button)**

In `src/components/EditorToolbar.jsx`:
(a) Change the signature to `export default function EditorToolbar({ editor, onToggleSearch }) {`.
(b) Add `Search` to the lucide import.
(c) Add a button in the same group as Insert table:
```jsx
      <Btn label="Find and replace" onClick={() => onToggleSearch?.()}><Search size={16} /></Btn>
```

- [ ] **Step 6: Wire into DocumentEditor**

In `src/components/DocumentEditor.jsx`:
(a) Add imports:
```javascript
import { useState, useEffect } from 'react';
import { FindReplace } from './extensions/findReplace';
import FindReplacePanel from './FindReplacePanel';
```
(replace the existing `import { useState } from 'react';`).
(b) Register `FindReplace` in the extensions array (after the TaskItem line).
(c) Add `const [searchOpen, setSearchOpen] = useState(false);` next to the `page` state.
(d) Add a Ctrl/Cmd-F effect:
```javascript
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
```
(e) Pass the toggle to the toolbar: `<EditorToolbar editor={editor} onToggleSearch={() => setSearchOpen((o) => !o)} />`.
(f) Render the panel at the top of `.editor-chrome` (above the page-setup bar) when open:
```jsx
        {searchOpen && <FindReplacePanel editor={editor} onClose={() => setSearchOpen(false)} />}
```

- [ ] **Step 7: Search-match highlight CSS**

In `src/index.css` (outside print), add:
```css
.search-match { background: #fde68a; border-radius: 2px; }
.search-match--active { background: #f59e0b; color: #1e293b; }
```

- [ ] **Step 8: Full suite + commit**

Run: `npx vitest run src/components/FindReplacePanel.test.jsx src/components/DocumentEditor.test.jsx src/components/EditorToolbar.test.jsx` then `npm run test`
Expected: all green, pristine (v1 `EditorDocument` page tests still pass — the `(content,onChange)` contract is unchanged).

```bash
git add src/components/FindReplacePanel.jsx src/components/FindReplacePanel.test.jsx src/components/DocumentEditor.jsx src/components/EditorToolbar.jsx src/index.css
git commit -m "feat(fe): find & replace panel wired into the editor (toolbar + Ctrl/Cmd-F)"
```

---

## Task 6 (optional): e2e — insert a table + find/replace

**Files:** Modify `e2e/editor.spec.js`

- [ ] **Step 1: Add assertions**

In the existing editor test (after the typing/persist flow), add:
```javascript
  // Tables + find/replace.
  await page.getByRole('button', { name: /insert table/i }).click();
  await expect(page.locator('.tiptap table')).toBeVisible();
  await page.getByRole('button', { name: /find and replace/i }).click();
  await page.getByLabel('Find').fill('Playwright');
  await expect(page.getByText(/1 of 1/i)).toBeVisible();
```

- [ ] **Step 2: Confirm discovery**

Run: `npx playwright test e2e/editor.spec.js --list`
Expected: spec discovered. (Live run deferred.)

- [ ] **Step 3: Commit**

```bash
git add e2e/editor.spec.js
git commit -m "test(e2e): table insert + find/replace in the editor"
```

---

## Self-Review

**Spec coverage:**
- Tables (insert/add-del row+col/toggle header/delete; resizable) → Task 2. ✓
- Task-list checkboxes → Task 3. ✓
- Find & Replace extension (matches, case sensitivity, next/prev wrap, replace, replace-all one-undo) → Task 4. ✓
- Find/Replace panel (find/replace inputs, count, nav, replace/replace-all, match case, close, Ctrl/Cmd-F) → Task 5. ✓
- Highlight decorations + print table borders → Tasks 2/5 (CSS). ✓
- Additive, `(content,onChange)` unchanged, back-compat → verified in Task 5 Step 8. ✓
- Optional e2e → Task 6. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete and self-contained (the find/replace decoration path is inline in the plugin's `apply`, with no dead helpers).

**Type/name consistency:** `FindReplace`/`searchKey`, commands `setSearchTerm/setReplaceTerm/setCaseSensitive/findNext/findPrev/replaceCurrent/replaceAll/clearSearch`, panel aria-labels (`Find`, `Replace`, `Match case`, `Close find`, `Previous match`, `Next match`), toolbar labels (`Insert table`, `Add column`, `Delete column`, `Add row`, `Delete row`, `Toggle header row`, `Delete table`, `Checklist`, `Find and replace`), CSS classes (`search-match`, `search-match--active`) — used identically across tasks. `EditorToolbar` gains an optional `onToggleSearch` prop; existing `<EditorToolbar editor={editor} />` usages stay valid.

**Known limitation (documented in spec):** find/replace matches do not span block boundaries (a `\n` separator is inserted between blocks) and there is no regex — intentional for this batch.
