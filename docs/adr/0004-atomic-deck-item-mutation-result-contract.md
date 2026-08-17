# ADR-0004: Atomic Deck-Item Mutation Result Contract

## Status

Accepted

## Context

ADR-0003 established that deck-item creation with a first slide and an
optional theme runs as one SQLite transaction (`createDeckItemWithTheme`,
now `createDeckItemWithFirstSlide`) and that only persisted theme IDs may
enter repository creation. It did not fully close two things (issue #102):

- The repository/IPC operation returned a bare `SnapshotPatch`. The renderer
  identified the newly created owner by diffing entity id arrays before and
  after the mutation (`findCreatedId`). Against an empty "previous ids" set
  (the pattern used by the create-item dialog) this is fragile: any array
  ordering assumption or an unrelated concurrent upsert in the same patch
  could select the wrong id, and the pattern actively invites future bugs.
- Two creation paths still ran the pre-#102 create-owner-then-create-slide
  sequence instead of the atomic operation: legacy app-menu creation
  (`navigation-context.tsx::createPresentation` / `createEmptyLyric`) and
  library/group creation (`use-library-panel-management.ts`'s
  `createPresentationInGroup` / `createLyricInGroup` / `createTalkInGroup`,
  which additionally ran a *third* IPC call to add the item to its group).

## Decision

- The IPC result for atomic deck-item creation is
  `DeckItemCreateResult = { itemId: Id; patch: SnapshotPatch }` (declared in
  `app/core/ipc.ts`). The renderer applies `patch` via `mutatePatch` and
  selects/navigates using `itemId` directly — it never infers the created id
  from patch contents.
- `CastRepository.createDeckItemWithFirstSlide(input)` is the operation
  backing the IPC channel `cast:createDeckItemWithTheme`. It contains the
  validation, transaction, and materialization logic described in ADR-0003
  and returns `{ itemId, patch }`.
- `CastRepository.createDeckItemWithTheme(input)` is preserved as a thin
  wrapper (`return this.createDeckItemWithFirstSlide(input).patch;`) purely
  for existing direct-repository callers/tests that predate this ADR and
  expect a raw `SnapshotPatch`. New callers use
  `createDeckItemWithFirstSlide`. The IPC handler in `app/main/ipc.ts` calls
  `createDeckItemWithFirstSlide`, not the wrapper.
- Legacy app-menu creation and library/group creation now call the same
  `createDeckItemWithTheme` IPC operation as the create-item dialog, with
  explicit `collectionId: null` and `themeId: null`, and (for group creation)
  the target `groupId` passed directly so the playlist-entry insert happens
  inside the same transaction. The prior create-then-create-slide(-then-add-
  to-group) sequences are removed; there is exactly one code path that
  creates a deck item's owner and first slide together.
- `createSlide` is unchanged and remains the only operation for adding a
  *later* slide to an existing owner.
- The same contract governs whole-deck duplication (issue #103):
  `DeckItemDuplicateResult = { itemId: Id; patch: SnapshotPatch }`, declared
  alongside `DeckItemCreateResult` in `app/core/ipc.ts`. `duplicateDeckItem`
  returns it, and `deck-bin-panel.tsx` selects the returned `itemId` instead
  of scanning `[...presentations, ...lyrics, ...talks]` for the new entry.
  Any future repository operation that creates an addressable entity and
  returns a patch follows this shape rather than inventing a third one.
- Repository operations that reject an input on domain grounds raise a typed
  error carrying a `code` (`DeckItemDuplicationError` with
  `code: 'unsupported-owner-type'` for Talk input, mirroring the existing
  `CollectionDeletionError`), thrown before any write.

## Consequences

- Every successful UI-driven deck-item creation now performs exactly one IPC
  call and one `mutatePatch`/snapshot mutation, whether triggered from the
  create dialog, the app menu, or a playlist group's "add new item" action.
- Renderer code can no longer accidentally select the wrong id after
  creation: there is no `findCreatedId`/set-difference call left on any
  deck-item creation path.
- `CastRepository` intentionally exposes two methods for the same
  transaction (`createDeckItemWithFirstSlide` returning `{ itemId, patch }`,
  and `createDeckItemWithTheme` returning `patch` alone) so that pre-existing
  repository-level tests did not need to change their assertions on this
  change. Any new repository-level test should use
  `createDeckItemWithFirstSlide` and assert on `itemId` directly rather than
  re-deriving it from the patch.
- `app/renderer/contexts/asset-editor/theme-resolution.test.tsx` (owned by
  issue #101) mocked `window.castApi.createDeckItemWithTheme` to resolve with
  a raw `SnapshotPatch`. Those mocks predated this ADR's IPC result contract
  and have been updated to resolve `{ itemId, patch }`.
- No deck-item mutation path infers an id from patch contents any more:
  `findCreatedId` is gone from creation, and the snapshot scan is gone from
  duplication. Reviewers should treat a reintroduced set-difference over
  entity id arrays as a regression against this ADR.
