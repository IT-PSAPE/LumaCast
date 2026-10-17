# ADR-0109: Separate LumaStream canvas and output resolutions

## Status

Accepted

## Context

Stream's single width and height currently determine source coordinates, preview
dimensions, recording frames, and the encoded stream. OBS exposes a base canvas
for source layout and a separate output resolution for streaming and recording.
Operators need to compose at a display or production resolution while sending a
smaller output to encoders. ADR-0109 supersedes the single-resolution model in
ADR-0078 while retaining its custom-resolution controls.

## Decision

- Store `baseWidth` and `baseHeight` alongside the existing scaled `width` and
  `height` in the active output profile.
- Keep scaled output dimensions within the live encoder's supported range
  (320–7680 × 240–4320, with even pixel dimensions).
- Keep source transforms in base-canvas coordinates. Fit the canvas uniformly
  inside the scaled output and center it, adding black bars when the aspect
  ratios differ.
- Render the composition directly at scaled output dimensions so recording,
  replay, and streaming receive the configured output size.
- Decode older projects and profiles without base dimensions by using their
  former output dimensions for both canvas and output.

## Consequences

Operators can downscale the finished composition for encoding without changing
source layout. Changing the base canvas does not reposition existing sources.
Profiles carry both dimensions; scene collections continue to carry source
transforms in canvas coordinates.
