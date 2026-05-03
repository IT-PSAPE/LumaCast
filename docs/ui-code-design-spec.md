# LumaCast UI Code Design Spec

Updated on 2026-03-08.
Scope: `app/renderer` runtime structure, terminology, and screenshot coverage after the workbench, library-browser, slide-browser, and stage refactor.

## 1. Renderer UI Structure

```text
app/renderer
├── components
│   └── resizable-split
├── contexts
├── features
│   ├── inspector
│   ├── library-browser
│   ├── outputs
│   ├── overlay-editor
│   ├── playback
│   ├── resource-drawer
│   ├── slide-browser
│   ├── slide-editor
│   ├── stage
│   └── workbench
├── hooks
├── spec
├── types
└── utils
```

Legacy renderer surface names such as `workspace`, `command bar`, `sidebar rail`, and `preview rail` are no longer canonical.

## 2. Provider Composition

`app/renderer/App.tsx` composes providers in this order:

1. `ThemeProvider`
2. `CastProvider`
3. `NdiProvider`
4. `NavigationProvider`
5. `PresentationLayerProvider`
6. `SlideProvider`
7. `WorkbenchProvider`
8. `SlideBrowserProvider`
9. `ResourceDrawerProvider`
10. `InspectorProvider`
11. `LibraryPanelProvider`
12. `OverlayEditorProvider`
13. `SlideEditorProvider`
14. `ElementProvider`
15. `RenderSceneProvider`

Primary state ownership:

- `NavigationContext`: selected library, playlist, presentation, playlist presentation, and related CRUD.
- `PresentationLayerContext`: assigned media layer, assigned overlay layer, and content-layer visibility.
- `SlideContext`: current slide index, live slide index, slide activation, notes persistence.
- `WorkbenchContext`: `workbenchMode`.
- `SlideBrowserContext`: `slideBrowserMode`, `playlistBrowserMode`.
- `ResourceDrawerContext`: `drawerTab`.
- `InspectorContext`: `inspectorTab`.
- `LibraryPanelContext`: `libraryPanelView`.
- `OverlayEditorContext`: overlay draft collection, current overlay, push state.
- `SlideEditorContext`: slide draft buffer, per-slide effective elements, push state.

## 3. Feature Ownership

- `workbench`: app shell, toolbar, mode switching, split-layout orchestration, panel visibility.
- `library-browser`: library selector, playlist list, segment/presentation tree, library panel view state, context menus.
- `slide-browser`: show-mode center surface, focus/grid/list browsing, current/tabs/continuous playlist browsing, slide thumbnails and outline rows.
- `resource-drawer`: drawer shell, Media tab, Overlays tab, Presentations tab, drawer filtering and creation affordances.
- `stage`: stage viewport, stage toolbar, stage panel shell, live and thumbnail scene rendering.
- `slide-editor`: slide list, object list, notes draft workflow, slide push workflow.
- `overlay-editor`: overlay list, object list reuse, overlay draft workflow, overlay push workflow.
- `inspector`: presentation, slide, shape, text, and overlay inspector states.
- `outputs`: live preview, layer clearing, output toggle, NDI output emitter.

## 4. Canonical Terminology

User-facing surface terms:

- `Library`
- `Playlist`
- `Segments`
- `Presentations`
- `Continuous Playlist`
- `Slide Browser`
- `Preview`
- `Slide Editor`
- `Overlay Editor`
- `Media`
- `Overlays`
- `Inspector`

Internal shell/container terms:

- `Workbench`
- `Panel`
- `Drawer`
- `Sidebar`
- `Stage`

Toolbar label to mode mapping:

- `Show` -> `workbenchMode = 'show'`
- `Slides` -> `workbenchMode = 'slide-editor'`
- `Overlay` -> `workbenchMode = 'overlay-editor'`

Mode and state terms from `app/renderer/types/ui.ts`:

- `workbenchMode`: `show | slide-editor | overlay-editor`
- `slideBrowserMode`: `focus | grid | list`
- `playlistBrowserMode`: `current | tabs | continuous`
- `drawerTab`: `media | overlays | presentations`
- `inspectorTab`: `presentation | slide | shape | text`
- `libraryPanelView`: `libraries | playlist`

