// @vitest-environment node
//
// Migration v31 (`playback-schedules`): the independent automation-record
// table borrows content but is owned by nothing — no foreign keys, no
// item-owned timing columns. These tests pin the created shape, the
// idempotent rerun, the upgrade of a populated schema-30 database (rows
// preserved, empty schedule table), and the NOT NULL column contract.
import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../../../../../packages/persistence-sqlite/src/sqlite';
import { MIGRATIONS } from '../../../../../packages/persistence-sqlite/src/migrations/index';

function materializeTo(db: SqliteDatabase, version: number): void {
  for (const migration of MIGRATIONS.filter((m) => m.version <= version)) {
    const apply = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
  }
}

function applyMigration(db: SqliteDatabase, version: number): void {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) throw new Error(`no migration registered for version ${version}`);
  const apply = db.transaction(() => {
    migration.up(db);
    db.pragma(`user_version = ${version}`);
  });
  apply();
}

function playbackScheduleColumns(db: SqliteDatabase): Array<{ name: string }> {
  return db.prepare('PRAGMA table_info(playback_schedules)').all() as Array<{ name: string }>;
}

describe('v31 playback-schedules — independent schedule table', () => {
  it('creates playback_schedules with the documented columns and no foreign keys', () => {
    const db = new SqliteDatabase(':memory:');
    try {
      materializeTo(db, 31);

      expect(playbackScheduleColumns(db).map((column) => column.name)).toEqual([
        'id',
        'item_ref_json',
        'enabled',
        'kind',
        'steps_json',
        'audio_asset_id',
        'markers_json',
        'created_at',
        'updated_at',
      ]);
      expect(db.prepare('PRAGMA foreign_key_list(playback_schedules)').all()).toEqual([]);
      expect(db.pragma('user_version', { simple: true })).toBe(31);
    } finally {
      db.close();
    }
  });

  it('is idempotent: rerunning v31 over an existing table keeps rows', () => {
    const db = new SqliteDatabase(':memory:');
    try {
      materializeTo(db, 30);
      applyMigration(db, 31);
      db.prepare(
        `INSERT INTO playback_schedules (id, item_ref_json, enabled, kind, steps_json, audio_asset_id, markers_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        'timing:presentation:pres-1',
        JSON.stringify({ type: 'presentation', id: 'pres-1' }),
        1,
        'slide-timing',
        JSON.stringify([{ slideId: 'slide-1', durationMs: 1000 }]),
        null,
        null,
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z',
      );

      applyMigration(db, 31);

      const rows = db.prepare('SELECT id FROM playback_schedules').all() as Array<{ id: string }>;
      expect(rows).toEqual([{ id: 'timing:presentation:pres-1' }]);
    } finally {
      db.close();
    }
  });

  it('upgrades a populated schema-30 database without touching existing rows', () => {
    const db = new SqliteDatabase(':memory:');
    try {
      materializeTo(db, 30);
      db.prepare(
        'INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('pres-1', 'Deck', null, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

      applyMigration(db, 31);

      expect(db.prepare('SELECT id FROM presentations').all()).toEqual([{ id: 'pres-1' }]);
      expect(db.prepare('SELECT COUNT(*) AS count FROM playback_schedules').get()).toEqual({ count: 0 });
      expect(db.pragma('user_version', { simple: true })).toBe(31);
    } finally {
      db.close();
    }
  });

  it('rejects nulls on the load-bearing columns', () => {
    const db = new SqliteDatabase(':memory:');
    try {
      materializeTo(db, 31);

      expect(() => db.prepare(
        `INSERT INTO playback_schedules (id, item_ref_json, enabled, kind, steps_json, audio_asset_id, markers_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(null, null, 1, 'slide-timing', '[]', null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toThrow();
    } finally {
      db.close();
    }
  });
});
