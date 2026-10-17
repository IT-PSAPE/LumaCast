# ADR-0062: LumaStream Recording Bitrates

## Status

Accepted

## Date

2026-10-17

## Context

Stream records the program canvas and mixer as WebM but uses fixed encoder
bitrates. Users need to tune file size and recording quality from the app.

## Decision

- Persist WebM video and audio bitrate settings in the scene collection's output
  settings.
- Bound video bitrate to 500–50,000 kb/s and audio bitrate to 32–320 kb/s.
- Load version-1 projects without these fields using 8,000 kb/s video and
  160 kb/s audio defaults.

## Consequences

Recording uses the project's selected rates. Stream still exposes only WebM
recording and does not yet offer a choice of container or hardware/software
recording encoder.
