# ADR-0056: LumaStream Scene Transitions

## Status

Accepted

## Date

2026-10-17

## Context

The initial compositor supports Cut and Fade. Live production also needs
transitions that reveal or move between two scenes without relying on a plugin
system.

## Decision

- Keep Cut as an immediate scene switch.
- Add Swipe (a left-to-right reveal) and Slide (the outgoing scene moves left as
  the incoming scene enters from the right) to the canvas compositor.
- Reuse the existing transition duration control and program-canvas transition
  lifecycle.

## Consequences

Stream supports four built-in transitions rendered by its own compositor.
Stinger media transitions and user-authored transition effects remain future
work.
