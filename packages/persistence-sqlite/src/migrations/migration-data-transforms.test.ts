// @vitest-environment node
//
// Focused tests for the riskiest data transforms in the #219 item-model
// refactor's new migrations (v24 global-playlists, v25 playlist-separators,
// v26 per-owner-themes) — schema-equivalence.test.ts only proves these
// migrations converge to the right *shape* on an empty database; it never
// seeds rows, so it can't catch a wrong merge order, a dropped id, or a
// botched clone. These tests seed a pre-migration database by hand, apply
// exactly one migration, and assert on the resulting rows.
import { describe, expect, it } from 'vitest';
import { SqliteDatabase } from '../sqlite';
import { MIGRATIONS } from './index';

/**
 * Replay migrations 1..version (inclusive) against a fresh database, exactly
 * like the runner does — used to get a database sitting at a known
 * pre-migration shape so a single migration's `up` can be applied and
 * inspected in isolation.
 */
function materializeTo(db: SqliteDatabase, version: number): void {
  for (const migration of MIGRATIONS.filter((m) => m.version <= version)) {
    applyMigration(db, migration.version);
  }
}

/** Apply exactly one migration by version, toggling foreign_keys the same way the runner does. */
function applyMigration(db: SqliteDatabase, version: number): void {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) throw new Error(`no migration registered for version ${version}`);
  const previousForeignKeysEnabled = migration.requiresForeignKeysOff
    ? Boolean(db.pragma('foreign_keys', { simple: true }))
    : null;
  if (migration.requiresForeignKeysOff) db.pragma('foreign_keys = OFF');
  const apply = db.transaction(() => {
    migration.up(db);
    db.pragma(`user_version = ${version}`);
  });
  apply();
  if (migration.requiresForeignKeysOff) db.pragma(`foreign_keys = ${previousForeignKeysEnabled ? 'ON' : 'OFF'}`);
}

describe('v24 global-playlists — deterministic order (#219 D4)', () => {
  it('merges every library’s playlists into one dense global order (library order/time, then playlist order/time, then id), tolerating a dangling library_id', () => {
    const db = new SqliteDatabase(':memory:');
    // Off for the whole setup: these fixtures deliberately include dangling
    // references (an orphaned library_id / group_id) to exercise the
    // migration's defensive handling of exactly the FK-less relationships
    // the historical schema never enforced.
    db.pragma('foreign_keys = OFF');
    try {
      materializeTo(db, 23);

      db.exec(`
        INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES
          ('lib-a', 'Library A', 1, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
          ('lib-b', 'Library B', 0, '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z');

        INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES
          ('p1', 'lib-a', 'A First', 0, '2020-01-10T00:00:00.000Z', '2020-01-10T00:00:00.000Z'),
          ('p2', 'lib-a', 'A Second', 1, '2020-01-11T00:00:00.000Z', '2020-01-11T00:00:00.000Z'),
          ('p3', 'lib-b', 'B First', 0, '2020-01-05T00:00:00.000Z', '2020-01-05T00:00:00.000Z'),
          ('p4', 'ghost-lib', 'Orphaned', 0, '2019-01-01T00:00:00.000Z', '2019-01-01T00:00:00.000Z');
      `);

      applyMigration(db, 24);

      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='libraries'").get()).toBeUndefined();
      const columns = db.prepare('PRAGMA table_info(playlists)').all() as Array<{ name: string }>;
      expect(columns.some((c) => c.name === 'library_id')).toBe(false);

      const rows = db.prepare('SELECT id, order_index FROM playlists ORDER BY order_index ASC').all() as Array<{
        id: string;
        order_index: number;
      }>;
      // lib-b (order_index 0) sorts before lib-a (order_index 1); the
      // dangling library_id falls back to order_index 0 via COALESCE, tying
      // it with lib-b, broken by created_at (p4's 2019 predates lib-b's
      // 2020-01-02).
      expect(rows).toEqual([
        { id: 'p4', order_index: 0 },
        { id: 'p3', order_index: 1 },
        { id: 'p1', order_index: 2 },
        { id: 'p2', order_index: 3 },
      ]);
    } finally {
      db.close();
    }
  });
});

