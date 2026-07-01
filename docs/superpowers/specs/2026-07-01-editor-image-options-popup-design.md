# Editor — Image Options Popup + Toolbar Tooltips — Design

**Date:** 2026-07-01
**Status:** Approved (brainstorming complete)
**Scope:** Frontend only — `SmartJobSearchCRM-FE`. Polishes the v4 image feature. Spec lives in the BE repo `docs/superpowers/` by convention.

## Goal

When an image is selected in the editor, show a floating **image options popup** (Google-Docs style) next to it with **align, size, replace, delete** — instead of image-align buttons sitting in the main toolbar (where they duplicated the text-align icons and confused users). Also add **hover tooltips** to all toolbar icon buttons so their purpose is clear.

## Problems this solves

1. The image-align buttons live in the main toolbar and use the **same icons** as text-align, with **no hover hint** — indistinguishable and confusing (user-reported).
2. Image options aren't discoverable in one place.

## Approach

### Floating popup via TipTap BubbleMenu
Use TipTap's **BubbleMenu** (`@tiptap/react`'s `BubbleMenu`, backed by `@tiptap/extension-bubble-menu`) — a menu that floats anchored to the current selection. Configure it to show only when an image node is selected. Split into two units so the logic is testable independently of the (jsdom-untestable) floating/positioning:

- **`ImageOptions` component** — renders the option buttons and calls editor commands. Pure, unit-testable (render with a real editor that has an image node-selected, click, assert attrs/deletion).
- **BubbleMenu wrapper** in `DocumentEditor`: `<BubbleMenu editor={editor} shouldShow={({ editor }) => editor.isActive('image')}><ImageOptions editor={editor} /></BubbleMenu>`. The floating/positioning is verified manually / via Playwright (jsdom can't measure layout — same as the drag-resize handle).

### Popup contents (`ImageOptions`)
Each button has an `aria-label` (tests + a11y) **and** a `title` (hover tooltip):
- **Align:** "Align image left / center / right" → `setImageAlign('left'|'center'|'right')`; active state from `editor.isActive('image', { align })`.
- **Size:** "Small (25%)" / "Medium (50%)" / "Full width" → `setImageWidth('25%'|'50%'|'100%')`. The drag-resize handle on the image remains for custom sizes.
- **Replace image** → a hidden `<input type="file" accept="image/*">` → `uploadImage(file)` (existing `src/api/images.js`) → `editor.chain().focus().updateAttributes('image', { src: url }).run()`.
- **Delete image** → `editor.chain().focus().deleteSelection().run()`.

### Toolbar tooltips + de-duplication
- **`Btn` component (`EditorToolbar.jsx`):** add `title={label}` so every icon button shows a native hover tooltip (it currently has only `aria-label`). This gives Bold/Italic/headings/lists/link/**text-align**/undo/redo/etc. hover hints.
- **Remove the image-align buttons** from the main toolbar (they move to the popup). This eliminates the duplicate-align-icon confusion — the main toolbar's align icons are now unambiguously *text* alignment.
- The **"Insert image"** button stays in the main toolbar (with its existing tooltip).

## Components & files

- **Dependency:** `@tiptap/extension-bubble-menu@^2` (pinned to the TipTap v2 line).
- **Create:** `src/components/ImageOptions.jsx` (+ `ImageOptions.test.jsx`).
- **Modify:** `src/components/EditorToolbar.jsx` — add `title={label}` to `Btn`; remove the `editor.isActive('image')` align-button block. (+ update `EditorToolbar.test.jsx`: drop the "align-image buttons appear when image selected" assertions from the toolbar; keep the Insert-image test.)
- **Modify:** `src/components/DocumentEditor.jsx` — import + render `<BubbleMenu>` with `<ImageOptions>`; register the BubbleMenu extension if required by the installed version.
- **Modify:** `src/index.css` — popup container styling (rounded, shadow, white bg, button row); hide the popup in print.

No changes to `ResizableImage` (its `setImageAlign`/`setImageWidth` commands + built-in `updateAttributes`/`deleteSelection` cover everything).

## Data flow

Selecting an image → `editor.isActive('image')` true → BubbleMenu shows `ImageOptions` anchored to it. Clicking a button runs a command → the doc updates → `onChange`/autosave persist it (unchanged). Replace uploads via the existing image API then swaps the `src` attribute.

## Error handling & edge cases

- Replace upload failure → surfaced (reuse the toolbar's `window.alert('Could not upload the image.')` pattern) with no change to the node.
- Size presets are `%` of the page width; the drag handle still allows px sizing (mixed units are fine — `width` is a free string).
- Delete removes the node-selected image; the popup hides (no image active).
- Popup is hidden in print via CSS.

## Testing

- **`ImageOptions` (real editor, image node-selected via `setImage` + `setNodeSelection`):**
  - each align button sets `image.align`;
  - each size preset sets `image.width` (`25%`/`50%`/`100%`);
  - **Delete** removes the image node (`getJSON` has no image);
  - **Replace** (MSW-mock `POST /images`) updates `image.src` to the returned url.
  - Buttons expose the expected `aria-label`s (and `title`s).
- **`EditorToolbar`:** a button carries a `title` matching its `aria-label` (tooltip present); the image-align buttons are gone (the old "appear when image selected" test is removed).
- **Floating BubbleMenu show/position:** manual / Playwright (jsdom can't position it).
- Full suite stays green, output pristine.

## Out of scope (still v5)

The **behind / in-front of text** floating overlay (absolutely-positioned, drag-positioned, z-index). Also: image cropping/filters, captions, alt-text editing.
