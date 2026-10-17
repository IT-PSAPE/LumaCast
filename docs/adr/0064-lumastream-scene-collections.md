# ADR-0064: LumaStream Scene Collections

## Status

Accepted; per-collection output settings are superseded by ADR-0088.

## Date

2026-10-17

## Context

Stream previously persisted a single scene collection. Live production projects
need separate collections for different shows and layouts, while imported media
should remain available across those collections.

## Decision

- Store an indexed set of named collections under Stream app data, with one
  validated project file per stable collection ID.
- Support creating a blank collection, duplicating, renaming, switching, and
  deleting. Keep imported assets in the shared app-owned media directory.
- Serialize collection mutations and saves. Renderer saves include the target
  collection ID, and collection changes flush the current project before
  activating another one.
- Migrate the existing single `scene-collection.json` into the indexed format
  on first load and leave the old file intact.
- Block switching, creating, duplicating, and deleting while streaming,
  recording, or replay capture is active. Stop old capture tracks, mixer routes,
  and browser sources when the collection changes.

## Consequences

Collection layouts persist independently; output settings were originally
isolated per collection and now follow the active profile (ADR-0088). Imported
media is shared and may remain in app data after every collection stops
referencing it. This is a local collection manager; portable collection bundles
are not included.
