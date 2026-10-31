# ADR-0119: LumaStream NDI capture and Program output

## Status

Accepted

## Date

2026-10-31

## Context

Stream needs network video/audio sources and an independent NDI Program output.
Cast already owns a native NDI sender bridge, but its presentation output engine
is not Stream's canvas and mixer. Loading the native runtime in Stream's main or
renderer process would expose normal streaming and recording to native crashes.

## Decision

- Extend the existing optional native bridge with discovery and receivers. Keep
  Cast's sender defaults and contracts. Load NDI dynamically; do not redistribute
  the vendor runtime or require it for ordinary Stream startup.
- Run Stream's native bridge in a dedicated Electron utility process. Main owns
  trusted-renderer authorization, opaque receive/send sessions, validation,
  request timeouts, bounded pending video sends, and shutdown. The host permits
  eight receivers and one sender. Discovery and receive work use native async
  workers; serialized receiver polling is nonblocking, with an 8 ms renderer
  delay after an empty read so unavailable sources do not hold up output.
- Receive copied BGRA frames up to 8,294,400 pixels and planar float audio. Free
  vendor-owned frames before returning copied data. Render video to a canvas
  stream and audio through a Web Audio destination; attach both through Stream's
  existing capture resource and mixer contracts. Resource ownership follows the
  draft, Program, and outgoing snapshots. Audio enablement is in resource identity
  to preserve Studio Mode isolation. Signal loss shows the no-signal fallback and reports status;
  an ended host session requires explicit reconnect.
- Broadcast the Program canvas with the chosen mixer track. Scale video to fit
  1920 × 1080 and use the configured frame rate up to 60 FPS; send stereo 48 kHz audio. Keep
  one renderer video submission and one audio packet in flight. Drop congested
  audio rather than accumulate latency. Unsupported input audio formats are
  dropped while video continues.
- Persist source identity and audio preference, but never native sessions or
  active outputs. Start and stop NDI independently of RTMP and recording. Closing
  a settings dialog leaves an explicitly started output running; closing Stream
  releases all NDI resources.

## Consequences

NDI requires a platform-built addon and an installed compatible NDI Runtime.
Missing dependencies produce an NDI error while other app features stay usable.
CPU conversion and process copies make this a bounded 1080p output path, rather
than Cast's GPU presentation transport. A future higher-resolution output would
need a separate performance decision. Discovery depends on local network NDI
visibility; the source list can be refreshed without restarting Stream.
The production window keeps rendering while minimized by disabling background
throttling. Visibility-gated status/account polling also continues in this
window; this trades background power and provider polling for uninterrupted
capture and output.
