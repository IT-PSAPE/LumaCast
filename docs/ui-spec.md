# LumaCast UI Specification

Updated on 2026-03-08.

## 1. Layout Structure

The renderer is organized around a `workbench` shell with three primary modes:

1. `show`
2. `slide-editor`
3. `overlay-editor`

Persistent shell surfaces:

1. `AppToolbar`
2. active workbench layout
3. `StatusBar`

Toolbar labels map to internal modes like this:

- `Show` -> `show`
- `Slides` -> `slide-editor`
- `Overlay` -> `overlay-editor`

Show mode layout:

- `LibraryPanel`
- `SlideBrowser`
- `ResourceDrawer`
- `PreviewPanel`

Slide editor layout:

- `SlideListPanel`
- `StagePanel`
- `SlideNotesPanel`
- `InspectorPanel`

Overlay editor layout:

- `OverlayListPanel`
- `StagePanel`
- `InspectorPanel`

## 2. Canonical Modes

Workbench mode:

- `show`
- `slide-editor`
- `overlay-editor`

Slide browser mode:

- `focus`
- `grid`
- `list`

Playlist browser mode:

- `current`
- `tabs`
- `continuous`

Library panel view:

- `libraries`
- `playlist`

Resource drawer tab:

- `media`
- `overlays`
- `presentations`

## 3. User-Facing Vocabulary

Use these product-surface labels in the renderer:

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

Use these structural/container labels for layout and implementation:

- `Workbench`
- `Panel`
- `Drawer`
- `Sidebar`
- `Stage`

## 4. Interaction Rules

- Show mode is optimized for browsing and output preview.
- Slide editor and overlay editor keep changes local until the user pushes them.
- `StageViewport` is shared across show, slide editing, overlay editing, preview, and NDI output flows through the shared stage/rendering feature.
- `LibraryPanelView` is UI state owned by the library browser, not navigation/domain state.
- The `Presentations` drawer tab shows the global presentation inventory; the component implementing it is `PresentationBinPanel`.

## 5. Keyboard Map

Global shortcuts, disabled while typing in editable fields:

- `ArrowRight`: next slide
- `ArrowLeft`: previous slide
- `1-9`: jump to slide index
- `Enter` or `Space`: take current slide
- `Delete` or `Backspace`: delete selected element
- `Alt + 1`: `focus` slide browser mode
- `Alt + 2`: `grid` slide browser mode
- `Alt + 3`: `list` slide browser mode
- `Alt + Shift + 1`: `current` playlist browser mode
- `Alt + Shift + 2`: `tabs` playlist browser mode
- `Alt + Shift + 3`: `continuous` playlist browser mode

## 6. Visual Reference

Detailed component-level captures live in [ui-code-design-spec.md](/Users/Craig/Developer/Projects/recast/docs/ui-code-design-spec.md) and [ui-spec-assets/manifest.md](/Users/Craig/Developer/Projects/recast/docs/ui-spec-assets/manifest.md).

Current workbench layout references:

![Show mode layout](./ui-spec-assets/app/show-mode-layout.png)
![Slide editor layout](./ui-spec-assets/app/slide-editor-layout.png)
![Overlay editor layout](./ui-spec-assets/app/overlay-editor-layout.png)

## 7. Implementation Guarantees

- Library references and playlist references remain reusable.
- Media drag/drop to the stage remains intact.
- Overlay assignment remains available from the Overlays drawer tab.
- Presentation browsing remains available from the Presentations drawer tab.
- NDI output remains driven by the shared render scene provider.
- Persisted presentation kinds remain `canvas` or `lyrics`.
