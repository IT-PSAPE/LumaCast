# ADR-0082: LumaStream neural noise suppression

- Status: Accepted
- Date: 2026-10-17
- Supersedes: ADR-0072

## Context

The microphone noise-suppression setting previously delegated processing to
Chromium's optional `noiseSuppression` capture constraint. Device support and
processing varied, and the control did not represent a consistent Stream audio
filter.

## Decision

- Process microphone audio in Stream's Web Audio mixer with the RNNoise WASM
  worklet distributed by `@sapphi-red/web-noise-suppressor`.
- Run the mixer at 48 kHz, as required by this RNNoise worklet. Request raw
  microphone audio with Chromium noise suppression and automatic gain control
  disabled.
- Insert or remove the filter in the source route without reacquiring the
  capture device. Keep the existing per-source setting and project format.
- Include the upstream MIT, Apache-2.0, and Xiph RNNoise license notices in
  Windows packages.

## Consequences

The same filter works across microphone devices and can be toggled while a
capture is live. Enabling it requires AudioWorklet and WebAssembly support; if
initialization fails, Stream reports the failure and clears the saved setting.
The filter is app-side and is not available to capture paths that bypass the
renderer mixer.
