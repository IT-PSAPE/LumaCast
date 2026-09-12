# ADR-0012: Truthful Media Metadata and Rebuildable Derivatives

## Status

Accepted

## Context

Issue #236 extends the managed-media boundary from "do not leak source paths"
to "do not force the renderer to decode or guess media facts". Before this
change:

- media asset rows persisted only `id`, `name`, `type`, and `src`, so tile
  layout and backup/restore could not carry truthful dimensions or duration;
- thumbnail-like surfaces mixed responsibilities: some rendered the full source
  directly, some used ad hoc renderer-side poster/cover flows, and none had a
  single rebuildable cache contract;
- thumbnail generation could not be retried or invalidated against source-file
  changes in a durable way, and unsupported platforms had no typed fallback
  path.

The result was inconsistent renderer behavior, weak backup fidelity for media
metadata, and no clear ownership boundary for derivative files.

## Decision

- **Persist truthful nullable metadata on the media asset itself.** SQLite
  schema version 30 adds `width`, `height`, `duration`, and `codec` columns to
  image, video, and audio asset tables. The same fields are part of the schema
  30 project-backup contract. Unknown or unsupported values remain `null`; the
  system never infers them from file extensions or UI state.
- **Probe metadata in main, not the renderer.** Main uses native capabilities
  it already owns:
  - `nativeImage` for image dimensions;
  - `music-metadata` for audio duration/codec and supported video track
    duration/dimensions/codec.
  Slow probe results are guarded by `WHERE id = ? AND src = ?` so replacing a
  source while work is in flight cannot write stale metadata back onto the new
  asset.
- **Treat thumbnails/posters/cover art as a rebuildable cache.** Main owns a
  derivative manifest and files under `userData/thumbs`, keyed by durable asset
  id plus stored-source fingerprint and use (`thumbnail`). The cache is
  deduplicated and bounded to three concurrent jobs, and stale/missing/corrupt
  entries are regenerated or discarded.
- **Keep derivatives out of durable interchange.** Project backups and deck
  bundles carry media metadata but never derivative files or manifest state.
  Derivatives are rebuildable cache, not source of truth.
- **Expose derivatives only through typed IPC and managed capabilities.**
  `ensureMediaDerivative(assetId)` starts or awaits generation and returns a
  patch-bearing status result. When native thumbnail generation is unsupported
  (notably image/video on Linux), renderer code may send one bounded byte array
  through `uploadMediaDerivativeFallback(assetId, bytes)`. Main validates the
  byte cap, decodes with `nativeImage`, writes only inside the derivative cache,
  and returns a patch. Any resulting `thumbnailSrc` crosses the boundary only as
  a session-scoped managed-media capability, never a filesystem path.
- **Source replacement invalidates derivative state immediately.**
  `updateMediaAssetSrc` clears persisted metadata and drops any cached manifest
  entry for the previous source before background regeneration begins.

## Consequences

- Tile and picker layouts can use persisted aspect ratio before the renderer has
  decoded the original file.
- Backup/restore and schema-equivalence tests now cover media metadata as part
  of the durable project contract.
- Derivative generation is now deterministic and bounded, but not universal:
  Electron's `nativeImage.createThumbnailFromPath` is only available for
  image/video thumbnails on macOS and Windows. On Linux, unsupported image/video
  formats rely on the typed fallback upload path. Audio embedded artwork remains
  main-owned and does not need that fallback.
- The renderer no longer uses the full asset source as a thumbnail fallback in
  bin/tile surfaces. Until a derivative exists, those surfaces show loading or
  type-icon states instead of leaking source-specific rendering behavior.
