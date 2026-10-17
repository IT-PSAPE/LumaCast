# ADR-0065: LumaStream Recording Containers

## Status

Accepted; the single-file MediaRecorder input and WebM fast path are superseded
by ADR-0087 when selected audio tracks need muxing. Container choices and
temporary-output publication remain.

## Date

2026-10-17

## Context

Stream recorded only WebM. Production workflows commonly use MP4 for playback
and Matroska as a resilient capture container, in addition to WebM.

## Decision

- Persist a recording container choice (`webm`, `mkv`, or `mp4`) alongside the
  existing video and audio bitrate settings.
- Record program canvas and mixed audio incrementally to a temporary WebM file.
  Publish WebM directly after close; remux Matroska without re-encoding; encode
  MP4 as H.264/AAC with the bundled Windows Media Foundation encoder.
- Use temporary output files and rename the finished result into place only
  after the finalizer succeeds. On conversion failure, preserve the temporary
  WebM under a recovery filename and report it to the user.
- Save replay captures with the selected recording container and bitrate
  settings. Track finalization in main so shutdown waits for active exports.

## Consequences

Users can choose WebM, Matroska, or MP4 for recordings and saved replays.
Matroska retains the MediaRecorder VP9/Opus streams; MP4 requires a second encode
and can take time after recording stops. MP4 depends on the Windows H.264 Media
Foundation encoder; a failed export leaves a recoverable WebM capture.

This supersedes ADR-0062's then-current WebM-only limitation; its persisted
bitrate settings remain the source of the selected recording rates.
