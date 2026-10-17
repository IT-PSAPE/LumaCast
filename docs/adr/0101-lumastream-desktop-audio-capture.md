# ADR-0101: Windows desktop audio capture

## Status

Accepted

## Context

Stream needs a standalone desktop-audio source that enters the existing mixer
without depending on OBS or libobs. Electron's trusted desktop-media handler
already grants Windows system loopback when a renderer request asks for audio.
The Screen Capture API requires a video track and requires a user gesture for
each request.

## Decision

Add a persisted `desktop-audio` source that requests a display capture with
system audio after the user selects a display. Stop the video track immediately
and send only the audio track to Stream's existing mixer. If capture ends, or
Stream is restarted, the source remains in the scene and the user can start it
again from the source properties.

This is Windows system loopback. It does not promise a selectable output
endpoint or per-application audio capture. Stream does not auto-reconnect this
source because the display-capture API requires a user gesture.

## Consequences

- Desktop audio follows Stream's existing mute, volume, monitoring, meter, and
  output-track routing behavior.
- The required display selection is an authorization step; the selected
  display image is not included in the composition.
- Adding Desktop Audio Capture alongside a display capture that already
  includes system audio can mix the same system signal twice. The user can
  disable one route in the mixer or omit system audio from the display source.
- Other operating systems do not receive Windows loopback audio through this
  implementation.
