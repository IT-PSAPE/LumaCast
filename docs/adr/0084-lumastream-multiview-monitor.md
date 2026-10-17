# ADR-0084: Add an in-app multiview monitor

## Status

Accepted

## Context

Live production benefits from seeing several scene compositions while choosing
the next program scene. The existing workbench supports one program view or a
two-pane Studio Mode preview but has no scene overview.

## Decision

Add a multiview mode to the Stream monitor. It renders a program tile and a
selectable preview tile for every scene. Entering multiview enables Studio Mode
so selecting a tile cannot unexpectedly replace the live scene. Multiview
activates visible capture sources across all scenes while keeping program audio
routing tied to the live scene. Scene canvases use reduced render resolution;
the program canvas remains at the configured output resolution for streaming,
recording, and replay capture.

## Consequences

Multiview uses additional renderer and capture resources while active. Closing
it stops camera and microphone captures opened only for multiview, including
requests that finish after the mode closes. Stream remains responsible for
starting and stopping those sources; no third-party engine is introduced.
