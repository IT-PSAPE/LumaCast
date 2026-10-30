# ADR-0076: LumaStream docked production workbench

- Status: Accepted
- Date: 2026-10-17

## Context

The original Stream workbench placed the preview between scene and output
panels, leaving scene and source management separated across rows. The operator
needs a persistent view of the program output and the controls used during a
live session.

## Decision

Place the program preview across the top of the workbench. Place Scenes,
Sources, Audio Mixer, and Controls in four dock panels below it. Keep transition
type, duration, Studio Mode, and the Studio Mode transition action beside the
preview.
Keep streaming, recording, replay, and Studio Mode actions in Controls.
Fit the preview canvas inside the remaining work area using the configured
output dimensions as its aspect ratio. Recompute the fit when the window, Studio
Mode, or output resolution changes, and use the fitted rectangle for source
selection and transforms. Render collection, scene, source, and settings
popovers outside dock clipping and flip them when their preferred direction
would exceed the viewport.

## Consequences

The preview receives the largest work area and remains visible while scenes,
sources, audio levels, and output controls stay available at the same time. The
preview preserves the configured output aspect ratio instead of cropping its
edges as the workbench resizes. Menus opened near a window edge flip toward the
available space and long menus scroll within that space. The four dock panels
use responsive minimum widths; narrow Windows screens keep a 960-pixel minimum
workbench width. Stream-specific styling and controls remain independent from
the other LumaCast apps.
