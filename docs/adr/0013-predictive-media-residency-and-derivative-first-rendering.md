# ADR-0013: Predictive Media Residency and Derivative-First Rendering

## Status

Accepted

## Context

Issue #237 closes the gap left by the old renderer behavior:

- every full-resolution media load started only when a slide or stage needed to
  paint it;
- the canvas image cache had only one residency mechanism (hard retains for
  mounted consumers), so there was no safe notion of speculative warming;
- thumbnail/bin surfaces and arbitrary slide jumps had no unified first-paint
  policy, so a jump with no warm window could still show blank content while the
  full source decoded.

Issue #236 already made `thumbnailSrc` a truthful, rebuildable managed
derivative capability. This ADR defines how the renderer uses those derivatives
and how playback prediction drives warm/cold transitions without weakening the
cache invariant established in #235.

## Decision

- **Keep prediction headless in `@lumacast/playback`.** The package now owns
  `resolveMediaResidencyPlan`, which deterministically resolves the strongest
  tier per media key from:
  - currently displayed media (`T0`);
  - previous / next / second-next live slides (`T2`, `T1`, `T2`);
  - selected-but-not-live slide (`T1`);
  - next playlist item's first slide (`T1`);
  - armed stage layout (`T1`).
- **Execute residency in the renderer, below `SlideProvider`.**
  `app/renderer/features/playback/media-residency-boundary.tsx` translates that
  plan into app-side behavior. It owns only advisory image warming:
  - mounted scene consumers keep `T0` hard refs through `useKImage`;
  - `T1`/`T2` image sources acquire `warmImage` handles;
  - replacing the plan releases abandoned warms immediately.
- **Advisory warm refs must tolerate eviction.** `packages/canvas/src/image-cache.ts`
  now distinguishes:
  - hard refs (`retainImage`) for mounted consumers that must never blank;
  - soft reservations (`reserveImageEntry`) for render→commit handoff safety;
  - warm refs (`warmImage`) for non-painting speculative residency.

  Warm refs influence eviction priority and observability, but they never let a
  caller dereference a cached element as if it were mounted output.
- **T1 grace and T2 ordering are explicit cache policy.** T1 warms stay
  non-evictable only until their grace deadline; T2 warms are evicted before
  expired T1 warms, and either class is sacrificed before any hard-pinned
  displayed entry. If the cache is still oversubscribed when the last T1 grace
  expires, eviction reconciles automatically.
- **Derivative-first rendering is part of the scene contract.**
  `buildRenderScene`, `buildThumbnailScene`, and `buildResolvedRenderScene`
  accept an optional source→proxy lookup and thread `proxyMediaKey` through
  media nodes and media backgrounds. Canvas painters prefer the proxy derivative
  while the full source is still loading, then swap to the full decoded source
  without blanking the scene.
- **T3 remains derivative-only.** Bin/browser thumbnails stay outside the
  full-resolution residency system: they render only managed `thumbnailSrc`
  derivatives and never create a full-resolution canvas image decode or a full
  `HTMLVideoElement`.

## Consequences

- Sequential advances, returns to the previous slide, and cross-item advances
  can reuse warmed full-resolution images instead of starting cold.
- Arbitrary jumps with no warm window still paint immediately because the scene
  can render the managed derivative first and promote to the full source once
  ready.
- Image-cache observability becomes truthful for speculative work: active T1/T2
  counts, in-flight warms, warm retain hits, cancellations, and wasted warm
  decodes are all incremental counters rather than snapshot scans.
- Video preroll remains intentionally separate. The renderer can show a video's
  derivative first via the proxy path, but issue #237 does not introduce a new
  shared speculative full-video residency pool.
