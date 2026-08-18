# LumaCast UI Code Design Spec

Updated on 2026-08-18. Scope: `app/renderer` runtime structure and
terminology, verified directly against the current source tree. This
replaces an earlier version written for a `workbench` / `library-browser` /
`resource-drawer` / `slide-browser` / `stage` / `slide-editor` /
`overlay-editor` / `inspector` / `outputs` feature set and a `show-mode` /
`slide-editor` / `overlay-editor` screenshot set, none of which match the
current tree. See [renderer-taxonomy.md](./renderer-taxonomy.md) for the
canonical naming reference this document defers to.

## 1. Renderer UI Structure

```text
app/renderer
├── components
│   ├── controls
│   ├── display
│   ├── feedback
│   ├── form
│   ├── icon-group
│   ├── layout
│   └── overlays
├── contexts
│   ├── asset-editor
│   ├── canvas
│   ├── element
│   └── playback
├── features
│   ├── assets
│   ├── automation
│   ├── canvas
│   ├── command-palette
│   ├── inspector
│   ├── items
│   ├── observability
│   ├── playback
│   ├── playlists
│   └── workbench
├── hooks
├── rendering
├── screens
│   ├── item-editor
│   ├── macro-editor
│   ├── overlay-editor
│   ├── settings
│   ├── shared
│   ├── show
│   ├── stage-editor
│   └── theme-editor
├── types
└── utils
```

`app/renderer/rendering` holds the scene-graph traversal/render helpers
factored out of `features/canvas`; that split is under active development
(tracked separately from this documentation issue) — treat internals of
`features/canvas` and `rendering` as subject to change without notice here.

## 2. Provider Composition

`app/renderer/App.tsx` composes providers in this order:

1. `ErrorBoundary`
2. `WorkbenchProvider`
3. `ConfirmProvider`
4. `AppProvider`
5. `AssetEditorProvider`
6. `NavigationProvider`
7. `PlaybackProvider`
8. `SlideProvider`
9. `AutomationProvider`
10. `LyricEditorProvider`
11. `CreateItemProvider`
12. `CanvasProvider`
13. `CommandPaletteProvider`

Primary state ownership:

- `AppProvider` (`app-context.tsx`): snapshot loading/mutation, global
  undo/redo, status text.
- `NavigationProvider`: selected playlist, playlist row (item/separator), and
  item (`currentItemRef: ItemRef | null`). There is no library or group
  level.
- `WorkbenchProvider`: `workbenchMode`, drawer tab/view mode, inspector tab,
  program mode/surface/density, overlay (modal) stack.
- `SlideProvider`: current/live slide index, slide activation.
- `CanvasProvider` (`contexts/canvas/canvas-context.tsx`): active editor
  source shared across editor screens.
- `AssetEditorProvider`: staged theme/asset drafts and persisted-ID
  resolution (see `docs/ARCHITECTURE.md`, "Staged Theme Resolution").
- `PlaybackProvider`: program/monitor/stage output state.
- `AutomationProvider`: cue/macro/trigger-binding state.

## 3. Feature Ownership

See [renderer-taxonomy.md](./renderer-taxonomy.md) (section 4, "Features")
for the authoritative feature-to-directory table
(`workbench`, `playlists`, `items`, `canvas`, `inspector`, `assets`,
`automation`, `playback`, `command-palette`, `observability`).

## 4. Canonical Terminology

See [renderer-taxonomy.md](./renderer-taxonomy.md#1-canonical-modes) for the
canonical `WorkbenchMode`, `SlideBrowserMode`, `PlaylistBrowserMode`,
`DrawerTab`, `InspectorTab`, and program-surface types, and
[section 7, "Terminology Notes"](./renderer-taxonomy.md#7-terminology-notes)
for `Item`/`ItemType`/`ItemRef` and the flat-playlist/`Separator` vocabulary.
There is no `LibraryPanelView` — the library/collection concept was
destroyed (issue #219).

Persisted `Presentation.kind` values remain `canvas | lyrics`; storage naming
was not migrated when the UI's "canvas" terminology moved to "stage".

## 5. Shared Base Components

Shared primitives live in `app/renderer/components`, grouped by directory:
`controls` (`Button`, `ButtonGroup`, `SegmentedControl`), `display`
(`Accordion`, `EmptyState`, `EntityIcon`, `LazySceneStage`, `SceneFrame`,
`SelectableRow`, `Tabs`, `Text`, `Thumbnail`), `feedback` (`ErrorBoundary`),
`form` (`Checkbox`, `ColorPicker`, doc editor blocks, `Dropdown`, `Field`
variants, `FileTrigger`, `GridSizeSlider`, `RenameField`), `layout`
(`CollectionLayout`, `Panel`, split/resizable-split panels, `ScrollArea`,
`ThumbnailGrid`), and `overlays` (`ConfirmDialog`, `ContextMenu`, `Dialog`,
`MediaPickerDialog`, overlay primitives, `Popover`).

Feature-owned controls remain feature-local when the behavior is
domain-coupled — for example, `OutputSettingsPanel` stays in
`features/playback`.

## 6. Screens

| Screen | `data-ui-region` on its root/major panels |
| --- | --- |
| `show` | `app-toolbar`, `resource-drawer`, `status-bar` |
| `item-editor` | `item-editor-layout`, `slide-notes-panel`, `inspector-panel` |
| `overlay-editor` | `editor-layout`, `inspector-panel` |
| `theme-editor` | `editor-layout`, `inspector-panel` |
| `stage-editor` | `editor-layout`, `inspector-panel` |
| `macro-editor` | `editor-layout`, `cue-list-panel`, `macro-inspector-panel` |
| `settings` | `settings-layout` |
| `shared` (`element-layers-panel.tsx`) | `object-list-panel` (used by item-editor, overlay-editor, theme-editor, stage-editor) |

Full layout composition (panel-by-panel) for each screen lives in
[ui-spec.md](./ui-spec.md); this table exists so automation (screenshot
capture, Playwright locators) has one authoritative region-name list.

## 7. Screenshot Generation — currently non-functional

`npm run capture:ui-screenshots` (`app/e2e/capture-ui-screenshots.mjs`) is
not currently maintained against this renderer: its Playwright selectors and
seed-data IPC calls target a prior screen/region layout and IPC method set
that no longer exist (for example `castApi.createPlaylistSegment` /
`castApi.addDeckItemToSegment`, superseded first by `createPlaylistGroup` /
`addDeckItemToGroup` and then, once playlist groups were destroyed in favor
of flat separator rows (issue #219), by `createSeparator` /
`addItemToPlaylist`). No screenshots are committed under
`docs/ui-spec-assets/` (the directory does not exist) and none are embedded
in this document. The script now fails fast with an explanatory error
instead of silently producing broken or partial output. A future screenshot
capture implementation must rewrite its selectors and seed-data calls against
the region names in Section 6.

## 8. Reference

- Canonical naming: [renderer-taxonomy.md](./renderer-taxonomy.md)
- Layout detail: [ui-spec.md](./ui-spec.md)
- Keyboard shortcuts: [keyboard-shortcuts.md](./keyboard-shortcuts.md)
