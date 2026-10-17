# ADR-0092: LumaStream Scene Edit History

## Status

Accepted

## Date

2026-10-17

## Context

Scene composition involves frequent edits to source properties and transforms.
Users need to reverse accidental changes without changing output-profile
settings or recording/stream runtime state.

## Decision

- Keep a session-local history of scene lists, active scene, and live scene.
- Cap the history at 100 steps and coalesce changes made within 500 ms.
- Expose undo/redo with Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y, and the Scenes dock.
- Clear history when a collection or profile workspace is activated.
- Continue saving the current project through the existing autosave path; do
  not persist history across app restarts.

## Consequences

Scene and source changes can be reversed while the app is open. Output settings,
hotkeys, and active recording/stream sessions are not part of the undo stack.
