# ADR-0060: LumaStream Program Audio Routing

## Status

Accepted; Preview playback is superseded by ADR-0118, which extends its
program-bus gate to the local monitor.

## Date

2026-10-17

## Context

Studio Mode renders a preview scene alongside the live/program scene. The
renderer can hold media and capture routes for both, but preview audio must not
be mixed into the stream or recording before the scene transitions to program.

## Decision

- Keep the original visual-playback behavior for preview and program scenes;
  preview media and slideshow playback is superseded by ADR-0118.
- Route audio only from visible sources in the current live/program scene.
- Apply the program-scene mute gate when a source route is created and whenever
  the live scene, source visibility, mute, or volume changes. Local-monitor
  gating is superseded by ADR-0118.

## Consequences

Preview scenes remain visible without contributing audio to program buses.
Transitioning a scene to Program switches the mixer routes to its visible
audio sources. ADR-0118 extends this gate to the local monitor and requires
preview media and slideshow clocks to remain stopped. Scene duplication creates
independent routes without doubling preview audio into program output.
