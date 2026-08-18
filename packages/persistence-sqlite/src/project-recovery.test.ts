// #146 project recovery restore, rewritten for the #219 item-model refactor.
// Fixture mirrors the #145 maximal fixture in project-backup.test.ts (post-v27
// schema: four per-owner theme tables, no libraries/collections/groups, flat
// playlist_entries). Deliberately covers the nullable-column boundaries
// (theme_id, cue_id, color_key, loop_count, source_id, background_source,
// empty notes) and managed-media references only (cast-media:// srcs; no
// media files are ever created).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IPC, PROJECT_BACKUP_FORMAT } from '@lumacast/protocol';
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
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir, seed: false });
}

function siblingFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((name) => name !== '.DS_Store');
}

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T01:00:00.000Z';
const T2 = '2026-01-01T02:00:00.000Z';
const T3 = '2026-01-01T03:00:00.000Z';
const T4 = '2026-01-01T04:00:00.000Z';

const PTHEME_BACKGROUND = { type: 'color', color: '#101820' } as const;
const LTHEME_BACKGROUND = { type: 'image', mediaAssetId: 'image-2', src: 'cast-media://image-2', fit: 'cover' };
const GRADIENT_BACKGROUND = {
  type: 'gradient',
  gradient: { kind: 'linear', angle: 45, stops: [{ color: '#000000', position: 0 }, { color: '#FFFFFF', position: 100 }] },
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
    DELETE FROM playlists;
    DELETE FROM slides;
    DELETE FROM overlays;
    DELETE FROM stages;
    DELETE FROM presentation_themes;
    DELETE FROM lyric_themes;
    DELETE FROM talk_themes;
    DELETE FROM overlay_themes;
    DELETE FROM presentations;
    DELETE FROM lyrics;
    DELETE FROM talks;
    DELETE FROM image_assets;
    DELETE FROM video_assets;
    DELETE FROM audio_assets;
  `);
}

function seedMaximalFixture(db: SqliteDatabase): void {
  clearAllTables(db);

  db.prepare('INSERT INTO presentation_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('ptheme-1', 'Brand', 1920, 1080, 0, T0, T1);
  db.prepare('INSERT INTO lyric_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('ltheme-1', 'Song Background', 1920, 1080, 0, T1, T1);

  db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pres-1', 'Announcements', 'ptheme-1', 0, T0, T0);
  db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pres-2', 'Welcome', null, 1, T1, T1);
  db.prepare('INSERT INTO lyrics (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('lyric-1', 'Great Is Thy Faithfulness', 'ltheme-1', 0, T0, T0);
  db.prepare('INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('talk-1', 'Sunday Sermon', null, 0, T0, T0);

  db.prepare('INSERT INTO overlays (id, name, enabled, animation_json, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('overlay-1', 'Watermark', 1, JSON.stringify({ kind: 'dissolve', durationMs: 500 }), 0, T0, T0);

  db.prepare('INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('stage-1', 'Audience', 1920, 1080, 0, T0, T0);
  db.prepare('INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('stage-2', 'Stage Left', 1920, 1080, 1, T1, T1);

  db.prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('pl-1', 'Sunday Service', 0, T0, T0);
  db.prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('pl-2', 'Archive', 1, T2, T2);

  const insertSlide = db.prepare(
    `INSERT INTO slides
       (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSlide.run('ptheme-1:slide', null, null, null, 'ptheme-1', null, null, null, null, null, 'presentationTheme', 1920, 1080, '', JSON.stringify(PTHEME_BACKGROUND), null, 0, T0, T0);
  insertSlide.run('ltheme-1:slide', null, null, null, null, 'ltheme-1', null, null, null, null, 'lyricTheme', 1920, 1080, '', JSON.stringify(LTHEME_BACKGROUND), 'local', 0, T1, T1);
  insertSlide.run('overlay-1:slide', null, null, null, null, null, null, null, 'overlay-1', null, 'overlay', 1920, 1080, '', JSON.stringify(LTHEME_BACKGROUND), 'local', 0, T2, T2);
  insertSlide.run('stage-1:slide', null, null, null, null, null, null, null, null, 'stage-1', 'stage', 1920, 1080, '', null, 'local', 0, T3, T3);
  insertSlide.run('slide-pres-1', 'pres-1', null, null, null, null, null, null, null, null, 'presentation', 1920, 1080, 'Announcement intro', JSON.stringify(PTHEME_BACKGROUND), 'theme', 0, T4, T4);
  insertSlide.run('slide-pres-2', 'pres-1', null, null, null, null, null, null, null, null, 'presentation', 1920, 1080, '', JSON.stringify(GRADIENT_BACKGROUND), 'local', 1, T4, T4);
  insertSlide.run('slide-lyric-1', null, 'lyric-1', null, null, null, null, null, null, null, 'lyric', 1920, 1080, '', JSON.stringify(LTHEME_BACKGROUND), 'theme', 0, T4, T4);
  insertSlide.run('slide-talk-1', null, null, 'talk-1', null, null, null, null, null, null, 'talk', 1920, 1080, '', null, 'local', 0, T4, T4);

  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('sep-1', 'pl-1', 'separator', null, null, null, 'Opening', 'blue', 0, T0, T0);
  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-1', 'pl-1', 'item', 'pres-1', null, null, null, null, 1, T1, T1);
  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-2', 'pl-1', 'item', null, 'lyric-1', null, null, null, 2, T2, T2);
  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-3', 'pl-2', 'item', null, null, 'talk-1', null, null, 0, T2, T2);

  db.prepare('INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('block-1', 'slide-talk-1', 'Welcome everyone', 0, T0, T0);
  db.prepare('INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('block-2', 'slide-talk-1', 'Then we pray', 1, T1, T1);

  db.prepare('INSERT INTO image_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('image-1', 'Logo', 'cast-media://image-1', 0, T0, T0);
  db.prepare('INSERT INTO image_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('image-2', 'Backdrop', 'cast-media://image-2', 1, T1, T1);
  db.prepare('INSERT INTO video_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('video-1', 'Intro', 'cast-media://video-1', 0, T0, T0);
  db.prepare('INSERT INTO audio_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('audio-1', 'Sting', 'cast-media://audio-1', 0, T0, T0);

  const insertElement = db.prepare(
    `INSERT INTO slide_elements
       (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertElement.run('t-elem-1', 'ptheme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(TEXT_PAYLOAD), null, T0, T0);
  insertElement.run('t-elem-2', 'ltheme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(TEXT_PAYLOAD), null, T1, T1);
  insertElement.run('elem-pres-1', 'slide-pres-1', 'text', 100, 200, 800, 60, 0, 1, 10, 'content', JSON.stringify(TEXT_PAYLOAD), 't-elem-1', T0, T0);
  insertElement.run('elem-pres-2', 'slide-pres-1', 'image', 10, 10, 200, 200, 0, 0.8, 5, 'media', JSON.stringify(IMAGE_PAYLOAD), null, T1, T1);
  insertElement.run('elem-pres-3', 'slide-pres-2', 'shape', 0, 0, 1920, 1080, 0, 1, 1, 'background', JSON.stringify({ fillColor: '#101820CC' }), null, T2, T2);
  insertElement.run('elem-lyric-1', 'slide-lyric-1', 'text', 100, 100, 900, 60, 0, 1, 10, 'content', JSON.stringify(TEXT_PAYLOAD), 't-elem-2', T3, T3);
  insertElement.run('elem-talk-1', 'slide-talk-1', 'video', 0, 0, 800, 450, 0, 1, 5, 'media', JSON.stringify(VIDEO_PAYLOAD), null, T4, T4);

  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-1', 'overlay.activate', JSON.stringify(CUE_1_PAYLOAD), 'continue', T0, T0);
  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-2', 'mediaLayer.set', JSON.stringify(CUE_2_PAYLOAD), 'abort', T1, T1);
  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-3', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', T2, T2);

  db.prepare(
    `INSERT INTO actions (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('macro-1', 'Run Service Cues', 'Auto-advance service', 'global', 'cancel', 0, null, 0, T0, T0);
  db.prepare(
    `INSERT INTO actions (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('macro-2', 'Slide Loop', 'Loop the slide', 'slide', 'revert', 1, 3, 1, T1, T1);

  db.prepare(
    `INSERT INTO action_steps (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-1', 'macro-1', 'overlay.activate', JSON.stringify(CUE_1_PAYLOAD), 'continue', 'cue-1', 0, 0, 250, T0, T0);
  db.prepare(
    `INSERT INTO action_steps (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-2', 'macro-1', 'mediaLayer.set', JSON.stringify(CUE_2_PAYLOAD), 'abort', 'cue-2', 1, 500, 0, T1, T1);
  db.prepare(
    `INSERT INTO action_steps (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-3', 'macro-2', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', null, 1, 100, 100, T2, T2);

  db.prepare(
    `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-1', 'slide.take', null, 'macro', 'macro-1', JSON.stringify(BINDING_1_CONFIG), 1, T0, T0);
  db.prepare(
    `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-2', 'slide.activate', 'slide-pres-1', 'cue', 'cue-3', '{}', 0, T1, T1);
  db.prepare(
    `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
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

describe('project recovery restore (#146, backup v2)', () => {
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

  it('round trips byte-for-byte at schema version 28: re-exporting the promoted project reproduces the exact source document', () => {
    const backup = repo.exportProjectBackup();
    expect(backup.schemaVersion).toBe(28);

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

    it('rejects a v1/schema-22 backup with the explicit "older app version" message, before any database work', () => {
      const before = repo.getSnapshot();
      const legacyBackup = {
        format: PROJECT_BACKUP_FORMAT,
        version: 1,
        schemaVersion: 22,
        tables: {},
      } as unknown as ProjectBackup;

      expect(() => repo.restoreProjectBackup(legacyBackup)).toThrow(/older app version/);
      expect(repo.getSnapshot()).toEqual(before);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('prerecovery').test(name))).toEqual([]);
      expect(siblingFiles(tmpDir).filter((name) => restoreSiblingPattern('restore').test(name))).toEqual([]);
    });

    it('rejects an unsupported document schema version before any database work', () => {
      const backup = repo.exportProjectBackup();
      expectUntouchedActive(() =>
        repo.restoreProjectBackup({ ...backup, schemaVersion: 23 } as unknown as ProjectBackup),
      );
    });

    it('rejects a hard FK reference to a missing parent (playlist entry -> playlist)', () => {
      const backup = mutateBackup(repo.exportProjectBackup(), (tables) => {
        tables.playlist_entries[0].playlist_id = 'ghost-playlist';
      });
      expectUntouchedActive(() => repo.restoreProjectBackup(backup));
    });

    it('rejects an optional reference to a missing theme (presentations.theme_id)', () => {
      const backup = mutateBackup(repo.exportProjectBackup(), (tables) => {
        tables.presentations[0].theme_id = 'ghost-theme';
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
          // The hard FK on playlist_entries.playlist_id is enforced only
          // while foreign_keys is ON; flip it off, corrupt a real FK value,
          // then re-enable so the restore's own row-count check still
          // passes (the update changes one row, not the row count) and only
          // the foreign_key_check gate can catch the dangling reference.
          db.pragma('foreign_keys = OFF');
          const result = db.prepare("UPDATE playlist_entries SET playlist_id = 'ghost-playlist' WHERE id = 'entry-1'").run();
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
      expect(repo.getSnapshot().playlists).toHaveLength(2);
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
      expect(repo.getSnapshot().playlists).toHaveLength(2);
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

      const patch = repo.renamePlaylist('pl-1', 'Renamed After Rollback');
      expect(patch).toBeDefined();
      expect(repo.getSnapshot().playlists.some((playlist) => playlist.name === 'Renamed After Rollback')).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Legacy (v1) project backup import (#219 item-model refactor, wave K).
// A real v1/schema-22 document -- libraries, the eight per-bin collection
// tables, one kind-tagged `themes` table, `playlist_groups` -- is no longer
// rejected. `restoreProjectBackup` materializes it at schema 22, replays the
// real migrations 23-27, and restores the result through the ordinary v2
// path. `theme-1` (kind 'slides') is referenced by BOTH `pres-1` and
// `talk-1`, exercising the talk-theme clone (decision D2); `group-2` is
// empty, exercising "every group yields a separator, including an empty
// one" (decision D5); item-entry ids are preserved, separator ids are not.
// ---------------------------------------------------------------------------

const LEGACY_T0 = '2025-01-01T00:00:00.000Z';

function buildLegacyProjectBackupV1(): ProjectBackup {
  const row = (overrides: Record<string, unknown> = {}) => ({ created_at: LEGACY_T0, updated_at: LEGACY_T0, ...overrides });
  return {
    format: PROJECT_BACKUP_FORMAT,
    version: 1,
    schemaVersion: 22,
    tables: {
      libraries: [row({ id: 'lib-1', name: 'Main', order_index: 0 })],
      deck_collections: [row({ id: 'dc-1', name: 'Default', order_index: 0, is_default: 1 })],
      image_collections: [row({ id: 'ic-1', name: 'Default', order_index: 0, is_default: 1 })],
      video_collections: [row({ id: 'vc-1', name: 'Default', order_index: 0, is_default: 1 })],
      audio_collections: [row({ id: 'ac-1', name: 'Default', order_index: 0, is_default: 1 })],
      theme_collections: [row({ id: 'tc-1', name: 'Default', order_index: 0, is_default: 1 })],
      overlay_collections: [row({ id: 'oc-1', name: 'Default', order_index: 0, is_default: 1 })],
      stage_collections: [row({ id: 'sc-1', name: 'Default', order_index: 0, is_default: 1 })],
      macro_collections: [row({ id: 'mc-1', name: 'Default', order_index: 0, is_default: 1 })],
      themes: [
        row({ id: 'theme-1', name: 'Brand', kind: 'slides', width: 1920, height: 1080, order_index: 0, collection_id: 'tc-1' }),
        row({ id: 'theme-2', name: 'Song Background', kind: 'lyrics', width: 1920, height: 1080, order_index: 1, collection_id: 'tc-1' }),
      ],
      presentations: [row({ id: 'pres-1', title: 'Slides', theme_id: 'theme-1', collection_id: 'dc-1', order_index: 0 })],
      lyrics: [row({ id: 'lyric-1', title: 'Song', theme_id: 'theme-2', collection_id: 'dc-1', order_index: 0 })],
      talks: [row({ id: 'talk-1', title: 'Sermon', theme_id: 'theme-1', collection_id: 'dc-1', order_index: 0 })],
      slides: [
        row({ id: 'theme-1:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: 'theme-1', overlay_id: null, stage_id: null, kind: 'theme', width: 1920, height: 1080, notes: '', background_json: null, background_source: null, order_index: 0 }),
        row({ id: 'theme-2:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: 'theme-2', overlay_id: null, stage_id: null, kind: 'theme', width: 1920, height: 1080, notes: '', background_json: null, background_source: null, order_index: 0 }),
        row({ id: 'slide-pres-1', presentation_id: 'pres-1', lyric_id: null, talk_id: null, theme_id: null, overlay_id: null, stage_id: null, kind: 'presentation', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'theme', order_index: 0 }),
        row({ id: 'slide-lyric-1', presentation_id: null, lyric_id: 'lyric-1', talk_id: null, theme_id: null, overlay_id: null, stage_id: null, kind: 'lyric', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'theme', order_index: 0 }),
        row({ id: 'slide-talk-1', presentation_id: null, lyric_id: null, talk_id: 'talk-1', theme_id: null, overlay_id: null, stage_id: null, kind: 'talk', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'theme', order_index: 0 }),
      ],
      slide_elements: [],
      talk_script_blocks: [],
      playlists: [row({ id: 'pl-1', library_id: 'lib-1', name: 'Sunday Service', order_index: 0 })],
      playlist_groups: [
        row({ id: 'group-1', playlist_id: 'pl-1', name: 'Opening', color_key: 'blue', order_index: 0 }),
        row({ id: 'group-2', playlist_id: 'pl-1', name: 'Closing', color_key: null, order_index: 1 }),
      ],
      playlist_entries: [
        row({ id: 'entry-1', group_id: 'group-1', presentation_id: 'pres-1', lyric_id: null, talk_id: null, order_index: 0 }),
        row({ id: 'entry-2', group_id: 'group-1', presentation_id: null, lyric_id: 'lyric-1', talk_id: null, order_index: 1 }),
        row({ id: 'entry-3', group_id: 'group-1', presentation_id: null, lyric_id: null, talk_id: 'talk-1', order_index: 2 }),
      ],
      image_assets: [],
      video_assets: [],
      audio_assets: [],
      overlays: [],
      stages: [],
      cues: [],
      actions: [row({ id: 'action-1', name: 'Advance', description: '', collection_id: 'mc-1', scope_level: 'deckItem', on_scope_exit: 'cancel', loop_enabled: 0, loop_count: null })],
      action_steps: [],
      trigger_bindings: [],
    },
  } as unknown as ProjectBackup;
}

describe('legacy (v1) project backup import (#219 item-model refactor, wave K)', () => {
  let legacyRepo: CastRepository;
  let legacyTmpDir: string;

  beforeEach(() => {
    legacyTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-legacy-recovery-'));
    legacyRepo = makeRepo(legacyTmpDir);
  });

  afterEach(() => {
    closeRepo(legacyRepo);
    fs.rmSync(legacyTmpDir, { recursive: true, force: true });
  });

  it('restores a v1/schema-22 backup: separators synthesized in order, item-entry ids preserved, and a talk-theme clone', () => {
    const legacy = buildLegacyProjectBackupV1();

    const result = legacyRepo.restoreProjectBackup(legacy);
    const snapshot = result.snapshot;

    expect(snapshot.presentations).toHaveLength(1);
    expect(snapshot.lyrics).toHaveLength(1);
    expect(snapshot.talks).toHaveLength(1);

    const presentation = snapshot.presentations[0]!;
    const talk = snapshot.talks[0]!;
    const lyric = snapshot.lyrics[0]!;
    expect(presentation.themeId).not.toBeNull();
    expect(talk.themeId).not.toBeNull();
    // Both source rows referenced the SAME v1 'slides' theme id, but a talk
    // gets a fresh talk-family clone -- never the same id as the
    // presentation's presentation-family theme.
    expect(talk.themeId).not.toBe(presentation.themeId);
    expect(snapshot.presentationThemes.some((t) => t.id === presentation.themeId)).toBe(true);
    expect(snapshot.talkThemes.some((t) => t.id === talk.themeId)).toBe(true);
    expect(snapshot.lyricThemes.some((t) => t.id === lyric.themeId)).toBe(true);

    const playlist = snapshot.playlists.find((p) => p.name === 'Sunday Service')!;
    expect(playlist).toBeTruthy();
    const rows = snapshot.playlistEntries
      .filter((entry) => entry.playlistId === playlist.id)
      .sort((left, right) => left.order - right.order);
    // group-1 (3 entries) then group-2 (empty) -- every group yields a
    // separator, including the empty one -- so 1 + 3 + 1 = 5 rows.
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ kind: 'separator', label: 'Opening', colorKey: 'blue' });
    // Item-entry ids are preserved byte-for-byte by the migration (unlike
    // bundle import, which always assigns fresh ids).
    expect(rows[1]).toMatchObject({ id: 'entry-1', kind: 'item' });
    expect(rows[2]).toMatchObject({ id: 'entry-2', kind: 'item' });
    expect(rows[3]).toMatchObject({ id: 'entry-3', kind: 'item' });
    expect(rows[4]).toMatchObject({ kind: 'separator', label: 'Closing', colorKey: null });

    // The macro scope rename (decision D6): v1 'deckItem' -> 'item'.
    const action = snapshot.macros.find((macro) => macro.name === 'Advance')!;
    expect(action.scopeLevel).toBe('item');

    // The restored database round-trips: re-exporting reproduces a valid v2
    // document at the current schema version.
    const reExported = legacyRepo.exportProjectBackup();
    expect(reExported.version).toBe(2);
    expect(reExported.schemaVersion).toBeGreaterThan(22);
  });

  it('rejects a v1 document with an unsupported legacy schema version, naming it as an older app version', () => {
    const legacy = buildLegacyProjectBackupV1();
    const wrongSchemaVersion = { ...legacy, schemaVersion: 21 } as unknown as ProjectBackup;

    expect(() => legacyRepo.restoreProjectBackup(wrongSchemaVersion)).toThrow(ProjectBackupValidationError);
    expect(() => legacyRepo.restoreProjectBackup(wrongSchemaVersion)).toThrow(/older app version/);
    expect(legacyRepo.getSnapshot().presentations).toHaveLength(0);
  });

  it('rejects a v1 document missing a required legacy table, without a partial import', () => {
    const legacy = buildLegacyProjectBackupV1();
    const missingTable = { ...legacy, tables: { ...legacy.tables } } as unknown as { tables: Record<string, unknown> };
    delete missingTable.tables.libraries;

    expect(() => legacyRepo.restoreProjectBackup(missingTable as unknown as ProjectBackup)).toThrow(/older app version/);
    expect(legacyRepo.getSnapshot().presentations).toHaveLength(0);
  });
});
