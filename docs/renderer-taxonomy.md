# Renderer Taxonomy

Updated on 2026-11-08. Naming and ownership for the Cast renderer in
`apps/cast/renderer`. Shared suite primitives live in `packages/ui/src`;
other apps retain their own screens and domain state.

## 1. Canonical Modes

Source of truth: `apps/cast/renderer/types/ui.ts`.

- `WorkbenchMode`: `show | item-editor | overlay-editor | theme-editor | stage-editor | macro-editor | settings`
- `SettingsTabId`: `appearance | output | overlays | media | assistant | observability | transfer`
- `SlideBrowserMode`: `grid | list`
- `ResourceDrawerViewMode`: `grid | list`
- `DrawerTab`: `deck | image | video | audio | themes`
- `InspectorTab`: `presentation | slide | shape | text | theme | stage | binding | video | properties | triggers`
- `ProgramSurfaceKind`: `program | monitor | stage`
- `ProgramMode`: `single | all`
- `ProgramGridDensity`: `1 | 2`

## 2. Toolbar Label to Mode Mapping

`apps/cast/renderer/features/workbench/app-toolbar.tsx` presents Show, Edit,
and Themes directly. `overflow-view-menu.tsx` adds Overlay, Stage, and Macros
under More views. The Settings gear opens the full Settings screen.
[UI specification](./ui-spec.md#2-canonical-workbench-modes) lists the exact
label-to-mode mapping.

Audience and Stage output toggles are separate from editor navigation.
The native View menu in `apps/cast/main/application-menu.ts` labels the modes
Show, Slides, Overlays, Themes, Stage, Macros, and Settings.

## 3. Screens (`apps/cast/renderer/screens`)

`apps/cast/renderer/workbench-screen-router.tsx` eagerly loads Show and lazily
loads the other modes.

| Directory | Mode | Owns |
| --- | --- | --- |
| `show` | `show` | Playlist/slide browsing, cross-feature integrations, resource drawer, program panel |
| `item-editor` | `item-editor` | Presentation/lyric picker, slides, layers, stage, notes, inspector |
| `overlay-editor` | `overlay-editor` | Overlay list, layers, stage, inspector |
| `theme-editor` | `theme-editor` | Theme list, layers, stage, inspector |
| `stage-editor` | `stage-editor` | Stage list, layers, stage, inspector |
| `macro-editor` | `macro-editor` | Macro list, cue layers, canvas, inspector, trigger bindings |
| `settings` | `settings` | Settings navigation and feature-owned settings panels |
| `shared` | (n/a) | Editor element layers and cross-feature slide actions menu |

Editor directories have `page.tsx`, `screen-context.tsx`, layers, inspector,
and content components. The item editor names its content component
`item-editor-screen-content.tsx`; the other editors use `screen-content.tsx`.

## 4. Features (`apps/cast/renderer/features`)

| Feature | Owns |
| --- | --- |
| `workbench` | Toolbar, platform inline menu, overflow view menu, panel-visibility controls |
| `playlists` | Flat playlist browsing and management, including item and separator rows |
| `items` | Presentation/lyric browsing, slide grid/list views, creation/editing dialogs, import/export |
| `canvas` | Editable stage behavior and viewport integration with the rendering layer |
| `inspector` | Presentation, slide, scene-element, theme, stage, and binding property controls |
| `assets` | Audio/media, overlay, stage, and theme asset libraries and settings |
| `automation` | Automation state, cues, macros, trigger bindings, and bindings UI |
| `playback` | Output settings/gates, program surfaces, media transport/residency, timers UI |
| `agent` | Assistant chat, model/vendor presentation, permission prompts |
| `observability` | Runtime collectors, metrics storage, and Observability settings |

Application-level commands, keyboard shortcuts, command palette, and renderer
agent-action execution live in `apps/cast/renderer/application`. The persistent
layout/status bar live in `apps/cast/renderer/shell`; resource drawer and program
panel composition belong to the Show screen. Scene traversal/rendering lives in
`apps/cast/renderer/rendering`, and NDI audio capture in
`apps/cast/renderer/runtime`.

Use public feature/package entry points. The checker in
`tool/check_electron_architecture.mjs` enforces import direction, process
purity, and feature/package boundaries; application and screen code compose
features without moving that orchestration into a shared primitive.

## 5. Contexts (`apps/cast/renderer/contexts`)

| Context | Responsibility |
| --- | --- |
| `app-context.tsx` | Bootstrap/subscriptions for `app-store.ts`; snapshot, mutation/history, theme, status, and output hooks |
| `navigation-context.tsx` | Playlist/drawer selection and typed item references; output arming |
| `workbench-context.tsx` | Modes, settings tab, drawer/view preferences, program layout, overlay stack |
| `slide-context.tsx` | Current/live slide selection and activation |
| `canvas/canvas-context.tsx` | Active editor source and canvas-level editing state |
| `element/` | Element history, inspector synchronization, and commands |
| `asset-editor/asset-editor-context.tsx` | Staged theme/asset edits and persisted-ID resolution |
| `playback/playback-context.tsx` | Program/monitor/stage playback and output state |
| `playback-schedules-context.tsx` | Persisted schedules and their active playback runtime |
| `timers/timers-context.tsx` | Persisted timer configuration and shared volatile timer readings |
| `command-palette-context.tsx` | Palette visibility; the palette component owns its query |
| `observability-port.tsx` | Injected event-recording contract |
| `create-screen-context.tsx` | Per-screen context scaffolding |

`apps/cast/renderer/App.tsx` is the source of truth for composition order;
[UI code design](./ui-code-design-spec.md#2-provider-composition) records that order.

## 6. Shared Components

`packages/ui/src/index.ts` exports suite-wide controls and behavior:
`ReacstButton`, `SegmentedControl`, fields, sliders, selection controls,
`Tabs`, `Accordion`, dialogs/menus/popovers, confirmations, feedback,
`Panel`, `Sidebar`, `StatusBar`, `Split`, and `WindowChrome`.

`apps/cast/renderer/components` contains Cast-specific presentation and editing
building blocks: scene frames, thumbnails, item icons, collection and sortable
layouts, editor fields, media pickers, the error boundary, and the workbench
split-panel routing integration. Feature-owned controls remain local when they
carry domain behavior.

## 7. Terminology Notes

- `ItemType = 'presentation' | 'lyric'` and `ItemRef = { type: ItemType; id: Id }`
  come from `packages/composition/src/domain/items.ts`. Presentation and Lyric
  are separate entities/tables; there is no shared `Item` entity or
  `Presentation.kind` discriminator in the current model.
- Cast playlists are flat. A separator has its own name and color; there is
  no playlist group/segment hierarchy. Use the current separator and typed
  item APIs rather than the removed group/segment or deck-item APIs.
- Stage is the user-facing editor/surface term; canvas remains a technical
  rendering term. A Stage output window and the Stage editor are distinct.
- Do not rename persisted fields, IPC payloads, or drag contracts solely to
  match a renderer label. Item drag data uses `application/x-lumacast-item`
  with `{ itemType, itemId }`.
