# ADR-0083: LumaStream audio gain filter

- Status: Accepted
- Date: 2026-10-17

## Context

Audio source volume is a mixer fader, but OBS-style per-source processing also
needs an independent gain filter that runs before compression and limiting.

## Decision

- Persist per-source filter gain in decibels, bounded from -30 dB to +30 dB.
- Convert that value to linear gain in the Web Audio mixer and apply it after
  the noise gate/expander, before the compressor and limiter.
- Default older project files and newly created sources to 0 dB.

## Consequences

The filter gain is independent of the source's existing 0–200% mixer fader and
is validated with the rest of the audio filter settings at project load.
