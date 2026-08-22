# ADR-0009: Targeted Snapshot Patch Apply for Undo/Redo

## Status

Accepted

## Date

2026-08-21

## Context

Issue #239 found that routine undo/redo was paying the cost of the wrong
primitive. The renderer already held a `SnapshotPatch` plus its inverse for
patch-backed history entries, but undo/redo still materialized the entire next
`AppSnapshot`, sent that full snapshot over IPC, deep-validated every table in
main, deleted all 21 application-owned tables, and reinserted every row through
`CastRepository.restoreFromSnapshot`.

That full restore path is still correct for recovery-class operations: project
backup restore swaps in a complete validated database, and a small number of
history entries still store a whole snapshot rather than a patch. It is not the
right hot path for routine patch-history undo/redo, where most mutations touch
only a few rows.

The repository already had the ingredients needed for a targeted path:

- `SnapshotPatch` carries row-level upserts/deletes for each persisted family.
- `buildPatch(...)` already rehydrates rows in persisted order from exact ids.
- The full restore path already established the authoritative table ordering for
  deletes and inserts.
- Issue #240 had already introduced the chunking and statement-cache work needed
  to keep large id sets under SQLite's variable limits.

## Decision

- Add `CastRepository.applyPatch(patch)` as a repository-level primitive for
  targeted patch application. It mutates only the tables named in the patch and
  runs in one transaction.
- Expose that primitive through a dedicated IPC channel,
  `cast:applySnapshotPatch`, with a typed preload bridge method
  `window.castApi.applySnapshotPatch(...)`.
- Validate only the patch tables actually present on the wire payload. The
  protocol codec reuses the existing row validators for upsert rows and checks
  delete arrays as string ids; absent tables mean "no change".
- Keep the canonical mutation order from full restore:
  child-before-parent deletes, then parent-before-child upserts.
- Defer foreign-key enforcement to transaction commit for patch apply. Partial
  patches can legally express transitions that are temporarily invalid in the
  middle of the transaction, such as:
  - a cue row being deleted while dependent macro steps are rewritten later in
    the same patch;
  - a theme row being deleted while item rows clear their `theme_id` later in
    the same patch.
  Commit-time FK enforcement preserves correctness while still rejecting any
  patch whose final state is invalid.
- Keep `restoreFromSnapshot` intact as the whole-state primitive. Snapshot-based
  undo history entries, backup restore, and recovery continue to use the
  full-state path.
- Keep patch-history undo/redo renderer-driven. The renderer computes the exact
  next snapshot locally with the pure `applyPatch(...)` helper, sends the patch
  to main, and updates local state only if the repository transaction succeeds.
  The IPC method returns success/failure only, not a full snapshot payload.

## Consequences

- Routine patch-history undo/redo stops round-tripping full snapshots through
  main and stops rewriting untouched tables in SQLite.
- The trust boundary becomes proportional to the mutation: only tables present
  in the patch are decoded on ingress.
- Failure semantics stay atomic. Any mid-apply write failure or FK violation at
  commit leaves the database unchanged.
- The IPC contract now has three intentionally different persistence restore
  paths:
  - `cast:applySnapshotPatch` for routine patch-history undo/redo
  - `cast:restoreFromSnapshot` for whole-snapshot restore/fallback undo entries
  - `cast:restoreProjectBackup` for recovery-class database replacement
- The repository now owns two restore strategies with different tradeoffs, and
  tests must keep both honest:
  - full-table restore for whole-state replacement
  - targeted patch apply for incremental history replay
