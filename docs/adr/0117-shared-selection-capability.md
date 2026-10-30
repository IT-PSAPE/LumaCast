# ADR-0117: Shared selection capability

## Status

Accepted.

## Date

2026-10-27

## Context

Selecting several objects or list entries and applying one action is a suite
interaction contract. Individual applications had partial implementations with
different modifier, range, drag, and keyboard behavior. Users need the same
selection capability in every application, including side panels and lists.

## Decision

Create `@lumacast/selection` as a dedicated, domain-independent workspace
package. It owns selection transitions, range anchors, modifier toggles,
pruning, context-menu targeting, collection keyboard handling, and helpers for
preserving the order of a moved selection. Its identifiers are opaque strings.
React hooks build on the same pure transitions used by controlled application
stores. The package imports no application, canvas engine, persistence layer,
or product domain.

Applications own the meaning and authorization of actions: deleting cues,
removing library entries, uninstalling apps, and moving scene sources use their
existing domain commands. Selection gestures never execute those actions.
Bulk actions resolve a stable target set, confirm once when required, and stop
on failure. Each app retains its undo, lock, live-output, and minimum-content
rules. App navigation itself remains a single destination.

Cast's collection selection and ordering use the package. Other apps consume
the same transitions through their existing state owners: Flux library
selection, Chord cue selection, Stream scenes and sources, Soundboard boards
and sounds, and Cloud's managed-app selection. Canvas gesture code remains in
the canvas or application layer and submits domain batch commands.

## Alternatives

- Keeping selection helpers in an application would require app-to-app
  imports or copies, contrary to the repository's dependency boundaries.
- Putting the capability entirely in `@lumacast/ui` would tie pure controlled
  state transitions and domain-independent ordering to the visual primitive
  package. A dedicated package gives nonvisual stores the same contract.

## Consequences

Changes to modifier and range behavior have one implementation and package-level
regression coverage. Application tests verify that selected targets reach the
appropriate bulk command without triggering playback or activation. Selection
is transient except where an existing application already persists its current
selection; this decision introduces no universal selection database or schema.
