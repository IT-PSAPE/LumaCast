# ADR-0108: Selectable audio monitor output device

## Status

Accepted

## Context

Stream routes per-source monitor audio to the renderer's `AudioContext`
destination. OBS lets operators choose which local output device receives this
monitor mix. The output device is machine-specific and must not move with
scene-collection or profile exports. Program audio already uses separate
`MediaStreamAudioDestinationNode` buses for recording and streaming.

## Decision

Add a monitoring-device selector to Stream settings. Use the mixer's
`AudioContext.setSinkId()` to change only local monitor output and persist the
selected device ID in an app-local audio settings file. Keep System Default as
the default and fall back to it when the selected device is missing or rejected.
Retry the saved device when the OS audio-device list changes.

Allow Electron's `speaker-selection` permission only for the trusted main
renderer, using the same main-frame origin check used for existing capture
permissions. Do not grant this permission to projector or offscreen browser
windows.

## Consequences

Operators can monitor sources through a selected Windows audio output without
altering the program buses. The preference remains local to the machine and is
not included in project/profile bundles. Device enumeration can return unnamed
outputs, so Stream supplies stable per-list fallback labels for the current
session. If a saved device is unavailable, the preference remains saved while
current playback uses System Default.
