// @vitest-environment node
//
// The global vitest.config.ts sets `environment: 'jsdom'`, but jsdom's
// polyfilled global `URL` is incompatible with the Node-only
// `fileURLToPath(new URL('..', import.meta.url))` pattern used below to
// locate the fixtures directory, throwing `TypeError: The URL must be of
// scheme file`. This suite is pure Node/SQLite migration testing with no DOM
// dependency, so it opts back into the Node environment per-file rather than
// weakening the global jsdom default that the rest of the suite relies on.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDatabase } from '../sqlite';
import {
  FutureSchemaVersionError,
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  MigrationBackupError,
  runMigrations,
} from './index';

const FIXTURES_ROOT = path.join(fileURLToPath(new URL('..', import.meta.url)), 'fixtures');
const EXPECTED_SCHEMA_VERSIONS = Array.from({ length: 28 }, (_, i) => i);
const TEMP_PREFIX = 'lumacast-schema-equivalence-';
const SAFETY_SOURCE_VERSION = 26;

interface FixtureDiscovery {
  version: number;
  dir: string;
  manifestPath: string;
  manifest: FixtureManifest;
}

interface FixtureManifest {
  schemaVersion: number;
  schemaSha256: string;
  schemaObjectCount: number;
}

interface SqliteMasterObject {
  type: string;
  name: string;
  sql: string | null;
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
  pk: number;
}

interface ForeignKeyListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
  match: string;
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexXInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
  desc: number;
  coll: string;
  key: number;
}

interface TableSnapshot {
  columns: TableInfoRow[];
  foreignKeys: ForeignKeyListRow[];
  indexes: Array<IndexListRow & { columns: IndexXInfoRow[] }>;
}

interface SchemaSnapshot {
  userVersion: number;
  foreignKeysEnabled: number;
  objects: SqliteMasterObject[];
  tables: Record<string, TableSnapshot>;
  foreignKeyCheck: unknown[];
}

let tempRoot: string;

function discoverFixtures(): FixtureDiscovery[] {
  return fs
    .readdirSync(FIXTURES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^schema-v\d+$/.test(entry.name))
    .map((entry) => {
      const match = /^schema-v(\d+)$/.exec(entry.name);
      if (!match) throw new Error(`unexpected fixture directory: ${entry.name}`);
      const version = Number(match[1]);
      const manifestPath = path.join(FIXTURES_ROOT, entry.name, 'fixture.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as FixtureManifest;
      return { version, dir: entry.name, manifestPath, manifest };
    })
    .sort((a, b) => a.version - b.version);
}

const FIXTURES = discoverFixtures();

function openDatabase(filename: string): SqliteDatabase {
  const db = new SqliteDatabase(filename);
  db.pragma('foreign_keys = ON');
  return db;
}

function openDatabaseReadOnly(filename: string): SqliteDatabase {
  return new SqliteDatabase(filename, { readonly: true });
}

function materializeHistoricalSchema(db: SqliteDatabase, version: number): void {
  const prefix = MIGRATIONS.filter((migration) => migration.version <= version);
  for (const migration of prefix) {
    const previousForeignKeysEnabled = migration.requiresForeignKeysOff
      ? Boolean(db.pragma('foreign_keys', { simple: true }))
      : null;
    if (migration.requiresForeignKeysOff) {
      db.pragma('foreign_keys = OFF');
    }
    try {
      const applyMigration = db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      });
      applyMigration();
    } finally {
      if (migration.requiresForeignKeysOff) {
        db.pragma(`foreign_keys = ${previousForeignKeysEnabled ? 'ON' : 'OFF'}`);
      }
    }
  }
}

function normalizeSql(sql: string | null): string | null {
  if (sql === null) return null;
  return sql.replace(/\s+/g, ' ').trim();
}

