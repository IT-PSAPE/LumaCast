# ADR-0079: LumaStream source transform controls

- Status: Accepted
- Date: 2026-10-17

## Context

Stream's canvas allowed direct pointer-based source movement and resizing, but
operators could not enter exact geometry or restore common layout positions.

## Decision

Expose numeric source position and size fields plus Fit to Canvas, Center, and
Reset actions in the selected source properties. Fit to Canvas uses the
available source dimensions and contains the source within the configured
canvas while preserving aspect ratio. Center preserves size; Reset restores
the source-kind defaults.

## Consequences

Operators can make precise edits without dragging handles. Source geometry
continues to use the existing persisted transform contract and its validation
bounds.
