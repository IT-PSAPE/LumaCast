# ADR-0055: LumaStream Source Color Correction

## Status

Accepted

## Date

2026-10-17

## Context

Scene sources need basic visual correction controls for common production
workflows. Stream's canvas compositor draws each source independently and the
scene collection is already validated by main before persistence.

## Decision

- Store optional per-source brightness, contrast, saturation, opacity, and blur
  values in the scene collection.
- Render these as Canvas 2D filters and alpha on the individual source before
  moving to the next layer.
- Validate bounds when main decodes project data. Keep the fields optional so
  existing version-1 scene collections retain their default appearance.

## Consequences

Visual sources gain basic per-source color correction and blur without a native
filter engine. Chroma key, masks, LUTs, and audio filters remain unimplemented.
