# ADR-0049: Standalone Soundboard

## Status

Accepted.

## Date

2026-10-09

## Context

The requested soundboard needs multiple named boards, audio import and removal,
and independent play, pause, and stop controls. The user selected a separate
desktop app. Chord's single audio track belongs to its lyric-video project,
while Flux is a photo editor; neither owns this workflow.

## Decision

Add `apps/soundboard` as a self-contained Electron application named
LumaSoundboard, with app-local main, preload, renderer, and a process-neutral
typed IPC contract. It imports no sibling app code.

Main owns a versioned JSON manifest and managed audio copies in a separate
user-data directory. Serialize mutations and atomically replace the manifest.
Import through the native picker and persist copies so moving source files does
not break saved boards. Removing a sound affects only the managed copy and its
board membership. Validate manifest data and IPC arguments at the boundary.

A sandboxed renderer accesses managed audio through a custom protocol addressed
by sound ID, with byte-range streaming. It receives no original filesystem
paths. Only the owning main frame may invoke the exposed IPC operations;
navigation and popup creation are blocked.

Renderer audio players may overlap within a board. Pause retains position; stop
rewinds; board switching stops the old board. Playback state is not persisted.

Expose development, build, preview, and packaging scripts. This change does not
register the app in LumaCloud or publish releases/update feeds.

## Consequences

The soundboard runs independently and cannot couple its state to another app.
Managed copies consume additional disk space but keep boards portable across
changes to original files. Audio format support depends on Electron's media
decoders, with playback failures reported in the interface. JSON storage is
adequate for this local library without adding another database dependency.
