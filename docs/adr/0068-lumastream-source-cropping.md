# ADR-0068: LumaStream source crop and pad

- Status: Accepted
- Date: 2026-10-17

## Context

Stream can position and resize sources, but cannot trim unwanted areas such as
capture borders or camera edges. Crop is a common non-destructive scene editing
operation.

## Decision

Persist integer top, right, bottom, and left crop values in source pixels for
capture, camera, image, browser, and video sources. Validate the values in main.
At render time, clamp them to the current source dimensions, crop the source
frame, then scale the remaining area into the existing source transform. Use the
same crop rectangle for normal drawing and chroma-key texture coordinates.

## Consequences

Crop settings travel with scene collections and do not modify imported media.
Sources with no usable area after cropping are not drawn. Dynamic sources apply
the same pixel values as their reported dimensions change.
