# Editor v2 — Typography & Page Layout — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorming complete)
**Scope:** Frontend only — `SmartJobSearchCRM-FE`. Builds on the v1 in-app document editor (`DocumentEditor` / `EditorToolbar`, route `/editor` + `/editor/:id`). Spec lives in the BE repo `docs/superpowers/` alongside the v1 editor spec, by convention.

## Goal

Make authored documents look like real résumés / cover letters — add **font family**, **font size**, **text color & highlight**, and a **paper-style page canvas** (page size + margins) that matches print. The first batch of the v1 editor's post-v1 roadmap.

## Key decisions

- **Fully frontend.** No backend, API, or Prisma changes. Inline formatting is stored as marks in the existing TipTap `content` JSON; page settings are stored as attributes on the ProseMirror root `doc` node, so they ride inside the same `content` field and autosave for free via the existing `PATCH /authored-documents/:id`.
- **Paper-style canvas, not WYSIWYG pagination.** The editor renders as a single page-width "sheet" with margins as padding; print uses a matching `@page` rule. No live page-break rendering (true multi-page pagination in TipTap is large and fragile — explicitly out of scope).
- **Back-compatible.** v1 documents have no page attributes and no font/size/color marks; they default to Letter + Normal margins + the base font. No data migration.
- **TipTap v2** (already pinned `^2.27.2` from v1). Font size has no official v2 extension → a small custom extension is added on top of TextStyle.

## New dependencies

- `@tiptap/extension-text-style` (TextStyle mark — base for color/font-family/font-size)
- `@tiptap/extension-font-family`
- `@tiptap/extension-color`
- `@tiptap/extension-highlight`

(No font-size package — a custom extension is added; see below.) All pinned to the `^2` line to match the existing TipTap install.

## Components & extensions

### Inline marks (stored in `content` JSON, no schema change)

- **Font family** — `FontFamily` extension (depends on `TextStyle`). Curated list:
  - Web-safe: Arial, Helvetica, Georgia, Times New Roman, Garamond, Verdana, Courier New.
  - Google Fonts: Inter, Lato, Merriweather — loaded via `<link>` tags in `index.html` (alongside the existing Plus Jakarta Sans preconnect).
  - Each option applies a CSS font stack (e.g. `'Times New Roman', Times, serif`).
- **Font size** — custom `FontSize` extension extending `TextStyle` to support a `fontSize` attribute (renders/parses `style="font-size: …"`), with commands `setFontSize(size)` / `unsetFontSize()`. Sizes offered (points): **8, 9, 10, 10.5, 11, 12, 14, 16, 18, 24, 36**. Default (unset) inherits the canvas base size.
- **Text color** — `Color` extension (on TextStyle); command `setColor(hex)` / `unsetColor()`.
- **Highlight** — `Highlight` extension configured `multicolor: true`; command `toggleHighlight({ color })` / `unsetHighlight()`.

### Document-level page settings (custom `Document` node extension)

- Override the StarterKit `Document` node (configure StarterKit with `document: false` and register a custom `Document` extension that `addAttributes()` for:
  - `pageSize`: `'Letter'` (default) | `'A4'`
  - `margin`: `'Normal'` (default, 1in) | `'Narrow'` (0.5in) | `'Wide'` (1.5in)
- These attributes serialize into the doc JSON (`{ type: 'doc', attrs: { pageSize, margin }, content: [...] }`).
- A command `setPageSettings({ pageSize?, margin? })` sets the root node's attributes via a transaction (`tr.setNodeMarkup(0, undefined, { ...attrs })`), marked so it participates in undo/history and triggers `onUpdate` (→ autosave).

### UI

- **Toolbar additions (`EditorToolbar`):** a second control group (the toolbar already wraps): **Font family ▾**, **Size ▾**, **Text color** (swatch button → small preset palette + custom hex input), **Highlight** (swatch button → preset palette + clear). Reuse the v1 `Btn` pattern, `aria-label`s, and active-state styling. Dropdowns reflect the current selection's active mark.
- **Page setup (document header, not the inline toolbar — it's document-level):** two small `<select>`s ("Page: Letter/A4", "Margins: Normal/Narrow/Wide") placed in the `EditorDocument` header near the title/Print button. They read the current doc-node attributes and call `setPageSettings`.

### Paper canvas + print

- The editable area is wrapped so it renders as a centered **sheet**: `width` = the page size (Letter `8.5in`, A4 `210mm`), `padding` = the margin preset, on a gray page backdrop, with a subtle shadow — reading like paper. The wrapper reads the doc-node `pageSize`/`margin` attributes (via the editor) and maps them to width/padding.
- The `.document-print-area` wrapper from v1 is reused. Print CSS gains per-size `@page { size: …; margin: 0 }` plus the sheet padding so the printed PDF matches the on-screen margins. The toolbar stays hidden in print (existing rule).

## Data flow

User picks a font/size/color/highlight on a selection → TipTap command sets the mark → `onUpdate` fires → `DocumentEditor` `onChange(editor.getJSON())` → debounced autosave PATCH (v1 mechanism, unchanged). Page setup select → `setPageSettings` updates the doc-node attrs → same `onUpdate` → autosave. On load, the editor seeds from `content`; missing attributes/marks fall back to defaults.

## Error handling & edge cases

- Documents authored in v1 (no `attrs` on the doc node) → custom `Document` extension supplies attribute defaults (Letter/Normal), so they render correctly and gain explicit attrs on first edit.
- Invalid/empty color input is ignored (no command run); clearing color/highlight uses the unset commands.
- Autosave failure and empty-title handling are unchanged from v1 (already guarded).

## Testing

- **Component tests (Vitest + real TipTap editor, jsdom):**
  - Font family: selecting a font runs `setFontFamily`; `editor.getAttributes('textStyle').fontFamily` reflects it.
  - Font size: `setFontSize('14pt')` applies; `unsetFontSize()` clears.
  - Color & highlight: commands apply/remove marks; `editor.isActive('highlight')` toggles.
  - Page settings: `setPageSettings({ pageSize: 'A4', margin: 'Wide' })` updates `editor.state.doc.attrs`; the canvas wrapper's width/padding style/class updates accordingly.
- **Print/canvas:** assert the sheet wrapper applies the correct width/padding class for each page size + margin (jsdom inspects the rendered style/class).
- **Pristine output:** reuse v1's `userEvent.setup()` + `act()`-wrapped editor command approach.
- **Optional e2e:** extend `e2e/editor.spec.js` (or a new spec) to set a font + page size and confirm both persist across reload.

## Out of scope (future editor versions)

Signature & image insertion, tables, find & replace, templates, DOCX export, comments, real-time collaboration, free numeric/custom margins, custom page sizes, and live multi-page pagination.
