# Rich text: our own block/run model, one custom canvas-draw render path, bespoke contentEditable

Status: accepted

## Context & decision

We are adding word/character-level text styling (color, weight, italic, underline, strikethrough)
and single-level bullet/numbered lists, usable on every surface (deck/overlay/theme/stage editors
and live + NDI output). Three non-obvious choices, taken together, define the architecture:

1. **Storage = our own block/run JSON inside the existing element payload**, not a third-party
   editor's document format, and not flat runs over one string. We add `format?: 'plain'|'rich'`
   and `richBody?: Block[]` to `TextElementPayload` (no new `SlideElementType`). A `Block` is a
   paragraph/list-item of `Run`s; a `Run` stores only Run-level *overrides* and inherits the
   Box-level style. Font size and font family stay Box-level.

2. **Rendering = one run-aware custom canvas-draw path for ALL text**, replacing the Konva
   `<Text>` node. Konva `<Text>` is single-style and cannot do inline runs; we already custom-draw
   text via `drawTextOnCanvas` for inside-stroke. Plain text (one run), bound text (resolved string
   as one run), and rich text (N runs) all draw through a single `<Shape sceneFunc>` — keeping one
   Konva node per element so selection, transforms, hit-testing, and the NDI offscreen capture stay
   unchanged.

3. **Editing = a bespoke `contentEditable` editor over the Block/Run model**, not a rich-text
   library (e.g. Lexical/Slate). The app is Electron/Chromium-only, which removes contentEditable's
   worst (cross-browser) pain; a bespoke editor avoids a heavy dependency, avoids a second document
   model + translation layer, and integrates with the existing zustand draft and element-level undo.

## Why these are recorded

- **Hard to reverse:** the stored format and the renderer are load-bearing; existing decks depend
  on them.
- **Surprising:** a future reader will reasonably ask "why not Konva `<Text>` / Lexical / a real
  document tree library?" — all of which we deliberately rejected.
- **Real trade-offs:** NDI demands a single pixel-exact render path (rejecting a DOM/`foreignObject`
  layer); the "single source of truth" goal and undo integration favored owning the model over a
  library; bullets being block-level ruled out a flat-runs model.

## Consequences

- No DB migration: rich fields ride inside the opaque payload JSON; old data is read with
  lazy tolerance (a missing/`'plain'` format synthesizes one inheriting run) and only rewritten on
  first rich edit. Covers both `slide_elements` rows and embedded `elements_json` arrays.
- We own line-wrapping, list markers/indent, decoration drawing, and editor⇄renderer measurement
  parity (shared measure helpers in `app/core/rich-text/`).
- The ≥600 weight collapse is retired; the renderer honors true numeric weights.
- v1 explicitly excludes per-run font family/size, nested lists, and rich formatting on bound text;
  the schema is shaped to allow them later without a format change.
