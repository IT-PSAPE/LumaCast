# ADR 0027: Picker-only bundle import

Status: Accepted

## Context

The global bundle drop listener treated every file drag as a bundle import gesture. Dragging audio or images over the application showed the bundle overlay and could intercept media-bin workflows.

## Decision

Remove the global bundle drop importer. Import `.cst` bundles through the existing Choose bundle file picker, inspection, and confirmation flow. Media bins retain their scoped file-drop behavior. A navigation-only guard prevents dropped files from replacing the application document; it does not inspect files, import content, or show an overlay.

## Consequences

File drops target the relevant media controls. Dropping a bundle over the application does not start an import. Internal reorder gestures retain their existing handlers.
