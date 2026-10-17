# ADR-0086: Add a program projector window

## Status

Accepted

## Context

Stream needs a separate program output window for a second monitor or another
display surface. The workbench monitor can change shape and composition when
Studio Mode or Multiview is toggled, so it is not a stable source for recording
and external output.

## Decision

Keep one full-resolution program canvas mounted in the monitor across layout
changes. Recording, streaming, replay, and the program projector use that
canvas. The projector is a dedicated sandboxed Electron popup that mirrors the
canvas video track and contains it at the configured aspect ratio. It uses an
inherited-origin blank document so the workbench can attach the live video
track without opening another app renderer or requiring a media IPC bridge.
The window-open policy allows only `about:blank` from the trusted workbench;
all other popups remain denied.

## Consequences

The projector does not reopen capture devices or browser sources and can keep
outputting while the workbench changes modes. Its video is muted to prevent
monitor speakers from duplicating program audio. The program canvas remains
mounted in the monitor while its layout changes, so it does not add a second
full-resolution scene render.