function captureSchemaSnapshot(db: SqliteDatabase): SchemaSnapshot {
  const objects = (
    db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all() as SqliteMasterObject[]
  ).map((object) => ({ ...object, sql: normalizeSql(object.sql) }));

  const tables: Record<string, TableSnapshot> = {};
  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;
  for (const { name } of tableNames) {
    tables[name] = {
      columns: (db.prepare(`PRAGMA table_info("${name}")`).all() as TableInfoRow[]).sort((a, b) => a.cid - b.cid),
      foreignKeys: (db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as ForeignKeyListRow[]).sort(
        (a, b) => a.id - b.id || a.seq - b.seq,
      ),
      indexes: (db.prepare(`PRAGMA index_list("${name}")`).all() as IndexListRow[])
        .sort((a, b) => a.seq - b.seq)
        .map((index) => ({
          ...index,
          columns: (db.prepare(`PRAGMA index_xinfo("${index.name}")`).all() as IndexXInfoRow[]).sort(
            (a, b) => a.seqno - b.seqno,
          ),
        })),
    };
  }

  return {
    userVersion: db.pragma('user_version', { simple: true }) as number,
    foreignKeysEnabled: db.pragma('foreign_keys', { simple: true }) as number,
    objects,
    tables,
    foreignKeyCheck: db.prepare('PRAGMA foreign_key_check').all() as unknown[],
  };
}

function snapshotSha256(db: SqliteDatabase): string {
  return createHash('sha256').update(JSON.stringify(captureSchemaSnapshot(db))).digest('hex');
}

function removeWithinTempRoot(target: string): void {
  const root = path.resolve(tempRoot);
  const resolved = path.resolve(target);
  if (resolved === root) throw new Error('refuses to remove the shared temp root from a per-test cleanup');
  if (!resolved.startsWith(root + path.sep)) throw new Error(`refuses target outside the test temp root: ${target}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function removeTempRoot(root: string): void {
  const resolved = path.resolve(root);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
    throw new Error(`refuses unsafe cleanup target: ${root}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
});

afterAll(() => {
  if (tempRoot) {
    removeTempRoot(tempRoot);
  }
});

describe('schema equivalence across historical fixtures (#108)', () => {
  it('pins fixture manifests for exactly versions 0..27 with matching directory suffixes', () => {
    expect(LATEST_SCHEMA_VERSION, 'LATEST_SCHEMA_VERSION must be 27').toBe(27);
    expect(
      MIGRATIONS.map((migration) => migration.version),
      'MIGRATIONS versions must be a dense contiguous prefix 1..27',
    ).toEqual(Array.from({ length: 27 }, (_, i) => i + 1));
    expect(
      FIXTURES.map((fixture) => fixture.version),
      'fixture manifests must cover exactly versions 0..27 with no gaps or duplicates',
    ).toEqual(EXPECTED_SCHEMA_VERSIONS);
    for (const fixture of FIXTURES) {
      expect(
        fixture.manifest.schemaVersion,
        `fixture ${fixture.manifestPath} must declare schemaVersion ${fixture.version} matching its directory suffix`,
      ).toBe(fixture.version);
      expect(
        fixture.manifest.schemaSha256,
        `fixture ${fixture.manifestPath} must declare a 64-char hex schemaSha256`,
      ).toMatch(/^[0-9a-f]{64}$/);
      expect(
        fixture.manifest.schemaObjectCount,
        `fixture ${fixture.manifestPath} must declare a non-negative integer schemaObjectCount`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        Number.isInteger(fixture.manifest.schemaObjectCount),
        `fixture ${fixture.manifestPath} must declare an integer schemaObjectCount`,
      ).toBe(true);
    }
  });

  it.each(EXPECTED_SCHEMA_VERSIONS)(
    'schema at user_version %d converges to the canonical fresh-install schema after runMigrations',
    (version) => {
      const dir = path.join(tempRoot, `v${version}`);
      fs.mkdirSync(dir, { recursive: true });
      try {
        const historicalPath = path.join(dir, 'historical.sqlite');
        const historical = openDatabase(historicalPath);
        try {
          materializeHistoricalSchema(historical, version);
          expect(
            historical.pragma('user_version', { simple: true }),
            `materialized historical database for version ${version} must sit at user_version ${version}`,
          ).toBe(version);

          const fixture = FIXTURES.find((candidate) => candidate.version === version);
          if (!fixture) {
            throw new Error(`no fixture manifest found for version ${version}`);
          }
          const historicalSnapshot = captureSchemaSnapshot(historical);
          expect(
            historicalSnapshot.objects.length,
            `materialized historical schema at user_version ${version} must contain ${fixture.manifest.schemaObjectCount} sqlite_master objects`,
          ).toBe(fixture.manifest.schemaObjectCount);
          expect(
            snapshotSha256(historical),
            `materialized historical schema at user_version ${version} must match the frozen canonical snapshot`,
          ).toBe(fixture.manifest.schemaSha256);

          runMigrations(historical, historicalPath);

          const canonicalPath = path.join(dir, 'canonical.sqlite');
          const canonical = openDatabase(canonicalPath);
          try {
            runMigrations(canonical, canonicalPath);
            expect(
              captureSchemaSnapshot(historical),
              `schema upgraded from user_version ${version} must match the canonical fresh-install schema`,
            ).toEqual(captureSchemaSnapshot(canonical));
          } finally {
            canonical.close();
          }
        } finally {
          historical.close();
        }
      } finally {
        removeWithinTempRoot(dir);
      }
    },
  );
});