Persisted `Presentation.kind` values remain `canvas | lyrics`; storage naming was not migrated during this refactor.

## 5. Shared Base Components

Shared primitives live in `app/renderer/components`.

Current shared component set:

- `Badge`
- `Button`
- `CheckboxField`
- `CheckboxSection`
- `ContextMenu`
- `EditableText`
- `EmptyStatePanel`
- `ErrorBoundary`
- `FieldInput`
- `FieldSelect`
- `FieldTextarea`
- `IconButton`
- `MediaPickerDialog`
- `Panel`
- `PanelSection`
- `SceneFrame`
- `SearchField`
- `SegmentedControl`
- `SelectableRow`
- `SettingsDialog`
- `TabBar`
- `ThumbnailTile`
- `ResizableSplitRoot`
- `ResizableSplitPane`
- `ResizableSplitHandle`
- `TwoPaneVerticalSplit`

Feature-owned controls remain feature-local when the behavior is domain-coupled. `OutputToggle` stays in `features/outputs` for that reason.

## 6. Layout Summary

Show mode:

- Left: `LibraryPanel`
- Center: `SlideBrowser`
- Bottom: `ResourceDrawer`
- Right: `PreviewPanel`

Slide editor:

- Left: `SlideListPanel`
- Center: `StagePanel`
- Bottom center: `SlideNotesPanel`
- Right: `InspectorPanel`

Overlay editor:

- Left: `OverlayListPanel`
- Center: `StagePanel`
- Right: `InspectorPanel`

## 7. Screenshot Generation

The screenshot set is generated by:

```bash
npm run capture:ui-screenshots
```

Artifacts are written to `docs/ui-spec-assets/` and indexed in `docs/ui-spec-assets/manifest.md`.

## 8. Shared Micro Components

### Shared Actions

States covered:

- `Button`: `default`, `take`, `danger`, `ghost`, `disabled`
- `IconButton`: primary action, menu action, disabled
- `Badge`: `live`, `queued`, `selected`, `warning`

![Shared actions](./ui-spec-assets/shared/shared-actions.png)

### Shared Fields

States covered:

- `SearchField`: populated filter state
- `CheckboxField`: checked and unchecked
- `CheckboxSection`: enabled with child content, disabled collapsed
- `FieldInput`, `FieldSelect`, `FieldTextarea`: self-labeling field controls with optional icons

![Shared fields](./ui-spec-assets/shared/shared-fields.png)

### Shared Navigation

States covered:

- `SegmentedControl`: single-selection workbench switcher
- `SegmentedControl`: multi-selection panel toggles
- `TabBar`: resource tabs and inspector tabs
- `SelectableRow`: default and selected

![Shared navigation](./ui-spec-assets/shared/shared-navigation.png)

### Shared Display

States covered:

- `Panel`
- `PanelSection`
- `EditableText`: resting and editing
- `ThumbnailTile`: default and selected
- `SceneFrame`: plain and checkerboard-backed
- `EmptyStatePanel`

![Shared display](./ui-spec-assets/shared/shared-display.png)

### Shared Dialogs

States covered:

- `SettingsDialog`: open
- `MediaPickerDialog`: open with available assets

![Shared dialogs](./ui-spec-assets/shared/shared-dialogs.png)

## 9. App-Level Components

### AppToolbar

States covered:

- `show`
- `slide-editor`
- `overlay-editor`

![App toolbar show](./ui-spec-assets/app/app-toolbar-show.png)
![App toolbar slide editor](./ui-spec-assets/app/app-toolbar-slide-editor.png)
![App toolbar overlay editor](./ui-spec-assets/app/app-toolbar-overlay-editor.png)

### Workbench Layouts

States covered:

- `ShowModeLayout`
- `SlideEditorLayout`
- `OverlayEditorLayout`

![Show mode layout](./ui-spec-assets/app/show-mode-layout.png)
![Slide editor layout](./ui-spec-assets/app/slide-editor-layout.png)
![Overlay editor layout](./ui-spec-assets/app/overlay-editor-layout.png)

