# ADR-0104: User-initiated desktop capture reconnect

## Status

Accepted

## Context

Display and Window Capture sources save their selection and scene properties,
but their `MediaStream` tracks are transient. A saved source can therefore have
no live picture after Stream restarts, and an ended track leaves no action in
the source properties to restore it. Desktop capture is requested through
Chromium's display-media flow, which must remain tied to a user gesture and the
main-process source authorization path.

## Decision

Expose Reconnect Capture for saved or ended Display/Window Capture sources and
Change Capture for active ones. Both open the existing trusted picker for the
source's existing capture type. Selecting an option replaces the runtime under
the same source ID and updates only `captureId` and the cursor mode chosen in the
picker; all other source properties remain intact. Initialize the picker cursor
setting from the saved source. Do not start display/window capture
automatically on project load.

## Consequences

- Scene references, transforms, crop, visibility, audio settings, and source
  identity survive capture replacement.
- Users can restore a source after restart or track termination with a click;
  they must choose an available display/window each time.
- The reconnect flow preserves the current main-process authorization and
  Chromium user-gesture requirements instead of granting capture silently.
- This does not add OBS-specific capture-method or window-match controls.
