# ADR-0020: Lossless Threaded NDI Audio Submission

## Status

Accepted; transport consequence superseded by ADR-0021

## Date

2026-08-30

## Context

NDI runs in an Electron utility process and video readback already runs in a
renderer Web Worker, but the native addon submitted audio synchronously on the
same utility-process JavaScript thread used for 1920x1080 video conversion and
submission. A slide change could therefore put audio behind video work at the
last host-to-SDK boundary even though Web Audio capture itself ran on its audio
rendering thread.

Moving audio to another thread must not change the established A/V timing
contract, drop captured samples, reorder them, or destroy the shared NDI sender
while audio is still in flight.

## Decision

- Give every native NDI sender a dedicated audio submission thread. Audience
  and stage outputs have independent queues and workers while continuing to use
  their existing shared audio mix.
- Copy each validated planar audio frame into a bounded FIFO before returning
  to the utility host. When the FIFO reaches its eight-frame capacity, apply
  producer backpressure until the worker advances; never drop or reorder audio.
- Preserve the existing timing model. Web Audio supplies samples at its device
  clock, NDI synthesizes audio and video timecodes, and both native
  `clock_audio` and `clock_video` remain disabled. The thread changes where the
  audio send executes, not which component owns timing.
- On sender rebuild or teardown, stop accepting frames, drain the FIFO in
  order, join the audio thread, and only then destroy the shared NDI handle.

This decision extends ADR-0017's renderer-owned video pacing without changing
its direct video transport or frame-release contract, and supersedes only its
then-current consequence that audio transport was unchanged.

## Consequences

- Native video work cannot block an audio frame already accepted by the
  sender's FIFO.
- Queue pressure may pause the NDI utility host during a pathological SDK
  stall. Preserving audio continuity and bounded memory takes precedence over
  silently discarding samples; renderer video backpressure can skip stale
  frames while the audio stream remains ordered.
- This decision originally retained the renderer-main and main-to-utility audio
  IPC route as the only transport. ADR-0021 later supersedes that consequence
  with a direct AudioWorklet-to-utility port while keeping the IPC route as a
  per-output fail-safe.
- Native regression coverage must verify unchanged clock flags, FIFO ordering,
  no loss under queue pressure, and destroy-time drain.
