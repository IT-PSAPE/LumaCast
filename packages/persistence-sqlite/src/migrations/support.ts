import type { SqliteDatabase } from '../sqlite';
import type { SlideElement, SlideElementPayload } from '@lumacast/composition';
import type { CueKind } from '@lumacast/automation';

// Deliberately independent of `@core/utils` — the migrations module operates
// on a raw SQLite handle only and must stay runnable outside the app's
// module-alias/bundler setup (see fixture generation tooling).
export const createId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();

export const DEFAULT_W = 1920;
export const DEFAULT_H = 1080;

export const DEFAULT_COLLECTION_NAME = 'Default Collection';

// #219 item-model refactor decision D3: collections are destroyed everywhere
// — `@lumacast/composition` no longer exports this type. Migrations v9/v10/
// v11/v17 still need the bin-kind vocabulary to replay unchanged for old
// databases, so this is a local, frozen-in-place copy rather than a shared
// import; it must never grow new bin kinds, only stay exactly as historical
// as the migrations that depend on it.
export type CollectionBinKind = 'deck' | 'image' | 'video' | 'audio' | 'theme' | 'overlay' | 'stage' | 'macro';

export const COLLECTION_BIN_KINDS: readonly CollectionBinKind[] = [
  'deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage', 'macro',
];

export const COLLECTION_TABLE_BY_BIN: Record<CollectionBinKind, string> = {
  deck: 'deck_collections',
  image: 'image_collections',
  video: 'video_collections',
  audio: 'audio_collections',
  theme: 'theme_collections',
  overlay: 'overlay_collections',
  stage: 'stage_collections',
  macro: 'macro_collections',
};

export function hasTable(db: SqliteDatabase, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return row?.name === name;
}

export function hasColumn(db: SqliteDatabase, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

export function tableHasForeignKeyOn(db: SqliteDatabase, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string }>;
  return rows.some((row) => row.from === column);
}

export function slidesHasCheckConstraint(db: SqliteDatabase): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'slides'")
    .get() as { sql: string } | undefined;
  return row?.sql?.includes('CHECK (') ?? false;
}

export function renameTableIfNeeded(db: SqliteDatabase, from: string, to: string): void {
  if (!hasTable(db, from) || hasTable(db, to)) return;
  db.exec(`ALTER TABLE ${from} RENAME TO ${to};`);
}

export function renameColumnIfNeeded(db: SqliteDatabase, table: string, from: string, to: string): void {
  if (!hasTable(db, table) || !hasColumn(db, table, from) || hasColumn(db, table, to)) return;
  db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to};`);
}

export const parseJson = <T>(value: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('[DB migrations] Failed to parse JSON:', error, value.slice(0, 200));
    throw new Error(`Corrupted JSON data in database: ${(error as Error).message}`);
  }
};

/**
 * Synthesize a single SlideElement from the cached pre-v11 overlay summary
 * columns. Mirrors the runtime fallback that `overlayToLayerElements` used
 * to do, so dropping the cache columns during the v11 migration doesn't
 * silently blank a legacy overlay whose `elements_json` was never populated.
 */
export function legacyOverlayElement(row: {
  id: string;
  type: 'text' | 'image' | 'video' | 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  z_index: number;
  payload_json: string;
  created_at: string;
  updated_at: string;
}): SlideElement {
  return {
    id: row.id,
    slideId: row.id,
    type: row.type === 'shape' ? 'shape' : row.type === 'text' ? 'text' : row.type === 'video' ? 'video' : 'image',
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: 0,
    opacity: row.opacity,
    zIndex: row.z_index,
    layer: 'content',
    payload: parseJson<SlideElementPayload>(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function defaultCueName(kind: CueKind): string {
  switch (kind) {
    case 'overlay.activate': return 'Activate overlay';
    case 'overlay.clear': return 'Clear overlay';
    case 'overlay.clearAll': return 'Clear all overlays';
    case 'mediaLayer.set': return 'Set media layer';
    case 'video.arm': return 'Arm video';
    case 'video.clear': return 'Clear video';
    case 'audio.arm': return 'Arm audio';
    case 'audio.clear': return 'Clear audio';
    case 'stage.set': return 'Set stage';
    case 'stage.clear': return 'Clear stage';
    case 'layer.clear': return 'Clear layer';
    case 'layer.clearAll': return 'Clear all layers';
    case 'flow.lifecycle': return 'Lifecycle control';
  }
}

/** Indexes shared by the pre-v12 (`playlist_segments`/`segment_id`) shape. */
export function createCommonIndexes(db: SqliteDatabase): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_slides_presentation_id ON slides(presentation_id);
    CREATE INDEX IF NOT EXISTS idx_slides_lyric_id ON slides(lyric_id);
    CREATE INDEX IF NOT EXISTS idx_slide_elements_slide_id ON slide_elements(slide_id);
    CREATE INDEX IF NOT EXISTS idx_playlists_library_id ON playlists(library_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_segments_playlist_id ON playlist_segments(playlist_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_entries_segment_id ON playlist_entries(segment_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_entries_presentation_id ON playlist_entries(presentation_id);
    CREATE INDEX IF NOT EXISTS idx_playlist_entries_lyric_id ON playlist_entries(lyric_id);
  `);
}

