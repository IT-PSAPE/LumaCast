# ADR-0113: Add reusable Scene sources to LumaStream

## Status

Accepted

## Context

Stream scenes can be selected for Preview or Program, but their compositions
cannot be reused as layers inside another scene. Recreating an overlay across
several scenes duplicates source configuration and makes updates error-prone.

## Decision

- Add a Scene source that references a scene by ID and remains one selectable
  and transformable source in the owning scene.
- Render the referenced scene's canvas into the Scene source's transform bounds.
  Reuse the referenced sources' existing media elements, capture streams, and
  source IDs; do not start a second capture session for each reference. Size the
  intermediate surface for the rendered bounds and cap it at 16 megapixels.
- Follow visible Scene references recursively for render activation and audio
  program activation. Mixer controls and track routing remain attached to the
  original audio source IDs, not to an aggregate Scene-source bus.
- Reject missing targets, self references, cycles, and reference chains deeper
  than 32 at the project boundary. Guard recursive rendering and activation
  traversal at runtime as well.
- Prevent adding a reference that would create a cycle. When a scene is
  deleted, remove references to it, including references inside groups, and
  remove their source-visibility hotkeys.
- Keep project version 1 because the new source kind and optional reference
  field do not change existing project records.

## Consequences

Existing collections remain loadable. Duplicating a whole collection remaps
Scene-source references to the corresponding cloned scenes and remaps scene
and source hotkeys. Duplicating one scene or one Scene source retains its
reference to the existing scene, allowing shared compositions. Scene sources
do not add a separate audio bus; audio continues through each referenced
source's own mixer controls and routing.
