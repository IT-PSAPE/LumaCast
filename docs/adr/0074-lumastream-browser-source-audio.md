# ADR-0074: LumaStream browser-source audio

- Status: Accepted
- Date: 2026-10-17

## Context

Browser sources rendered web overlays but muted page audio and did not route it
into the scene mixer. Operators need alerts, music, and other page audio to mix
with microphone and media sources.

## Decision

Add an opt-in, persisted Capture Audio setting to browser sources. Main waits for
the offscreen page to load, mints a WebContents capture ID scoped to the trusted
renderer, and temporarily authorizes the matching display-capture permission.
The renderer requests an audio-only `tab` stream and adds it to the existing
per-source audio mixer. Source volume, mute, monitoring, and audio filters then
apply through the normal route. Browser source audio remains off by default.

## Consequences

Capture IDs expire after ten seconds and are registered only for the main
renderer. A source with Capture Audio enabled restores its route with the scene
collection. This supersedes ADR-0058's browser-audio future-work limitation;
the sandboxed offscreen rendering and JPEG frame path remain unchanged.

## Browser-source permission boundary

The persistent browser-source session installs permission request and check
handlers before loading remote content. Checks always deny, and requests deny by
default. Camera, microphone, notification, child-frame, and other source-owned
requests receive no grant. The trusted renderer's default-session policy is
unchanged, as are the partition's cookies and cache.

Chromium attributes legacy tab-audio requests to the captured source frame while
retaining the original requester's native `securityOrigin`. An unconditional
request denial therefore breaks tab audio; accepting all empty media requests
would also permit source-owned legacy capture. Main instead permits one explicit
empty-media request for a source-specific, ten-second authorization minted for
the current trusted requester. The native origin must match that requester and
differ from the source. Source and requester frame, URL, navigation, ownership,
and expiry checks guard the authorization; use, navigation, replacement, or
closure retires it and its listeners. Native file-origin spellings are normalized
explicitly; missing and opaque origins are rejected.

A browser source at the app renderer's own development origin can still render,
but its audio capture is rejected. The callback does not expose an original
requester identity that could safely distinguish those same-origin requests.
