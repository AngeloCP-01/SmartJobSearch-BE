# Editor — Image Selection & Free Resize (design)

Date: 2026-07-01
Scope: frontend-only (SmartJobSearchCRM-FE)
Branch: continues `feat/editor-image-options-popup`
Supersedes the Small/Medium/Full preset UI from the image-options popup.

## Problem

When an image is clicked in the document editor it does not visually read as
selected — the only affordance is the floating options popup. There is a
free-drag resize handle in the code (a single always-on 12×12 dot at the
bottom-right), but it is undiscoverable and never signals selection. Sizing is
driven by three coarse presets (Small / Medium / Full) that the user finds
limiting.

Goals:
1. A clear selection state for images (border ring + handles), independent of
   the popup.
2. Free-form resizing via Google-Docs-style handles, replacing the presets.

## Decisions (locked)

- **8 resize handles**, shown only when the image is selected: 4 corners + 4
  edge-midpoints.
  - **Corners**: aspect-locked (width & height scale from the natural ratio).
  - **Edges**: distortable — left/right stretch width only, top/bottom stretch
    height only (true Google-Docs behavior).
- **Selection ring**: 2px solid sky-blue (`#0284c7`) around the selected image.
- **Live dimension badge**: while dragging, a small `W × H` pill follows the
  pointer.
- **Popup**: remove Small/Medium/Full; **add "Reset size"** (↺) that clears the
  stored dimensions back to natural size. Align + Replace + Delete stay.
- The current always-on bottom-right handle is removed; handles are now tied to
  selection.

## Architecture

Three units, each independently understandable/testable:

### 1. `image.js` — ResizableImage extension (data + node view)

**Attributes** — add `height` alongside the existing `width`:
- `width`: existing behavior (parse `style.width` / `width` attr; render as
  `style: width: …`).
- `height`: NEW. Parse `style.height` / `height` attr; render as
  `style: height: …` when present. `default: null`.
- `align`: unchanged.

**Commands**:
- `setImageWidth(width)` — kept (used by corner/edge width math + backward compat).
- `setImageAlign(align)` — kept.
- `setImageSize({ width, height })` — NEW. Sets both attributes in one
  `updateAttributes` call (used at the end of a drag).
- `resetImageSize()` — NEW. `updateAttributes(name, { width: null, height: null })`.

**NodeView** (`addNodeView`) — replaces the single-handle version:
- Wrapper `div.tiptap-image` containing the `<img>` (unchanged base markup).
- Toggle `dom.dataset.selected` from the NodeView `selected` flag so CSS can show
  the ring + handles only when selected. (TipTap re-renders the node view and
  passes `selected`; also mirrors `ProseMirror-selectednode`.)
- Render 8 handle spans with a `data-handle` value:
  `nw, n, ne, e, se, s, sw, w`. Each is `contentEditable=false`.
- One shared pointer-drag routine keyed by which handle started the drag:
  - Capture `startX/startY`, starting box `rect`, and natural aspect ratio
    (`img.naturalWidth / img.naturalHeight`).
  - **Corner** handle → compute new width from `dx` (sign depends on which
    corner), derive height from the natural ratio. Anchor the opposite corner.
  - **Edge** handle → `e`/`w` change width only; `n`/`s` change height only.
  - Apply live to `dom.style.width` / `dom.style.height` (px) during move; show
    the dimension badge.
  - On pointer-up, persist via `setNodeMarkup` at `getPos()` writing
    `{ width: '<px>px', height: '<px>px' }` (only the axes that changed; corner
    writes both). Reuse the existing `state.doc.nodeAt(pos)?.attrs` guard so we
    never clobber concurrent attrs.
  - Bounds: min 40px per axis; max width clamped to the editor content width
    (wrapper `max-width: 100%` already enforces visual max; we also clamp the
    stored px so it never exceeds the column).
  - `destroy()` removes any window listeners mid-drag (as today).

**jsdom caveat**: pointer-drag stays manually / e2e verified (documented in the
file header, as it is today). Attribute commands are unit-tested.

### 2. `index.css` — selection & handle styling

- `.tiptap-image[data-selected="true"]` → `outline: 2px solid #0284c7;
  outline-offset: 2px;` (ring).
- `.tiptap-image__handle` → base handle: 10px white square, 1.5px `#0284c7`
  border, `border-radius: 2px`, `position: absolute`, `display: none`.
- Show handles only when selected:
  `.tiptap-image[data-selected="true"] .tiptap-image__handle { display: block; }`
- Position each handle by `data-handle` (nw/n/ne/e/se/s/sw/w) at the correct
  edge/corner with the right resize cursor (`nwse-resize`, `nesw-resize`,
  `ew-resize`, `ns-resize`).
- `.tiptap-image__dim` → the drag dimension badge: small dark pill, white text,
  `position: fixed`, `pointer-events: none`, hidden unless dragging.
- Print `@media print`: hide `.tiptap-image__handle`, the ring
  (`outline: none`), `.tiptap-image__dim`, `.image-options`, `[data-tippy-root]`
  (extends the existing print rule).

### 3. `ImageOptions.jsx` — popup

- Delete the `SIZES` array and the three preset buttons.
- Add a **Reset size** button (lucide `RotateCcw`, label "Reset size",
  `title="Reset to original size"`) → `chain().resetImageSize().run()`.
- Keep align (L/C/R), the divider, Replace, Delete. Layout:
  `[◧ ◨ ◪] | [↺ Reset size] | [⟳ Replace] [🗑]`.

## Data flow

Drag → NodeView updates DOM live + shows badge → pointer-up commits
`setNodeMarkup(width,height)` → TipTap doc changes → DocumentEditor autosave
(existing) PATCHes the document → reload/print render from stored `width/height`
inline styles (parsed back by `parseHTML`). No backend changes: `width`/`height`
ride along in the serialized HTML/JSON exactly as `width` does today.

## Error / edge handling

- Missing `naturalWidth` (image not yet loaded) → fall back to current rendered
  box for ratio; corner drag still works off the live box.
- Min clamp 40px prevents zero/negative sizes.
- Reset clears both attrs so the image returns to intrinsic size.
- Concurrent-attr guard on commit (existing pattern) avoids clobbering align.
- Replace keeps current size attrs (only `src` changes), consistent with today.

## Testing

Unit (Vitest/jsdom):
- `image.test.js`: `setImageSize` sets width+height; `resetImageSize` nulls both;
  `height` attribute parse/render round-trips; existing width/align tests stay
  green.
- `ImageOptions.test.jsx`: presets removed (no Small/Medium/Full), Reset-size
  button present and calls `resetImageSize`; align/replace/delete unchanged.
- Full suite must stay pristine.

Manual / e2e (Playwright MCP, dev server):
- Click image → ring + 8 handles appear; deselect → they disappear.
- Corner drag resizes proportionally; edge drag distorts one axis; badge shows.
- Reset size returns to natural size.
- Reload persists size; print hides handles/ring/badge.

## Out of scope (YAGNI)

- Rotation, crop, alt-text editing, captions.
- Numeric width/height input fields (drag + reset covers the ask).
- Aspect-lock toggle / shift-key modifier.
- Backend/storage changes.
