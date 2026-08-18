import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_BACKUP_FORMAT,
  PROJECT_BACKUP_VERSION,
  type ProjectBackup,
  type ProjectBackupV1,
  type ProjectBackupV1Tables,
} from '@lumacast/protocol';
import { SqliteDatabase } from './sqlite';
import { applyMigrationsThroughVersion, LATEST_SCHEMA_VERSION } from './migrations';
import { buildProjectBackupTables } from './project-backup-io';

// #219 item-model refactor (wave K): the v1 project-backup import path.
//
// A v1 document was always exported at exactly schema version 22 (the last
// pre-#219 schema; see `ProjectBackupV1` in @lumacast/protocol). Rather than
// hand-writing a TypeScript transform that duplicates what migrations
// 23–27 already do — synthesizing separators from groups, splitting themes
// per owner and cloning talk themes, dropping collections/libraries, and
// renaming the macro scope — this module materializes the document through
// the REAL migrations: build a throwaway SQLite database, replay
// migrations 1–22 (the same `applyMigrationsThroughVersion` pattern
// schema-equivalence.test.ts uses to materialize a historical schema),
// insert the v1 rows verbatim, replay migrations 23..LATEST_SCHEMA_VERSION
// over them, then read the result back out with the ordinary
// `buildProjectBackupTables` query set. `CastRepository.restoreProjectBackup`
// feeds the resulting v2 document through the normal v2 restore path
// unchanged — every downstream safety net (referential integrity, row-count
// and FK verification, the recoverable file swap) applies exactly as it
// would for a live export.

const LEGACY_SCHEMA_VERSION = 22;

// Column order for each v1 table's raw INSERT. Names every column the
// frozen v22 schema declares; values come straight from the already-
// validated backup document's own row objects (`validateLegacyProjectBackup`
// checked every column's type/nullability/enum domain before this ever
// runs). Never edit to match the current schema — this describes one
// frozen historical schema, forever.
const V1_TABLE_COLUMNS: Record<keyof ProjectBackupV1Tables, readonly string[]> = {
  libraries: ['id', 'name', 'order_index', 'created_at', 'updated_at'],
  presentations: ['id', 'title', 'theme_id', 'collection_id', 'order_index', 'created_at', 'updated_at'],
  lyrics: ['id', 'title', 'theme_id', 'collection_id', 'order_index', 'created_at', 'updated_at'],
  talks: ['id', 'title', 'theme_id', 'collection_id', 'order_index', 'created_at', 'updated_at'],
  slides: [
    'id', 'presentation_id', 'lyric_id', 'talk_id', 'theme_id', 'overlay_id', 'stage_id',
    'kind', 'width', 'height', 'notes', 'background_json', 'background_source',
    'order_index', 'created_at', 'updated_at',
  ],
  slide_elements: [
    'id', 'slide_id', 'type', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'z_index',
    'layer', 'payload_json', 'source_theme_element_id', 'created_at', 'updated_at',
  ],
  talk_script_blocks: ['id', 'slide_id', 'text', 'order_index', 'created_at', 'updated_at'],
  playlists: ['id', 'library_id', 'name', 'order_index', 'created_at', 'updated_at'],
  playlist_groups: ['id', 'playlist_id', 'name', 'color_key', 'order_index', 'created_at', 'updated_at'],
  playlist_entries: ['id', 'group_id', 'presentation_id', 'lyric_id', 'talk_id', 'order_index', 'created_at', 'updated_at'],
  image_assets: ['id', 'name', 'src', 'collection_id', 'order_index', 'created_at', 'updated_at'],
  video_assets: ['id', 'name', 'src', 'collection_id', 'order_index', 'created_at', 'updated_at'],
  audio_assets: ['id', 'name', 'src', 'collection_id', 'order_index', 'created_at', 'updated_at'],
  overlays: ['id', 'name', 'enabled', 'animation_json', 'collection_id', 'created_at', 'updated_at'],
  themes: ['id', 'name', 'kind', 'width', 'height', 'order_index', 'collection_id', 'created_at', 'updated_at'],
  stages: ['id', 'name', 'width', 'height', 'order_index', 'collection_id', 'created_at', 'updated_at'],
  cues: ['id', 'kind', 'payload_json', 'failure_policy', 'created_at', 'updated_at'],
  actions: ['id', 'name', 'description', 'collection_id', 'scope_level', 'on_scope_exit', 'loop_enabled', 'loop_count', 'created_at', 'updated_at'],
  action_steps: [
    'id', 'action_id', 'kind', 'payload_json', 'failure_policy', 'cue_id',
    'order_index', 'delay_before_ms', 'delay_after_ms', 'created_at', 'updated_at',
  ],
  trigger_bindings: ['id', 'trigger_type', 'source_id', 'target_type', 'target_id', 'config_json', 'enabled', 'created_at', 'updated_at'],
  deck_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  image_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  video_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  audio_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  theme_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  overlay_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  stage_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
  macro_collections: ['id', 'name', 'order_index', 'is_default', 'created_at', 'updated_at'],
};

// Insertion order: parents before children, mirroring how a real v22
// database was built. FK enforcement is off on this throwaway connection
// (no live app ever opens it), so this ordering is for readability, not
// correctness.
const V1_TABLE_INSERT_ORDER: readonly (keyof ProjectBackupV1Tables)[] = [
  'deck_collections', 'image_collections', 'video_collections', 'audio_collections',
  'theme_collections', 'overlay_collections', 'stage_collections', 'macro_collections',
  'libraries', 'themes', 'presentations', 'lyrics', 'talks',
  'overlays', 'stages', 'image_assets', 'video_assets', 'audio_assets',
  'playlists', 'playlist_groups',
  'slides', 'slide_elements', 'talk_script_blocks', 'playlist_entries',
  'cues', 'actions', 'action_steps', 'trigger_bindings',
];

function insertLegacyRows(db: SqliteDatabase, tableName: keyof ProjectBackupV1Tables, rows: readonly Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const columns = V1_TABLE_COLUMNS[tableName];
  const placeholders = columns.map(() => '?').join(', ');
  const statement = db.prepare(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`);
  for (const row of rows) {
    statement.run(...columns.map((column) => row[column]));
  }
}

/**
 * Converts a validated v1/schema-22 project backup into a current-shape
 * (format version 2, schema version `LATEST_SCHEMA_VERSION`) document. See
 * the module comment above for the full strategy: zero duplicated
 * migration-transform logic, only the real migrations 23+ replayed over a
 * throwaway database.
 */
export function migrateLegacyProjectBackup(legacy: ProjectBackupV1): ProjectBackup {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-legacy-backup-'));
  const tmpPath = path.join(tmpDir, 'legacy.sqlite');
  let db: SqliteDatabase | undefined;
  try {
    db = new SqliteDatabase(tmpPath);
    applyMigrationsThroughVersion(db, LEGACY_SCHEMA_VERSION);

    const insertAll = db.transaction(() => {
      for (const tableName of V1_TABLE_INSERT_ORDER) {
        insertLegacyRows(db!, tableName, legacy.tables[tableName] as unknown as Record<string, unknown>[]);
      }
    });
    insertAll();

    applyMigrationsThroughVersion(db, LATEST_SCHEMA_VERSION);

    const schemaVersion = db.pragma('user_version', { simple: true }) as number;
    return {
      format: PROJECT_BACKUP_FORMAT,
      version: PROJECT_BACKUP_VERSION,
      schemaVersion,
      tables: buildProjectBackupTables(db),
    };
  } finally {
    db?.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
