# Architecture Overview

This document describes the actual implemented architecture for theme lifecycle, deck creation, duplication, synchronization, and provenance tracking.

## Dependency Boundaries

Dependency direction across the Electron `app/` tree is enforced by
`tool/check_electron_architecture.mjs` (`npm run check:architecture`), which
parses static ES imports/exports and applies a frozen allow-list that can only
shrink.

- `app/core` is domain/core policy: no Electron, React, renderer, database,
  main-process, native, or feature imports.
- `app/database` persists and imports no renderer, feature, or React code.
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

## Renderer / Main / Repository Mutation Boundary

- **Renderer**: React context providers (`AssetEditorProvider`, `NavigationProvider`, etc.) handle UI state and staging.
- **Preload**: `contextBridge.exposeInMainWorld('castApi', api)` exposes typed IPC methods.
- **Main IPC**: `safeHandle` wrappers validate inputs and delegate to `CastRepository`.
- **Repository**: `CastRepository` performs all SQLite operations transactionally and returns `SnapshotPatch`.

**Rule**: Only persisted database IDs may enter repository operations. The renderer must resolve temporary staged IDs via `resolveThemeIdForMutation` before calling any IPC method that consumes a theme ID.

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
- Round-trip tests verify background and recursive element provenance survive restart, snapshot restore, and bundle import/export.

## Project Backup (format v1)

- A project backup is a separate, complete recovery artifact (issue #145), distinct from deck bundles: it serializes the entire application state, not a selection of deck items. Managed media files are never copied — only their `src` references are recorded.
- Envelope (`ProjectBackup`): `{ format: 'cast-project-backup', version: 1, schemaVersion: 22, tables }`. `schemaVersion` is the source `PRAGMA user_version`, matched exactly (not a range); v22 has no settings/preferences tables, so migration/schema metadata is carried by `schemaVersion` alone. The envelope carries no timestamp, so two exports of unchanged data are deeply and byte-for-byte identical.
- `tables` contains all 28 application-owned v22 tables: `libraries`, `presentations`, `lyrics`, `talks`, `slides`, `slide_elements`, `talk_script_blocks`, `playlists`, `playlist_groups`, `playlist_entries`, `image_assets`, `video_assets`, `audio_assets`, `overlays`, `themes`, `stages`, `cues`, `actions`, `action_steps`, `trigger_bindings`, and the eight `*_collections` families. Every row field is constructed explicitly from the SQL columns (snake_case, no object spread) in deterministic order (`ORDER BY created_at ASC, id ASC`); JSON-valued columns are serialized as raw JSON strings.
- Core policy owns the contract: `validateProjectBackup` in `app/core/deck-bundles.ts` (with `ProjectBackupValidationError`) rejects a future format version (> 1), a `schemaVersion` other than the exact supported version, wrong format string, an envelope that is not exactly the four keys `format`/`version`/`schemaVersion`/`tables`, missing or extra tables/columns, malformed types/enums/flags, and slide rows that break the single-owner invariant the schema CHECK enforces. Column lists are enumerated via `PROJECT_BACKUP_COLUMN_SPECS` in the same module. Cross-table referential/ownership integrity is restore-side and deferred to issue #146.
- The repository produces and validates without mutating the active database: `exportProjectBackup()` refuses a `user_version` other than `LATEST_SCHEMA_VERSION` and gates every produced document through `validateProjectBackup` before returning; `validateProjectBackup(backup)` on `CastRepository`.
- Archives are written/read by `writeProjectBackupArchive`/`readProjectBackupArchive` in `app/main/deck-bundle-archive.ts` (single `backup.json` zip entry, shared zip helpers with the deck-bundle archive); both write and read validate the document through core policy, and the single-entry zip reader verifies archive bounds, entry counts, offsets, lengths, central/local name agreement, and CRC/size agreement (local and central headers must agree with each other and with the extracted payload) before the document is parsed.

## Project Restore / Promotion (issue #146)

- `CastRepository.restoreProjectBackup(backup)` restores a validated `ProjectBackup` into a throwaway same-directory temporary database (`lumacast.sqlite.restore-<stamp>.sqlite`), validates the restored state, and only then promotes it over the active database via a recoverable file swap. It is deliberately NOT routine Undo: it is a distinct IPC channel (`cast:restoreProjectBackup`) that returns a full `AppSnapshot` plus the retained database path, never a `SnapshotPatch`.
- Validation chain before any file operation: the #145 codec (`validateProjectBackup` in core policy), then restore-side document checks — `assertProjectBackupReferences` (every hard FK column plus the schema-soft references `actions.collection_id` and `trigger_bindings.target_id` must name an id present in the backup; `trigger_bindings.source_id` is intentionally not checked because deleting slides legitimately leaves dangling sources), and `assertProjectBackupDefaultCollections` (exactly one default per `*_collections` bin, matching the invariant migrations and the repository enforce).
- Insertion runs in one transaction that starts by emptying every application-owned table (`clearProjectBackupTables`, child-before-parent) and then inserts the backup's rows (parent-before-child, every column explicit). The clear and the insert are one atomic unit, so a failure in either leaves the temporary database empty.
- Before promotion the temporary database must match the document's `schemaVersion` exactly, hold exactly the backup's declared row counts per table (`assertProjectBackupRowCounts` over all 28 tables), and pass `PRAGMA foreign_key_check` (`assertProjectBackupForeignKeys`).
- Promotion (`promoteRestoredDatabase`): both connections are `wal_checkpoint(TRUNCATE)`-ed and closed, the active database is renamed to a retained `lumacast.sqlite.prerecovery-<stamp>.sqlite` sibling that the app never deletes, the temporary database is renamed into place, and the repository reopens on the promoted file (migrations re-run as a no-op; seeding is skipped so the restored state is reproduced faithfully). SQLite `-wal`/`-shm` sidecars are moved alongside their main files. Any failure after the retain step rolls the swap back so the previous project stays active; if even the rollback fails, the retained file still holds the full previous project.
- Test-only failure-injection hooks (`ProjectRecoveryHooks`) cover every seam: before insert, after insert, before promotion, and after the active database is retained; production callers pass no hooks.
- The IPC contract lives in `app/core/ipc.ts` (`ProjectRestoreResult`, `IPC.restoreProjectBackup`), wired in `app/main/ipc.ts` and typed through the `app/main/preload.ts` bridge; recovery and export/validation share the `app/database/store.ts` implementation.