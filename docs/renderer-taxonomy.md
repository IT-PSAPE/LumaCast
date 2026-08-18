# Renderer Taxonomy

Updated on 2026-08-18. This document is the canonical naming and boundary
reference for `app/renderer`, derived directly from the current source tree.
It replaces an earlier version that documented a pre-refactor workbench
(`show` / `slide-editor` / `overlay-editor` only, a `LibraryPanel` +
`SlideBrowser` + `ResourceDrawer` + `PreviewPanel` layout, and a
`WorkspaceView` → `WorkbenchMode` rename history). That structure no longer
matches the code; see git history for the prior taxonomy and rename matrix if
you need the historical naming.

## 1. Canonical Modes

Source of truth: `app/renderer/types/ui.ts`.

- `WorkbenchMode`: `show | item-editor | overlay-editor | theme-editor | stage-editor | macro-editor | settings`
- `SlideBrowserMode`: `grid | list`
- `PlaylistBrowserMode`: `current | tabs | continuous`
- `ResourceDrawerViewMode`: `grid | list`
- `DrawerTab`: `deck | image | themes`
- `InspectorTab`: `presentation | slide | shape | text | theme | stage | binding | video | properties | triggers`
- `ProgramSurfaceKind`: `program | monitor | stage`
- `ProgramMode`: `single | all`
- `ProgramGridDensity`: `1 | 2`

## 2. Toolbar Label to Mode Mapping

From `app/renderer/features/workbench/app-toolbar.tsx`:

- `Show` -> `show`
- `Edit` -> `item-editor`
- `Overlay` -> `overlay-editor`
- `Themes` -> `theme-editor`
- `Stage` -> `stage-editor`
- `Macros` -> `macro-editor`

`settings` is not in the toolbar's segmented control; it is opened via the
toolbar's gear button and is a full workbench mode (`WorkbenchScreenRouter`
renders `SettingsScreen` for it), not a dialog.

The native application menu (`app/main/application-menu.ts`) labels the same
modes slightly differently in its View menu: `Show`, `Slides`, `Overlays`,
`Themes`, `Stage`, `Macros`, `Settings`.

## 3. Screens (`app/renderer/screens`)

Each `WorkbenchMode` (other than `show`, which is eagerly loaded) maps to a
lazily-loaded screen in `app/renderer/workbench-screen-router.tsx`:

| Screen directory | Workbench mode | Notes |
| --- | --- | --- |
| `show` | `show` | Landing surface; flat playlist browsing (with separator rows), slide/lyric browsing, resource drawer, program panel. Eagerly loaded. |
| `item-editor` | `item-editor` | Slide/lyric/talk editing: item picker, layers panel, stage, notes (or talk script blocks), inspector. |
| `overlay-editor` | `overlay-editor` | Overlay editing. |
| `theme-editor` | `theme-editor` | Theme editing. |
| `stage-editor` | `stage-editor` | Stage layout editing. |
| `macro-editor` | `macro-editor` | Macro/cue/trigger-binding editing (own `canvas-panel.tsx` alongside the shared layers/inspector pattern). |
| `settings` | `settings` | Tabs: Appearance, Output, Overlays, Observability, Import & Export (`app/renderer/screens/settings/page.tsx`). |
| `shared` | (n/a) | Cross-screen pieces shared by the editors above, currently `element-layers-panel.tsx`. |

Each editor screen (`item-editor`, `overlay-editor`, `theme-editor`,
`stage-editor`, `macro-editor`) follows the same `layers-panel.tsx` /
`inspector-panel.tsx` / `page.tsx` / `screen-context.tsx` file pattern.

## 4. Features (`app/renderer/features`)

| Feature | Owns |
| --- | --- |
| `workbench` | App shell, toolbar, mode switching, resource drawer, status bar, Windows inline menu bar, panel-visibility toggles |
| `playlists` | Flat playlist browsing and management: playlist panels, playlist rows (items and separators), separator color |
| `items` | Item (presentation/lyric/talk) browsing and editing support: slide/lyric/talk list and grid views, creation dialogs, import/export, bundle drag-and-drop, talk script blocks |
| `canvas` | Stage rendering primitives shared by every editor screen and the show screen (scene graph, stage viewport, element drag/resize, inline text editing). Under active refactor; see `app/renderer/rendering/` for the newer scene-traversal/scene-node-content split. |
| `inspector` | Presentation, slide, shape, text, theme, stage, and binding property inspectors |
| `assets` | Media, overlay, stage, and theme asset libraries (`audio`, `media`, `overlays`, `stages`, `themes` subdirectories) |
| `automation` | Cues, macros, trigger bindings: automation context, cue icons/descriptions, macro bin panel, slide automation/bindings menus |
| `playback` | NDI capture/output (audio and video), program (preview) panel, output settings |
| `command-palette` | The `Cmd/Ctrl+K` command palette |
| `observability` | Runtime metrics collection and the Observability settings panel |

