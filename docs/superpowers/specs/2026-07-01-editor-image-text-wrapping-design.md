# Editor — Image Text Wrapping (design)

Date: 2026-07-01
Scope: frontend-only (SmartJobSearchCRM-FE)
Branch: `feat/editor-image-wrapping`
Builds on the shipped image selection/resize feature.

## Problem

Editor images are block-level only: text always sits above/below them. Users
want Google-Docs-style text wrapping — inline with text, wrap text around
(square), in front of text, and behind text — plus the existing break-text mode.

Goal: support all five wrap modes on editor images, selectable from the image
popup, persisted with the document, and printed correctly.

## Decisions (locked)

- **Approach A — one inline image node + a `wrap` attribute.** The image node
  becomes inline (`inline: true`, `group: 'inline'`) so it lives in paragraph
  text; a `wrap` attribute drives CSS for every mode. (Chosen over keeping the
  block node because it is the only model where "inline" is genuinely inline.)
- Five modes via `wrap`: `inline | break | wrap-left | wrap-right | front | behind`
  (default `break`, which renders identically to today's block image).
- Front/behind are freely draggable; their position is stored as `offsetX` /
  `offsetY` px relative to the page sheet.
- Existing stored documents (ProseMirror JSON, images as top-level block nodes)
  are migrated on load by wrapping top-level image nodes in a paragraph.

## Architecture

Content is stored as ProseMirror JSON (`editor.getJSON()`), autosaved via the
document PATCH. Today's images are `{type:'image'}` nodes that are direct
children of `doc`. Making the image inline changes the schema, so those nodes
are no longer valid at block position — hence the load-time migration.

Units:

### 1. `image.js` — ResizableImage extension

**Schema:**
- `inline: true`, `group: 'inline'` (was block/default).

**Attributes** (added to existing `src`, `alt`, `width`, `height`, `align`):
- `wrap`: enum string, `default: 'break'`. `parseHTML` from `data-wrap`;
  `renderHTML` → `{ 'data-wrap': value }` when not `'break'`.
- `offsetX`: number|null, `default: null`. `parseHTML` from `data-offset-x`
  (parseFloat); `renderHTML` → `{ 'data-offset-x': value }` when set.
- `offsetY`: number|null, `default: null`. Same pattern with `data-offset-y`.

**Commands** (added to existing `setImageWidth/Align/Size`, `resetImageSize`):
- `setImageWrap(mode)` → `updateAttributes('image', { wrap: mode })`. When
  `mode` is not `front`/`behind`, also clears offsets:
  `{ wrap: mode, offsetX: null, offsetY: null }`.
- `setImagePosition({ offsetX, offsetY })` →
  `updateAttributes('image', { offsetX, offsetY })`.

**NodeView** (extends the current 8-handle resize NodeView):
- Wrapper `dom` gains `data-wrap` (and `data-offset-x/y` reflected to style for
  front/behind). Set `dom.style.left/top` from `offsetX/offsetY` when
  `wrap ∈ {front, behind}`.
- Keeps the 8 resize handles + selection ring + dimension badge unchanged.
- Adds a **move drag** for front/behind: a `pointerdown` on the image body
  (not a handle) starts a move that updates `dom.style.left/top` live and
  commits `setImagePosition` on pointer-up (same `setNodeMarkup`-with-attrs
  guard used by resize). Cursor is `move` in those modes. The move listener is
  a no-op when `wrap ∉ {front, behind}`.
- `update()` reflects `wrap`/`offsetX`/`offsetY` changes (sets `data-wrap`,
  `style.left/top`) in addition to the existing width/height/align/src.

### 2. `imageContentMigration.js` — new module

`migrateImageContent(json)`: pure function. Deep-clones the doc JSON and, for
any `image` node that is a direct child of a block container (`doc` or any node
whose content is block-level), replaces it with
`{ type: 'paragraph', content: [imageNode] }`. Returns the normalized doc.
Idempotent (an image already inside a paragraph is left alone).

Consumed by `DocumentEditor.jsx` where `content` is passed to `useEditor`
(currently `DocumentEditor.jsx:65`): pass `migrateImageContent(content)` instead
of the raw `content`.

### 3. `index.css` — wrap-mode styles

- `.editor-sheet { position: relative; }` (anchor for absolute front/behind).
- `.tiptap-image[data-wrap="inline"] { display: inline-block; vertical-align: bottom; }`
- `.tiptap-image[data-wrap="wrap-left"] { float: left; margin: 0 1em 0.5em 0; }`
- `.tiptap-image[data-wrap="wrap-right"] { float: right; margin: 0 0 0.5em 1em; }`
- `.tiptap-image[data-wrap="front"] { position: absolute; z-index: 2; }`
- `.tiptap-image[data-wrap="behind"] { position: absolute; z-index: 0; }`
- Break (default) keeps `display:block` + the existing align-margin rules.
- Ensure text sits above `behind` images: give paragraph/text content
  `position: relative; z-index: 1` within the sheet so `behind` (z-index 0)
  renders under it.
- Print `@media print`: front/behind keep their absolute offset inside
  `.document-print-area`; handles/badge/ring already hidden.

### 4. `ImageOptions.jsx` — popup

- Add a **wrap-mode selector**: 5 icon buttons `[Inline, Break, Wrap, Front,
  Behind]` (lucide icons), each calling `setImageWrap(...)`, with the active
  mode highlighted (`aria-pressed`). "Wrap" maps to `wrap-left`/`wrap-right`
  based on the current align (left→wrap-left, right/none→wrap-right by default;
  the align buttons then switch the side).
- **Align** buttons (L/C/R) remain, shown only when `wrap ∈ {break, wrap-left,
  wrap-right}` (hidden for inline/front/behind, where alignment is meaningless).
- Reset size / Replace / Delete unchanged.

## Data flow

Select mode in popup → `setImageWrap`/`setImagePosition` → attrs update →
NodeView `update()` reflects to DOM → CSS renders the mode. Front/behind drag →
live `style.left/top` → commit `setImagePosition` → autosave PATCH. Reload →
`migrateImageContent` normalizes → attributes restore mode + position. Print →
absolute images render at offset; flow modes flow.

## Error / edge handling

- Migration is idempotent and clones input (never mutates stored JSON).
- `setImageWrap` clears offsets when leaving front/behind so a later
  front/behind starts clean.
- Front/behind drag clamps offsets within the sheet content box.
- Switching an image with a stored width/height into inline keeps its size
  (attrs untouched).
- An image with `wrap: front/behind` but null offsets renders at its anchor
  position (0,0 relative to sheet) until dragged.

## Testing

Unit (Vitest/jsdom):
- `image.test.js`: `wrap`/`offsetX`/`offsetY` attrs round-trip; `setImageWrap`
  sets mode and clears offsets when leaving front/behind; `setImagePosition`
  sets offsets; inline `<img>` parses into inline content; the node is inline
  (`schema.nodes.image.isInline === true`).
- `imageContentMigration.test.js`: top-level image node → wrapped in paragraph;
  image already in a paragraph is untouched; idempotent on re-run; input JSON
  not mutated.
- `ImageOptions.test.jsx`: 5 wrap buttons present and call `setImageWrap`;
  active mode highlighted; align buttons hidden for inline/front/behind.
- Move-drag (pointer) is NOT unit-tested — jsdom limitation, per the existing
  resize convention; covered manually/e2e.

Manual / e2e (Playwright MCP):
- Each of the 5 modes renders correctly; text wraps around wrap-left/right;
  inline image sits in the text line.
- Front/behind: drag repositions; behind sits under text, front over it.
- Reload persists mode + position; existing (pre-migration) docs still load and
  render break images unchanged.
- Print: front/behind at position, flow modes flow, no handles/ring.

## Out of scope (YAGNI)

- Anchor-to-paragraph vs fix-on-page distinction (offsets are sheet-relative).
- Text-tight (contour) wrapping around non-rectangular images.
- Wrap margin/padding controls, "move with text" toggle.
- Multi-column or multi-page absolute anchoring.
- Backend/storage changes.
