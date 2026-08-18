import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC } from '@lumacast/protocol';
import { ProjectBackupValidationError } from '@lumacast/protocol';
import type { ProjectBackup, ProjectBackupTables } from '@lumacast/protocol';
import { CastRepository, type ProjectRecoveryHooks } from './store';
import type { SqliteDatabase } from './sqlite';

let repo: CastRepository;
let tmpDir: string;

function rawDb(target: CastRepository): SqliteDatabase {
  return (target as unknown as { db: SqliteDatabase }).db;
}

function closeRepo(target: CastRepository): void {
  (target as unknown as { db: { close(): void } }).db.close();
}

function makeRepo(dir: string): CastRepository {
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir });
}

function siblingFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name !== '.DS_Store');
}

// ---------------------------------------------------------------------------
// Fixture. Mirrors the #145 maximal fixture: every application-owned v22 table
// gets a populated row set with fixed ids/timestamps, inserted directly
// through the repository's connection in FK-safe order. Deliberately covers
// the nullable-column boundaries (theme_id, cue_id, color_key, loop_count,
// source_id, background_source, empty notes) and managed-media references
// only (cast-media:// srcs; no media files are ever created).
// ---------------------------------------------------------------------------

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T01:00:00.000Z';
const T2 = '2026-01-01T02:00:00.000Z';
const T3 = '2026-01-01T03:00:00.000Z';
const T4 = '2026-01-01T04:00:00.000Z';

const THEME1_BACKGROUND = { type: 'color', color: '#101820' } as const;
const THEME2_BACKGROUND = { type: 'image', mediaAssetId: 'image-2', src: 'cast-media://image-2', fit: 'cover' };
const GRADIENT_BACKGROUND = {
  type: 'gradient',
  gradient: {
    kind: 'linear',
    angle: 45,
    stops: [
      { color: '#000000', position: 0 },
      { color: '#FFFFFF', position: 100 },
    ],
  },
};
const TEXT_PAYLOAD = { text: 'Announcements', fontFamily: 'Helvetica', fontSize: 64, color: '#FFFFFF', alignment: 'center', weight: '700' };
const IMAGE_PAYLOAD = { src: 'cast-media://image-1', name: 'Logo', visible: true };
const VIDEO_PAYLOAD = { src: 'cast-media://video-1', autoplay: true, loop: false, muted: true, playbackRate: 1 };
const CUE_1_PAYLOAD = { overlayId: 'overlay-1' };
const CUE_2_PAYLOAD = { assetId: 'video-1' };
const CUE_3_PAYLOAD = { action: 'cancel', target: '*' };
const BINDING_1_CONFIG = { runOnExit: true };

function clearAllTables(db: SqliteDatabase): void {
  db.exec(`
    DELETE FROM trigger_bindings;
    DELETE FROM action_steps;
    DELETE FROM actions;
    DELETE FROM cues;
    DELETE FROM slide_elements;
    DELETE FROM talk_script_blocks;
    DELETE FROM playlist_entries;
    DELETE FROM playlist_groups;
    DELETE FROM playlists;
    DELETE FROM slides;
    DELETE FROM overlays;
    DELETE FROM stages;
    DELETE FROM themes;
    DELETE FROM presentations;
    DELETE FROM lyrics;
    DELETE FROM talks;
    DELETE FROM image_assets;
    DELETE FROM video_assets;
    DELETE FROM audio_assets;
    DELETE FROM libraries;
    DELETE FROM deck_collections;
    DELETE FROM image_collections;
    DELETE FROM video_collections;
    DELETE FROM audio_collections;
    DELETE FROM theme_collections;
    DELETE FROM overlay_collections;
    DELETE FROM stage_collections;
    DELETE FROM macro_collections;
  `);
}

