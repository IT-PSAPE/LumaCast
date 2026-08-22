import fs from 'node:fs';
import path from 'node:path';
import { SqliteDatabase } from '../sqlite';
import { MIGRATIONS } from './definitions';
import type { Migration } from './types';

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/**
 * Thrown when a database's `user_version` is greater than the highest
 * version this build of the app knows how to migrate to — i.e. the database
 * was last written by a newer version of the app. Thrown before any backup
 * or write happens; the caller must not open the database for use.
 */
export class FutureSchemaVersionError extends Error {
  constructor(readonly foundVersion: number, readonly supportedVersion: number) {
    super(
      `Database schema version ${foundVersion} is newer than the highest version this app version supports (${supportedVersion}). ` +
      'Refusing to open it: downgrading a database is not supported and could lose or corrupt data. ' +
      'Install a newer version of the app, or restore a backup made with a compatible version.'
    );
    this.name = 'FutureSchemaVersionError';
  }
}

/**
 * Thrown when a pre-migration backup could not be created and verified. The
 * caller must treat this as fatal and must not proceed to run migrations —
 * an unverified backup before an irreversible migration is not acceptable.
 */
export class MigrationBackupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'MigrationBackupError';
  }
}

export interface RunMigrationsOptions {
  /**
   * Directory the pre-migration backup is written into. Defaults to the
   * same directory as the database file (matching where recovery tooling
   * and users already look for `lumacast.bak-v*.sqlite` files).
   */
  backupDir?: string;
  /** Called with the verified backup's absolute path, if one was made. */
  onBackupCreated?: (backupPath: string) => void;
  /** Best-effort observer for migration progress. Observer failures are ignored. */
  onProgress?: (progress: MigrationProgress) => void;
}

export interface MigrationProgress {
  phase: 'backup' | 'migration' | 'complete';
  completed: number;
  total: number;
  migrationVersion?: number;
}

function reportProgress(options: RunMigrationsOptions, progress: MigrationProgress): void {
  try {
    options.onProgress?.(progress);
  } catch {
    // Progress is observational. A broken telemetry consumer must never
    // change whether a migration commits, rolls back, or runs at all.
  }
}

function getUserVersion(db: SqliteDatabase): number {
  return db.pragma('user_version', { simple: true }) as number;
}

function setUserVersion(db: SqliteDatabase, version: number): void {
  db.pragma(`user_version = ${version}`);
}

function hasAnyTable(db: SqliteDatabase): boolean {
  const row = db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get() as { count: number };
  return row.count > 0;
}

function getForeignKeysEnabled(db: SqliteDatabase): boolean {
  return Boolean(db.pragma('foreign_keys', { simple: true }));
}

/**
 * Write a `VACUUM INTO` snapshot of `db` and verify it before returning.
 * Verification opens the snapshot read-only and checks:
 *   1. `PRAGMA integrity_check` reports `ok`.
 *   2. The snapshot's `user_version` matches the version being backed up
 *      (catching a snapshot that was silently truncated or corrupted).
 *
 * Throws `MigrationBackupError` — rather than logging and continuing — if
 * the backup cannot be created or fails verification, so a migration never
 * proceeds against the only copy of the user's data without a good backup
 * to fall back on.
 */
function createVerifiedBackup(
  db: SqliteDatabase,
  dbPath: string,
  fromVersion: number,
  options: RunMigrationsOptions,
): string {
  const backupDir = options.backupDir ?? path.dirname(dbPath);
  const backupPath = path.join(backupDir, `lumacast.bak-v${fromVersion}.sqlite`);

  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.rmSync(backupPath, { force: true });
    const escaped = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  } catch (error) {
    throw new MigrationBackupError(`Failed to write pre-migration backup to ${backupPath}`, error);
  }

  let verifyDb: SqliteDatabase | undefined;
  try {
    verifyDb = new SqliteDatabase(backupPath, { readonly: true });
    const integrity = verifyDb.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') {
      throw new MigrationBackupError(`Backup at ${backupPath} failed integrity_check: ${String(integrity)}`);
    }
    const backupVersion = getUserVersion(verifyDb);
    if (backupVersion !== fromVersion) {
      throw new MigrationBackupError(
        `Backup at ${backupPath} reports user_version ${backupVersion}, expected ${fromVersion}`
      );
    }
  } catch (error) {
    if (error instanceof MigrationBackupError) throw error;
    throw new MigrationBackupError(`Failed to verify pre-migration backup at ${backupPath}`, error);
  } finally {
    verifyDb?.close();
  }

  return backupPath;
}

