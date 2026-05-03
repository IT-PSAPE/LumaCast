import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import {
  cloneDeckBundleManifest,
  collectDeckBundleMediaReferences,
  readElementMediaReference,
} from '@core/deck-bundles';
import { buildDeckItem } from '@core/deck-items';
import { applyThemeToElements, createDefaultThemeElements, isThemeCompatibleWithDeckItem, syncThemeToElements } from '@core/themes';
import { createId, nowIso } from '@core/utils';
import { SqliteDatabase } from './sqlite';
import type {
  AppSnapshot,
  BrokenDeckBundleReference,
  Collection,
  CollectionAssignmentInput,
  CollectionBinKind,
  CollectionCreateInput,
  CollectionDeleteInput,
  CollectionItemType,
  CollectionRenameInput,
  CollectionReorderInput,
  DeckBundleBrokenReferenceDecision,
  DeckBundleExportOptions,
  DeckBundleInspection,
  DeckBundleInspectionOverlay,
  DeckBundleInspectionStage,
  DeckBundleInspectionTheme,
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleOverlay,
  DeckBundleSlide,
  DeckBundleStage,
  DeckBundleTheme,
  DeckItem,
  DeckItemType,
  Presentation,
  ElementCreateInput,
  ElementUpdateInput,
  Id,
  Library,
  LibraryPlaylistBundle,
  Lyric,
  MediaAsset,
  MediaAssetCreateInput,
  MediaAssetType,
  Overlay,
  OverlayCreateInput,
  OverlayUpdateInput,
  Playlist,
  PlaylistEntry,
  PlaylistSegment,
  PlaylistTree,
  Slide,
  SlideElement,
  SlideElementPayload,
  SlideKind,
  SlideCreateInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput,
  Stage,
  StageCreateInput,
  StageUpdateInput,
  Theme,
  ThemeCreateInput,
  ThemeKind,
  ThemeUpdateInput,
} from '@core/types';
import { isBrokenMediaSource, toCastMediaSource } from './media-source-utils';
import type { SnapshotPatch } from '@core/snapshot-patch';

const DEFAULT_W = 1920;
const DEFAULT_H = 1080;
const THEMES_SCHEMA_VERSION = 4;
const DECK_ITEMS_SCHEMA_VERSION = 6;
const REORDER_SCHEMA_VERSION = 7;
const STAGES_SCHEMA_VERSION = 8;
const COLLECTIONS_SCHEMA_VERSION = 9;
const THEME_NAMING_SCHEMA_VERSION = 10;
const UNIFIED_SLIDES_SCHEMA_VERSION = 11;
const LATEST_SCHEMA_VERSION = UNIFIED_SLIDES_SCHEMA_VERSION;
const GLOBAL_SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_VERSION = 2;

const COLLECTION_BIN_KINDS: readonly CollectionBinKind[] = ['deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage'];

const MEDIA_ASSET_TABLES = ['image_assets', 'video_assets', 'audio_assets'] as const;
type MediaAssetTableName = typeof MEDIA_ASSET_TABLES[number];

const MEDIA_TYPE_BY_TABLE: Record<MediaAssetTableName, MediaAssetType> = {
  image_assets: 'image',
  video_assets: 'video',
  audio_assets: 'audio',
};

const COLLECTION_TABLE_BY_BIN: Record<CollectionBinKind, string> = {
  deck: 'deck_collections',
  image: 'image_collections',
  video: 'video_collections',
  audio: 'audio_collections',
  theme: 'theme_collections',
  overlay: 'overlay_collections',
  stage: 'stage_collections',
};

const DEFAULT_COLLECTION_NAME = 'Default Collection';

const ITEM_TABLE_BY_TYPE: Record<CollectionItemType, string> = {
  presentation: 'presentations',
  lyric: 'lyrics',
  media_asset: 'media_assets',
  theme: 'themes',
  overlay: 'overlays',
  stage: 'stages',
};

function isItemTypeAllowedInBin(
  itemType: CollectionItemType,
  binKind: CollectionBinKind,
  itemId: Id,
  store: CastRepository,
): boolean {
  if (itemType === 'presentation' || itemType === 'lyric') return binKind === 'deck';
  if (itemType === 'theme') return binKind === 'theme';
  if (itemType === 'overlay') return binKind === 'overlay';
  if (itemType === 'stage') return binKind === 'stage';
  if (itemType === 'media_asset') {
    if (binKind !== 'image' && binKind !== 'video' && binKind !== 'audio') return false;
    const assetType = store.peekMediaAssetType(itemId);
    if (!assetType) return false;
    if (binKind === 'audio') return assetType === 'audio';
    if (binKind === 'image') return assetType === 'image';
    if (binKind === 'video') return assetType === 'video';
  }
  return false;
}

function buildPatchSpecForItemType(itemType: CollectionItemType, itemId: Id): {
  upsertPresentationIds?: Id[];
  upsertLyricIds?: Id[];
  upsertMediaAssetIds?: Id[];
  upsertThemeIds?: Id[];
  upsertOverlayIds?: Id[];
  upsertStageIds?: Id[];
} {
  switch (itemType) {
    case 'presentation': return { upsertPresentationIds: [itemId] };
    case 'lyric': return { upsertLyricIds: [itemId] };
    case 'media_asset': return { upsertMediaAssetIds: [itemId] };
    case 'theme': return { upsertThemeIds: [itemId] };
    case 'overlay': return { upsertOverlayIds: [itemId] };
    case 'stage': return { upsertStageIds: [itemId] };
  }
}

interface DeckOwnerRow {
  type: DeckItemType;
  themeId: string | null;
}

interface BrokenReferenceAccumulator {
  elementTypes: Set<'image' | 'video'>;
  occurrenceCount: number;
  itemTitles: Set<string>;
  themeNames: Set<string>;
  overlayNames: Set<string>;
  stageNames: Set<string>;
}

const parseJson = <T>(value: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error('[DB] Failed to parse JSON:', error, value.slice(0, 200));
    throw new Error(`Corrupted JSON data in database: ${(error as Error).message}`);
  }
};

// One-shot rename of a pre-rename Recast database (and its WAL/SHM/backups)
// to the new LumaCast filename. Runs before the SQLite handle is opened so
// existing user data carries over after the brand rename.
function migrateLegacyRecastDatabase(userData: string, targetDbPath: string): void {
  if (fs.existsSync(targetDbPath)) return;
  const legacyDbPath = path.join(userData, 'recast.sqlite');
  if (!fs.existsSync(legacyDbPath)) return;
  try {
    fs.renameSync(legacyDbPath, targetDbPath);
    for (const suffix of ['-wal', '-shm']) {
      const legacy = legacyDbPath + suffix;
      if (fs.existsSync(legacy)) fs.renameSync(legacy, targetDbPath + suffix);
    }
    for (const entry of fs.readdirSync(userData)) {
      const match = entry.match(/^recast\.bak-v(\d+)\.sqlite$/);
      if (!match) continue;
      fs.renameSync(path.join(userData, entry), path.join(userData, `lumacast.bak-v${match[1]}.sqlite`));
    }
    console.info('[DB] Migrated legacy recast.sqlite -> lumacast.sqlite');
  } catch (error) {
    console.error('[DB] Failed to migrate legacy recast database:', error);
  }
}

function toDeckBundleTheme(theme: Theme): DeckBundleTheme {
  return {
    id: theme.id,
    name: theme.name,
    kind: theme.kind,
    width: theme.width,
    height: theme.height,
    order: theme.order,
    elements: theme.elements,
  };
}

function toDeckBundleOverlay(overlay: Overlay): DeckBundleOverlay {
  // Bundle format keeps a flat summary so older importers still work; derive
  // it from the highest-z_index element each time we export.
  const summary = summarizeOverlayElements(overlay.elements);
  return {
    id: overlay.id,
    name: overlay.name,
    type: summary.type,
    x: summary.x,
    y: summary.y,
    width: summary.width,
    height: summary.height,
    opacity: summary.opacity,
    zIndex: summary.zIndex,
    enabled: overlay.enabled,
    elements: overlay.elements,
    animation: overlay.animation,
  };
}

function toDeckBundleStage(stage: Stage): DeckBundleStage {
  return {
    id: stage.id,
    name: stage.name,
    width: stage.width,
    height: stage.height,
    order: stage.order,
    elements: stage.elements,
  };
}

function emptyOverlayPayload(): SlideElementPayload {
  return {
    text: '',
    fontFamily: 'Avenir Next',
    fontSize: 48,
    color: '#FFFFFF',
    alignment: 'left',
    weight: '700',
  };
}

function normalizeOverlayAnimation(animation: unknown): Required<Overlay['animation']> {
  const parsed = animation as Partial<Overlay['animation']> | null | undefined;
  const rawKind = parsed?.kind;
  const kind = rawKind === 'dissolve' || rawKind === 'fade' || rawKind === 'pulse'
    ? rawKind
    : 'none';
  const durationMs = Math.max(0, Number.isFinite(parsed?.durationMs) ? parsed?.durationMs ?? 0 : 0);
  const autoClearDurationMs = parsed?.autoClearDurationMs == null
    ? null
    : Math.max(0, Number.isFinite(parsed.autoClearDurationMs) ? parsed.autoClearDurationMs : 0);

  return {
    kind,
    durationMs,
    autoClearDurationMs,
  };
}

// Used only when serializing to DeckBundleOverlay (legacy export shape that
// kept a flat summary alongside the full elements list).
interface OverlaySummary {
  type: 'text' | 'image' | 'video' | 'shape';
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  zIndex: number;
  payload: SlideElementPayload;
}

function summarizeOverlayElements(elements: SlideElement[]): OverlaySummary {
  const primary = elements
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .at(-1);

  if (!primary) {
    return {
      type: 'text',
      x: 0,
      y: 0,
      width: DEFAULT_W,
      height: DEFAULT_H,
      opacity: 1,
      zIndex: 0,
      payload: emptyOverlayPayload(),
    };
  }

  return {
    type: primary.type === 'shape' ? 'shape' : primary.type === 'text' ? 'text' : primary.type === 'video' ? 'video' : 'image',
    x: primary.x,
    y: primary.y,
    width: primary.width,
    height: primary.height,
    opacity: primary.opacity,
    zIndex: primary.zIndex,
    payload: primary.payload,
  };
}

