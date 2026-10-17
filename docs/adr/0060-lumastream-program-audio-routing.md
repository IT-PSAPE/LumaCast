# ADR-0060: LumaStream Program Audio Routing

## Status

Accepted

## Date

2026-10-17

## Context

Studio Mode renders a preview scene alongside the live/program scene. The
renderer can hold media and capture routes for both, but preview audio must not
be mixed into the stream or recording before the scene is taken.

## Decision

- Keep visual playback active for preview and program scenes.
- Route audio only from visible sources in the current live/program scene.
- Apply the program-scene mute gate when a source route is created and whenever
  the live scene, source visibility, mute, or volume changes.

## Consequences

Preview scenes remain visible without contributing their audio. Taking a scene
switches the mixer routes to its visible audio sources. Scene duplication
creates independent routes without doubling preview audio into program output.
