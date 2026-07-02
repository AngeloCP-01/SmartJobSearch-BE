# Editor — Image Drag Positioning (remove align, drag-to-place) design

Date: 2026-07-02
Scope: frontend-only (SmartJobSearchCRM-FE)
Branch: `feat/editor-image-wrapping` (continues the image text-wrapping work)
Builds on the image text-wrapping feature (inline node, `wrap` modes, front/behind free-drag).

## Problem

Image horizontal placement is driven by discrete Align (left/center/right)
buttons in the popup. The user wants a Google-Docs-like feel: drop the align
buttons and position images by dragging. For wrap mode, the image should anchor
where you drop it and text should wrap around it.

Constraint acknowledged up front: true arbitrary-pixel text wrap needs a custom
layout engine (Google Docs renders text to a canvas; CSS Exclusions is
unsupported). This design delivers the achievable equivalent — **anchor-based
float wrap**: dragging re-anchors the image to the nearest text position and
snaps it to a column side, with CSS handling the wrap.

## Decisions (locked)

- **Remove the Align (L/C/R) buttons** from the image popup. The 5-mode selector
  (In line / Break / Wrap / In front / Behind) stays.
- **Positioning is drag-driven**, mode-appropriate:
  - **Wrap**: drag → the image re-anchors to the document position nearest the
    drop point (vertical) and snaps to the **left or right** side of the column
    (by drop x); text wraps around it.
  - **Break**: block figure, **centered by default** (align removed); drag
    re-anchors it to a new text position (vertical only).
  - **In line**: unchanged — moves within the text like a character.
  - **In front / Behind**: unchanged — absolute free-drag anywhere (`offsetX`/
    `offsetY`), over/under text.
- The `align` attribute and `setImageAlign` command are **retained** (so
  existing documents still parse and the attribute unit tests stay green) but are
  no longer surfaced in the UI. Break centering is done in CSS, independent of
  `align`.

## Architecture

Two positioning interactions now exist on the image NodeView, dispatched by the
current `wrap` value:

1. **Absolute move** (existing) — `wrap ∈ {front, behind}` — drags update
   `offsetX`/`offsetY`. Unchanged.
2. **Reposition move** (new) — `wrap ∈ {inline, break, wrap-left, wrap-right}` —
   drags move the image node to a new position in the document, and for wrap
   modes also set the float side.

### 1. `image.js` — NodeView reposition drag + side helper

- A new pure helper (exported for testing), e.g. `sideForX(clientX, rect)` →
  `'wrap-left' | 'wrap-right'` based on whether the drop x is left/right of the
  element's containing-column midpoint.
- A new NodeView drag routine `startReposition(e)` active when
  `wrap ∈ {inline, break, wrap-left, wrap-right}`:
  - On pointer-down on the image body (handles still `stopPropagation`), begin
    tracking; suppress the browser's native image drag.
  - During the drag, show a **drop caret** — a lightweight absolutely-positioned
    element (not ProseMirror's dropcursor, which only reacts to native HTML5
    drag, not our pointer drag) placed at the document position under the
    pointer, computed via `editor.view.posAtCoords({ left, top })` +
    `editor.view.coordsAtPos(pos)` to get the caret's screen rect.
  - On pointer-up (only if the pointer actually moved — reuse the `moved` gate):
    resolve the target position via `posAtCoords`; move the image node from
    `getPos()` to the target in one transaction; for wrap modes set
    `wrap: sideForX(...)`. Restore the NodeSelection on the moved node (same
    inline-NodeSelection pattern used elsewhere).
  - A plain click (no move) selects only — no document change.
- Node move is done via a small pure command builder,
  `repositionImageNode(state, fromPos, toPos, attrsPatch)`, returning a
  transaction that deletes the node at `fromPos` and inserts it (with patched
  attrs) at the mapped `toPos`. Exported for unit testing.
- The absolute-move routine for front/behind is unchanged; `startMove` and
  `startReposition` are selected by mode at pointer-down.

### 2. `ImageOptions.jsx` — remove align

- Delete the Align L/C/R buttons and the `showAlign`/`isWrap`/`setAlign`/
  `align` logic. Keep the 5 wrap-mode buttons, Reset size, Replace, Delete.
- "Wrap" button: if the image is already `wrap-left`/`wrap-right`, keep its
  side; otherwise default to `wrap-left` (drag then changes the side).

### 3. `index.css`

- `.tiptap-image[data-wrap="break"] { margin-left: auto; margin-right: auto; }`
  — center break figures by default.
- Remove the three `.tiptap-image[data-align="..."]` positioning rules (align is
  no longer a user control; break is centered, wrap uses float, others don't use
  align).
- Wrap float rules gain `shape-outside: margin-box;` so text hugs the image with
  the existing margin as the gap:
  - `.tiptap-image[data-wrap="wrap-left"] { float: left; margin: 0 1em .5em 0; shape-outside: margin-box; }`
  - `.tiptap-image[data-wrap="wrap-right"] { float: right; margin: 0 0 .5em 1em; shape-outside: margin-box; }`
- Drop-caret style (if a custom caret is used): a 2px sky-blue vertical bar,
  `pointer-events: none`, hidden except during a reposition drag; hidden in
  `@media print`.

## Data flow

Reposition drag → `posAtCoords` target + `sideForX` → `repositionImageNode`
transaction (move node, patch `wrap`) → autosave persists node position + wrap →
reload restores placement (position IS the anchor; no offset attrs for wrap).
Front/behind still persist via `offsetX`/`offsetY`. Break centering and wrap
float are pure CSS off `data-wrap`.

## Error / edge handling

- `posAtCoords` can return null (drop outside the editor) → abort the move,
  leave the image where it was.
- Dropping onto the image's own current position is a no-op.
- Moving must not place the image inside itself or an invalid position — map
  through the delete step (`tr.mapping`) and clamp to a valid inline position;
  if invalid, abort.
- A plain click never moves the node (the `moved` gate).
- Reset size / mode switches behave as before; switching to front/behind still
  clears offsets appropriately.

## Testing

Unit (Vitest/jsdom):
- `sideForX` returns `wrap-left` for x left of midpoint, `wrap-right` for right.
- `repositionImageNode` moves the image node from one position to another and
  applies the attrs patch (e.g. `wrap: 'wrap-right'`); the document round-trips
  with the image at the new position.
- `ImageOptions.test.jsx`: Align buttons are gone; wrap-mode buttons + reset/
  replace/delete remain; "Wrap" defaults to `wrap-left` when not already
  wrapping.
- The pointer drag itself (drop-caret, posAtCoords hit-testing) is NOT
  unit-tested — jsdom has no layout; verified manually/e2e per the existing
  convention.

Manual / e2e (Playwright MCP):
- Wrap: drag an image; it re-anchors near the drop and snaps to the nearer side;
  text wraps around it; reload persists the anchor + side.
- Break: centered by default; drag moves it to a new text anchor.
- In line / front / behind unchanged; front/behind still free-drag absolute.
- No Align buttons anywhere in the popup.
- Print: wrap/break/inline flow; front/behind at offset; no caret/handles/ring.

## Out of scope (YAGNI)

- Arbitrary-pixel horizontal wrap position (left/right snap only).
- Contour/tight wrap around non-rectangular images beyond `shape-outside: margin-box`.
- Per-image wrap margin controls, distance-from-text settings.
- Removing the `align` attribute/command from the schema (retained for compat).
- Backend/storage changes.
