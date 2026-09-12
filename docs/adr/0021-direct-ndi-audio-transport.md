# ADR-0021: Direct NDI Audio Transport

## Status

Accepted

## Date

2026-08-30

## Context

ADR-0020 isolated native NDI audio submission from video conversion, but each
captured PCM frame still had to be delivered from the AudioWorklet through the
renderer event loop, Electron main IPC, and the NDI proxy before reaching the
utility process. A slide change can make the renderer event loop busy even
though the AudioWorklet continues running, delaying audio before it reaches the
native lossless FIFO and producing audible stutter.

Removing those event loops must preserve per-output ordering, the existing IPC
fail-safe, trust-boundary validation, and the established A/V timing contract.

## Decision

- Establish one versioned `MessagePort` per enabled NDI output. Main creates the
  channel and preload forwards the renderer endpoint; the renderer transfers it
  into the AudioWorklet, so steady-state PCM travels directly from the Web Audio
  rendering thread to the existing NDI utility process.
- Treat each direct channel as an optional, untrusted fast path. The worklet and
  utility complete a version/name handshake, and the utility validates output
  name, positive integer sample rate/channel/sample-count limits, `ArrayBuffer`
  identity, and the exact planar float32 byte length before calling the engine.
- Preserve FIFO delivery. A worklet port emits complete 1024-sample planar
  frames in capture order. When audience and stage are both ready, each output
  receives its own transferred buffer so ownership for one port cannot detach
  or mutate the other output's frame.
- Retain `sendNdiAudio` as a per-output fail-safe. An enabled output uses IPC
  until its direct handshake succeeds and returns to IPC after channel failure;
  an output with a ready direct port is excluded from the fallback message so a
  captured frame is never delivered twice.
- Keep the timing model unchanged. Web Audio remains the sample clock, NDI
  continues synthesizing audio and video timecodes, native `clock_audio` and
  `clock_video` remain disabled, and ADR-0020's lossless native FIFO continues
  to own SDK backpressure and teardown drain.

## Consequences

- Slide rendering and unrelated main-process work no longer sit on the normal
  captured-audio delivery path.
- Direct channel setup, status, and retry control still use renderer/main event
  loops, but captured audio continues through IPC while that control path is
  delayed or unavailable.
- The worklet performs one owned planar copy per ready output. This is small
  compared with video frame traffic and is required for safe transferable
  ownership when both outputs are enabled.
- Utility teardown closes both frame and audio ports before destroying the NDI
  service; native sender teardown still drains and joins its audio worker.
