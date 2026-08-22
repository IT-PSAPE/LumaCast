# Architecture Overview

This document describes the actual implemented architecture for theme lifecycle, item creation, duplication, synchronization, and provenance tracking.

## Dependency Boundaries

The application is an app shell (`app/`) built on ten npm workspace packages
under `packages/*`. Dependency direction across both is enforced by
`tool/check_electron_architecture.mjs` (`npm run check:architecture`), which
parses static ES imports/exports and applies a frozen allow-list that can only
shrink.

### App shell (`app/`)

- `app/main` is the Electron main-process bootstrap (window/menu/IPC wiring,
  security policy) plus the thin Electron-shaped shims in `app/main/ndi/` and
  `app/main/persistence/` that connect headless packages to utility processes.
  It is the process composition root and imports no renderer or feature code.
- `app/renderer` is the UI: screens, feature UI, shared components, and the
  contexts that wire package ports to concrete app state. It reaches main
  only through the typed `castApi` IPC contract (`@lumacast/protocol`); it
  imports no Electron, main-process, or database code.
- `app/renderer/components`, `utils`, and `types` are UI/rendering primitives
  and import no feature implementations.
- Features (`app/renderer/features/*`) have no cross-feature imports except
  directed, documented public edges; bidirectional feature dependencies must be
  removed, never allow-listed. Features import no screens or application shell
  (`App.tsx`, `main.tsx`, `workbench-screen-router.tsx`), which are the
  composition boundaries. When a feature exposes a public entry point
  (`index.ts`), external imports must go through it.
- Observability is consumed through a port; only screens, the shell, and the
  observability feature itself may reference `app/renderer/features/observability`
  directly.
- The NDI engine-session boundary is `app/main/ndi` and `packages/engine`:
  only they touch `@lumacast/ndi-native` and the raw NDI host command
  protocol. The rest of the app reaches NDI through `NdiServiceLike`, and
  `ndi-service-proxy.ts` is the sole writer of host commands.

The checker runs its fixture graphs via `npm run test:architecture`. Adding an
architecture exception means editing the checker's allow-list with a reason and
removal owner; unused entries fail so the allow-list can only shrink.

`feature-isolation` and `feature-cycle` are currently reported as warning-level
refactor debt (exit 0): the feature web is mid-refactor, so these violations are
reported and must not be allow-listed. They flip to hard errors once the feature
web is refactored. All other rules are hard errors; every hard-error violation
must be covered by the frozen allow-list.

## Workspace Layout and Package Boundaries (issue #223, parent #219)

`package.json` declares an npm `workspaces` field (`packages/*`); `npm ci`
resolves the whole tree from the single authoritative `package-lock.json`.
The application itself is not a workspace member — it stays the root package,
unmoved. `packages/ndi-native`'s native build scripts (`build:ndi-native`,
`clean:ndi-native`, `rebuild:ndi-native`) are unaffected by workspace support.

Ten packages exist today, each following the same convention:
`packages/<name>/src/index.ts` is its only public entry point (deep imports
from outside the package fail `package-public-entry`), and internal files
import each other with relative paths, never via the package's own
`@lumacast/<name>` specifier.

| Package | Charter |
| --- | --- |
| `@lumacast/kernel` | Dependency-free primitives (`Id`, `createId`, `nowIso`) every other package may depend on. |
| `@lumacast/composition` | The visual-document domain model — decks, slides, elements, themes, overlays, stages, rich text — and the headless scene-normalization contract every rendering surface shares. |
| `@lumacast/automation` | The cue/macro/trigger-binding domain model and the deterministic macro runtime, plus headless cue description for the macro editor UI. |
| `@lumacast/commands` | Keyboard-shortcut definitions and the app-menu command vocabulary, plus headless keyboard-event matching helpers. `ShortcutActionId`/`AppMenuCommandId` unification is tracked as `TODO(commands-canonical-ids)` in the package. |
| `@lumacast/protocol` | The versioned IPC surface, snapshot patches, the deck-bundle manifest, NDI observability and project-backup contracts, and the runtime codecs that decode them at trust boundaries. |
| `@lumacast/persistence-sqlite` | SQLite-backed persistence: the `CastRepository` store, schema migrations, fixtures, and deterministic test-support helpers. |
| `@lumacast/engine` | The authoritative NDI output runtime: sender lifecycle, frame/audio pipeline, and diagnostics. The Electron-shaped host process/IPC proxy stay as shims in `app/main/ndi`. |
| `@lumacast/playback` | Headless playback decisions: overlay lifecycle, presentation-layer transitions, playlist adjacency, stage-arming state, and deterministic media-residency prediction (`resolveMediaResidencyPlan`). DOM media-element lifecycle, cache execution, and IPC/NDI wiring stay in the app-side provider. |
| `@lumacast/canvas` | The Konva render/editing layer: scene-node components, stage editing/marquee/viewport interaction, image/video resolution, inline text editing, and the shared image-cache / video-pool residency mechanisms consumed by renderer surfaces. The only package permitted to import react/react-dom/konva/react-konva. |
| `@lumacast/ndi-native` | The native NDI sender bridge (native addon), governed by the engine-session rule above rather than the headless-source rules below. |

Rich text rendering inside `@lumacast/canvas` keeps Konva `sceneFunc`s paint-only.
`SceneNodeText` precomputes wrapped lines, per-piece advances, and baseline
metrics in React memos, then invalidates that prepared layout on content,
geometry, style, auto-fit, and font-availability changes. Font availability is
tracked by a renderer-side epoch sourced from `document.fonts.ready` plus the
`loadingdone` event so text first measured against fallback fonts is laid out
again once the real face resolves.

Renderer playback/rendering splits responsibility at two narrow seams:

- `SceneStage` has separate editable and read-only variants. Only the editable
  variant subscribes to the element-editing context and `useSceneStageEditor`;
  read-only thumbnail, monitor, and NDI capture surfaces render the same scene
  tree without pulling in selection, marquee, transform, or inline-text state.
- `CanvasProvider` consumes a stable presentation-layer set (content visibility,
  media/video layer assets, and overlay membership/order) and builds the base
  layered program scene from that discrete set only.
- `MediaResidencyBoundary` sits below `SlideProvider` and above the renderer's
  media consumers. It translates headless `@lumacast/playback` residency tiers
  into renderer execution: mounted surfaces hold T0 hard refs through
  `useKImage`, adjacent/armed image sources acquire advisory `warmImage`
  handles with T1 grace / T2 priority, and predictable video paints acquire a
  bounded set of dedicated `warmVideoClaim` prerolls plus a shared-layer
  `warmVideoSource` pool. Plan replacement releases abandoned warms instead of
  letting speculative work finish.
- `PlaybackProvider` publishes dissolve timing and opacity through a separate
  program-output-only context. `useProgramOutput()` applies per-element overlay
  alpha at the final program monitor / audience-feed consumption point, so
  overlay fades rerender only those consumers while preserving the existing
  per-element compositing semantics.
- `packages/canvas/src/image-cache.ts` now enforces two distinct residency
  classes for images:
  - hard/soft paint safety (`retainImage`, `reserveImageEntry`) that must never
    blank mounted output;
  - advisory T1/T2 speculative residency (`warmImage`) whose own candidate pool
    has an independent 128-entry / 96 MB cap. Hard-pinned T0 output and T1
    grace windows are exempt from that sub-budget; only the evictable T2 pool
    reconciles under pressure.
- `packages/canvas/src/use-k-video.ts` owns the renderer-side video pool. Live
  transport video uses one shared `HTMLVideoElement` per `src`, retains it
  across surface churn, and retires up to two released warm layer entries for
  zero-seek re-adoption. Predictable non-transport video preroll uses up to two
  one-shot dedicated warm claims keyed by surface + element identity; claims are
  consumed in layout, never reused twice, and keep autoplay/mute/loop/rate
  isolated from the eventual per-surface playback element.
