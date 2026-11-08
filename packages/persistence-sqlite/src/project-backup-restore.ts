import { ProjectBackupValidationError, type ProjectBackup, type ProjectBackupTableKey, type ProjectBackupItemRow, type ProjectBackupThemeRow } from '@lumacast/protocol';
import type { Id } from '@lumacast/kernel';
import type { SqliteDatabase } from './sqlite';

// Backup rows -> SQLite materialization and integrity gates. Connection/file
// ownership, schema/legacy normalization, progress and promotion stay in the
// repository. Every call receives its database explicitly, including after a
// successful recovery replaces the repository's live connection.
type ThemeTableName = 'presentation_themes' | 'lyric_themes' | 'overlay_themes';
type ItemTableName = 'presentations' | 'lyrics';
const PROJECT_BACKUP_MEDIA_ASSET_TABLES = ['image_assets', 'video_assets', 'audio_assets'] as const;

const PROJECT_BACKUP_TABLE_KEYS = [
  'presentation_themes',
  'lyric_themes',
  'overlay_themes',
  'presentations',
  'lyrics',
  'slide_tags',
  'timers',
  'overlays',
  'stages',
  'slides',
  'slide_elements',
  'image_assets',
  'video_assets',
  'audio_assets',
  'playlists',
  'playlist_entries',
  'cues',
  'actions',
  'action_steps',
  'trigger_bindings',
  'playback_schedules',
] as const satisfies readonly ProjectBackupTableKey[];

function collectProjectBackupIds(rows: readonly { id: Id }[]): Set<Id> {
  return new Set(rows.map((row) => row.id));
}

function assertProjectBackupReference(
  ids: Set<Id>,
  tableName: string,
  columnName: string,
  rowId: Id,
  value: Id | null,
): void {
  if (value !== null && !ids.has(value)) {
    throw new ProjectBackupValidationError(
      `Invalid project backup: ${tableName}.${columnName} on row ${rowId} references missing id ${value}.`,
    );
  }
}

/**
 * Validates every cross-table reference the post-v27 schema requires, over
 * the backup document, before any database work.
 */
export function assertProjectBackupReferences(backup: ProjectBackup): void {
  const t = backup.tables;
  const ids = {
    presentations: collectProjectBackupIds(t.presentations),
    lyrics: collectProjectBackupIds(t.lyrics),
    slides: collectProjectBackupIds(t.slides),
    slide_tags: collectProjectBackupIds(t.slide_tags),
    slide_elements: collectProjectBackupIds(t.slide_elements),
    playlists: collectProjectBackupIds(t.playlists),
    presentation_themes: collectProjectBackupIds(t.presentation_themes),
    lyric_themes: collectProjectBackupIds(t.lyric_themes),
    overlay_themes: collectProjectBackupIds(t.overlay_themes),
    overlays: collectProjectBackupIds(t.overlays),
    stages: collectProjectBackupIds(t.stages),
    cues: collectProjectBackupIds(t.cues),
    actions: collectProjectBackupIds(t.actions),
  };

  for (const row of t.presentations) assertProjectBackupReference(ids.presentation_themes, 'presentations', 'theme_id', row.id, row.theme_id);
  for (const row of t.lyrics) assertProjectBackupReference(ids.lyric_themes, 'lyrics', 'theme_id', row.id, row.theme_id);
  for (const row of t.slides) {
    assertProjectBackupReference(ids.presentations, 'slides', 'presentation_id', row.id, row.presentation_id);
    assertProjectBackupReference(ids.lyrics, 'slides', 'lyric_id', row.id, row.lyric_id);
    assertProjectBackupReference(ids.presentation_themes, 'slides', 'presentation_theme_id', row.id, row.presentation_theme_id);
    assertProjectBackupReference(ids.lyric_themes, 'slides', 'lyric_theme_id', row.id, row.lyric_theme_id);
    assertProjectBackupReference(ids.overlay_themes, 'slides', 'overlay_theme_id', row.id, row.overlay_theme_id);
    assertProjectBackupReference(ids.overlays, 'slides', 'overlay_id', row.id, row.overlay_id);
    assertProjectBackupReference(ids.stages, 'slides', 'stage_id', row.id, row.stage_id);
    assertProjectBackupReference(ids.slide_tags, 'slides', 'tag_id', row.id, row.tag_id);
  }
  for (const row of t.slide_elements) {
    assertProjectBackupReference(ids.slides, 'slide_elements', 'slide_id', row.id, row.slide_id);
    assertProjectBackupReference(ids.slide_elements, 'slide_elements', 'source_theme_element_id', row.id, row.source_theme_element_id);
  }
  for (const row of t.playlist_entries) {
    assertProjectBackupReference(ids.playlists, 'playlist_entries', 'playlist_id', row.id, row.playlist_id);
    assertProjectBackupReference(ids.presentations, 'playlist_entries', 'presentation_id', row.id, row.presentation_id);
    assertProjectBackupReference(ids.lyrics, 'playlist_entries', 'lyric_id', row.id, row.lyric_id);
  }
  for (const row of t.action_steps) {
    assertProjectBackupReference(ids.actions, 'action_steps', 'action_id', row.id, row.action_id);
    assertProjectBackupReference(ids.cues, 'action_steps', 'cue_id', row.id, row.cue_id);
  }
  for (const row of t.trigger_bindings) {
    const targetIds = row.target_type === 'cue' ? ids.cues : ids.actions;
    assertProjectBackupReference(targetIds, 'trigger_bindings', 'target_id', row.id, row.target_id);
  }
}

