# ADR-0059: LumaStream Scene Management

## Status

Accepted

## Date

2026-10-17

## Context

Stream currently creates scenes but has no way to rename, copy, or delete them.
These are basic scene-collection workflows and must preserve independent source
identities and media lifecycles.

## Decision

- Allow a scene to be renamed, duplicated, or deleted from the scene options.
- Give duplicated scenes and sources new IDs. Clone active capture tracks and
  create independent runtime routes for the copied sources.
- Prevent deletion of the final scene. Stop capture tracks belonging to a
  deleted scene and choose a remaining scene as active/live when needed.

## Consequences

Scene collections support routine editing without copying scene JSON outside
the app. Duplicate capture sources continue from the same physical capture but
have separate tracks and mixer routes; removing either scene stops only its
own cloned tracks.
