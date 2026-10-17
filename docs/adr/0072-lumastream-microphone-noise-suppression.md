# ADR-0072: LumaStream microphone noise suppression

- Status: Superseded by ADR-0082
- Date: 2026-10-17

## Context

Microphone sources currently request raw audio with browser noise processing
disabled. Operators need an optional way to reduce steady background noise
without changing the gate, expander, or compressor stages.

## Decision

Add a per-microphone noise suppression setting using the media track
`noiseSuppression` constraint. Apply it at capture and through
`MediaStreamTrack.applyConstraints()` when the setting changes on a live
microphone. Keep echo cancellation and automatic gain control disabled. Main
validates and persists the setting with the source; older collections default
it off.

## Consequences

The setting follows Chromium and the microphone's available capabilities. Stream
reports when the requested setting is not reflected by the active track. This
does not provide a neural noise suppression model or processing for non-
microphone sources.
