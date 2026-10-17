# ADR-0077: LumaStream cursor capture settings

- Status: Accepted
- Date: 2026-10-17

## Context

Display and window sources use Chromium screen capture. The capture flow did not
let the operator choose whether the pointer appears, and saved sources relied
on Chromium's default cursor behavior.

## Decision

Persist a cursor mode (`always`, `motion`, or `never`) on display and window
sources. Include it in the initial `getDisplayMedia` request and apply changes
to the active video track with `applyConstraints`. Older projects default to
`motion`; main validates the mode and rejects it on other source kinds. If a
live track rejects the change, preserve its previous saved value and report the
capture error.

## Consequences

Operators can control pointer visibility per captured display or window and
change it without restarting a live source. Capture implementations that cannot
apply a requested live constraint leave the saved setting unchanged.