describe('v25 playlist-separators — separator synthesis (#219 D5)', () => {
  it('synthesizes one separator per group (including empty groups), preserves item entry ids, densely renumbers per playlist, and drops entries with no resolvable group', () => {
    const db = new SqliteDatabase(':memory:');
    // Off for the whole setup: these fixtures deliberately include dangling
    // references (an orphaned library_id / group_id) to exercise the
    // migration's defensive handling of exactly the FK-less relationships
    // the historical schema never enforced.
    db.pragma('foreign_keys = OFF');
    try {
      materializeTo(db, 24);

      db.exec(`
        INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES
          ('pl-1', 'Sunday Set', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
          ('pl-2', 'Solo Set', 1, '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z');

        INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES
          ('g1', 'pl-1', 'Verse', 'blue', 0, '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:01.000Z'),
          ('g2', 'pl-1', 'Bridge', NULL, 1, '2020-01-01T00:00:02.000Z', '2020-01-01T00:00:02.000Z'),
          ('g3', 'pl-2', 'Solo', 'green', 0, '2020-01-02T00:00:01.000Z', '2020-01-02T00:00:01.000Z');

        INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES
          ('e1', 'g1', 'pres-1', NULL, NULL, 0, '2020-01-01T00:01:00.000Z', '2020-01-01T00:01:00.000Z'),
          ('e2', 'g1', NULL, 'lyr-1', NULL, 1, '2020-01-01T00:02:00.000Z', '2020-01-01T00:02:00.000Z'),
          ('e4', 'g3', NULL, NULL, 'talk-1', 0, '2020-01-02T00:01:00.000Z', '2020-01-02T00:01:00.000Z'),
          ('e-orphan', 'ghost-group', 'pres-2', NULL, NULL, 0, '2020-01-03T00:00:00.000Z', '2020-01-03T00:00:00.000Z');
      `);

      applyMigration(db, 25);

      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='playlist_groups'").get()).toBeUndefined();

      const pl1Rows = db
        .prepare(
          `SELECT id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index
           FROM playlist_entries WHERE playlist_id = 'pl-1' ORDER BY order_index ASC`,
        )
        .all();
      expect(pl1Rows).toEqual([
        { id: expect.any(String), kind: 'separator', presentation_id: null, lyric_id: null, talk_id: null, label: 'Verse', color_key: 'blue', order_index: 0 },
        { id: 'e1', kind: 'item', presentation_id: 'pres-1', lyric_id: null, talk_id: null, label: null, color_key: null, order_index: 1 },
        { id: 'e2', kind: 'item', presentation_id: null, lyric_id: 'lyr-1', talk_id: null, label: null, color_key: null, order_index: 2 },
        // Bridge is empty but still yields its own separator row.
        { id: expect.any(String), kind: 'separator', presentation_id: null, lyric_id: null, talk_id: null, label: 'Bridge', color_key: null, order_index: 3 },
      ]);

      const pl2Rows = db
        .prepare(
          `SELECT id, kind, talk_id, label, color_key, order_index
           FROM playlist_entries WHERE playlist_id = 'pl-2' ORDER BY order_index ASC`,
        )
        .all();
      expect(pl2Rows).toEqual([
        { id: expect.any(String), kind: 'separator', talk_id: null, label: 'Solo', color_key: 'green', order_index: 0 },
        { id: 'e4', kind: 'item', talk_id: 'talk-1', label: null, color_key: null, order_index: 1 },
      ]);

      // The dangling-group entry has no resolvable playlist and is dropped,
      // not silently invented an owner for.
      expect(db.prepare("SELECT id FROM playlist_entries WHERE id = 'e-orphan'").get()).toBeUndefined();

      const total = (db.prepare('SELECT COUNT(*) AS n FROM playlist_entries').get() as { n: number }).n;
      expect(total).toBe(6); // 2 separators + 2 items (pl-1) + 1 separator + 1 item (pl-2)

      // CHECK constraint: an item row can't carry a label or more than one owner.
      expect(() =>
        db
          .prepare(
            `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at)
             VALUES ('bad', 'pl-1', 'item', 'pres-1', 'lyr-1', NULL, NULL, NULL, 99, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});

describe('v26 per-owner-themes — talk theme cloning + provenance remap (#219 D2)', () => {
  it('clones a talk-referenced theme once (shared by every talk that referenced it), remaps element provenance and background_source on the talk’s own slides, and leaves the original theme presentation-owned', () => {
    const db = new SqliteDatabase(':memory:');
    // Off for the whole setup: these fixtures deliberately include dangling
    // references (an orphaned library_id / group_id) to exercise the
    // migration's defensive handling of exactly the FK-less relationships
    // the historical schema never enforced.
    db.pragma('foreign_keys = OFF');
    try {
      materializeTo(db, 25);

      const themeBg = '{"type":"color","color":"#ff0000"}';
      const localBg = '{"type":"color","color":"#00ff00"}';

      db.exec(`
        INSERT INTO themes (id, name, kind, width, height, order_index, created_at, updated_at) VALUES
          ('theme-1', 'Classic', 'slides', 1920, 1080, 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

        INSERT INTO slides (id, theme_id, kind, width, height, notes, order_index, created_at, updated_at, background_json, background_source) VALUES
          ('theme-1:slide', 'theme-1', 'theme', 1920, 1080, '', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', '${themeBg}', 'theme');

        INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at) VALUES
          ('el-a', 'theme-1:slide', 'text', 0, 0, 100, 50, 0, 1, 0, 'content', '{}', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
          ('el-b', 'theme-1:slide', 'text', 0, 60, 100, 50, 0, 1, 1, 'content', '{}', '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

        INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES
          ('pres-1', 'Sunday Slides', 'theme-1', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

        INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES
          ('talk-1', 'Sermon', 'theme-1', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z'),
          ('talk-2', 'Sermon Two', 'theme-1', 1, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z');

        INSERT INTO slides (id, talk_id, kind, width, height, notes, order_index, created_at, updated_at, background_json, background_source) VALUES
          ('slide-matching', 'talk-1', 'talk', 1920, 1080, '', 0, '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z', '${themeBg}', 'theme'),
          ('slide-local', 'talk-1', 'talk', 1920, 1080, '', 1, '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z', '${localBg}', 'theme');

        INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at, source_theme_element_id) VALUES
          ('slide-matching:el-a', 'slide-matching', 'text', 0, 0, 100, 50, 0, 1, 0, 'content', '{}', '2020-01-02T00:00:00.000Z', '2020-01-02T00:00:00.000Z', 'el-a');
      `);

      applyMigration(db, 26);

      // Original theme lands, unchanged id, in presentation_themes.
      const presentationTheme = db.prepare('SELECT id, name FROM presentation_themes WHERE id = ?').get('theme-1');
      expect(presentationTheme).toEqual({ id: 'theme-1', name: 'Classic' });
      expect(db.prepare("SELECT kind, presentation_theme_id FROM slides WHERE id = 'theme-1:slide'").get()).toEqual({
        kind: 'presentationTheme',
        presentation_theme_id: 'theme-1',
      });

      // Exactly one clone exists in talk_themes, shared by both talks.
      const talkThemeRows = db.prepare('SELECT id, name FROM talk_themes').all() as Array<{ id: string; name: string }>;
      expect(talkThemeRows).toHaveLength(1);
      const clonedThemeId = talkThemeRows[0].id;
      expect(clonedThemeId).not.toBe('theme-1');
      expect(talkThemeRows[0].name).toBe('Classic');

      const talkRows = db.prepare('SELECT id, theme_id FROM talks ORDER BY id ASC').all();
      expect(talkRows).toEqual([
        { id: 'talk-1', theme_id: clonedThemeId },
        { id: 'talk-2', theme_id: clonedThemeId },
      ]);

      // The clone got its own container slide, kind rewritten to talkTheme.
      const clonedSlide = db
        .prepare('SELECT kind, talk_theme_id, background_json FROM slides WHERE id = ?')
        .get(`${clonedThemeId}:slide`) as { kind: string; talk_theme_id: string; background_json: string };
      expect(clonedSlide.kind).toBe('talkTheme');
      expect(clonedSlide.talk_theme_id).toBe(clonedThemeId);
      expect(clonedSlide.background_json).toBe(themeBg);

      // The clone's elements are brand-new ids, not el-a/el-b.
      const clonedElements = db
        .prepare('SELECT id FROM slide_elements WHERE slide_id = ?')
        .all(`${clonedThemeId}:slide`) as Array<{ id: string }>;
      expect(clonedElements).toHaveLength(2);
      const clonedElementIds = clonedElements.map((e) => e.id);
      expect(clonedElementIds).not.toContain('el-a');
      expect(clonedElementIds).not.toContain('el-b');

      // Provenance on the talk's own slide is rewritten to the new element id.
      const remapped = db
        .prepare("SELECT source_theme_element_id FROM slide_elements WHERE id = 'slide-matching:el-a'")
        .get() as { source_theme_element_id: string };
      expect(remapped.source_theme_element_id).not.toBe('el-a');
      expect(clonedElementIds).toContain(remapped.source_theme_element_id);

      // background_source recompute: matching background stays 'theme',
      // locally-overridden background flips to 'local'.
      expect(db.prepare("SELECT background_source FROM slides WHERE id = 'slide-matching'").get()).toEqual({
        background_source: 'theme',
      });
      expect(db.prepare("SELECT background_source FROM slides WHERE id = 'slide-local'").get()).toEqual({
        background_source: 'local',
      });

      // presentations.theme_id still points at the (unrenamed) original.
      expect(db.prepare("SELECT theme_id FROM presentations WHERE id = 'pres-1'").get()).toEqual({ theme_id: 'theme-1' });

      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='themes'").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
