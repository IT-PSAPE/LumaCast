# ADR-0066: LumaStream per-source audio monitoring

- Status: Accepted
- Date: 2026-10-17

## Context

Stream routed every mixer source to both the program destination and the local
speakers. Monitoring a microphone by default can create feedback, and the
operator could not isolate a source for local listening.

## Decision

Persist an `audioMonitoring` mode on each source: `off`, `monitor-only`, or
`monitor-and-output`. The renderer audio graph splits after the meter into a
program gain and a local-monitor gain. Program membership and monitor selection
control those gains independently. Existing collections without the field
decode to `off`; the main program mix remains enabled unless the source is
muted, absent from the live scene, or set to Monitor Only.

## Consequences

The mixer can monitor a source without sending it to stream/recording, or send
it to both destinations. Browser-source audio remains unavailable because the
hidden browser renderer does not expose audio tracks to the mixer.
