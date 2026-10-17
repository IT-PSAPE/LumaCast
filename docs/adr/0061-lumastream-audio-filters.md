# ADR-0061: LumaStream Audio Compressor and Limiter

## Status

Accepted

## Date

2026-10-17

## Context

The audio mixer provides source gain and mute but no dynamics controls. Stream
needs built-in audio filters without a plugin API or native codec dependencies.

## Decision

- Persist optional per-source compressor enable, threshold, and ratio settings,
  plus limiter enable.
- Apply the compressor and limiter in sequence after source gain using Web
  Audio `DynamicsCompressorNode`s.
- Bound and decode these settings in main; keep the fields optional for
  existing version-1 projects.

## Consequences

Audio sources can use a compressor and limiter with project-persisted controls.
Noise suppression, expander/gate, VST support, and multi-track routing remain
future work.
