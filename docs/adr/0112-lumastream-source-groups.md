# ADR-0112: Add source groups to LumaStream

## Status

Accepted

## Context

Stream stores each scene as an ordered source list. Operators cannot organize
related sources or transform them together, a common scene-composition workflow
in OBS.

## Decision

- Add Groups as source nodes that contain an ordered list of existing sources.
- Allow grouping a contiguous selection of sibling sources so the new node
  preserves their stacking order relative to other scene layers.
- Keep child transforms in scene-canvas coordinates. Group movement and resize
  update child transforms together, preserving their relative placement.
- Group visibility applies to its visual children. Audio children retain their
  per-source routing and mixer controls.
- Permit one group level for now. Reject nested groups at the project boundary.
- Keep project version 1 because groups are additive and legacy source records
  remain unchanged.

## Consequences

Existing collections load without migration. Collection bundles include media
referenced by group children, and duplicating a group or collection assigns new
source IDs to copied nodes. Nested groups and Scene sources remain future work.