- Editable stage callbacks read current element geometry and selection from
  render-body refs rather than effect-written refs so the rAF-batched draft
  buffer stays same-frame fresh without re-churning handler identity on every
  draft flush.
- Scene-building stays provider-independent: `buildRenderScene`,
  `buildThumbnailScene`, and `buildResolvedRenderScene` accept an optional
  source→proxy lookup, and Konva media/background painters prefer the proxy
  derivative while the full source is still loading. Arbitrary jumps therefore
  paint the managed `thumbnailSrc` immediately and swap to the full source
  without blanking the scene once the full decode completes. Thumbnail / list
  (`T3`) surfaces stay derivative-only and never instantiate full-resolution
  image cache entries or full `HTMLVideoElement` decodes.
- Media whose file cannot be read is reported, not silently dropped
  (ADR-0018). `packages/canvas/src/missing-media-placeholder.tsx` is the single
  painter for that state — a theme-adaptive muted-red field with a warning
  glyph and a `MISSING MEDIA` label — used by both `SceneNodeMedia` and
  `SceneSlideBackgroundMedia`. `MISSING_MEDIA_SURFACES` limits it to
  `deck-editor`, `monitor`, and `list`: `show` (the surface NDI captures),
  `stage`, and the `ndi-*` surfaces keep painting transparent so a fault report
  never reaches a live output. A loaded proxy derivative always suppresses it.
  The two DOM thumbnail components report the same condition with the theme's
  error tokens and the same "Missing media" copy.

`tool/check_electron_architecture.mjs` walks `packages/*` and enforces, as
hard errors that are never allow-listable:

- No package may import anything under `app/` — packages may not depend on the
  application.
- A package must not import React, React DOM, Konva, React-Konva, or Electron
  — packages are headless domain/platform code, except `@lumacast/canvas`,
  which may import react/react-dom/konva/react-konva (never Electron).
- A persistence package (name starting with `persistence`) must not import
  renderer code.
- Package imports must go through the package's public entry point
  (`packages/<name>/src/index.ts` or `packages/<name>/index.ts`); deep
  internal imports fail.
- Package-to-package dependency direction is a default-deny allow list keyed
  by package name (`PACKAGE_DEPENDENCY_DIRECTIONS` in the checker), recording
  the directions decided in issue #219: kernel depends on nothing and
  everything may depend on it; composition depends on kernel; automation
  depends on kernel and composition; commands depends only on kernel;
  protocol depends on kernel, composition, automation, and commands;
  persistence-sqlite depends on kernel, composition, automation, and
  protocol; engine depends on kernel, composition, protocol, and ndi-native;
  playback and canvas each depend on kernel, composition, and protocol. An
  unlisted package name starts with zero permitted package dependencies.
- Cycles between packages are forbidden and must be removed, never
  allow-listed.

Each rule is also proven by a committed fixture scenario under
`tool/fixtures/electron-architecture/scenarios/packages/` and
`scenarios/application/`, run via `npm run test:architecture`.

## NDI Telemetry and Observability Contracts

- Video frames normally travel over one versioned `MessagePort` from the
  renderer readback worker directly to the NDI utility process. Main and
  preload establish and forward the port, but the 1920x1080 RGBA/BGRA payload
  bypasses both the renderer and main-process event loops. Electron 35 does not
  preserve this `ArrayBuffer` with a transfer list, so the worker deliberately
  performs one structured clone on that direct port. The utility host accepts
  frames only after a matching version/name handshake and validates the output
  name, attempt id, dimensions, exact byte length, and advisory telemetry.
- The direct channel is optional. A handshake timeout, invalid handshake or
  host response, closed port, unavailable host, or frame-release watchdog
  resets it and requests a replacement with bounded exponential backoff;
  frames use the existing renderer -> main -> proxy -> utility copy path until
  a replacement is ready. The backoff resets only after a successful direct
  handshake. A malformed frame with a valid attempt id receives a rejected
  release without being mistaken for channel failure.
- The renderer's off-screen NDI capture loop in
  `app/renderer/features/playback/ndi-frame-capture.tsx` is still a one-slot
  backpressure boundary, but the slot is now keyed by a monotonic
  per-attempt id. Both transport routes preserve that id through the utility
  host and `@lumacast/engine`; the matching host-side `frameReleased` returns
  on the originating route and is the only release that can clear the
  in-flight attempt. Watchdog expiry is local policy only; it never claims a
  later attempt was released.
- Renderer-supplied frame telemetry is advisory, not authoritative. Main IPC
  sanitizes optional copy-path telemetry before stamping `mainReceivedAtMs`;
  the utility validates direct-path telemetry and strips timestamps owned by
  bypassed boundaries. `@lumacast/engine` sanitizes again before merging
  counters or pipeline spans. Invalid enums are dropped, count fields must be
  bounded nonnegative integers, duration/span samples are bounded before
  aggregation, and only renderer-authored drop reasons are merged. Duplicate
  backpressure sources are canonicalized to one count, and activate/take
  dedupe keys exist only for a fully valid correlation tuple (`kind`, `reason`,
  `issuedAt`, `session`, and `sequence`) whose intended sender-side span is
  actually aggregatable. Malformed telemetry therefore cannot turn a
  successful native send into `nativeSendFailed`, poison aggregates to
  `Infinity`, or suppress a later valid activate/take frame with the same key.
- Pipeline diagnostics keep the routes distinct: the copy path populates
  `rendererToMainIpc`, `mainHandler`, and `mainToHostIpc`; only the direct path
  populates `directWorkerToHostIpc`. Both then populate `hostToNative`.
- The native sender declares every video frame as 30000/1001 progressive and
  creates NDI senders with `clock_video=false`. The renderer's one-frame loop
  owns cadence; the native SDK must not add a second blocking video clock.
- Slide/take latency correlation is scoped by the target output item/playlist
  entry, not by slide id alone. `SlideProvider` records the intended
  `activate`/`take` plus the truthful reason available at that boundary today
  (`sequential`, `jump`, or `crossItem`); `ndi-frame-capture.tsx` leases that
  correlation to the first matching sender attempt and consumes it only after
  the matching accepted `frameReleased`. Repeated takes on an already-live
  slide therefore force one fresh send attempt even when the scene signature is
  unchanged.
- Renderer observability remains always-on through
  `app/renderer/features/observability/observability-runtime.ts`. The canvas
  collector records visible-only rAF cadence plus threshold events with the
  context it can actually observe (visibility, mounted canvas/video counts, and
  workbench mode). It does not claim element- or surface-level attribution it
  does not have.
- The "Source playback" and image-cache panels expose only counters backed by
  current APIs: DOM video residency/ready-state/drop stats plus canvas
  image-cache entry totals, evictable bytes, and warm-residency counters
  (active T1/T2 entries, in-flight warms, retain hits, cancellations, and
  wasted speculative decodes). The video pool reports shared-layer counts plus
  warm resident / in-flight / issued / hit / miss / wasted counters. The
  renderer still does not expose a global derivative-file registry view;
  derivative generation remains a main-owned cache concern from issue #236.
- Main-process system metrics are sampled lazily on first use and use a
  monotonic event-loop-lag sampler. The reported p95/max are over the current
  rolling window, not a lifetime wall-clock maximum.

## Renderer Bootstrap and State Subscription Boundaries

- The application shell renders before the initial project snapshot resolves.
  `AppProvider` starts the asynchronous load and exposes loading/error state;
  `AppLayoutContent` owns the loading, retry, and ready branches. Database open
  or migration work therefore does not block creation of the Electron window.
