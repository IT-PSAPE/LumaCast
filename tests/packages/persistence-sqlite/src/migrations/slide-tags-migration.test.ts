// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../../../../../packages/persistence-sqlite/src/sqlite';
import { MIGRATIONS } from '../../../../../packages/persistence-sqlite/src/migrations';

const tempPaths: string[] = [];

function openAtVersion(version: number): SqliteDatabase {
  const dbPath = path.join(os.tmpdir(), `lumacast-slide-tags-${Date.now()}-${Math.random()}.sqlite`);
  tempPaths.push(dbPath);
  const db = new SqliteDatabase(dbPath);
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS.filter((candidate) => candidate.version <= version)) {
    const foreignKeysWereEnabled = migration.requiresForeignKeysOff
      ? Boolean(db.pragma('foreign_keys', { simple: true }))
      : null;
    if (migration.requiresForeignKeysOff) db.pragma('foreign_keys = OFF');
    try {
      const apply = db.transaction(() => {
        migration.up(db);
        db.pragma(`user_version = ${migration.version}`);
      });
      apply();
    } finally {
      if (migration.requiresForeignKeysOff) db.pragma(`foreign_keys = ${foreignKeysWereEnabled ? 'ON' : 'OFF'}`);
    }
  }
  return db;
}

afterEach(() => {
  for (const file of tempPaths.splice(0)) fs.rmSync(file, { force: true });
});

describe('v34 slide tags migration', () => {
  it('adds reusable tag definitions and a nullable slide reference without changing existing slides', () => {
    const db = openAtVersion(33);
    try {
      db.prepare(
        `INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at)
         VALUES ('presentation-1', 'Song', NULL, 0, '2026-01-01', '2026-01-01')`
      ).run();
      db.prepare(
        `INSERT INTO slides
          (id, presentation_id, lyric_id, presentation_theme_id, lyric_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at, background_json, background_source)
         VALUES ('slide-1', 'presentation-1', NULL, NULL, NULL, NULL, NULL, NULL, 'presentation', 1920, 1080, '', 0, '2026-01-01', '2026-01-01', NULL, 'local')`
      ).run();

      const migration = MIGRATIONS.find((candidate) => candidate.version === 34);
      expect(migration).toBeDefined();
      migration!.up(db);
      db.pragma('user_version = 34');

      expect(db.pragma('user_version', { simple: true })).toBe(34);
      expect(db.prepare('SELECT tag_id FROM slides WHERE id = ?').get('slide-1')).toEqual({ tag_id: null });
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'slide_tags'").get()).toEqual({ name: 'slide_tags' });
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      db.close();
    }
  });
});
