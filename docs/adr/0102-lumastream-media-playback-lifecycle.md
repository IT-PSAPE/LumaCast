# ADR-0102: Media source playback lifecycle

## Status

Accepted; preview activation behavior is superseded by ADR-0118.

## Context

Stream media sources already pause while inactive and restart after becoming
active because asset binding and activation shared one effect. They lacked the
OBS-like controls for restart-on-activation and clearing the final video frame.
New media also looped by default, unlike OBS Media Source defaults.

## Decision

Persist three media source settings: `loop` defaults off,
`restartPlaybackWhenActive` defaults on, and `showNothingWhenPlaybackEnds`
defaults on. Separate asset binding from activation so inactive media pauses
without unloading. When restart-on-activation is off, activation resumes from
the saved playback position. Canvas composition skips the final video frame
when end-frame clearing is enabled. Source properties also provide Play/Pause,
Restart, and Stop controls. ADR-0118 narrows playback activation to Program and
any retained outgoing visual; Preview activation does not start media playback.

## Consequences

- Media playback settings travel with the scene collection and duplicate with
  their source.
- Older collections without the new settings inherit the OBS-compatible
  restart and end-frame defaults.
- The current renderer still depends on Chromium's supported media codecs and
  does not add VLC playlist support or hardware-decoding controls.
