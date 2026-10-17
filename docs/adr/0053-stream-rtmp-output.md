# ADR-0053: LumaStream RTMP Output

## Status

Accepted

## Date

2026-10-17

## Context

LumaStream needs an independent RTMP output path to support live streaming
without incorporating OBS Studio or `libobs`. The renderer already owns the
program canvas and mixed audio, while Electron main owns output processes and
the trust boundary. Windows-first support permits using Windows Media
Foundation for H.264 encoding.

## Decision

- Capture the program canvas and the audio-mixer destination in the renderer,
  then send chunked WebM media over the typed IPC bridge.
- Run a pinned Windows x64 shared FFmpeg build from Stream's bundled media
  directory. Main starts it without a shell; FFmpeg encodes H.264/AAC and sends
  FLV to an RTMP or RTMPS endpoint.
- Accept only validated RTMP/RTMPS destinations and bounded output settings.
  Keep the destination out of project persistence, status messages, and raw
  error logs. Never resolve the runtime from `PATH`.
- Package the exact LGPL license notice, runtime provenance, and references to
  the corresponding FFmpeg source and build recipe. Verify the archive checksum
  and reject builds that enable GPL or nonfree components.

## Consequences

Stream gains configurable RTMP/RTMPS output and a live bitrate indicator. The
separate FFmpeg process and shared DLLs increase installer size and introduce
LGPL source and notice obligations for distributed builds. The current private
checkout includes provenance and upstream references but not the complete
corresponding source package needed for binary distribution. Replay buffer,
virtual camera, browser sources, filters, and further OBS output controls are
still needed for the full requested feature set.
