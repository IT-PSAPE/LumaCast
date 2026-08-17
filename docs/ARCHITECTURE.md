# Architecture Overview

This document describes the actual implemented architecture for theme lifecycle, deck creation, duplication, synchronization, and provenance tracking.

## Dependency Boundaries

Dependency direction across the Electron `app/` tree is enforced by
`tool/check_electron_architecture.mjs` (`npm run check:architecture`), which
parses static ES imports/exports and applies a frozen allow-list that can only
shrink.

- `app/core` is domain/core policy: no Electron, React, renderer, database,
  main-process, native, or feature imports.
- `app/contracts` is the runtime decode boundary (issue #149, `codecs.ts`): no
  Electron, React, renderer, database, main-process, or native imports; it may
  import `app/core`. Every other zone may import `app/contracts` — that is its
  purpose — and no allow-list entry may substitute for this rule.
- `app/database` persists and imports no renderer, feature, or React code.
- `app/application` is the composition root (issue #223): it may import any
  zone and any workspace package, but nothing may import it except the
  renderer shell and screens.
- `app/main` is the process composition root and imports no renderer or feature
  code.
- The renderer reaches main only through the typed `castApi` IPC contract in
  `app/core`; it imports no Electron, main-process, or database code.
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
- The NDI engine-session boundary is `app/main/ndi`: only it touches
  `@lumacast/ndi-native` and the raw NDI host command protocol. The rest of the
  app reaches NDI through `NdiServiceLike`, and `ndi-service-proxy.ts` is the
  sole writer of host commands.

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
resolves the whole tree, including `packages/ndi-native`, from the single
authoritative `package-lock.json`. The application itself is not a workspace
member — it stays the root package, unmoved. `packages/ndi-native`'s native
build scripts (`build:ndi-native`, `clean:ndi-native`, `rebuild:ndi-native`)
are unaffected by workspace support.

No code has moved into `packages/*` yet: only `packages/ndi-native` (the
native NDI addon) exists today. `tool/check_electron_architecture.mjs` was
extended to also walk `packages/*` and govern package boundaries ahead of the
first package landing, so a bad edge is caught the day it appears rather than
after the fact. These rules are hard errors and are not allow-listable — the
frozen allow-list only governs `app/` exceptions and must not grow to cover
packages:

- No package may import anything under `app/` — packages may not depend on the
  application.
- A package must not import React, React DOM, Konva, React-Konva, or Electron
  — packages are headless domain/platform code.
- A persistence package (name starting with `persistence`) must not import
  renderer code.
- Package imports must go through the package's public entry point
  (`packages/<name>/src/index.ts` or `packages/<name>/index.ts`); deep
  internal imports fail.
- Package-to-package dependency direction is a default-deny allow list keyed
  by package name (`PACKAGE_DEPENDENCY_DIRECTIONS` in the checker), recording
  the directions decided in issue #219: kernel depends on nothing and
  everything may depend on it; composition may depend on kernel; project and
  canvas may depend on kernel and composition; commands' core depends only on
  kernel; automation may depend on kernel, commands, and project; playback may
  depend on kernel, project, composition, and commands; protocol depends only
  on kernel; persistence-sqlite depends only on kernel (and never on renderer
  packages, enforced separately above). An unlisted package name starts with
  zero permitted package dependencies.
- Cycles between packages are forbidden and must be removed, never
  allow-listed.

Each rule is proven against a committed fixture scenario under
`tool/fixtures/electron-architecture/scenarios/packages/` and
`scenarios/application/`, run via `npm run test:architecture`, since no live
code exercises them yet.

## Renderer / Main / Repository Mutation Boundary

- **Renderer**: React context providers (`AssetEditorProvider`, `NavigationProvider`, etc.) handle UI state and staging.
- **Preload**: `contextBridge.exposeInMainWorld('castApi', api)` exposes typed IPC methods.
- **Main IPC**: `safeHandle` wrappers validate inputs and delegate to `CastRepository`.
- **Repository**: `CastRepository` performs all SQLite operations transactionally and returns `SnapshotPatch`.

**Rule**: Only persisted database IDs may enter repository operations. The renderer must resolve temporary staged IDs via `resolveThemeIdForMutation` before calling any IPC method that consumes a theme ID.

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
  intentionally not part of either allow-list above.
- Renderer process sandboxing (`webPreferences.sandbox`) stays `false`; see
  ADR-0007 for the prerequisites (preload sandboxed-environment audit,
  renderer dependency verification, packaging/signing checks) that would need
  to be satisfied before enabling it.

## Staged Theme Resolution

- `AssetEditorProvider` maintains `tempToPersistedIdMap` (Map<tempId, persistedId>).
- `pushThemeChanges()` uses a single-flight promise guard (`pushPromiseRef`).
- `resolveThemeIdForMutation(themeId)`:
  1. Checks `tempToPersistedIdMap` for already-resolved IDs.
  2. If the theme is staged or there are pending changes, awaits `pushThemeChanges()`.
  3. Returns the resolved persisted ID or throws if resolution fails.
- All theme-consuming operations (Apply, Create, Reset, Sync) route through this resolver.

## Atomic Deck Creation

- `createDeckItemWithFirstSlide(input)` is the one repository operation for creating a themed or unthemed deck item together with its first slide. It validates all inputs before the first write: title and owner type, collection existence, theme existence, and theme/owner-type compatibility.
- Runs in one SQLite transaction:
  1. Creates the owner (presentation/lyric/talk) with explicit `order_index` and its final `theme_id`.
  2. Creates the first slide once, with `background_source` = 'theme' if themed, 'local' otherwise.
  3. Applies theme elements via `applyThemeToElements` (with provenance) when themed; otherwise falls back to the owner type's current default first-slide content (the lyric branch keeps its initial editable lyric text).
  4. Optionally inserts a `playlist_entries` row when a group id is supplied.
  5. Rolls back the owner, slide, elements, and playlist entry together if any validation or write fails — no partially created item is left behind, and nothing is selected or navigated to.
- The IPC result is `DeckItemCreateResult = { itemId, patch }`: the created owner's id is returned explicitly alongside the single `SnapshotPatch`, so the renderer never infers it by diffing entity arrays before/after the mutation.
- `createDeckItemWithTheme(input)` remains on `CastRepository` as a thin wrapper returning the raw `SnapshotPatch`, preserved for existing direct-repository callers; the IPC boundary (`app/main/ipc.ts`) calls `createDeckItemWithFirstSlide` directly so it can return `itemId`.
- Renderer callers — the create-item dialog (`navigation-context.tsx::createDeckItem`), legacy app-menu creation (`createPresentation`, `createEmptyLyric`), and library/group creation (`use-library-panel-management.ts`) — call the IPC method once, apply the returned `patch` via `mutatePatch`, and select/navigate using the returned `itemId` directly. Legacy app-menu and library/group creation pass explicit `collectionId: null` and `themeId: null`; the old create-owner-then-create-slide(-then-add-to-group) sequences have been removed.
- `createSlide` remains the sole operation for adding a later slide to an existing owner; it is never overloaded with owner creation.
- On failure, selection and navigation state are retained.

## Exact-Copy Duplication

### Whole-Deck Duplication (`duplicateDeckItem`)
- Supports only Presentation and Lyric; throws for Talk.
- Generates copy names case-insensitively within the same owner type.
- Inserts duplicate at `sourceOrder + 1`; shifts only later siblings within the source's own collection (`order_index` is a per-`(type, collection)` sequence).
- Returns `DeckItemDuplicateResult = { itemId, patch }`; the patch includes shifted sibling order updates. Callers select `itemId` directly and never scan the snapshot (see ADR-0004).
- Deep-copies slides, elements (new collision-free IDs, preserved `sourceThemeElementId`), and `background_source`.
- Does not reapply or sync the assigned theme.

### Slide Duplication (`duplicateSlide`)
- Preserves `background_source` and recursive `sourceThemeElementId`.

### Theme Duplication
- Creates new temporary theme ID, backing-slide ID, and collision-free element IDs (including nested groups).
- Deep-copies background, gradient stops, elements, nested children, payloads.
- Preserves kind, dimensions, collection, managed-media references.
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

## Sync Semantics (`syncThemeToLinkedDeckItems`)

- Resolves staged theme ID via `resolveThemeIdForMutation` before syncing.
- Synchronizes all linked compatible owners in one transaction.
- Matches elements by explicit `sourceThemeElementId`.
- Same-type matches: updates geometry/style in place, preserves authored text (plain/rich).
- Type changes: removes old, creates new with collision-free ID.
- Removes only elements whose provenance points to removed theme elements.
- Preserves null-provenance custom elements and their relative order.
- Idempotent: repeated sync with no changes produces no data/ordering changes.

## Detach Semantics (`detachThemeFromDeckItem`)

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

## Migration System (one ordered transactional runner)

- `app/database/migrations/definitions.ts` is the canonical dense ordered migration list, currently v1..v22; v1 is the bootstrap. Both a fresh v0 database and any historical database advance through the same `runMigrations` path (`app/database/migrations/runner.ts`); there is no separate fresh-install schema.
- `PRAGMA user_version` is the sole schema cursor. A database whose `user_version` is newer than the highest supported version is refused (`FutureSchemaVersionError`) before any backup or write.
- An existing database (any table, or a nonzero `user_version`) receives exactly one `VACUUM INTO` backup, `lumacast.bak-v<source>.sqlite`, before its first pending migration. The backup is opened read-only and verified with `integrity_check` and a matching source `user_version`; a failed or unverified backup aborts the migration (`MigrationBackupError`).
- Each migration's `up` and its `user_version` bump commit in one SQLite transaction, so a crash rolls both back and the next start retries from the prior version. FK-off table rebuilds toggle `PRAGMA foreign_keys` around that transaction and restore its prior state afterward.
- Fixtures `schema-v0`..`schema-v22` pin frozen structural fingerprints and convergence coverage for every historical version; they are regression evidence, not a second schema definition.
- See ADR-0005 for the full contract and rationale.

## Snapshot / Bundle Persistence

- `Slide` includes `backgroundSource` (required, not optional).
- `DeckBundleSlide` includes optional `background` and `backgroundSource`.
- Snapshot creation/restore, bundle export/import all persist `backgroundSource`.
- Round-trip tests verify background and recursive element provenance survive restart and snapshot restore. Bundle export/import specifically is covered by `app/database/theme-provenance.test.ts`: `finalizeImportBundle` re-materializes every imported theme with new element IDs, so it translates each deck-item element's `sourceThemeElementId` through a map from pre-import to newly materialized theme element IDs built during the theme-import pass; an ID that does not resolve through that map (dangling, unknown, or naming a theme not assigned to that item) is written as `null` rather than passed through, since an unresolved ID would otherwise read as "source removed from the theme" and be deleted on the next sync (see ADR-0003).

## Project Backup (format v1)

- A project backup is a separate, complete recovery artifact (issue #145), distinct from deck bundles: it serializes the entire application state, not a selection of deck items. Managed media files are never copied — only their `src` references are recorded.
- Envelope (`ProjectBackup`): `{ format: 'cast-project-backup', version: 1, schemaVersion: 22, tables }`. `schemaVersion` is the source `PRAGMA user_version`, matched exactly (not a range); v22 has no settings/preferences tables, so migration/schema metadata is carried by `schemaVersion` alone. The envelope carries no timestamp, so two exports of unchanged data are deeply and byte-for-byte identical.
- `tables` contains all 28 application-owned v22 tables: `libraries`, `presentations`, `lyrics`, `talks`, `slides`, `slide_elements`, `talk_script_blocks`, `playlists`, `playlist_groups`, `playlist_entries`, `image_assets`, `video_assets`, `audio_assets`, `overlays`, `themes`, `stages`, `cues`, `actions`, `action_steps`, `trigger_bindings`, and the eight `*_collections` families. Every row field is constructed explicitly from the SQL columns (snake_case, no object spread) in deterministic order (`ORDER BY created_at ASC, id ASC`); JSON-valued columns are serialized as raw JSON strings.
- **Category decision (issue #215, parent #116/#153): this family is a serialization contract, not a persistence DTO**, and lives in `app/contracts/project-backup.ts` (`ProjectBackup`, `ProjectBackupTables`, and the seventeen `ProjectBackup*Row` interfaces). #153 classified it as the textbook persistence-DTO candidate on shape alone (snake_case fields mirroring SQL columns verbatim) and set out to move it to `app/database/dto/`. That is architecturally impossible: the family is consumed as a type-level dependency by `app/core/deck-bundles.ts` (`validateProjectBackup`, `ProjectBackupTableKey`) and by the IPC contract (`app/core/ipc.ts`, `app/main/ipc.ts`, `app/main/preload.ts`, `app/main/deck-bundle-archive.ts`) as well as by `app/database/store.ts`, and `core-purity` categorically forbids `app/core` from importing `app/database`. Shape alone does not decide the category — the deciding fact is which zones hold a type-level dependency on it; a shape mirroring SQL columns that only the database layer ever names would belong in `app/database/dto/` instead. `app/contracts/` is the correct home because it is the neutral runtime-decode boundary every zone may already import (issue #149), and it must not import `app/database`, `app/main`, `app/renderer`, React, Electron, or the native module (`contracts-purity`, issue #216) — so this move cannot relocate the original problem back through the database. `app/core/types.ts` keeps export-only re-exports of the family for existing `@core/types` importers, per the #153 facade convention; #155 is the exit condition that removes them. Record this decision here rather than relitigating it at the next split.
- Core policy owns the contract: `validateProjectBackup` in `app/core/deck-bundles.ts` (with `ProjectBackupValidationError`) rejects a future format version (> 1), a `schemaVersion` other than the exact supported version, wrong format string, an envelope that is not exactly the four keys `format`/`version`/`schemaVersion`/`tables`, missing or extra tables/columns, malformed types/enums/flags, and slide rows that break the single-owner invariant the schema CHECK enforces. Column lists are enumerated via `PROJECT_BACKUP_COLUMN_SPECS` in the same module. Cross-table referential/ownership integrity is restore-side and deferred to issue #146.
- The repository produces and validates without mutating the active database: `exportProjectBackup()` refuses a `user_version` other than `LATEST_SCHEMA_VERSION` and gates every produced document through `validateProjectBackup` before returning; `validateProjectBackup(backup)` on `CastRepository`.
- Archives are written/read by `writeProjectBackupArchive`/`readProjectBackupArchive` in `app/main/deck-bundle-archive.ts` (single `backup.json` zip entry, shared zip helpers with the deck-bundle archive); both write and read validate the document through core policy, and the single-entry zip reader verifies archive bounds, entry counts, offsets, lengths, central/local name agreement, and CRC/size agreement (local and central headers must agree with each other and with the extracted payload) before the document is parsed.

## Shared Scene Render Contract (issue #111)

- Editor preview (`app/renderer/features/canvas/scene-stage.tsx`) and NDI output (`app/renderer/features/playback/ndi-frame-capture.tsx`) render through one shared, render-only contract under `app/renderer/rendering/`: `scene-traversal.ts` (node visibility, frame geometry, back-to-front ordering), `scene-node-content.tsx` (per-kind Konva node content), and `scene-slide-background.tsx` (`SceneSlideBackground`, colour/gradient/image background painting and `needsOpaqueBackdrop`). Both surfaces build their scene via `buildRenderScene`/`buildResolvedRenderScene` (`app/renderer/features/canvas/build-render-scene.ts`) and mount the shared traversal inside their own `react-konva` `Stage`/`Layer` tree; layer order is background first, then nodes back-to-front.
- `app/renderer/rendering/scene-parity.test.tsx` is the structural parity test for this contract: it feeds identical fixtures through both the Konva traversal (`traverseSceneNodes`/`renderSceneNodeContent`) and the resolved-scene builder and asserts equivalent node identity, order, visibility, and geometry, including background kinds.
- `app/renderer/rendering/scene-layer.tsx`, an earlier render-only DOM component from #147 (`<div>`/`<img>`/`<video>` with inline styles), never gained a production consumer — both real surfaces render via `react-konva`, not the DOM — and was removed in #207 rather than adopted, to avoid two parallel answers to "what is the shared scene layer."
- NDI-only concerns (alpha/`withAlpha`, key/fill, scaling, frame timing, cancellation, ack watchdog, backpressure) remain solely in `ndi-frame-capture.tsx` and are not part of the shared contract.

## Project Restore / Promotion (issue #146)

- `CastRepository.restoreProjectBackup(backup)` restores a validated `ProjectBackup` into a throwaway same-directory temporary database (`lumacast.sqlite.restore-<stamp>.sqlite`), validates the restored state, and only then promotes it over the active database via a recoverable file swap. It is deliberately NOT routine Undo: it is a distinct IPC channel (`cast:restoreProjectBackup`) that returns a full `AppSnapshot` plus the retained database path, never a `SnapshotPatch`.
- Validation chain before any file operation: the #145 codec (`validateProjectBackup` in core policy), then restore-side document checks — `assertProjectBackupReferences` (every hard FK column plus the schema-soft references `actions.collection_id` and `trigger_bindings.target_id` must name an id present in the backup; `trigger_bindings.source_id` is intentionally not checked because deleting slides legitimately leaves dangling sources), and `assertProjectBackupDefaultCollections` (exactly one default per `*_collections` bin, matching the invariant migrations and the repository enforce).
- Insertion runs in one transaction that starts by emptying every application-owned table (`clearProjectBackupTables`, child-before-parent) and then inserts the backup's rows (parent-before-child, every column explicit). The clear and the insert are one atomic unit, so a failure in either leaves the temporary database empty.
- Before promotion the temporary database must match the document's `schemaVersion` exactly, hold exactly the backup's declared row counts per table (`assertProjectBackupRowCounts` over all 28 tables), and pass `PRAGMA foreign_key_check` (`assertProjectBackupForeignKeys`).
- Promotion (`promoteRestoredDatabase`): both connections are `wal_checkpoint(TRUNCATE)`-ed and closed, the active database is renamed to a retained `lumacast.sqlite.prerecovery-<stamp>.sqlite` sibling that the app never deletes, the temporary database is renamed into place, and the repository reopens on the promoted file (migrations re-run as a no-op; seeding is skipped so the restored state is reproduced faithfully). SQLite `-wal`/`-shm` sidecars are moved alongside their main files. Any failure after the retain step rolls the swap back so the previous project stays active; if even the rollback fails, the retained file still holds the full previous project.
- Test-only failure-injection hooks (`ProjectRecoveryHooks`) cover every seam: before insert, after insert, before promotion, and after the active database is retained; production callers pass no hooks.
- The IPC contract lives in `app/core/ipc.ts` (`ProjectRestoreResult`, `IPC.restoreProjectBackup`), wired in `app/main/ipc.ts` and typed through the `app/main/preload.ts` bridge; recovery and export/validation share the `app/database/store.ts` implementation.

## Snapshot Restore Collections (issue #208)

- `CastRepository.restoreFromSnapshot(snapshot)` — the undo/redo primitive behind `cast:restoreFromSnapshot` — is snapshot-authoritative for collection identity, the same principle `restoreProjectBackup` already applied: it clears and re-seeds all eight `*_collections` tables from `snapshot.collections` inside its single transaction, rather than leaving the destination database's own self-seeded bin defaults (each repository mints its bin defaults with a random `createId()` the first time they're queried, so two repositories' default ids never match). Collections are deleted after every table that references them via `collection_id` and re-inserted before any of those tables, mirroring the child-before-parent/parent-before-child discipline `clearProjectBackupTables`/`insertProjectBackupRows` use. `assertSnapshotCollectionDefaults` fails fast, before any table is touched, if the snapshot does not carry exactly one default per bin.
- This matters even when restoring into the same database that produced the snapshot: `deleteCollection` performs a real `DELETE` on the collection row (members are reassigned to the bin default first), so a snapshot captured before that deletion still names the deleted collection's id. Restoring such a snapshot needs that row back, not just its default sibling — collection identity being snapshot-authoritative covers this case for free.
- Two adjacent, unrelated bugs in the same method were fixed alongside it, both previously masked because the missing-collection-row FK error always threw first: `insertSlide`'s `VALUES` clause was missing a placeholder (15 for 16 columns), and the generic slide-element restore loop iterated `snapshot.slideElements` unfiltered — at the time, that array (from `getSlideElements()`) was not scoped to deck content slides the way `snapshot.slides` (from `getSlides()`) is, so it also carried every theme/overlay/stage container's elements, which are already restored separately via `replaceContainerElements` in the theme/overlay/stage loops. #211 fixed this at the source (see below); the generic loop no longer needs its own filter.

## `AppSnapshot.slides` / `AppSnapshot.slideElements` scope (issue #211)

- `CastRepository.getSlides()` and `CastRepository.getSlideElements()` are both scoped to deck-owned slides — presentation, lyric, and talk content — and agree on that scope exactly: a slide or element only appears in `AppSnapshot.slides` / `AppSnapshot.slideElements` if it belongs to a presentation, lyric, or talk. Theme, overlay, and stage container slides and their elements are never in either collection; they are surfaced through their own owner's `elements` field instead (`Theme.elements`, `Overlay.elements`, `Stage.elements`, populated via `getSlideElementsBySlideId`).
- Before #211, `getSlideElements()` was unfiltered and returned every `slide_elements` row regardless of owner, so `AppSnapshot.slideElements` silently disagreed with `AppSnapshot.slides` about scope. Every real database hit this immediately (every fresh repository self-seeds a default overlay with a branding element), and the mismatch produced two defects fixed as local workarounds before the getter itself was corrected: #208 (`restoreFromSnapshot` inserting container elements into deck content slides on every restore) and #209 (a rollback test whose `slideElements` count included container elements it never created, later rewritten to assert a delta from a baseline instead of an absolute count).
- `app/database/snapshot-scope.test.ts` pins this contract directly for a repository holding deck items, a theme, an overlay, and a stage together, so a future change to either getter fails loudly instead of resurfacing as a downstream defect.
- The incremental `SnapshotPatch` path (`buildPatch`/`getSlideElementsByIds`) never carried container elements in `upserts.slideElements` in the first place — `createTheme`/`updateTheme`/`createOverlay`/`updateOverlay`/`createStage`/`updateStage` only ever patch `upserts.themes`/`overlays`/`stages`, never `upserts.slideElements`. The wide behavior was exclusively a `getSnapshot()` full-refresh artifact, which is why no renderer surface needed updating: consumers either key off deck-owned slide ids (drawn from the deck-scoped `slides` collection) or read a container's own embedded `elements` field, never the shared `slideElements` array, to display theme/overlay/stage content.