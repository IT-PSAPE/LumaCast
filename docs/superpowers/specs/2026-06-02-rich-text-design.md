# Rich Text — Design Spec

Date: 2026-06-02
Status: Approved (pre-implementation)
Related: [CONTEXT.md](../../../CONTEXT.md) "Rich Text" glossary · ADR 0002

## 1. Goal

Move text styling from whole-box to the **word/character level** while keeping a single,
reusable way text is edited, stored, and rendered everywhere it appears (Show/deck editor,
overlay editor, theme editor, stage editor, and live/NDI output).

Users can select a span of text and set:

- text **color**
- font **weight** (regular ↔ bold)
- **italic**
- **underline**
- **strikethrough**

and turn lines into **bullet or numbered lists** (single level).

**Font size and font family remain Box-level** (whole-box, component-managed). Per-run font size
and per-run font family are explicitly out of scope for v1.

## 2. Definitions

Canonical terms are fixed in [CONTEXT.md](../../../CONTEXT.md) → "Rich Text":
**Rich Body**, **Block**, **Run**, **Run-level style**, **Box-level style**, **Bound text**.

This spec uses those terms exactly.

## 3. Current state (what we are changing)

| Concern | Today | Anchor |
|---|---|---|
| Content | flat `text: string` | `app/core/types.ts:174-200` |
| Styling | all Box-level fields on `TextElementPayload` | `app/core/types.ts:174-200` |
| Style seam | `readTextFormatting` / `readTextVisualPayload` | `app/core/element-payload.ts:31-57` |
| Render | one Konva `<Text>` (single-style); custom `<Shape sceneFunc>` only for inside-stroke | `scene-node-text.tsx:264-326` |
| Weight | collapses to bold/normal at ≥600 | `resolve-konva-text-style.ts:6` |
| Measure/layout | whole-string Canvas2D + autoFit binary search | `text-layout.ts` |
| Inline edit | plain `<textarea>` (string only) | `inline-text-editor.tsx:108` |
| Inspector | toggles applied to whole box | `use-text-inspector.ts`, `text-element-inspector.tsx` |
| Bound text | resolves to a string at runtime; `text` is fallback | `use-resolved-text.ts:97-98` |
| Persist | element payload as JSON in `slide_elements.payload_json`; arrays in `overlays/themes/stages.elements_json` | `store.ts:387,403`; `presentation-layers.ts` |
| Persist flow | draft → `cast:updateElement` → `repo.updateElement` merge+stringify → `SnapshotPatch` → `mutatePatch` | `store.ts:5520-5608`, `app-store.ts:126-168` |
| Create | forked per surface; hardcoded defaults | `use-element-commands.ts:53-112`, `element-factory.ts:4-22` |
| Render sharing | `SceneNodeText` via `SceneStage` serves all 5 surfaces + NDI | `scene-stage.tsx:36-41` |

The single hardest constraint: **NDI output re-renders through the same `SceneNodeText` on an
offscreen stage, then rasterizes**. Any render change must produce pixel-identical output
on that offscreen stage. There is no separate text renderer.

## 4. Data model

Additive change to the existing payload — **no new `SlideElementType`**, so every
`switch(element.type)`, factory, and inspector wrapper keeps working.

```ts
// app/core/types.ts — TextElementPayload gains:
format?: 'plain' | 'rich';   // absent ⇒ 'plain'
richBody?: Block[];          // present iff format === 'rich'
// text: string stays — plaintext fallback AND the resolved value for bindings.
// All existing Box-level fields (fontFamily, fontSize, color, weight, italic,
// underline, strikethrough, alignment, verticalAlign, lineHeight, caseTransform,
// autoFit, stroke*, shadow*, ...) are unchanged and define the Box-level style.
```

```ts
// app/core/rich-text/types.ts (new)
export interface RichRun {
  text: string;
  // Run-level style — OVERRIDES only. Unset ⇒ inherit Box-level style.
  color?: string;
  weight?: number;          // true numeric (e.g. 400, 700)
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export interface RichBlock {
  runs: RichRun[];
  listType?: 'bullet' | 'number';   // absent ⇒ plain paragraph
  indent: number;                   // 0 for v1; schema is nesting-ready
}

export type RichBody = RichBlock[];
```

