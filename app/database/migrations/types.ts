import type { SqliteDatabase } from '../sqlite';

/**
 * One canonical, numbered migration step. Versions are dense and contiguous
 * starting at 1 — there is no gap and no separately maintained "fresh
 * install" schema. A brand-new empty database and an existing database both
 * advance through exactly the same ordered list, starting from whatever
 * `user_version` they currently hold (0 for a new file).
 *
 * `up` must be idempotent: every historical migration in this codebase has
 * always been written to tolerate re-application (checked via `hasTable` /
 * `hasColumn` / `IF NOT EXISTS` before every structural change), because a
 * process could previously crash between applying a migration's DDL and
 * persisting `user_version`. The runner now closes that gap by committing
 * the migration and its `user_version` bump in one transaction, but `up`
 * remains idempotent as defense in depth and so fixtures can be regenerated
 * deterministically.
 *
 * `requiresForeignKeysOff` marks a migration that recreates a table via the
 * "create new table, copy rows, drop old, rename" dance. SQLite refuses to
 * toggle `PRAGMA foreign_keys` while a transaction is open (the pragma
 * silently no-ops instead of erroring), so the runner toggles it *around*
 * that migration's transaction rather than inside it.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly requiresForeignKeysOff?: boolean;
  readonly up: (db: SqliteDatabase) => void;
}