/**
 * Empties every application-owned table of the (throwaway) temporary
 * database, in FK-safe child-before-parent order. Called as the first
 * statement of `insertProjectBackupRows`'s transaction.
 */
function clearProjectBackupTables(db: SqliteDatabase): void {
  db.exec(`
    DELETE FROM trigger_bindings;
    DELETE FROM action_steps;
    DELETE FROM actions;
    DELETE FROM cues;
    DELETE FROM playback_schedules;
    DELETE FROM slide_elements;
    DELETE FROM playlist_entries;
    DELETE FROM playlists;
    DELETE FROM slides;
    DELETE FROM slide_tags;
    DELETE FROM timers;
    DELETE FROM presentations;
    DELETE FROM lyrics;
    DELETE FROM overlays;
    DELETE FROM stages;
    DELETE FROM presentation_themes;
    DELETE FROM lyric_themes;
    DELETE FROM overlay_themes;
    DELETE FROM image_assets;
    DELETE FROM video_assets;
    DELETE FROM audio_assets;
  `);
}

/**
 * Inserts every row of the backup into `db` in FK-safe parent-before-child
 * order, with every column mapped explicitly. Runs in one transaction so a
 * mid-insert failure restores the pre-transaction database state.
 */
export function insertProjectBackupRows(db: SqliteDatabase, backup: ProjectBackup): void {
  const t = backup.tables;

  const tx = db.transaction(() => {
    clearProjectBackupTables(db);

    const insertThemeTable = (tableName: ThemeTableName, rows: readonly ProjectBackupThemeRow[]): void => {
      const insert = db.prepare(
        `INSERT INTO ${tableName} (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        insert.run(row.id, row.name, row.width, row.height, row.order_index, row.created_at, row.updated_at);
      }
    };
    insertThemeTable('presentation_themes', t.presentation_themes);
    insertThemeTable('lyric_themes', t.lyric_themes);
    insertThemeTable('overlay_themes', t.overlay_themes);

    const insertItemTable = (tableName: ItemTableName, rows: readonly ProjectBackupItemRow[]): void => {
      if (tableName === 'lyrics') {
        const insertLyric = db.prepare(
          'INSERT INTO lyrics (id, title, theme_id, order_index, created_at, updated_at, blank_slide_mode) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        for (const row of rows) {
          insertLyric.run(row.id, row.title, row.theme_id, row.order_index, row.created_at, row.updated_at, row.blank_slide_mode ?? 'none');
        }
        return;
      }
      const insert = db.prepare(
        `INSERT INTO ${tableName} (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        insert.run(row.id, row.title, row.theme_id, row.order_index, row.created_at, row.updated_at);
      }
    };
    insertItemTable('presentations', t.presentations);
    insertItemTable('lyrics', t.lyrics);

    const insertOverlay = db.prepare(
      'INSERT INTO overlays (id, name, enabled, animation_json, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.overlays) {
      insertOverlay.run(row.id, row.name, row.enabled, row.animation_json, row.order_index, row.created_at, row.updated_at);
    }

    const insertStage = db.prepare(
      'INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.stages) {
      insertStage.run(row.id, row.name, row.width, row.height, row.order_index, row.created_at, row.updated_at);
    }

    const insertSlideTag = db.prepare(
      'INSERT INTO slide_tags (id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.slide_tags) {
      insertSlideTag.run(row.id, row.name, row.color_key, row.order_index, row.created_at, row.updated_at);
    }

    const insertTimer = db.prepare(
      `INSERT INTO timers (id, name, kind, duration_seconds, target_time, elapsed_start_seconds, elapsed_end_seconds, allow_overrun, format, thresholds_json, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.timers) {
      insertTimer.run(
        row.id, row.name, row.kind, row.duration_seconds, row.target_time,
        row.elapsed_start_seconds, row.elapsed_end_seconds, row.allow_overrun, row.format,
        row.thresholds_json, row.order_index, row.created_at, row.updated_at,
      );
    }

    const insertSlide = db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, presentation_theme_id, lyric_theme_id, overlay_theme_id, overlay_id, stage_id, tag_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.slides) {
      insertSlide.run(
        row.id, row.presentation_id, row.lyric_id,
        row.presentation_theme_id, row.lyric_theme_id, row.overlay_theme_id,
        row.overlay_id, row.stage_id, row.tag_id, row.kind, row.width, row.height, row.notes,
        row.background_json, row.background_source, row.order_index, row.created_at, row.updated_at,
      );
    }

    const insertSlideElement = db.prepare(
      `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, theme_override_keys_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.slide_elements) {
      insertSlideElement.run(
        row.id, row.slide_id, row.type, row.x, row.y, row.width, row.height,
        row.rotation, row.opacity, row.z_index, row.layer, row.payload_json,
        row.source_theme_element_id, (row as { theme_override_keys_json?: string | null }).theme_override_keys_json ?? null,
        row.created_at, row.updated_at,
      );
    }

    for (const tableName of PROJECT_BACKUP_MEDIA_ASSET_TABLES) {
      const insertMediaAsset = db.prepare(
        `INSERT INTO ${tableName} (id, name, src, width, height, duration, codec, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of t[tableName]) {
        insertMediaAsset.run(
          row.id,
          row.name,
          row.src,
          row.width,
          row.height,
          row.duration,
          row.codec,
          row.order_index,
          row.created_at,
          row.updated_at,
        );
      }
    }

    const insertPlaylist = db.prepare(
      'INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const row of t.playlists) {
      insertPlaylist.run(row.id, row.name, row.order_index, row.created_at, row.updated_at);
    }

    const insertPlaylistEntry = db.prepare(
      `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, label, color_key, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.playlist_entries) {
      insertPlaylistEntry.run(
        row.id, row.playlist_id, row.kind, row.presentation_id, row.lyric_id,
        row.label, row.color_key, row.order_index, row.created_at, row.updated_at,
      );
    }

    const insertCue = db.prepare(
      'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.cues) {
      insertCue.run(row.id, row.kind, row.payload_json, row.failure_policy, row.created_at, row.updated_at);
    }

    const insertMacro = db.prepare(
      `INSERT INTO actions (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.actions) {
      insertMacro.run(row.id, row.name, row.description, row.scope_level, row.on_scope_exit, row.loop_enabled, row.loop_count, row.order_index, row.created_at, row.updated_at);
    }

    const insertMacroStep = db.prepare(
      `INSERT INTO action_steps (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.action_steps) {
      insertMacroStep.run(
        row.id, row.action_id, row.kind, row.payload_json, row.failure_policy, row.cue_id,
        row.order_index, row.delay_before_ms, row.delay_after_ms, row.created_at, row.updated_at,
      );
    }

    const insertTriggerBinding = db.prepare(
      `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.trigger_bindings) {
      insertTriggerBinding.run(
        row.id, row.trigger_type, row.source_id, row.target_type, row.target_id,
        row.config_json, row.enabled, row.created_at, row.updated_at,
      );
    }

    const insertPlaybackSchedule = db.prepare(
      `INSERT INTO playback_schedules (id, item_ref_json, enabled, kind, steps_json, audio_asset_id, markers_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.playback_schedules) {
      insertPlaybackSchedule.run(
        row.id, row.item_ref_json, row.enabled, row.kind, row.steps_json,
        row.audio_asset_id, row.markers_json, row.created_at, row.updated_at,
      );
    }
  });
  tx();
}

/**
 * Completeness gate before promotion: every application-owned table in the
 * temporary database must hold exactly the number of rows the backup
 * declares.
 */
export function assertProjectBackupRowCounts(db: SqliteDatabase, backup: ProjectBackup): void {
  for (const tableName of PROJECT_BACKUP_TABLE_KEYS) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
    const expected = backup.tables[tableName].length;
    if (row.count !== expected) {
      throw new ProjectBackupValidationError(
        `Invalid project backup: ${tableName} holds ${row.count} rows after restore, expected ${expected}.`,
      );
    }
  }
}

/**
 * Referential gate before promotion: `PRAGMA foreign_key_check` must report
 * zero violations on the temporary database.
 */
export function assertProjectBackupForeignKeys(db: SqliteDatabase): void {
  const violations = db.prepare('PRAGMA foreign_key_check').all() as Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;
  if (violations.length > 0) {
    const first = violations[0];
    throw new ProjectBackupValidationError(
      `Invalid project backup: PRAGMA foreign_key_check failed with ${violations.length} violation(s); first: ${first.table} references missing ${first.parent} row.`,
    );
  }
}
