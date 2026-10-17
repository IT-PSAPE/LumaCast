# ADR-0058: LumaStream Browser Sources

## Status

Accepted

## Date

2026-10-17

## Context

Browser sources are a common way to add web overlays and graphics to a live
scene. Stream needs to render them without granting remote page content access
to the app's main window or preload bridge.

## Decision

- Persist a validated HTTP(S) URL on a browser source.
- Render each source in a separate hidden, offscreen `BrowserWindow` with
  sandboxing, context isolation, no Node integration, blocked popups, and
  HTTP(S)-only navigation.
- Send JPEG frames to the trusted renderer through a dedicated IPC event and
  composite them as visual sources. Mute page audio and cap viewports at
  1920×1080 before frame transfer.

## Consequences

Stream can composite dynamic web pages as visual overlays. Each source uses a
separate Chromium page and transfers frames through main, which costs CPU and
IPC bandwidth. Page audio routing and detailed browser-source controls remain
future work.
