# ADR-0016: Shell-First Renderer Bootstrap and Lazy Stage Loading

## Status

Accepted

## Date

2026-08-22

## Context

Issue #234 found that renderer startup coupled three expensive operations to
first paint: loading the project snapshot, importing canvas/Konva stage code,
and mounting NDI capture even when every output was disabled. Large projects
therefore delayed visible shell feedback, while the initial JavaScript entry
paid for rendering and capture features that might not be used in the session.

## Decision

- Create the renderer shell immediately and represent snapshot loading and
  failure as explicit app-store state. `AppLayoutContent` selects the loading,
  retry, or ready branch; repository startup never gates window creation.
- Mount the NDI capture tree through a lazy `NdiOutputsGate` only while at least
  one output is enabled. Unmounting the gate releases capture and audio
  resources.
- Treat scene stages as lazy feature boundaries. Editor, preview, and output
  surfaces load stage/Konva code on demand instead of importing it into the
  renderer entry.
- Preserve package side-effect metadata and vendor chunking so production tree
  shaking can keep Konva/React-Konva out of the initial entry. The production
  build is the verification authority for this boundary.

## Consequences

- Operators see a responsive shell and truthful loading/retry state while the
  snapshot or migrations are still in progress.
- Sessions that never enable NDI or open a stage-backed surface do not pay the
  capture/stage mount cost at startup.
- Stage consumers must use the lazy boundary; an eager stage import from the
  application entry is an architectural and bundle-size regression.
- The shell-first contract complements, but does not replace, the persistence
  utility-process boundary in ADR-0014: one prevents renderer first paint from
  waiting, while the other keeps SQLite work off Electron main.
