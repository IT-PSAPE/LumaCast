# ADR-0093: LumaStream Source Editing Shortcuts

## Status

Accepted

## Date

2026-10-17

## Context

OBS-style scene composition depends on fast source editing. Stream already
supports pointer transforms and inspector controls, but common operations were
only available through those controls.

## Decision

- Add source copy/paste and delete actions to the Sources dock and keyboard
  shortcuts Ctrl+C, Ctrl+V, and Delete.
- A pasted source gets a new ID and a 40-pixel offset; it retains references to
  imported assets in the active collection.
- Add fit, stretch, center, and reset transform actions with Ctrl+F, Ctrl+S,
  Ctrl+D, and Ctrl+R.
- Keep the source clipboard in memory only and clear it when the active scene
  collection changes.

## Consequences

Users can repeat source layouts without reimporting their media. The clipboard
does not cross app sessions or scene collections.
