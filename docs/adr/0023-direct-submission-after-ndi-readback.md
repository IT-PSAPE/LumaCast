# ADR 0023: Submit NDI frames at the readback worker

Status: Accepted

## Context

NDI video already uses a readback worker and a dedicated utility process. Waiting for the renderer to return telemetry after readback reintroduced the busy UI event loop into the direct frame path.

## Decision

Include the attempt identity and telemetry snapshot in the capture request. After readback, the worker computes durations and submits immediately over the direct transport. It returns the buffer for the existing fallback route when direct submission is unavailable.

The readback notification remains informational. Matching host release, or the existing watchdog recovery, owns the one-frame capture slot. Counters accrued after capture starts remain pending for the next attempt.

## Consequences

UI scheduling no longer gates an already captured direct frame. Canvas rendering still requires the renderer, and native submission and network capacity still affect throughput. This change does not establish a measured end-to-end performance guarantee.
