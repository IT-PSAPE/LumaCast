# ADR-0050: Non-destructive Media Cropping

## Status

Accepted.

## Date

2026-10-07

## Context

Object-fit centers media within its element. Users need to crop with the
existing canvas handles while retaining the media's pixel scale and placement.
Contain-fit media can leave asymmetric margins after a frame edge is cropped.

## Decision

- Image/video payloads have optional nullable normalized rectangles: `crop`
  selects a source region; `cropFrame` places it within the element frame.
  Both have finite `x`, `y`, `width`, and `height` in zero to one, positive
  extents, and bounds wholly within their reference rectangle. IPC and action
  codecs validate them. Missing/null uses the full reference rectangle;
  explicit null can clear an inherited rectangle.
- The canvas package owns cropping through transformer handles. Holding
  Command on macOS or Control on Windows/Linux when a gesture starts selects
  cropping for one unlocked image/video. Corners preserve the initial frame
  aspect ratio; edge handles operate on their own axis. Ordinary resizing,
  rotation, and other element types keep their existing interactions.
- Crop gestures retain the starting full-source draw mapping. The frame changes
  around stationary media pixels, accounting for viewport scale, rotation,
  flips, current object-fit, and prior crops. Outward drags reveal previously
  hidden source pixels up to the source bounds. Original letterbox margins may
  remain, but gestures cannot add new padding beyond the original frame.
  `cropFrame` retains asymmetric margins without recentering/rescaling content.
  Frame edges cannot cross or shrink below 16 scene units (or an already smaller
  initial extent). An empty source intersection keeps the last valid crop.
- A gesture previews through buffered drafts and commits one history update
  with frame geometry plus crop fields. It preserves the source, object-fit,
  orientation, styling, and video playback settings. Saves merge into the base
  payload and explicitly record crop inheritance overrides; resolved theme
  styling is not copied into the authored payload. A failed commit removes its
  preview. Unloaded media blocks cropping until dimensions are available.
- The shared media renderer maps the normalized source region into the
  normalized destination box before object-fit. The contract applies to image
  proxies, video frames, nested groups, and every rendering surface. Existing
  payload JSON storage requires no database migration.

## Consequences

Cropping survives save/reload, undo/redo, duplication, and bundle transfer.
The original files remain intact. Normal resizing scales the resulting cropped
media using its existing object-fit. Slide backgrounds retain their current
object-fit controls. No modal or separate Crop action is introduced.