### SettingsDialog and StatusBar

States covered:

- settings dialog open from the app toolbar
- settings sidebar on `Appearance`, `Outputs`, and `Overlays`
- status bar with current cast status and audience indicator

![Settings dialog](./ui-spec-assets/app/settings-dialog.png)
![Settings dialog appearance](./ui-spec-assets/app/settings-dialog-appearance.png)
![Settings dialog outputs](./ui-spec-assets/app/settings-dialog-outputs.png)
![Settings dialog overlays](./ui-spec-assets/app/settings-dialog-overlays.png)
![Status bar](./ui-spec-assets/app/status-bar.png)

## 10. Feature-Level Components

### Library Browser

States covered:

- `LibraryPanel` with `libraryPanelView = 'libraries'`
- `LibraryPanel` with `libraryPanelView = 'playlist'`

![Library panel libraries](./ui-spec-assets/features/library-panel-libraries.png)
![Library panel playlist](./ui-spec-assets/features/library-panel-playlist.png)

### Slide Browser

States covered:

- `focus`
- `grid + current`
- `list + current`
- `grid + tabs`
- `grid + continuous`
- `list + continuous`

![Slide browser focus](./ui-spec-assets/features/slide-browser-focus.png)
![Slide browser grid current](./ui-spec-assets/features/slide-browser-grid-current.png)
![Slide browser list current](./ui-spec-assets/features/slide-browser-list-current.png)
![Slide browser tabs](./ui-spec-assets/features/slide-browser-tabs.png)
![Slide browser continuous grid](./ui-spec-assets/features/slide-browser-continuous-grid.png)
![Slide browser continuous list](./ui-spec-assets/features/slide-browser-continuous-list.png)

### Resource Drawer

States covered:

- `media`
- `presentations`
- `themes`

![Resource drawer media](./ui-spec-assets/features/resource-drawer-media.png)
![Resource drawer presentations](./ui-spec-assets/features/resource-drawer-presentations.png)
![Resource drawer themes](./ui-spec-assets/features/resource-drawer-themes.png)

### Outputs

States covered:

- `PreviewPanel` with content and media assigned
- `PreviewPanel` overlays tab with active overlay controls
- `PreviewPanel` audio tab empty state

![Preview panel](./ui-spec-assets/features/preview-panel.png)
![Preview panel overlays](./ui-spec-assets/features/preview-panel-overlays.png)
![Preview panel audio](./ui-spec-assets/features/preview-panel-audio.png)

### Slide Editor

States covered:

- `SlideListPanel`
- `SlideNotesPanel`
- `ObjectListPanel`
- `StagePanel` in `slide-editor`

![Slide list panel](./ui-spec-assets/features/slide-list-panel.png)
![Slide notes panel](./ui-spec-assets/features/slide-notes-panel.png)
![Object list panel](./ui-spec-assets/features/object-list-panel.png)
![Stage panel slide editor](./ui-spec-assets/features/stage-panel-slide-editor.png)

### Overlay Editor

States covered:

- `OverlayListPanel`
- `StagePanel` in `overlay-editor`

![Overlay list panel](./ui-spec-assets/features/overlay-list-panel.png)
![Stage panel overlay editor](./ui-spec-assets/features/stage-panel-overlay-editor.png)

### Inspector

States covered:

- `presentation`
- `shape`
- `text`
- overlay editing with the `Overlay` inspector branch

![Inspector presentation](./ui-spec-assets/features/inspector-presentation.png)
![Inspector shape](./ui-spec-assets/features/inspector-shape.png)
![Inspector text](./ui-spec-assets/features/inspector-text.png)
![Inspector overlay](./ui-spec-assets/features/inspector-overlay.png)

## 11. Reference

- Canonical naming and rename history: [renderer-taxonomy.md](/Users/Craig/Developer/Projects/recast/docs/renderer-taxonomy.md)
- Screenshot inventory: [ui-spec-assets/manifest.md](/Users/Craig/Developer/Projects/recast/docs/ui-spec-assets/manifest.md)
