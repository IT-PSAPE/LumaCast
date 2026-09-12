# ADR-0015: Video Preroll and Media Transport Validator Boundaries

## Status

Accepted

## Context

ADR-0013 established predictive image residency and derivative-first scene
painting, but it intentionally left two adjacent gaps open:

- predictable video paints still started cold unless the live transport layer
  already owned the source element;
- `cast-media:` responses always used `no-store` and synchronous `statSync`
  range resolution, so DOM media elements could not revalidate external file
  changes with normal HTTP validator semantics.

Issue #238 closes those gaps while preserving the existing safety invariants:

- T0 mounted output must never blank because speculative work was reclaimed;
- live transport video keeps its exact shared element across surface churn;
- stage/bin/list thumbnails remain derivative-first and T3 surfaces must never
  instantiate full-resolution media for mere preview;
- Web Audio capture for NDI must not reconnect the same DOM media element by
  creating a second `MediaElementAudioSourceNode`.

## Decision

- **Keep predictive video warming separate from image residency.**
  `MediaResidencyBoundary` still consumes the headless playback plan from
  `@lumacast/playback`, but renderer execution now splits by media type:
  - images use advisory `warmImage` handles;
  - predictable non-transport videos use bounded dedicated
    `warmVideoClaim(claimKey, src)` prerolls;
  - the live transport layer uses `warmVideoSource(src)` /
    `retainVideoSource(src, options)` for the shared exact-element pool.
- **Bound video speculative work explicitly.**
  `packages/canvas/src/use-k-video.ts` keeps:
  - at most two retired shared-layer warm entries for fast live-layer reuse;
  - at most two dedicated pending/retired preroll claims for predictable scene
    paints.

  Dedicated claims are keyed by surface + element identity, consumed exactly
  once in layout, and never exposed to painters before adoption.
- **Preserve per-surface playback isolation.**
  Dedicated prerolls only warm the decoded first frame at time zero. Adoption
  hands that exact element to the consuming hook, but non-shared scene/video
  playback state (autoplay, loop, mute, playbackRate, audio routing) is still
  applied per consuming surface, so a live or staged preroll cannot leak
  another surface's playback intent.
- **Retain derivative-first rendering for cold and T3 video paths.**
  Konva media/background painters still prefer `proxyMediaKey` until the full
  video resource is ready. List/bin (`T3`) surfaces bypass full-source hooks
  entirely and render only derivatives; they never create full-resolution image
  cache entries or `HTMLVideoElement` decodes.
- **Make `cast-media:` responses truthful HTTP validator boundaries.**
  `app/main/security.ts` now:
  - dedupes only concurrent `fs.promises.stat()` calls per path;
  - emits weak `ETag` (`W/"size-mtime"`) and `Last-Modified` validators;
  - honours `If-None-Match` with `304 Not Modified`;
  - applies `If-Range` semantics for byte ranges;
  - serves HEAD, full-body, and ranged responses with validator and CORS
    exposure headers;
  - re-stats the underlying file on later requests instead of keeping a stale
    lifetime metadata cache.
- **Make NDI audio attachment idempotent per DOM media element.**
  `ndi-audio-capture.ts` now keeps a persistent WeakMap record per element:
  `{ desiredConnected, source, connected, context }`. Removing an element before
  async context setup completes prevents late connection; re-adding reconnects
  the same source node instead of calling `createMediaElementSource()` twice.

## Consequences

- Predictable next-slide / stage / cross-item video paints can show a decoded
  first frame immediately without blanking and without conflating transport and
  scene playback state.
- Live transport video remains a shared exact-element path, with bounded warm
  retirement for fast reuse after surface churn.
- `cast-media:` consumers can revalidate external file changes with standard
  browser semantics instead of being forced through unconditional reloads.
- Observability can report truthful renderer-side video residency and speculative
  execution counters: shared-layer count, detached count, warm resident /
  in-flight / issued / hit / miss / wasted totals.
