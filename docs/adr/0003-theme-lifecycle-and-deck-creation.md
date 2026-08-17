# ADR-0003: Theme Lifecycle and Deck Creation Architecture

## Status

Accepted

## Context

Issues #101, #102, #103, #104, and #105 required establishing correct contracts for:

1. Theme persistence and ID resolution across the renderer and main process.
2. Atomic deck item creation with theme application.
3. Transactional whole-deck duplication (issue #103).
4. Explicit theme provenance tracking (issue #104).
5. Theme duplication with full provenance and background staging (issue #105).

The previous implementation had several architectural defects:

- **Provider dependency inversion**: `NavigationProvider` consumed `useThemeEditor()` while wrapping `AssetEditorProvider`, which provides it. This caused a startup crash.
- **No single-flight push guard**: Concurrent `resolveThemeIdForMutation` callers could each trigger `pushThemeChanges()`, leading to duplicate mutations.
- **No temporary-ID mapping**: Newly created themes in the staged editor had client-generated IDs with no mapping to their persisted counterparts, making `resolveThemeIdForMutation` unable to resolve non-current staged theme IDs.
- **Silent error swallowing**: `applyThemeToDeckItem` returned empty patches for missing themes, incompatible types, or missing owners instead of throwing descriptive errors.
- **SQL schema bugs**: `createDeckItemWithTheme` inserted into `presentations`/`lyrics`/`talks` without `collection_id` (NOT NULL constraint) and used nonexistent `playlist_entries` columns (`playlist_id`, `deck_item_id`).
- **No explicit theme provenance**: Theme element ownership was inferred from ID conventions (`<slideId>:<themeElementId>`), which was fragile and not queryable.
- **No background ownership tracking**: Slides had no way to distinguish theme-set backgrounds from user-set backgrounds, causing sync to overwrite local overrides.

## Decision

### Provider Tree

`AssetEditorProvider` is hoisted above `NavigationProvider` in the React provider tree (`App.tsx`). This allows `NavigationProvider` to safely consume `useThemeEditor()` for the `createDeckItem` flow without a circular dependency.

```
AssetEditorProvider
  NavigationProvider
    PlaybackProvider
      SlideProvider
        AutomationProvider
          ...
```

### Theme ID Resolution

A `tempToPersistedIdMap` (ref-based `Map<Id, Id>`) is maintained in the theme editor context. When new themes are persisted via `pushThemeChanges`, their temporary IDs are mapped to their database IDs. `resolveThemeIdForMutation` checks this map first, then pushes pending changes if the requested theme is staged, and returns the resolved ID. The resolver contract returns `Promise<Id>` and throws on failure; null is not a valid success result.

### Single-Flight Push

`pushThemeChanges` uses a ref-based promise guard (`pushPromiseRef`). If a push is already in-flight, subsequent callers receive the same promise rather than triggering a new mutation. The guard is cleared in the `finally` block.

### Error Contract

`applyThemeToDeckItem` in `CastRepository` throws descriptive errors for:
- Missing theme (`Theme not found: ${themeId}`)
- Missing deck item (`Deck item not found: ${itemId}`)
- Incompatible theme/deck-item type (`Theme kind '${theme.kind}' is not compatible with deck item type '${owner.type}'`)

### Atomic Deck Creation

`createDeckItemWithTheme` in `CastRepository`:
- Validates all inputs before the first write (object type, exact type enum, non-empty title, existing deck collection, compatible theme, valid group).
- Computes the correct next owner `order_index` for the collection; does not default to zero.
- Runs owner creation, first slide creation, optional theme materialization, optional Talk blocks, and optional playlist insertion in one SQLite transaction.
- Sets `background_source` on the first slide: `'theme'` when a theme is provided, `'local'` otherwise.
- Reuses `createDefaultThemeElements` for unthemed defaults so atomic first-slide and later-slide creation cannot diverge.
- Returns one complete patch containing the owner, slide, elements, optional Talk blocks, and playlist/library updates.
- Renderer performs exactly one `mutatePatch` and selects/navigates only after success.
- Captures all owner IDs before mutation and identifies the new owner by exact set difference.
- On failure, retains previous selection and navigation state.
- App-menu Presentation and Lyric creation route through this operation.

### Deck Item Duplication

`duplicateDeckItem` supports only Presentation and Lyric:
- Repository throws explicit unsupported-type error for Talk.
- Deck-bin UI hides/disables Duplicate for Talk.
- Generates deterministic copy names case-insensitively within the same owner type only: `Copy`, `Copy 2`, `Copy 3`, etc.
- Keeps source at current order; shifts only siblings after the source; inserts duplicate at `sourceOrder + 1`.
- Returns patch including all shifted sibling order updates for immediate renderer consistency.
- In one transaction: copies owner metadata, collection, assigned theme, and slides in source order.
- Preserves slide dimensions, background, `backgroundSource`, notes, and order exactly. Does not reapply or sync the assigned theme.
- Deep-copies elements recursively: new collision-free materialized IDs for top-level and nested elements; sets destination slide ownership recursively; preserves payload, geometry, layer, z-order, and `sourceThemeElementId` recursively.
- Reuses managed-media references without duplicating files or media rows.
- Renderer captures complete owner-ID set before mutation and selects the unique set-difference result only after commit.

### Theme Duplication

Both the renderer staged editor (`duplicateTheme`) and the backend push flow:
- Preserve `collectionId` from the source theme.
- Generate deterministic case-insensitive names: `Copy`, `Copy 2`, `Copy 3`, etc.
- Deep-clone background, gradient stops, elements, nested children, payloads.
- Generate collision-free IDs for every top-level and nested element using the project ID utility (never string suffix extraction).
- Rewrite `slideId` recursively to the new backing slide.
- Preserve kind, dimensions, collection, and managed-media references.
- Persisting the draft normalizes IDs and ownership exactly once in one transaction.
- Overlay and Stage background persistence behavior preserved.

### Theme Provenance Tracking (Issue #104)

The `slide_elements` table includes a `source_theme_element_id` column that explicitly tracks which theme element a slide element was derived from.

**Schema changes:**
- `slide_elements.source_theme_element_id TEXT` — nullable, stores the theme element ID when the element was created by a theme application or sync.
- `slides.background_source TEXT DEFAULT 'theme'` — tracks whether a background was set by a theme or by the user.

**Migration (v21):**
- Adds `source_theme_element_id` column to `slide_elements`.
- Conservative backfill: only elements whose IDs match the literal `<slideId>:<themeElementId>` convention are backfilled. Array position is never used as an ownership signal.
- Adds `background_source` column to `slides`.

**Corrective Migration (v22):**
- Recomputes `background_source` for all deck slides based on actual theme assignment and background equality.
- Repairs element provenance conservatively: requires assigned compatible theme, exact legacy prefix, and real theme element match. Leaves unmatched/ambiguous null.
- Does not guess recursive group-child provenance.
- Idempotent and transactional; works on both pre-v21 and already-v21 databases.

**Provenance model:**
- `applyThemeToElements` sets `sourceThemeElementId` on all elements it creates (recursive for groups).
- `syncThemeToElements` uses `sourceThemeElementId` for matching (no runtime ID-parsing fallback).
- `duplicateDeckItem` and `duplicateSlide` preserve `sourceThemeElementId` with new materialized IDs.
- User-created elements have `sourceThemeElementId: null`.
- `finalizeImportBundle` preserves `sourceThemeElementId` across bundle import even though every imported theme is materialized with brand-new element IDs: while importing themes it builds a map from each theme's pre-import element IDs to their freshly materialized IDs, then translates each deck-item element's provenance through that map at insert time. An ID that does not resolve through the map — dangling, unknown, or naming a theme other than the one actually assigned to that deck item in the bundle — is written as `null`, never passed through unchanged; an unresolved but passed-through ID would otherwise read as "source removed from the theme" to `syncThemeToElements` and be deleted on the next sync.

**Future operations enabled by provenance:**
- `resetThemeOnSlide` — re-apply theme while preserving user elements (identify theme elements by provenance, not ID convention).
- `detachThemeFromDeckItem` — null out provenance to mark elements as user-owned.
- Query-level theme element identification without ID convention assumptions.

### Background Ownership (Issue #104)

`background_source` on the `slides` table tracks whether a slide's background is theme-owned or locally set.

**Rules:**
- `applyThemeToDeckItem` sets `background_source = 'theme'` on all slides.
- `syncThemeToLinkedDeckItems` sets `background_source = 'theme'` on synced slides.
- `createSlide` sets `background_source = 'theme'` when the owner has an assigned compatible theme, `'local'` otherwise.
- `createDeckItemWithTheme` sets `background_source = 'theme'` when a theme is provided, `'local'` otherwise.
- `updateSlideBackground` (user manual edit) sets `background_source = 'local'` for deck slides.
- `detachThemeFromDeckItem` sets `background_source = 'local'` on all slides and nulls `sourceThemeElementId` on all elements.
- `duplicateSlide` and `duplicateDeckItem` preserve `background_source` exactly.
- Sync only updates background when `backgroundSource === 'theme'`; local backgrounds are preserved.

### Sync Resolution (Issue #101)

`syncLinkedDeckItems` now calls `resolveThemeIdForMutation` before synchronizing, ensuring unsaved staged changes are persisted and temporary IDs are resolved. Previously it bypassed resolution and passed the theme ID directly.

### Detach Behavior (Issue #101)

`detachThemeFromDeckItem` now:
1. Clears `theme_id` on the owner.
2. Sets `background_source = 'local'` on all slides.
3. Nulls `source_theme_element_id` on all elements (recursive).
4. Returns a patch containing the changed owner, slides, and elements.

This ensures that after detach, no future sync can modify the detached owner's content.

### Theme Inspector Background (Issue #105)

`EntityBackgroundInspector` accepts an optional `onChange` callback. When provided, background changes are routed through the callback instead of the default `updateSlideBackground` IPC call. The `ThemeInspector` uses this to route background changes through `updateThemeDraft`, ensuring unsaved background changes are staged before persistence.

### Rich Text Preservation

`preserveTextContent` in `syncThemeToElements` preserves both `format` and `richBody` from existing text elements when syncing theme changes, in addition to the plain `text` field.

## Consequences

- The provider tree order must be maintained: `AssetEditorProvider` before `NavigationProvider`.
- All theme ID resolution must go through `resolveThemeIdForMutation` — no caller should pass a temporary ID directly to an IPC call.
- `applyThemeToDeckItem` now throws, so callers must handle errors (the `applyThemeToTarget` context method already propagates errors via `mutatePatch`).
- The `playlist_entries` INSERT in `createDeckItemWithTheme` matches the canonical schema used by `addDeckItemToGroup` and `moveDeckItemToGroup`.
- Theme element ownership is now determined by `sourceThemeElementId`, not ID conventions. The ID convention (`<slideId>:<themeElementId>`) is preserved for backwards compatibility but is no longer the primary query mechanism.
- All element write paths must pass `sourceThemeElementId` (null for user-created elements, theme element ID for theme-derived elements).
- Background ownership is determined by `background_source`. Sync and theme operations respect this flag; manual edits and detachments clear it.
- Migration v22 corrects v21's over-eager defaulting and is safe to run on existing user databases.
- Talk duplication is explicitly unsupported and hidden in the UI.