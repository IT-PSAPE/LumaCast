# ADR-0070: LumaStream per-source noise gate

- Status: Accepted
- Date: 2026-10-17

## Context

Stream already routes source audio through a renderer-owned Web Audio graph.
Microphone sources need a noise gate to reduce low-level room and device noise
between speech without affecting other source routes.

## Decision

Add an optional per-source noise gate with open and close thresholds, attack,
hold, and release settings. A renderer AudioWorklet measures the source level
and applies the gate before the existing compressor and limiter. Main validates
the persisted ranges, and collections created before this filter existed load
with the gate disabled and the documented default values.

## Consequences

The filter works on any source already routed through the renderer audio mixer.
It depends on AudioWorklet support; if the processor cannot load, Stream keeps
the source audio route intact and reports that the gate is unavailable when it
is enabled. Noise suppression remains separate work.
