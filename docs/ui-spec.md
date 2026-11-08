# LumaCast UI Specification

Updated on 2026-11-08. Scope: the Cast renderer in `apps/cast/renderer`.
[Renderer taxonomy](./renderer-taxonomy.md) defines names and ownership;
[UI code design](./ui-code-design-spec.md) describes composition and shared UI.

## 1. Shell Structure

`apps/cast/renderer/shell/app-layout-content.tsx` composes the persistent shell:

1. `AppToolbar`, including platform-aware window chrome and `InlineMenuBar`
   (`data-ui-region="app-toolbar"`).
2. A main area showing the active screen through `WorkbenchScreenRouter`, or
   snapshot startup loading/error/retry state before project data is available.
3. `StatusBar` (`data-ui-region="status-bar"`).

The toolbar and status bar remain outside the screen router. Root providers,
output gates, command palette, assistant popup, and render host are composed in
`apps/cast/renderer/App.tsx`.

## 2. Canonical Workbench Modes

`WorkbenchMode` in `apps/cast/renderer/types/ui.ts` contains `show`,
`item-editor`, `overlay-editor`, `theme-editor`, `stage-editor`, `macro-editor`,
and `settings`.

| Entry point | Label | Mode |
| --- | --- | --- |
| Primary view control | Show | `show` |
| Primary view control | Edit | `item-editor` |
| Primary view control | Themes | `theme-editor` |
| More views menu | Overlay | `overlay-editor` |
| More views menu | Stage | `stage-editor` |
| More views menu | Macros | `macro-editor` |
| Settings gear | Settings | `settings` |

The separate Audience and Stage toolbar buttons toggle output windows;
selecting Stage in More views opens the stage editor. Settings is a full
screen, not a dialog. The router eagerly loads Show and lazily loads editors
and Settings.

## 3. Screen Layouts

### Show (`show-*` split-panel ids)

- Left: `PlaylistPanels`, containing playlists and flat item/separator rows.
- Center: `DeckBrowserToolbar` and the current item's `SlideBrowserContent`,
  or the empty logo state; `ResourceDrawer` occupies the collapsible bottom pane.
- Right: `ProgramPanel`, including program surfaces and its lower resource tabs.

The drawer tabs are Deck, Themes, Images, Videos, and Audio. Playlist tabs in
the browser toolbar depend on the current browsing state.

### Item Editor (`data-ui-region="item-editor-layout"`)

- Left: searchable item picker, slide list, and `ItemEditorLayersPanel`.
- Center: `StagePanel` and the collapsible notes textarea
  (`data-ui-region="slide-notes-panel"`).
- Right: `ItemEditorInspectorPanel` (`data-ui-region="inspector-panel"`).

### Overlay, Theme, and Stage Editors (`data-ui-region="editor-layout"`)

Each composes a list/layers pane, stage, and inspector. Their layers panel
comes from `apps/cast/renderer/screens/shared/element-layers-panel.tsx`
(`data-ui-region="object-list-panel"`); their inspector region is
`inspector-panel`.

### Macro Editor (`data-ui-region="editor-layout"`)

Composes macro selection and cue layers (`cue-list-panel`), its own canvas,
and its own inspector (`macro-inspector-panel`). Macro cues use their own
layers/inspector components rather than the shared scene-element inspector.

### Settings (`data-ui-region="settings-layout"`)

Sidebar entries: Appearance, Output, Overlays, Media, Assistant, Observability,
and Import & Export. The selected entry is stored as `settingsTab` in the
workbench context.

## 4. Keyboard Shortcuts

[Keyboard shortcuts](./keyboard-shortcuts.md) is the authoritative native-menu
and in-app shortcut map. Scope automation to the relevant toolbar, menu, or
panel when a label is reused across output controls and editor navigation.

## 5. UI Verification and Diagnostics

The maintained Cast Electron checks live in `tests/apps/cast/e2e` and run with
`npm run test:e2e`. Add `-- --trace on` to retain Playwright diagnostics.
The media-crop checks also write screenshots under `test-results/`.

There is no maintained full-screen documentation screenshot generator or
committed `docs/ui-spec-assets` set. The obsolete `capture:ui-screenshots`
alias and its failing stub have been removed; they did not capture any UI.
Use current accessible labels and the region list in
[UI code design](./ui-code-design-spec.md#6-screens) when extending the existing
tests, and inspect the resulting renders before treating them as visual proof.

## 6. Data and Rendering Contracts

Presentations and lyrics are separate entities, referenced through `ItemRef`;
see `packages/composition/src/domain/items.ts`. Playlists contain flat item and
separator rows. Renderer terminology does not change persisted contracts.
Stage/editor rendering and NDI outputs share rendering and media components;
their ownership is documented in [renderer taxonomy](./renderer-taxonomy.md)
and [architecture](./ARCHITECTURE.md).
