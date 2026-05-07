# Actions System for Multi-Step Triggers (#48)

Branch: `feat/actions`

## Context

Recast has separate, isolated action-like pathways: slide take, overlay activation, media/video layer controls, audio transport, stage selection, NDI output toggles, app menu commands, command palette, and keyboard shortcuts. Each is wired one-to-one — a hotkey runs one handler; a slide click takes one slide. There's no way for an operator to say "when I take this slide, also start a video and bring up an overlay 500ms later."

ProPresenter solves this with **Actions** (per-slide side-effects) and **Macros** (reusable bundles). Notably, ProPresenter only fires actions in *parallel* — sequential timing is delegated to its Timeline, and operators routinely complain about it. Issue #48 explicitly asks for both parallel **and** sequential with delays, e.g. "show overlay, wait, start video, then clear overlay."

Deliverables on this branch:
1. A markdown design doc committed at [docs/actions-proposal.md](docs/actions-proposal.md) — a trimmed version of this plan, reviewable independently.
2. A minimal MVP slice that proves the data + runtime model end-to-end: schema v13 tables, IPC, dispatcher, step adapters for the highest-leverage subset, an Actions Library panel, and one trigger source (`slide.take`).

## High-Level Approach

Three layers, mirroring the existing app:

1. **Action definitions** — reusable, named, persisted in their own SQLite tables. Closer to ProPresenter Macros than to per-slide attached actions: the same action ("Worship Open") can be bound to many triggers without duplication.
2. **Trigger bindings** — a separate table mapping `(sourceType, sourceId)` → `actionId`. Many bindings can fire the same action; one source can have multiple bindings.
3. **Runtime dispatcher** — a renderer-side context (`ActionsProvider`) mounted under `PlaybackProvider` so it can consume `usePlayback`, `useSlides`, `useNavigation`, `useStagePlayback`, NDI controls. Wraps existing handles as **step adapters**. No new command bus, no IPC refactor.

A step adapter is a typed `(payload, ctx) => Promise<void>`. Adding a new step kind = add an entry to `step-adapters.ts`. Pure dispatch.

## ActionStepKind — Full Catalog

The full catalog is the *design intent* — the full set of action kinds Recast aims to support, mapped 1:1 against the existing capability surface and against ProPresenter's catalog (so we don't quietly miss something an operator coming from PP would expect).

