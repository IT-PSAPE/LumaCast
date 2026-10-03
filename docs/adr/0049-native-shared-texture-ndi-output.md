# ADR-0049: Native Shared-Texture NDI Output

## Status

Accepted. Supersedes ADR-0017's video transport and renderer capture loop, and
ADR-0011's video watchdog release policy. Audio decisions remain unchanged.

## Date

2026-10-03

## Context

Choppy video exposed the cost of reading full RGBA frames in JavaScript and
cloning them between processes. Chromium still provides the scene renderer,
including text, media, groups, stage bindings and transparency. The NDI utility
process must continue to isolate native work from the operator UI.

## Decision

- Render each enabled audience/stage scene in a dedicated sandboxed offscreen
  Chromium window using Electron 35's shared-texture paint API. The workbench
  publishes bounded scene/binding descriptions and timestamped layer-video
  controls through typed IPC; it no longer captures pixel buffers.
- Keep native texture handles entirely inside the main/NDI engine boundary.
  macOS transfers IOSurface access through a Mach port, Windows duplicates the
  shared D3D handle into the utility process, and Linux transfers DMA-BUF file
  descriptors through an owner-only Unix socket. Descriptor tokens identify
  their corresponding control messages.
- Retain at most one active texture and one newest waiting texture per output.
  Release replaced waiting textures immediately. Release active textures only
  after native input readback completes or the reader process exits. A timed
  out submission terminates the reader before releasing its input lease.
- Perform readback and NDI submission on a native worker. Metal converts macOS
  surfaces to Rec.709 UYVY/UYVA. Windows D3D staging and Linux EGL DMA-BUF import
  read back native BGRA/RGBA, allowing the NDI SDK to handle colour conversion.
  Alpha senders unpremultiply Chromium colour; opaque senders composite over
  black. Two native output buffers protect asynchronous NDI send ownership.
- Cache static frames only in native memory and replay them at the existing
  video cadence. Sender rebuilds invalidate Chromium output so the new sender
  receives a fresh frame. Static capture requests retry for up to five seconds
  until native acceptance, with obsolete completions unable to cancel a newer
  request. Web Audio and its existing direct PCM transport
  remain the audio clock; output-window media is muted.
- Keep attempt acknowledgements and take correlation, with scene revisions
  identifying submissions. Native completion is sender acceptance, not proof
  that a remote receiver displayed the frame. Existing RGBA host APIs remain
  for compatibility tests and blackout; the application has no CPU capture
  fallback.

## Consequences

JavaScript no longer reads, caches or transfers video pixels. Chromium scene
rendering and video decoding still use browser resources, and the NDI SDK and
network can still limit throughput. Windows/Linux driver texture import and
macOS Mach-port access are platform responsibilities, covered by native build
checks and platform-specific integration tests. Unsupported or failed native
output is reported instead of silently switching back to the retired pipeline.
Linux builds require EGL/GLES development headers; Debian packages declare the
EGL/GLES runtime libraries alongside Electron dependencies. AppImage hosts need
compatible graphics drivers providing those libraries.

Hosted macOS CI without a Metal device still checks Mach/IOSurface transfer and
reports the conversion test as skipped. Metal conversion and live Chromium
capture are verified on a physical Mac.
