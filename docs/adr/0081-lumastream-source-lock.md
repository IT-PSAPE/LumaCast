# ADR-0081: LumaStream source locking

- Status: Accepted
- Date: 2026-10-17

## Context

Sources could be moved or resized by pointer, keyboard, and transform controls
without a way to protect a finished layout from accidental edits.

## Decision

Persist a lock state per source and expose a lock toggle in the source list.
Locked sources remain selectable and can still change visibility and layer
order, but their transform cannot be changed by pointer, keyboard, or transform
panel actions. Older projects default to unlocked.

## Consequences

Operators can protect positioned sources while continuing to manage their other
scene properties.