/**
 * Applies migrations whose `version` is greater than `db`'s current
 * `user_version` and less than or equal to `targetVersion`, in order —
 * exactly the same replay loop {@link runMigrations} runs, but stopping
 * short of `LATEST_SCHEMA_VERSION` and without writing a pre-migration
 * backup (there is nothing meaningful to back up: every caller passes a
 * fresh, empty temporary database). Used to materialize a specific
 * historical schema version — schema-equivalence.test.ts's fixture
 * materialization follows this same pattern locally, and the legacy (v1)
 * project-backup importer (@lumacast/persistence-sqlite's
 * legacy-project-backup.ts) calls this directly: once to materialize a v1
 * document at schema 22, then again up to `LATEST_SCHEMA_VERSION` so
 * migrations 23+ replay through the exact tested code path a live database
 * upgrade uses — zero duplicated transform logic.
 */
export function applyMigrationsThroughVersion(db: SqliteDatabase, targetVersion: number): void {
  const currentVersion = getUserVersion(db);
  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion && migration.version <= targetVersion);

  for (const migration of pending) {
    const previousForeignKeysEnabled = migration.requiresForeignKeysOff ? getForeignKeysEnabled(db) : null;
    if (migration.requiresForeignKeysOff) {
      db.pragma('foreign_keys = OFF');
    }
    try {
      const applyMigration = db.transaction(() => {
        migration.up(db);
        setUserVersion(db, migration.version);
      });
      applyMigration();
    } finally {
      if (migration.requiresForeignKeysOff) {
        db.pragma(`foreign_keys = ${previousForeignKeysEnabled ? 'ON' : 'OFF'}`);
      }
    }
  }
}

/**
 * The single ordered migration runner. Applies every migration whose
 * `version` is greater than the database's current `user_version`, in
 * ascending order, to bring it to `LATEST_SCHEMA_VERSION`. Used identically
 * for a brand-new empty database file (`user_version` 0, no tables) and for
 * an existing database at any supported version — there is no separate
 * "fresh install" code path.
 *
 * Guarantees:
 *   - A `user_version` greater than `LATEST_SCHEMA_VERSION` is rejected
 *     before any backup or write (`FutureSchemaVersionError`).
 *   - Before the first migration runs against a database that already has
 *     content (any table, or a nonzero `user_version`), one verified backup
 *     is written (`createVerifiedBackup`). A brand-new empty file has
 *     nothing to back up and skips this step.
 *   - Each migration's DDL/DML and its `user_version` bump commit in the
 *     same SQLite transaction — a crash or thrown error partway through a
 *     migration rolls back that migration's changes and leaves
 *     `user_version` at its pre-migration value, so restarting the app
 *     retries the same migration from a consistent state instead of
 *     silently skipping it.
 *   - No down migration: `MIGRATIONS` only ever moves a database forward.
 */
export function runMigrations(db: SqliteDatabase, dbPath: string, options: RunMigrationsOptions = {}): void {
  const currentVersion = getUserVersion(db);

  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new FutureSchemaVersionError(currentVersion, LATEST_SCHEMA_VERSION);
  }

  const pending: Migration[] = MIGRATIONS.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    reportProgress(options, { phase: 'complete', completed: 1, total: 1 });
    return;
  }

  const total = pending.length;

  const isExistingDatabase = currentVersion > 0 || hasAnyTable(db);
  if (isExistingDatabase) {
    reportProgress(options, { phase: 'backup', completed: 0, total });
    const backupPath = createVerifiedBackup(db, dbPath, currentVersion, options);
    options.onBackupCreated?.(backupPath);
  }

  for (const [index, migration] of pending.entries()) {
    const previousForeignKeysEnabled = migration.requiresForeignKeysOff ? getForeignKeysEnabled(db) : null;
    if (migration.requiresForeignKeysOff) {
      db.pragma('foreign_keys = OFF');
    }
    try {
      const applyMigration = db.transaction(() => {
        migration.up(db);
        setUserVersion(db, migration.version);
      });
      applyMigration();
      reportProgress(options, {
        phase: 'migration',
        completed: index + 1,
        total,
        migrationVersion: migration.version,
      });
    } finally {
      if (migration.requiresForeignKeysOff) {
        db.pragma(`foreign_keys = ${previousForeignKeysEnabled ? 'ON' : 'OFF'}`);
      }
    }
  }

  reportProgress(options, { phase: 'complete', completed: total, total });
}
