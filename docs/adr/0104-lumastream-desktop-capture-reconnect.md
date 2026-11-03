# ADR-0104: Durable desktop capture reconnect

## Status

Accepted

## Context

Display and Window Capture sources save their selection and scene properties,
but their `MediaStream` tracks and Electron desktop source IDs are transient.
A saved source can therefore have no live picture after Stream restarts, and
an ended track can leave a warning even while the same target is still open.
Electron's display-media flow is user-gesture gated, so it cannot restore a
saved source during startup.

## Decision

Persist durable target clues alongside the current Electron `captureId`:
`display_id` for screens, and the exact current title plus a hash of the
application icon for windows. A window may first rebind through the same native
handle when its app icon still matches, even if the title changed. If that
handle is unavailable, rebind only to a unique exact title and app-icon match.
Do not choose among ambiguous matches or use title alone. Legacy sources
without metadata may reconnect only when both their current ID and saved source
name still match.

On project load or track end, enumerate fresh desktop sources and resolve with
those clues. If the match is unique, automatically request a replacement stream
using Electron's legacy desktop `getUserMedia` source-ID constraints and a
short-lived, one-shot main-process authorization scoped to the trusted renderer.
This path is separate from the user-gesture `getDisplayMedia` picker path.
Persist the refreshed ID and clues after attaching the stream. Keep automatic
retries bounded; if no safe match or live track is available, show an actionable
unavailable status and leave Reconnect Capture available. Reconnect Capture
and Change Capture continue to use the existing picker and update only capture
binding metadata and cursor/audio capture settings; other source properties
remain intact.

Persist a capture-binding UUID on new sources and explicit replacement. Preserve
it during automatic refresh, including legacy sources without the field. Runtime
aliases may bridge a refreshed native ID only within the same binding generation;
an explicit replacement cannot inherit a previously attached session. Track retry
budgets by runtime resource ID so staged and committed variants restore independently.

## Consequences

- Scene references, transforms, crop, visibility, configured audio behavior,
  and source identity survive capture replacement.
- Screens can be rebound by Electron's display identifier. Window matching
  uses Electron source IDs as session handles, application icon hashes, and
  titles; none is a permanent cross-platform OS window identifier. IDs and
  handles can change across process or OS restarts, app icons can be absent or
  vary by platform, and duplicate title/icon pairs remain ambiguous. In those
  cases restoration stops safely and asks the user to reconnect manually.
- Automatic restoration uses Electron's deprecated desktop `getUserMedia`
  constraints because the replacement `getDisplayMedia` API requires a user
  gesture. This is a narrowly authorized compatibility path; manual selection
  remains on `getDisplayMedia`.
- This does not add OBS-specific capture-method or window-match controls.
