# ADR-0050: Soundboard Playback Controls

## Status

Accepted. Extends ADR-0049 with saved playback settings and renderer shortcuts.

## Date

2026-10-10

## Context

The soundboard needs seeking, start/end timestamp selection, repeatable ranges,
optional shortcuts active only while the app has focus, and reuse of the
existing UI package. Audio positions remain session state, while each sound's
configuration must survive app restarts.

## Decision

Persist `startTime`, nullable `endTime`, `loop`, and a nullable shortcut per
sound. Times are stored in seconds; null End means the decoded audio duration.
The version-2 JSON manifest migrates valid version-1 manifests atomically,
preserving boards, names, and managed audio. Invalid manifests remain untouched.
Settings cross the existing trusted preload port through `updateSound` and
receive strict validation in main. Renderer validation additionally checks
timestamps against the audio's decoded duration.

The renderer owns seeking and range enforcement. Pause retains the playhead;
Stop and completed playback return to the range start. Loop wraps at the chosen
end, with the full file as the default range. Player lifetimes stay stable
across saved settings and cloned library responses; removal, board switching,
and unmount release the player and its scheduled work.

Shortcuts store a physical key code and exact Ctrl/Alt/Shift/Meta modifiers.
Assignments must be unique within a board; another board may reuse the same
combination. Window keydown dispatch requires document focus, skips editing,
composition and repeat events, and toggles playback only on the active board.
There is no Electron global shortcut registration.

Use controls through `@lumacast/ui`'s public entry point and its exported
`theme.css`. Native timestamp fields and the app's range slider remain local
because the package does not publish corresponding input primitives.

## Consequences

Existing saved boards gain default settings without reimporting audio.
Version-2 manifests require this app revision; the earlier revision cannot load
them. Keyboard assignments cannot affect other focused applications. Shared UI
controls retain common interaction and styling without moving soundboard
behavior into the domain-agnostic package.