**Inheritance:** a Run stores only attributes the user explicitly changed. At resolve time, any
unset Run-level attribute falls back to the Box-level value. Consequence: changing the box default
color recolors all non-overridden text; "no formatting" is byte-identical to plain text.

### Canonical module: `app/core/rich-text/`

The single source of truth for the model:

- `types.ts` — `RichRun`, `RichBlock`, `RichBody` (above).
- `serialize.ts` — `richBodyToText(body): string` (newline-joined, for the `text` fallback and
  search), and `textToRichBody(text, listInfo?): RichBody`.
- `resolve.ts` — `resolveRun(run, boxStyle): ResolvedRunStyle` (applies inheritance; coerces the
  existing Box-level numeric-string `weight` e.g. `'400'` to the Run's `number`), and
  `synthesizePlain(payload): RichBody` (one inheriting run from `text` + box style).
- `measure.ts` — run-aware width/line-break helpers built on the existing Canvas2D measurement,
  shared by the renderer and the editor so both lay out identically.

The existing `TextFormattingState` / `TextVisualState` accessors (`element-payload.ts:31-57`)
remain the Box-level seam; rich-text adds the Run-level layer beside them.

## 5. Storage & migration

- **No `PRAGMA user_version` bump.** `richBody`/`format` are new optional JSON fields inside the
  already-opaque payload; they persist immediately with no schema change.
- **Lazy read-tolerance.** On load, if `format` is missing or `'plain'`, the renderer and editor
  call `synthesizePlain(payload)` to get a single inheriting run. Nothing is rewritten.
- **Write-on-first-rich-edit.** The first time a user applies inline formatting (or a list) to an
  element, we write `format:'rich'` + `richBody` for that element only, via the existing
  `cast:updateElement` path. Plain/bound elements may stay `format:'plain'` forever.
- **Both storage paths covered for free.** Because runs live inside the element payload, the same
  read-tolerance applies whether the element came from a normalized `slide_elements` row or an
  embedded `elements_json` array (overlays/themes/stages) — no array-rewrite migration.
- **`SnapshotPatch`** upserts whole `SlideElement` records, so runs ride along with no
  patch-format change.

Reversibility: if `richBody` is dropped, an element falls back to its `text` string and box style.

## 6. Rendering — one run-aware draw path

Replace the Konva `<Text>` branch (`scene-node-text.tsx:304-326`) with a single Konva
`<Shape sceneFunc>` per element that draws a laid-out `RichBody`. **All** text flows through it:

- **plain** → `synthesizePlain` → one inheriting run
- **bound** → resolved string (`use-resolved-text.ts`) wrapped as one run, Box-level style only
- **rich** → the stored `richBody`

Draw algorithm (extends `drawTextOnCanvas` / `text-layout.ts`):

1. Resolve each run against the Box-level style (`resolve.ts`).
2. Apply Box-level `caseTransform` to run text at draw time.
3. Lay out blocks → lines, wrapping runs to `element.width`; a run that overflows splits across
   lines. List blocks reserve an indent and a marker column (`• ` for bullet, `1.`/`2.`… counter
   per list run for number).
4. For each line, honor Box-level `align` (incl. justify) and the block's indent; honor Box-level
   `verticalAlign` over the whole frame; line advance uses Box-level `fontSize` × `lineHeight`.
5. Per run: set `ctx.font` from Box-level family/size + the run's **true numeric weight** + italic;
   `ctx.fillStyle` from the resolved color; `fillText`; then draw underline / strikethrough as
   rects under/over the run's advance width.
6. Box-level effects unchanged: the inside-stroke offscreen composite (`scene-node-text.tsx:264-302`)
   now composites the multi-run render; outside/center stroke, shadow, and `autoFit` (binary-search
   on Box-level `fontSize`) wrap the whole node exactly as today.

Weight: retire the ≥600 collapse (`resolve-konva-text-style.ts:6`); pass the true numeric weight to
the canvas font string, falling back to bold/normal only if the chosen family lacks that face.

**Invariants:** exactly **one Konva node per element** (selection, transformer, hit-testing, NDI
capture unchanged). Plain text must render **pixel-identical** to the current `<Text>` output.

## 7. Editing — bespoke `RichTextEditor`

A focused `contentEditable` surface replacing the `<textarea>` (`inline-text-editor.tsx`),
positioned over the canvas on double-click as today.

- **Model-first.** The editor reads a `RichBody`, renders it to DOM (blocks → `<div>`/list rows,
  runs → styled `<span>`), and on input serializes the DOM back to a `RichBody` via
  `core/rich-text/serialize.ts`. The Block/Run model is the single document model — there is no
  second document format.
- **Selection → runs.** DOM selection maps to `(blockIndex, runOffset)` ranges. Applying a
  Run-level style splits/merges runs at the range boundaries and sets only the changed attribute
  (overrides). Adjacent runs with equal style are coalesced on serialize.
- **Collapsed caret** carries a *pending style* applied to the next typed characters (standard
  editor behavior).
- **Blocks/lists.** Enter creates a new block; toggling a list sets `listType` on the selected
  blocks; Tab/Shift-Tab are reserved for future indent (no-op beyond level 0 in v1).
- **Paste** is sanitized to plain runs (drop foreign HTML styling for v1; keep line breaks → blocks).
- **IME** handled via composition events (single Chromium engine; no cross-browser branching).
- **Undo.** Typing is coalesced into single undo entries (debounced commit) to protect the
  50-entry element-level stack (`app-store.ts`). Structural ops (list toggle, style apply) commit
  immediately as one entry.
- **Editor ⇄ renderer parity.** The editor measures with the same `core/rich-text/measure.ts`
  helpers the renderer uses, closing the existing DOM-vs-Canvas2D divergence.

## 8. Inspector behavior

- Run-level controls (color, B / I / U / S) act on the **active selection** when the editor has
  one, and reflect that selection's resolved style (mixed → indeterminate). With no selection /
  not editing, they edit the **Box-level default**, which cascades to non-overridden runs.
- List toggles (bullet / number) act on the selected block(s).
- Font **family** and font **size** remain Box-level controls (component-managed), unchanged.
- The inline toolbar and the inspector invoke the **same** formatting actions from
  `core/rich-text` — one behavior, two entry points.
- When a **binding** is active, Run-level / list controls are disabled (Bound text is Box-level).

## 9. Universal scope — shared primitives + unified creation

Delivered as the canonical, multi-surface primitives (not thin wrappers):

- `app/core/rich-text/` — model, serialize, resolve, measure.
- the run-aware draw path inside `SceneNodeText` (already shared by all 5 surfaces + NDI).
- `RichTextEditor` — the one editing surface, used wherever text is edited.

**Plus** (approved scope expansion): consolidate the five forked text-creation paths
(`use-element-commands.ts:53-112`) and the hardcoded defaults (`element-factory.ts:4-22`) into a
single `createTextElement(surface, overrides?)` initializer, so deck/overlay/theme/stage create
text through one code path with one set of defaults.

## 10. Out of scope (v1)

Per-run font family · per-run font size · nested lists (indent > 0) · rich formatting on bound
text · importing styled HTML on paste. The schema (`RichBlock.indent`, optional Run fields) is
shaped so these can be added later without a format change.

## 11. Risks & validation

1. **Plain-text pixel parity** — moving plain text off Konva `<Text>` onto the custom draw path
   must match current output. Validate with screenshot diffs across existing decks
   (`capture:ui-screenshots`).
2. **NDI parity** — the offscreen capture (`ndi-frame-capture.tsx`) must rasterize identically;
   validate the run path on the offscreen stage, not just the editor stage.
3. **Editor ⇄ renderer metric parity** — shared `measure.ts` is the mitigation; test wrapping at
   non-integer line heights (the flagged divergence point).
4. **Undo churn** — verify typing coalescing keeps the 50-entry stack usable.
5. **Justify + lists + autoFit interaction** — exercise the combinations during layout work.

## 12. Acceptance criteria

- A user can select a span inside any text box (deck/overlay/theme/stage) and apply color, bold,
  italic, underline, strikethrough; multiple styles coexist in one box.
- A user can turn lines into bullet or numbered lists (single level).
- Box-level font size and font family continue to govern the whole box.
- Existing decks/overlays/themes/stages open and render unchanged with no migration step.
- The same `RichBody` renders identically in the editor, on the stage, in preview, and over NDI.
- All text creation flows through one `createTextElement` initializer.
