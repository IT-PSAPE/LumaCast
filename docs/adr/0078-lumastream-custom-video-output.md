# ADR-0078: LumaStream custom video output dimensions

- Status: Accepted
- Date: 2026-10-17

## Context

The canvas model and project decoder already supported bounded custom output
dimensions and frame rates, but the Video settings exposed only three canvas
presets and 30 or 60 FPS.

## Decision

Expose editable canvas width, height, and frame rate fields. Clamp values to the
existing project and engine bounds: width 320–16384, height 180–16384, and frame
rate 1–240 FPS. Preserve fractional frame rates to two decimal places.

## Consequences

Operators can match less common output formats and fractional broadcast rates.
The existing compositor, capture cadence, encoders, and persistence continue to
consume the same validated output settings.
