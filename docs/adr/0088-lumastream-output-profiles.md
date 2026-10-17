# ADR-0088: Separate LumaStream Output Profiles

## Status

Accepted

## Date

2026-10-17

## Context

OBS separates output configuration profiles from scene collections. Stream
currently stores output settings and global hotkeys with each scene collection,
which makes those settings diverge when switching collections and prevents the
same output setup from being shared across shows.

## Decision

- Add named profiles independent from named scene collections.
- Persist canvas and output configuration plus global hotkeys in a validated
  `profiles.json` index beside the collection index.
- Apply the active profile to the current scene collection. Switching scene
  collections preserves the selected profile; switching profiles preserves the
  current scenes and sources.
- Create Profile 1 on first load from the active collection's persisted output
  settings and hotkeys, so existing projects retain their configuration.
- Serialize profile operations with project saves. Renderer saves carry both
  active IDs, and main rejects a save targeting a profile that is no longer
  active.
- Support create, duplicate, rename, activate, and delete. Keep one profile and
  one scene collection at minimum, and cap each list at 100 items.
- Block profile switches and mutations that activate a different profile while
  streaming, recording, or replay capture is active.

## Consequences

Output settings and hotkeys can be shared across scene collections. Scene
collections remain focused on scenes and their sources. Version-1 project files
continue to decode; their output and hotkeys seed Profile 1 once, then the
profile index becomes authoritative for those settings.
