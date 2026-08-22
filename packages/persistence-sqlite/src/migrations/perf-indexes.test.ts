// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDatabase } from '../sqlite';
import { applyMigrationsThroughVersion, runMigrations } from './index';

let tempPaths: string[] = [];

function createTempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-perf-indexes-'));
  tempPaths.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  for (const dir of tempPaths) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempPaths = [];
});

function explainPlanDetails(db: SqliteDatabase, sql: string, ...args: unknown[]): string[] {
  return (
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args) as Array<{ detail: string }>
  ).map((row) => row.detail);
}

describe('migration 29 performance indexes', () => {
  it('creates the new composite indexes on a fresh schema', () => {
    const dbPath = createTempDbPath('fresh.sqlite');
    const db = new SqliteDatabase(dbPath);
    try {
      runMigrations(db, dbPath);

      const indexNames = (db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_slides_presentation_id_order_index', 'idx_slides_lyric_id_order_index', 'idx_slides_talk_id_order_index', 'idx_playlist_entries_playlist_id_order_index', 'idx_talk_script_blocks_slide_id_order_index', 'idx_slide_elements_slide_id_layer_z_index_created_at') ORDER BY name ASC"
      ).all() as Array<{ name: string }>).map((row) => row.name);

      expect(indexNames).toEqual([
        'idx_playlist_entries_playlist_id_order_index',
        'idx_slide_elements_slide_id_layer_z_index_created_at',
        'idx_slides_lyric_id_order_index',
        'idx_slides_presentation_id_order_index',
        'idx_slides_talk_id_order_index',
        'idx_talk_script_blocks_slide_id_order_index',
      ]);
    } finally {
      db.close();
    }
  });

  it('adds the indexes when upgrading an existing schema-28 database without disturbing existing rows', () => {
    const dbPath = createTempDbPath('upgrade.sqlite');
    const db = new SqliteDatabase(dbPath);
    try {
      applyMigrationsThroughVersion(db, 28);
      db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        'presentation-1',
        'Deck',
        null,
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO slides (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, background_json, background_source, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'slide-1',
        'presentation-1',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'canvas',
        1920,
        1080,
        null,
        'local',
        '',
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'element-1',
        'slide-1',
        'text',
        0,
        0,
        100,
        20,
        0,
        1,
        0,
        'content',
        JSON.stringify({ text: 'Hello', fontFamily: 'Avenir Next', fontSize: 48, color: '#FFFFFF', alignment: 'left', weight: '400' }),
        null,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );

      runMigrations(db, dbPath);

      expect(db.pragma('user_version', { simple: true })).toBe(30);
      expect(db.prepare('SELECT id FROM presentations WHERE id = ?').get('presentation-1')).toEqual({ id: 'presentation-1' });
      expect(db.prepare('SELECT id FROM slides WHERE presentation_id = ? ORDER BY order_index ASC').all('presentation-1')).toEqual([{ id: 'slide-1' }]);
      expect(db.prepare('SELECT id FROM slide_elements WHERE slide_id = ? ORDER BY layer ASC, z_index ASC, created_at ASC').all('slide-1')).toEqual([{ id: 'element-1' }]);
    } finally {
      db.close();
    }
  });

  it('uses the composite indexes for representative filter/order queries without temp sorts', () => {
    const dbPath = createTempDbPath('query-plan.sqlite');
    const db = new SqliteDatabase(dbPath);
    try {
      runMigrations(db, dbPath);

      db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        'presentation-1',
        'Deck',
        null,
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare('INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        'talk-1',
        'Talk',
        null,
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'playlist-1',
        'Service',
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO slides (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, background_json, background_source, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'slide-1',
        'presentation-1',
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        'canvas',
        1920,
        1080,
        null,
        'local',
        '',
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO slides (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, background_json, background_source, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'slide-2',
        null,
        null,
        'talk-1',
        null,
        null,
        null,
        null,
        null,
        null,
        'canvas',
        1920,
        1080,
        null,
        'local',
        '',
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'entry-1',
        'playlist-1',
        'separator',
        null,
        null,
        null,
        'Opening',
        null,
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        'block-1',
        'slide-2',
        'Welcome',
        0,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );
      db.prepare(
        'INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'element-1',
        'slide-1',
        'text',
        0,
        0,
        100,
        20,
        0,
        1,
        0,
        'content',
        JSON.stringify({ text: 'Hello', fontFamily: 'Avenir Next', fontSize: 48, color: '#FFFFFF', alignment: 'left', weight: '400' }),
        null,
        '2024-01-01T00:00:00.000Z',
        '2024-01-01T00:00:00.000Z',
      );

      const slidePlan = explainPlanDetails(
        db,
        'SELECT id FROM slides WHERE presentation_id = ? ORDER BY order_index ASC',
        'presentation-1',
      );
      expect(slidePlan.some((detail) => detail.includes('idx_slides_presentation_id_order_index'))).toBe(true);
      expect(slidePlan.some((detail) => detail.includes('USE TEMP B-TREE'))).toBe(false);

      const playlistPlan = explainPlanDetails(
        db,
        'SELECT id FROM playlist_entries WHERE playlist_id = ? ORDER BY order_index ASC',
        'playlist-1',
      );
      expect(playlistPlan.some((detail) => detail.includes('idx_playlist_entries_playlist_id_order_index'))).toBe(true);
      expect(playlistPlan.some((detail) => detail.includes('USE TEMP B-TREE'))).toBe(false);

      const talkBlockPlan = explainPlanDetails(
        db,
        'SELECT id FROM talk_script_blocks WHERE slide_id = ? ORDER BY order_index ASC',
        'slide-2',
      );
      expect(talkBlockPlan.some((detail) => detail.includes('idx_talk_script_blocks_slide_id_order_index'))).toBe(true);
      expect(talkBlockPlan.some((detail) => detail.includes('USE TEMP B-TREE'))).toBe(false);

      const slideElementPlan = explainPlanDetails(
        db,
        'SELECT id FROM slide_elements WHERE slide_id = ? ORDER BY layer ASC, z_index ASC, created_at ASC',
        'slide-1',
      );
      expect(slideElementPlan.some((detail) => detail.includes('idx_slide_elements_slide_id_layer_z_index_created_at'))).toBe(true);
      expect(slideElementPlan.some((detail) => detail.includes('USE TEMP B-TREE'))).toBe(false);
    } finally {
      db.close();
    }
  });
});
