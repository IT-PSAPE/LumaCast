# ADR-0096: LumaStream source-visibility hotkeys

## Status

Accepted

## Context

Scene-switch hotkeys cover one part of a live production workflow. Operators
also need to show or hide a source without returning focus to the workbench.
Source IDs are unique within a collection and are already the renderer runtime
identity for source capture and media.

## Decision

Persist optional source-visibility accelerators in the scene collection, keyed
by source ID. A binding toggles that source's visibility through the regular
renderer source-update path. Register these shortcuts with active profile output
shortcuts and collection scene-switch shortcuts; reject duplicate accelerators
across all bindings before replacing the active set. The existing settings
capture interaction assigns shortcuts and Escape clears them.

Deleting a source or its containing scene removes its binding. Scene edit
history includes the binding map so undo and redo restore it together with
source and scene edits. Duplicated scenes receive fresh source IDs and do not
inherit source hotkeys. Old collections decode with an empty source binding map.

## Consequences

Source IDs must be unique across a collection for visibility hotkeys to target
one unambiguous source. Main validates that every persisted binding targets an
existing source. The typed hotkey action carries the source ID to the renderer;
no new main-process source mutation API is introduced.

## Alternatives considered

- Store bindings on source objects: rejected because hotkey registration and
  uniqueness checks operate across the complete collection and profile.
- Add separate Show and Hide bindings: rejected for this increment; a single
  toggle matches the source dock's visibility control and uses one binding.
