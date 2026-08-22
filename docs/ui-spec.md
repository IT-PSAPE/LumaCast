# LumaCast UI Specification

Updated on 2026-08-18. This document describes the current renderer shell and
screen layout as implemented. It replaces an earlier version describing a
`show` / `slide-editor` / `overlay-editor` workbench with a fixed
`LibraryPanel` + `SlideBrowser` + `ResourceDrawer` + `PreviewPanel` layout;
that structure predates the current screen set. For naming/boundary detail
behind this document, see [renderer-taxonomy.md](./renderer-taxonomy.md).

## 1. Shell Structure

`app/renderer/App.tsx` renders a persistent shell:

1. `WindowsInlineMenuBar` wrapping `AppToolbar` (`data-ui-region="app-toolbar"`)
2. The active screen, chosen by `WorkbenchScreenRouter` from `workbenchMode`
3. `StatusBar` (`data-ui-region="status-bar"`)

## 2. Canonical Workbench Modes

`WorkbenchMode` (`app/renderer/types/ui.ts`): `show | item-editor |
overlay-editor | theme-editor | stage-editor | macro-editor | settings`.

Toolbar segmented-control labels map to modes as:

- `Show` -> `show`
- `Edit` -> `item-editor`
- `Overlay` -> `overlay-editor`
- `Themes` -> `theme-editor`
- `Stage` -> `stage-editor`
- `Macros` -> `macro-editor`

`settings` is reached from the toolbar's gear button, not the segmented
control.

## 3. Screen Layouts

### Show (`show-*` split-panel ids)

- Left: `PlaylistPanels` (flat playlist tree: item rows and separator rows,
  no library or group level)
- Center: `DeckBrowserToolbar`, `SlideBrowserContent` / `ContinuousSlideBrowser`, `ResourceDrawer`
- Right: `ProgramPanel`

### Item Editor (`data-ui-region="item-editor-layout"`)

- Left: item picker (searchable, across presentations/lyrics/talks) + slide
  list, and a Layers panel (`ItemEditorLayersPanel`)
- Center: `StagePanel`, and either `TalkScriptBlocksPanel` (for Talk items) or
  a notes textarea (`data-ui-region="slide-notes-panel"`)
- Right: `ItemEditorInspectorPanel` (`data-ui-region="inspector-panel"`)

### Overlay Editor, Theme Editor, Stage Editor (`data-ui-region="editor-layout"`)

Same three-pane shape as Item Editor (list/layers, stage, inspector). The
layers panel for these three screens is the shared
`screens/shared/element-layers-panel.tsx` (`data-ui-region="object-list-panel"`).

### Macro Editor (`data-ui-region="editor-layout"`)

Own layers panel for cues (`data-ui-region="cue-list-panel"`), its own
`canvas-panel.tsx`, and its own inspector
(`data-ui-region="macro-inspector-panel"`) rather than reusing the shared
element inspector.

### Settings (`data-ui-region="settings-layout"`)

Tab list: Appearance, Output, Overlays, Media, Observability, Import & Export.

## 4. Keyboard Shortcuts

See [keyboard-shortcuts.md](./keyboard-shortcuts.md) for the full, generated
map of native menu accelerators and in-app shortcuts. That document is the
single source of truth; do not duplicate the shortcut table here.

## 5. Screenshot Generation — currently non-functional

`npm run capture:ui-screenshots` runs `app/e2e/capture-ui-screenshots.mjs`.
That script was written against an earlier renderer (`data-ui-region` values
such as `library-panel`, `slide-browser`, `slide-list-panel`, and IPC calls
such as `castApi.createPlaylistSegment` / `castApi.addDeckItemToSegment`)
that no longer exist in this codebase. The region names in Section 3 above
are current; the IPC surface has moved on twice since — first to
`createPlaylistGroup` / `addDeckItemToGroup`, then (issue #219: playlist
groups destroyed in favor of flat separator rows) to `createSeparator` /
`addItemToPlaylist`. It currently exits immediately with an explanatory error
instead of silently failing partway through a capture. No screenshot assets
are checked into `docs/ui-spec-assets/` (the directory does not exist), so
none are referenced from this document. Regenerating a real screenshot set
in a future implementation requires rewriting the capture script's selectors
and seed-data calls against the current screens.

## 6. Implementation Guarantees

- Playlist and separator references remain reusable across items — a
  Presentation, Lyric, or Talk can appear in more than one playlist. There is
  no library or group level any more (issue #219).
- Media drag/drop onto the stage remains intact.
- Persisted `Presentation.kind` remains `canvas | lyrics` in storage.
- NDI output remains driven by the shared canvas/stage rendering feature.
