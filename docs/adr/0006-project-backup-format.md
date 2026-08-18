# ADR-0006: Project Backup Format

## Status

Accepted — the contract's shape (versioned envelope, explicit per-table/
per-column enumeration, deterministic ordering, restore-side validation
before promotion) is still current, but issue #219 (the item-model refactor)
bumped the format to version 2 and changed the table set. See the
**Amendment (2026-08-18, issue #219)** section before Consequences.

## Context

Issue #145 calls for a complete, versioned backup of all application state as
the recovery boundary. Deck bundles only capture a selection of deck items,
and snapshots are an in-app undo mechanism rather than a durable export
artifact. Without an explicit contract, a backup is only as trustworthy as the
code that happened to write it: fields could be dropped silently, order could
be nondeterministic, and a backup written by a newer app version could be
silently misread by an older one. The schema was also missing explicit
treatment of which tables are application-owned (issue #110) and there was no
named validation gate at the backup boundary.

## Decision

- A project backup is a distinct artifact from deck bundles: a single JSON
  document with envelope `{ format: 'cast-project-backup', version: 1,
  schemaVersion, tables }`, where `format` is a literal string, `version` is
  the backup-format version, and `schemaVersion` is the source database's
  `PRAGMA user_version` (currently 22). The envelope deliberately carries no
  timestamp or other export-time state, so two exports of unchanged data
  serialize byte-for-byte identically.
- The `tables` object enumerates all 28 application-owned v22 tables —
  `libraries`, `presentations`, `lyrics`, `talks`, `slides`,
  `slide_elements`, `talk_script_blocks`, `playlists`, `playlist_groups`,
  `playlist_entries`, `image_assets`, `video_assets`, `audio_assets`,
  `overlays`, `themes`, `stages`, `cues`, `actions`, `action_steps`,
  `trigger_bindings`, and the eight `*_collections` families — with every
  column serialized explicitly under its SQL snake_case name. No object
  spread is used at the backup boundary, so a column added later cannot leak
  into a backup by accident. Column nullability mirrors the SQL schema
  verbatim (`action_steps.cue_id` is nullable because the v22 physical column
  carries no `NOT NULL` constraint, so direct, legacy, or externally
  maintained database state may legally contain null there).
- Rows are serialized in deterministic order (`created_at ASC, id ASC`),
  JSON-valued columns as raw JSON strings. Managed media files are never
  copied; only `src` references are recorded. There are no settings tables in
  v22, so migration/schema metadata is carried solely by `schemaVersion`.
- `validateProjectBackup` in `app/core/deck-bundles.ts` is the named
  validation function and the core-policy owner of the contract. It rejects
  backups with a future format version (> 1), a `schemaVersion` other than
  the exact supported version, the wrong format string, an envelope that is
  not exactly the four keys `format`/`version`/`schemaVersion`/`tables`,
  missing or extra tables or columns, malformed types/enums/flags, and slide
  rows that violate the single-owner invariant the schema CHECK enforces. It
  throws `ProjectBackupValidationError`. Playlist-entry ownership and other
  cross-table referential integrity are restore-side checks deferred to
  issue #146; validation never rejects a document the exporter can produce.
- The repository exposes `exportProjectBackup()` and
  `validateProjectBackup(backup)` without mutating the active database;
  export requires the `user_version` to equal `LATEST_SCHEMA_VERSION`
  exactly and passes every produced document through
  `validateProjectBackup` before returning.
- Archive read/write lives in `app/main/deck-bundle-archive.ts`
  (`writeProjectBackupArchive`/`readProjectBackupArchive`), sharing zip
  helpers with the deck-bundle archive; both write and read validate the
  document through core policy. The single-entry zip reader verifies archive
  bounds, the exact single-entry count, central/local offsets and lengths,
  and central/local name agreement, and additionally requires CRC/size
  agreement for the stored entry: the local and central compressed and
  uncompressed sizes must equal the extracted data length, the local and
  central CRCs must agree with each other, and the payload's computed CRC
  must match — failing with the shared `Invalid bundle archive` error rather
  than raw range errors.
- Restore (#146) is a distinct, recoverable promotion, never routine Undo:
  `CastRepository.restoreProjectBackup` validates the document through core
  policy and restore-side checks (cross-table reference closure including the
  schema-soft references `actions.collection_id` and
  `trigger_bindings.target_id`; exactly one default collection per bin),
  inserts every row into a throwaway same-directory temporary database in
  one atomic clear-then-insert transaction, and requires exact row counts and
  a clean `PRAGMA foreign_key_check` on the temporary database before
  promoting it. Promotion checkpoints and closes both connections, renames
  the active database to a retained `*.prerecovery-*.sqlite` sibling (never
  deleted by the app), renames the temporary database into place, and rolls
  the swap back on any failure after the retain step so the previous project
  stays active. It is exposed over a typed IPC channel
  (`cast:restoreProjectBackup`) returning a full snapshot plus the retained
  database path, not a `SnapshotPatch`.
- `trigger_bindings.source_id` is deliberately not part of the document
  reference closure: deleting slides legitimately leaves dangling sources,
  so a validator rejecting them would reject exports the exporter can
  produce.

## Amendment (2026-08-18, issue #219 item-model refactor)

- **Format version 2, `schemaVersion` 27** (`PROJECT_BACKUP_VERSION = 2`).
  `tables` now enumerates 21 application-owned tables instead of 28:
  `presentations`, `lyrics`, `talks`, `slides`, `slide_elements`,
  `talk_script_blocks`, `playlists`, `playlist_entries`, `image_assets`,
  `video_assets`, `audio_assets`, `overlays`, `presentation_themes`,
  `lyric_themes`, `talk_themes`, `overlay_themes`, `stages`, `cues`,
  `actions`, `action_steps`, `trigger_bindings`. There is no `libraries`, no
  `playlist_groups`, no `collection_id` anywhere, and no single `themes`
  table — the four per-owner theme tables each get their own key, sharing
  one structural `ProjectBackupThemeRow` shape (decision D2's note that a
  shared structural shape across the four owner types is fine without a
  discriminant field).
- **`playlist_entries` is flat and `kind`-discriminated** (`'item' |
  'separator'`) instead of routed through `playlist_groups`: `kind='item'`
  populates exactly one of `presentation_id`/`lyric_id`/`talk_id` and leaves
  `label`/`color_key` null; `kind='separator'` leaves all three owner
  columns null and carries `label`/`color_key` instead.
- **The schema-soft `actions.collection_id` reference is gone**, along with
  `assertProjectBackupDefaultCollections` (exactly one default per
  `*_collections` bin) — collections do not exist, so there is nothing left
  for either check to validate. `trigger_bindings.target_id` remains the
  other schema-soft reference, checked exactly as before.
- **Version 1 backups (schemaVersion exactly 22) are imported via migration
  replay.** `restoreProjectBackup` classifies a document with
  `isLegacyProjectBackup` before v2 validation, validates it against the
  frozen v1 contract (`validateLegacyProjectBackup`), materializes the rows
  into a throwaway SQLite database at schema 22 and replays the real
  migrations v23–v27 over it (`migrateLegacyProjectBackup`) — the same
  tested transform a live upgrade uses — then restores through the ordinary
  v2 path. `validateProjectBackup` itself stays v2-only: it still rejects
  version 1 with an "older app version" message (tested), and a version-1
  document with any `schemaVersion` other than 22 is rejected rather than
  guessed at.
- The restore-side reference check (`assertProjectBackupReferences`) grew
  three new FK columns to check (the three `playlist_entries` item-owner
  columns) and the four theme-owner slide columns replacing the single
  `theme_id` reference; it lost the `actions.collection_id` check described
  above.

## Consequences

- A backup is self-describing and versioned: a future-format backup is
  rejected instead of silently misread, and a backup's meaning is pinned by
  its `format`/`version`/`schemaVersion` triple, with `schemaVersion`
  matched exactly so a backup written from a future schema is never
  interpreted as a document from an earlier one (v22 at the time this was
  written; v27 per the Amendment above).
- The per-table/per-column enumeration is explicit and tested against a
  maximally populated fixture, so adding or renaming a column surfaces as a
  contract change rather than a silent drift.
- Deterministic ordering, JSON-raw-string columns, and a timestamp-free
  envelope keep the format byte-stable for a given database, which makes
  exports deeply and byte-for-byte equal and therefore comparable and
  diffable.
- The contract lives in core policy, so renderer, main, and restore code all
  validate through one gate.
- Restore is recoverable: the active database is never overwritten or deleted
  in place, the pre-recovery database is retained as a same-directory
  sibling, and a failed promotion leaves the previous project active.
- Future schema migrations must either extend the backup format
  deliberately (bumping `PROJECT_BACKUP_VERSION` or `schemaVersion`, as the
  item-model refactor's Amendment above did) or keep the existing mapping
  intact; `action_steps` legacy columns (`kind`, `payload_json`,
  `failure_policy`) remain part of the contract until a
  migration removes them.