`✓` = ships in MVP catalog (adapter implemented in this branch).
`◐` = type-only in MVP (declared in `ActionStepKind`, payload schema defined, adapter throws "not yet implemented" — keeps schema stable so we don't have to bump it again to add the adapter).
`○` = deferred entirely (out of catalog until the underlying Recast capability exists). Listed in proposal doc with rationale; **not** in the v13 type union.

| Kind | Status | Payload | Recast handle (file:symbol) | ProPresenter analog |
|---|---|---|---|---|
| **Slides / deck navigation** |
| `slide.take` | ✓ | `{ slideId: Id }` | [app/renderer/contexts/playback/playback-context.tsx](app/renderer/contexts/playback/playback-context.tsx) `takeSlide` (via `useSlides`) | #18 Slide Destination fire |
| `slide.activate` | ✓ | `{ slideId: Id }` | `useSlides().activateSlide` | (precue / arm) |
| `slide.next` | ✓ | `{}` | `useSlides().goNext` | #70 Trigger Next Slide |
| `slide.previous` | ✓ | `{}` | `useSlides().goPrev` | #71 Trigger Previous Slide |
| `deck.armDeckItem` | ◐ | `{ deckItemId: Id }` | [app/renderer/contexts/navigation-context.tsx](app/renderer/contexts/navigation-context.tsx) `armOutputDeckItem` | #75 Go To Specific Presentation |
| `deck.armPlaylistEntry` | ◐ | `{ playlistEntryId: Id }` | navigation `armOutputPlaylistEntry` | #76 Go To Playlist Item |
| `deck.selectLibrary` | ◐ | `{ libraryId: Id }` | navigation `selectLibrary` | #77 Go To Library Item |
| `deck.clearOutput` | ✓ | `{}` | navigation `clearOutputDeckItem` | (clear current) |
| **Overlays** (Recast-specific; closest to PP Messages/Props) |
| `overlay.activate` | ✓ | `{ overlayId: Id }` | `usePresentationOverlayLayer().activateOverlay` | #29 Show Message / #32 Show Prop |
| `overlay.clear` | ✓ | `{ overlayId: Id }` | `clearOverlay` | #30 Hide Message / #33 Hide Prop |
| `overlay.clearAll` | ✓ | `{}` | `clearAllOverlays` | #5/#6 Clear Messages / Props |
| `overlay.setMode` | ✓ | `{ mode: 'single' \| 'multiple' }` | `setOverlayMode` | (n/a — Recast feature) |
| **Presentation layers** |
| `mediaLayer.set` | ✓ | `{ assetId: Id }` | `usePresentationMediaLayer().setMediaLayerAsset` (auto-routes image/video) | #34 Trigger Media |
| `layer.clear` | ✓ | `{ layer: 'media' \| 'video' \| 'content' \| 'overlay' }` | `usePresentationLayers().clearLayer` | #2/#3/#5–#11 Clear * |
| `layer.clearAll` | ✓ | `{}` | `clearAllLayers` | #1 Clear All |
| `layer.showContent` | ◐ | `{}` | `showContentLayer` | (re-show after clear) |
| **Video transport** (layer video) |
| `video.arm` | ✓ | `{ assetId: Id }` | `useVideo().armVideo` | #34 Trigger Media (video) |
| `video.clear` | ✓ | `{}` | `clearVideo` | #10 Clear Video Input |
| `video.play` | ◐ | `{}` | `play` | #43 Play |
| `video.pause` | ◐ | `{}` | `pause` | #43 Pause |
| `video.togglePlayback` | ◐ | `{}` | `togglePlayback` | (toggle) |
| `video.next` | ◐ | `{}` | `playNext` | #35 Trigger Next Media |
| `video.previous` | ◐ | `{}` | `playPrevious` | #36 Trigger Previous Media |
| `video.seekTo` | ◐ | `{ seconds: number }` | `seekTo` | (seek) |
| `video.toggleLoop` | ◐ | `{}` | `toggleLoop` | (loop toggle) |
| `video.toggleMuted` | ◐ | `{}` | `toggleMuted` | (mute toggle) |
| **Audio** |
| `audio.arm` | ✓ | `{ assetId: Id }` | `useAudio().armAudio` | #39 Trigger Audio |
| `audio.select` | ◐ | `{ assetId: Id }` | `selectAudio` | #38/#44 Select Playlist |
| `audio.clear` | ✓ | `{}` | `clearAudio` | #7 Clear Audio |
| `audio.play` | ◐ | `{}` | `play` | #43 Audio Play |
| `audio.pause` | ◐ | `{}` | `pause` | #43 Audio Pause |
| `audio.togglePlayback` | ✓ | `{}` | `togglePlayback` | #43 Audio Play/Pause |
| `audio.next` | ◐ | `{}` | `playNext` | #40 Next Audio |
| `audio.previous` | ◐ | `{}` | `playPrevious` | #41 Previous Audio |
| `audio.seekTo` | ◐ | `{ seconds: number }` | `seekTo` | (seek) |
| `audio.toggleLoop` | ◐ | `{}` | `toggleLoop` | (loop toggle) |
| `audio.toggleMuted` | ◐ | `{}` | `toggleMuted` | (mute toggle) |
| **Stage** |
| `stage.set` | ✓ | `{ stageId: Id }` | `useStagePlayback().setCurrentStageId` | #15 Select Stage Layout |
| `stage.clear` | ✓ | `{}` | `setCurrentStageId(null)` | (clear stage) |
| **Output / NDI** |
| `output.setEnabled` | ◐ | `{ name: 'audience' \| 'stage', enabled: boolean }` | [app/main/ndi/ndi-service.ts](app/main/ndi/ndi-service.ts) `setNdiOutputEnabled` (via IPC) | #84/#85 Toggle Output |
| `output.toggleAudience` | ◐ | `{}` | app-store `toggleAudienceOutput` | #84 Toggle Audience |
| `output.toggleStage` | ◐ | `{}` | app-store `toggleStageOutput` | #85 Toggle Stage |
| **Control flow** |
| `flow.wait` | ✓ | `{ ms: number }` | (built-in: `setTimeout`) | (n/a — PP has no native delays) |
| `flow.runAction` | ◐ | `{ actionId: Id }` | recursive into dispatcher (with cycle detection) | #69 Run Macro |

### Deferred kinds (NOT in `ActionStepKind` union — require new Recast features)

Documented in the proposal doc with rationale, so future contributors know why a PP user might expect these:

- **Timer** (start/stop/reset/set/runTo/start-all/stop-all/reset-all) — Recast has no Timer feature. Tracked as a separate prerequisite.
- **Message with editable tokens** (#29, #31) — Recast overlays don't yet support live token substitution.
- **Prop (auto-clear semantics)** (#32, #33) — Recast overlays partially cover this; differentiate later.
- **Audience Look** (#14) — no Look concept in Recast yet.
- **Slide Destination** audience/stage/both (#18–#20) — Recast routes via NDI outputs, model differs; revisit.
- **Capture / Recording** (#80, #81) — no recording feature.
- **Bible verse / Announcement** (#88, #89) — no Bibles module.
- **Apply Theme to slide at runtime** (#82, #83) — themes are edit-time only.
- **Communication / Device actions**: MIDI Note On/Off/PC/CC, OSC, RossTalk (FTB/Key Cut/Trans/GPI/Custom Control), DMX, AMP, CITP, GlobalCache, GVG-100, Sony BVS/BVW, VDCP, PTZ presets, Network Link (#48–#68) — Recast has no outbound-device stack. Tracked as the `feat/devices` epic. The action runtime is designed so a `device.<protocol>` step kind plugs in by registering an adapter, with **no schema or runtime change** required when devices land.
- **Freeze / Blackout per output** (#86, #87) — no per-output freeze. Cheap to add later as a black-fill source.
- **Telestrator** (#11) — none.
- **Custom Clear Group** (#13) — replaced by composing `layer.clear` / `overlay.clear` steps inside an Action. The Action *is* the user-defined clear group.

### Out of scope (intentionally — never operator-fired)

App-mode switches (`view.mode.show`, `view.mode.deckEditor`, etc.), slide/overlay/theme editing CRUD, element-level transforms.

## Data Model

New tables, schema v13 (current `LATEST_SCHEMA_VERSION` = 12 in [app/database/store.ts:86](app/database/store.ts#L86)):

```sql
CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE action_steps (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                  -- ActionStepKind
  payload TEXT NOT NULL,               -- JSON, validated at runtime
  group_id INTEGER NOT NULL,           -- steps with same group_id fire in parallel
  order_index INTEGER NOT NULL,        -- group execution order ascending
  failure_policy TEXT NOT NULL DEFAULT 'continue'  -- 'continue' | 'abort'
);
CREATE INDEX idx_action_steps_action ON action_steps(action_id, order_index);

CREATE TABLE trigger_bindings (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,           -- TriggerSourceType
  source_id TEXT,                      -- nullable (e.g. shortcut bindings)
  accelerator TEXT,                    -- JSON ShortcutAccelerator | null
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_trigger_bindings_lookup ON trigger_bindings(source_type, source_id, enabled);
```

```ts
// app/core/types.ts — additions

export type ActionStepKind =
  // (full union — see catalog table above; all ✓ and ◐ rows)
  | 'slide.take' | 'slide.activate' | 'slide.next' | 'slide.previous'
  | 'deck.armDeckItem' | 'deck.armPlaylistEntry' | 'deck.selectLibrary' | 'deck.clearOutput'
  | 'overlay.activate' | 'overlay.clear' | 'overlay.clearAll' | 'overlay.setMode'
  | 'mediaLayer.set' | 'layer.clear' | 'layer.clearAll' | 'layer.showContent'
  | 'video.arm' | 'video.clear' | 'video.play' | 'video.pause' | 'video.togglePlayback'
  | 'video.next' | 'video.previous' | 'video.seekTo' | 'video.toggleLoop' | 'video.toggleMuted'
  | 'audio.arm' | 'audio.select' | 'audio.clear' | 'audio.play' | 'audio.pause' | 'audio.togglePlayback'
  | 'audio.next' | 'audio.previous' | 'audio.seekTo' | 'audio.toggleLoop' | 'audio.toggleMuted'
  | 'stage.set' | 'stage.clear'
  | 'output.setEnabled' | 'output.toggleAudience' | 'output.toggleStage'
  | 'flow.wait' | 'flow.runAction';

// Per-kind payload typing via discriminated union — strict, no `Record<string, unknown>`.
// Keeps adapters fully type-safe; saves the "JSON parsed but typed weakly" trap.
export type ActionStep =
  | { id: Id; kind: 'slide.take'; payload: { slideId: Id }; groupId: number; order: number; failurePolicy: 'continue' | 'abort' }
  | { id: Id; kind: 'slide.next'; payload: Record<string, never>; groupId: number; order: number; failurePolicy: 'continue' | 'abort' }
  | { id: Id; kind: 'flow.wait'; payload: { ms: number }; groupId: number; order: number; failurePolicy: 'continue' | 'abort' }
  // …one variant per kind. Generated, not hand-written, via a `StepPayloadByKind` helper.
  ;

export interface Action {
  id: Id;
  name: string;
  description?: string;
  steps: ActionStep[];
  createdAt: number;
  updatedAt: number;
}

export type TriggerSourceType =
  | 'slide.take'        // when the operator takes this slide
  | 'slide.activate'    // when the operator selects/arms this slide
  | 'media.play'        // when this media asset is played as a layer
  | 'shortcut'          // bound hotkey
  | 'commandPalette'    // surfaced as a palette command
  | 'menu';             // app menu entry

export interface TriggerBinding {
  id: Id;
  actionId: Id;
  sourceType: TriggerSourceType;
  sourceId: string | null;
  accelerator?: ShortcutAccelerator;
  enabled: boolean;
}
```

## Runtime Semantics (precise)

`ActionsProvider` exposes:

```ts
runAction(actionId: Id, ctx?: { source?: TriggerBinding; depth?: number }): Promise<void>
fireTrigger(sourceType: TriggerSourceType, sourceId: string | null): void
```

Execution algorithm:

1. Load `Action` (steps already sorted by `(groupId, order)` by the repo).
2. Partition steps into **groups** keyed by `groupId`. Sort groups by min `order` of their members.
3. For each group in order:
   a. Dispatch every step in the group in parallel: `Promise.allSettled(group.map(step => adapters[step.kind](step.payload, runCtx)))`.
   b. If any step rejected and its `failurePolicy === 'abort'`, abort the whole action; remaining groups don't run. Otherwise log and continue.
4. `flow.wait` resolves after `setTimeout(payload.ms)`.
5. `flow.runAction` recurses into `runAction(payload.actionId, { depth: depth + 1 })`. **Cycle detection**: maintain a per-dispatcher-tick `Set<Id>` of action ids currently on the stack. If the recursion would re-enter an id already in the set, log `recordObsEvent('action', 'Cycle detected', …)` and abort that branch only (return resolved). Hard cap `depth ≤ 8`.
6. Re-firing the same top-level action while a previous instance is still running starts a new instance (no queueing). Documented; revisit if it bites in practice.
7. Renderer reload kills in-flight `wait` steps. Acceptable; documented.
8. Every step start/finish/failure logs to `recordObsEvent('action', …)` from [app/renderer/features/observability/metrics-store.ts](app/renderer/features/observability/metrics-store.ts) — no new observability surface needed.

Step adapters live in **one file**: `app/renderer/features/actions/step-adapters.ts`. Each adapter is a closure built from the relevant context handles, returning `Promise<void>`. The provider builds the adapter map once via `useMemo` keyed on the underlying handles.

## Trigger Wiring

- **`slide.take`**: Wherever `takeSlide` is dispatched (start with the single canonical handler — find via `useSlides` definition), append `actionsCtx.fireTrigger('slide.take', slideId)` after the existing logic. One line; no-op when no bindings exist.
- **`shortcut`**: In [app/renderer/hooks/use-keyboard-shortcuts.ts](app/renderer/hooks/use-keyboard-shortcuts.ts), after the existing `matchesShortcut()` match-and-dispatch, also iterate `trigger_bindings` where `sourceType='shortcut'` and matching accelerator. (MVP: stub — full wiring lands in slice 2.)
- **`commandPalette`**: Extend the command source list in [app/renderer/features/command-palette/command-palette.tsx](app/renderer/features/command-palette/command-palette.tsx) with one entry per action whose has-or-could-have palette binding. (MVP: stub.)
- **`media.play` / `menu`**: Stubbed in v1.

## UI (MVP)

One new panel: **Actions Library**, reachable from the app toolbar like the observability panel. Inspector pattern from [app/renderer/features/inspector/](app/renderer/features/inspector/) — `FieldInput`/`FieldSelect`, draft-state + blur-commit.

- Left list: actions with name + step count.
- Right pane:
  - Name + description (draft + blur-commit).
  - **Step list grouped visually**: each `groupId` is a horizontal "rail" (steps stacked vertically inside the rail = parallel; rails stack top-to-bottom = sequential). Up/down chevrons move a step to a different rail or reorder rails. No drag-and-drop in MVP.
  - Per-step: kind picker (one `<select>` listing all ✓ kinds; ◐ kinds appear disabled with "(coming soon)") + payload form rendered per kind via a small `<StepPayloadEditor>` switch component.
  - Failure-policy toggle per step (default `continue`).
  - Add/remove/duplicate step buttons.
- **Bindings tab** on each action: table of `trigger_bindings`. Add binding picks `sourceType` (MVP: `slide.take` only; others disabled with tooltip), then a slide picker (reuses existing slide-picker affordance from inspector). Remove binding via row delete.

No per-slide inspector affordance in v1 — operators bind by editing the action.

## MVP Slice (ships in this branch)

1. Schema v13 migration + repo CRUD on `CastRepository` in [app/database/store.ts](app/database/store.ts): `listActions`, `getAction`, `createAction`, `updateAction`, `deleteAction`, `listTriggerBindings(forSourceType?, forSourceId?)`, `createTriggerBinding`, `deleteTriggerBinding`. Mirror existing slide/overlay repo shape.
2. IPC: extend `MainApi` in [app/core/ipc.ts](app/core/ipc.ts) and handlers in [app/main/ipc.ts](app/main/ipc.ts) — one method per repo method above.
3. Renderer types in [app/core/types.ts](app/core/types.ts): full `ActionStepKind` union (all ✓ and ◐), discriminated `ActionStep`, `Action`, `TriggerSourceType`, `TriggerBinding`.
4. New: `app/renderer/features/actions/`:
   - `actions-context.tsx` — provider with `runAction`, `fireTrigger`, `useActions()`.
   - `step-adapters.ts` — adapters for all ✓ kinds; ◐ kinds throw `new Error('Step kind not yet implemented')` so they're declared but not silently no-op.
   - `step-payload-editor.tsx` — switch component rendering payload form per kind.
   - `actions-library.tsx` — the panel.
   - `actions-store.ts` — action-list snapshot, integrated into the existing app-store mutation queue ([app/renderer/contexts/app-store.ts](app/renderer/contexts/app-store.ts)) so edits get undo/redo for free.
5. Mount `ActionsProvider` in [app/renderer/App.tsx](app/renderer/App.tsx) under `PlaybackProvider`.
6. Wire `slide.take` trigger emission at the canonical `takeSlide` callsite.
7. Toolbar entry in [app/renderer/features/workbench/app-toolbar.tsx](app/renderer/features/workbench/app-toolbar.tsx) opening the panel.
8. One demo action committed as a fixture: "Worship Open" — group 1: `overlay.activate(<some lower-third>)`; group 2: `flow.wait(500)`; group 3: `video.arm(<intro>)`. Bound to a sample slide via `slide.take`. Proves parallel-within-group, sequential-across-groups, and delay.
9. Companion design doc at [docs/actions-proposal.md](docs/actions-proposal.md) — trimmed version of this plan including the full catalog table, deferred kinds, and rationale.

**Out of scope for the MVP slice** (declared types only, adapters not implemented — i.e. the ◐ rows): all `deck.*`, `slide.activate`, `layer.showContent`, full video transport beyond `arm`/`clear`, full audio transport beyond `arm`/`clear`/`togglePlayback`, all `output.*`, `flow.runAction`, audio.select. Triggers other than `slide.take`. Per-slide inspector affordance. Drag-reorder. Conditional logic.

## Critical Files

- New: [app/renderer/features/actions/](app/renderer/features/actions/) — provider, adapters, library UI, payload editor, store.
- New: [docs/actions-proposal.md](docs/actions-proposal.md) — proposal doc.
- Modify: [app/database/store.ts](app/database/store.ts) — schema v13 migration + repo CRUD.
- Modify: [app/core/types.ts](app/core/types.ts) — full `ActionStepKind` union, `ActionStep`, `Action`, `TriggerSourceType`, `TriggerBinding`.
- Modify: [app/core/ipc.ts](app/core/ipc.ts) and [app/main/ipc.ts](app/main/ipc.ts) — CRUD endpoints.
- Modify: [app/renderer/App.tsx](app/renderer/App.tsx) — mount provider.
- Modify: the canonical `takeSlide` site (find via `useSlides` definition) — emit trigger.
- Modify: [app/renderer/features/workbench/app-toolbar.tsx](app/renderer/features/workbench/app-toolbar.tsx) — toolbar entry.
- Modify: [app/renderer/contexts/app-store.ts](app/renderer/contexts/app-store.ts) — register actions snapshot in the mutation queue.

## Risks / Open Questions

- **Snapshot/undo integration**: actions are content edits and need to flow through the existing `mutateQueue` / snapshot model in [app/renderer/contexts/app-store.ts](app/renderer/contexts/app-store.ts). Need a quick read pass over how non-Slide entities (overlays, stages) are persisted to follow the same pattern. Confirmed before implementation begins.
- **Re-entrancy via `flow.runAction`**: handled by the cycle-detection set + `depth ≤ 8` cap above.
- **Renderer reload kills in-flight `wait` steps**: acceptable for v1; documented in proposal doc.
- **Visual grouping UX** ("rails" for parallel groups) is non-obvious. Validate with the user when MVP UI is in front of them; cheap to swap if it doesn't land.
- **`mediaLayer.set` semantics**: existing `setMediaLayerAsset` auto-routes image vs. video. Documented in adapter so users don't expect a video-only or image-only kind.
- **Device adapters (MIDI/OSC/etc.)**: declared deferred but the schema accommodates them — when the `feat/devices` epic lands, new step kinds are appended to `ActionStepKind` and adapters added. No schema change required.

## Verification

End-to-end test of the MVP slice:

1. `npm run dev`. Confirm DB migrates to v13 and `actions`, `action_steps`, `trigger_bindings` tables exist (sqlite browser or `pragma user_version` + `.tables`).
2. Open Actions Library panel. Create "Worship Open" with three steps in three rails: rail 1 `overlay.activate(lower-third)`, rail 2 `flow.wait(500)`, rail 3 `video.arm(intro)`. Save.
3. Open Bindings tab → Bind to a specific slide via `slide.take`.
4. From the deck browser, take that slide. Expected: lower-third appears immediately; ~500ms later, intro video arms and starts on the video layer.
5. Take a *different* slide → no overlay, no video. Confirms binding scope.
6. Edit the action (swap rail order), save, take the slide again → new behavior reflected without restart.
7. Add a fourth step in rail 3 alongside `video.arm` (e.g. `audio.arm(<sting>)`) → both fire in parallel. Confirms parallel-within-group.
8. Delete the binding, take the slide → slide takes normally with no side effects.
9. Restart the app → action and binding persist; replay works.
10. Try selecting a ◐ step kind in the picker → it's visibly disabled with "(coming soon)". Pick a ✓ kind. Confirms the catalog gate.
11. Type-check + existing test suite pass; no regressions in slide/overlay/playback paths.

The proposal doc itself ships in the same PR so it's reviewable independently of the runtime code.
