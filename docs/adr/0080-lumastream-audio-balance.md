# ADR-0080: LumaStream per-source audio balance

- Status: Accepted
- Date: 2026-10-17

## Context

Stream's audio mixer offered per-source volume and mute controls but no stereo
balance control.

## Decision

Persist a normalized balance value from -1 (left) to 1 (right), defaulting older
sources to 0 (center). Apply the setting through a Web Audio `StereoPannerNode`
before splitting the signal to program output and local monitoring. Expose a
balance slider when an audio source is selected.

## Consequences

Each source can be placed in the stereo field without changing its source
volume, monitoring mode, or program routing.