function legacyOverlayElement(row: {
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

export class CastRepository {
  private db: SqliteDatabase;
  private patchVersion = 0;
  private readonly dbPath: string;

  constructor() {
    const userData = app.getPath('userData');
    this.dbPath = path.join(userData, 'lumacast.sqlite');
    migrateLegacyRecastDatabase(userData, this.dbPath);
    this.db = new SqliteDatabase(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    this.seedIfEmpty();
  }

  private initializeSchema(): void {
    const currentVersion = this.getUserVersion();

    if (this.hasTable('libraries') && currentVersion < LATEST_SCHEMA_VERSION) {
      this.backupBeforeMigration(currentVersion);
    }

    if (currentVersion === 0) {
      if (!this.hasTable('libraries')) {
        this.createGlobalSchema();
        this.setUserVersion(LATEST_SCHEMA_VERSION);
        this.seedDefaultCollections();
        return;
      }

      this.prepareLegacySchema();
      this.setUserVersion(LEGACY_SCHEMA_VERSION);
    }

    if (this.getUserVersion() < GLOBAL_SCHEMA_VERSION) {
      this.migrateLegacyProjectContentToGlobalScope();
    }

    if (this.getUserVersion() < THEMES_SCHEMA_VERSION) {
      this.ensureThemesSchema();
    }

    if (this.getUserVersion() < 5) {
      this.ensurePresentationThemeSchema();
      this.setUserVersion(5);
    }

    if (this.getUserVersion() < DECK_ITEMS_SCHEMA_VERSION) {
      this.migratePresentationSchemaToDeckItems();
      this.setUserVersion(DECK_ITEMS_SCHEMA_VERSION);
    }

    if (this.getUserVersion() < REORDER_SCHEMA_VERSION) {
      this.ensureReorderColumns();
      this.setUserVersion(REORDER_SCHEMA_VERSION);
    }

    if (this.getUserVersion() < STAGES_SCHEMA_VERSION) {
      this.ensureStagesSchema();
      this.setUserVersion(STAGES_SCHEMA_VERSION);
    }

    if (this.getUserVersion() < COLLECTIONS_SCHEMA_VERSION) {
      this.ensureCollectionsSchema();
      this.setUserVersion(COLLECTIONS_SCHEMA_VERSION);
    }

    if (this.getUserVersion() < THEME_NAMING_SCHEMA_VERSION) {
      this.migrateTemplateNamingToThemes();
      this.setUserVersion(THEME_NAMING_SCHEMA_VERSION);
    }

    if (this.getUserVersion() < UNIFIED_SLIDES_SCHEMA_VERSION) {
      this.migrateToUnifiedSlides();
      this.setUserVersion(UNIFIED_SLIDES_SCHEMA_VERSION);
    }
  }

  /**
   * Schema v7 — add `order_index` to `libraries` and `media_assets` so they
   * can be reordered via drag-and-drop. Back-fills the column from the
   * existing `created_at` order so nothing appears to move after upgrade.
   */
  private ensureReorderColumns(): void {
    const tx = this.db.transaction(() => {
      if (!this.hasColumn('libraries', 'order_index')) {
        this.db.exec('ALTER TABLE libraries ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0');
        this.db.exec(`
          WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS rank FROM libraries
          )
          UPDATE libraries SET order_index = (SELECT rank FROM ranked WHERE ranked.id = libraries.id);
        `);
      }
      if (!this.hasColumn('media_assets', 'order_index')) {
        this.db.exec('ALTER TABLE media_assets ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0');
        this.db.exec(`
          WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) - 1 AS rank FROM media_assets
          )
          UPDATE media_assets SET order_index = (SELECT rank FROM ranked WHERE ranked.id = media_assets.id);
        `);
      }
    });
    tx();
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_libraries_order_index ON libraries(order_index);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_order_index ON media_assets(order_index);');
  }

  private backupBeforeMigration(fromVersion: number): void {
    const backupPath = path.join(path.dirname(this.dbPath), `lumacast.bak-v${fromVersion}.sqlite`);
    try {
      fs.rmSync(backupPath, { force: true });
      const escaped = backupPath.replace(/'/g, "''");
      this.db.exec(`VACUUM INTO '${escaped}'`);
      console.info(`[DB] Pre-migration backup written to ${backupPath}`);
    } catch (error) {
      // Migrations are additive and idempotent, so a failed backup must not block startup.
      console.error('[DB] Pre-migration backup failed (continuing):', error);
    }
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === columnName);
  }

  private getUserVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }

  private setUserVersion(version: number): void {
    this.db.pragma(`user_version = ${version}`);
  }

  private hasTable(name: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { name: string } | undefined;

    return row?.name === name;
  }

  private createLegacySchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS presentations (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'canvas',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS slides (
        id TEXT PRIMARY KEY,
        presentation_id TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(presentation_id) REFERENCES presentations(id)
      );

      CREATE TABLE IF NOT EXISTS slide_elements (
        id TEXT PRIMARY KEY,
        slide_id TEXT NOT NULL,
        type TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        rotation REAL NOT NULL,
        opacity REAL NOT NULL,
        z_index INTEGER NOT NULL,
        layer TEXT NOT NULL DEFAULT 'content',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(slide_id) REFERENCES slides(id)
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS playlist_segments (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color_key TEXT,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(playlist_id) REFERENCES playlists(id)
      );

      CREATE TABLE IF NOT EXISTS playlist_entries (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        presentation_id TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(segment_id) REFERENCES playlist_segments(id),
        FOREIGN KEY(presentation_id) REFERENCES presentations(id)
      );

      CREATE TABLE IF NOT EXISTS media_assets (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        src TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS overlays (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        opacity REAL NOT NULL,
        z_index INTEGER NOT NULL,
        enabled INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        elements_json TEXT NOT NULL DEFAULT '[]',
        animation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS themes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        elements_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        elements_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_presentations_library_id ON presentations(library_id);
      CREATE INDEX IF NOT EXISTS idx_slides_presentation_id ON slides(presentation_id);
      CREATE INDEX IF NOT EXISTS idx_slide_elements_slide_id ON slide_elements(slide_id);
      CREATE INDEX IF NOT EXISTS idx_playlists_library_id ON playlists(library_id);
      CREATE INDEX IF NOT EXISTS idx_playlist_segments_playlist_id ON playlist_segments(playlist_id);
      CREATE INDEX IF NOT EXISTS idx_playlist_entries_segment_id ON playlist_entries(segment_id);
      CREATE INDEX IF NOT EXISTS idx_media_assets_library_id ON media_assets(library_id);
      CREATE INDEX IF NOT EXISTS idx_overlays_library_id ON overlays(library_id);
      CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index);
      CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index);
    `);
  }

  private createGlobalSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS libraries (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS presentations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        theme_id TEXT,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(theme_id) REFERENCES themes(id),
        FOREIGN KEY(collection_id) REFERENCES deck_collections(id)
      );

      CREATE TABLE IF NOT EXISTS lyrics (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        theme_id TEXT,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(theme_id) REFERENCES themes(id),
        FOREIGN KEY(collection_id) REFERENCES deck_collections(id)
      );

      CREATE TABLE IF NOT EXISTS slides (
        id TEXT PRIMARY KEY,
        presentation_id TEXT,
        lyric_id TEXT,
        theme_id TEXT,
        overlay_id TEXT,
        stage_id TEXT,
        kind TEXT NOT NULL DEFAULT 'presentation',
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(presentation_id) REFERENCES presentations(id),
        FOREIGN KEY(lyric_id) REFERENCES lyrics(id),
        FOREIGN KEY(theme_id) REFERENCES themes(id),
        FOREIGN KEY(overlay_id) REFERENCES overlays(id),
        FOREIGN KEY(stage_id) REFERENCES stages(id),
        CHECK (
          (presentation_id IS NOT NULL) +
          (lyric_id IS NOT NULL) +
          (theme_id IS NOT NULL) +
          (overlay_id IS NOT NULL) +
          (stage_id IS NOT NULL) = 1
        )
      );

      CREATE TABLE IF NOT EXISTS slide_elements (
        id TEXT PRIMARY KEY,
        slide_id TEXT NOT NULL,
        type TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        rotation REAL NOT NULL,
        opacity REAL NOT NULL,
        z_index INTEGER NOT NULL,
        layer TEXT NOT NULL DEFAULT 'content',
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(slide_id) REFERENCES slides(id)
      );

      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        library_id TEXT NOT NULL,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id)
      );

      CREATE TABLE IF NOT EXISTS playlist_segments (
        id TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color_key TEXT,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(playlist_id) REFERENCES playlists(id)
      );

      CREATE TABLE IF NOT EXISTS playlist_entries (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        presentation_id TEXT,
        lyric_id TEXT,
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(segment_id) REFERENCES playlist_segments(id),
        FOREIGN KEY(presentation_id) REFERENCES presentations(id),
        FOREIGN KEY(lyric_id) REFERENCES lyrics(id)
      );

      CREATE TABLE IF NOT EXISTS image_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        src TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES image_collections(id)
      );

      CREATE TABLE IF NOT EXISTS video_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        src TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES video_collections(id)
      );

      CREATE TABLE IF NOT EXISTS audio_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        src TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES audio_collections(id)
      );

      CREATE TABLE IF NOT EXISTS overlays (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        animation_json TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES overlay_collections(id)
      );

      CREATE TABLE IF NOT EXISTS themes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        collection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES theme_collections(id)
      );

      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        collection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES stage_collections(id)
      );

      CREATE TABLE IF NOT EXISTS deck_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS image_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS video_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audio_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS theme_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS overlay_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_collections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.createCommonIndexes();
    this.createGlobalContentIndexes();
    this.createCollectionsIndexes();
  }

  private createCommonIndexes(): void {
    this.db.exec(`
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

  private createGlobalContentIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_decks_order_index ON presentations(order_index);
      CREATE INDEX IF NOT EXISTS idx_decks_theme_id ON presentations(theme_id);
      CREATE INDEX IF NOT EXISTS idx_lyrics_order_index ON lyrics(order_index);
      CREATE INDEX IF NOT EXISTS idx_lyrics_theme_id ON lyrics(theme_id);
      CREATE INDEX IF NOT EXISTS idx_overlays_created_at ON overlays(created_at);
      CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index);
      CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index);
    `);
    // The media-asset indexes are split per type post-v11; pre-v11 schemas
    // still have a unified media_assets table.
    if (this.hasTable('image_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at);');
    }
    if (this.hasTable('video_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_video_assets_created_at ON video_assets(created_at);');
    }
    if (this.hasTable('audio_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_audio_assets_created_at ON audio_assets(created_at);');
    }
    if (this.hasTable('media_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_created_at ON media_assets(created_at);');
    }
  }

  private ensureThemesSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS themes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        elements_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index)');
  }

  private ensureStagesSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS stages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        elements_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index)');
  }

  private createCollectionsIndexes(): void {
    for (const table of Object.values(COLLECTION_TABLE_BY_BIN)) {
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_order_index ON ${table}(order_index);`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presentations_collection_id ON presentations(collection_id);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_collection_id ON lyrics(collection_id);');
    if (this.hasTable('media_assets')) {
      // Pre-v11 path: keep the legacy index until the migration drops the table.
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_assets_collection_id ON media_assets(collection_id);');
    }
    if (this.hasTable('image_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_image_assets_collection_id ON image_assets(collection_id);');
    }
    if (this.hasTable('video_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_video_assets_collection_id ON video_assets(collection_id);');
    }
    if (this.hasTable('audio_assets')) {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_audio_assets_collection_id ON audio_assets(collection_id);');
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_overlays_collection_id ON overlays(collection_id);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_themes_collection_id ON themes(collection_id);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_stages_collection_id ON stages(collection_id);');
  }

  private ensureCollectionsSchema(): void {
    const tx = this.db.transaction(() => {
      for (const table of Object.values(COLLECTION_TABLE_BY_BIN)) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            order_index INTEGER NOT NULL DEFAULT 0,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);
      }

      const itemTablesNeedingColumn = ['presentations', 'lyrics', 'media_assets', 'themes', 'overlays', 'stages'];
      for (const table of itemTablesNeedingColumn) {
        if (this.hasTable(table) && !this.hasColumn(table, 'collection_id')) {
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN collection_id TEXT;`);
        }
      }
    });
    tx();
    this.createCollectionsIndexes();
    this.seedDefaultCollections();
  }

  private migrateTemplateNamingToThemes(): void {
    const previousForeignKeys = this.db.pragma('foreign_keys', { simple: true }) as number;
    this.db.pragma('foreign_keys = OFF');

    try {
      const tx = this.db.transaction(() => {
        this.renameTableIfNeeded('templates', 'themes');
        this.renameTableIfNeeded('template_collections', 'theme_collections');
        this.renameColumnIfNeeded('presentations', 'template_id', 'theme_id');
        this.renameColumnIfNeeded('lyrics', 'template_id', 'theme_id');

        if (this.hasTable('themes') && this.hasTable('theme_collections') && !this.hasColumn('themes', 'collection_id')) {
          this.db.exec('ALTER TABLE themes ADD COLUMN collection_id TEXT;');
        }

        this.db.exec('DROP INDEX IF EXISTS idx_presentations_template_id;');
        this.db.exec('DROP INDEX IF EXISTS idx_decks_template_id;');
        this.db.exec('DROP INDEX IF EXISTS idx_lyrics_template_id;');
        this.db.exec('DROP INDEX IF EXISTS idx_templates_order_index;');
        this.db.exec('DROP INDEX IF EXISTS idx_templates_collection_id;');
        this.db.exec('DROP INDEX IF EXISTS idx_template_collections_order_index;');
      });

      tx();
    } finally {
      this.db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    }

    this.createGlobalContentIndexes();
    if (this.hasTable('theme_collections')) {
      this.createCollectionsIndexes();
      this.seedDefaultCollections();
    }
  }

  private renameTableIfNeeded(from: string, to: string): void {
    if (!this.hasTable(from) || this.hasTable(to)) return;
    this.db.exec(`ALTER TABLE ${from} RENAME TO ${to};`);
  }

  /**
   * Schema v11 — restructure the database around three clear layers:
   *   1. Top-level containers: presentations, lyrics, themes, overlays, stages.
   *   2. slides: a child of exactly one container (one of five nullable FKs).
   *   3. slide_elements: the visual contents of a slide.
   *
   * Plus media split: media_assets becomes image_assets / video_assets /
   * audio_assets, each with a real FOREIGN KEY into its specific collection
   * table. The legacy 'animation' media type is folded into video_assets.
   *
   * Plus collection FK enforcement: every container's collection_id becomes
   * a real FOREIGN KEY into the matching *_collections table.
   *
   * Migration steps (v10 → v11):
   *   a. slides gains kind, theme_id, overlay_id, stage_id columns.
   *   b. For each theme/overlay/stage row, materialize a child slide whose
   *      ${kind}_id points back at the container, parse elements_json into
   *      slide_elements rows. Empty overlays are backfilled from the cached
   *      summary columns first.
   *   c. Recreate themes/overlays/stages without elements_json (and without
   *      the overlay summary cache), with collection_id FKs enforced.
   *   d. Recreate slides with all five parent FKs and a CHECK constraint.
   *   e. Recreate media_assets contents into image_assets/video_assets/
   *      audio_assets, mapping animation -> video.
   *   f. Recreate presentations/lyrics with collection_id + theme_id FKs.
   *
   * Slide IDs for materialized container slides are derived as
   * ${container_id}:slide so the migration is idempotent on re-run.
   */
  private migrateToUnifiedSlides(): void {
    const previousForeignKeys = this.db.pragma('foreign_keys', { simple: true }) as number;
    this.db.pragma('foreign_keys = OFF');

    try {
      const tx = this.db.transaction(() => {
        // a) slides: add kind + theme_id/overlay_id/stage_id columns and backfill kind.
        if (!this.hasColumn('slides', 'kind')) {
          this.db.exec("ALTER TABLE slides ADD COLUMN kind TEXT NOT NULL DEFAULT 'presentation'");
          this.db.exec("UPDATE slides SET kind = 'lyric' WHERE lyric_id IS NOT NULL");
          this.db.exec("UPDATE slides SET kind = 'presentation' WHERE lyric_id IS NULL AND presentation_id IS NOT NULL");
        }
        if (!this.hasColumn('slides', 'theme_id')) {
          this.db.exec('ALTER TABLE slides ADD COLUMN theme_id TEXT');
        }
        if (!this.hasColumn('slides', 'overlay_id')) {
          this.db.exec('ALTER TABLE slides ADD COLUMN overlay_id TEXT');
        }
        if (!this.hasColumn('slides', 'stage_id')) {
          this.db.exec('ALTER TABLE slides ADD COLUMN stage_id TEXT');
        }

        // b) Materialize child slides for each theme/overlay/stage and parse
        //    elements_json into slide_elements rows.
        if (this.hasColumn('themes', 'elements_json')) {
          this.materializeContainerSlides('themes', 'theme');
        }
        if (this.hasColumn('stages', 'elements_json')) {
          this.materializeContainerSlides('stages', 'stage');
        }
        if (this.hasColumn('overlays', 'elements_json')) {
          this.backfillEmptyOverlayElements();
          this.materializeContainerSlides('overlays', 'overlay');
        }

        // c) Recreate themes/overlays/stages with the trimmed schema +
        //    enforced collection FKs.
        if (this.hasColumn('themes', 'elements_json')) {
          this.recreateThemesTable();
        }
        if (this.hasColumn('stages', 'elements_json')) {
          this.recreateStagesTable();
        }
        if (this.hasColumn('overlays', 'payload_json') || this.hasColumn('overlays', 'elements_json')) {
          this.recreateOverlaysTable();
        }

        // d) Recreate slides with the new column layout, FK fan-out and
        //    CHECK constraint enforced. Idempotent: skip if already done.
        if (this.hasColumn('slides', 'kind') && !this.slidesHasCheckConstraint()) {
          this.recreateSlidesTable();
        }

        // e) Migrate media_assets into per-type tables (animation -> video).
        if (this.hasTable('media_assets')) {
          this.splitMediaAssetsTable();
        }

        // f) Recreate presentations + lyrics with theme_id + collection_id FKs.
        if (!this.tableHasForeignKeyOn('presentations', 'collection_id')) {
          this.recreateDeckTable('presentations');
        }
        if (!this.tableHasForeignKeyOn('lyrics', 'collection_id')) {
          this.recreateDeckTable('lyrics');
        }
      });

      tx();
    } finally {
      this.db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    }
  }

  /**
   * For each row in {table} with elements_json, create a corresponding slide
   * row (kind = {kind}) and insert each parsed element into slide_elements
   * with that slide's id. Sets slides.{kind}_id pointing back at the
   * container. The slide id is derived as `${row.id}:slide` for idempotency.
   */
  private materializeContainerSlides(
    table: 'themes' | 'overlays' | 'stages',
    kind: 'theme' | 'overlay' | 'stage',
  ): void {
    const widthExpr = this.hasColumn(table, 'width') ? 'width' : `${DEFAULT_W} AS width`;
    const heightExpr = this.hasColumn(table, 'height') ? 'height' : `${DEFAULT_H} AS height`;
    const rows = this.db
      .prepare(`SELECT id, elements_json, ${widthExpr}, ${heightExpr}, created_at, updated_at FROM ${table}`)
      .all() as Array<{
        id: string;
        elements_json: string;
        width: number | null;
        height: number | null;
        created_at: string;
        updated_at: string;
      }>;

    const fkColumn = `${kind}_id`;
    const insertSlide = this.db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)`
    );
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const slideExists = this.db.prepare('SELECT id FROM slides WHERE id = ?');
    const updateSlideFk = this.db.prepare(`UPDATE slides SET ${fkColumn} = ?, kind = ? WHERE id = ?`);

    for (const row of rows) {
      const slideId = `${row.id}:slide`;
      const width = (row.width && row.width > 0) ? row.width : DEFAULT_W;
      const height = (row.height && row.height > 0) ? row.height : DEFAULT_H;
      const existing = slideExists.get(slideId);
      if (!existing) {
        insertSlide.run(
          slideId,
          kind === 'theme' ? row.id : null,
          kind === 'overlay' ? row.id : null,
          kind === 'stage' ? row.id : null,
          kind,
          width,
          height,
          row.created_at,
          row.updated_at,
        );
      } else {
        // Already migrated once; just normalize the FK.
        updateSlideFk.run(row.id, kind, slideId);
      }
      const elements = parseJson<SlideElement[]>(row.elements_json) ?? [];
      this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
      for (const element of elements) {
        insertElement.run(
          element.id ?? createId(),
          slideId,
          element.type,
          element.x ?? 0,
          element.y ?? 0,
          element.width ?? 0,
          element.height ?? 0,
          element.rotation ?? 0,
          element.opacity ?? 1,
          element.zIndex ?? 0,
          element.layer ?? 'content',
          JSON.stringify(element.payload ?? {}),
          element.createdAt ?? row.created_at,
          element.updatedAt ?? row.updated_at,
        );
      }
    }
  }

  /**
   * Synthesize a single SlideElement from the cached overlay summary columns
   * for any overlay whose elements_json is empty. Mirrors the runtime
   * fallback that overlayToLayerElements used to do, so dropping the cache
   * columns doesn't silently blank those overlays.
   */
  private backfillEmptyOverlayElements(): void {
    if (!this.hasColumn('overlays', 'payload_json')) return;
    const rows = this.db
      .prepare(
        `SELECT id, type, x, y, width, height, opacity, z_index, payload_json, elements_json, created_at, updated_at
         FROM overlays`
      )
      .all() as Array<{
        id: string;
        type: 'text' | 'image' | 'video' | 'shape';
        x: number;
        y: number;
        width: number;
        height: number;
        opacity: number;
        z_index: number;
        payload_json: string;
        elements_json: string;
        created_at: string;
        updated_at: string;
      }>;
    const update = this.db.prepare('UPDATE overlays SET elements_json = ? WHERE id = ?');
    for (const row of rows) {
      const parsed = parseJson<SlideElement[]>(row.elements_json) ?? [];
      if (parsed.length > 0) continue;
      const synthetic = legacyOverlayElement(row);
      update.run(JSON.stringify([synthetic]), row.id);
    }
  }

  private recreateThemesTable(): void {
    this.db.exec(`
      CREATE TABLE themes_v11 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        collection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES theme_collections(id)
      );

      INSERT INTO themes_v11 (id, name, kind, width, height, order_index, collection_id, created_at, updated_at)
      SELECT id, name, kind, width, height, order_index, collection_id, created_at, updated_at
      FROM themes;

      DROP INDEX IF EXISTS idx_themes_order_index;
      DROP INDEX IF EXISTS idx_themes_collection_id;
      DROP TABLE themes;
      ALTER TABLE themes_v11 RENAME TO themes;

      CREATE INDEX IF NOT EXISTS idx_themes_order_index ON themes(order_index);
      CREATE INDEX IF NOT EXISTS idx_themes_collection_id ON themes(collection_id);
    `);
  }

  private recreateStagesTable(): void {
    this.db.exec(`
      CREATE TABLE stages_v11 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        collection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES stage_collections(id)
      );

      INSERT INTO stages_v11 (id, name, width, height, order_index, collection_id, created_at, updated_at)
      SELECT id, name, width, height, order_index, collection_id, created_at, updated_at
      FROM stages;

      DROP INDEX IF EXISTS idx_stages_order_index;
      DROP INDEX IF EXISTS idx_stages_collection_id;
      DROP TABLE stages;
      ALTER TABLE stages_v11 RENAME TO stages;

      CREATE INDEX IF NOT EXISTS idx_stages_order_index ON stages(order_index);
      CREATE INDEX IF NOT EXISTS idx_stages_collection_id ON stages(collection_id);
    `);
  }

  private recreateOverlaysTable(): void {
    this.db.exec(`
      CREATE TABLE overlays_v11 (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL,
        animation_json TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES overlay_collections(id)
      );

      INSERT INTO overlays_v11 (id, name, enabled, animation_json, collection_id, created_at, updated_at)
      SELECT id, name, enabled, animation_json, collection_id, created_at, updated_at
      FROM overlays;

      DROP INDEX IF EXISTS idx_overlays_created_at;
      DROP INDEX IF EXISTS idx_overlays_collection_id;
      DROP TABLE overlays;
      ALTER TABLE overlays_v11 RENAME TO overlays;

      CREATE INDEX IF NOT EXISTS idx_overlays_created_at ON overlays(created_at);
      CREATE INDEX IF NOT EXISTS idx_overlays_collection_id ON overlays(collection_id);
    `);
  }

  private recreateSlidesTable(): void {
    this.db.exec(`
      CREATE TABLE slides_v11 (
        id TEXT PRIMARY KEY,
        presentation_id TEXT,
        lyric_id TEXT,
        theme_id TEXT,
        overlay_id TEXT,
        stage_id TEXT,
        kind TEXT NOT NULL DEFAULT 'presentation',
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        order_index INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(presentation_id) REFERENCES presentations(id),
        FOREIGN KEY(lyric_id) REFERENCES lyrics(id),
        FOREIGN KEY(theme_id) REFERENCES themes(id),
        FOREIGN KEY(overlay_id) REFERENCES overlays(id),
        FOREIGN KEY(stage_id) REFERENCES stages(id),
        CHECK (
          (presentation_id IS NOT NULL) +
          (lyric_id IS NOT NULL) +
          (theme_id IS NOT NULL) +
          (overlay_id IS NOT NULL) +
          (stage_id IS NOT NULL) = 1
        )
      );

      INSERT INTO slides_v11 (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
      SELECT id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at
      FROM slides;

      DROP INDEX IF EXISTS idx_slides_presentation_id;
      DROP INDEX IF EXISTS idx_slides_lyric_id;
      DROP TABLE slides;
      ALTER TABLE slides_v11 RENAME TO slides;

      CREATE INDEX IF NOT EXISTS idx_slides_presentation_id ON slides(presentation_id);
      CREATE INDEX IF NOT EXISTS idx_slides_lyric_id ON slides(lyric_id);
      CREATE INDEX IF NOT EXISTS idx_slides_theme_id ON slides(theme_id);
      CREATE INDEX IF NOT EXISTS idx_slides_overlay_id ON slides(overlay_id);
      CREATE INDEX IF NOT EXISTS idx_slides_stage_id ON slides(stage_id);
    `);
  }

  private slidesHasCheckConstraint(): boolean {
    const row = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'slides'")
      .get() as { sql: string } | undefined;
    return row?.sql?.includes('CHECK (') ?? false;
  }

  private tableHasForeignKeyOn(table: string, column: string): boolean {
    const rows = this.db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ from: string }>;
    return rows.some((row) => row.from === column);
  }

  private splitMediaAssetsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        src TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES image_collections(id)
      );

      CREATE TABLE IF NOT EXISTS video_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        src TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES video_collections(id)
      );

      CREATE TABLE IF NOT EXISTS audio_assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        src TEXT NOT NULL,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(collection_id) REFERENCES audio_collections(id)
      );

      INSERT INTO image_assets (id, name, src, collection_id, order_index, created_at, updated_at)
      SELECT id, name, src, collection_id, order_index, created_at, updated_at
      FROM media_assets WHERE type = 'image';

      INSERT INTO video_assets (id, name, src, collection_id, order_index, created_at, updated_at)
      SELECT id, name, src, collection_id, order_index, created_at, updated_at
      FROM media_assets WHERE type = 'video' OR type = 'animation';

      INSERT INTO audio_assets (id, name, src, collection_id, order_index, created_at, updated_at)
      SELECT id, name, src, collection_id, order_index, created_at, updated_at
      FROM media_assets WHERE type = 'audio';

      DROP INDEX IF EXISTS idx_media_assets_created_at;
      DROP INDEX IF EXISTS idx_media_assets_collection_id;
      DROP INDEX IF EXISTS idx_media_assets_order_index;
      DROP TABLE media_assets;

      CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at);
      CREATE INDEX IF NOT EXISTS idx_image_assets_collection_id ON image_assets(collection_id);
      CREATE INDEX IF NOT EXISTS idx_video_assets_created_at ON video_assets(created_at);
      CREATE INDEX IF NOT EXISTS idx_video_assets_collection_id ON video_assets(collection_id);
      CREATE INDEX IF NOT EXISTS idx_audio_assets_created_at ON audio_assets(created_at);
      CREATE INDEX IF NOT EXISTS idx_audio_assets_collection_id ON audio_assets(collection_id);
    `);
  }

  /**
   * Recreate presentations or lyrics with FOREIGN KEY constraints on
   * theme_id and collection_id. SQLite can't add FKs to an existing column,
   * so we copy through a renamed table.
   */
  private recreateDeckTable(table: 'presentations' | 'lyrics'): void {
    const tempTable = `${table}_v11`;
    this.db.exec(`
      CREATE TABLE ${tempTable} (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        theme_id TEXT,
        collection_id TEXT NOT NULL,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(theme_id) REFERENCES themes(id),
        FOREIGN KEY(collection_id) REFERENCES deck_collections(id)
      );

      INSERT INTO ${tempTable} (id, title, theme_id, collection_id, order_index, created_at, updated_at)
      SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at
      FROM ${table};

      DROP TABLE ${table};
      ALTER TABLE ${tempTable} RENAME TO ${table};
    `);

    if (table === 'presentations') {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_decks_order_index ON presentations(order_index);');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_decks_theme_id ON presentations(theme_id);');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_presentations_collection_id ON presentations(collection_id);');
    } else {
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_order_index ON lyrics(order_index);');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_theme_id ON lyrics(theme_id);');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_lyrics_collection_id ON lyrics(collection_id);');
    }
  }

  private renameColumnIfNeeded(table: string, from: string, to: string): void {
    if (!this.hasTable(table) || !this.hasColumn(table, from) || this.hasColumn(table, to)) return;
    this.db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to};`);
  }

  private getDefaultCollectionId(binKind: CollectionBinKind): Id {
    const table = COLLECTION_TABLE_BY_BIN[binKind];
    const row = this.db
      .prepare(`SELECT id FROM ${table} WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string } | undefined;
    if (!row) {
      // Defensive: seed if somehow missing (e.g. deleted by hand). Idempotent.
      this.seedDefaultCollections();
      const retry = this.db
        .prepare(`SELECT id FROM ${table} WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1`)
        .get() as { id: string } | undefined;
      if (!retry) throw new Error(`Default collection missing for bin: ${binKind}`);
      return retry.id;
    }
    return row.id;
  }

  private getMediaAssetDefaultCollectionId(type: MediaAssetType): Id {
    if (type === 'audio') return this.getDefaultCollectionId('audio');
    if (type === 'video') return this.getDefaultCollectionId('video');
    return this.getDefaultCollectionId('image');
  }

  private seedDefaultCollections(): void {
    const tx = this.db.transaction(() => {
      const now = nowIso();
      const defaultIds: Record<CollectionBinKind, string> = {} as Record<CollectionBinKind, string>;

      for (const bin of COLLECTION_BIN_KINDS) {
        const table = COLLECTION_TABLE_BY_BIN[bin];
        const existing = this.db
          .prepare(`SELECT id FROM ${table} WHERE is_default = 1 LIMIT 1`)
          .get() as { id: string } | undefined;

        if (existing) {
          defaultIds[bin] = existing.id;
          continue;
        }

        const id = createId();
        this.db
          .prepare(
            `INSERT INTO ${table} (id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(id, DEFAULT_COLLECTION_NAME, 0, 1, now, now);
        defaultIds[bin] = id;
      }

      this.db
        .prepare('UPDATE presentations SET collection_id = ? WHERE collection_id IS NULL')
        .run(defaultIds.deck);
      if (this.hasTable('lyrics')) {
        this.db
          .prepare('UPDATE lyrics SET collection_id = ? WHERE collection_id IS NULL')
          .run(defaultIds.deck);
      }
      // Pre-v11 schemas had a single media_assets table with a `type`
      // column; post-v11 the per-type tables don't need a discriminator.
      if (this.hasTable('media_assets')) {
        this.db
          .prepare("UPDATE media_assets SET collection_id = ? WHERE collection_id IS NULL AND type = 'image'")
          .run(defaultIds.image);
        this.db
          .prepare("UPDATE media_assets SET collection_id = ? WHERE collection_id IS NULL AND type = 'video'")
          .run(defaultIds.video);
        this.db
          .prepare("UPDATE media_assets SET collection_id = ? WHERE collection_id IS NULL AND type = 'audio'")
          .run(defaultIds.audio);
      }
      if (this.hasTable('image_assets')) {
        this.db.prepare('UPDATE image_assets SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.image);
      }
      if (this.hasTable('video_assets')) {
        this.db.prepare('UPDATE video_assets SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.video);
      }
      if (this.hasTable('audio_assets')) {
        this.db.prepare('UPDATE audio_assets SET collection_id = ? WHERE collection_id IS NULL').run(defaultIds.audio);
      }
      this.db
        .prepare('UPDATE themes SET collection_id = ? WHERE collection_id IS NULL')
        .run(defaultIds.theme);
      this.db
        .prepare('UPDATE overlays SET collection_id = ? WHERE collection_id IS NULL')
        .run(defaultIds.overlay);
      this.db
        .prepare('UPDATE stages SET collection_id = ? WHERE collection_id IS NULL')
        .run(defaultIds.stage);
    });
    tx();
  }

  peekMediaAssetType(itemId: Id): MediaAssetType | null {
    for (const table of MEDIA_ASSET_TABLES) {
      const row = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(itemId) as { id: string } | undefined;
      if (row) return MEDIA_TYPE_BY_TABLE[table];
    }
    return null;
  }

  private getCollectionBinKindByCollectionId(collectionId: Id): CollectionBinKind | null {
    for (const bin of COLLECTION_BIN_KINDS) {
      const table = COLLECTION_TABLE_BY_BIN[bin];
      const row = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(collectionId) as { id: string } | undefined;
      if (row) return bin;
    }
    return null;
  }

  private getCollections(): Collection[] {
    const out: Collection[] = [];
    for (const bin of COLLECTION_BIN_KINDS) {
      const table = COLLECTION_TABLE_BY_BIN[bin];
      const rows = this.db
        .prepare(`SELECT id, name, order_index, is_default, created_at, updated_at FROM ${table} ORDER BY order_index ASC, created_at ASC`)
        .all() as Array<{
        id: string;
        name: string;
        order_index: number;
        is_default: number;
        created_at: string;
        updated_at: string;
      }>;
      for (const row of rows) {
        out.push({
          id: row.id,
          binKind: bin,
          name: row.name,
          order: row.order_index,
          isDefault: row.is_default === 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }
    }
    return out;
  }

  private getCollectionsByIds(ids: Id[]): Collection[] {
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    return this.getCollections().filter((collection) => idSet.has(collection.id));
  }

  createCollection(input: CollectionCreateInput): SnapshotPatch {
    const table = COLLECTION_TABLE_BY_BIN[input.binKind];
    const now = nowIso();
    const id = createId();
    const nextOrder =
      ((this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM ${table}`).get() as { maxOrder: number | null }).maxOrder ?? -1) + 1;
    this.db
      .prepare(`INSERT INTO ${table} (id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, input.name, nextOrder, 0, now, now);
    return this.buildPatch({ upsertCollectionIds: [id] });
  }

  renameCollection(input: CollectionRenameInput): SnapshotPatch {
    const table = COLLECTION_TABLE_BY_BIN[input.binKind];
    const existing = this.db.prepare(`SELECT id, is_default FROM ${table} WHERE id = ?`).get(input.id) as
      | { id: string; is_default: number }
      | undefined;
    if (!existing) return this.buildPatch({});
    if (existing.is_default === 1) {
      throw new Error('Default collection cannot be renamed');
    }
    this.db
      .prepare(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`)
      .run(input.name, nowIso(), input.id);
    return this.buildPatch({ upsertCollectionIds: [input.id] });
  }

  deleteCollection(input: CollectionDeleteInput): SnapshotPatch {
    const table = COLLECTION_TABLE_BY_BIN[input.binKind];
    const existing = this.db.prepare(`SELECT id, is_default FROM ${table} WHERE id = ?`).get(input.id) as
      | { id: string; is_default: number }
      | undefined;
    if (!existing) return this.buildPatch({});
    if (existing.is_default === 1) {
      throw new Error('Default collection cannot be deleted');
    }

    const defaultId = this.getDefaultCollectionId(input.binKind);
    const movedIds = this.reassignItemsForCollection(input.binKind, input.id, defaultId);

    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(input.id);

    return this.buildPatch({
      deletedCollectionIds: [input.id],
      upsertPresentationIds: movedIds.presentations,
      upsertLyricIds: movedIds.lyrics,
      upsertMediaAssetIds: movedIds.mediaAssets,
      upsertThemeIds: movedIds.themes,
      upsertOverlayIds: movedIds.overlays,
      upsertStageIds: movedIds.stages,
    });
  }

  reorderCollections(input: CollectionReorderInput): SnapshotPatch {
    const table = COLLECTION_TABLE_BY_BIN[input.binKind];
    const now = nowIso();
    const tx = this.db.transaction(() => {
      input.ids.forEach((id, index) => {
        this.db.prepare(`UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ?`).run(index, now, id);
      });
    });
    tx();
    return this.buildPatch({ upsertCollectionIds: input.ids });
  }

  setItemCollection(input: CollectionAssignmentInput): SnapshotPatch {
    const itemTable = ITEM_TABLE_BY_TYPE[input.itemType];
    const exists = this.db.prepare(`SELECT id FROM ${itemTable} WHERE id = ?`).get(input.itemId) as
      | { id: string }
      | undefined;
    if (!exists) return this.buildPatch({});

    const targetBin = this.getCollectionBinKindByCollectionId(input.collectionId);
    if (!targetBin) {
      throw new Error(`Unknown target collection: ${input.collectionId}`);
    }
    if (!isItemTypeAllowedInBin(input.itemType, targetBin, input.itemId, this)) {
      throw new Error(`Item type ${input.itemType} cannot be moved into bin ${targetBin}`);
    }

    this.db
      .prepare(`UPDATE ${itemTable} SET collection_id = ?, updated_at = ? WHERE id = ?`)
      .run(input.collectionId, nowIso(), input.itemId);

    return this.buildPatch(buildPatchSpecForItemType(input.itemType, input.itemId));
  }

  private reassignItemsForCollection(
    binKind: CollectionBinKind,
    fromCollectionId: Id,
    toCollectionId: Id,
  ): {
    presentations: Id[];
    lyrics: Id[];
    mediaAssets: Id[];
    themes: Id[];
    overlays: Id[];
    stages: Id[];
  } {
    const moved = {
      presentations: [] as Id[],
      lyrics: [] as Id[],
      mediaAssets: [] as Id[],
      themes: [] as Id[],
      overlays: [] as Id[],
      stages: [] as Id[],
    };
    const now = nowIso();

    const reassign = (table: string, bucket: Id[]) => {
      const rows = this.db.prepare(`SELECT id FROM ${table} WHERE collection_id = ?`).all(fromCollectionId) as Array<{ id: string }>;
      for (const row of rows) {
        bucket.push(row.id);
      }
      this.db
        .prepare(`UPDATE ${table} SET collection_id = ?, updated_at = ? WHERE collection_id = ?`)
        .run(toCollectionId, now, fromCollectionId);
    };

    switch (binKind) {
      case 'deck':
        reassign('presentations', moved.presentations);
        reassign('lyrics', moved.lyrics);
        break;
      case 'image':
        reassign('image_assets', moved.mediaAssets);
        break;
      case 'video':
        reassign('video_assets', moved.mediaAssets);
        break;
      case 'audio':
        reassign('audio_assets', moved.mediaAssets);
        break;
      case 'theme':
        reassign('themes', moved.themes);
        break;
      case 'overlay':
        reassign('overlays', moved.overlays);
        break;
      case 'stage':
        reassign('stages', moved.stages);
        break;
    }

    return moved;
  }

  private ensurePresentationThemeSchema(): void {
    const presentationColumns = this.db.prepare('PRAGMA table_info(presentations)').all() as Array<{ name: string }>;
    if (!presentationColumns.some((column) => column.name === 'theme_id')) {
      this.db.prepare('ALTER TABLE presentations ADD COLUMN theme_id TEXT').run();
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_presentations_theme_id ON presentations(theme_id)');
  }

  private prepareLegacySchema(): void {
    this.createLegacySchema();
    this.ensureOrderingColumns();
    this.ensureSlideNotesColumn();
    this.ensureOverlayCompositionColumns();
    this.migrateMediaSrcProtocol();
  }

  private migrateLegacyProjectContentToGlobalScope(): void {
    const previousForeignKeys = this.db.pragma('foreign_keys', { simple: true }) as number;
    this.db.pragma('foreign_keys = OFF');

    try {
      const tx = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE presentations_v3 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'canvas',
            theme_id TEXT,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE media_assets_v3 (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            src TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE overlays_v3 (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            x REAL NOT NULL,
            y REAL NOT NULL,
            width REAL NOT NULL,
            height REAL NOT NULL,
            opacity REAL NOT NULL,
            z_index INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            payload_json TEXT NOT NULL,
            elements_json TEXT NOT NULL DEFAULT '[]',
            animation_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);

        this.db.exec(`
          INSERT INTO presentations_v3 (id, title, kind, theme_id, order_index, created_at, updated_at)
          SELECT
            p.id,
            p.title,
            p.kind,
            NULL,
            ROW_NUMBER() OVER (
              ORDER BY
                COALESCE(l.created_at, p.created_at) ASC,
                COALESCE(lp.order_index, 0) ASC,
                p.order_index ASC,
                p.created_at ASC,
                p.id ASC
            ) - 1,
            p.created_at,
            p.updated_at
          FROM presentations p
          LEFT JOIN libraries l ON l.id = p.library_id
          LEFT JOIN (
            SELECT library_id, MIN(order_index) AS order_index
            FROM playlists
            GROUP BY library_id
          ) lp ON lp.library_id = p.library_id;

          INSERT INTO media_assets_v3 (id, name, type, src, created_at, updated_at)
          SELECT id, name, type, src, created_at, updated_at
          FROM media_assets
          ORDER BY created_at ASC, id ASC;

          INSERT INTO overlays_v3 (id, name, type, x, y, width, height, opacity, z_index, enabled, payload_json, elements_json, animation_json, created_at, updated_at)
          SELECT id, name, type, x, y, width, height, opacity, z_index, enabled, payload_json, elements_json, animation_json, created_at, updated_at
          FROM overlays
          ORDER BY created_at ASC, id ASC;
        `);

        this.db.exec(`
          DROP INDEX IF EXISTS idx_presentations_library_id;
          DROP INDEX IF EXISTS idx_media_assets_library_id;
          DROP INDEX IF EXISTS idx_overlays_library_id;

          DROP TABLE overlays;
          DROP TABLE media_assets;
          DROP TABLE presentations;

          ALTER TABLE presentations_v3 RENAME TO presentations;
          ALTER TABLE media_assets_v3 RENAME TO media_assets;
          ALTER TABLE overlays_v3 RENAME TO overlays;
        `);

        this.setUserVersion(GLOBAL_SCHEMA_VERSION);
      });

      tx();
    } finally {
      this.db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    }
  }

  private migratePresentationSchemaToDeckItems(): void {
    const previousForeignKeys = this.db.pragma('foreign_keys', { simple: true }) as number;
    this.db.pragma('foreign_keys = OFF');

    try {
      const tx = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE decks_v6 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            theme_id TEXT,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE lyrics_v6 (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            theme_id TEXT,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE slides_v6 (
            id TEXT PRIMARY KEY,
            presentation_id TEXT,
            lyric_id TEXT,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            order_index INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE playlist_entries_v6 (
            id TEXT PRIMARY KEY,
            segment_id TEXT NOT NULL,
            presentation_id TEXT,
            lyric_id TEXT,
            order_index INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
        `);

        this.db.exec(`
          INSERT INTO decks_v6 (id, title, theme_id, order_index, created_at, updated_at)
          SELECT id, title, theme_id, order_index, created_at, updated_at
          FROM presentations
          WHERE kind != 'lyrics'
          ORDER BY order_index ASC, created_at ASC, id ASC;

          INSERT INTO lyrics_v6 (id, title, theme_id, order_index, created_at, updated_at)
          SELECT id, title, theme_id, order_index, created_at, updated_at
          FROM presentations
          WHERE kind = 'lyrics'
          ORDER BY order_index ASC, created_at ASC, id ASC;

          INSERT INTO slides_v6 (id, presentation_id, lyric_id, width, height, notes, order_index, created_at, updated_at)
          SELECT
            s.id,
            CASE WHEN p.kind = 'lyrics' THEN NULL ELSE s.presentation_id END,
            CASE WHEN p.kind = 'lyrics' THEN s.presentation_id ELSE NULL END,
            s.width,
            s.height,
            s.notes,
            s.order_index,
            s.created_at,
            s.updated_at
          FROM slides s
          JOIN presentations p ON p.id = s.presentation_id
          ORDER BY s.created_at ASC, s.id ASC;

          INSERT INTO playlist_entries_v6 (id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at)
          SELECT
            pe.id,
            pe.segment_id,
            CASE WHEN p.kind = 'lyrics' THEN NULL ELSE pe.presentation_id END,
            CASE WHEN p.kind = 'lyrics' THEN pe.presentation_id ELSE NULL END,
            pe.order_index,
            pe.created_at,
            pe.updated_at
          FROM playlist_entries pe
          JOIN presentations p ON p.id = pe.presentation_id
          ORDER BY pe.created_at ASC, pe.id ASC;
        `);

        this.db.exec(`
          DROP INDEX IF EXISTS idx_slides_presentation_id;
          DROP INDEX IF EXISTS idx_playlist_entries_presentation_id;
          DROP INDEX IF EXISTS idx_presentations_order_index;
          DROP INDEX IF EXISTS idx_presentations_theme_id;

          DROP TABLE playlist_entries;
          DROP TABLE slides;
          DROP TABLE presentations;

          ALTER TABLE decks_v6 RENAME TO presentations;
          ALTER TABLE lyrics_v6 RENAME TO lyrics;
          ALTER TABLE slides_v6 RENAME TO slides;
          ALTER TABLE playlist_entries_v6 RENAME TO playlist_entries;
        `);

        this.createCommonIndexes();
        this.createGlobalContentIndexes();
      });

      tx();
    } finally {
      this.db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    }
  }

  private seedIfEmpty(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM libraries').get() as { count: number };
    if (count.count > 0) return;

    const libraryId = createId();
    const presentationId = createId();
    const slideId = createId();
    const playlistId = createId();
    const segmentId = createId();
    const now = nowIso();

    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO libraries (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(libraryId, 'Church Library', now, now);

      const deckCollectionId = this.getDefaultCollectionId('deck');
      this.db
        .prepare('INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(presentationId, 'Welcome Slides', null, deckCollectionId, 0, now, now);

      this.db
        .prepare(
          'INSERT INTO slides (id, presentation_id, lyric_id, kind, width, height, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(slideId, presentationId, null, 'presentation', DEFAULT_W, DEFAULT_H, '', 0, now, now);

      const titlePayload = JSON.stringify({
        text: 'Welcome to LumaCast',
        fontFamily: 'Helvetica',
        fontSize: 64,
        color: '#FFFFFF',
        alignment: 'center',
        weight: '700'
      });

      this.db
        .prepare(
          `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(createId(), slideId, 'text', 200, 430, 1520, 120, 0, 1, 10, 'content', titlePayload, now, now);

      const shapePayload = JSON.stringify({
        fillColor: '#101820CC',
        borderColor: '#FFFFFF33',
        borderWidth: 2,
        borderRadius: 12
      });

      this.db
        .prepare(
          `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(createId(), slideId, 'shape', 160, 380, 1600, 220, 0, 1, 1, 'background', shapePayload, now, now);

      this.db
        .prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(playlistId, libraryId, 'Sunday Service', 0, now, now);

      this.db
        .prepare(
          'INSERT INTO playlist_segments (id, playlist_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(segmentId, playlistId, 'Opening', 0, now, now);

      this.db
        .prepare(
          'INSERT INTO playlist_entries (id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(createId(), segmentId, presentationId, null, 0, now, now);

      const overlayCollectionId = this.getDefaultCollectionId('overlay');
      const overlayId = createId();
      const overlaySlideId = `${overlayId}:slide`;
      this.db
        .prepare(
          `INSERT INTO overlays (id, name, enabled, animation_json, collection_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          overlayId,
          'Watermark',
          1,
          JSON.stringify({ kind: 'pulse', durationMs: 2000 }),
          overlayCollectionId,
          now,
          now,
        );
      this.createContainerSlide(overlaySlideId, 'overlay', overlayId, DEFAULT_W, DEFAULT_H, now);
      this.db
        .prepare(
          `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          createId(),
          overlaySlideId,
          'text',
          1540,
          1010,
          340,
          40,
          0,
          0.65,
          999,
          'content',
          JSON.stringify({
            text: 'CAST INTERFACE',
            fontFamily: 'Helvetica',
            fontSize: 28,
            color: '#FFFFFF',
            alignment: 'right',
            weight: '600',
          }),
          now,
          now,
        );
    });

    tx();
  }

  private migrateMediaSrcProtocol(): void {
    const tx = this.db.transaction(() => {
      const assets = this.db
        .prepare("SELECT id, src FROM media_assets WHERE src LIKE 'cast-media://%' OR src LIKE 'file://%' OR src LIKE 'blob:%'")
        .all() as Array<{ id: string; src: string }>;

      const updateAsset = this.db.prepare('UPDATE media_assets SET src = ? WHERE id = ?');
      const deleteAsset = this.db.prepare('DELETE FROM media_assets WHERE id = ?');
      for (const asset of assets) {
        const newSrc = toCastMediaSource(asset.src);
        if (!newSrc) {
          deleteAsset.run(asset.id);
          continue;
        }
        if (newSrc !== asset.src) {
          updateAsset.run(newSrc, asset.id);
        }
      }

      const elements = this.db
        .prepare("SELECT id, payload_json FROM slide_elements WHERE type IN ('image', 'video') AND (payload_json LIKE '%cast-media://%' OR payload_json LIKE '%file://%' OR payload_json LIKE '%blob:%')")
        .all() as Array<{ id: string; payload_json: string }>;

      const updateElement = this.db.prepare('UPDATE slide_elements SET payload_json = ? WHERE id = ?');
      const deleteElement = this.db.prepare('DELETE FROM slide_elements WHERE id = ?');
      for (const el of elements) {
        const payload = parseJson<{ src: string }>(el.payload_json);
        const newSrc = toCastMediaSource(payload.src);
        if (newSrc) {
          if (newSrc === payload.src) continue;
          payload.src = newSrc;
          updateElement.run(JSON.stringify(payload), el.id);
        } else {
          deleteElement.run(el.id);
        }
      }
    });

    tx();
  }

  private ensureOrderingColumns(): void {
    const presentationColumns = this.db.prepare('PRAGMA table_info(presentations)').all() as Array<{ name: string }>;
    if (!presentationColumns.some((column) => column.name === 'order_index')) {
      this.db.prepare('ALTER TABLE presentations ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0').run();
      this.db
        .prepare(
          `WITH ranked AS (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY library_id ORDER BY created_at ASC, id ASC) - 1 AS next_order
             FROM presentations
           )
           UPDATE presentations
           SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = presentations.id)`
        )
        .run();
    }
    if (!presentationColumns.some((column) => column.name === 'kind')) {
      this.db.prepare("ALTER TABLE presentations ADD COLUMN kind TEXT NOT NULL DEFAULT 'canvas'").run();
    }

    const playlistColumns = this.db.prepare('PRAGMA table_info(playlists)').all() as Array<{ name: string }>;
    if (!playlistColumns.some((column) => column.name === 'order_index')) {
      this.db.prepare('ALTER TABLE playlists ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0').run();
      this.db
        .prepare(
          `WITH ranked AS (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY library_id ORDER BY created_at ASC, id ASC) - 1 AS next_order
             FROM playlists
           )
           UPDATE playlists
           SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = playlists.id)`
        )
        .run();
    }

    const segmentColumns = this.db.prepare('PRAGMA table_info(playlist_segments)').all() as Array<{ name: string }>;
    if (!segmentColumns.some((column) => column.name === 'color_key')) {
      this.db.prepare('ALTER TABLE playlist_segments ADD COLUMN color_key TEXT').run();
    }
  }

  private ensureOverlayCompositionColumns(): void {
    const overlayColumns = this.db.prepare('PRAGMA table_info(overlays)').all() as Array<{ name: string }>;
    if (!overlayColumns.some((column) => column.name === 'elements_json')) {
      this.db.prepare("ALTER TABLE overlays ADD COLUMN elements_json TEXT NOT NULL DEFAULT '[]'").run();
    }

    const rows = this.db
      .prepare(
        `SELECT id, type, x, y, width, height, opacity, z_index, payload_json, created_at, updated_at, elements_json
         FROM overlays`
      )
      .all() as Array<{
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
      elements_json: string | null;
    }>;

    const updateElements = this.db.prepare('UPDATE overlays SET elements_json = ? WHERE id = ?');
    for (const row of rows) {
      if (row.elements_json) continue;
      updateElements.run(JSON.stringify([legacyOverlayElement(row)]), row.id);
    }
  }

  private ensureSlideNotesColumn(): void {
    const slideColumns = this.db.prepare('PRAGMA table_info(slides)').all() as Array<{ name: string }>;
    if (!slideColumns.some((column) => column.name === 'notes')) {
      this.db.prepare("ALTER TABLE slides ADD COLUMN notes TEXT NOT NULL DEFAULT ''").run();
    }
  }

  getSnapshot(): AppSnapshot {
    const libraries = this.getLibraries();
    const presentations = this.getPresentations();
    const lyrics = this.getLyrics();
    const itemsById = new Map<Id, DeckItem>([
      ...presentations.map((deck) => [deck.id, deck] as const),
      ...lyrics.map((lyric) => [lyric.id, lyric] as const),
    ]);
    const libraryBundles = libraries.map((library) => ({
      library,
      playlists: this.getPlaylistTreesByLibrary(library.id, itemsById)
    }));

    return {
      libraries,
      libraryBundles,
      presentations,
      lyrics,
      slides: this.getSlides(),
      slideElements: this.getSlideElements(),
      mediaAssets: this.getMediaAssets(),
      overlays: this.getOverlays(),
      themes: this.getThemes(),
      stages: this.getStages(),
      collections: this.getCollections(),
    };
  }

  /**
   * Wipe every data table and re-insert the rows described by `snapshot`.
   * Used by global undo/redo: the renderer holds the pre-mutation snapshot
   * and asks the repo to swap the on-disk state to match. Wrapped in a
   * single transaction so a partial failure rolls back to the prior state.
   */
  restoreFromSnapshot(snapshot: AppSnapshot): AppSnapshot {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM playlist_entries;
        DELETE FROM slide_elements;
        DELETE FROM slides;
        DELETE FROM overlays;
        DELETE FROM themes;
        DELETE FROM stages;
        DELETE FROM playlist_segments;
        DELETE FROM playlists;
        DELETE FROM presentations;
        DELETE FROM lyrics;
        DELETE FROM image_assets;
        DELETE FROM video_assets;
        DELETE FROM audio_assets;
        DELETE FROM libraries;
      `);

      const insertLibrary = this.db.prepare(
        'INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      for (const library of snapshot.libraries) {
        insertLibrary.run(library.id, library.name, library.order, library.createdAt, library.updatedAt);
      }

      const insertTheme = this.db.prepare(
        `INSERT INTO themes (id, name, kind, width, height, order_index, collection_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const theme of snapshot.themes) {
        const themeSlideId = theme.slideId ?? `${theme.id}:slide`;
        insertTheme.run(
          theme.id,
          theme.name,
          theme.kind,
          theme.width,
          theme.height,
          theme.order,
          theme.collectionId,
          theme.createdAt,
          theme.updatedAt,
        );
        this.createContainerSlide(themeSlideId, 'theme', theme.id, theme.width, theme.height, theme.createdAt);
        this.replaceContainerElements(themeSlideId, theme.elements, theme.updatedAt);
      }

      const insertPresentation = this.db.prepare(
        'INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const presentation of snapshot.presentations) {
        insertPresentation.run(
          presentation.id,
          presentation.title,
          presentation.themeId ?? null,
          presentation.collectionId,
          presentation.order,
          presentation.createdAt,
          presentation.updatedAt,
        );
      }

      const insertLyric = this.db.prepare(
        'INSERT INTO lyrics (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const lyric of snapshot.lyrics) {
        insertLyric.run(
          lyric.id,
          lyric.title,
          lyric.themeId ?? null,
          lyric.collectionId,
          lyric.order,
          lyric.createdAt,
          lyric.updatedAt,
        );
      }

      const insertSlide = this.db.prepare(
        `INSERT INTO slides (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const slide of snapshot.slides) {
        insertSlide.run(
          slide.id,
          slide.presentationId,
          slide.lyricId,
          slide.themeId ?? null,
          slide.overlayId ?? null,
          slide.stageId ?? null,
          slide.kind ?? (slide.lyricId ? 'lyric' : 'presentation'),
          slide.width,
          slide.height,
          slide.notes,
          slide.order,
          slide.createdAt,
          slide.updatedAt,
        );
      }

      const insertSlideElement = this.db.prepare(
        `INSERT INTO slide_elements
          (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const element of snapshot.slideElements) {
        insertSlideElement.run(
          element.id,
          element.slideId,
          element.type,
          element.x,
          element.y,
          element.width,
          element.height,
          element.rotation,
          element.opacity,
          element.zIndex,
          element.layer,
          JSON.stringify(element.payload),
          element.createdAt,
          element.updatedAt,
        );
      }

      const insertPlaylist = this.db.prepare(
        'INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertSegment = this.db.prepare(
        'INSERT INTO playlist_segments (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertEntry = this.db.prepare(
        'INSERT INTO playlist_entries (id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const bundle of snapshot.libraryBundles) {
        for (const tree of bundle.playlists) {
          insertPlaylist.run(
            tree.playlist.id,
            tree.playlist.libraryId,
            tree.playlist.name,
            tree.playlist.order,
            tree.playlist.createdAt,
            tree.playlist.updatedAt,
          );
          for (const { segment, entries } of tree.segments) {
            insertSegment.run(
              segment.id,
              segment.playlistId,
              segment.name,
              segment.colorKey,
              segment.order,
              segment.createdAt,
              segment.updatedAt,
            );
            for (const { entry } of entries) {
              insertEntry.run(
                entry.id,
                entry.segmentId,
                entry.presentationId,
                entry.lyricId,
                entry.order,
                entry.createdAt,
                entry.updatedAt,
              );
            }
          }
        }
      }

      const insertImageAsset = this.db.prepare(
        'INSERT INTO image_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertVideoAsset = this.db.prepare(
        'INSERT INTO video_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertAudioAsset = this.db.prepare(
        'INSERT INTO audio_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const asset of snapshot.mediaAssets) {
        const stmt = asset.type === 'image' ? insertImageAsset : asset.type === 'video' ? insertVideoAsset : insertAudioAsset;
        stmt.run(
          asset.id,
          asset.name,
          asset.src,
          asset.collectionId,
          asset.order,
          asset.createdAt,
          asset.updatedAt,
        );
      }

      const insertOverlay = this.db.prepare(
        `INSERT INTO overlays
          (id, name, enabled, animation_json, collection_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const overlay of snapshot.overlays) {
        const overlaySlideId = overlay.slideId ?? `${overlay.id}:slide`;
        insertOverlay.run(
          overlay.id,
          overlay.name,
          overlay.enabled ? 1 : 0,
          JSON.stringify(overlay.animation),
          overlay.collectionId,
          overlay.createdAt,
          overlay.updatedAt,
        );
        this.createContainerSlide(overlaySlideId, 'overlay', overlay.id, DEFAULT_W, DEFAULT_H, overlay.createdAt);
        this.replaceContainerElements(overlaySlideId, overlay.elements, overlay.updatedAt);
      }

      const insertStage = this.db.prepare(
        `INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const stage of snapshot.stages) {
        const stageSlideId = stage.slideId ?? `${stage.id}:slide`;
        insertStage.run(
          stage.id,
          stage.name,
          stage.width,
          stage.height,
          stage.order,
          stage.collectionId,
          stage.createdAt,
          stage.updatedAt,
        );
        this.createContainerSlide(stageSlideId, 'stage', stage.id, stage.width, stage.height, stage.createdAt);
        this.replaceContainerElements(stageSlideId, stage.elements, stage.updatedAt);
      }
    });
    tx();
    this.patchVersion += 1;
    return this.getSnapshot();
  }

  exportDeckBundle(itemIds: Id[], options: DeckBundleExportOptions = {}): DeckBundleManifest {
    const uniqueIds = Array.from(new Set(itemIds));
    const items = uniqueIds
      .map((itemId) => this.getDeckBundleItemById(itemId))
      .filter((item): item is DeckBundleItem => item !== null)
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));

    const themes = options.includeAllThemes
      ? this.getThemes().map(toDeckBundleTheme)
      : Array.from(new Set(items.map((item) => item.themeId).filter((id): id is Id => Boolean(id))))
          .map((themeId) => this.getDeckBundleThemeById(themeId))
          .filter((theme): theme is DeckBundleTheme => theme !== null)
          .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

    const overlays = options.includeOverlays
      ? this.getOverlays().map(toDeckBundleOverlay)
      : [];

    const stages = options.includeStages
      ? this.getStages().map(toDeckBundleStage)
      : [];

    return {
      format: 'cast-deck-bundle',
      version: 1,
      exportedAt: nowIso(),
      items,
      themes,
      overlays,
      stages,
      mediaReferences: collectDeckBundleMediaReferences(items, themes, overlays, stages),
    };
  }

  inspectImportBundle(manifest: DeckBundleManifest): DeckBundleInspection {
    this.assertValidDeckBundleManifest(manifest);
    const normalizedManifest = cloneDeckBundleManifest(manifest);
    const overlays = normalizedManifest.overlays ?? [];
    const stages = normalizedManifest.stages ?? [];
    const mediaReferences = collectDeckBundleMediaReferences(
      normalizedManifest.items,
      normalizedManifest.themes,
      overlays,
      stages,
    );
    const brokenReferences = this.collectBrokenBundleReferences(normalizedManifest);

    return {
      exportedAt: normalizedManifest.exportedAt,
      itemCount: normalizedManifest.items.length,
      themeCount: normalizedManifest.themes.length,
      mediaReferenceCount: mediaReferences.length,
      overlayCount: overlays.length,
      stageCount: stages.length,
      items: normalizedManifest.items
        .map((item) => ({
          id: item.id,
          title: item.title,
          type: item.type,
          slideCount: item.slides.length,
          themeId: item.themeId,
        }))
        .sort((left, right) => left.title.localeCompare(right.title)),
      themes: normalizedManifest.themes
        .map((theme): DeckBundleInspectionTheme => ({
          id: theme.id,
          name: theme.name,
          kind: theme.kind,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      overlays: overlays
        .map((overlay): DeckBundleInspectionOverlay => ({ id: overlay.id, name: overlay.name, type: overlay.type }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      stages: stages
        .map((stage): DeckBundleInspectionStage => ({ id: stage.id, name: stage.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      mediaReferences,
      brokenReferences,
    };
  }

  finalizeImportBundle(manifest: DeckBundleManifest, decisions: DeckBundleBrokenReferenceDecision[]): AppSnapshot {
    this.assertValidDeckBundleManifest(manifest);
    const workingManifest = cloneDeckBundleManifest(manifest);
    const brokenReferences = this.collectBrokenBundleReferences(workingManifest);
    const decisionMap = new Map(decisions.map((decision) => [decision.source, decision]));

    for (const reference of brokenReferences) {
      const decision = decisionMap.get(reference.source);
      if (!decision) {
        throw new Error(`Missing import decision for broken source: ${reference.source}`);
      }
      if (decision.action === 'replace' && !decision.replacementPath) {
        throw new Error(`Replacement path is required for ${reference.source}`);
      }
    }

    this.applyBrokenReferenceDecisions(workingManifest, decisionMap);

    const now = nowIso();
    const nextThemeOrder = this.getNextThemeOrderIndex();
    const nextContentOrder = this.getMaxDeckOrder() + 1;
    const nextMediaAssetOrder = this.getNextMediaAssetOrderIndex();
    const normalizedReplacementSources = this.collectReplacementMediaSources(brokenReferences, decisionMap);

    const insertTheme = this.db.prepare(
      `INSERT INTO themes
        (id, name, kind, width, height, order_index, collection_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertPresentation = this.db.prepare(
      'INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertLyric = this.db.prepare(
      'INSERT INTO lyrics (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertSlide = this.db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertImageAsset = this.db.prepare(
      'INSERT INTO image_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertVideoAsset = this.db.prepare(
      'INSERT INTO video_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertAudioAsset = this.db.prepare(
      'INSERT INTO audio_assets (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertMediaAsset = (id: Id, name: string, type: MediaAssetType, src: string, collectionId: Id, order: number, createdAt: string, updatedAt: string): void => {
      const stmt = type === 'image' ? insertImageAsset : type === 'video' ? insertVideoAsset : insertAudioAsset;
      stmt.run(id, name, src, collectionId, order, createdAt, updatedAt);
    };
    const insertOverlay = this.db.prepare(
      `INSERT INTO overlays
       (id, name, enabled, animation_json, collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insertStage = this.db.prepare(
      `INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const nextStageOrder = (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM stages').get() as { next_order: number }).next_order;
    const importDeckCollectionId = this.getDefaultCollectionId('deck');
    const importThemeCollectionId = this.getDefaultCollectionId('theme');
    const importOverlayCollectionId = this.getDefaultCollectionId('overlay');
    const importStageCollectionId = this.getDefaultCollectionId('stage');

    const tx = this.db.transaction(() => {
      const themeIdMap = new Map<Id, Id>();
      const replacementAssetKeys = new Set<string>();

      workingManifest.themes
        .slice()
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
        .forEach((theme, index) => {
          const newThemeId = createId();
          const newThemeSlideId = `${newThemeId}:slide`;
          themeIdMap.set(theme.id, newThemeId);
          const nextElements = theme.elements.map((element, elementIndex) =>
            this.createImportedThemeElement(element, newThemeSlideId, now, elementIndex)
          );
          insertTheme.run(
            newThemeId,
            theme.name,
            this.normalizeThemeKind(theme.kind),
            theme.width,
            theme.height,
            nextThemeOrder + index,
            importThemeCollectionId,
            now,
            now,
          );
          this.createContainerSlide(newThemeSlideId, 'theme', newThemeId, theme.width, theme.height, now);
          this.replaceContainerElements(newThemeSlideId, nextElements, now);
        });

      normalizedReplacementSources.forEach((replacementSource, replacementIndex) => {
        const assetType = this.inferImportedMediaAssetType(replacementSource.elementTypes, replacementSource.src);
        const assetKey = `${replacementSource.src}:${assetType}`;
        if (replacementAssetKeys.has(assetKey)) return;
        replacementAssetKeys.add(assetKey);
        insertMediaAsset(
          createId(),
          path.basename(replacementSource.rawPath),
          assetType,
          replacementSource.src,
          this.getMediaAssetDefaultCollectionId(assetType),
          nextMediaAssetOrder + replacementIndex,
          now,
          now,
        );
      });

      workingManifest.items
        .slice()
        .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
        .forEach((item, itemIndex) => {
          const newItemId = createId();
          const importedThemeId = item.themeId ? themeIdMap.get(item.themeId) ?? null : null;
          if (item.themeId && !importedThemeId) {
            throw new Error(`Missing imported theme for ${item.title}`);
          }
          if (importedThemeId) {
            const importedTheme = workingManifest.themes.find((theme) => theme.id === item.themeId) ?? null;
            if (!importedTheme || !isThemeCompatibleWithDeckItem(importedTheme as Theme, item.type)) {
              throw new Error(`Theme ${item.themeId} is incompatible with ${item.title}`);
            }
          }

          if (item.type === 'presentation') {
            insertPresentation.run(newItemId, item.title, importedThemeId, importDeckCollectionId, nextContentOrder + itemIndex, now, now);
          } else {
            insertLyric.run(newItemId, item.title, importedThemeId, importDeckCollectionId, nextContentOrder + itemIndex, now, now);
          }

          item.slides
            .slice()
            .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
            .forEach((slide, slideIndex) => {
              const newSlideId = createId();
              insertSlide.run(
                newSlideId,
                item.type === 'presentation' ? newItemId : null,
                item.type === 'lyric' ? newItemId : null,
                null,
                null,
                null,
                item.type,
                slide.width,
                slide.height,
                slide.notes,
                slideIndex,
                now,
                now,
              );

              slide.elements.forEach((element, elementIndex) => {
                const nextElement = this.createImportedSlideElement(element, newSlideId, now, elementIndex);
                insertElement.run(
                  nextElement.id,
                  newSlideId,
                  nextElement.type,
                  nextElement.x,
                  nextElement.y,
                  nextElement.width,
                  nextElement.height,
                  nextElement.rotation,
                  nextElement.opacity,
                  nextElement.zIndex,
                  nextElement.layer,
                  JSON.stringify(nextElement.payload),
                  now,
                  now,
                );
              });
            });
        });

      (workingManifest.overlays ?? []).forEach((overlay) => {
        const newOverlayId = createId();
        const newOverlaySlideId = `${newOverlayId}:slide`;
        insertOverlay.run(
          newOverlayId,
          overlay.name,
          overlay.enabled ? 1 : 0,
          JSON.stringify(normalizeOverlayAnimation(overlay.animation)),
          importOverlayCollectionId,
          now,
          now,
        );
        this.createContainerSlide(newOverlaySlideId, 'overlay', newOverlayId, DEFAULT_W, DEFAULT_H, now);
        this.replaceContainerElements(newOverlaySlideId, overlay.elements, now);
      });

      (workingManifest.stages ?? []).forEach((stage, stageIndex) => {
        const newStageId = createId();
        const newStageSlideId = `${newStageId}:slide`;
        insertStage.run(
          newStageId,
          stage.name,
          stage.width,
          stage.height,
          nextStageOrder + stageIndex,
          importStageCollectionId,
          now,
          now,
        );
        this.createContainerSlide(newStageSlideId, 'stage', newStageId, stage.width, stage.height, now);
        this.replaceContainerElements(newStageSlideId, stage.elements, now);
      });
    });

    tx();
    return this.getSnapshot();
  }

  createLibrary(name: string): SnapshotPatch {
    const now = nowIso();
    const libraryId = createId();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM libraries').get() as {
        maxOrder: number | null;
      }).maxOrder ?? -1;
    this.db
      .prepare('INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(libraryId, name, currentOrder + 1, now, now);
    return this.buildPatch({ upsertLibraryIds: [libraryId], replaceLibraryBundles: true });
  }

  createPlaylist(libraryId: Id, name: string): SnapshotPatch {
    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlists WHERE library_id = ?').get(libraryId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;
    this.db
      .prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(createId(), libraryId, name, currentOrder + 1, now, now);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  createPlaylistSegment(playlistId: Id, name: string): SnapshotPatch {
    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_segments WHERE playlist_id = ?').get(playlistId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    this.db
      .prepare(
        'INSERT INTO playlist_segments (id, playlist_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(createId(), playlistId, name, currentOrder + 1, now, now);

    return this.buildPatch({ replaceLibraryBundles: true });
  }

  renamePlaylistSegment(id: Id, name: string): SnapshotPatch {
    this.db
      .prepare('UPDATE playlist_segments SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, nowIso(), id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  setPlaylistSegmentColor(id: Id, colorKey: string | null): SnapshotPatch {
    this.db
      .prepare('UPDATE playlist_segments SET color_key = ?, updated_at = ? WHERE id = ?')
      .run(colorKey, nowIso(), id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  addDeckItemToSegment(segmentId: Id, itemId: Id): SnapshotPatch {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) return this.buildPatch({});

    const exists = this.db
      .prepare('SELECT id FROM playlist_segments WHERE id = ?')
      .get(segmentId) as { id: string } | undefined;

    if (!exists) return this.buildPatch({});

    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE segment_id = ?').get(segmentId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    this.db
      .prepare(
        `INSERT INTO playlist_entries (id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId(),
        segmentId,
        owner.type === 'presentation' ? itemId : null,
        owner.type === 'lyric' ? itemId : null,
        currentOrder + 1,
        now,
        now,
      );

    return this.buildPatch({ replaceLibraryBundles: true });
  }

  moveDeckItemToSegment(playlistId: Id, itemId: Id, segmentId: Id | null): SnapshotPatch {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) return this.buildPatch({});
    const ownerColumn = this.getDeckOwnerColumn(owner.type);

    this.db
      .prepare(
        `DELETE FROM playlist_entries
         WHERE (${ownerColumn} = ?)
         AND segment_id IN (SELECT id FROM playlist_segments WHERE playlist_id = ?)`
      )
      .run(itemId, playlistId);

    if (!segmentId) return this.buildPatch({ replaceLibraryBundles: true });

    const exists = this.db
      .prepare('SELECT id FROM playlist_segments WHERE id = ? AND playlist_id = ?')
      .get(segmentId, playlistId) as { id: string } | undefined;

    if (!exists) return this.buildPatch({ replaceLibraryBundles: true });

    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE segment_id = ?').get(segmentId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    this.db
      .prepare(
        `INSERT INTO playlist_entries (id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId(),
        segmentId,
        owner.type === 'presentation' ? itemId : null,
        owner.type === 'lyric' ? itemId : null,
        currentOrder + 1,
        now,
        now,
      );

    return this.buildPatch({ replaceLibraryBundles: true });
  }

  movePlaylistEntry(entryId: Id, direction: 'up' | 'down'): AppSnapshot {
    const current = this.db
      .prepare('SELECT id, segment_id, order_index FROM playlist_entries WHERE id = ?')
      .get(entryId) as { id: string; segment_id: string; order_index: number } | undefined;

    if (!current) return this.getSnapshot();

    const neighbor = direction === 'up'
      ? this.db
        .prepare(
          'SELECT id, order_index FROM playlist_entries WHERE segment_id = ? AND order_index < ? ORDER BY order_index DESC LIMIT 1'
        )
        .get(current.segment_id, current.order_index)
      : this.db
        .prepare(
          'SELECT id, order_index FROM playlist_entries WHERE segment_id = ? AND order_index > ? ORDER BY order_index ASC LIMIT 1'
        )
        .get(current.segment_id, current.order_index);

    if (!neighbor) return this.getSnapshot();

    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
        .run((neighbor as { order_index: number }).order_index, now, current.id);
      this.db
        .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
        .run(current.order_index, now, (neighbor as { id: string }).id);
    });

    tx();
    return this.getSnapshot();
  }

  movePlaylistEntryToSegment(entryId: Id, segmentId: Id | null): SnapshotPatch {
    const entry = this.db
      .prepare(
        `SELECT pe.id, pe.segment_id, ps.playlist_id
         FROM playlist_entries pe
         JOIN playlist_segments ps ON ps.id = pe.segment_id
         WHERE pe.id = ?`
      )
      .get(entryId) as { id: string; segment_id: string; playlist_id: string } | undefined;

    if (!entry) return this.buildPatch({});

    if (!segmentId) {
      this.db
        .prepare('DELETE FROM playlist_entries WHERE id = ?')
        .run(entryId);
      return this.buildPatch({ replaceLibraryBundles: true });
    }

    const targetSegment = this.db
      .prepare('SELECT id FROM playlist_segments WHERE id = ? AND playlist_id = ?')
      .get(segmentId, entry.playlist_id) as { id: string } | undefined;

    if (!targetSegment) return this.buildPatch({});

    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE segment_id = ?').get(segmentId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    this.db
      .prepare('UPDATE playlist_entries SET segment_id = ?, order_index = ?, updated_at = ? WHERE id = ?')
      .run(segmentId, currentOrder + 1, now, entryId);

    return this.buildPatch({ replaceLibraryBundles: true });
  }

  createPresentation(title: string): SnapshotPatch {
    const now = nowIso();
    const presentationId = createId();
    const currentOrder = this.getMaxDeckOrder();
    const deckCollectionId = this.getDefaultCollectionId('deck');
    this.db
      .prepare('INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(presentationId, title, null, deckCollectionId, currentOrder + 1, now, now);
    return this.buildPatch({ upsertPresentationIds: [presentationId] });
  }

  createLyric(title: string): SnapshotPatch {
    const now = nowIso();
    const lyricId = createId();
    const currentOrder = this.getMaxDeckOrder();
    const deckCollectionId = this.getDefaultCollectionId('deck');
    this.db
      .prepare('INSERT INTO lyrics (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(lyricId, title, null, deckCollectionId, currentOrder + 1, now, now);
    return this.buildPatch({ upsertLyricIds: [lyricId] });
  }

  createTheme(input: ThemeCreateInput): SnapshotPatch {
    const now = nowIso();
    const themeId = createId();
    const slideId = `${themeId}:slide`;
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM themes').get() as { maxOrder: number | null }).maxOrder ?? -1;
    const elements = input.elements
      ? JSON.parse(JSON.stringify(input.elements)) as SlideElement[]
      : createDefaultThemeElements(input.kind, slideId, now);
    const collectionId = input.collectionId ?? this.getDefaultCollectionId('theme');
    const width = input.width ?? DEFAULT_W;
    const height = input.height ?? DEFAULT_H;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO themes
            (id, name, kind, width, height, order_index, collection_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          themeId,
          input.name,
          this.normalizeThemeKind(input.kind),
          width,
          height,
          currentOrder + 1,
          collectionId,
          now,
          now,
        );
      this.createContainerSlide(slideId, 'theme', themeId, width, height, now);
      this.replaceContainerElements(slideId, elements, now);
    });
    tx();
    return this.buildPatch({ upsertThemeIds: [themeId] });
  }

  updateTheme(input: ThemeUpdateInput): SnapshotPatch {
    const existing = this.db
      .prepare('SELECT id, name, kind, width, height FROM themes WHERE id = ?')
      .get(input.id) as {
      id: string;
      name: string;
      kind: string;
      width: number;
      height: number;
    } | undefined;

    if (!existing) return this.buildPatch({});

    const now = nowIso();
    const width = input.width ?? existing.width;
    const height = input.height ?? existing.height;

    const slideId = `${input.id}:slide`;
    const tx = this.db.transaction(() => {
      if (input.elements !== undefined) {
        this.replaceContainerElements(slideId, input.elements, now);
      }
      if (input.width !== undefined || input.height !== undefined) {
        this.updateContainerSlideGeometry(slideId, width, height, now);
      }
      this.db
        .prepare(
          `UPDATE themes
           SET name = ?, kind = ?, width = ?, height = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name ?? existing.name,
          this.normalizeThemeKind(input.kind ?? existing.kind),
          width,
          height,
          now,
          input.id,
        );
    });
    tx();
    return this.buildPatch({ upsertThemeIds: [input.id] });
  }

  deleteTheme(themeId: Id): SnapshotPatch {
    const affectedPresentationIds = (this.db
      .prepare('SELECT id FROM presentations WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>)
      .map((row) => row.id);
    const affectedLyricIds = (this.db
      .prepare('SELECT id FROM lyrics WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>)
      .map((row) => row.id);
    const ownerSlideId = `${themeId}:slide`;
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE presentations SET theme_id = NULL, updated_at = ? WHERE theme_id = ?').run(nowIso(), themeId);
      this.db.prepare('UPDATE lyrics SET theme_id = NULL, updated_at = ? WHERE theme_id = ?').run(nowIso(), themeId);
      // Drop the owning slide first (its theme_id FK references the theme).
      this.deleteContainerSlide(ownerSlideId);
      this.db.prepare('DELETE FROM themes WHERE id = ?').run(themeId);
    });
    tx();
    this.normalizeThemeOrder();
    const remainingThemeIds = (this.db.prepare('SELECT id FROM themes ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    return this.buildPatch({
      upsertPresentationIds: affectedPresentationIds,
      upsertLyricIds: affectedLyricIds,
      upsertThemeIds: remainingThemeIds,
      deletedThemeIds: [themeId],
      replaceLibraryBundles: true,
    });
  }

  applyThemeToDeckItem(themeId: Id, itemId: Id): SnapshotPatch {
    const theme = this.getThemeById(themeId);
    if (!theme) return this.buildPatch({});
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner || !isThemeCompatibleWithDeckItem(theme, owner.type)) {
      return this.buildPatch({});
    }

    const ownerColumn = this.getDeckOwnerColumn(owner.type);
    const ownerTable = this.getDeckTableName(owner.type);

    const slides = this.db
      .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(itemId) as Array<{ id: string }>;
    const selectElements = this.db
      .prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at
         FROM slide_elements
         WHERE slide_id = ?
         ORDER BY layer ASC, z_index ASC, created_at ASC`
      );
    const deleteElements = this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?');
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const deletedElementIds: Id[] = [];
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE ${ownerTable} SET theme_id = ?, updated_at = ? WHERE id = ?`).run(themeId, nowIso(), itemId);
      for (const slide of slides) {
        const currentElements = (selectElements.all(slide.id) as Array<{
          id: string;
          slide_id: string;
          type: SlideElement['type'];
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          opacity: number;
          z_index: number;
          layer: SlideElement['layer'];
          payload_json: string;
          created_at: string;
          updated_at: string;
        }>).map((row) => ({
          id: row.id,
          slideId: row.slide_id,
          type: row.type,
          x: row.x,
          y: row.y,
          width: row.width,
          height: row.height,
          rotation: row.rotation,
          opacity: row.opacity,
          zIndex: row.z_index,
          layer: row.layer,
          payload: parseJson<SlideElementPayload>(row.payload_json),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        const appliedElements = applyThemeToElements(theme, currentElements, slide.id);
        deletedElementIds.push(...currentElements.map((element) => element.id));
        deleteElements.run(slide.id);
        for (const element of appliedElements) {
          insertElement.run(
            element.id,
            slide.id,
            element.type,
            element.x,
            element.y,
            element.width,
            element.height,
            element.rotation,
            element.opacity,
            element.zIndex,
            element.layer,
            JSON.stringify(element.payload),
            element.createdAt,
            nowIso(),
          );
        }
      }
    });

    tx();
    return this.buildPatch({
      upsertPresentationIds: owner.type === 'presentation' ? [itemId] : undefined,
      upsertLyricIds: owner.type === 'lyric' ? [itemId] : undefined,
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds(slides.map((slide) => slide.id)),
      deletedSlideElementIds: deletedElementIds,
      replaceLibraryBundles: true,
    });
  }

  syncThemeToLinkedDeckItems(themeId: Id): SnapshotPatch {
    const theme = this.getThemeById(themeId);
    if (!theme) return this.buildPatch({});

    const presentations = this.db
      .prepare('SELECT id FROM presentations WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>;
    const lyrics = this.db
      .prepare('SELECT id FROM lyrics WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>;

    const linkedItems: Array<{ id: string; type: DeckItemType }> = [
      ...(theme.kind === 'slides' ? presentations.map((row) => ({ id: row.id, type: 'presentation' as DeckItemType })) : []),
      ...(theme.kind === 'lyrics' ? lyrics.map((row) => ({ id: row.id, type: 'lyric' as DeckItemType })) : []),
    ];

    if (linkedItems.length === 0) return this.buildPatch({});

    const selectElements = this.db.prepare(
      `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at
       FROM slide_elements
       WHERE slide_id = ?
       ORDER BY layer ASC, z_index ASC, created_at ASC`
    );
    const deleteElements = this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?');
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const touchedSlideIds: string[] = [];
    const deletedElementIds: Id[] = [];
    const tx = this.db.transaction(() => {
      for (const item of linkedItems) {
        const ownerColumn = this.getDeckOwnerColumn(item.type);
        const slides = this.db
          .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
          .all(item.id) as Array<{ id: string }>;
        for (const slide of slides) {
          const currentElements = (selectElements.all(slide.id) as Array<{
            id: string;
            slide_id: string;
            type: SlideElement['type'];
            x: number;
            y: number;
            width: number;
            height: number;
            rotation: number;
            opacity: number;
            z_index: number;
            layer: SlideElement['layer'];
            payload_json: string;
            created_at: string;
            updated_at: string;
          }>).map((row) => ({
            id: row.id,
            slideId: row.slide_id,
            type: row.type,
            x: row.x,
            y: row.y,
            width: row.width,
            height: row.height,
            rotation: row.rotation,
            opacity: row.opacity,
            zIndex: row.z_index,
            layer: row.layer,
            payload: parseJson<SlideElementPayload>(row.payload_json),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          }));
          const syncedElements = syncThemeToElements(theme, currentElements, slide.id);
          deletedElementIds.push(...currentElements.map((element) => element.id));
          deleteElements.run(slide.id);
          for (const element of syncedElements) {
            insertElement.run(
              element.id,
              slide.id,
              element.type,
              element.x,
              element.y,
              element.width,
              element.height,
              element.rotation,
              element.opacity,
              element.zIndex,
              element.layer,
              JSON.stringify(element.payload),
              element.createdAt,
              nowIso(),
            );
          }
          touchedSlideIds.push(slide.id);
        }
      }
    });

    tx();

    const presentationIds = linkedItems.filter((item) => item.type === 'presentation').map((item) => item.id);
    const lyricIds = linkedItems.filter((item) => item.type === 'lyric').map((item) => item.id);

    return this.buildPatch({
      upsertPresentationIds: presentationIds.length > 0 ? presentationIds : undefined,
      upsertLyricIds: lyricIds.length > 0 ? lyricIds : undefined,
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds(touchedSlideIds),
      deletedSlideElementIds: deletedElementIds,
      replaceLibraryBundles: true,
    });
  }

  detachThemeFromDeckItem(itemId: Id): SnapshotPatch {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner || owner.themeId === null) return this.buildPatch({});

    const ownerTable = this.getDeckTableName(owner.type);
    this.db.prepare(`UPDATE ${ownerTable} SET theme_id = NULL, updated_at = ? WHERE id = ?`).run(nowIso(), itemId);
    return this.buildPatch({
      upsertPresentationIds: owner.type === 'presentation' ? [itemId] : undefined,
      upsertLyricIds: owner.type === 'lyric' ? [itemId] : undefined,
      replaceLibraryBundles: true,
    });
  }

  applyThemeToOverlay(themeId: Id, overlayId: Id): SnapshotPatch {
    const theme = this.getThemeById(themeId);
    if (!theme || theme.kind !== 'overlays') return this.buildPatch({});
    const exists = this.db.prepare('SELECT id FROM overlays WHERE id = ?').get(overlayId) as { id: string } | undefined;
    if (!exists) return this.buildPatch({});

    const slideId = `${overlayId}:slide`;
    const now = nowIso();
    const currentElements = this.getSlideElementsBySlideId(slideId);
    const appliedElements = applyThemeToElements(theme, currentElements, slideId);
    const tx = this.db.transaction(() => {
      this.replaceContainerElements(slideId, appliedElements, now);
      this.db.prepare('UPDATE overlays SET updated_at = ? WHERE id = ?').run(now, overlayId);
    });
    tx();
    return this.buildPatch({ upsertOverlayIds: [overlayId] });
  }

  movePlaylist(id: Id, direction: 'up' | 'down'): SnapshotPatch {
    const current = this.db
      .prepare('SELECT id, library_id, order_index FROM playlists WHERE id = ?')
      .get(id) as { id: string; library_id: string; order_index: number } | undefined;

    if (!current) return this.buildPatch({});

    const neighbor = direction === 'up'
      ? this.db
        .prepare(
          'SELECT id, order_index FROM playlists WHERE library_id = ? AND order_index < ? ORDER BY order_index DESC LIMIT 1'
        )
        .get(current.library_id, current.order_index)
      : this.db
        .prepare(
          'SELECT id, order_index FROM playlists WHERE library_id = ? AND order_index > ? ORDER BY order_index ASC LIMIT 1'
        )
        .get(current.library_id, current.order_index);

    if (!neighbor) return this.buildPatch({});

    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE playlists SET order_index = ?, updated_at = ? WHERE id = ?')
        .run((neighbor as { order_index: number }).order_index, now, current.id);
      this.db
        .prepare('UPDATE playlists SET order_index = ?, updated_at = ? WHERE id = ?')
        .run(current.order_index, now, (neighbor as { id: string }).id);
    });

    tx();
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  moveDeckItem(id: Id, direction: 'up' | 'down'): SnapshotPatch {
    const orderedItems = this.getOrderedContentReferences();
    const currentIndex = orderedItems.findIndex((item) => item.id === id);
    if (currentIndex === -1) return this.buildPatch({});

    const neighborIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const neighbor = orderedItems[neighborIndex] ?? null;
    const current = orderedItems[currentIndex];
    if (!current || !neighbor) return this.buildPatch({});

    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE ${this.getDeckTableName(current.type)} SET order_index = ?, updated_at = ? WHERE id = ?`)
        .run(neighbor.order, now, current.id);
      this.db
        .prepare(`UPDATE ${this.getDeckTableName(neighbor.type)} SET order_index = ?, updated_at = ? WHERE id = ?`)
        .run(current.order, now, neighbor.id);
    });

    tx();
    return this.buildPatch({
      upsertPresentationIds: [current, neighbor].filter((item) => item.type === 'presentation').map((item) => item.id),
      upsertLyricIds: [current, neighbor].filter((item) => item.type === 'lyric').map((item) => item.id),
      replaceLibraryBundles: true,
    });
  }

  createSlide(input: SlideCreateInput): SnapshotPatch {
    const owner = this.resolveSlideOwnerInput(input);
    if (!owner) return this.buildPatch({});

    const now = nowIso();
    const slideId = createId();
    const ownerColumn = this.getDeckOwnerColumn(owner.type);
    const currentOrder =
      (this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM slides WHERE ${ownerColumn} = ?`).get(owner.id) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;
    const assignedTheme = owner.themeId ? this.getThemeById(owner.themeId) : null;
    const appliedTheme = assignedTheme && isThemeCompatibleWithDeckItem(assignedTheme, owner.type)
      ? assignedTheme
      : null;
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.db
      .prepare(
        'INSERT INTO slides (id, presentation_id, lyric_id, kind, width, height, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        slideId,
        owner.type === 'presentation' ? owner.id : null,
        owner.type === 'lyric' ? owner.id : null,
        owner.type,
        input.width ?? DEFAULT_W,
        input.height ?? DEFAULT_H,
        '',
        currentOrder + 1,
        now,
        now
      );

    const initialElements = appliedTheme
      ? applyThemeToElements(appliedTheme, [], slideId)
      : owner.type === 'lyric'
        ? [{
          id: createId(),
          slideId,
          type: 'text' as const,
          x: 180,
          y: 860,
          width: 1560,
          height: 170,
          rotation: 0,
          opacity: 1,
          zIndex: 20,
          layer: 'content' as const,
          payload: this.newLyricsTextPayload(),
          createdAt: now,
          updatedAt: now,
        }]
        : [];

    for (const element of initialElements) {
      insertElement.run(
        element.id,
        slideId,
        element.type,
        element.x,
        element.y,
        element.width,
        element.height,
        element.rotation,
        element.opacity,
        element.zIndex,
        element.layer,
        JSON.stringify(element.payload),
        now,
        now,
      );
    }

    return this.buildPatch({
      upsertSlideIds: [slideId],
      upsertSlideElementIds: initialElements.map((element) => element.id),
    });
  }

  deleteSlide(slideId: Id): SnapshotPatch {
    const slide = this.db
      .prepare('SELECT presentation_id, lyric_id FROM slides WHERE id = ?')
      .get(slideId) as { presentation_id: string | null; lyric_id: string | null } | undefined;

    if (!slide) return this.buildPatch({});

    const ownerColumn = slide.presentation_id ? 'presentation_id' : 'lyric_id';
    const ownerId = slide.presentation_id ?? slide.lyric_id;
    if (!ownerId) return this.buildPatch({});
    const deletedElementIds = this.getSlideElementIdsBySlideIds([slideId]);

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
      this.db.prepare('DELETE FROM slides WHERE id = ?').run(slideId);
      this.normalizeSlideOrder(ownerColumn, ownerId);
    });

    tx();
    return this.buildPatch({
      upsertSlideIds: this.getSlideIdsForOwner(ownerColumn, ownerId),
      deletedSlideIds: [slideId],
      deletedSlideElementIds: deletedElementIds,
    });
  }

  updateSlideNotes(input: SlideNotesUpdateInput): SnapshotPatch {
    const now = nowIso();
    this.db
      .prepare('UPDATE slides SET notes = ?, updated_at = ? WHERE id = ?')
      .run(input.notes, now, input.slideId);
    return this.buildPatch({ upsertSlideIds: [input.slideId] });
  }

  duplicateSlide(slideId: Id): SnapshotPatch {
    const original = this.db
      .prepare('SELECT id, presentation_id, lyric_id, width, height, notes, order_index FROM slides WHERE id = ?')
      .get(slideId) as {
        id: string;
        presentation_id: string | null;
        lyric_id: string | null;
        width: number;
        height: number;
        notes: string | null;
        order_index: number;
      } | undefined;
    if (!original) return this.buildPatch({});

    const ownerColumn = original.presentation_id !== null ? 'presentation_id' : 'lyric_id';
    const ownerValue = original.presentation_id ?? original.lyric_id;
    if (!ownerValue) return this.buildPatch({});

    const now = nowIso();
    const newSlideId = createId();
    const insertOrder = original.order_index + 1;

    const elements = this.db
      .prepare(
        `SELECT type, x, y, width, height, rotation, opacity, z_index, layer, payload_json
         FROM slide_elements WHERE slide_id = ? ORDER BY layer ASC, z_index ASC, created_at ASC`
      )
      .all(slideId) as Array<{
        type: SlideElement['type'];
        x: number; y: number; width: number; height: number;
        rotation: number; opacity: number; z_index: number;
        layer: SlideElement['layer']; payload_json: string;
      }>;

    const shiftOrder = this.db.prepare(
      `UPDATE slides SET order_index = order_index + 1, updated_at = ? WHERE ${ownerColumn} = ? AND order_index >= ?`
    );
    const insertSlide = this.db.prepare(
      'INSERT INTO slides (id, presentation_id, lyric_id, kind, width, height, notes, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const newElementIds: Id[] = [];
    const tx = this.db.transaction(() => {
      shiftOrder.run(now, ownerValue, insertOrder);
      insertSlide.run(
        newSlideId,
        original.presentation_id,
        original.lyric_id,
        original.presentation_id ? 'presentation' : 'lyric',
        original.width,
        original.height,
        original.notes ?? '',
        insertOrder,
        now,
        now,
      );
      for (const el of elements) {
        const elementId = createId();
        newElementIds.push(elementId);
        insertElement.run(
          elementId,
          newSlideId,
          el.type,
          el.x, el.y, el.width, el.height,
          el.rotation, el.opacity, el.z_index, el.layer,
          el.payload_json,
          now, now,
        );
      }
    });
    tx();

    return this.buildPatch({
      upsertSlideIds: this.getSlideIdsForOwner(ownerColumn, ownerValue),
      upsertSlideElementIds: newElementIds,
    });
  }

  setSlideOrder(input: SlideOrderUpdateInput): SnapshotPatch {
    const now = nowIso();

    // Get the current slide to find its parent
    const slide = this.db
      .prepare('SELECT id, presentation_id, lyric_id FROM slides WHERE id = ?')
      .get(input.slideId) as { id: string; presentation_id: string | null; lyric_id: string | null } | undefined;

    if (!slide) return this.buildPatch({});

    // Determine parent column and value
    const isDecksSlide = slide.presentation_id !== null;
    const ownerColumn = isDecksSlide ? 'presentation_id' : 'lyric_id';
    const ownerId = isDecksSlide ? slide.presentation_id : slide.lyric_id;

    if (!ownerId) return this.buildPatch({});

    // Get all sibling slides sorted by current order_index
    const siblings = this.db
      .prepare(`SELECT id, order_index FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(ownerId) as { id: string; order_index: number }[];

    // Find current position
    const currentIndex = siblings.findIndex(s => s.id === input.slideId);
    if (currentIndex === -1) return this.buildPatch({});

    // Clamp newOrder to valid range
    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(input.newOrder, maxOrder));

    // No-op if already at target position
    if (currentIndex === targetOrder) return this.buildPatch({});

    // Reorder siblings by removing current and inserting at newOrder
    const reordered = siblings.filter((_, i) => i !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    // Update all siblings with new order_index values
    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE slides SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    // Every sibling's order_index (and updated_at) changed, so upsert all of them.
    return this.buildPatch({ upsertSlideIds: reordered.map((sibling) => sibling.id) });
  }

  setLibraryOrder(libraryId: Id, newOrder: number): SnapshotPatch {
    const now = nowIso();
    const siblings = this.db
      .prepare('SELECT id, order_index FROM libraries ORDER BY order_index ASC, created_at ASC')
      .all() as { id: string; order_index: number }[];

    const currentIndex = siblings.findIndex((s) => s.id === libraryId);
    if (currentIndex === -1) return this.buildPatch({});

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, i) => i !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE libraries SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    return this.buildPatch({
      upsertLibraryIds: reordered.map((sibling) => sibling.id),
      replaceLibraryBundles: true,
    });
  }

  setPlaylistOrder(playlistId: Id, newOrder: number): SnapshotPatch {
    const now = nowIso();
    const current = this.db
      .prepare('SELECT id, library_id, order_index FROM playlists WHERE id = ?')
      .get(playlistId) as { id: string; library_id: string; order_index: number } | undefined;

    if (!current) return this.buildPatch({});

    const siblings = this.db
      .prepare('SELECT id, order_index FROM playlists WHERE library_id = ? ORDER BY order_index ASC')
      .all(current.library_id) as { id: string; order_index: number }[];

    const currentIndex = siblings.findIndex((s) => s.id === playlistId);
    if (currentIndex === -1) return this.buildPatch({});

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, i) => i !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE playlists SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  movePlaylistEntryTo(entryId: Id, segmentId: Id, newOrder: number): SnapshotPatch {
    const entry = this.db
      .prepare(
        `SELECT pe.id, pe.segment_id, ps.playlist_id
         FROM playlist_entries pe
         JOIN playlist_segments ps ON ps.id = pe.segment_id
         WHERE pe.id = ?`
      )
      .get(entryId) as { id: string; segment_id: string; playlist_id: string } | undefined;
    if (!entry) return this.buildPatch({});

    const targetSegment = this.db
      .prepare('SELECT id FROM playlist_segments WHERE id = ? AND playlist_id = ?')
      .get(segmentId, entry.playlist_id) as { id: string } | undefined;
    if (!targetSegment) return this.buildPatch({});

    const now = nowIso();
    const isSameSegment = entry.segment_id === segmentId;

    const tx = this.db.transaction(() => {
      if (isSameSegment) {
        const siblings = this.db
          .prepare('SELECT id FROM playlist_entries WHERE segment_id = ? ORDER BY order_index ASC')
          .all(segmentId) as { id: string }[];
        const currentIndex = siblings.findIndex((s) => s.id === entryId);
        if (currentIndex === -1) return;
        const maxOrder = siblings.length - 1;
        const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
        if (currentIndex === targetOrder) return;
        const reordered = siblings.filter((_, i) => i !== currentIndex);
        reordered.splice(targetOrder, 0, siblings[currentIndex]);
        reordered.forEach((sibling, index) => {
          this.db
            .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
            .run(index, now, sibling.id);
        });
        return;
      }

      const targetSiblings = this.db
        .prepare('SELECT id FROM playlist_entries WHERE segment_id = ? ORDER BY order_index ASC')
        .all(segmentId) as { id: string }[];
      const clampedOrder = Math.max(0, Math.min(newOrder, targetSiblings.length));
      const newTargetList = [...targetSiblings];
      newTargetList.splice(clampedOrder, 0, { id: entryId });
      newTargetList.forEach((item, index) => {
        if (item.id === entryId) {
          this.db
            .prepare('UPDATE playlist_entries SET segment_id = ?, order_index = ?, updated_at = ? WHERE id = ?')
            .run(segmentId, index, now, item.id);
        } else {
          this.db
            .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
            .run(index, now, item.id);
        }
      });

      const sourceSiblings = this.db
        .prepare('SELECT id FROM playlist_entries WHERE segment_id = ? ORDER BY order_index ASC')
        .all(entry.segment_id) as { id: string }[];
      sourceSiblings.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  setPlaylistSegmentOrder(segmentId: Id, newOrder: number): SnapshotPatch {
    const now = nowIso();
    const current = this.db
      .prepare('SELECT id, playlist_id, order_index FROM playlist_segments WHERE id = ?')
      .get(segmentId) as { id: string; playlist_id: string; order_index: number } | undefined;

    if (!current) return this.buildPatch({});

    const siblings = this.db
      .prepare('SELECT id, order_index FROM playlist_segments WHERE playlist_id = ? ORDER BY order_index ASC')
      .all(current.playlist_id) as { id: string; order_index: number }[];

    const currentIndex = siblings.findIndex((s) => s.id === segmentId);
    if (currentIndex === -1) return this.buildPatch({});

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, i) => i !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE playlist_segments SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  createElement(input: ElementCreateInput): SnapshotPatch {
    const now = nowIso();
    const newId = input.id ?? createId();
    this.db
      .prepare(
        `INSERT INTO slide_elements
          (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId,
        input.slideId,
        input.type,
        input.x,
        input.y,
        input.width,
        input.height,
        input.rotation ?? 0,
        input.opacity ?? 1,
        input.zIndex ?? 0,
        input.layer ?? this.inferLayer(input.type),
        JSON.stringify(input.payload),
        now,
        now
      );
    return this.buildPatch({ upsertSlideElementIds: [newId] });
  }

  createElementsBatch(inputs: ElementCreateInput[]): SnapshotPatch {
    if (inputs.length === 0) return this.buildPatch({});
    const now = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const newIds: Id[] = [];
    const tx = this.db.transaction((batchInputs: ElementCreateInput[]) => {
      for (const input of batchInputs) {
        const newId = input.id ?? createId();
        newIds.push(newId);
        insert.run(
          newId,
          input.slideId,
          input.type,
          input.x,
          input.y,
          input.width,
          input.height,
          input.rotation ?? 0,
          input.opacity ?? 1,
          input.zIndex ?? 0,
          input.layer ?? this.inferLayer(input.type),
          JSON.stringify(input.payload),
          now,
          now
        );
      }
    });
    tx(inputs);
    return this.buildPatch({ upsertSlideElementIds: newIds });
  }

  updateElement(input: ElementUpdateInput): SnapshotPatch {
    const now = nowIso();
    const existing = this.db
      .prepare('SELECT * FROM slide_elements WHERE id = ?')
      .get(input.id) as
      | {
          id: string;
          x: number;
          y: number;
          width: number;
          height: number;
          rotation: number;
          opacity: number;
          z_index: number;
          layer: string;
          payload_json: string;
        }
      | undefined;

    if (!existing) return this.buildPatch({});

    this.db
      .prepare(
        `UPDATE slide_elements
         SET x = ?, y = ?, width = ?, height = ?, rotation = ?, opacity = ?, z_index = ?, layer = ?, payload_json = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.x ?? existing.x,
        input.y ?? existing.y,
        input.width ?? existing.width,
        input.height ?? existing.height,
        input.rotation ?? existing.rotation,
        input.opacity ?? existing.opacity,
        input.zIndex ?? existing.z_index,
        input.layer ?? existing.layer,
        JSON.stringify(input.payload ?? parseJson<SlideElementPayload>(existing.payload_json)),
        now,
        input.id
      );

    return this.buildPatch({ upsertSlideElementIds: [input.id] });
  }

  updateElementsBatch(inputs: ElementUpdateInput[]): SnapshotPatch {
    if (inputs.length === 0) return this.buildPatch({});
    const selectExisting = this.db.prepare('SELECT * FROM slide_elements WHERE id = ?');
    const update = this.db.prepare(
      `UPDATE slide_elements
       SET x = ?, y = ?, width = ?, height = ?, rotation = ?, opacity = ?, z_index = ?, layer = ?, payload_json = ?, updated_at = ?
       WHERE id = ?`
    );
    const updatedIds: Id[] = [];
    const tx = this.db.transaction((batchInputs: ElementUpdateInput[]) => {
      for (const input of batchInputs) {
        const existing = selectExisting.get(input.id) as
          | {
              id: string;
              x: number;
              y: number;
              width: number;
              height: number;
              rotation: number;
              opacity: number;
              z_index: number;
              layer: string;
              payload_json: string;
            }
          | undefined;
        if (!existing) continue;
        update.run(
          input.x ?? existing.x,
          input.y ?? existing.y,
          input.width ?? existing.width,
          input.height ?? existing.height,
          input.rotation ?? existing.rotation,
          input.opacity ?? existing.opacity,
          input.zIndex ?? existing.z_index,
          input.layer ?? existing.layer,
          JSON.stringify(input.payload ?? parseJson<SlideElementPayload>(existing.payload_json)),
          nowIso(),
          input.id
        );
        updatedIds.push(input.id);
      }
    });
    tx(inputs);
    return this.buildPatch({ upsertSlideElementIds: updatedIds });
  }

  deleteElement(id: Id): SnapshotPatch {
    this.db.prepare('DELETE FROM slide_elements WHERE id = ?').run(id);
    return this.buildPatch({ deletedSlideElementIds: [id] });
  }

  deleteElementsBatch(ids: Id[]): SnapshotPatch {
    if (ids.length === 0) return this.buildPatch({});
    const del = this.db.prepare('DELETE FROM slide_elements WHERE id = ?');
    const tx = this.db.transaction((batchIds: Id[]) => {
      for (const id of batchIds) del.run(id);
    });
    tx(ids);
    return this.buildPatch({ deletedSlideElementIds: [...ids] });
  }

  createMediaAsset(asset: MediaAssetCreateInput): SnapshotPatch {
    this.assertMediaSource(asset.src);
    const now = nowIso();
    const assetId = createId();
    const table = this.mediaAssetTable(asset.type);
    const currentOrder = this.getNextMediaAssetOrderIndex() - 1;
    const collectionId = asset.collectionId ?? this.getMediaAssetDefaultCollectionId(asset.type);
    this.db
      .prepare(
        `INSERT INTO ${table} (id, name, src, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(assetId, asset.name, asset.src, collectionId, currentOrder + 1, now, now);
    return this.buildPatch({ upsertMediaAssetIds: [assetId] });
  }

  deleteMediaAsset(id: Id): SnapshotPatch {
    for (const table of MEDIA_ASSET_TABLES) {
      const info = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) as { id: string } | undefined;
      if (info) {
        this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
        return this.buildPatch({ deletedMediaAssetIds: [id] });
      }
    }
    return this.buildPatch({});
  }

  updateMediaAssetSrc(id: Id, src: string): SnapshotPatch {
    this.assertMediaSource(src);
    for (const table of MEDIA_ASSET_TABLES) {
      const result = this.db.prepare(`UPDATE ${table} SET src = ?, updated_at = ? WHERE id = ?`).run(src, nowIso(), id);
      if (result.changes > 0) {
        return this.buildPatch({ upsertMediaAssetIds: [id] });
      }
    }
    return this.buildPatch({});
  }

  private mediaAssetTable(type: MediaAssetType): 'image_assets' | 'video_assets' | 'audio_assets' {
    return type === 'image' ? 'image_assets' : type === 'video' ? 'video_assets' : 'audio_assets';
  }

  createOverlay(input: OverlayCreateInput): SnapshotPatch {
    const now = nowIso();
    const overlayId = createId();
    const slideId = `${overlayId}:slide`;
    const elements = input.elements ?? [];
    const collectionId = input.collectionId ?? this.getDefaultCollectionId('overlay');

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO overlays
           (id, name, enabled, animation_json, collection_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          overlayId,
          input.name,
          1,
          JSON.stringify(normalizeOverlayAnimation(input.animation ?? { kind: 'none', durationMs: 0, autoClearDurationMs: null })),
          collectionId,
          now,
          now,
        );
      this.createContainerSlide(slideId, 'overlay', overlayId, DEFAULT_W, DEFAULT_H, now);
      this.replaceContainerElements(slideId, elements, now);
    });
    tx();

    return this.buildPatch({ upsertOverlayIds: [overlayId] });
  }

  updateOverlay(input: OverlayUpdateInput): SnapshotPatch {
    const existing = this.db
      .prepare('SELECT id, name, animation_json FROM overlays WHERE id = ?')
      .get(input.id) as
      | {
      id: string;
      name: string;
      animation_json: string;
      }
      | undefined;

    if (!existing) return this.buildPatch({});

    const slideId = `${input.id}:slide`;
    const now = nowIso();
    const tx = this.db.transaction(() => {
      if (input.elements !== undefined) {
        this.replaceContainerElements(slideId, input.elements, now);
      }
      this.db
        .prepare(
          `UPDATE overlays
           SET name = ?, animation_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name ?? existing.name,
          JSON.stringify(normalizeOverlayAnimation(input.animation ?? parseJson(existing.animation_json))),
          now,
          input.id,
        );
    });
    tx();

    return this.buildPatch({ upsertOverlayIds: [input.id] });
  }

  renameLibrary(id: Id, name: string): SnapshotPatch {
    this.db
      .prepare('UPDATE libraries SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, nowIso(), id);
    return this.buildPatch({ upsertLibraryIds: [id], replaceLibraryBundles: true });
  }

  renamePlaylist(id: Id, name: string): SnapshotPatch {
    this.db
      .prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, nowIso(), id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  renamePresentation(id: Id, title: string): SnapshotPatch {
    this.db
      .prepare('UPDATE presentations SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, nowIso(), id);
    return this.buildPatch({ upsertPresentationIds: [id], replaceLibraryBundles: true });
  }

  renameLyric(id: Id, title: string): SnapshotPatch {
    this.db
      .prepare('UPDATE lyrics SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, nowIso(), id);
    return this.buildPatch({ upsertLyricIds: [id], replaceLibraryBundles: true });
  }

  deleteLibrary(id: Id): SnapshotPatch {
    const tx = this.db.transaction((libraryId: Id) => {
      this.db
        .prepare(
          `DELETE FROM playlist_entries
           WHERE segment_id IN (
             SELECT ps.id
             FROM playlist_segments ps
             JOIN playlists p ON p.id = ps.playlist_id
             WHERE p.library_id = ?
           )`
        )
        .run(libraryId);

      this.db
        .prepare(
          `DELETE FROM playlist_segments
           WHERE playlist_id IN (SELECT id FROM playlists WHERE library_id = ?)`
        )
        .run(libraryId);

      this.db
        .prepare('DELETE FROM playlists WHERE library_id = ?')
        .run(libraryId);

      this.db
        .prepare('DELETE FROM libraries WHERE id = ?')
        .run(libraryId);
    });

    tx(id);
    return this.buildPatch({ deletedLibraryIds: [id], replaceLibraryBundles: true });
  }

  deletePlaylist(id: Id): SnapshotPatch {
    const row = this.db
      .prepare('SELECT library_id FROM playlists WHERE id = ?')
      .get(id) as { library_id: string } | undefined;

    const tx = this.db.transaction((playlistId: Id) => {
      this.db
        .prepare(
          `DELETE FROM playlist_entries
           WHERE segment_id IN (SELECT id FROM playlist_segments WHERE playlist_id = ?)`
        )
        .run(playlistId);
      this.db
        .prepare('DELETE FROM playlist_segments WHERE playlist_id = ?')
        .run(playlistId);
      this.db
        .prepare('DELETE FROM playlists WHERE id = ?')
        .run(playlistId);
    });

    tx(id);
    if (row) this.normalizePlaylistOrder(row.library_id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  deletePlaylistSegment(id: Id): SnapshotPatch {
    const tx = this.db.transaction((segmentId: Id) => {
      this.db
        .prepare('DELETE FROM playlist_entries WHERE segment_id = ?')
        .run(segmentId);
      this.db
        .prepare('DELETE FROM playlist_segments WHERE id = ?')
        .run(segmentId);
    });

    tx(id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  deletePresentation(id: Id): SnapshotPatch {
    const deletedSlideIds = (this.db
      .prepare('SELECT id FROM slides WHERE presentation_id = ?')
      .all(id) as Array<{ id: string }>)
      .map((row) => row.id);
    const deletedSlideElementIds = this.getSlideElementIdsBySlideIds(deletedSlideIds);
    const tx = this.db.transaction((presentationId: Id) => {
      this.db
        .prepare(
          `DELETE FROM slide_elements
           WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id = ?)`
        )
        .run(presentationId);
      this.db
        .prepare('DELETE FROM slides WHERE presentation_id = ?')
        .run(presentationId);
      this.db
        .prepare('DELETE FROM playlist_entries WHERE presentation_id = ?')
        .run(presentationId);
      this.db
        .prepare('DELETE FROM presentations WHERE id = ?')
        .run(presentationId);
    });

    tx(id);
    this.normalizeDeckItemOrder();
    const remainingPresentationIds = (this.db.prepare('SELECT id FROM presentations ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    const remainingLyricIds = (this.db.prepare('SELECT id FROM lyrics ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    return this.buildPatch({
      upsertPresentationIds: remainingPresentationIds,
      upsertLyricIds: remainingLyricIds,
      deletedPresentationIds: [id],
      deletedSlideIds,
      deletedSlideElementIds,
      replaceLibraryBundles: true,
    });
  }

  deleteLyric(id: Id): SnapshotPatch {
    const deletedSlideIds = (this.db
      .prepare('SELECT id FROM slides WHERE lyric_id = ?')
      .all(id) as Array<{ id: string }>)
      .map((row) => row.id);
    const deletedSlideElementIds = this.getSlideElementIdsBySlideIds(deletedSlideIds);
    const tx = this.db.transaction((lyricId: Id) => {
      this.db
        .prepare(
          `DELETE FROM slide_elements
           WHERE slide_id IN (SELECT id FROM slides WHERE lyric_id = ?)`
        )
        .run(lyricId);
      this.db
        .prepare('DELETE FROM slides WHERE lyric_id = ?')
        .run(lyricId);
      this.db
        .prepare('DELETE FROM playlist_entries WHERE lyric_id = ?')
        .run(lyricId);
      this.db
        .prepare('DELETE FROM lyrics WHERE id = ?')
        .run(lyricId);
    });

    tx(id);
    this.normalizeDeckItemOrder();
    const remainingPresentationIds = (this.db.prepare('SELECT id FROM presentations ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    const remainingLyricIds = (this.db.prepare('SELECT id FROM lyrics ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    return this.buildPatch({
      upsertPresentationIds: remainingPresentationIds,
      upsertLyricIds: remainingLyricIds,
      deletedLyricIds: [id],
      deletedSlideIds,
      deletedSlideElementIds,
      replaceLibraryBundles: true,
    });
  }

  setOverlayEnabled(overlayId: Id, enabled: boolean): SnapshotPatch {
    this.db
      .prepare('UPDATE overlays SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, nowIso(), overlayId);
    return this.buildPatch({ upsertOverlayIds: [overlayId] });
  }

  deleteOverlay(overlayId: Id): SnapshotPatch {
    const slideId = `${overlayId}:slide`;
    const tx = this.db.transaction(() => {
      // Drop the owning slide first (its overlay_id FK references the overlay).
      this.deleteContainerSlide(slideId);
      this.db.prepare('DELETE FROM overlays WHERE id = ?').run(overlayId);
    });
    tx();
    return this.buildPatch({ deletedOverlayIds: [overlayId] });
  }

  // ─── Stages ───────────────────────────────────────────────────────
  // A Stage is a named container of SlideElement[] that maps to its own NDI
  // sender. Schema mirrors themes (no kind, no theme-application links).

  createStage(input: StageCreateInput): SnapshotPatch {
    const now = nowIso();
    const stageId = createId();
    const slideId = `${stageId}:slide`;
    const elements = input.elements ?? [];
    const width = input.width ?? 1920;
    const height = input.height ?? 1080;
    const nextOrderRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM stages')
      .get() as { next_order: number };
    const collectionId = input.collectionId ?? this.getDefaultCollectionId('stage');

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          stageId,
          input.name,
          width,
          height,
          nextOrderRow.next_order,
          collectionId,
          now,
          now,
        );
      this.createContainerSlide(slideId, 'stage', stageId, width, height, now);
      this.replaceContainerElements(slideId, elements, now);
    });
    tx();

    return this.buildPatch({ upsertStageIds: [stageId] });
  }

  updateStage(input: StageUpdateInput): SnapshotPatch {
    const existing = this.db
      .prepare('SELECT id, name, width, height, order_index FROM stages WHERE id = ?')
      .get(input.id) as
      | {
        id: string;
        name: string;
        width: number;
        height: number;
        order_index: number;
      }
      | undefined;

    if (!existing) return this.buildPatch({});

    const slideId = `${input.id}:slide`;
    const now = nowIso();
    const width = input.width ?? existing.width;
    const height = input.height ?? existing.height;
    const tx = this.db.transaction(() => {
      if (input.elements !== undefined) {
        this.replaceContainerElements(slideId, input.elements, now);
      }
      if (input.width !== undefined || input.height !== undefined) {
        this.updateContainerSlideGeometry(slideId, width, height, now);
      }
      this.db
        .prepare(
          `UPDATE stages
           SET name = ?, width = ?, height = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(
          input.name ?? existing.name,
          width,
          height,
          now,
          input.id,
        );
    });
    tx();

    return this.buildPatch({ upsertStageIds: [input.id] });
  }

  deleteStage(stageId: Id): SnapshotPatch {
    const slideId = `${stageId}:slide`;
    const tx = this.db.transaction(() => {
      // Drop the owning slide first (its stage_id FK references the stage).
      this.deleteContainerSlide(slideId);
      this.db.prepare('DELETE FROM stages WHERE id = ?').run(stageId);
    });
    tx();
    return this.buildPatch({ deletedStageIds: [stageId] });
  }

  duplicateStage(stageId: Id): SnapshotPatch {
    const existing = this.db
      .prepare('SELECT id, name, width, height, collection_id FROM stages WHERE id = ?')
      .get(stageId) as
      | { id: string; name: string; width: number; height: number; collection_id: string }
      | undefined;

    if (!existing) return this.buildPatch({});

    const now = nowIso();
    const newId = createId();
    const newSlideId = `${newId}:slide`;
    const nextOrderRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM stages')
      .get() as { next_order: number };
    const sourceSlideId = `${existing.id}:slide`;
    const sourceElements = this.getSlideElementsBySlideId(sourceSlideId);
    const clonedElements: SlideElement[] = sourceElements.map((element) => ({
      ...element,
      id: createId(),
      slideId: newSlideId,
      createdAt: now,
      updatedAt: now,
    }));

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          newId,
          `${existing.name} copy`,
          existing.width,
          existing.height,
          nextOrderRow.next_order,
          existing.collection_id,
          now,
          now,
        );
      this.createContainerSlide(newSlideId, 'stage', newId, existing.width, existing.height, now);
      this.replaceContainerElements(newSlideId, clonedElements, now);
    });
    tx();

    return this.buildPatch({ upsertStageIds: [newId] });
  }

  private newLyricsTextPayload() {
    return {
      text: 'Verse line one\nVerse line two',
      fontFamily: 'Avenir Next',
      fontSize: 72,
      color: '#FFFFFF',
      alignment: 'center' as const,
      verticalAlign: 'middle' as const,
      lineHeight: 1.2,
      caseTransform: 'none' as const,
      weight: '700',
      visible: true,
      locked: false,
      fillEnabled: false,
      fillColor: '#00000000',
      strokeEnabled: false,
      shadowEnabled: false,
    };
  }

  private normalizeSlideOrder(ownerColumn: 'presentation_id' | 'lyric_id', ownerId: Id): void {
    const now = nowIso();
    this.db
      .prepare(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY order_index ASC, created_at ASC, id ASC) - 1 AS next_order
           FROM slides
           WHERE ${ownerColumn} = ?
         )
         UPDATE slides
         SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = slides.id),
             updated_at = ?
         WHERE ${ownerColumn} = ?`
      )
      .run(ownerId, now, ownerId);
  }

  private assertMediaSource(src: string): void {
    if (src.startsWith('blob:')) {
      throw new Error('Transient blob media sources are not allowed. Import from a local file path.');
    }
  }

  private normalizeThemeKind(kind: string | null | undefined): ThemeKind {
    if (kind === 'lyrics' || kind === 'overlays') return kind;
    return 'slides';
  }

  private inferLayer(type: string): 'background' | 'media' | 'content' {
    if (type === 'shape') return 'background';
    if (type === 'image' || type === 'video') return 'media';
    return 'content';
  }

  private getDeckTableName(type: DeckItemType): 'presentations' | 'lyrics' {
    return type === 'presentation' ? 'presentations' : 'lyrics';
  }

  private getDeckOwnerColumn(type: DeckItemType): 'presentation_id' | 'lyric_id' {
    return type === 'presentation' ? 'presentation_id' : 'lyric_id';
  }

  private getMaxDeckOrder(): number {
    const row = this.db.prepare(
      `SELECT MAX(order_index) AS maxOrder
       FROM (
         SELECT order_index FROM presentations
         UNION ALL
         SELECT order_index FROM lyrics
       )`
    ).get() as { maxOrder: number | null };
    return row.maxOrder ?? -1;
  }

  private getOrderedContentReferences(): Array<{ id: Id; type: DeckItemType; order: number }> {
    return this.db.prepare(
      `SELECT id, type, order_index AS "order"
       FROM (
         SELECT id, 'presentation' AS type, order_index, created_at FROM presentations
         UNION ALL
         SELECT id, 'lyric' AS type, order_index, created_at FROM lyrics
       )
       ORDER BY order_index ASC, created_at ASC, id ASC`
    ).all() as Array<{ id: Id; type: DeckItemType; order: number }>;
  }

  private resolveDeckOwnerRow(id: Id): DeckOwnerRow | null {
    const deck = this.db
      .prepare('SELECT theme_id FROM presentations WHERE id = ?')
      .get(id) as { theme_id: string | null } | undefined;
    if (deck) {
      return { type: 'presentation', themeId: deck.theme_id };
    }

    const lyric = this.db
      .prepare('SELECT theme_id FROM lyrics WHERE id = ?')
      .get(id) as { theme_id: string | null } | undefined;
    if (lyric) {
      return { type: 'lyric', themeId: lyric.theme_id };
    }

    return null;
  }

  private resolveSlideOwnerInput(input: SlideCreateInput): (DeckOwnerRow & { id: Id }) | null {
    if (input.presentationId && input.lyricId) return null;
    const ownerId = input.presentationId ?? input.lyricId ?? null;
    if (!ownerId) return null;

    const owner = this.resolveDeckOwnerRow(ownerId);
    if (!owner) return null;

    if (owner.type === 'presentation' && input.presentationId) return { ...owner, id: input.presentationId };
    if (owner.type === 'lyric' && input.lyricId) return { ...owner, id: input.lyricId };
    return null;
  }

  private getDeckBundleItemById(itemId: Id): DeckBundleItem | null {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) return null;

    const tableName = this.getDeckTableName(owner.type);
    const row = this.db
      .prepare(`SELECT id, title, theme_id, order_index FROM ${tableName} WHERE id = ?`)
      .get(itemId) as { id: string; title: string; theme_id: string | null; order_index: number } | undefined;

    if (!row) return null;

    const ownerColumn = this.getDeckOwnerColumn(owner.type);
    const slides = this.db
      .prepare(
        `SELECT id, width, height, notes, order_index
         FROM slides
         WHERE ${ownerColumn} = ?
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(itemId) as Array<{ id: string; width: number; height: number; notes: string; order_index: number }>;

    const bundleSlides = slides.map((slide): DeckBundleSlide => ({
      id: slide.id,
      width: slide.width,
      height: slide.height,
      notes: slide.notes,
      order: slide.order_index,
      elements: this.getSlideElementsBySlideId(slide.id),
    }));

    return {
      id: row.id,
      type: owner.type,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      slides: bundleSlides,
    };
  }

  private getDeckBundleThemeById(themeId: Id): DeckBundleTheme | null {
    const row = this.db
      .prepare(
        `SELECT id, name, kind, width, height, order_index
         FROM themes
         WHERE id = ?`
      )
      .get(themeId) as {
      id: string;
      name: string;
      kind: ThemeKind;
      width: number;
      height: number;
      order_index: number;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      kind: this.normalizeThemeKind(row.kind),
      width: row.width,
      height: row.height,
      order: row.order_index,
      elements: this.getSlideElementsBySlideId(`${row.id}:slide`),
    };
  }

  // ─── Patch helpers (Stage 3 of perf plan) ─────────────────────────
  //
  // Build a SnapshotPatch from ids touched by a mutation. The resulting
  // patch carries just the rows that changed, not the entire snapshot.
  // Version is monotonically increasing for de-dup / ordering at the
  // renderer. See app/core/snapshot-patch.ts.

  private nextPatchVersion(): number {
    this.patchVersion += 1;
    return this.patchVersion;
  }

  private buildPatch(spec: {
    upsertLibraryIds?: Id[];
    upsertPresentationIds?: Id[];
    upsertLyricIds?: Id[];
    upsertSlideIds?: Id[];
    upsertSlideElementIds?: Id[];
    upsertMediaAssetIds?: Id[];
    upsertOverlayIds?: Id[];
    upsertThemeIds?: Id[];
    upsertStageIds?: Id[];
    upsertCollectionIds?: Id[];
    deletedLibraryIds?: Id[];
    deletedPresentationIds?: Id[];
    deletedLyricIds?: Id[];
    deletedSlideIds?: Id[];
    deletedSlideElementIds?: Id[];
    deletedMediaAssetIds?: Id[];
    deletedOverlayIds?: Id[];
    deletedThemeIds?: Id[];
    deletedStageIds?: Id[];
    deletedCollectionIds?: Id[];
    replaceLibraryBundles?: boolean;
  }): SnapshotPatch {
    const patch: SnapshotPatch = {
      version: this.nextPatchVersion(),
      upserts: {},
      deletes: {},
    };
    if (spec.upsertLibraryIds && spec.upsertLibraryIds.length > 0) {
      patch.upserts.libraries = this.getLibrariesByIds(spec.upsertLibraryIds);
    }
    if (spec.upsertPresentationIds && spec.upsertPresentationIds.length > 0) {
      patch.upserts.presentations = this.getPresentationsByIds(spec.upsertPresentationIds);
    }
    if (spec.upsertLyricIds && spec.upsertLyricIds.length > 0) {
      patch.upserts.lyrics = this.getLyricsByIds(spec.upsertLyricIds);
    }
    if (spec.upsertSlideIds && spec.upsertSlideIds.length > 0) {
      patch.upserts.slides = this.getSlidesByIds(spec.upsertSlideIds);
    }
    if (spec.upsertSlideElementIds && spec.upsertSlideElementIds.length > 0) {
      patch.upserts.slideElements = this.getSlideElementsByIds(spec.upsertSlideElementIds);
    }
    if (spec.upsertMediaAssetIds && spec.upsertMediaAssetIds.length > 0) {
      patch.upserts.mediaAssets = this.getMediaAssetsByIds(spec.upsertMediaAssetIds);
    }
    if (spec.upsertOverlayIds && spec.upsertOverlayIds.length > 0) {
      patch.upserts.overlays = this.getOverlaysByIds(spec.upsertOverlayIds);
    }
    if (spec.upsertThemeIds && spec.upsertThemeIds.length > 0) {
      patch.upserts.themes = this.getThemesByIds(spec.upsertThemeIds);
    }
    if (spec.upsertStageIds && spec.upsertStageIds.length > 0) {
      patch.upserts.stages = this.getStagesByIds(spec.upsertStageIds);
    }
    if (spec.upsertCollectionIds && spec.upsertCollectionIds.length > 0) {
      patch.upserts.collections = this.getCollectionsByIds(spec.upsertCollectionIds);
    }
    if (spec.deletedLibraryIds && spec.deletedLibraryIds.length > 0) {
      patch.deletes.libraries = [...spec.deletedLibraryIds];
    }
    if (spec.deletedPresentationIds && spec.deletedPresentationIds.length > 0) {
      patch.deletes.presentations = [...spec.deletedPresentationIds];
    }
    if (spec.deletedLyricIds && spec.deletedLyricIds.length > 0) {
      patch.deletes.lyrics = [...spec.deletedLyricIds];
    }
    if (spec.deletedSlideIds && spec.deletedSlideIds.length > 0) {
      patch.deletes.slides = [...spec.deletedSlideIds];
    }
    if (spec.deletedSlideElementIds && spec.deletedSlideElementIds.length > 0) {
      patch.deletes.slideElements = [...spec.deletedSlideElementIds];
    }
    if (spec.deletedMediaAssetIds && spec.deletedMediaAssetIds.length > 0) {
      patch.deletes.mediaAssets = [...spec.deletedMediaAssetIds];
    }
    if (spec.deletedOverlayIds && spec.deletedOverlayIds.length > 0) {
      patch.deletes.overlays = [...spec.deletedOverlayIds];
    }
    if (spec.deletedThemeIds && spec.deletedThemeIds.length > 0) {
      patch.deletes.themes = [...spec.deletedThemeIds];
    }
    if (spec.deletedStageIds && spec.deletedStageIds.length > 0) {
      patch.deletes.stages = [...spec.deletedStageIds];
    }
    if (spec.deletedCollectionIds && spec.deletedCollectionIds.length > 0) {
      patch.deletes.collections = [...spec.deletedCollectionIds];
    }
    if (spec.replaceLibraryBundles) {
      patch.upserts.libraryBundles = this.buildLibraryBundles();
    }
    return patch;
  }

  private buildLibraryBundles(): LibraryPlaylistBundle[] {
    const libraries = this.getLibraries();
    const presentations = this.getPresentations();
    const lyrics = this.getLyrics();
    const itemsById = new Map<Id, DeckItem>([
      ...presentations.map((deck) => [deck.id, deck] as const),
      ...lyrics.map((lyric) => [lyric.id, lyric] as const),
    ]);
    return libraries.map((library) => ({
      library,
      playlists: this.getPlaylistTreesByLibrary(library.id, itemsById),
    }));
  }

  private getLibrariesByIds(ids: Id[]): Library[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, order_index, created_at, updated_at
         FROM libraries
         WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(...ids) as Array<{ id: string; name: string; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getPresentationsByIds(ids: Id[]): Presentation[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at
         FROM presentations
         WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(...ids) as Array<{
      id: string;
      title: string;
      theme_id: string | null;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => buildDeckItem({
      id: row.id,
      title: row.title,
      type: 'presentation',
      themeId: row.theme_id,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as Presentation[];
  }

  private getLyricsByIds(ids: Id[]): Lyric[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at
         FROM lyrics
         WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(...ids) as Array<{
      id: string;
      title: string;
      theme_id: string | null;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => buildDeckItem({
      id: row.id,
      title: row.title,
      type: 'lyric',
      themeId: row.theme_id,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as Lyric[];
  }

  private getSlidesByIds(ids: Id[]): Slide[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT s.id, s.presentation_id, s.lyric_id, s.theme_id, s.overlay_id, s.stage_id, s.kind, s.width, s.height, s.notes, s.order_index, s.created_at, s.updated_at,
                COALESCE(d.order_index, l.order_index) AS content_order
         FROM slides s
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         WHERE s.id IN (${placeholders})
         ORDER BY content_order ASC, s.order_index ASC`
      )
      .all(...ids) as Array<{
        id: string;
        presentation_id: string | null;
        lyric_id: string | null;
        theme_id: string | null;
        overlay_id: string | null;
        stage_id: string | null;
        kind: SlideKind;
        width: number;
        height: number;
        notes: string;
        order_index: number;
        created_at: string;
        updated_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      themeId: row.theme_id,
      overlayId: row.overlay_id,
      stageId: row.stage_id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getMediaAssetsByIds(ids: Id[]): MediaAsset[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, src, collection_id, order_index, created_at, updated_at, 'image' AS type FROM image_assets WHERE id IN (${placeholders})
         UNION ALL
         SELECT id, name, src, collection_id, order_index, created_at, updated_at, 'video' AS type FROM video_assets WHERE id IN (${placeholders})
         UNION ALL
         SELECT id, name, src, collection_id, order_index, created_at, updated_at, 'audio' AS type FROM audio_assets WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC, id ASC`
      )
      .all(...ids, ...ids, ...ids) as Array<{
      id: string;
      name: string;
      type: MediaAssetType;
      src: string;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      src: row.src,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getOverlaysByIds(ids: Id[]): Overlay[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, animation_json, collection_id, created_at, updated_at
         FROM overlays
         WHERE id IN (${placeholders})
         ORDER BY created_at ASC, id ASC`
      )
      .all(...ids) as Array<{
      id: string;
      name: string;
      enabled: number;
      animation_json: string;
      collection_id: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        enabled: row.enabled === 1,
        elements: this.getSlideElementsBySlideId(slideId),
        animation: normalizeOverlayAnimation(parseJson(row.animation_json)),
        collectionId: row.collection_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getThemesByIds(ids: Id[]): Theme[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, kind, width, height, order_index, collection_id, created_at, updated_at
         FROM themes
         WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(...ids) as Array<{
      id: string;
      name: string;
      kind: string;
      width: number;
      height: number;
      order_index: number;
      collection_id: string;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        kind: this.normalizeThemeKind(row.kind),
        width: row.width,
        height: row.height,
        order: row.order_index,
        elements: this.getSlideElementsBySlideId(slideId),
        collectionId: row.collection_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getSlideElementsByIds(ids: Id[]): SlideElement[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at
         FROM slide_elements
         WHERE id IN (${placeholders})`
      )
      .all(...ids) as Array<{
        id: string;
        slide_id: string;
        type: SlideElement['type'];
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        opacity: number;
        z_index: number;
        layer: SlideElement['layer'];
        payload_json: string;
        created_at: string;
        updated_at: string;
      }>;
    return rows.map((row) => ({
      id: row.id,
      slideId: row.slide_id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      opacity: row.opacity,
      zIndex: row.z_index,
      layer: row.layer,
      payload: parseJson<SlideElementPayload>(row.payload_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Create the owning slide row for a theme/overlay/stage container.
   * Sets exactly one of theme_id/overlay_id/stage_id back to the container.
   */
  private createContainerSlide(
    slideId: Id,
    kind: 'theme' | 'overlay' | 'stage',
    parentId: Id,
    width: number,
    height: number,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO slides (id, presentation_id, lyric_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
         VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)`
      )
      .run(
        slideId,
        kind === 'theme' ? parentId : null,
        kind === 'overlay' ? parentId : null,
        kind === 'stage' ? parentId : null,
        kind,
        width,
        height,
        now,
        now,
      );
  }

  /**
   * Update the geometry of a container slide (themes/overlays/stages keep
   * width/height denormalized for convenience).
   */
  private updateContainerSlideGeometry(slideId: Id, width: number, height: number, now: string): void {
    this.db
      .prepare('UPDATE slides SET width = ?, height = ?, updated_at = ? WHERE id = ?')
      .run(width, height, now, slideId);
  }

  /**
   * Replace all slide_elements for a container slide. Used by theme/overlay/
   * stage update paths — they always replace the full element list rather
   * than diffing.
   */
  private replaceContainerElements(slideId: Id, elements: SlideElement[], now: string): void {
    this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
    const insert = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const element of elements) {
      insert.run(
        element.id ?? createId(),
        slideId,
        element.type,
        element.x,
        element.y,
        element.width,
        element.height,
        element.rotation ?? 0,
        element.opacity ?? 1,
        element.zIndex ?? 0,
        element.layer ?? 'content',
        JSON.stringify(element.payload),
        element.createdAt ?? now,
        element.updatedAt ?? now,
      );
    }
  }

  /**
   * Delete a container slide and all its slide_elements (used when the
   * owning theme/overlay/stage is deleted).
   */
  private deleteContainerSlide(slideId: Id): void {
    this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
    this.db.prepare('DELETE FROM slides WHERE id = ?').run(slideId);
  }

  private getSlideElementsBySlideId(slideId: Id): SlideElement[] {
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, created_at, updated_at
         FROM slide_elements
         WHERE slide_id = ?
         ORDER BY layer ASC, z_index ASC, created_at ASC`
      )
      .all(slideId) as Array<{
      id: string;
      slide_id: string;
      type: SlideElement['type'];
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      opacity: number;
      z_index: number;
      layer: SlideElement['layer'];
      payload_json: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      slideId: row.slide_id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      opacity: row.opacity,
      zIndex: row.z_index,
      layer: row.layer,
      payload: parseJson<SlideElementPayload>(row.payload_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getSlideIdsForOwner(ownerColumn: 'presentation_id' | 'lyric_id', ownerId: Id): Id[] {
    return (this.db
      .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(ownerId) as Array<{ id: string }>)
      .map((row) => row.id);
  }

  private getSlideElementIdsBySlideIds(slideIds: Id[]): Id[] {
    if (slideIds.length === 0) return [];
    const placeholders = slideIds.map(() => '?').join(',');
    return (this.db
      .prepare(`SELECT id FROM slide_elements WHERE slide_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
      .all(...slideIds) as Array<{ id: string }>)
      .map((row) => row.id);
  }

  private assertValidDeckBundleManifest(manifest: DeckBundleManifest): void {
    if (!manifest || manifest.format !== 'cast-deck-bundle' || manifest.version !== 1) {
      throw new Error('Unsupported bundle format.');
    }

    if (!Array.isArray(manifest.items) || !Array.isArray(manifest.themes)) {
      throw new Error('Invalid bundle manifest.');
    }

    const themeIds = new Set<Id>();
    for (const theme of manifest.themes) {
      if (!theme?.id || !theme.name) throw new Error('Invalid bundle theme.');
      if (theme.kind !== 'slides' && theme.kind !== 'lyrics' && theme.kind !== 'overlays') {
        throw new Error(`Unknown theme kind: ${theme.kind}`);
      }
      themeIds.add(theme.id);
    }

    for (const item of manifest.items) {
      if (!item?.id || !item.title) throw new Error('Invalid bundle item.');
      if (item.type !== 'presentation' && item.type !== 'lyric') {
        throw new Error(`Unknown content item type: ${item.type}`);
      }
      if (item.themeId && !themeIds.has(item.themeId)) {
        throw new Error(`Bundle item ${item.title} references a missing theme.`);
      }
      if (item.themeId) {
        const theme = manifest.themes.find((entry) => entry.id === item.themeId) ?? null;
        if (!theme || !isThemeCompatibleWithDeckItem(theme as Theme, item.type)) {
          throw new Error(`Bundle item ${item.title} has an incompatible theme.`);
        }
      }
      for (const slide of item.slides) {
        if (!slide?.id || !Array.isArray(slide.elements)) {
          throw new Error(`Invalid slide in ${item.title}.`);
        }
      }
    }

    if (manifest.overlays !== undefined) {
      if (!Array.isArray(manifest.overlays)) throw new Error('Invalid bundle overlays.');
      for (const overlay of manifest.overlays) {
        if (!overlay?.id || !overlay.name || !Array.isArray(overlay.elements)) {
          throw new Error('Invalid bundle overlay.');
        }
      }
    }

    if (manifest.stages !== undefined) {
      if (!Array.isArray(manifest.stages)) throw new Error('Invalid bundle stages.');
      for (const stage of manifest.stages) {
        if (!stage?.id || !stage.name || !Array.isArray(stage.elements)) {
          throw new Error('Invalid bundle stage.');
        }
      }
    }
  }

  private collectBrokenBundleReferences(manifest: DeckBundleManifest): BrokenDeckBundleReference[] {
    const references = new Map<string, BrokenReferenceAccumulator>();

    function collect(
      elements: SlideElement[],
      owner: { itemTitle?: string; themeName?: string; overlayName?: string; stageName?: string },
    ) {
      for (const element of elements) {
        const reference = readElementMediaReference(element);
        if (!reference || !isBrokenMediaSource(reference.source)) continue;
        const current = references.get(reference.source) ?? {
          elementTypes: new Set<'image' | 'video'>(),
          occurrenceCount: 0,
          itemTitles: new Set<string>(),
          themeNames: new Set<string>(),
          overlayNames: new Set<string>(),
          stageNames: new Set<string>(),
        };
        current.elementTypes.add(reference.elementType);
        current.occurrenceCount += 1;
        if (owner.itemTitle) current.itemTitles.add(owner.itemTitle);
        if (owner.themeName) current.themeNames.add(owner.themeName);
        if (owner.overlayName) current.overlayNames.add(owner.overlayName);
        if (owner.stageName) current.stageNames.add(owner.stageName);
        references.set(reference.source, current);
      }
    }

    for (const item of manifest.items) {
      for (const slide of item.slides) {
        collect(slide.elements, { itemTitle: item.title });
      }
    }

    for (const theme of manifest.themes) {
      collect(theme.elements, { themeName: theme.name });
    }

    for (const overlay of manifest.overlays ?? []) {
      collect(overlay.elements, { overlayName: overlay.name });
    }

    for (const stage of manifest.stages ?? []) {
      collect(stage.elements, { stageName: stage.name });
    }

    return Array.from(references.entries())
      .map(([source, reference]) => ({
        source,
        elementTypes: Array.from(reference.elementTypes).sort(),
        occurrenceCount: reference.occurrenceCount,
        itemTitles: Array.from(reference.itemTitles).sort(),
        themeNames: Array.from(reference.themeNames).sort(),
        overlayNames: Array.from(reference.overlayNames).sort(),
        stageNames: Array.from(reference.stageNames).sort(),
      }))
      .sort((left, right) => left.source.localeCompare(right.source));
  }

  private applyBrokenReferenceDecisions(
    manifest: DeckBundleManifest,
    decisionMap: ReadonlyMap<string, DeckBundleBrokenReferenceDecision>,
  ): void {
    function rewriteElements(
      elements: SlideElement[],
      localDecisionMap: ReadonlyMap<string, DeckBundleBrokenReferenceDecision>,
    ): SlideElement[] {
      return elements.flatMap((element) => {
        const reference = readElementMediaReference(element);
        if (!reference || !isBrokenMediaSource(reference.source)) return [element];
        const decision = localDecisionMap.get(reference.source);
        if (!decision || decision.action === 'leave') return [element];
        if (decision.action === 'remove') return [];
        const nextSrc = toCastMediaSource(decision.replacementPath ?? '');
        if (!nextSrc) {
          throw new Error(`Invalid replacement path for ${reference.source}`);
        }
        return [{
          ...element,
          payload: {
            ...element.payload,
            src: nextSrc,
          },
        }];
      });
    }

    manifest.items = manifest.items.map((item) => ({
      ...item,
      slides: item.slides.map((slide) => ({
        ...slide,
        elements: rewriteElements(slide.elements, decisionMap),
      })),
    }));
    manifest.themes = manifest.themes.map((theme) => ({
      ...theme,
      elements: rewriteElements(theme.elements, decisionMap),
    }));
    if (manifest.overlays) {
      manifest.overlays = manifest.overlays.map((overlay) => ({
        ...overlay,
        elements: rewriteElements(overlay.elements, decisionMap),
      }));
    }
    if (manifest.stages) {
      manifest.stages = manifest.stages.map((stage) => ({
        ...stage,
        elements: rewriteElements(stage.elements, decisionMap),
      }));
    }
    manifest.mediaReferences = collectDeckBundleMediaReferences(
      manifest.items,
      manifest.themes,
      manifest.overlays ?? [],
      manifest.stages ?? [],
    );
  }

  private collectReplacementMediaSources(
    brokenReferences: BrokenDeckBundleReference[],
    decisionMap: ReadonlyMap<string, DeckBundleBrokenReferenceDecision>,
  ): Array<{ rawPath: string; src: string; elementTypes: Array<'image' | 'video'> }> {
    return brokenReferences.flatMap((reference) => {
      const decision = decisionMap.get(reference.source);
      if (!decision || decision.action !== 'replace' || !decision.replacementPath) return [];
      const normalizedSrc = toCastMediaSource(decision.replacementPath);
      if (!normalizedSrc) {
        throw new Error(`Invalid replacement path for ${reference.source}`);
      }
      return [{
        rawPath: decision.replacementPath,
        src: normalizedSrc,
        elementTypes: reference.elementTypes,
      }];
    });
  }

  private inferImportedMediaAssetType(
    elementTypes: Array<'image' | 'video'>,
    src: string,
  ): MediaAsset['type'] {
    const extension = path.extname(src).toLowerCase();
    if (extension === '.mp4' || extension === '.mov' || extension === '.webm' || extension === '.m4v') {
      return 'video';
    }
    if (elementTypes.includes('video') && !elementTypes.includes('image')) return 'video';
    return 'image';
  }

  private createImportedThemeElement(
    element: SlideElement,
    themeId: Id,
    now: string,
    elementIndex: number,
  ): SlideElement {
    return {
      ...JSON.parse(JSON.stringify(element)) as SlideElement,
      id: `${themeId}:theme:${elementIndex}`,
      slideId: themeId,
      createdAt: now,
      updatedAt: now,
    };
  }

  private createImportedSlideElement(
    element: SlideElement,
    slideId: Id,
    now: string,
    elementIndex: number,
  ): SlideElement {
    return {
      ...JSON.parse(JSON.stringify(element)) as SlideElement,
      id: `${slideId}:element:${elementIndex}`,
      slideId,
      createdAt: now,
      updatedAt: now,
    };
  }

  private getNextThemeOrderIndex(): number {
    const row = this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM themes').get() as { maxOrder: number | null };
    return (row.maxOrder ?? -1) + 1;
  }

  private getNextMediaAssetOrderIndex(): number {
    const row = this.db
      .prepare(
        `SELECT MAX(maxOrder) AS maxOrder FROM (
           SELECT MAX(order_index) AS maxOrder FROM image_assets
           UNION ALL SELECT MAX(order_index) FROM video_assets
           UNION ALL SELECT MAX(order_index) FROM audio_assets
         )`
      )
      .get() as { maxOrder: number | null };
    return (row.maxOrder ?? -1) + 1;
  }

  private getLibraries(): Library[] {
    const rows = this.db
      .prepare('SELECT id, name, order_index, created_at, updated_at FROM libraries ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string; name: string; order_index: number; created_at: string; updated_at: string }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getPresentations(): Presentation[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at FROM presentations ORDER BY order_index ASC, created_at ASC'
      )
      .all() as Array<{
      id: string;
      title: string;
      theme_id: string | null;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => buildDeckItem({
      id: row.id,
      title: row.title,
      type: 'presentation',
      themeId: row.theme_id,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })) as Presentation[];
  }

  private getLyrics(): Lyric[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at FROM lyrics ORDER BY order_index ASC, created_at ASC'
      )
      .all() as Array<{
      id: string;
      title: string;
      theme_id: string | null;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => buildDeckItem({
      id: row.id,
      title: row.title,
      type: 'lyric',
      themeId: row.theme_id,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })) as Lyric[];
  }

  private getSlides(): Slide[] {
    // Only deck slides (presentation/lyric kind) flow through the snapshot.
    // Theme/overlay/stage slides are surfaced via their owning container's
    // `elements` field instead.
    const rows = this.db
      .prepare(
        `SELECT s.id, s.presentation_id, s.lyric_id, s.theme_id, s.overlay_id, s.stage_id, s.kind, s.width, s.height, s.notes, s.order_index, s.created_at, s.updated_at,
                COALESCE(d.order_index, l.order_index) AS content_order
         FROM slides s
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         WHERE s.presentation_id IS NOT NULL OR s.lyric_id IS NOT NULL
         ORDER BY content_order ASC, s.order_index ASC`
      )
      .all() as Array<{
      id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      theme_id: string | null;
      overlay_id: string | null;
      stage_id: string | null;
      kind: SlideKind;
      width: number;
      height: number;
      notes: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      themeId: row.theme_id,
      overlayId: row.overlay_id,
      stageId: row.stage_id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getSlideElements(): SlideElement[] {
    const rows = this.db
      .prepare(
        `SELECT se.*
         FROM slide_elements se
         JOIN slides s ON s.id = se.slide_id
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         ORDER BY COALESCE(d.order_index, l.order_index) ASC, s.order_index ASC, se.layer ASC, se.z_index ASC`
      )
      .all() as Array<{
      id: string;
      slide_id: string;
      type: SlideElement['type'];
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      opacity: number;
      z_index: number;
      layer: SlideElement['layer'];
      payload_json: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      slideId: row.slide_id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      opacity: row.opacity,
      zIndex: row.z_index,
      layer: row.layer,
      payload: parseJson<SlideElementPayload>(row.payload_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getPlaylistsByLibrary(libraryId: Id): Playlist[] {
    const rows = this.db
      .prepare(
        'SELECT id, library_id, name, order_index, created_at, updated_at FROM playlists WHERE library_id = ? ORDER BY order_index ASC, created_at ASC'
      )
      .all(libraryId) as Array<{
      id: string;
      library_id: string;
      name: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      libraryId: row.library_id,
      name: row.name,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getPlaylistSegments(playlistId: Id): PlaylistSegment[] {
    const rows = this.db
      .prepare(
        'SELECT id, playlist_id, name, color_key, order_index, created_at, updated_at FROM playlist_segments WHERE playlist_id = ? ORDER BY order_index ASC'
      )
      .all(playlistId) as Array<{
      id: string;
      playlist_id: string;
      name: string;
      color_key: string | null;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      playlistId: row.playlist_id,
      name: row.name,
      colorKey: row.color_key,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getPlaylistEntries(segmentId: Id): PlaylistEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, segment_id, presentation_id, lyric_id, order_index, created_at, updated_at FROM playlist_entries WHERE segment_id = ? ORDER BY order_index ASC'
      )
      .all(segmentId) as Array<{
      id: string;
      segment_id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      segmentId: row.segment_id,
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getPlaylistTreesByLibrary(libraryId: Id, itemsById: ReadonlyMap<Id, DeckItem>): PlaylistTree[] {
    return this.getPlaylistsByLibrary(libraryId).map((playlist) => {
      const segments = this.getPlaylistSegments(playlist.id).map((segment) => {
        const entries = this.getPlaylistEntries(segment.id)
          .map((entry) => {
            const itemId = entry.presentationId ?? entry.lyricId;
            if (!itemId) return null;
            const item = itemsById.get(itemId);
            if (!item) return null;
            return { entry, item };
          })
          .filter((value): value is { entry: PlaylistEntry; item: DeckItem } => value !== null);

        return { segment, entries };
      });

      return {
        playlist,
        segments
      };
    });
  }

  private getMediaAssets(): MediaAsset[] {
    // Union the three split storage tables back into a single MediaAsset[] view.
    const rows = this.db
      .prepare(
        `SELECT id, name, src, collection_id, order_index, created_at, updated_at, 'image' AS type FROM image_assets
         UNION ALL
         SELECT id, name, src, collection_id, order_index, created_at, updated_at, 'video' AS type FROM video_assets
         UNION ALL
         SELECT id, name, src, collection_id, order_index, created_at, updated_at, 'audio' AS type FROM audio_assets
         ORDER BY order_index ASC, created_at ASC, id ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      type: MediaAssetType;
      src: string;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      src: row.src,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getOverlays(): Overlay[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, animation_json, collection_id, created_at, updated_at
         FROM overlays
         ORDER BY created_at ASC, id ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      enabled: number;
      animation_json: string;
      collection_id: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        enabled: row.enabled === 1,
        elements: this.getSlideElementsBySlideId(slideId),
        animation: normalizeOverlayAnimation(parseJson(row.animation_json)),
        collectionId: row.collection_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getThemes(): Theme[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, kind, width, height, order_index, collection_id, created_at, updated_at
         FROM themes
         ORDER BY order_index ASC, created_at ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      kind: string;
      width: number;
      height: number;
      order_index: number;
      collection_id: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        kind: this.normalizeThemeKind(row.kind),
        width: row.width,
        height: row.height,
        order: row.order_index,
        elements: this.getSlideElementsBySlideId(slideId),
        collectionId: row.collection_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getStages(): Stage[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, width, height, order_index, collection_id, created_at, updated_at
         FROM stages
         ORDER BY order_index ASC, created_at ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      order_index: number;
      collection_id: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        width: row.width,
        height: row.height,
        order: row.order_index,
        elements: this.getSlideElementsBySlideId(slideId),
        collectionId: row.collection_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getStagesByIds(ids: Id[]): Stage[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, width, height, order_index, collection_id, created_at, updated_at
         FROM stages
         WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(...ids) as Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      order_index: number;
      collection_id: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        width: row.width,
        height: row.height,
        order: row.order_index,
        elements: this.getSlideElementsBySlideId(slideId),
        collectionId: row.collection_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getThemeById(themeId: Id): Theme | null {
    const row = this.db
      .prepare(
        `SELECT id, name, kind, width, height, order_index, collection_id, created_at, updated_at
         FROM themes
         WHERE id = ?`
      )
      .get(themeId) as {
        id: string;
        name: string;
        kind: string;
        width: number;
        height: number;
        order_index: number;
        collection_id: string;
        created_at: string;
        updated_at: string;
      } | undefined;
    if (!row) return null;
    const slideId = `${row.id}:slide`;
    return {
      id: row.id,
      slideId,
      name: row.name,
      kind: this.normalizeThemeKind(row.kind),
      width: row.width,
      height: row.height,
      order: row.order_index,
      elements: this.getSlideElementsBySlideId(slideId),
      collectionId: row.collection_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private normalizePlaylistOrder(libraryId: Id): void {
    this.db
      .prepare(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY order_index ASC, created_at ASC, id ASC) - 1 AS next_order
           FROM playlists
           WHERE library_id = ?
         )
         UPDATE playlists
         SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = playlists.id)
         WHERE library_id = ?`
      )
      .run(libraryId, libraryId);
  }

  private normalizeDeckItemOrder(): void {
    const orderedItems = this.getOrderedContentReferences();
    const now = nowIso();
    const tx = this.db.transaction(() => {
      orderedItems.forEach((item, index) => {
        this.db
          .prepare(`UPDATE ${this.getDeckTableName(item.type)} SET order_index = ?, updated_at = ? WHERE id = ?`)
          .run(index, now, item.id);
      });
    });
    tx();
  }

  private normalizeThemeOrder(): void {
    const themes = this.db
      .prepare('SELECT id FROM themes ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string }>;
    const update = this.db.prepare('UPDATE themes SET order_index = ?, updated_at = ? WHERE id = ?');
    const now = nowIso();

    const tx = this.db.transaction(() => {
      themes.forEach((theme, index) => {
        update.run(index, now, theme.id);
      });
    });

    tx();
  }
}
