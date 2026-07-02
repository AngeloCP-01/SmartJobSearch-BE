# Editor — Image Free-Placement Mode Labels design

Date: 2026-07-02
Scope: frontend-only (SmartJobSearchCRM-FE)
Branch: `feat/editor-image-wrapping` (continues the image work)
Builds on the image drag-positioning feature.

## Problem

Users expect dragging an image to drop it exactly where they release it ("free
placement anywhere, like Google Docs"). When they try this in **Wrap** mode the
image snaps to the left/right margin, which feels wrong. The snap is inherent to
CSS `float` (the only way text can flow around an image), and cannot be removed
without losing text-wrap.

The free-placement behavior they want already exists: the **In front of text**
mode is absolutely positioned and drops exactly at the cursor (drag writes
`offsetX`/`offsetY`). The real problem is discoverability — that mode isn't named
or ordered in a way that signals "this is the drag-anywhere mode."

## Decisions (locked)

- No new drag mechanics. Free-drop already works for the absolute modes
  (`front`, `behind`); wrap keeps its float+side-snap; inline/break keep in-flow
  node-move. `image.js` is NOT changed.
- Reframe the popup so free placement is the obvious path:
  - Rename **In front of text** → **Over text** (the drag-anywhere, on-top mode).
  - Rename **Wrap text** → **Wrap around** (the explicit text-flows-around mode
    that snaps to a side by CSS necessity).
  - Rename **Break text** → **Break**.
  - Reorder the buttons to: **In line · Over text · Behind text · Wrap around ·
    Break**.
- Underlying `wrap` attribute values are unchanged: `inline | break | wrap-left |
  wrap-right | front | behind`. Only button labels/titles/order change; "Over
  text" maps to `front`, "Behind text" to `behind`, "Wrap around" to
  `wrap-left`/`wrap-right` (side chosen as today: keep current side if wrapping,
  else default `wrap-left`).

## Architecture

Single unit of change: `src/components/ImageOptions.jsx` — the `WRAP_MODES`
table (labels, icons, order) and any label-dependent tests. The drag routines,
CSS, commands, and attributes are untouched.

`WRAP_MODES` becomes (order = display order):

| label | mode key | icon (lucide) | maps to `wrap` |
|---|---|---|---|
| In line | `inline` | `Type` | `inline` |
| Over text | `front` | `BringToFront` | `front` |
| Behind text | `behind` | `SendToBack` | `behind` |
| Wrap around | `wrap` | `WrapText` | `wrap-left`/`wrap-right` |
| Break | `break` | `Rows3` | `break` |

`applyWrap`/`wrapActive` logic is unchanged except that the `mode` key for the
former "In front of text" button is `front` (a direct `setImageWrap('front')`,
already handled), and the "Wrap around" button keeps the `mode === 'wrap'`
resolution to a side.

## Data flow

Unchanged. Clicking a mode calls `setImageWrap(...)`; dragging an Over-text/
Behind image writes `offsetX`/`offsetY` (free placement); dragging a Wrap-around
image moves the node + snaps side; inline/break move the node in flow. Persist
and print behavior unchanged.

## Error / edge handling

Unchanged — no new code paths.

## Testing

Unit (Vitest/jsdom): update `ImageOptions.test.jsx` label expectations —
- the five buttons are now `In line`, `Over text`, `Behind text`, `Wrap around`,
  `Break`;
- clicking **Over text** sets `wrap` to `front`;
- clicking **Wrap around** sets a `wrap-left`/`wrap-right` value;
- no Align buttons (regression guard stays).

Manual / e2e (Playwright MCP):
- Popup shows the five relabeled modes in the new order; no Align buttons.
- **Over text**: drag the image anywhere → it stays exactly where released, on
  top of the text.
- **Behind text**: same, behind the text.
- **Wrap around**: text flows around; drag snaps to the nearer side (documented
  behavior).
- In line / Break unchanged.

## Out of scope (YAGNI)

- Any new drag mechanics or free-x-position-with-wrap (CSS-infeasible; already
  decided).
- Changing the `wrap` attribute value set or the extension/commands.
- Making a non-default insertion mode.
- Backend/storage changes.