- NDI output capture is behind a lazy `NdiOutputsGate`. The capture tree and its
  canvas/Konva dependencies mount only while an output is enabled, and disabling
  all outputs releases the capture/audio resources again.
- Scene-stage entry points are lazy boundaries. Production chunking keeps Konva
  and React-Konva out of the initial renderer entry and loads them with editor,
  preview, or output-capture surfaces that actually render a stage.
- Root application state is selector-based. `AppProvider` wires IPC and system
  subscriptions into the Zustand app store; `useCast`, `useNdi`, live-output,
  diagnostics, theme, and status selectors expose narrow subscriptions rather
  than a single changing provider value. See ADR-0010.
- These startup boundaries are architectural, not loading decoration: shell UI
  must remain usable while snapshot work is pending, and importing a stage or
  NDI implementation eagerly from the renderer entry is a regression.

## Renderer / Main / Repository Mutation Boundary

- **Renderer**: React context providers (`AssetEditorProvider`, `NavigationProvider`, etc.) handle UI state and staging.
- **Preload**: `contextBridge.exposeInMainWorld('castApi', api)` exposes typed IPC methods.
- **Main IPC**: `safeHandle` wrappers validate inputs and delegate to the async
  `PersistenceServiceLike` port or main-owned services such as media-derivative
  generation.
- **Persistence utility process**: `PersistenceHostDispatcher` accepts only the
  explicit `CastRepository` method vocabulary, executes calls FIFO, and owns
  repository construction, migrations, SQLite access, restore, and close.
- **Repository**: `CastRepository` stays synchronous and Electron-free inside
  `@lumacast/persistence-sqlite`; it performs SQLite operations transactionally
  and returns `SnapshotPatch`.

**Rule**: Only persisted database IDs may enter repository operations. The renderer must resolve temporary staged IDs via `resolveThemeIdForMutation` before calling any IPC method that consumes a theme ID.

### Persistence Utility-Process Lifecycle (issue #241, ADR-0014)

- `app/main/index.ts` forks `persistence-host.js` after Electron is ready, then
  registers IPC and creates the window immediately. It does not await database
  opening or migrations; `PersistenceServiceProxy` queues pre-ready calls in a
  monotonic FIFO and sends them only after the host reports ready.
- Commands use a closed, typed method vocabulary and structured-clone-safe
  arguments/results. The host dispatcher runs one repository call at a time,
  so no later call observes a transaction in progress. Calls are never replayed:
  a send failure or unexpected utility-process exit rejects all queued/in-flight
  work, enters a fatal state, and requires an application restart.
- Initialization, migration, validation, and restore progress cross a one-way
  preload event. Main retains the latest persistence progress and replays it
  when preload subscribes, so work reported before window creation still resets
  the renderer's 15-second snapshot inactivity watchdog. While `getSnapshot`
  is pending, main emits a five-second heartbeat independently of synchronous
  host-side snapshot assembly, preventing healthy large reads from appearing
  inactive. Restore completion clears its status. Main performs
  backup trust-boundary validation in bounded asynchronous row batches before
  forwarding the validated document to the utility process.
- Normal application quit stops accepting new calls, drains the dispatcher,
  and calls the repository's idempotent `close()`. An active restore is part of
  that FIFO drain. If acknowledgement takes more than two seconds, main hides
  the application windows to preserve bounded UI quit behavior but keeps the
  process alive until the host safely completes promotion, closes SQLite, and
  acknowledges shutdown; it never force-kills an active restore.
- Project backups and snapshots still cross the utility-process boundary as
  structured-cloned values. This removes SQLite, migrations, and restore work
  from the main event loop, but cloning a very large payload can still incur a
  bounded main/host serialization cost; streaming is deferred.

## Automation Runtime Guardrails

- `@lumacast/automation` owns macro-run pacing, lifecycle, and revert bookkeeping in the headless runtime (`packages/automation/src/runtime.ts`); `AutomationProvider` in `app/renderer/features/automation/automation-context.tsx` remains the renderer composition boundary that supplies playback, clock, observability, and status-text ports.
- Looping macros are paced to a minimum inter-iteration interval in the runtime itself. The floor is a deadline pad, not an added delay: authored cue-step delays still determine cadence when they already exceed the floor, but zero-delay infinite loops must yield often enough to stay cancellable and avoid monopolizing the renderer thread.
- Run revert bookkeeping is bounded by canonical cue identity, not by every iteration. A run records the first application of each cue object and reverts static inverses in reverse first-application order. This preserves the existing end-state semantics (`Cancel` leaves applied effects live; `Revert` clears them via static inverses) without growing revert cost or memory with loop duration.
- Global lifecycle cancellation is an app-level operator control, not a package concern. The renderer exposes `cancelActiveMacros()` from `useAutomation()` and wires it to the Program panel's macros toolbar. The control cancels active runs only; it does not revert already-applied effects.
- Per-cue playback observability is sampled at the runtime boundary for looping macros: the first iteration still records cue start/completion events, later iterations do not. Failure events remain recorded so runaway loops cannot grow the session log without bound.

## Renderer Navigation and Window-Open Trust Boundary (issue #158, ADR-0007)

