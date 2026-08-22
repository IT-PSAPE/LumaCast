# ADR-0011: Truthful Observability Frame Release and Take Correlation

## Status

Accepted

## Date

2026-08-21

## Context

Issue #244 tightened the observability contract around NDI output and renderer
health.

Before this change:

- `sendNdiFrame` freed renderer backpressure in main-process `finally`, so the
  renderer treated "main received the IPC message" as if it were "the host-side
  send attempt finished".
- The observability panel only mounted its collectors while open, which meant
  renderer rAF, long-task, video, audio, and main-process metrics disappeared
  precisely when operators were not staring at the panel.
- The event timeline always mirrored to console, so every observability event
  became a permanent log line whether the operator wanted that verbosity or not.
- Sender diagnostics exposed sender-side timing, but not exact-once
  `activate`/`take` to accepted native-send latency or explicit drop/retry
  reason counts.

Those behaviors were cheap, but they were not precise enough for a performance
audit.

## Decision

- Replace the optimistic renderer `frameAck` contract with a host-side
  `frameReleased` event.
  - The renderer still sends frames one-way over `sendNdiFrame`.
  - The utility-process host now emits `frameReleased` only after the frame
    attempt is accepted, rejected, or fails in the host/service boundary.
  - Every frame attempt carries a monotonic attempt id end-to-end
    (renderer → main → proxy → utility host → engine → `frameReleased`) so a
    stale release cannot clear a newer in-flight slot.
  - Main forwards that release event to the renderer unchanged.
  - The release event is explicitly *not* a downstream-capacity claim; it means
    only that the host-side send attempt returned or was rejected.
- Keep renderer backpressure one-slot, but make it truthful.
  - `ndi-frame-capture.tsx` frees its in-flight slot only on `frameReleased` or
    a watchdog timeout.
  - Watchdog timeouts and host-side native-send failures schedule one
    corrective retry.
- Record exact-once `activate`/`take` to accepted native-send latency per
  output sender.
  - Slide actions register pending take intent through
    `app/renderer/utils/ndi-take-correlation.ts`.
  - Intent is scoped by the target output item/playlist entry and ordered by a
    sequence id, so repeated takes of the same already-live slide stay distinct
    and stale cross-item claims are rejected.
  - `ndi-frame-capture.tsx` leases each pending action at most once per sender,
    keyed to the first matching capture attempt for that sender after the
    action, and consumes it only after the matching accepted `frameReleased`.
  - The claimed `takeKind`, truthful `takeReason` available in slide context
    today (`sequential`, `jump`, `crossItem`), and `takeIssuedAtMs` ride on
    frame telemetry and are aggregated into sender pipeline diagnostics as
    `activateToNativeSend`, `takeToNativeSend`, and per-reason
    `takeReasonToNativeSend`. `macro` remains an explicit zero-count bucket
    because there is no macro-authored slide-take path in the current action
    model.
  - Renderer-authored frame telemetry is treated as advisory at the main/engine
    trust boundary. Main IPC and the engine sanitize optional telemetry before
    merging counters or pipeline spans: invalid enums are dropped, count fields
    must be bounded nonnegative integers, duration/span samples are bounded
    before aggregation, duplicate backpressure sources are canonicalized, and
    only renderer-owned drop reasons are merged. Activate/take dedupe keys are
    kept only for a fully valid correlation tuple (`kind`, `reason`,
    `issuedAt`, `session`, `sequence`) whose intended sender-side span is
    actually aggregatable. A successful native send therefore remains a
    successful native send even if the renderer telemetry is malformed, and a
    malformed partial tuple or invalid span cannot suppress a later valid frame
    with the same key.
- Make renderer/main observability collection always-on.
  - The app shell mounts an `ObservabilityRuntime` child inside
    `WorkbenchProvider`; it runs `useObservabilityRuntime()`, which continuously
    runs the renderer collectors and polls `obsGetSystemMetrics()`.
  - Main-process system metrics now include lazily-started monotonic event-loop
    lag statistics over a rolling window.
  - The observability panel becomes display-only.
- Make event-to-log mirroring opt-in.
  - Timeline events always stay in the in-app ring buffer.
  - Console/log mirroring is guarded by a store flag persisted in local
    storage.
- Replace ambiguous drop accounting with explicit reason buckets and corrective
  retry counts in sender diagnostics.
- Keep the currently exposed residency/cache metrics truthful.
  - DOM video stats are keyed by element identity, not `src`, so duplicate
    elements with the same source are counted separately.
  - Canvas-backed video counts come from the canvas package's current video
    pool registries, so off-DOM Konva videos are visible without inventing
    derivative metrics.
  - Image-cache and media residency panels expose only counters backed by
    current APIs; derivative/prefetch counters remain deferred to #236/#237.

## Consequences

- Renderer backpressure reflects the actual host-side frame release boundary
  instead of mere IPC receipt in main.
- Sender diagnostics can now distinguish:
  - dropped because of renderer backpressure;
  - watchdog timeout;
  - readback / bitmap failure;
  - invalid payload;
  - sender unavailable / output disabled;
  - native send failure;
  - corrective retry count.
- `activate` and `take` actions now have first-class latency distributions to
  accepted native-send completion, per output sender, without collapsing
  repeated takes of the same slide into one claim.
- Operators can leave the observability panel closed and still get truthful
  snapshots once they open it, without forcing verbose observability lines into
  session logs by default.
