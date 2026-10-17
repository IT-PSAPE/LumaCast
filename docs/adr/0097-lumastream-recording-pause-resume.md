# ADR-0097: LumaStream recording pause and resume

## Status

Accepted

## Context

Recording uses separate MediaRecorder instances for the program video and each
selected audio track. Pause and resume need to keep those streams aligned and
must still allow the existing recording finalizer to collect every stream.

## Decision

- Treat pause and resume as session-wide operations across every recording
  channel. Apply an operation only when all channels are in the expected state.
- Track paused intervals in the renderer and exclude them from the displayed
  elapsed recording time.
- Allow stop while paused by stopping every paused recorder through the normal
  stop/data/finalization path.
- Expose Pause/Resume and Stop Rec controls, and show a paused status in the
  Controls dock.

## Consequences

Pausing suspends encoded output on all configured recording tracks together.
The final recording contains no media for paused intervals, and the timer
reflects only active recording time. Pause state remains session-local and does
not alter saved profile or scene-collection data.
