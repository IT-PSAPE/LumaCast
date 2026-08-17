# ADR-0005: Canonical Transactional SQLite Migrations

## Status

Accepted

## Context

Issue #108 unified the database upgrade path. Previously the schema was
maintained in two ways that could drift: a separately written "fresh install"
schema for new databases and an upgrade list for existing ones, and a
migration's DDL was applied and its `user_version` bump persisted as separate
steps — a process crash between the two left a partially migrated database
whose version no longer matched its contents. There was also no pre-migration
backup (an irreversible migration could run against the only copy of user
data) and no protection against a database written by a newer app version
being opened by an older one.

## Decision

- `app/database/migrations/definitions.ts` is the single canonical, dense,
  ordered migration list, currently v1..v22 with v1 as the bootstrap. There
  is no separately maintained fresh-install schema: a brand-new empty
  database (user_version 0, no tables) and an existing database at any
  supported version both advance through the same `runMigrations` path
  (`app/database/migrations/runner.ts`).
- `PRAGMA user_version` is the sole schema cursor. A `user_version` greater
  than the highest version this build supports is refused
  (`FutureSchemaVersionError`) before any backup or write; downgrading a
  database is never attempted.
- An existing database (any table, or a nonzero `user_version`) receives
  exactly one backup before its first pending migration, written with
  `VACUUM INTO` to the deterministic filename `lumacast.bak-v<source>.sqlite`
  in the database's directory (overridable via `backupDir`). The backup is
  opened read-only and verified with `integrity_check` and a `user_version`
  matching the source; a failed or unverified backup aborts the migration
  (`MigrationBackupError`) rather than proceeding without a rollback point.
- Each migration's `up` and its `user_version` bump commit in one SQLite
  transaction. Migrations that recreate tables via the create/copy/drop/
  rename dance (`requiresForeignKeysOff`) toggle `PRAGMA foreign_keys`
  outside that transaction and restore its prior state afterward, because
  the pragma no-ops inside a transaction.
- There are no down migrations: the list only ever moves a database forward.
  Because the `up` and the version bump are atomic, a crash or thrown error
  rolls back both, and restarting the app retries the same migration from
  the prior version instead of silently skipping it.
- Fixtures `schema-v0`..`schema-v22` in `app/database/fixtures` pin frozen
  structural fingerprints (sha256 of the full schema snapshot) and verify
  that every historical version converges to the canonical fresh-install
  schema after `runMigrations`. They are regression evidence, not a second
  schema definition; when a historical migration legitimately changes, the
  affected fixture hashes must be regenerated intentionally as part of that
  change.

## Consequences

- Fresh installs and upgrades converge to exactly the same schema, verified
  by the fixture suite; the two definitions can no longer drift apart.
- Upgrade safety is now: future-version refusal before any write, one
  verified backup with a deterministic name before the first migration, and
  atomic per-migration commits that make failed migrations retryable from a
  consistent state.
- Adding a schema change means appending one new migration entry; there is
  no second place to keep in sync.
- Fixture hashes and `schemaObjectCount` must be regenerated deliberately
  whenever a historical migration definition changes, and reviewers should
  expect that regeneration to accompany the change.