describe('migration runner safety (#108)', () => {
  it('creates a verified backup of an existing database before migrating', () => {
    const dir = path.join(tempRoot, 'safety-backup');
    fs.mkdirSync(dir, { recursive: true });
    const backupDir = path.join(dir, 'backups');
    const historicalPath = path.join(dir, 'historical.sqlite');
    const historical = openDatabase(historicalPath);
    try {
      materializeHistoricalSchema(historical, SAFETY_SOURCE_VERSION);

      // `libraries` is gone by SAFETY_SOURCE_VERSION (dropped at v24, #219
      // item-model refactor decision D4) — `playlists` survives to the tip
      // and needs no FK-satisfying fixture data, so it's the sentinel table.
      const sentinelId = 'sentinel-playlist';
      const sentinelName = 'Sentinel Playlist';
      const now = new Date().toISOString();
      historical
        .prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
        .run(sentinelId, sentinelName, now, now);

      const onBackupCreated = vi.fn<(backupPath: string) => void>();
      runMigrations(historical, historicalPath, { backupDir, onBackupCreated });

      expect(onBackupCreated).toHaveBeenCalledTimes(1);
      const backupPath = onBackupCreated.mock.calls[0][0];
      expect(backupPath).toBe(path.join(backupDir, `lumacast.bak-v${SAFETY_SOURCE_VERSION}.sqlite`));

      const backup = openDatabaseReadOnly(backupPath);
      try {
        expect(backup.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(backup.pragma('user_version', { simple: true })).toBe(SAFETY_SOURCE_VERSION);
        expect(backup.prepare('SELECT id, name FROM playlists WHERE id = ?').get(sentinelId)).toEqual({
          id: sentinelId,
          name: sentinelName,
        });
      } finally {
        backup.close();
      }

      expect(historical.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      historical.close();
      removeWithinTempRoot(dir);
    }
  });

  it('rejects a future schema version before any backup or write', () => {
    const dir = path.join(tempRoot, 'safety-future-version');
    fs.mkdirSync(dir, { recursive: true });
    const backupDir = path.join(dir, 'backups');
    const futurePath = path.join(dir, 'future.sqlite');
    const future = openDatabase(futurePath);
    try {
      const futureVersion = LATEST_SCHEMA_VERSION + 1;
      future.pragma(`user_version = ${futureVersion}`);
      future.exec('CREATE TABLE sentinel_marker (id TEXT PRIMARY KEY, note TEXT NOT NULL)');
      future.prepare('INSERT INTO sentinel_marker (id, note) VALUES (?, ?)').run('marker-1', 'future-data');

      const versionBefore = future.pragma('user_version', { simple: true });
      const sentinelBefore = future.prepare('SELECT id, note FROM sentinel_marker').all();

      const onBackupCreated = vi.fn<(backupPath: string) => void>();
      expect(() => runMigrations(future, futurePath, { backupDir, onBackupCreated })).toThrow(
        FutureSchemaVersionError,
      );

      expect(onBackupCreated).not.toHaveBeenCalled();
      expect(fs.existsSync(backupDir)).toBe(false);
      expect(future.pragma('user_version', { simple: true })).toBe(versionBefore);
      expect(future.prepare('SELECT id, note FROM sentinel_marker').all()).toEqual(sentinelBefore);
    } finally {
      future.close();
      removeWithinTempRoot(dir);
    }
  });

  it('fails closed when the pre-migration backup cannot be written', () => {
    const dir = path.join(tempRoot, 'safety-backup-failure');
    fs.mkdirSync(dir, { recursive: true });
    const historicalPath = path.join(dir, 'historical.sqlite');
    const backupDir = path.join(dir, 'occupied-backup.sqlite');
    fs.writeFileSync(backupDir, 'not a directory');
    const historical = openDatabase(historicalPath);
    try {
      materializeHistoricalSchema(historical, SAFETY_SOURCE_VERSION);

      // `libraries` is gone by SAFETY_SOURCE_VERSION (dropped at v24, #219
      // item-model refactor decision D4) — `playlists` survives to the tip
      // and needs no FK-satisfying fixture data, so it's the sentinel table.
      const sentinelId = 'sentinel-playlist';
      const sentinelName = 'Sentinel Playlist';
      const now = new Date().toISOString();
      historical
        .prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
        .run(sentinelId, sentinelName, now, now);

      const onBackupCreated = vi.fn<(backupPath: string) => void>();
      expect(() => runMigrations(historical, historicalPath, { backupDir, onBackupCreated })).toThrow(
        MigrationBackupError,
      );

      expect(onBackupCreated).not.toHaveBeenCalled();
      expect(fs.readFileSync(backupDir, 'utf8')).toBe('not a directory');
      expect(historical.pragma('user_version', { simple: true })).toBe(SAFETY_SOURCE_VERSION);
      expect(historical.prepare('SELECT id, name FROM playlists WHERE id = ?').get(sentinelId)).toEqual({
        id: sentinelId,
        name: sentinelName,
      });
      expect(historical.pragma('integrity_check', { simple: true })).toBe('ok');
    } finally {
      historical.close();
      removeWithinTempRoot(dir);
    }
  });

  it.each(MIGRATIONS.map((migration) => migration.version))(
    'rolls back an injected failure at migration v%d and restores user_version, foreign_keys, and backup state',
    (version) => {
      const dir = path.join(tempRoot, `safety-rollback-v${version}`);
      fs.mkdirSync(dir, { recursive: true });
      const historicalPath = path.join(dir, 'historical.sqlite');
      const backupDir = path.join(dir, 'backups');
      const historical = openDatabase(historicalPath);
      try {
        materializeHistoricalSchema(historical, version - 1);

        const priorVersion = historical.pragma('user_version', { simple: true }) as number;
        const priorForeignKeys = historical.pragma('foreign_keys', { simple: true }) as number;
        expect(priorVersion, `materialized source must sit at user_version ${version - 1}`).toBe(version - 1);

        const target = MIGRATIONS.find((migration) => migration.version === version);
        if (!target) {
          throw new Error(`expected migration ${version} in MIGRATIONS`);
        }

        const probeTable = `probe_migration_v${version}`;
        const spy = vi.spyOn(target, 'up').mockImplementation((db) => {
          db.exec(`CREATE TABLE ${probeTable} (id TEXT PRIMARY KEY, note TEXT NOT NULL)`);
          throw new Error(`injected migration failure at v${version}`);
        });
        try {
          expect(() => runMigrations(historical, historicalPath, { backupDir })).toThrow(
            `injected migration failure at v${version}`,
          );
          expect(spy).toHaveBeenCalledTimes(1);

          const backupPath = path.join(backupDir, `lumacast.bak-v${version - 1}.sqlite`);
          if (version === 1) {
            expect(
              fs.existsSync(backupPath),
              'an empty v0 database must not create a pre-migration backup',
            ).toBe(false);
          } else {
            expect(
              fs.existsSync(backupPath),
              `migration v${version} must back up the v${version - 1} source first`,
            ).toBe(true);
          }

          expect(
            historical.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(probeTable),
            `the probe write made inside migration v${version} must be rolled back`,
          ).toBeUndefined();
          expect(historical.pragma('user_version', { simple: true }), `user_version must stay at v${version - 1}`).toBe(
            priorVersion,
          );
          expect(
            historical.pragma('foreign_keys', { simple: true }),
            'foreign_keys pragma must be restored to its prior state',
          ).toBe(priorForeignKeys);
        } finally {
          spy.mockRestore();
        }
      } finally {
        historical.close();
        removeWithinTempRoot(dir);
      }
    },
  );
});
