# @lumacast/selection

Shared, domain-agnostic selection primitives for collection and editor surfaces. IDs are plain strings; callers own resource mutations and authoritative state.

`useMultiSelection(visibleIds, scopeKey, selectableIds?)` provides transient range/toggle selection for a visible ID order. `selectableIds` defaults to the visible IDs and can include valid selected IDs hidden by a filter or collapsed group; range selection still uses only `visibleIds`. Scope changes clear transient selection. `useMultiSelectionKeyHandler` handles local select-all and Escape while leaving editable controls alone.

`resolveSelection(visibleIds, currentIds, anchorId, clickedId, modifiers?, selectableIds?)` applies the same transitions to caller-owned state. It filters stale IDs against `selectableIds`, preserves hidden valid selections during modifier selection, and uses visible order for ranges. A shift click with no visible anchor selects only the clicked ID. `resolveActionIds(visibleIds, currentIds, clickedId, selectableIds?)` returns selected visible targets in visible order followed by hidden selected targets in selectable order; clicking an unselected row targets only that row.

`filterSelectionIds` and `toggleSelectionId` provide pure membership operations for ordered array state. The toggle helper accepts `'front'` to insert a newly selected primary ID first, or `'back'` to append it.

`moveSelectedIds` accepts a destination row index; `moveSelectionToGap` accepts a gap in the original list, from zero through the list length. Both preserve selected members' relative order. `commitSelectedReorder` persists the resulting block order through per-item APIs.

`runSelectionActions` sequences mutations in caller order and returns `{ ok: false, failedId, remainingIds, error }` at the first rejection; `remainingIds` includes the failed ID. Callers can report `error` through their normal UI path.