export function createGlobalContentIndexes(db: SqliteDatabase): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_decks_order_index ON presentations(order_index);
    CREATE INDEX IF NOT EXISTS idx_decks_theme_id ON presentations(theme_id);
    CREATE INDEX IF NOT EXISTS idx_lyrics_order_index ON lyrics(order_index);
    CREATE INDEX IF NOT EXISTS idx_lyrics_theme_id ON lyrics(theme_id);
    CREATE INDEX IF NOT EXISTS idx_overlays_created_at ON overlays(created_at);
    CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index);
    CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index);
  `);
  if (hasTable(db, 'talks')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_talks_order_index ON talks(order_index);
      CREATE INDEX IF NOT EXISTS idx_talks_theme_id ON talks(theme_id);
    `);
  }
  // The media-asset indexes are split per type post-v11; pre-v11 schemas
  // still have a unified media_assets table.
  if (hasTable(db, 'image_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at);');
  }
  if (hasTable(db, 'video_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_video_assets_created_at ON video_assets(created_at);');
  }
  if (hasTable(db, 'audio_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_audio_assets_created_at ON audio_assets(created_at);');
  }
  if (hasTable(db, 'media_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at);');
  }
}

export function createCollectionsIndexes(db: SqliteDatabase): void {
  for (const table of Object.values(COLLECTION_TABLE_BY_BIN)) {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_order_index ON ${table}(order_index);`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_presentations_collection_id ON presentations(collection_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_collection_id ON lyrics(collection_id);');
  if (hasTable(db, 'talks')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_talks_collection_id ON talks(collection_id);');
  }
  if (hasTable(db, 'media_assets')) {
    // Pre-v11 path: keep the legacy index until the migration drops the table.
    db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_collection_id ON media_assets(collection_id);');
  }
  if (hasTable(db, 'image_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_image_assets_collection_id ON image_assets(collection_id);');
  }
  if (hasTable(db, 'video_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_video_assets_collection_id ON video_assets(collection_id);');
  }
  if (hasTable(db, 'audio_assets')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_audio_assets_collection_id ON audio_assets(collection_id);');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_overlays_collection_id ON overlays(collection_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_themes_collection_id ON themes(collection_id);');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stages_collection_id ON stages(collection_id);');
  if (hasTable(db, 'actions') && hasColumn(db, 'actions', 'collection_id')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_actions_collection_id ON actions(collection_id);');
  }
}

/**
 * Migration-time equivalent of `CastRepository.seedDefaultCollections`. Kept
 * as an independent copy (rather than shared with the repository) so the
 * migrations module has no dependency on repository runtime behavior — only
 * on the raw database handle. Used by the migrations that introduce or
 * rename collection tables, to backfill every collection-scoped item's
 * `collection_id` before that column becomes load-bearing.
 */
export function seedDefaultCollectionsInMigration(db: SqliteDatabase): void {
  const now = nowIso();
  const defaultIds: Record<CollectionBinKind, string> = {} as Record<CollectionBinKind, string>;

  for (const bin of COLLECTION_BIN_KINDS) {
    const table = COLLECTION_TABLE_BY_BIN[bin];
    const existing = db.prepare(`SELECT id FROM ${table} WHERE is_default = 1 LIMIT 1`).get() as { id: string } | undefined;
    if (existing) {
      defaultIds[bin] = existing.id;
      continue;
    }
    const id = createId();
    db
      .prepare(`INSERT INTO ${table} (id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, DEFAULT_COLLECTION_NAME, 0, 1, now, now);
    defaultIds[bin] = id;
  }

  db.prepare('UPDATE presentations SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.deck);
  if (hasTable(db, 'lyrics')) {
    db.prepare('UPDATE lyrics SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.deck);
  }
  // Pre-v11 schemas had a single media_assets table with a `type` column;
  // post-v11 the per-type tables don't need a discriminator.
  if (hasTable(db, 'media_assets')) {
    db.prepare("UPDATE media_assets SET collection_id = ? WHERE collection_id IS NULL AND type = 'image'").run(defaultIds.image);
    db.prepare("UPDATE media_assets SET collection_id = ? WHERE collection_id IS NULL AND type = 'video'").run(defaultIds.video);
    db.prepare("UPDATE media_assets SET collection_id = ? WHERE collection_id IS NULL AND type = 'audio'").run(defaultIds.audio);
  }
  if (hasTable(db, 'image_assets')) {
    db.prepare('UPDATE image_assets SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.image);
  }
  if (hasTable(db, 'video_assets')) {
    db.prepare('UPDATE video_assets SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.video);
  }
  if (hasTable(db, 'audio_assets')) {
    db.prepare('UPDATE audio_assets SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.audio);
  }
  db.prepare('UPDATE themes SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.theme);
  db.prepare('UPDATE overlays SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.overlay);
  db.prepare('UPDATE stages SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.stage);
  if (hasTable(db, 'actions') && hasColumn(db, 'actions', 'collection_id')) {
    db.prepare("UPDATE actions SET collection_id = ? WHERE collection_id IS NULL OR collection_id = ''").run(defaultIds.macro);
  }
}
