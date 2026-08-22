# ADR-0017: Direct NDI Frame Transport and Renderer-Owned Pacing

## Status

Accepted

## Date

2026-08-22

## Context

Issue #246 found two avoidable costs in the NDI video path. Each 1920x1080
four-byte frame crossed the renderer/main and main/utility boundaries on the
copy transport, while the native NDI sender also applied its own video clock to
a renderer loop that already enforced one-frame backpressure and cadence.

Electron 35 did not preserve the frame `ArrayBuffer` when a transfer list was
used on the worker-to-utility route. Sending without a transfer list was
reliable, but required an explicit decision about where the single structured
clone should occur and which process boundaries own validation, release, and
latency timestamps.

ADR-0011 already established the correct release semantics: a monotonic
attempt remains in flight until the host-side send returns or is rejected, and
that release does not claim downstream receiver capacity. Those semantics must
survive any transport optimization.

## Decision

- Establish a versioned `MessagePort` per NDI output. Main creates the channel
  and preload forwards the renderer endpoint, but frame bytes travel directly
  from `ndi-readback-worker` to the NDI utility process. The worker deliberately
  posts without a transfer list, producing one structured clone away from the
  renderer and main-process event loops.
- Treat the port as an untrusted, optional fast path.
  - The worker and utility must complete a bounded version/name handshake.
  - The renderer validates the forwarded window message and output name.
  - The utility validates the output name, bounded attempt id, fixed
    1920x1080 dimensions, exact four-byte-per-pixel buffer length, and sanitized
    advisory telemetry before calling the engine.
  - Main/utility-owned timestamps cannot be supplied through the direct path.
- Preserve one-frame backpressure and ADR-0011 release semantics. The utility
  associates each direct attempt with its originating port and returns the
  engine's matching `frameReleased` on that port. Only that matching release
  clears the renderer slot; invalid frames receive a rejected release.
- Keep the existing `sendNdiFrame` renderer -> main -> proxy -> utility route as
  the fallback. Handshake timeout, an invalid handshake or host response, host
  absence, channel closure, or the renderer release watchdog closes the direct
  channel, uses the copy path, and requests a replacement port with bounded
  exponential backoff. The backoff resets only after a successful direct
  handshake. A malformed frame is rejected through the ordinary attempt
  release contract.
- Keep pipeline attribution truthful. Copy-path timestamps populate
  `rendererToMainIpc`, `mainHandler`, and `mainToHostIpc`; direct frames omit
  those stamps and populate `directWorkerToHostIpc`. Both routes retain
  `hostToNative`.
- Declare native video frames as 30000/1001 progressive and create NDI senders
  with `clock_video=false`. The renderer capture/release loop owns pacing; the
  native SDK must not independently block the send call to pace video.

This decision supersedes only ADR-0011's original renderer -> main -> proxy ->
utility route as the normal video path. ADR-0011's attempt identity,
host-release meaning, one-slot backpressure, watchdog, corrective retry, and
take-correlation decisions remain in force.

## Consequences

- A normal video frame incurs one structured clone between the readback worker
  and utility process, without scheduling the 8 MB payload on the renderer or
  main-process event loops.
- The direct path can fail independently without disabling output; the copy
  transport remains available while the channel reconnects.
- Direct and fallback latency samples remain distinguishable instead of
  attributing work to process boundaries the frame did not cross.
- Native sends return under renderer-owned pacing rather than stacking the NDI
  SDK clock on top of the renderer's one-frame lifecycle.
- Audio transport is unchanged.
