# ADR-0063: LumaStream Global Hotkeys

## Status

Accepted; storage with scene collections is superseded by ADR-0088, which moves
hotkey persistence to output profiles.

## Date

2026-10-17

## Context

Live production controls must work while Stream is behind another window.
The app's renderer is sandboxed, so operating-system shortcut registration belongs
in Electron main and actions must cross the existing typed IPC boundary.

## Decision

- Persist configurable shortcuts for stream controls, recording, replay-buffer
  toggling, and saving a replay with the scene collection.
- Register Windows global accelerators through Electron `globalShortcut` in
  main. Require one key and at least one modifier, reject duplicates, and leave
  empty bindings disabled.
- When the operating system reports a conflict, roll back the new set and
  restore the previously active shortcuts. Send only the named action to the
  trusted renderer, which performs the operation through existing app state.
- Unregister shortcuts when Stream exits.

## Consequences

The main recording and replay actions can be triggered while Stream lacks focus;
starting streaming opens its endpoint dialog because the destination remains
transient. Shortcut registration can fail if another application owns a binding,
and Stream reports that conflict without replacing the saved configuration.
