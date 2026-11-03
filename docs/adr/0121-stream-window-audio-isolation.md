# ADR-0121: Stream window audio isolation

## Status

Accepted

## Context

Selecting one video window must not capture sound from another window, such as
a browser meeting alongside a YouTube video. The existing macOS Core Audio tap
and Windows WASAPI loopback helpers capture an app or process tree. Window
ownership alone cannot prove which process produces only that window's audio;
browsers can share audio services across windows.

## Decision

Window Capture stays video-only until a backend can establish window-level audio
isolation. Its Capture audio checkbox is disabled and explains the limitation.
It never substitutes application or system audio. Display, standalone
Application Audio, Desktop Audio, and camera sources retain their explicit audio
choices. Application Audio's interface states that it includes other windows of
the selected app.

Shared effective-mode resolution returns off for every window source. Acquisition
and restore request no audio; runtime attachment discards unexpected audio tracks
and releases legacy broader audio routes while preserving video. Main grants
Windows system loopback only for screen selections. Saved legacy audio intent
can remain in project metadata, but cannot start capture and produces a warning
when restoring/reconnecting that window.

A Browser source offers isolated page audio via the source webContents' own
media-source ID. This is a separate page owned by Stream; it does not claim to
isolate an arbitrary external browser window.

## Consequences

- Existing window sources can lose previously configured app/system audio.
  Video remains usable and the UI reports why audio is unavailable.
- A future window-audio implementation must demonstrate that one selected window
  excludes a second simultaneously audible window, including shared browser
  processes, before enabling this option.
- The local Browser-source regression probe uses two independent tones and the
  actual manager-to-renderer capture path. It verifies page isolation without
  capturing user audio or contacting a streaming provider.

## References

- [Apple ScreenCaptureKit audio scope](https://developer.apple.com/videos/play/wwdc2022/10155/)
- [Microsoft process-loopback scope](https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/)
