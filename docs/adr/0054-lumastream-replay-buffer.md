# ADR-0054: LumaStream Replay Buffer

## Status

Accepted; the single mixed-audio recorder implementation is superseded by
ADR-0087. Replay duration choices, in-memory retention, and save flow remain.

## Date

2026-10-17

## Context

The OBS-style workflow needs a rolling buffer that can save recent program
output on demand. Stream already records the program canvas and the audio mixer
as WebM, and its main process owns the save dialog and file writes.

## Decision

- Capture the program canvas and mixed audio with a dedicated renderer
  `MediaRecorder` while Replay Buffer is active.
- Retain the first WebM initialization chunk and recent time-sliced chunks in a
  renderer-side ring. Offer 5, 15, 30, and 60 second windows.
- On Save Replay, write the retained initialization chunk and current window in
  order through the existing main-process recording session. Do not persist the
  buffer or its settings in the scene collection.

## Consequences

The renderer keeps up to one minute of encoded media in memory, separate from
live streaming and recording. Replay Buffer stops when the app exits; saving
uses WebM and the same user-selected file flow as a normal recording. A disk-
backed replay buffer and codec-independent replay format remain future work.
