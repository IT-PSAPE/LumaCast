# ADR-0085: Add a color fade scene transition

## Status

Accepted

## Context

Stream supports cut, fade, swipe, and slide transitions. OBS also includes a
fade-to-color transition for productions that want a brief color hold between
scenes.

## Decision

Add a Fade to Color transition to Stream's monitor controls. The transition
fades the outgoing scene to a user-selected color over the first half of its
duration, then fades the incoming scene in over the second half. The color is
kept in the active transition instance and is not persisted with the scene
collection.

## Consequences

The transition uses the same renderer canvas and duration controls as other
transitions. It adds no native runtime or media dependency.
