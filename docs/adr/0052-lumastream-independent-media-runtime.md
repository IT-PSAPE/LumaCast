# ADR-0052: LumaStream Independent Media Runtime

## Status

Accepted

## Date

2026-10-17

## Context

The requested Windows-first Stream app should remain private and should not
inherit the GPL obligations of building on OBS Studio or `libobs`. It still
needs the standard live-production workflow: scenes, capture and media sources,
audio mixing, preview/program output, and recording. Stream is a standalone app
and is not part of the LumaCloud managed-product catalog.

## Decision

- Implement Stream in `apps/stream` as a separate Electron app. Keep its source
  private and do not incorporate OBS Studio or `libobs` code.
- Keep Electron, file-system, capture permission, and recording-file access in
  the main process. Expose a narrow typed API through a sandboxed preload.
- Persist scene collections as validated JSON. Copy imported media to a
  Stream-owned app-data directory, refer to assets by opaque ID and extension,
  and serve them through a range-capable custom protocol.
- Use the renderer's canvas compositor and Web Audio mixer for the initial
  independent preview/program and recording path. Save recordings incrementally
  as WebM chunks rather than buffering complete sessions in memory.
- Do not implement a plugin system. Expand native capture, output, encoding,
  replay, virtual-camera, browser-source, and filter capabilities as direct app
  features.

## Consequences

The initial app can ship scene composition, display/window/camera and
microphone capture, imported image/video/audio sources, audio monitoring and
mixing, Studio Mode transitions, and WebM recording without depending on OBS.
The browser media stack does not yet provide OBS-equivalent RTMP/encoder,
replay-buffer, virtual-camera, or advanced filter support. Stream is therefore
not yet at feature parity, and those capabilities require additional runtime
work before the objective is complete.
