# ADR-0069: LumaStream input device selection

- Status: Accepted
- Date: 2026-10-17

## Context

Camera and microphone sources always used the system default even though the
source model already had an opaque `deviceId` field. Operators need to select a
specific capture device and have it restored with an active scene.

## Decision

After obtaining Chromium media permission, enumerate video and audio input
devices in the trusted renderer. Allow camera and microphone sources to select
a device and persist its device ID with the source. When a saved camera or
microphone source becomes visible in the preview or program scene, request its
saved device through `getUserMedia`; sources without an ID use the default.
Continue to run the stream through the existing renderer audio and video paths.

## Consequences

Device IDs travel with duplicated scenes and collections. If a saved device is
unavailable or permission is denied, Stream reports the capture error and the
operator can select another available device. Device labels are not used as
identifiers.
