# ADR-0074: LumaStream browser-source audio

- Status: Accepted
- Date: 2026-10-17

## Context

Browser sources rendered web overlays but muted page audio and did not route it
into the scene mixer. Operators need alerts, music, and other page audio to mix
with microphone and media sources.

## Decision

Add an opt-in, persisted Capture Audio setting to browser sources. Main waits for
the offscreen page to load, mints a WebContents capture ID scoped to the trusted
renderer, and temporarily authorizes the matching display-capture permission.
The renderer requests an audio-only `tab` stream and adds it to the existing
per-source audio mixer. Source volume, mute, monitoring, and audio filters then
apply through the normal route. Browser source audio remains off by default.

## Consequences

Capture IDs expire after ten seconds and are registered only for the main
renderer. A source with Capture Audio enabled restores its route with the scene
collection. This supersedes ADR-0058's browser-audio future-work limitation;
the sandboxed offscreen rendering and JPEG frame path remain unchanged.
