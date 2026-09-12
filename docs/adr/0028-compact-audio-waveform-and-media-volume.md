# ADR 0028: Compact audio waveform and media volume

Status: Accepted

## Decision

Keep playback owned by the existing media elements. The audio transport displays a single waveform strip, a fixed-width item selector, a sync switch, and markers whose editors open in a popover. No permanent marker list or empty-state panel sits below the transport.

Decode the selected audio asynchronously with Web Audio for visual analysis only. Retain a bounded cache of four compact peak arrays, release decoded buffers, cancel stale fetches, and keep playback usable when waveform analysis fails. Permit fetches to the existing capability-checked `cast-media:` scheme in the renderer's `connect-src` policy; no filesystem or external-origin access is added.

Display the armed video as a compact filmstrip that is also its scrubber. Extract twelve sequential JPEG thumbnails with a detached, muted video element and canvas, never by seeking the live playback element. Cancel extraction when the armed asset changes, retain at most four completed filmstrips, and leave transport and scrubbing usable when preview extraction fails.

Audio and layer-video transports hold independent session volume values in the range 0–1, applied to their existing media elements. Mute is independent and preserves volume. The NDI audio graph consumes these same elements, so no second gain stage is added.

Use ambient Web Crypto for kernel IDs in both Node and browser contexts. A Node builtin import in the shared kernel broke marker creation in the renderer. Persisted UUID shape and deterministic fixture interception remain unchanged.

## Consequences

Waveform and filmstrip analysis do not own either playback clock. Filmstrip generation adds bounded background decode work when a video is armed, then releases its detached media element. Volume carries across track selections within the session and defaults to full volume after restart. Older running main processes receive a concise restart error when new schedule handlers are unavailable; failed edits are not reported as saved.
