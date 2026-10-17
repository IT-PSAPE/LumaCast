# ADR-0071: LumaStream per-source downward expander

- Status: Accepted
- Date: 2026-10-17

## Context

Stream's source mixer now supports threshold-based noise gating. Operators also
need a less abrupt way to reduce low-level room noise while keeping quiet speech
audible.

## Decision

Add an optional per-source downward expander with threshold, ratio, attack, and
release settings. Apply it in the existing renderer AudioWorklet alongside the
noise gate, before the Web Audio compressor and limiter. Main validates the
persisted ranges; scene collections that predate the expander load it disabled.

## Consequences

The expander reuses the source-level measurement and audio path, so it can be
applied independently or together with the gate. It does not add a plugin
system. Noise suppression remains a separate audio capability.
