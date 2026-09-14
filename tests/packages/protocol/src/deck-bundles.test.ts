import { describe, expect, it, vi } from 'vitest';
import type { ProjectBackup, ProjectBackupTables } from '../../../../packages/protocol/src/project-backup';
import {
  PROJECT_BACKUP_FORMAT,
  PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
  PROJECT_BACKUP_VERSION,
  validateProjectBackup,
  validateProjectBackupAsync,
} from '../../../../packages/protocol/src/deck-bundles';

function makeBackup(playlists: ProjectBackupTables['playlists'] = []): ProjectBackup {
  return {
    format: PROJECT_BACKUP_FORMAT,
    version: PROJECT_BACKUP_VERSION,
    schemaVersion: PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
    tables: {
      presentations: [],
      lyrics: [],
      slides: [],
      slide_elements: [],
      slide_tags: [],
      playlists,
      playlist_entries: [],
      image_assets: [],
      video_assets: [],
      audio_assets: [],
      overlays: [],
      presentation_themes: [],
      lyric_themes: [],
      overlay_themes: [],
      stages: [],
      cues: [],
      actions: [],
      action_steps: [],
      trigger_bindings: [],
      playback_schedules: [],
    },
  };
}

function makePlaylistRow(index: number): ProjectBackupTables['playlists'][number] {
  return {
    id: `playlist-${index}`,
    name: `Playlist ${index}`,
    order_index: index,
    created_at: '2026-08-22T00:00:00.000Z',
    updated_at: '2026-08-22T00:00:00.000Z',
  };
}

