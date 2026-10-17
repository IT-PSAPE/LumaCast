# ADR-0057: LumaStream Source Resizing

## Status

Accepted

## Date

2026-10-17

## Context

The scene canvas supports direct source positioning, but sources cannot be
resized with the mouse. The selection frame already tracks the selected source
in both Studio Mode preview and program view.

## Decision

- Add eight pointer handles to the selected source's frame.
- Resize from the chosen edge or corner while keeping the opposite edge fixed;
  enforce a 16-pixel minimum in output coordinates.
- Keep move and resize gestures on the canvas and persist the resulting source
  transform through the scene collection.

## Consequences

Sources can be positioned and resized directly in the canvas. Aspect-ratio lock
and transform reset controls remain future work.
