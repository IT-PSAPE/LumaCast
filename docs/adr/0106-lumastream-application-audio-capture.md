# ADR-0106: LumaStream application audio capture

## Status

Accepted

## Context

Stream's desktop-audio source captures Windows system loopback through
Chromium's display-media flow. It cannot isolate one application's sound.
Stream must keep the capture implementation independent from OBS and libobs,
and keep native audio capture outside its sandboxed renderer.

## Decision

Use platform helpers outside the renderer: Windows process audio under
`apps/stream/native/audio-loopback` and macOS Core Audio taps under
`apps/stream/native/audio-tap`. The standalone .NET 8 win-x64 executable captures
a selected PID's process tree with WASAPI process loopback. The macOS helper
requires macOS 14.2 or later and follows the selected app's descendant processes.
Their `list` command returns process ID, display name, and
executable path as JSON. Each capture command writes interleaved 48 kHz stereo
float32 PCM to stdout; diagnostics go to stderr. Capture stops when the target
process exits or the helper's input closes.

The picker catalog requires an on-screen/non-minimized GUI window and Core Audio
output-stream/device evidence on macOS or a non-expired WASAPI render session on
Windows. Helper processes are grouped under the GUI root. This catalog is an
affordance rather than authorization: a silent or minimized app can disappear
from the picker without invalidating an existing selected process.

The main process owns helper execution and the capture lifecycle. It validates
the selected PID and absolute executable path; the native helper checks the live
process identity before capture, reducing the risk of PID reuse. The persisted
source contains the absolute executable path; the PID is transient. Standalone
Application Audio requires a live selection. Display capture can restore its
combined application audio when the saved path matches exactly one catalog entry.
Main transfers PCM to the trusted renderer through a per-source MessagePort.
Packets contain complete stereo frames, at most 7,680 bytes (20 ms). Five
packets, at most 38,400 bytes, can remain outstanding across the renderer relay
and AudioWorklet. Credit returns only after the worklet consumes the packet's
final frame; receiving or forwarding it does not release credit. Main pulls
stdout only while credit is available, using one fixed 7,680-byte assembly
buffer and flushing partial complete frames within 20 ms. The oldest packet
has a 250 ms consumption deadline that invalid receipts cannot extend. Overflow,
timeout, or transfer failure ends capture with an explicit error; the worklet
does not silently trim queued audio.

The renderer resumes the mixer and waits up to two seconds for the worklet's
first processing receipt before launching the helper. An internal preload
epoch and exact port ownership reject old session announcements and asynchronous
completions; stopping invalidates that ownership synchronously. The public
start/stop API remains source-based. The worklet output remains a MediaStream
feeding the existing mixer. Stopping the source, closing the renderer
connection, or helper termination ends the session; combined display capture
can retain its live video when audio fails.
Each input also reports processor failure while no PCM is pending. The failure
handler checks the captured input before stopping or updating a source, so an
obsolete input cannot tear down its replacement.

The macOS tap uses a private tap-only aggregate. Adding the physical output as a
subdevice can give the aggregate a different clock from the tap format, causing
captured audio to play too fast and at a higher pitch. The converter consumes
the tap's actual format and emits the fixed 48 kHz contract; it does not apply a
pitch correction. Buffer layout is validated before constructing PCM buffers.

The macOS callback submits complete blocks to a fixed 96,000-byte SPSC queue
(250 ms at the output format). One worker writes stdout nonblockingly, retaining
partially written blocks in FIFO order. A full queue or 250 ms without write
progress while PCM is pending terminates capture with a diagnostic; it does
not silently drop audio. Explicit stop quiesces capture callbacks, aborts pending
output, and joins the worker before releasing its queue. Teardown restores
the borrowed stdout descriptor's flags. Native queue, kernel pipe, Node readable
buffers, and ContextBridge copies remain separate allocations. The packet
window bounds outstanding PCM payload, not aggregate process memory.

## Consequences

- Application audio uses Stream's existing per-source processing, monitoring,
  metering, mute, and program-track routing.
- Windows capture rejects builds older than
  20348. Listing processes may work on an older build even when capture cannot.
- Process enumeration is limited to GUI apps with audio-session evidence in the
  current session; inaccessible executable paths are omitted. Capture needs a
  still-running process whose executable path can be read.
- Development startup and Windows packaging publish the helper as a
  self-contained executable; the Windows distribution includes it under the
  application-audio resources directory.
- Application capture covers an app/process tree, including its other windows,
  rather than a selectable output endpoint or individual window. Window Capture
  cannot enable this broader audio path (ADR-0121). A separate explicit
  desktop-audio source can still capture the system mix or duplicate sound.
- Live PCM capture remains unverified on a supported Windows host.
- Standalone Application Audio requires a new live selection after restart.
  Display capture resolves its saved application path automatically only when
  exactly one catalog entry matches; otherwise video restores with an audio
  warning and requires an explicit application selection.
