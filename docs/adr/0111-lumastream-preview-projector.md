# ADR-0111: Add a preview projector window

## Status

Accepted

## Context

Stream can project its full-resolution Program canvas to a separate display,
but operators cannot view the uncommitted Preview scene outside the workbench.
Preview is distinct from Program only in Studio Mode; Multiview replaces the
two-panel stage with a scene grid.

## Decision

- Add a separate sandboxed Preview projector that mirrors the existing
  full-resolution Preview canvas and does not open another capture session.
- Show its control only while Studio Mode is active and Multiview is off.
- Close the Preview projector when the Preview canvas unmounts as Studio Mode
  ends or Multiview opens.
- Keep Program and Preview windows, media tracks, and close watchers independent.
- Continue to admit only inherited-origin `about:blank` renderer popups. The
  window name distinguishes the title for presentation; it does not grant
  popup access.

## Consequences

The Preview projector shows the current Preview scene without applying the
Program transition or its audio route. It adds no second full-resolution scene
render because it captures the canvas already used by the Preview panel. A mode
change closes its window instead of leaving a frozen or blank feed.
