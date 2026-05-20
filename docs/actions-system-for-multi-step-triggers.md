# Automation: Macros, Cues, and Triggers

This document describes the automation feature in LumaCast: how operators bind cues to slides and compose macros to fire multiple cues in sequence.

The original v0 sketch of this system used "actions" terminology with parallel step groups. That model has been collapsed in favor of strictly sequential macros — see `Out of scope` at the end of this doc for what was removed and why.

## Concepts

### Cue

A **cue** is the smallest automation atom. It is a `(kind, payload, failurePolicy)` triple — for example "Activate overlay → Lower Third 1" or "Wait → 500 ms".

- Cues have **no user-facing name**. The UI derives a display label from kind + target on the fly (see [`describe-cue.ts`](../app/renderer/features/automation/describe-cue.ts)).
- Cues are **flyweight**: the same `(kind, payload, failurePolicy)` only ever has one row in the `cues` table, deduplicated via `ensureCue()` in the provider.
- Cues are **not directly managed**. There is no "Cues" bin or browser. They are surfaced indirectly via:
  - the slide right-click → Automation submenu (binds a cue to a slide)
  - the macro editor (composes cues into a sequence)

### Macro

A **macro** is a user-authored, named sequence of cues. It lives in the Macros bin alongside the other ProgramPanel bins (Overlays / Stage / Video / Audio).

- Macros have `name`, `description`, `collectionId`, and an ordered list of `MacroCue` join rows.
- Each `MacroCue` carries a single `orderIndex` — there is no concept of parallel groups. Cues in a macro run strictly sequentially.
- Macros are CRUD'd via dedicated IPC (`listMacros` / `createMacro` / `updateMacro` / `deleteMacro`), not via `AppSnapshot`. They are not currently part of undo/redo.

### TriggerBinding

A **trigger binding** wires a trigger source to a cue or macro. Today the only trigger types are `slide.activate` and `slide.take`. A binding's `targetType` is `cue` or `macro`.

Bindings are created and removed exclusively from the slide right-click menu — there is no separate bindings panel. The macro editor's `Triggers` tab shows which slides reference a macro but is read-only.

## Cue kinds

Each cue's `kind` maps to a single playback operation. The current catalog:

- `overlay.activate`, `overlay.clear`, `overlay.clearAll`
- `mediaLayer.set`
- `video.arm`, `video.clear`
- `audio.arm`, `audio.clear`
- `stage.set`, `stage.clear`
- `layer.clear`, `layer.clearAll`
- `flow.wait`

Each kind has a fixed payload shape (`overlayId`, `assetId`, `stageId`, `layer`, `ms`, or empty).

## Execution

The renderer-side `AutomationProvider` ([`automation-context.tsx`](../app/renderer/features/automation/automation-context.tsx)) owns execution.

- `runCue(cueId)` looks up the cue and calls the matching playback method. Failures are recorded; if `failurePolicy === 'abort'`, the error is rethrown for the caller.
- `runMacro(macroId)` sorts the macro's `MacroCue` rows by `orderIndex` and `await`s each `runCue` in order. The first cue that throws aborts the rest of the macro.
- Bindings are dispatched on a custom event (`AUTOMATION_TRIGGER_EVENT`) fired from [`slide-context.tsx`](../app/renderer/contexts/slide-context.tsx) on take / activate.

Action execution is renderer-bound, so a renderer reload during a `flow.wait` will stop the sequence. This is acceptable for v1.

## UI Surfaces

### Macros bin (Show page)

A 5th tab in the right-hand ProgramPanel, next to Overlays / Stage / Video / Audio. Reuses the `BinShell` pattern (collection picker, search, view toggle). The bin's create button (`+ Add macro`) creates a draft macro and immediately opens the macro editor.

Each macro tile shows the Workflow icon, cue count, and the macro's editable name. Right-click offers Edit, Rename, Duplicate, Run now, Move to collection, and Delete.

### Macro editor

A dedicated workbench mode (`'macro-editor'`) reached via the Macros bin tile double-click or the bin's edit-pencil button. Layout mirrors the stage editor:

- **Left** — top: tile list of all macros (click to switch). Bottom: `Layers` panel listing the selected macro's cues with drag-to-reorder.
- **Center** — vertical sequence of cue cards with a bottom `+ Add cue` button. Click a card to select.
- **Right** — inspector with two tabs:
  - **Properties** — macro name + description when nothing is selected; cue type / target / failure policy when a cue is selected.
  - **Triggers** — read-only list of slides bound to this macro.

Adding a cue inserts an unconfigured draft card; configuring its kind + target in the inspector finalizes it via `ensureCue()` and persists the link.

## Data model

```
cues
  id, kind, payload_json, failure_policy, created_at, updated_at

actions  (legacy table name; holds macros)
  id, name, description, collection_id, created_at, updated_at

action_steps  (legacy table name; the MacroCue join)
  id, action_id, cue_id, kind, order_index, payload_json, failure_policy, created_at, updated_at

trigger_bindings
  id, action_id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at

macro_collections
  id, name, order_index, is_default, created_at, updated_at
```

Table names retain the original `actions` / `action_steps` to avoid a risky rename in already-shipped databases. The product surface refers to them as Macros / MacroCues exclusively.

## Out of scope

The following were considered for v1 and dropped:

- **Parallel cue groups.** The schema once tracked `(group_index, step_index)` on `action_steps`. The v17 migration collapses both into a single `order_index`; the columns are dropped where the SQLite runtime supports `DROP COLUMN`. If the product later needs branching or fan-out, it will arrive together as a real branching model, not a return to the implicit group concept.
- **A "Cues" bin or browser.** Cues are flyweight value objects, not first-class assets.
- **Editable cue names.** The `cues.name` column was dropped in v17.
- **User-defined keyboard shortcuts as triggers.** Requires conflict rules with built-in shortcuts.
- **Recursive action calls** (a macro referencing another macro).
- **Undo/redo of macro edits.** Macros sit outside `AppSnapshot`.
