# ADR-0067: LumaStream GPU chroma key

- Status: Accepted
- Date: 2026-10-17

## Context

Stream's scene compositor supports per-source color correction but cannot
remove a solid background from camera or media sources. CPU pixel processing at
the program canvas frame rate would make high-resolution scenes expensive.

## Decision

Persist an optional chroma-key filter on visual capture, camera, image, browser,
and video sources. Store enablement, key color, similarity, and smoothness in the
scene collection; validate them in main. Apply the key in a small WebGL fragment
shader for each current source frame, then draw its transparent canvas into the
existing 2D compositor. Keep source placement, transitions, and output encoding
in the existing canvas path.

## Consequences

Keying runs on the graphics path rather than reading full-resolution pixels
back to JavaScript. WebGL context loss or initialization failure leaves the
source unkeyed until the compositor is recreated. Chroma spill suppression and
other advanced key filters remain future work.
