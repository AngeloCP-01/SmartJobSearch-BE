# Editor v3 — Tables & Find/Replace — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming complete)
**Scope:** Frontend only — `SmartJobSearchCRM-FE`. Builds on the v1 editor + v2 typography/page-layout. Spec lives in the BE repo `docs/superpowers/` by convention.

## Goal

Add two of the biggest missing Google-Docs editing features — **tables** and **find & replace** — plus **task-list checkboxes**, to move the in-app document editor closer to Google Docs. All frontend; new content (tables, task lists) serializes into the existing TipTap `content` JSON and autosaves via the v1 PATCH. No backend, API, or migration changes.

## Decomposition note

The editor's remaining roadmap (images, signature, templates, DOCX export, comments, real-time collaboration) is deferred. **Images specifically are deferred to v4** because they require a public-URL/storage capability the current backend lacks (all files are private and streamed through an authenticated endpoint; an `<img src>` needs a publicly-fetchable URL). v3 stays purely frontend.

## Scope

- **Tables** — insert a table, add/remove row & column, toggle header row, delete table; columns are resizable.
- **Find & Replace** — a panel (toolbar toggle + Ctrl/Cmd-F) with find + replace inputs, a match count, next/prev navigation, replace-current, replace-all, and a case-sensitivity toggle; matches are highlighted in the document.
- **Task lists** — checkbox lists you can tick.

Deferred from v3 (kept out to bound scope): paragraph-level indent (needs a custom attribute), images (v4), and everything later in the roadmap.

## Dependencies (all TipTap `^2`, to match the existing install)

- `@tiptap/extension-table`, `@tiptap/extension-table-row`, `@tiptap/extension-table-header`, `@tiptap/extension-table-cell`
- `@tiptap/extension-task-list`, `@tiptap/extension-task-item`

**Find & Replace** is a **custom ProseMirror extension** (TipTap v2 has no official one), consistent with the existing `FontSize` / `PageDocument` custom extensions and avoiding an unmaintained external dependency.

## Components & extensions

### Tables
Register `Table.configure({ resizable: true })` + `TableRow` + `TableHeader` + `TableCell` in `DocumentEditor`. New toolbar group:
- **Insert table** (inserts a default 3×3 with a header row).
- **Add column before/after**, **Delete column**, **Add row before/after**, **Delete row**, **Toggle header row**, **Delete table** — each enabled only when the selection is inside a table (gated on `editor.can()….run()` / `editor.isActive('table')`), reusing the v1 `Btn` disabled pattern. To keep the toolbar uncluttered, table-edit actions live in a compact set shown when in a table (the Insert-table button is always present).
Print CSS gains minimal table borders so printed tables render with visible cell borders.

### Task lists
`TaskList` + `TaskItem.configure({ nested: true })`; a toolbar **Checklist** toggle (`toggleTaskList`), with `aria-pressed` from `isActive('taskList')`. Checkbox interactivity is the extension's built-in rendering.

### Find & Replace extension — `src/components/extensions/findReplace.js`
A TipTap `Extension` wrapping a single ProseMirror plugin:
- **Plugin state:** `{ searchTerm, replaceTerm, caseSensitive, matches: [{from, to}], activeIndex }`.
- **Decorations:** an inline `Decoration` over every match (class `search-match`) and a distinct class (`search-match--active`) on the active one. Recomputed when the term, case flag, or doc changes (in the plugin `apply`).
- **Commands:** `setSearchTerm(term)`, `setReplaceTerm(term)`, `setCaseSensitive(bool)`, `findNext()`, `findPrev()` (wrap around; move the active index and scroll/select it), `replaceCurrent()` (replace the active match, then advance), `replaceAll()`, `clearSearch()`.
- **Matching:** plain-text substring search over the document's text content with offset mapping back to ProseMirror positions; case-insensitive by default, exact when `caseSensitive`. (No regex — out of scope.)

### Find/Replace panel — `src/components/FindReplacePanel.jsx`
Rendered in `DocumentEditor`'s chrome, hidden by default. Toggled by a toolbar **Search** button and by Ctrl/Cmd-F (a `keydown` handler on the editor wrapper that prevents the browser's native find). Contains: a find `<input aria-label="Find">`, a replace `<input aria-label="Replace">`, a match count ("3 of 12" / "No results"), **Previous**/**Next** buttons, **Replace**/**Replace all** buttons, a **Match case** toggle, and a **Close** button. Wired to the extension commands; reads match count + active index from the extension's plugin state via the editor.

### DocumentEditor integration
`DocumentEditor` registers the new extensions, adds the table + checklist + search controls to the toolbar (via `EditorToolbar`), holds the `searchOpen` UI state, renders `FindReplacePanel` when open, and adds the Ctrl/Cmd-F handler. The `(content, onChange)` contract is unchanged.

## Data flow & back-compat

Tables and task lists are ordinary nodes serialized by `editor.getJSON()` → autosaved by the existing debounced PATCH (unchanged). Find/replace is transient editor/plugin state — nothing is persisted. v1/v2 documents are unaffected (purely additive extensions; their content still parses).

## Error handling & edge cases

- Table-edit commands are disabled outside a table, so they can't be misapplied.
- Find with an empty term clears matches and shows no count; replace/replace-all are no-ops with no matches.
- `replaceAll` runs in a single transaction (one undo step). `replaceCurrent` advances to the next match (or clears if none remain).
- Matches that span multiple text nodes/marks are handled by mapping plain-text offsets to ProseMirror positions; matches inside table cells are included.

## Testing

- **Tables (real editor):** Insert-table creates a `table` node with the expected rows/cols; add-column/add-row change dimensions; toggle-header switches header cells; table-edit toolbar buttons are disabled when the selection is outside a table and enabled inside.
- **Task list:** the Checklist toggle inserts a `taskList`/`taskItem`; `isActive('taskList')` reflects state.
- **Find & Replace extension (real editor, headless):** `setSearchTerm` populates `matches` + count; `findNext`/`findPrev` move and wrap the active index; `replaceCurrent` replaces one occurrence and advances; `replaceAll` replaces every occurrence in one undo step; `caseSensitive` changes which matches are found.
- **Find/Replace panel (component):** typing a term shows the count; Next/Prev update the active indicator; Replace All updates the document text; Close hides the panel; Ctrl/Cmd-F opens it.
- **Pristine output:** reuse the v2 approach (`userEvent.setup()`, `act()`-wrapped editor commands). Minimal print CSS verified by class assertions.
- **Optional e2e:** extend `e2e/editor.spec.js` to insert a table and run a find/replace, confirming persistence/behavior (discovered; live run deferred).

## Out of scope (later editor versions)

Images (v4), paragraph indent, regex find, table cell merge / row-column background colors, templates, DOCX export, comments, real-time collaboration.
