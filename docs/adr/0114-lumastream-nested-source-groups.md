# ADR-0114: Support nested source groups in LumaStream

## Status

Accepted; supersedes the one-level group limit in ADR-0112.

## Context

The initial Stream group implementation allowed one group level. This prevents
operators from organizing larger compositions into reusable nested layers and
differs from OBS's source-tree workflow.

## Decision

- Allow groups to contain groups, with a maximum nesting depth of 32.
- Preserve the existing ordered source tree. Grouping and ungrouping operate on
  contiguous sibling selections at any depth.
- Keep transforms in scene-canvas coordinates. Moving or resizing an outer
  group recursively moves or scales visual descendants while audio sources keep
  their existing transforms and per-source routing.
- Recompute ancestor group bounds after nested child changes and preserve
  ancestor visibility, lock, and stacking behavior.
- Validate nesting depth while decoding projects and enforce the same maximum
  when the UI creates a new group.

## Consequences

Existing one-level groups remain unchanged. Collection assets, copy/paste,
source lookup, visibility activation, hotkeys, deletion, and whole-collection
duplication recurse through the tree. Projects deeper than 32 group levels are
rejected at load with a specific validation error.
