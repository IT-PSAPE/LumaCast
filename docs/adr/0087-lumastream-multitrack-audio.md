# ADR-0087: Add six-track audio routing and recording

## Status

Accepted

## Context

OBS users expect per-source audio track routing, one selected stream mix, and
separate tracks in recordings. Stream uses an independent renderer audio graph
and Chromium MediaRecorder. A single MediaRecorder output cannot represent the
six independently routed audio tracks needed by recordings.

## Decision

Create six program audio destination buses in Stream's Web Audio mixer. Sources
persist a set of bus assignments, defaulting to Track 1 for existing projects.
The streaming output selects one bus. Recording and Replay Buffer capture video
and each selected audio bus with separate MediaRecorder instances, then pass the
resulting WebM streams to the bundled FFmpeg executable to mux as WebM, Matroska,
or MP4. Recording settings persist selected audio tracks and default older
projects to Track 1.

## Consequences

Audio track routing remains independent of the stream mix, and each recording
container can carry multiple selected audio streams. Recording uses additional
encoders and temporary files in proportion to the number of enabled tracks;
finalization is required when audio tracks are selected, including for WebM.
If muxing fails, Stream preserves each temporary WebM stream for recovery.