function insertCollection(
  db: SqliteDatabase,
  table: string,
  row: { id: string; name: string; order: number; isDefault: number; createdAt: string; updatedAt: string },
): void {
  db.prepare(`INSERT INTO ${table} (id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(row.id, row.name, row.order, row.isDefault, row.createdAt, row.updatedAt);
}

function seedMaximalFixture(db: SqliteDatabase): void {
  clearAllTables(db);

  insertCollection(db, 'deck_collections', { id: 'col-deck-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'deck_collections', { id: 'col-deck-2', name: 'Worship', order: 1, isDefault: 0, createdAt: T1, updatedAt: T1 });
  insertCollection(db, 'image_collections', { id: 'col-image-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'image_collections', { id: 'col-image-2', name: 'Backdrops', order: 1, isDefault: 0, createdAt: T1, updatedAt: T1 });
  insertCollection(db, 'video_collections', { id: 'col-video-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'audio_collections', { id: 'col-audio-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'theme_collections', { id: 'col-theme-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'theme_collections', { id: 'col-theme-2', name: 'Branding', order: 1, isDefault: 0, createdAt: T1, updatedAt: T1 });
  insertCollection(db, 'overlay_collections', { id: 'col-overlay-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'stage_collections', { id: 'col-stage-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'stage_collections', { id: 'col-stage-2', name: 'Stage Areas', order: 1, isDefault: 0, createdAt: T1, updatedAt: T1 });
  insertCollection(db, 'macro_collections', { id: 'col-macro-1', name: 'Default Collection', order: 0, isDefault: 1, createdAt: T0, updatedAt: T0 });
  insertCollection(db, 'macro_collections', { id: 'col-macro-2', name: 'Service Macros', order: 1, isDefault: 0, createdAt: T1, updatedAt: T1 });

  db.prepare('INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('lib-1', 'Main Library', 0, T0, T0);
  db.prepare('INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('lib-2', 'Archives', 1, T1, T2);

  db.prepare(
    'INSERT INTO themes (id, name, kind, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('theme-1', 'Brand', 'slides', 1920, 1080, 0, 'col-theme-1', T0, T1);
  db.prepare(
    'INSERT INTO themes (id, name, kind, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('theme-2', 'Song Background', 'lyrics', 1920, 1080, 1, 'col-theme-2', T1, T1);

  db.prepare(
    'INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('pres-1', 'Announcements', 'theme-1', 'col-deck-1', 0, T0, T0);
  db.prepare(
    'INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('pres-2', 'Welcome', null, 'col-deck-2', 1, T1, T1);
  db.prepare(
    'INSERT INTO lyrics (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('lyric-1', 'Great Is Thy Faithfulness', 'theme-2', 'col-deck-1', 0, T0, T0);
  db.prepare(
    'INSERT INTO talks (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('talk-1', 'Sunday Sermon', null, 'col-deck-2', 0, T0, T0);

  db.prepare(
    'INSERT INTO overlays (id, name, enabled, animation_json, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('overlay-1', 'Watermark', 1, JSON.stringify({ kind: 'dissolve', durationMs: 500 }), 'col-overlay-1', T0, T0);

  db.prepare(
    'INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('stage-1', 'Audience', 1920, 1080, 0, 'col-stage-1', T0, T0);
  db.prepare(
    'INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('stage-2', 'Stage Left', 1920, 1080, 1, 'col-stage-2', T1, T1);

  db.prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pl-1', 'lib-1', 'Sunday Service', 0, T0, T0);
  db.prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pl-2', 'lib-2', 'Archive', 0, T2, T2);

  const insertSlide = db.prepare(
    `INSERT INTO slides
       (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSlide.run('theme-1:slide', null, null, null, 'theme-1', null, null, 'theme', 1920, 1080, '', JSON.stringify(THEME1_BACKGROUND), null, 0, T0, T0);
  insertSlide.run('theme-2:slide', null, null, null, 'theme-2', null, null, 'theme', 1920, 1080, '', JSON.stringify(THEME2_BACKGROUND), 'local', 0, T1, T1);
  insertSlide.run('overlay-1:slide', null, null, null, null, 'overlay-1', null, 'overlay', 1920, 1080, '', JSON.stringify(THEME2_BACKGROUND), 'local', 0, T2, T2);
  insertSlide.run('stage-1:slide', null, null, null, null, null, 'stage-1', 'stage', 1920, 1080, '', null, 'local', 0, T3, T3);
  insertSlide.run('slide-pres-1', 'pres-1', null, null, null, null, null, 'presentation', 1920, 1080, 'Announcement intro', JSON.stringify(THEME1_BACKGROUND), 'theme', 0, T4, T4);
  insertSlide.run('slide-pres-2', 'pres-1', null, null, null, null, null, 'presentation', 1920, 1080, '', JSON.stringify(GRADIENT_BACKGROUND), 'local', 1, T4, T4);
  insertSlide.run('slide-lyric-1', null, 'lyric-1', null, null, null, null, 'lyric', 1920, 1080, '', JSON.stringify(THEME2_BACKGROUND), 'theme', 0, T4, T4);
  insertSlide.run('slide-talk-1', null, null, 'talk-1', null, null, null, 'talk', 1920, 1080, '', null, 'local', 0, T4, T4);

  db.prepare(
    'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('grp-1', 'pl-1', 'Opening', 'blue', 0, T0, T0);
  db.prepare(
    'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('grp-2', 'pl-1', 'Closing', null, 1, T1, T1);
  db.prepare(
    'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('grp-3', 'pl-2', 'All', null, 0, T2, T2);

  db.prepare(
    'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-1', 'grp-1', 'pres-1', null, null, 0, T0, T0);
  db.prepare(
    'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-2', 'grp-1', null, 'lyric-1', null, 1, T1, T1);
  db.prepare(
    'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-3', 'grp-1', null, null, 'talk-1', 2, T2, T2);

  db.prepare(
    'INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('block-1', 'slide-talk-1', 'Welcome everyone', 0, T0, T0);
  db.prepare(
    'INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('block-2', 'slide-talk-1', 'Then we pray', 1, T1, T1);

  db.prepare(
    'INSERT INTO image_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('image-1', 'Logo', 'cast-media://image-1', 'col-image-1', 0, T0, T0);
  db.prepare(
    'INSERT INTO image_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('image-2', 'Backdrop', 'cast-media://image-2', 'col-image-2', 1, T1, T1);
  db.prepare(
    'INSERT INTO video_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('video-1', 'Intro', 'cast-media://video-1', 'col-video-1', 0, T0, T0);
  db.prepare(
    'INSERT INTO audio_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('audio-1', 'Sting', 'cast-media://audio-1', 'col-audio-1', 0, T0, T0);

  const insertElement = db.prepare(
    `INSERT INTO slide_elements
       (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertElement.run('t-elem-1', 'theme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(TEXT_PAYLOAD), null, T0, T0);
  insertElement.run('t-elem-2', 'theme-2:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(TEXT_PAYLOAD), null, T1, T1);
  insertElement.run('elem-pres-1', 'slide-pres-1', 'text', 100, 200, 800, 60, 0, 1, 10, 'content', JSON.stringify(TEXT_PAYLOAD), 't-elem-1', T0, T0);
  insertElement.run('elem-pres-2', 'slide-pres-1', 'image', 10, 10, 200, 200, 0, 0.8, 5, 'media', JSON.stringify(IMAGE_PAYLOAD), null, T1, T1);
  insertElement.run('elem-pres-3', 'slide-pres-2', 'shape', 0, 0, 1920, 1080, 0, 1, 1, 'background', JSON.stringify({ fillColor: '#101820CC' }), null, T2, T2);
  insertElement.run('elem-lyric-1', 'slide-lyric-1', 'text', 100, 100, 900, 60, 0, 1, 10, 'content', JSON.stringify(TEXT_PAYLOAD), 't-elem-2', T3, T3);
  insertElement.run('elem-talk-1', 'slide-talk-1', 'video', 0, 0, 800, 450, 0, 1, 5, 'media', JSON.stringify(VIDEO_PAYLOAD), null, T4, T4);

  db.prepare(
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-1', 'overlay.activate', JSON.stringify(CUE_1_PAYLOAD), 'continue', T0, T0);
  db.prepare(
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-2', 'mediaLayer.set', JSON.stringify(CUE_2_PAYLOAD), 'abort', T1, T1);
  db.prepare(
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-3', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', T2, T2);

  db.prepare(
    `INSERT INTO actions
       (id, name, description, collection_id, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('macro-1', 'Run Service Cues', 'Auto-advance service', 'col-macro-1', 'global', 'cancel', 0, null, T0, T0);
  db.prepare(
    `INSERT INTO actions
       (id, name, description, collection_id, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('macro-2', 'Slide Loop', 'Loop the slide', 'col-macro-2', 'slide', 'revert', 1, 3, T1, T1);

  db.prepare(
    `INSERT INTO action_steps
       (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-1', 'macro-1', 'overlay.activate', JSON.stringify(CUE_1_PAYLOAD), 'continue', 'cue-1', 0, 0, 250, T0, T0);
  db.prepare(
    `INSERT INTO action_steps
       (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-2', 'macro-1', 'mediaLayer.set', JSON.stringify(CUE_2_PAYLOAD), 'abort', 'cue-2', 1, 500, 0, T1, T1);
  db.prepare(
    `INSERT INTO action_steps
       (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-3', 'macro-2', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', null, 1, 100, 100, T2, T2);

  db.prepare(
    `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-1', 'slide.take', null, 'macro', 'macro-1', JSON.stringify(BINDING_1_CONFIG), 1, T0, T0);
  db.prepare(
    `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-2', 'slide.activate', 'slide-pres-1', 'cue', 'cue-3', '{}', 0, T1, T1);
  db.prepare(
    `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-3', 'app.startup', null, 'macro', 'macro-2', '{}', 1, T2, T2);
}

function restoreSiblingPattern(marker: string): RegExp {
  return new RegExp(`^lumacast\\.sqlite\\.${marker}-.*\\.sqlite$`);
}

function mutateBackup(backup: ProjectBackup, mutate: (tables: ProjectBackupTables) => void): ProjectBackup {
  const copy: ProjectBackup = JSON.parse(JSON.stringify(backup));
  mutate(copy.tables);
  return copy;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-recovery-'));
  repo = makeRepo(tmpDir);
  seedMaximalFixture(rawDb(repo));
});

afterEach(() => {
  closeRepo(repo);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('project recovery restore (#146)', () => {
  it('promotes the restored project over the active database and retains the pre-recovery database as a same-directory sibling', () => {
    const backup = repo.exportProjectBackup();

    const result = repo.restoreProjectBackup(backup);

    expect(result.snapshot).toEqual(repo.getSnapshot());
    expect(result.retainedDatabasePath).toBe(path.join(tmpDir, path.basename(result.retainedDatabasePath)));
    expect(path.dirname(result.retainedDatabasePath)).toBe(tmpDir);
    expect(fs.existsSync(result.retainedDatabasePath)).toBe(true);
    expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toHaveLength(1);
  });

  it('round trips byte-for-byte: re-exporting the promoted project reproduces the exact source document', () => {
    const backup = repo.exportProjectBackup();

    repo.restoreProjectBackup(backup);
    const restored = repo.exportProjectBackup();

    expect(JSON.stringify(restored)).toBe(JSON.stringify(backup));
  });

  it('survives a repository reopen: the promoted file is a complete, valid project', () => {
    const backup = repo.exportProjectBackup();
    const result = repo.restoreProjectBackup(backup);

    closeRepo(repo);
    repo = makeRepo(tmpDir);

    expect(repo.getSnapshot()).toEqual(result.snapshot);
    expect(fs.existsSync(result.retainedDatabasePath)).toBe(true);
  });

  it('retains a fully recoverable pre-recovery project: the retained file opens as its own repository with the prior content', () => {
    const backup = repo.exportProjectBackup();
    const before = repo.getSnapshot();

    const result = repo.restoreProjectBackup(backup);

    const retainedRepo = new CastRepository({
      dbPath: result.retainedDatabasePath,
      userDataPath: tmpDir,
      documentsPath: tmpDir,
    });
    try {
      expect(retainedRepo.getSnapshot()).toEqual(before);
    } finally {
      closeRepo(retainedRepo);
    }
  });

  it('is exposed through a distinct IPC channel and returns a full snapshot, never a snapshot patch (not routine undo)', () => {
    expect(IPC.restoreProjectBackup).toBe('cast:restoreProjectBackup');
    expect(IPC.restoreProjectBackup).not.toBe(IPC.restoreFromSnapshot);
    expect(typeof repo.restoreProjectBackup).toBe('function');

    const result = repo.restoreProjectBackup(repo.exportProjectBackup());

    expect(result.snapshot).toBeDefined();
    expect(result.retainedDatabasePath).toBeDefined();
    expect('patch' in result).toBe(false);
  });

  it('creates the temporary restore database as a same-directory sibling before any file operation', () => {
    const backup = repo.exportProjectBackup();
    const hooks: ProjectRecoveryHooks = {
      beforePromotion() {
        const restores = siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name));
        expect(restores).toHaveLength(1);
        expect(fs.existsSync(path.join(tmpDir, 'lumacast.sqlite'))).toBe(true);
        expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toEqual([]);
      },
    };

    repo.restoreProjectBackup(backup, { hooks });
  });

  describe('rejection leaves the active database untouched', () => {
    function expectUntouchedActive(attempt: () => unknown): void {
      const before = repo.getSnapshot();
      expect(() => attempt()).toThrow(ProjectBackupValidationError);
      expect(repo.getSnapshot()).toEqual(before);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toEqual([]);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    }

    it('rejects a document the #145 codec itself rejects (unsupported format)', () => {
      const backup = repo.exportProjectBackup();
      expectUntouchedActive(() =>
        repo.restoreProjectBackup({ ...backup, format: 'cast-deck-bundle' } as unknown as ProjectBackup),
      );
    });

    it('rejects an unsupported document schema version before any database work', () => {
      const backup = repo.exportProjectBackup();
      expectUntouchedActive(() =>
        repo.restoreProjectBackup({ ...backup, schemaVersion: 23 } as unknown as ProjectBackup),
      );
    });

    it('rejects a hard FK reference to a missing parent (playlist entry -> group)', () => {
      const backup = mutateBackup(repo.exportProjectBackup(), (tables) => {
        tables.playlist_entries[0].group_id = 'ghost-group';
      });
      expectUntouchedActive(() => repo.restoreProjectBackup(backup));
    });

    it('rejects a soft reference to a missing macro collection (actions.collection_id)', () => {
      const backup = mutateBackup(repo.exportProjectBackup(), (tables) => {
        tables.actions[0].collection_id = 'ghost-collection';
      });
      expectUntouchedActive(() => repo.restoreProjectBackup(backup));
    });

    it('rejects a trigger binding whose target is missing', () => {
      const backup = mutateBackup(repo.exportProjectBackup(), (tables) => {
        tables.trigger_bindings[0].target_id = 'ghost-macro';
      });
      expectUntouchedActive(() => repo.restoreProjectBackup(backup));
    });

    it('rejects a row-count drift detected on the temporary database (afterInsert tamper)', () => {
      const backup = repo.exportProjectBackup();
      const hooks: ProjectRecoveryHooks = {
        afterInsert(db) {
          db.prepare('DELETE FROM talk_script_blocks').run();
        },
      };

      const error = (() => {
        try {
          repo.restoreProjectBackup(backup, { hooks });
        } catch (caught) {
          return caught as Error;
        }
        throw new Error('expected restore to fail');
      })();

      expect(error).toBeInstanceOf(ProjectBackupValidationError);
      expect(error.message).toMatch(/talk_script_blocks/);
      expect(repo.getSnapshot().talkScriptBlocks).toHaveLength(2);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('rejects a foreign_key_check violation on the temporary database (afterInsert tamper)', () => {
      const backup = repo.exportProjectBackup();
      const before = repo.getSnapshot();
      const hooks: ProjectRecoveryHooks = {
        afterInsert(db) {
          // The hard FK on playlists.library_id is enforced only while
          // foreign_keys is ON; flip it off, corrupt a real FK value, then
          // re-enable so the restore's own row-count check still passes (the
          // update changes one row, not the row count) and only the
          // foreign_key_check gate can catch the dangling reference.
          db.pragma('foreign_keys = OFF');
          const result = db.prepare("UPDATE playlists SET library_id = 'ghost-library' WHERE id = 'pl-1'").run();
          expect(result.changes).toBe(1);
          db.pragma('foreign_keys = ON');
        },
      };

      const error = (() => {
        try {
          repo.restoreProjectBackup(backup, { hooks });
        } catch (caught) {
          return caught as Error;
        }
        throw new Error('expected restore to fail');
      })();

      expect(error).toBeInstanceOf(ProjectBackupValidationError);
      expect(error.message).toMatch(/foreign_key_check/);
      expect(repo.getSnapshot()).toEqual(before);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('aborts before any insert when beforeInsert throws', () => {
      const backup = repo.exportProjectBackup();
      const hooks: ProjectRecoveryHooks = {
        beforeInsert() {
          throw new Error('injected beforeInsert failure');
        },
      };

      expect(() => repo.restoreProjectBackup(backup, { hooks })).toThrow(/injected beforeInsert failure/);
      expect(repo.getSnapshot().libraries).toHaveLength(2);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('aborts before validation when afterInsert throws', () => {
      const backup = repo.exportProjectBackup();
      const hooks: ProjectRecoveryHooks = {
        afterInsert() {
          throw new Error('injected afterInsert failure');
        },
      };

      expect(() => repo.restoreProjectBackup(backup, { hooks })).toThrow(/injected afterInsert failure/);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('aborts before any file operation when beforePromotion throws', () => {
      const backup = repo.exportProjectBackup();
      const hooks: ProjectRecoveryHooks = {
        beforePromotion() {
          throw new Error('injected beforePromotion failure');
        },
      };

      expect(() => repo.restoreProjectBackup(backup, { hooks })).toThrow(/injected beforePromotion failure/);
      expect(repo.getSnapshot().libraries).toHaveLength(2);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toEqual([]);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });
  });

  describe('promotion failure rolls the swap back so the previous project stays active', () => {
    it('rolls back when the afterRetainActive hook throws (mid-swap failure)', () => {
      const backup = repo.exportProjectBackup();
      const before = repo.getSnapshot();
      const hooks: ProjectRecoveryHooks = {
        afterRetainActive() {
          throw new Error('injected mid-swap failure');
        },
      };

      expect(() => repo.restoreProjectBackup(backup, { hooks })).toThrow(/injected mid-swap failure/);

      expect(repo.getSnapshot()).toEqual(before);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toEqual([]);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('rolls back when the temporary file cannot be renamed into place after the retain', () => {
      const backup = repo.exportProjectBackup();
      const before = repo.getSnapshot();
      const hooks: ProjectRecoveryHooks = {
        afterRetainActive() {
          for (const name of siblingFiles(tmpDir)) {
            if (restoreSiblingPattern('restore').test(name)) {
              fs.rmSync(path.join(tmpDir, name));
            }
          }
        },
      };

      expect(() => repo.restoreProjectBackup(backup, { hooks })).toThrow(/ENOENT|no such file/);

      expect(repo.getSnapshot()).toEqual(before);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toEqual([]);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('leaves the repository fully usable after a failed promotion', () => {
      const backup = repo.exportProjectBackup();
      const hooks: ProjectRecoveryHooks = {
        afterRetainActive() {
          throw new Error('injected mid-swap failure');
        },
      };

      expect(() => repo.restoreProjectBackup(backup, { hooks })).toThrow(/injected mid-swap failure/);

      const patch = repo.renameLibrary('lib-1', 'Renamed After Rollback');
      expect(patch).toBeDefined();
      expect(repo.getSnapshot().libraries.some((library) => library.name === 'Renamed After Rollback')).toBe(true);
    });
  });
});