describe('validateProjectBackupAsync', () => {
  it('returns the original valid backup object', async () => {
    const backup = makeBackup([makePlaylistRow(0)]);

    await expect(validateProjectBackupAsync(backup)).resolves.toBe(backup);
  });

  it('normalizes a pre-tag v3/schema-33 backup with empty tags and null slide assignments', async () => {
    const backup = makeBackup();
    backup.tables.slides.push({
      id: 'slide-1',
      presentation_id: 'presentation-1',
      lyric_id: null,
      presentation_theme_id: null,
      lyric_theme_id: null,
      overlay_theme_id: null,
      overlay_id: null,
      stage_id: null,
      tag_id: null,
      kind: 'presentation',
      width: 1920,
      height: 1080,
      notes: '',
      background_json: null,
      background_source: null,
      order_index: 0,
      created_at: '2026-08-22T00:00:00.000Z',
      updated_at: '2026-08-22T00:00:00.000Z',
    });
    const legacyTables = JSON.parse(JSON.stringify(backup.tables)) as Record<string, unknown>;
    delete legacyTables.slide_tags;
    legacyTables.slides = (legacyTables.slides as Array<Record<string, unknown>>).map(({ tag_id: _tagId, ...slide }) => slide);
    const legacy = { ...backup, schemaVersion: 33, tables: legacyTables };

    const normalized = validateProjectBackup(legacy);
    await expect(validateProjectBackupAsync(legacy)).resolves.toEqual(normalized);
    expect(normalized.schemaVersion).toBe(PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION);
    expect(normalized.tables.slide_tags).toEqual([]);
    expect(normalized.tables.slides[0].tag_id).toBeNull();
  });

  it('normalizes a schema-34 lyric to no runtime blank slides', () => {
    const backup = makeBackup();
    const lyric = {
      id: 'lyric-1', title: 'Song', theme_id: null, order_index: 0,
      created_at: '2026-08-22T00:00:00.000Z', updated_at: '2026-08-22T00:00:00.000Z',
    };
    const legacy = {
      ...backup,
      schemaVersion: 34,
      tables: { ...backup.tables, lyrics: [lyric] },
    };

    expect(validateProjectBackup(legacy).tables.lyrics[0]?.blank_slide_mode).toBe('none');
  });

  it('rejects a malformed row with the synchronous validator message', async () => {
    const backup = makeBackup([
      { ...makePlaylistRow(0), order_index: 'zero' } as unknown as ProjectBackupTables['playlists'][number],
    ]);
    const expectedMessage =
      'Invalid project backup: tables.playlists[0].order_index must be a finite number, got "zero".';

    expect(() => validateProjectBackup(backup)).toThrow(expectedMessage);
    await expect(validateProjectBackupAsync(backup)).rejects.toThrow(expectedMessage);
  });

  it('preserves synchronous first-error ordering when multiple tables are malformed', async () => {
    const backup = makeBackup();
    const malformed = {
      ...backup,
      tables: {
        ...backup.tables,
        presentations: [null],
        lyrics: 'not-an-array',
      },
    };
    const expectedMessage = 'Invalid project backup: tables.presentations[0] must be a row object.';

    expect(() => validateProjectBackup(malformed)).toThrow(expectedMessage);
    await expect(validateProjectBackupAsync(malformed)).rejects.toThrow(expectedMessage);
  });

  it('does not report completion before slide owner validation succeeds', async () => {
    const backup = makeBackup();
    backup.tables.slides.push({
      id: 'slide-1',
      presentation_id: null,
      lyric_id: null,
      presentation_theme_id: null,
      lyric_theme_id: null,
      overlay_theme_id: null,
      overlay_id: null,
      stage_id: null,
      tag_id: null,
      kind: 'presentation',
      width: 1920,
      height: 1080,
      notes: '',
      background_json: null,
      background_source: null,
      order_index: 0,
      created_at: '2026-08-22T00:00:00.000Z',
      updated_at: '2026-08-22T00:00:00.000Z',
    });
    const progress: Array<{ validatedRows: number; totalRows: number }> = [];

    await expect(validateProjectBackupAsync(backup, {
      onProgress: (update) => progress.push(update),
    })).rejects.toThrow('Invalid project backup: tables.slides[0] must have exactly one owner id');
    expect(progress).toEqual([]);
  });

  it('yields and reports progress between bounded batches', async () => {
    const backup = makeBackup(Array.from({ length: 7 }, (_, index) => makePlaylistRow(index)));
    const progress: Array<{ validatedRows: number; totalRows: number }> = [];
    let yieldCount = 0;

    await validateProjectBackupAsync(backup, {
      batchSize: 2,
      onProgress: (update) => progress.push(update),
      yieldToEventLoop: async () => {
        yieldCount += 1;
      },
    });

    expect(yieldCount).toBe(3);
    expect(progress).toEqual([
      { validatedRows: 2, totalRows: 7 },
      { validatedRows: 4, totalRows: 7 },
      { validatedRows: 6, totalRows: 7 },
      { validatedRows: 7, totalRows: 7 },
    ]);
  });

  it('does not let a progress observer change validation semantics', async () => {
    const backup = makeBackup(Array.from({ length: 3 }, (_, index) => makePlaylistRow(index)));
    const observer = vi.fn(() => { throw new Error('observer failed'); });

    await expect(validateProjectBackupAsync(backup, {
      batchSize: 1,
      onProgress: observer,
      yieldToEventLoop: async () => undefined,
    })).resolves.toBe(backup);
    expect(observer).toHaveBeenCalled();
  });
});


it('rejects structurally invalid schedule JSON before restoring a backup', async () => {
  const backup = makeBackup();
  backup.tables.playback_schedules.push({
    id: 'timing:presentation:p', item_ref_json: JSON.stringify({ type: 'presentation', id: 'p' }),
    enabled: 1, kind: 'slide-timing', steps_json: JSON.stringify([{ slideId: 's', durationMs: -1 }]),
    audio_asset_id: null, markers_json: null, created_at: 'now', updated_at: 'now',
  });
  expect(() => validateProjectBackup(backup)).toThrow(/durationMs/);
  await expect(validateProjectBackupAsync(backup)).rejects.toThrow(/durationMs/);
});
