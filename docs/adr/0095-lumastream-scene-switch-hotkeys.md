# ADR-0095: LumaStream scene-switch hotkeys

## Status

Accepted

## Context

Stream's global shortcuts cover output actions, but production workflows also
need to switch directly to a named scene. Scene IDs belong to a scene
collection, while existing output hotkeys belong to output profiles.

## Decision

Persist optional scene-switch accelerators in the scene collection, keyed by
scene ID. Register them alongside the active profile's output hotkeys through
the main-process global hotkey manager. The typed hotkey event uses a
`switchScene:<sceneId>` action, and the renderer routes it through the same
scene-selection function as a click, preserving Studio Mode Preview/Program
semantics. Reject duplicate accelerators across output and scene bindings.
Deleting a scene removes its binding; scene edit history restores the binding
when undoing that deletion. An empty accelerator leaves that scene unbound.

## Consequences

Collection files own scene-targeted shortcuts, and profile changes do not
rewrite them. The shared IPC contract carries the collection's scene bindings
when registering hotkeys. Existing collections without bindings decode to an
empty map. Hotkeys are system-wide while Stream is running and are subject to
the same registration conflicts as existing global actions.

## Alternatives considered

- Store scene bindings in output profiles: rejected because scene IDs and scene
  lifecycle belong to collections, and profiles are intentionally reusable
  across collections.
- Add local-only keyboard shortcuts: rejected because OBS supports scene
  switching through global hotkeys, including when another application has
  focus.