- `app/main/index.ts`'s `createMainWindow()` attaches `will-navigate` and
  `setWindowOpenHandler` to the window's `webContents`; both are deny-by-default.
  `will-navigate` allows only the application's own origin
  (`isTrustedWebContentsUrl` in `app/main/security.ts`: the dev-server hosts in
  `DEV_ALLOWED_HOSTS`, or the exact packaged `renderer/index.html` path) and
  otherwise calls `event.preventDefault()`. The window-open handler always
  returns `{ action: 'deny' }` — no new `BrowserWindow` is ever created from
  renderer-requested navigation — and, only for a URL matching the explicit
  `APPROVED_EXTERNAL_ORIGINS` allow-list in `security.ts` (currently
  `https://openai.com`, the Help menu's "Learn more" item), calls
  `shell.openExternal(url)` as a side effect before still returning deny.
- Both allow-lists live in source (`app/main/security.ts`) and are extended
  only by editing that file; neither is ever populated from renderer input,
  IPC payloads, or configuration. `isTrustedWebContentsUrl` is also reused by
  `assertTrustedIpcSender`, so its file-path and credentials handling harden
  both call sites at once.
- Denial never logs or surfaces the denied URL: both handlers log only
  `describeUrlSchemeForLogging(url)` (the scheme, or `'unparseable'`), since a
  `file:` URL can carry an absolute filesystem path.
- The `cast-media:` privileged scheme (registered in `app/main/index.ts`,
  gated by `resolveTrustedCastMediaRequest`) is a resource-fetch boundary for
  `<audio>`/`<video>` elements, not a navigation/window-open target, and is
  intentionally not part of either allow-list above. What it resolves is
  described below (issue #159, ADR-0008).
- `fetchLocalFileResponse()` in `app/main/security.ts` is also the media HTTP
  validator boundary for `cast-media:`. It dedupes only concurrent
  `fs.promises.stat()` calls, emits weak `ETag` / `Last-Modified` validators,
  honours `If-None-Match` / `If-Range`, serves HEAD and byte ranges, and keeps
  validators revalidated against the filesystem on later requests rather than
  holding a stale lifetime cache.
- Renderer process sandboxing (`webPreferences.sandbox`) stays `false`; see
  ADR-0007 for the prerequisites (preload sandboxed-environment audit,
  renderer dependency verification, packaging/signing checks) that would need
  to be satisfied before enabling it.

## Media Library (ADR-0019)

- Imported files are **copied into `<userData>/media`** and the database stores
  a reference to the copy, so a project depends only on files the app owns.
  `app/main/media-library.ts` (`MediaLibraryService`) owns the directory;
  copies are content-addressed (`<sha256>.<ext>`), written through a `.part`
  file and renamed into place, and cloned copy-on-write where the filesystem
  supports it.
- The stored form is `cast-media://library/<64 hex>[.<ext>]`, resolved relative
  to the library directory. Its pattern admits no separator, `%`, or `..`, so it
  cannot express a path outside the library. `resolveLocalMediaSourcePath`
  exists in two copies — `app/main/media-source-path.ts` and
  `packages/persistence-sqlite/src/media-source-utils.ts`, because the store
  runs in a utility process — and both check the library branch before the
  generic percent-decode. They must move in step.
- `MediaLibraryService.adopt` sits in front of every media write in
  `app/main/ipc.ts`: `createMediaAsset`, `updateMediaAssetSrc`, and the relink
  decisions of `finalizeImportBundle`. Sources with nothing to copy (`blob:`,
  `http(s):`, relative, empty, or an existing library reference) pass through
  unchanged.
- **Replace is a true replacement.** `updateMediaAssetSrc` repoints every stored
  reference to the previous source — elements, nested group children, and
  slide/theme/overlay/stage backgrounds — in one transaction, and returns a
  patch covering all of them, so replacing a lost file repairs the slides that
  lost it. `preserveMetadata` keeps the metadata columns for the adoption pass,
  where the bytes are unchanged.
- **Adoption** (`adoptExistingAssets`) copies pre-library assets into the
  library in the background, starting when the renderer subscribes, emitting
  each repoint as a patch the renderer applies so its snapshot — and undo —
  stays in step. Sources whose file is already gone are left alone and read as
  missing media (ADR-0018).
- **Nothing is deleted implicitly.** `reclaim` is explicit, removes only names
  the app writes itself, and mirrors `maskAppSnapshot`'s walk to decide what is
  still referenced.

## Managed Media Capabilities (issue #159, ADR-0008)

- The renderer never holds a filesystem path for managed media. Every media
  source crossing IPC outbound is replaced by an opaque **managed media id** —
  `cast-media://m<32 hex>` — that main mints and resolves
  (`app/main/media-capability.ts`). The renderer treats it as an opaque URL it
  may render or hand back, and never constructs or parses one.
- Translation is wired once at the RPC dispatch loop in `registerRpcHandlers`
  (`app/main/ipc.ts`), not per handler: arguments have managed ids resolved back
  to stored sources on the way in (`resolveManagedMediaArgs`) and results have
  stored sources replaced by managed ids on the way out
  (`maskManagedMediaResult`). No repository method knows managed ids exist.
- **Managed ids are not a storage format.** The database stores either the
  legacy `cast-media://<encodeURIComponent(absolutePath)>` form or, for media
  the app owns a copy of, `cast-media://library/<sha256>[.<ext>]` (ADR-0019).
  Either way the stored string is the asset's identity for broken-source
  detection, deck-bundle export/relink, import dedupe, and the v22 migration.
  Managed ids are session-scoped capabilities, not durable identifiers. Inbound
  resolution returns the byte-identical stored string, which is what keeps
  `restoreFromSnapshot` from seeing a spurious change on every media row.
- Media assets persist only truthful, nullable metadata: `width`, `height`,
  `duration`, and `codec` live on the asset row in SQLite and in schema-version
  30 project backups. Unknown or unsupported values stay `null`; they are never
  inferred from file extensions or renderer guesses. `updateMediaAssetSrc`
  clears those columns immediately, and background probes write them back only
  when `WHERE id = ? AND src = ?` still matches so stale async work cannot
  overwrite a replaced source.
- Thumbnails are a **rebuildable main-process cache**, not durable project
  state. `app/main/media-derivatives.ts` keeps a bounded (max 3) deduplicating
  generation queue and a manifest under `userData/thumbs`, keyed by durable
  asset id plus stored-source fingerprint. Cache entries are invalidated when
  the source path, size, mtime, or decoded thumbnail no longer matches. Project
  backups and deck bundles never include derivative files or the manifest.
- The renderer requests derivatives through typed IPC (`ensureMediaDerivative`
  and the bounded `uploadMediaDerivativeFallback` escape hatch) and receives an
  optional `thumbnailSrc` only as another managed-media capability. Main mints a
  fresh capability each session; the renderer never receives a filesystem path
  for either the source or the cached thumbnail. Unsupported image/video
  thumbnail generation on Linux falls back to a one-time renderer upload of
  validated bytes; audio embedded artwork is normalized entirely in main.
- Renderer bin/tile surfaces stay T3-only: they mount only managed
  `thumbnailSrc` derivatives and never decode the full source or construct a
  full `HTMLVideoElement`. Full-resolution warming happens only through the
  renderer's playback-driven residency boundary for image sources that are
  adjacent, armed, or about to cross an item boundary.
- Grants carry a **declared use** taken from the entity that carried the source
  outbound, never from renderer input. `image` and timed media (`video`/`audio`)
  are separate families and cross-family use is denied; within timed media the
  distinction is deliberately not enforced. The protocol handler takes intended
  use from `Sec-Fetch-Dest`, which the renderer cannot forge.
- The id pattern admits no separator, `%`, or `.`, so traversal and encoded
  separators fail the pattern rather than being normalized away. Failures are a
  closed set of reason codes carrying no path, id, or offending string;
  `restoreProjectBackup` calls `revokeAllManagedMedia()` because it swaps the
  database out from under the renderer.
- **Not generalized:** a file the user just picked in a native dialog or dropped
  on the window travels inbound as a raw `cast-media://<encoded path>` string
  (`castMediaSrc` in `app/renderer/utils/slides.ts`). These are short-lived
  import capabilities, are not renderable, and pass the inbound transform
  untouched — pass one to an IPC mutation and render the `src` that comes back.

## Staged Theme Resolution

- `AssetEditorProvider` maintains `tempToPersistedIdMap` (Map<tempId, persistedId>).
- `pushThemeChanges()` uses a single-flight promise guard (`pushPromiseRef`).
- `resolveThemeIdForMutation(themeId)`:
  1. Checks `tempToPersistedIdMap` for already-resolved IDs.
  2. If the theme is staged or there are pending changes, awaits `pushThemeChanges()`.
  3. Returns the resolved persisted ID or throws if resolution fails.
- All theme-consuming operations (Apply, Create, Reset, Sync) route through this resolver.

## Atomic Item Creation

- `createItem(input)` is the one repository operation for creating a themed or unthemed item (Presentation, Lyric, or Talk) together with its first slide. `ItemCreateInput = { type: ItemType; title?; themeId?; playlistId?; position? }` — there is no `collectionId`/`groupId`: collections and libraries do not exist, and a new item attaches to a playlist only through `playlistId`/`position` (an ordinary `playlist_entries` insert, not a group membership). It validates title and owner type, theme existence (looked up in the one theme table `input.type` implies — `presentation`/`lyric`/`talk` themes cannot even be named by the wrong item type, so there is no separate "theme/owner-type compatibility" check to perform), and playlist existence when `playlistId` is supplied.
- Runs in one SQLite transaction:
  1. Creates the owner (presentation/lyric/talk) with explicit `order_index` (dense within that one table only — presentations, lyrics, and talks each keep an independent order sequence) and its final `theme_id`.
  2. Creates the first slide once, with `background_source` = 'theme' if themed, 'local' otherwise.
  3. Applies theme elements via `applyThemeToElements` (with provenance) when themed; otherwise falls back to the owner type's current default first-slide content (the lyric branch keeps its initial editable lyric text).
  4. Rolls back the owner, slide, and elements together if any validation or write fails — no partially created item is left behind, and nothing is selected or navigated to.
- The optional `playlist_entries` insert (when `playlistId` is supplied) runs as a deliberately separate transaction immediately after: the lightweight SQLite wrapper's `BEGIN IMMEDIATE`/`COMMIT` does not nest, so the row/element transaction above commits first.
- The IPC result is `ItemCreateResult = { itemId, patch }`: the created owner's id is returned explicitly alongside the single `SnapshotPatch`, so the renderer never infers it by diffing entity arrays before/after the mutation.
- Renderer callers — the create-item dialog (`navigation-context.tsx`), legacy app-menu creation (`createPresentation`, `createEmptyLyric`), and playlist-panel creation (`use-playlist-panel-management.ts`) — call the IPC method once, apply the returned `patch` via `mutatePatch`, and select/navigate using the returned `itemId` directly.
- `createSlide` remains the sole operation for adding a later slide to an existing owner; it is never overloaded with owner creation.
- On failure, selection and navigation state are retained.

## Exact-Copy Duplication

### Whole-Item Duplication (`duplicateItem`)
- `ItemDuplicateInput = { type: 'presentation' | 'lyric'; id }` — Talk is not a legal `type` at the wire level (rejected by the decoder), not merely a runtime error: there is no `duplicateTalk`, and no runtime duplicate-talk guard/error exists (the absence is structural, decided at the type/codec boundary rather than thrown from the repository).
- Generates copy names case-insensitively within the same owner table (`presentations` or `lyrics`).
- Inserts duplicate at `sourceOrder + 1`; shifts only later siblings within the source's own table (`order_index` is a per-table sequence — there is no collection dimension to scope by, since collections do not exist).
- Returns `ItemDuplicateResult = { itemId, patch }`; the patch includes shifted sibling order updates. Callers select `itemId` directly and never scan the snapshot (see ADR-0004).
- Deep-copies slides, elements (new collision-free IDs, preserved `sourceThemeElementId`), and `background_source`.
- Does not reapply or sync the assigned theme.

### Slide Duplication (`duplicateSlide`)
- Preserves `background_source` and recursive `sourceThemeElementId`.

### Theme Duplication
- Creates new temporary theme ID, backing-slide ID, and collision-free element IDs (including nested groups).
- Deep-copies background, gradient stops, elements, nested children, payloads.
- Preserves dimensions and managed-media references; which of the four theme tables (`presentation_themes`/`lyric_themes`/`talk_themes`/`overlay_themes`) the duplicate belongs to is fixed by which table the source came from — there is no `kind` field and no collection to preserve.
- Persisting the draft normalizes IDs/ownership exactly once in one transaction.

## Element Provenance (`sourceThemeElementId`)

- **Schema**: `slide_elements.source_theme_element_id` (nullable).
- **Apply/Reset**: Sets explicit `sourceThemeElementId` on all materialized elements (recursive for groups).
- **Sync**: Matches elements by `sourceThemeElementId` only (no ID-parsing fallback in normal runtime).
- **Duplicate**: Preserves `sourceThemeElementId` with new materialized IDs.
- **Detach**: Nulls `sourceThemeElementId` recursively.
- **User-created**: `sourceThemeElementId` = null.

## Background Ownership (`backgroundSource`)

- **Schema**: `slides.background_source` = 'theme' | 'local' (default 'theme' for legacy).
- **Apply/Reset/Sync**: Sets `background_source = 'theme'`.
- **Create (first slide)**: 'theme' if themed, 'local' otherwise.
- **Create (later slide)**: 'theme' if owner has assigned compatible theme, 'local' otherwise.
- **Manual edit (`updateSlideBackground`)**: Sets `background_source = 'local'`.
- **Detach**: Sets `background_source = 'local'` on all slides.
- **Duplicate**: Preserves exactly.
- **Sync**: Updates background only when `backgroundSource === 'theme'`; preserves local backgrounds.

## Sync Semantics (`syncThemeToLinkedItems`)

- Signature `syncThemeToLinkedItems(themeId, itemType: ItemType)`: sync is strictly per-family by construction, not by a runtime compatibility check — a presentation theme's linked-owner lookup only ever queries the `presentations` table (`WHERE theme_id = ?`), so it structurally never fans out to lyrics or talks. There is no cross-family case to guard against.
- Resolves staged theme ID via `resolveThemeIdForMutation` before syncing.
- Synchronizes every linked owner in `itemType`'s own table in one transaction.
- Matches elements by explicit `sourceThemeElementId`.
- Same-type matches: updates geometry/style in place, preserves authored text (plain/rich).
- Type changes: removes old, creates new with collision-free ID.
- Removes only elements whose provenance points to removed theme elements.
- Preserves null-provenance custom elements and their relative order.
- Idempotent: repeated sync with no changes produces no data/ordering changes.

## Detach Semantics (`detachThemeFromItem`)

- Signature `detachThemeFromItem(itemRef: ItemRef)` — the item's own type already selects the right owner table, so no separate `themeType` parameter is needed.
- Clears owner `theme_id`.
- Sets `background_source = 'local'` on all slides.
- Nulls `source_theme_element_id` on all elements (recursive).
- Returns complete patch with owner, slides, and elements.
- Later sync of former theme cannot affect detached owner.

## Migration (v22)

- Recomputes `background_source` for legacy slides:
  - No assigned theme → 'local'.
  - Assigned theme missing/incompatible → 'local'.
  - Slide background exactly equals theme background → 'theme'.
  - Otherwise → 'local'.
- Repairs element provenance conservatively:
  - Starts from null.
  - Requires deck slide with assigned compatible theme.
  - Requires exact legacy `<slideId>:<themeElementId>` prefix.
  - Requires extracted ID exists in assigned theme.
  - Leaves unmatched/ambiguous null.
  - Does not guess group-child provenance.
- Idempotent and runs in one transaction.

## Item-Model Migrations (v23–v27, issue #219)

Five migrations destroyed the unified deck-item/collection/library model and
replaced it with the current per-type item model:

- **v23 `drop-collections`**: rebuilds the ten tables that carried a
  `collection_id` (`presentations`, `lyrics`, `talks`, `themes`, `overlays`,
  `stages`, `image_assets`, `video_assets`, `audio_assets`, `macros`/`actions`)
  without that column, and drops the eight `*_collections` tables outright.
  There are no per-bin folders anywhere in the schema any more.
- **v24 `global-playlists`**: rebuilds `playlists` without `library_id` using a
  deterministic merge order over the dying `libraries`/`playlists` ordering,
  then drops the `libraries` table. Every playlist is now global.
- **v25 `playlist-separators`**: rebuilds `playlist_entries` as a flat,
  `kind`-discriminated row list (`'item' | 'separator'`) and drops
  `playlist_groups`. Item-entry ids are preserved byte-for-byte (live/preview
  selection and armed output key on entry id); separator rows get fresh ids.
  Each former group becomes one separator row carrying the group's name/color,
  followed by its entries, in canonical `order_index`-then-`rowid` order —
  applied identically here, in project-backup restore, and in bundle import.
- **v26 `per-owner-themes`**: creates `presentation_themes`, `lyric_themes`,
  `talk_themes`, `overlay_themes` (no `kind` column, no `collection_id`, each
  with its own `order_index` sequence), distributes rows out of the old
  `themes` table by its `kind`, and — because a theme could be assigned to a
  Talk even though only `'slides'`/`'lyrics'`/`'overlays'` kinds existed —
  **clones** every theme referenced by at least one Talk into `talk_themes`
  under a brand-new id (one clone per distinct source theme, shared by every
  talk that referenced it), including its container slide, its elements, and
  recomputed provenance/background-source on the talk's own slides. `slides`
  is rebuilt with four owner columns (`presentation_theme_id`/`lyric_theme_id`/
  `talk_theme_id`/`overlay_theme_id`) replacing the single `theme_id`, the
  exclusive-arc CHECK is extended to all nine owner columns, and container
  slides' `kind` is rewritten from the old bare `'theme'` to the matching
  per-owner value (`'presentationTheme'`/`'lyricTheme'`/`'talkTheme'`/
  `'overlayTheme'`). Finally `themes` is dropped, and
  `presentations`/`lyrics`/`talks` are rebuilt with `theme_id` retargeted at
  their own theme table.
- **v27 `item-scope`**: renames the macro `scope_level` value `'deckItem'` to
  `'item'`, and densely renormalizes `order_index` (0..n) on
  `presentations`/`lyrics`/`talks` and the four theme tables.

All five run with `PRAGMA foreign_keys` off around their table rebuilds, like
every other structural migration in this system. `LATEST_SCHEMA_VERSION` is
30.

## Migration System (one ordered transactional runner)

- `packages/persistence-sqlite/src/migrations/definitions.ts` is the canonical dense ordered migration list, v1..v30; v1 is the bootstrap. Both a fresh v0 database and any historical database advance through the same `runMigrations` path (`packages/persistence-sqlite/src/migrations/runner.ts`); there is no separate fresh-install schema.
- `PRAGMA user_version` is the sole schema cursor. A database whose `user_version` is newer than the highest supported version is refused (`FutureSchemaVersionError`) before any backup or write.
- An existing database (any table, or a nonzero `user_version`) receives exactly one `VACUUM INTO` backup, `lumacast.bak-v<source>.sqlite`, before its first pending migration. The backup is opened read-only and verified with `integrity_check` and a matching source `user_version`; a failed or unverified backup aborts the migration (`MigrationBackupError`).
- Each migration's `up` and its `user_version` bump commit in one SQLite transaction, so a crash rolls both back and the next start retries from the prior version. FK-off table rebuilds toggle `PRAGMA foreign_keys` around that transaction and restore its prior state afterward.
- Fixtures `schema-v0`..`schema-v30` pin frozen structural fingerprints and convergence coverage for every historical version; they are regression evidence, not a second schema definition. Migrations v1–v22 and their fixtures are frozen and never edited; every schema change since is a new migration.
- See ADR-0005 for the full contract and rationale.

## Snapshot / Bundle Persistence

- `Slide` includes `backgroundSource` (required, not optional).
- `BundleSlide` includes optional `background` and `backgroundSource`.
- Snapshot creation/restore, bundle export/import all persist `backgroundSource`.
- Round-trip tests verify background and recursive element provenance survive restart and snapshot restore. Bundle export/import specifically is covered by `packages/persistence-sqlite/src/theme-provenance.test.ts`: `finalizeImportBundle` re-materializes every imported theme with new element IDs, so it translates each item element's `sourceThemeElementId` through a map from pre-import to newly materialized theme element IDs built during the theme-import pass; an ID that does not resolve through that map (dangling, unknown, or naming a theme not assigned to that item) is written as `null` rather than passed through, since an unresolved ID would otherwise read as "source removed from the theme" and be deleted on the next sync (see ADR-0003).

## Project Backup (format v2)

- A project backup is a separate, complete recovery artifact (issue #145), distinct from deck bundles: it serializes the entire application state, not a selection of items. Managed media files are never copied — only their `src` references are recorded.
- Envelope (`ProjectBackup`): `{ format: 'cast-project-backup', version: 2, schemaVersion: 30, tables }`. `schemaVersion` is the source `PRAGMA user_version`, matched exactly (not a range); there are still no settings/preferences tables, so migration/schema metadata is carried by `schemaVersion` alone. The envelope carries no timestamp, so two exports of unchanged data are deeply and byte-for-byte identical.
- `PROJECT_BACKUP_VERSION` is 2 (issue #219 item-model refactor, decision D8). `tables` now contains 21 application-owned tables — `presentations`, `lyrics`, `talks`, `slides`, `slide_elements`, `talk_script_blocks`, `playlists`, `playlist_entries`, `image_assets`, `video_assets`, `audio_assets`, `overlays`, `presentation_themes`, `lyric_themes`, `talk_themes`, `overlay_themes`, `stages`, `cues`, `actions`, `action_steps`, `trigger_bindings` — with no `libraries`, no `playlist_groups`, no `collection_id` anywhere, and no single `themes` table (the four per-owner theme tables each get their own key, sharing one structural `ProjectBackupThemeRow` shape). `playlist_entries` rows are flat and `kind`-discriminated (`'item' | 'separator'`): `kind='item'` populates exactly one of `presentation_id`/`lyric_id`/`talk_id` and leaves `label`/`color_key` null; `kind='separator'` leaves all three owner columns null and carries `label`/`color_key` instead — there is no `group_id`. Every row field is constructed explicitly from the SQL columns (snake_case, no object spread) in deterministic order (`ORDER BY created_at ASC, id ASC`); JSON-valued columns are serialized as raw JSON strings.
- **Version 1 backups (schemaVersion exactly 22) are imported via migration replay**, not a hand-written transform: `restoreProjectBackup` dispatches on `isLegacyProjectBackup` first, validates the document against the frozen v1 contract (`validateLegacyProjectBackup`, reconstructed verbatim from the pre-#219 validator), then `migrateLegacyProjectBackup` materializes the rows into a throwaway SQLite database at schema 22 (`applyMigrationsThroughVersion`) and replays the real migrations v23–v30 over it — the same tested code path a live upgrade uses (groups → separator + entries with item-entry ids preserved, `themes.kind` → per-owner tables with talk-theme cloning, collection ids dropped, macro scope renamed, media metadata columns added) — before feeding the result through the ordinary v2 restore path. `validateProjectBackup` itself remains v2-only and still rejects version 1 with an "older app version" message; a version-1 document with any `schemaVersion` other than 22, or a future format version, is rejected explicitly.
- **Category decision (issue #215, parent #116/#153): this family is a serialization contract, not a persistence DTO**, and lives in `app/contracts/project-backup.ts` (`ProjectBackup`, `ProjectBackupTables`, and the seventeen `ProjectBackup*Row` interfaces). #153 classified it as the textbook persistence-DTO candidate on shape alone (snake_case fields mirroring SQL columns verbatim) and set out to move it to `app/database/dto/`. That is architecturally impossible: the family is consumed as a type-level dependency by `app/core/deck-bundles.ts` (`validateProjectBackup`, `ProjectBackupTableKey`) and by the IPC contract (`app/core/ipc.ts`, `app/main/ipc.ts`, `app/main/preload.ts`, `app/main/deck-bundle-archive.ts`) as well as by `app/database/store.ts`, and `core-purity` categorically forbids `app/core` from importing `app/database`. Shape alone does not decide the category — the deciding fact is which zones hold a type-level dependency on it; a shape mirroring SQL columns that only the database layer ever names would belong in `app/database/dto/` instead. `app/contracts/` is the correct home because it is the neutral runtime-decode boundary every zone may already import (issue #149), and it must not import `app/database`, `app/main`, `app/renderer`, React, Electron, or the native module (`contracts-purity`, issue #216) — so this move cannot relocate the original problem back through the database. `app/core/types.ts` keeps export-only re-exports of the family for existing `@core/types` importers, per the #153 facade convention; #155 is the exit condition that removes them. Record this decision here rather than relitigating it at the next split.
- Core policy owns the contract: `validateProjectBackup` in `packages/protocol/src/deck-bundles.ts` (with `ProjectBackupValidationError`) rejects the legacy version 1 explicitly (see above), a future format version (> 2), a `schemaVersion` other than the exact supported version, wrong format string, an envelope that is not exactly the four keys `format`/`version`/`schemaVersion`/`tables`, missing or extra tables/columns, malformed types/enums/flags, and slide rows that break the single-owner invariant the schema CHECK enforces. Column lists are enumerated via `PROJECT_BACKUP_COLUMN_SPECS` in the same module. Cross-table referential/ownership integrity is restore-side and deferred to issue #146.
- The repository produces and validates without mutating the active database: `exportProjectBackup()` refuses a `user_version` other than `LATEST_SCHEMA_VERSION` and gates every produced document through `validateProjectBackup` before returning; `validateProjectBackup(backup)` on `CastRepository`.
- Archives are written/read by `writeProjectBackupArchive`/`readProjectBackupArchive` in `app/main/deck-bundle-archive.ts` (single `backup.json` zip entry, shared zip helpers with the deck-bundle archive); both write and read validate the document through core policy, and the single-entry zip reader verifies archive bounds, entry counts, offsets, lengths, central/local name agreement, and CRC/size agreement (local and central headers must agree with each other and with the extracted payload) before the document is parsed.

## Deck Bundle Manifest (file format, issue #154, `.cst` extension)

- The deck-bundle manifest — `BundleManifest` (format `'cast-deck-bundle'`, `version: 2`) and its `BundleTheme`/`BundleSlide`/`BundleTalkScriptBlock`/`BundleItem`/`BundleMediaReference`/`BundleStage`/`BundleOverlay`/`BundlePlaylistItemEntry`/`BundlePlaylistSeparator`/`BundlePlaylistRow`/`BundlePlaylist` family — lives in `packages/protocol/src/deck-bundle-manifest.ts`, is decoded by `decodeBundleManifest` in `packages/protocol/src/codecs.ts`, and is read/written by `app/main/deck-bundle-archive.ts`. The `Bundle*` rename (from `DeckBundle*`) is issue #219 decision D8's vocabulary rule; the module's filename and the `.cst` file extension were kept unchanged.
- **Manifest version 2 (issue #219, decision D8)**: `BundleItem.type: ItemType` replaces the unified deck-item concept — there is no shared `Item` union entity, only three separate item shapes distinguished by `type`. `BundleTheme.themeType: ThemeOwnerType` replaces `kind`. `BundlePlaylist.rows` is a flat, ordered `BundlePlaylistRow[]` — `BundlePlaylistItemEntry` (`kind: 'item'`, one of `presentationId`/`lyricId`/`talkId`) interleaved with `BundlePlaylistSeparator` (`kind: 'separator'`, `label`/`colorKey`) — instead of entries nested inside groups; a separator is a row *in* the flat list, never a container *around* a subset of entries. There is no `libraryName` on `BundlePlaylist` (the library concept is gone) and `BundleInspectionPlaylist.groupCount`/`libraryName` are replaced by `separatorCount`. `getBundlePlaylistEntryReference` must only ever see a `kind: 'item'` row — callers discriminate on `kind` before parsing a reference.
- **Version 1 manifests are normalized at decode**: `decodeBundleManifest`'s `version === 1` branch runs `decodeLegacyBundleManifest` (structural v1 decode against the frozen `BundleManifestV1` shapes) followed by `normalizeBundleManifestV1` — a pure v1→v2 transform using the same canonical flattening order as the v25 migration (each group becomes a separator row carrying its name/`colorKey`, followed by its entries, renumbered 0..n; `kind: 'slides'` themes map to the presentation family, with a talk-family clone synthesized for any 'slides' theme a talk item referenced; `libraryName` is dropped). `inspectImportBundle`/`finalizeImportBundle` operate on the normalized manifest with no v1-specific logic; unknown/future manifest versions are still rejected explicitly.
- **Category decision (issue #154, parent #116): this is an application contract, not an IPC contract**, despite sitting alongside the RPC wire-payload shapes. None of its types is ever named in the RPC method signatures (`packages/protocol/src/ipc.ts`) — the manifest round-trips through a `.cst` file on disk, not through an IPC call's argument or return type. It is kept in its own module, separate from `rpc-inputs.ts`/`rpc-results.ts`, so the file-format versus wire-payload distinction is visible in the import path.
- This applies the precedent #215 set for `ProjectBackup*` above, one level down. `deck-bundles.ts` type-depends directly on the manifest family, and `BundlePlaylistItemEntry` deliberately mirrors the legacy owner-column shape (nullable `presentationId`/`lyricId`/`talkId`, see its declaration comment) so exported bundles keep a stable versioned on-disk schema — exactly the shape that reads as a persistence DTO and is not one. Record this here rather than relitigating it at the next split.
- The IPC surface moved in the same slice: RPC mutation inputs live in `packages/protocol/src/rpc-inputs.ts`, RPC results and query shapes in `packages/protocol/src/rpc-results.ts`, and the NDI plus observability surface in `packages/protocol/src/ndi-observability.ts`. `AppSnapshot` is classified as an IPC contract because its wire use forces its shape, but it is also the database layer's undo representation and the renderer's cached state; that dual role is recorded at its declaration, since changing it changes all three.
- The NDI frame transport has an explicit host-side release boundary. The
  preferred worker-to-utility port returns `frameReleased` on that same port;
  the copy fallback returns it through main. In either route the backpressure
  slot is freed only for the matching attempt after the host-side send returns
  or is rejected. A release is not a downstream-receiver capacity claim.
- Observability collection is always-on and owned by the app shell: `App.tsx` mounts an `ObservabilityRuntime` child inside `WorkbenchProvider`; that child runs `useObservabilityRuntime()` from `app/renderer/features/observability/observability-runtime.ts`, continuously sampling renderer memory/rAF/video/audio health and polling `obsGetSystemMetrics()` for main-process CPU/memory/event-loop lag. The observability panel is now display-only. Timeline-to-log mirroring is opt-in state in the observability store rather than an unconditional console side effect.
- The `app/core/types.ts` facade described above was retired once every moved family had a real package owner (#155, folded into the #219 package split's W4). Its only two non-re-exported declarations, `PlaybackState` and `SlideBrowserMode`, were app-shell view state rather than shared domain/wire types, so they now live in `app/renderer/types/view-state.ts` instead of any package.

## Shared Scene Render Contract (issue #111)

- Editor preview (`app/renderer/features/canvas/scene-stage.tsx`) and NDI output (`app/renderer/features/playback/ndi-frame-capture.tsx`) render through one shared, render-only contract: `scene-traversal.ts` (node visibility, frame geometry, back-to-front ordering — now `packages/composition/src/scene/scene-traversal.ts`), `scene-node-content.tsx` (per-kind Konva node content) and `scene-slide-background.tsx` (`SceneSlideBackground`, colour/gradient/image background painting and `needsOpaqueBackdrop`) — both now `packages/canvas/src/`. Both surfaces build their scene via `buildRenderScene`/`buildResolvedRenderScene` (`app/renderer/features/canvas/build-render-scene.ts`) and mount the shared traversal inside their own `react-konva` `Stage`/`Layer` tree; layer order is background first, then nodes back-to-front.
- `app/renderer/rendering/scene-parity.test.tsx` is the structural parity test for this contract: it feeds identical fixtures through both the Konva traversal (`traverseSceneNodes`/`renderSceneNodeContent`) and the resolved-scene builder and asserts equivalent node identity, order, visibility, and geometry, including background kinds.
- `app/renderer/rendering/scene-layer.tsx`, an earlier render-only DOM component from #147 (`<div>`/`<img>`/`<video>` with inline styles), never gained a production consumer — both real surfaces render via `react-konva`, not the DOM — and was removed in #207 rather than adopted, to avoid two parallel answers to "what is the shared scene layer."
- NDI-only concerns (alpha/`withAlpha`, key/fill, scaling, frame timing, cancellation, frame-release watchdog, backpressure, corrective retries, and exact-once take-to-accepted-native-send correlation via `app/renderer/utils/ndi-take-correlation.ts`) remain solely in `ndi-frame-capture.tsx` and are not part of the shared contract.

## Project Restore / Promotion (issue #146)

- `CastRepository.restoreProjectBackup(backup)` restores a validated `ProjectBackup` into a throwaway same-directory temporary database (`lumacast.sqlite.restore-<stamp>.sqlite`), validates the restored state, and only then promotes it over the active database via a recoverable file swap. It is deliberately NOT routine Undo: it is a distinct IPC channel (`cast:restoreProjectBackup`) that returns a full `AppSnapshot` plus the retained database path, never a `SnapshotPatch`.
- Validation chain before any file operation: the #145 codec (`validateProjectBackup` in core policy), then a restore-side document check, `assertProjectBackupReferences` — every FK column (including all nine slide owner columns and the three `playlist_entries` item-owner columns) plus the schema-soft reference `trigger_bindings.target_id` must name an id present in the backup. `trigger_bindings.source_id` is intentionally not checked because deleting slides legitimately leaves dangling sources. Collections were the other schema-soft reference this check used to cover (`actions.collection_id`); collections no longer exist (issue #219), so that reference and the paired `assertProjectBackupDefaultCollections` check (one default per `*_collections` bin) are both gone — there is nothing left for either to validate.
- Insertion runs in one transaction that starts by emptying every application-owned table (`clearProjectBackupTables`, child-before-parent) and then inserts the backup's rows (parent-before-child, every column explicit). The clear and the insert are one atomic unit, so a failure in either leaves the temporary database empty.
- Before promotion the temporary database must match the document's `schemaVersion` exactly, hold exactly the backup's declared row counts per table (`assertProjectBackupRowCounts` over all 21 tables), and pass `PRAGMA foreign_key_check` (`assertProjectBackupForeignKeys`).
- Promotion (`promoteRestoredDatabase`): both connections are `wal_checkpoint(TRUNCATE)`-ed and closed, the active database is renamed to a retained `lumacast.sqlite.prerecovery-<stamp>.sqlite` sibling that the app never deletes, the temporary database is renamed into place, and the repository reopens on the promoted file (migrations re-run as a no-op; seeding is skipped so the restored state is reproduced faithfully). SQLite `-wal`/`-shm` sidecars are moved alongside their main files. Any failure after the retain step rolls the swap back so the previous project stays active; if even the rollback fails, the retained file still holds the full previous project.
- Test-only failure-injection hooks (`ProjectRecoveryHooks`) cover every seam: before insert, after insert, before promotion, and after the active database is retained; production callers pass no hooks.
- Main validates large backup tables asynchronously in bounded batches and
  yields to the event loop between batches. The utility host reports the
  repository's validation, preparation, migration, insertion, verification,
  promotion, and completion phases; renderer loading status remains responsive
  while the restore runs.
- The IPC contract lives in `packages/protocol/src/ipc.ts` (`ProjectRestoreResult`, `IPC.restoreProjectBackup`), wired in `app/main/ipc.ts` and typed through the `app/main/preload.ts` bridge; recovery and export/validation share the `packages/persistence-sqlite/src/store.ts` implementation.

## Snapshot Restore (flat tables, no bin-identity reseeding — issue #219 supersedes #208)

- Collections and libraries do not exist any more (issue #219, decisions D3/D4), so `CastRepository.restoreFromSnapshot(snapshot)` no longer needs the snapshot-authoritative collection-identity reseeding #208 built (clearing and re-seeding eight `*_collections` tables so that a restored snapshot's bin-default ids match the ids it was captured with). There are no bin defaults left to disagree.
- `restoreFromSnapshot` clears every application-owned table and re-inserts the snapshot's rows in one transaction, child-before-parent on delete and parent-before-child on insert (the same discipline `clearProjectBackupTables`/`insertProjectBackupRows` use): the four theme tables and `presentations`/`lyrics`/`talks` are deleted after `slides` and re-inserted before it; `playlists` and `playlist_entries` are ordinary flat tables restored the same way as every other table — there is no special-cased tree-replacement machinery (the old `libraryBundles` full-replacement patch key is gone with it).
- The two-owner ordering discipline still matters for a different reason than collections: presentations/lyrics/talks reference their theme table, and slides reference presentations/lyrics/talks — undoing a "creation + apply-theme" sequence deletes slides, then owners, then themes, and re-inserts themes, then owners, then slides, so no insert ever violates a not-yet-created FK target.
- Routine patch-history undo/redo no longer uses `restoreFromSnapshot`. The hot path is `cast:applySnapshotPatch` → `CastRepository.applyPatch(patch)`: main validates only the tables present in the `SnapshotPatch`, then applies targeted deletes/upserts inside one transaction. The renderer already has the exact next `AppSnapshot`, so this IPC call returns success/failure only; it does not ship a full snapshot back.
- `applyPatch` still follows the same canonical table order as full restore (child-before-parent deletes, parent-before-child upserts), but because a partial patch can mix "child row stops referencing parent" with "parent row is deleted" or "cue row is deleted" with "macro steps are rewritten", it defers FK enforcement to commit for that transaction. A failed commit or later write rolls the whole patch back.
- Full-snapshot restore remains the right primitive for backup/recovery and for the smaller set of undo history entries that still store a whole snapshot rather than a patch. That split is structural in the IPC contract: `cast:applySnapshotPatch` is the incremental path, `cast:restoreFromSnapshot` is the whole-state fallback, and `cast:restoreProjectBackup` remains the distinct recovery channel.

## `AppSnapshot.slides` / `AppSnapshot.slideElements` scope (issue #211)

- `CastRepository.getSlides()` and `CastRepository.getSlideElements()` are both scoped to item-owned slides — presentation, lyric, and talk content — and agree on that scope exactly: a slide or element only appears in `AppSnapshot.slides` / `AppSnapshot.slideElements` if it belongs to a presentation, lyric, or talk. Theme, overlay, and stage container slides and their elements are never in either collection; they are surfaced through their own owner's `elements` field instead (`PresentationTheme`/`LyricTheme`/`TalkTheme`/`OverlayTheme.elements`, `Overlay.elements`, `Stage.elements`, populated via `getSlideElementsBySlideId`).
- Before #211, `getSlideElements()` was unfiltered and returned every `slide_elements` row regardless of owner, so `AppSnapshot.slideElements` silently disagreed with `AppSnapshot.slides` about scope. Every real database hit this immediately (every fresh repository self-seeds a default overlay with a branding element), and the mismatch produced two defects fixed as local workarounds before the getter itself was corrected: #208 (`restoreFromSnapshot` inserting container elements into item content slides on every restore) and #209 (a rollback test whose `slideElements` count included container elements it never created, later rewritten to assert a delta from a baseline instead of an absolute count).
- `packages/persistence-sqlite/src/snapshot-scope.test.ts` pins this contract directly for a repository holding items of each type, a theme, an overlay, and a stage together, so a future change to either getter fails loudly instead of resurfacing as a downstream defect.
- The incremental `SnapshotPatch` path (`buildPatch`/`getSlideElementsByIds`) never carried container elements in `upserts.slideElements` in the first place — `createTheme`/`updateTheme`/`createOverlay`/`updateOverlay`/`createStage`/`updateStage` only ever patch one of the four `upserts.presentationThemes`/`lyricThemes`/`talkThemes`/`overlayThemes` keys, or `upserts.overlays`/`stages`, never `upserts.slideElements`. The wide behavior was exclusively a `getSnapshot()` full-refresh artifact, which is why no renderer surface needed updating: consumers either key off item-owned slide ids (drawn from the item-scoped `slides` collection) or read a container's own embedded `elements` field, never the shared `slideElements` array, to display theme/overlay/stage content.
