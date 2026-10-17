# ADR-0075: LumaStream encoder families

- Status: Accepted
- Date: 2026-10-17

## Context

Stream initially encoded H.264 through Media Foundation only. Windows systems
can have NVIDIA, Intel, or AMD hardware encoders, and a CPU-only encoder is
needed for systems without compatible hardware. Encoder settings must remain
usable for RTMP/RTMPS output and MP4 recording while preserving old collections.

## Decision

Persist independent encoder-family choices for live output and MP4 recording.
Support Media Foundation, NVIDIA NVENC, Intel Quick Sync, AMD AMF, and software
OpenH264 from the pinned LGPL FFmpeg build. Existing collections default to
Media Foundation. The renderer only offers rate-control modes supported by the
selected family; changing to a family that does not support the current mode
selects CBR. Family-specific arguments map quality, latency, rate control,
bitrate limits, and keyframe interval to that encoder's FFmpeg options.

Hardware-specific families require a compatible device and driver and may fail
when output starts. Media Foundation's existing software/hardware selection
remains available only for that family. Encoder settings apply to RTMP/RTMPS
and MP4; WebM and Matroska recording retain their MediaRecorder/remux paths.

## Consequences

The build preparation step verifies all five H.264 encoders and AAC are present
in the pinned FFmpeg runtime. Unsupported hardware is reported by the output
runtime, and users can choose another family. This decision supersedes ADR-0073's
statement that other encoder families remain separate work; the original
Media Foundation rate-control behavior remains in effect.
