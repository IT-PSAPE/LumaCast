# ADR-0100: LumaStream camera capture modes

## Status

Accepted

## Context

Stream used to request 1280 × 720 from every camera and left frame-rate choice
entirely to the browser. Users with higher-resolution or high-frame-rate
devices could not request their intended capture mode, and camera lists were
not refreshed when devices changed while the app was open.

## Decision

- Persist a camera resolution preset and frame-rate preset on each camera
  source.
- Support Device Default and common 360p through 4K resolutions, plus 15, 24,
  25, 30, 50, and 60 FPS.
- Pass selected modes as ideal MediaTrackConstraints so devices can negotiate
  the closest supported mode rather than failing an exact request.
- Reacquire an active camera stream when its requested mode changes, and refresh
  enumerated device lists on `devicechange`.

## Consequences

Camera settings are available through Chromium's media-device API and persist
with scene collections. Requested presets are best-effort; the device may
provide a different mode when it cannot satisfy the requested dimensions or
frame rate. Native driver configuration and advanced DirectShow properties
remain unavailable.
