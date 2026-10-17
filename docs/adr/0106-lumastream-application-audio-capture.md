# ADR-0106: LumaStream application audio capture

## Status

Accepted

## Context

Stream's desktop-audio source captures Windows system loopback through
Chromium's display-media flow. It cannot isolate one application's sound.
Stream must keep the capture implementation independent from OBS and libobs,
and keep native audio capture outside its sandboxed renderer.

## Decision

Add a Windows process-audio helper under `apps/stream/native/audio-loopback`.
The standalone .NET 8, self-contained win-x64 executable lists visible
interactive processes and captures a selected PID's process tree with WASAPI
process loopback. Its `list` command returns process ID, display name, and
executable path as JSON. Its capture command writes interleaved 48 kHz stereo
float32 PCM to stdout; diagnostics go to stderr. Capture stops when the target
process exits or the helper's input closes.

The main process owns helper execution and the capture lifecycle. Before
starting, it re-reads the process list and requires the selected PID and
executable path to match, reducing the risk of capturing a different process
after PID reuse. The persisted source contains the absolute executable path;
the PID is transient and is selected again when capture starts. Main transfers
PCM to the trusted renderer through a per-source MessagePort. The renderer
queues PCM in an AudioWorklet with a one-second bound and presents its output
as a MediaStream to the existing audio mixer. Stopping the source, closing the
renderer connection, or helper termination ends the session.

## Consequences

- Application audio uses Stream's existing per-source processing, monitoring,
  metering, mute, and program-track routing.
- The helper is Windows-only and capture rejects Windows builds older than
  20348. Listing processes may work on an older build even when capture cannot.
- Process enumeration is limited to visible interactive processes in the
  current session; inaccessible executable paths are omitted. Capture needs a
  still-running process whose executable path can be read.
- Development startup and Windows packaging publish the helper as a
  self-contained executable; the Windows distribution includes it under the
  application-audio resources directory.
- This captures a process tree, not a selectable output endpoint or the full
  system mix. A separate desktop-audio source can still duplicate sound.
- Live PCM capture remains unverified on a supported Windows host.
- Capture is not restored automatically after restart because the PID is not
  persisted and a new live process selection is required.
