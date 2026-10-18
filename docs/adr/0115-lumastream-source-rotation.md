# ADR-0115: Add source rotation to LumaStream

## Status

Accepted.

## Context

Stream supports position and size transforms but cannot rotate a source or a
grouped composition. Rotation must work consistently in preview, program,
selection and pointer editing, project persistence, and nested source groups.
Chroma-keyed image and video sources render through a full-canvas WebGL buffer,
so rotating that buffer through the 2D canvas context would rotate the entire
scene.

## Decision

- Store an optional clockwise angle in degrees on each source transform and
  normalize it to the signed range [-180, 180). Project decoding supplies zero
  for legacy transforms and rejects non-canonical persisted angles.
- Rotate leaf drawing and selection geometry around the source center. Hit
  testing inverse-rotates the pointer into source-local coordinates; resizing
  projects pointer movement into local axes and holds the opposite anchor fixed.
- Rotate chroma-key destination geometry in its WebGL shader so the full-canvas
  keyed frame remains aligned with the rest of the composition.
- Apply a group angle delta to visual descendants around the group's prior
  center, updating each descendant's angle and position. Keep audio-only child
  transforms and routing unchanged. Recompute group bounds from rotated visual
  leaves, and preserve the baked child geometry when moving, resizing, or
  ungrouping.

## Consequences

Existing projects decode as zero degrees and continue to render as before.
Rotated visual extents may extend beyond the stored unrotated source rectangle;
group bounds and selection hit targets account for that geometry. Group rotation
does not add a parent render matrix, so child sources remain ordinary scene-space
transforms across persistence, copy/paste, and ungrouping.
