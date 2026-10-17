# ADR-0073: LumaStream encoder controls

- Status: Accepted
- Date: 2026-10-17

## Context

Stream's live output and MP4 finalizer used a fixed Media Foundation H.264
configuration. Operators need control over rate mode, quality, keyframe spacing,
and whether the Windows encoder should require hardware acceleration.

## Decision

Persist separate live and MP4 encoder settings with each scene collection.
Expose CBR, peak-constrained VBR, unconstrained VBR, and quality rate control;
an encoder quality value; a one-to-ten-second keyframe interval; and an opt-in
hardware-encoding flag. Translate these settings into the bundled FFmpeg
`h264_mf` options. WebM recording and Matroska remuxing continue to use their
existing MediaRecorder output and do not apply MP4 finalizer controls.

## Consequences

Quality mode ignores the video bitrate control; other modes use bitrate, with
CBR and peak-constrained VBR adding their corresponding maximum rate and buffer
settings. Hardware encoding is opt-in because availability depends on the
Windows device. Unsupported hardware requests surface as an encoder failure.
Other encoder families and advanced output controls remain separate work.