A feature may not import another feature except through a documented public
edge; see `AGENTS.md` and `tool/check_electron_architecture.mjs` for the
enforced rule.

## 5. Contexts (`app/renderer/contexts`)

| Context | Responsibility |
| --- | --- |
| `app-context.tsx` (`AppProvider`) | Snapshot loading, mutation dispatch, global undo/redo, status text |
| `navigation-context.tsx` (`NavigationProvider`) | Selection and CRUD for playlist, playlist row (item/separator), item (`currentItemRef: ItemRef \| null`) |
| `workbench-context.tsx` (`WorkbenchProvider`) | `workbenchMode`, drawer tab/view-mode, inspector tab, program mode/surface/density, overlay stack |
| `slide-context.tsx` (`SlideProvider`) | Current/live slide index, slide activation, take/next/prev |
| `canvas/canvas-context.tsx` (`CanvasProvider`) | Active editor source and canvas-level state shared across editor screens |
| `element/` | Element selection, history (undo/redo), inspector sync, and command helpers used by the canvas |
| `asset-editor/asset-editor-context.tsx` (`AssetEditorProvider`) | Staged theme/asset editing and persisted-ID resolution (see `docs/ARCHITECTURE.md`) |
| `playback/playback-context.tsx` (`PlaybackProvider`) | Program/monitor/stage output state |
| `create-screen-context.tsx` | Shared scaffolding for the per-screen `screen-context.tsx` files |

Provider composition order is defined in `app/renderer/App.tsx`.

## 6. Shared Components (`app/renderer/components`)

- `controls`: `Button`, `ButtonGroup`, `SegmentedControl`
- `display`: `Accordion`, `EmptyState`, `EntityIcon`, `LazySceneStage`, `SceneFrame`, `SelectableRow`, `Tabs`, `Text`, `Thumbnail`
- `feedback`: `ErrorBoundary`
- `form`: `Checkbox`, `ColorPicker`, `DocEditor`/`DocSortableBlock`, `Dropdown`, `Field` (input/select/textarea), `FileTrigger`, `GridSizeSlider`, `RenameField`
- `layout`: `CollectionLayout`, `Panel`, `ResizableSplit` (`panel-split`, `resizable-split`), `ScrollArea`, `ThumbnailGrid`
- `overlays`: `ConfirmDialog`, `ContextMenu`, `Dialog`, `MediaPickerDialog`, overlay primitives, `Popover`

Feature-owned controls stay feature-local when the behavior is
domain-coupled (for example, `OutputSettingsPanel` stays in `playback`).

## 7. Terminology Notes

- Persisted `Presentation.kind` remains `canvas | lyrics` in storage; the UI
  no longer uses "canvas" as a rendering-surface term (that is now `stage`
  in the UI/`WorkbenchMode` sense), so do not conflate the two.
- Playlists are flat: there is no accordion, no collapse/expand, and no
  grouping entity. "Separator" (`createSeparator`/`renameSeparator`/
  `setSeparatorColor`) is the current term for the divider row that keeps its
  own name and color inside a playlist — never "group", "segment", or
  "divider" in code or new UI copy. Earlier drafts of this document blessed
  "Group" (`createPlaylistGroup`, `addDeckItemToGroup`) as the current term;
  that concept was destroyed (issue #219) and is not to be reintroduced.
- Database and IPC payload names are not renamed to match renderer UI terms
  unless required by the renderer.
- "Item" is the generic word wherever code structurally needs "one of
  presentation | lyric | talk" — it replaces "deck item" everywhere: types,
  IPC params, macro scope, drag payloads, UI copy. `ItemType = 'presentation'
  | 'lyric' | 'talk'`; `ItemRef = { type: ItemType; id: Id }` is the typed
  reference used for selection, playback arming, macro scope contexts, and
  drag payloads (drag MIME `application/x-lumacast-item`, payload
  `{ itemType, itemId }`). There is no `Item` base interface or union entity —
  `Presentation`, `Lyric`, and `Talk` are separate interfaces that merely
  happen to share fields; which one an entity is comes from which table/array
  it came from, never from a discriminant field.
