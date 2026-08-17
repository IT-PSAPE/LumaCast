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

- `createDeckItemWithTheme(input)` validates all inputs before the first write.
- Runs in one SQLite transaction:
  1. Creates owner (presentation/lyric/talk) with explicit `order_index`.
  2. Creates first slide with `background_source` = 'theme' if themed, 'local' otherwise.
  3. Applies theme elements via `applyThemeToElements` (with provenance) or default elements via `createDefaultThemeElements`.
  4. Optionally adds to playlist group.
- Returns one `SnapshotPatch` with owner, slide, elements, and library updates.
- Renderer calls exactly one `mutatePatch` and selects/navigates only after success.
- On failure, selection and navigation state are retained.

## Exact-Copy Duplication

### Whole-Deck Duplication (`duplicateDeckItem`)
- Supports only Presentation and Lyric; throws for Talk.
- Generates copy names case-insensitively within the same owner type.
- Inserts duplicate at `sourceOrder + 1`; shifts only later siblings.
- Returns patch including shifted sibling order updates.
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