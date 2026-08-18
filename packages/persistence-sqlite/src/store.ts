import fs from 'node:fs';
import path from 'node:path';
import {
  cloneBundleManifest,
  collectBundleMediaReferences,
  collectBundlePlaylistItemIds,
  filterBundlePlaylistsToIncludedItems,
  getBundlePlaylistEntryReference,
  isLegacyProjectBackup,
  PROJECT_BACKUP_FORMAT,
  PROJECT_BACKUP_VERSION,
  ProjectBackupValidationError,
  readElementMediaReference,
  validateBundleManifest,
  validateLegacyProjectBackup,
  validateProjectBackup as validateProjectBackupDocument,
  type ProjectBackupTableKey,
} from '@lumacast/protocol';
import type { ProjectRestoreResult } from '@lumacast/protocol';
import { buildProjectBackupTables } from './project-backup-io';
import { migrateLegacyProjectBackup } from './legacy-project-backup';
import {
  makePlaylistItemReference,
  parsePlaylistItemReference,
  toPlaylistItemOwnerColumns,
  type PlaylistItemOwnerColumns,
  type PlaylistItemReference,
  applyThemeToElements,
  createDefaultThemeElements,
  syncThemeToElements,
} from '@lumacast/composition';
import { createId, nowIso } from '@lumacast/kernel';
import {
  decodeCuePayloadJson,
  decodeOverlayAnimationJson,
  decodeSlideBackgroundJson,
  decodeSlideElementPayload,
  decodeSlideElementPayloadJson,
  type CodecContext,
} from '@lumacast/protocol';
import { SqliteDatabase } from './sqlite';
import { LATEST_SCHEMA_VERSION, runMigrations } from './migrations';
// Domain primitives (#153, #219): owned by @lumacast/composition, imported
// directly rather than through the app/core/types.ts facade.
import type { Id } from '@lumacast/kernel';
import type {
  ItemType,
  ItemRef,
  ThemeOwnerType,
  Presentation,
  Lyric,
  Talk,
  Slide,
  SlideKind,
  SlideBackground,
  SlideBackgroundSource,
  TalkScriptBlock,
  SlideElement,
  SlideElementPayload,
  GroupElementPayload,
  MediaAsset,
  MediaAssetType,
  Overlay,
  OverlayAnimation,
  PresentationTheme,
  Stage,
  Playlist,
  PlaylistItemEntry,
  PlaylistSeparator,
  PlaylistRow,
} from '@lumacast/composition';
import type {
  Cue,
  CueFailurePolicy,
  CueKind,
  Macro,
  MacroCue,
  OnScopeExit,
  ScopeLevel,
  TriggerBinding,
  TriggerBindingTargetType,
  TriggerType,
} from '@lumacast/automation';
// The ProjectBackup family lives in the neutral @lumacast/protocol boundary
// (a serialization contract, not a persistence DTO) — see
// docs/ARCHITECTURE.md for the recorded rationale.
import type {
  ProjectBackup,
  ProjectBackupItemRow,
  ProjectBackupThemeRow,
} from '@lumacast/protocol';
import type {
  AppSnapshot,
  CueCreateInput,
  CueUpdateInput,
  BrokenBundleReference,
  BundleBrokenReferenceDecision,
  BundleExportOptions,
  BundleInspection,
  BundleInspectionOverlay,
  BundleInspectionPlaylist,
  BundleInspectionStage,
  BundleInspectionTheme,
  BundleItem,
  BundleManifest,
  BundleOverlay,
  BundlePlaylist,
  BundlePlaylistRow,
  BundleSlide,
  BundleStage,
  BundleTalkScriptBlock,
  BundleTheme,
  ElementCreateInput,
  ElementUpdateInput,
  ItemCreateInput,
  ItemCreateResult,
  ItemDuplicateInput,
  ItemDuplicateResult,
  MacroCreateInput,
  MacroUpdateInput,
  MediaAssetCreateInput,
  OverlayCreateInput,
  OverlayUpdateInput,
  SlideBackgroundUpdateInput,
  SlideCreateInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  TalkScriptBlockCreateInput,
  TalkScriptBlockOrderUpdateInput,
  TalkScriptBlockUpdateInput,
  ThemeCreateInput,
  ThemeUpdateInput,
  TriggerBindingCreateInput,
} from '@lumacast/protocol';
import { isBrokenMediaSource, toCastMediaSource } from './media-source-utils';
import type { SnapshotPatch } from '@lumacast/protocol';

const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

const MEDIA_ASSET_TABLES = ['image_assets', 'video_assets', 'audio_assets'] as const;
const PROJECT_BACKUP_MEDIA_ASSET_TABLES = MEDIA_ASSET_TABLES;

// #219 item-model refactor decision D2: the four per-owner theme tables.
// PresentationTheme/LyricTheme/TalkTheme/OverlayTheme are literally the same
// structural shape (see @lumacast/composition/domain/theme.ts), so one set of
// table-parameterized helpers below serves all four families; only the table
// name and the container-slide owner column differ.
const THEME_TABLE_BY_TYPE = {
  presentation: 'presentation_themes',
  lyric: 'lyric_themes',
  talk: 'talk_themes',
  overlay: 'overlay_themes',
} as const satisfies Record<ThemeOwnerType, string>;
type ThemeTableName = typeof THEME_TABLE_BY_TYPE[ThemeOwnerType];

// #219 decision D1: the three independent item tables/columns. There is no
// merged id space and no cross-type order — every lookup and every reorder
// op goes through exactly one of these three.
const ITEM_TABLE_BY_TYPE = {
  presentation: 'presentations',
  lyric: 'lyrics',
  talk: 'talks',
} as const satisfies Record<ItemType, string>;
type ItemTableName = typeof ITEM_TABLE_BY_TYPE[ItemType];

const ITEM_OWNER_COLUMN_BY_TYPE = {
  presentation: 'presentation_id',
  lyric: 'lyric_id',
  talk: 'talk_id',
} as const satisfies Record<ItemType, string>;

// The slide `kind` values a container slide can carry, and the matching
// exclusive-arc owner column each one populates (decision D2 addendum: the
// old bare 'theme' kind splits into one value per theme family).
type ContainerKind = 'presentationTheme' | 'lyricTheme' | 'talkTheme' | 'overlayTheme' | 'overlay' | 'stage';

function themeContainerKind(themeType: ThemeOwnerType): ContainerKind {
  switch (themeType) {
    case 'presentation': return 'presentationTheme';
    case 'lyric': return 'lyricTheme';
    case 'talk': return 'talkTheme';
    case 'overlay': return 'overlayTheme';
  }
}

const THEME_CONTAINER_KIND_BY_TABLE: Record<ThemeTableName, ContainerKind> = {
  presentation_themes: 'presentationTheme',
  lyric_themes: 'lyricTheme',
  talk_themes: 'talkTheme',
  overlay_themes: 'overlayTheme',
};

const PROJECT_BACKUP_TABLE_KEYS = [
  'presentation_themes',
  'lyric_themes',
  'talk_themes',
  'overlay_themes',
  'presentations',
  'lyrics',
  'talks',
  'overlays',
  'stages',
  'slides',
  'slide_elements',
  'talk_script_blocks',
  'image_assets',
  'video_assets',
  'audio_assets',
  'playlists',
  'playlist_entries',
  'cues',
  'actions',
  'action_steps',
  'trigger_bindings',
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
function assertProjectBackupReferences(backup: ProjectBackup): void {
  const t = backup.tables;
  const ids = {
    presentations: collectProjectBackupIds(t.presentations),
    lyrics: collectProjectBackupIds(t.lyrics),
    talks: collectProjectBackupIds(t.talks),
    slides: collectProjectBackupIds(t.slides),
    slide_elements: collectProjectBackupIds(t.slide_elements),
    playlists: collectProjectBackupIds(t.playlists),
    presentation_themes: collectProjectBackupIds(t.presentation_themes),
    lyric_themes: collectProjectBackupIds(t.lyric_themes),
    talk_themes: collectProjectBackupIds(t.talk_themes),
    overlay_themes: collectProjectBackupIds(t.overlay_themes),
    overlays: collectProjectBackupIds(t.overlays),
    stages: collectProjectBackupIds(t.stages),
    cues: collectProjectBackupIds(t.cues),
    actions: collectProjectBackupIds(t.actions),
  };

  for (const row of t.presentations) assertProjectBackupReference(ids.presentation_themes, 'presentations', 'theme_id', row.id, row.theme_id);
  for (const row of t.lyrics) assertProjectBackupReference(ids.lyric_themes, 'lyrics', 'theme_id', row.id, row.theme_id);
  for (const row of t.talks) assertProjectBackupReference(ids.talk_themes, 'talks', 'theme_id', row.id, row.theme_id);
  for (const row of t.slides) {
    assertProjectBackupReference(ids.presentations, 'slides', 'presentation_id', row.id, row.presentation_id);
    assertProjectBackupReference(ids.lyrics, 'slides', 'lyric_id', row.id, row.lyric_id);
    assertProjectBackupReference(ids.talks, 'slides', 'talk_id', row.id, row.talk_id);
    assertProjectBackupReference(ids.presentation_themes, 'slides', 'presentation_theme_id', row.id, row.presentation_theme_id);
    assertProjectBackupReference(ids.lyric_themes, 'slides', 'lyric_theme_id', row.id, row.lyric_theme_id);
    assertProjectBackupReference(ids.talk_themes, 'slides', 'talk_theme_id', row.id, row.talk_theme_id);
    assertProjectBackupReference(ids.overlay_themes, 'slides', 'overlay_theme_id', row.id, row.overlay_theme_id);
    assertProjectBackupReference(ids.overlays, 'slides', 'overlay_id', row.id, row.overlay_id);
    assertProjectBackupReference(ids.stages, 'slides', 'stage_id', row.id, row.stage_id);
  }
  for (const row of t.slide_elements) {
    assertProjectBackupReference(ids.slides, 'slide_elements', 'slide_id', row.id, row.slide_id);
    assertProjectBackupReference(ids.slide_elements, 'slide_elements', 'source_theme_element_id', row.id, row.source_theme_element_id);
  }
  for (const row of t.talk_script_blocks) {
    assertProjectBackupReference(ids.slides, 'talk_script_blocks', 'slide_id', row.id, row.slide_id);
  }
  for (const row of t.playlist_entries) {
    assertProjectBackupReference(ids.playlists, 'playlist_entries', 'playlist_id', row.id, row.playlist_id);
    assertProjectBackupReference(ids.presentations, 'playlist_entries', 'presentation_id', row.id, row.presentation_id);
    assertProjectBackupReference(ids.lyrics, 'playlist_entries', 'lyric_id', row.id, row.lyric_id);
    assertProjectBackupReference(ids.talks, 'playlist_entries', 'talk_id', row.id, row.talk_id);
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

/**
 * Inserts every row of the backup into `db` in FK-safe parent-before-child
 * order, with every column mapped explicitly. Runs in one transaction so a
 * mid-insert failure leaves the temporary database empty.
 */
function insertProjectBackupRows(db: SqliteDatabase, backup: ProjectBackup): void {
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
    insertThemeTable('talk_themes', t.talk_themes);
    insertThemeTable('overlay_themes', t.overlay_themes);

    const insertItemTable = (tableName: ItemTableName, rows: readonly ProjectBackupItemRow[]): void => {
      const insert = db.prepare(
        `INSERT INTO ${tableName} (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        insert.run(row.id, row.title, row.theme_id, row.order_index, row.created_at, row.updated_at);
      }
    };
    insertItemTable('presentations', t.presentations);
    insertItemTable('lyrics', t.lyrics);
    insertItemTable('talks', t.talks);

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

    const insertSlide = db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.slides) {
      insertSlide.run(
        row.id, row.presentation_id, row.lyric_id, row.talk_id,
        row.presentation_theme_id, row.lyric_theme_id, row.talk_theme_id, row.overlay_theme_id,
        row.overlay_id, row.stage_id, row.kind, row.width, row.height, row.notes,
        row.background_json, row.background_source, row.order_index, row.created_at, row.updated_at,
      );
    }

    const insertSlideElement = db.prepare(
      `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.slide_elements) {
      insertSlideElement.run(
        row.id, row.slide_id, row.type, row.x, row.y, row.width, row.height,
        row.rotation, row.opacity, row.z_index, row.layer, row.payload_json,
        row.source_theme_element_id, row.created_at, row.updated_at,
      );
    }

    const insertTalkScriptBlock = db.prepare(
      'INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.talk_script_blocks) {
      insertTalkScriptBlock.run(row.id, row.slide_id, row.text, row.order_index, row.created_at, row.updated_at);
    }

    for (const tableName of PROJECT_BACKUP_MEDIA_ASSET_TABLES) {
      const insertMediaAsset = db.prepare(
        `INSERT INTO ${tableName} (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const row of t[tableName]) {
        insertMediaAsset.run(row.id, row.name, row.src, row.order_index, row.created_at, row.updated_at);
      }
    }

    const insertPlaylist = db.prepare(
      'INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const row of t.playlists) {
      insertPlaylist.run(row.id, row.name, row.order_index, row.created_at, row.updated_at);
    }

    const insertPlaylistEntry = db.prepare(
      `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.playlist_entries) {
      insertPlaylistEntry.run(
        row.id, row.playlist_id, row.kind, row.presentation_id, row.lyric_id, row.talk_id,
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
  });
  tx();
}

/**
 * Completeness gate before promotion: every application-owned table in the
 * temporary database must hold exactly the number of rows the backup
 * declares.
 */
function assertProjectBackupRowCounts(db: SqliteDatabase, backup: ProjectBackup): void {
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
function assertProjectBackupForeignKeys(db: SqliteDatabase): void {
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

function moveSqliteSidecars(sourceBase: string, targetBase: string): void {
  for (const suffix of ['-wal', '-shm']) {
    const source = `${sourceBase}${suffix}`;
    if (fs.existsSync(source)) fs.renameSync(source, `${targetBase}${suffix}`);
  }
}

function removeSqliteSidecars(base: string): void {
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${base}${suffix}`, { force: true });
  }
}

function nextUniqueSiblingPath(base: string, marker: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let candidate = `${base}.${marker}-${stamp}.sqlite`;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${base}.${marker}-${stamp}-${counter}.sqlite`;
    counter += 1;
  }
  return candidate;
}

interface ItemOwnerRow {
  type: ItemType;
  themeId: Id | null;
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

/** Builds the codec context for a persisted JSON column read. */
const persistedContext = (operation: string, path: string): CodecContext => ({
  boundary: 'persisted',
  operation,
  path,
});

/**
 * Builds the codec context for a caller-supplied value that can only be
 * validated once a persisted row has resolved the variant it must satisfy
 * (issue #224).
 */
const resolvedInputContext = (operation: string, path: string): CodecContext => ({
  boundary: 'resolved-input',
  operation,
  path,
});

const normalizeDelayMs = (value: number | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
};

const normalizeLoopCount = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
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

function toBundleTheme(theme: PresentationTheme, themeType: ThemeOwnerType): BundleTheme {
  return {
    id: theme.id,
    name: theme.name,
    themeType,
    width: theme.width,
    height: theme.height,
    order: theme.order,
    elements: theme.elements,
  };
}

function toBundleOverlay(overlay: Overlay): BundleOverlay {
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

function toBundleStage(stage: Stage): BundleStage {
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

function normalizeOverlayAnimation(animation: unknown): Required<OverlayAnimation> {
  const parsed = animation as Partial<OverlayAnimation> | null | undefined;
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

// Used only when serializing to BundleOverlay (legacy export shape that
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

export interface ProjectRecoveryHooks {
  /** Called on the temporary database immediately before rows are inserted. Throwing aborts the restore before any insert. */
  beforeInsert?: (db: SqliteDatabase) => void;
  /** Called on the temporary database after inserts, before row-count/FK validation. Throwing aborts the restore before validation. */
  afterInsert?: (db: SqliteDatabase) => void;
  /** Called after validation passes, before any file operation. Throwing aborts the restore before the swap. */
  beforePromotion?: () => void;
  /**
   * Called after the active database has been renamed to the retained
   * pre-recovery file but before the temporary database is renamed into
   * place. Throwing forces the promotion to roll the swap back so the
   * previous project stays active.
   */
  afterRetainActive?: () => void;
}

export interface RestoreProjectBackupOptions {
  /** Test-only failure-injection hooks; omitted in production. */
  hooks?: ProjectRecoveryHooks;
}

export interface RepositoryOptions {
  dbPath: string;
  userDataPath: string;
  documentsPath: string;
  /**
   * Whether to insert starter onboarding content into an empty database.
   * Defaults to true so real users always get seeded content; tests that
   * don't want to hand-filter starter rows out of every assertion can pass
   * `seed: false` to open a genuinely empty database instead.
   */
  seed?: boolean;
}

/** The full set of ids a mutation may have touched, passed to {@link CastRepository.buildPatch}. */
interface BuildPatchSpec {
  upsertPresentationIds?: Id[];
  upsertLyricIds?: Id[];
  upsertTalkIds?: Id[];
  upsertSlideIds?: Id[];
  upsertTalkScriptBlockIds?: Id[];
  upsertSlideElementIds?: Id[];
  upsertMediaAssetIds?: Id[];
  upsertOverlayIds?: Id[];
  upsertPresentationThemeIds?: Id[];
  upsertLyricThemeIds?: Id[];
  upsertTalkThemeIds?: Id[];
  upsertOverlayThemeIds?: Id[];
  upsertStageIds?: Id[];
  upsertPlaylistIds?: Id[];
  upsertPlaylistEntryIds?: Id[];
  upsertCueIds?: Id[];
  upsertMacroIds?: Id[];
  upsertTriggerBindingIds?: Id[];
  deletedPresentationIds?: Id[];
  deletedLyricIds?: Id[];
  deletedTalkIds?: Id[];
  deletedSlideIds?: Id[];
  deletedTalkScriptBlockIds?: Id[];
  deletedSlideElementIds?: Id[];
  deletedMediaAssetIds?: Id[];
  deletedOverlayIds?: Id[];
  deletedPresentationThemeIds?: Id[];
  deletedLyricThemeIds?: Id[];
  deletedTalkThemeIds?: Id[];
  deletedOverlayThemeIds?: Id[];
  deletedStageIds?: Id[];
  deletedPlaylistIds?: Id[];
  deletedPlaylistEntryIds?: Id[];
  deletedCueIds?: Id[];
  deletedMacroIds?: Id[];
  deletedTriggerBindingIds?: Id[];
}

export class CastRepository {
  private db: SqliteDatabase;
  private patchVersion = 0;
  private readonly dbPath: string;

  constructor(options: RepositoryOptions) {
    this.dbPath = options.dbPath;
    migrateLegacyRecastDatabase(options.userDataPath, this.dbPath);
    this.db = new SqliteDatabase(this.dbPath);
    this.applyConnectionTuning();
    runMigrations(this.db, this.dbPath);
    if (options.seed !== false) {
      this.seedIfEmpty();
    }
  }

  private applyConnectionTuning(db: SqliteDatabase = this.db): void {
    // WAL allows concurrent reads/writes; NORMAL is safe with WAL and
    // significantly faster than the default FULL fsync on commit.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    // 64 MB page cache (negative = KB). Cuts page misses on large snapshot reads.
    db.pragma('cache_size = -65536');
    // 256 MB mmap window — fewer read syscalls; OS pages cached implicitly.
    db.pragma('mmap_size = 268435456');
    // Keep temp tables in RAM (sorts, joins) instead of spilling to disk.
    db.pragma('temp_store = MEMORY');
    // Checkpoint the WAL every ~1000 pages so it doesn't grow unboundedly.
    db.pragma('wal_autocheckpoint = 1000');
  }

  private seedIfEmpty(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM playlists').get() as { count: number };
    if (count.count > 0) return;

    const presentationId = createId();
    const slideId = createId();
    const playlistId = createId();
    const now = nowIso();

    const tx = this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(presentationId, 'Welcome Slides', null, 0, now, now);

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
          `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(createId(), slideId, 'text', 200, 430, 1520, 120, 0, 1, 10, 'content', titlePayload, null, now, now);

      const shapePayload = JSON.stringify({
        fillColor: '#101820CC',
        borderColor: '#FFFFFF33',
        borderWidth: 2,
        borderRadius: 12
      });

      this.db
        .prepare(
          `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(createId(), slideId, 'shape', 160, 380, 1600, 220, 0, 1, 1, 'background', shapePayload, null, now, now);

      this.db
        .prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(playlistId, 'Sunday Service', 0, now, now);

      const welcomeEntryOwner = toPlaylistItemOwnerColumns(makePlaylistItemReference('presentation', presentationId));
      this.db
        .prepare(
          `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(createId(), playlistId, 'item', welcomeEntryOwner.presentationId, welcomeEntryOwner.lyricId, welcomeEntryOwner.talkId, 0, now, now);

      const overlayId = createId();
      const overlaySlideId = `${overlayId}:slide`;
      this.db
        .prepare(
          `INSERT INTO overlays (id, name, enabled, animation_json, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          overlayId,
          'Watermark',
          1,
          JSON.stringify({ kind: 'pulse', durationMs: 2000 }),
          0,
          now,
          now,
        );
      this.createContainerSlide(overlaySlideId, 'overlay', overlayId, DEFAULT_W, DEFAULT_H, now);
      this.db
        .prepare(
          `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          null,
          now,
          now,
        );
    });

    tx();
  }

  getSnapshot(): AppSnapshot {
    return {
      presentations: this.getPresentations(),
      lyrics: this.getLyrics(),
      talks: this.getTalks(),
      slides: this.getSlides(),
      talkScriptBlocks: this.getTalkScriptBlocks(),
      slideElements: this.getSlideElements(),
      mediaAssets: this.getMediaAssets(),
      overlays: this.getOverlays(),
      presentationThemes: this.getThemeRows('presentation_themes'),
      lyricThemes: this.getThemeRows('lyric_themes'),
      talkThemes: this.getThemeRows('talk_themes'),
      overlayThemes: this.getThemeRows('overlay_themes'),
      stages: this.getStages(),
      playlists: this.getPlaylists(),
      playlistEntries: this.getAllPlaylistRows(),
      cues: this.listCues(),
      macros: this.listMacros(),
      triggerBindings: this.listTriggerBindings(),
    };
  }

  listCues(): Cue[] {
    const rows = this.db.prepare(
      `SELECT id, kind, payload_json, failure_policy, created_at, updated_at
       FROM cues
       ORDER BY updated_at DESC, created_at DESC, id ASC`
    ).all() as Array<{
      id: string;
      kind: string;
      payload_json: string;
      failure_policy: string;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as CueKind,
      payload: decodeCuePayloadJson(row.payload_json, persistedContext('listCues', `cues.${row.id}.payload_json`)),
      failurePolicy: row.failure_policy as CueFailurePolicy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createCue(input: CueCreateInput): SnapshotPatch {
    const now = nowIso();
    const cueId = createId();
    this.db.prepare(
      `INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      cueId,
      input.kind,
      JSON.stringify(input.payload),
      input.failurePolicy ?? 'continue',
      now,
      now,
    );
    return this.buildPatch({ upsertCueIds: [cueId] });
  }

  updateCue(input: CueUpdateInput): SnapshotPatch {
    const existing = this.db.prepare(
      'SELECT id, kind, payload_json, failure_policy FROM cues WHERE id = ?'
    ).get(input.id) as {
      id: string;
      kind: string;
      payload_json: string;
      failure_policy: string;
    } | undefined;
    if (!existing) {
      throw new Error(`Cue not found: ${input.id}`);
    }

    const kind = input.kind ?? existing.kind as CueKind;
    const payload = input.payload ?? decodeCuePayloadJson(existing.payload_json, persistedContext('updateCue', `cues.${existing.id}.payload_json`));
    const failurePolicy = input.failurePolicy ?? existing.failure_policy as CueFailurePolicy;
    this.db.prepare(
      `UPDATE cues
       SET kind = ?, payload_json = ?, failure_policy = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      kind,
      JSON.stringify(payload),
      failurePolicy,
      nowIso(),
      input.id,
    );
    // A cue's kind/payload is embedded in action_steps as a denormalized
    // copy; macros that reference it need to refresh their rows too.
    const affectedMacroIds = this.db.prepare(
      'SELECT DISTINCT action_id FROM action_steps WHERE cue_id = ?'
    ).all(input.id) as Array<{ action_id: string }>;
    return this.buildPatch({
      upsertCueIds: [input.id],
      upsertMacroIds: affectedMacroIds.map((row) => row.action_id),
    });
  }

  deleteCue(id: Id): SnapshotPatch {
    const exists = this.db.prepare('SELECT id FROM cues WHERE id = ?').get(id);
    if (!exists) throw new Error(`Cue not found: ${id}`);
    // Capture cascade victims before deleting so the patch reflects them.
    const affectedMacroIds = (this.db.prepare(
      'SELECT DISTINCT action_id FROM action_steps WHERE cue_id = ?'
    ).all(id) as Array<{ action_id: string }>).map((row) => row.action_id);
    const orphanedBindingIds = (this.db.prepare(
      "SELECT id FROM trigger_bindings WHERE target_type = 'cue' AND target_id = ?"
    ).all(id) as Array<{ id: string }>).map((row) => row.id);

    this.db.prepare('DELETE FROM cues WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM action_steps WHERE cue_id = ?').run(id);
    this.db.prepare("DELETE FROM trigger_bindings WHERE target_type = 'cue' AND target_id = ?").run(id);
    return this.buildPatch({
      deletedCueIds: [id],
      upsertMacroIds: affectedMacroIds,
      deletedTriggerBindingIds: orphanedBindingIds,
    });
  }

  listMacros(): Macro[] {
    const rows = this.db.prepare(
      `SELECT id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, order_index, created_at, updated_at
       FROM actions ORDER BY order_index ASC, created_at ASC, id ASC`
    ).all() as Array<{
      id: string;
      name: string;
      description: string;
      scope_level: string;
      on_scope_exit: string;
      loop_enabled: number;
      loop_count: number | null;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    const cuesByMacroId = this.getMacroCuesByMacroIds(rows.map((row) => row.id));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      cues: cuesByMacroId.get(row.id) ?? [],
      scopeLevel: row.scope_level as ScopeLevel,
      onScopeExit: row.on_scope_exit as OnScopeExit,
      loopEnabled: row.loop_enabled === 1,
      loopCount: row.loop_count,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createMacro(input: MacroCreateInput): SnapshotPatch {
    const now = nowIso();
    const macroId = createId();
    const name = input.name.trim() || 'Untitled macro';
    const description = input.description?.trim() ?? '';
    const cues = input.cues ?? [];
    const scopeLevel: ScopeLevel = input.scopeLevel ?? 'global';
    const onScopeExit: OnScopeExit = input.onScopeExit ?? 'cancel';
    const loopEnabled = input.loopEnabled ? 1 : 0;
    const loopCount = normalizeLoopCount(input.loopCount);

    const nextOrder = this.getNextOrderIndex('actions');
    const insertMacro = this.db.prepare(
      `INSERT INTO actions
       (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMacroCue = this.db.prepare(
      `INSERT INTO action_steps
       (id, action_id, cue_id, kind, order_index, payload_json, failure_policy, delay_before_ms, delay_after_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = this.db.transaction(() => {
      insertMacro.run(macroId, name, description, scopeLevel, onScopeExit, loopEnabled, loopCount, nextOrder, now, now);
      for (const macroCue of cues) {
        const cue = this.getCue(macroCue.cueId);
        insertMacroCue.run(
          createId(),
          macroId,
          cue.id,
          cue.kind,
          macroCue.orderIndex,
          JSON.stringify(cue.payload),
          cue.failurePolicy,
          normalizeDelayMs(macroCue.delayBeforeMs),
          normalizeDelayMs(macroCue.delayAfterMs),
          now,
          now,
        );
      }
    });
    tx();

    return this.buildPatch({ upsertMacroIds: [macroId] });
  }

  updateMacro(input: MacroUpdateInput): SnapshotPatch {
    const existing = this.db.prepare(
      'SELECT id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count FROM actions WHERE id = ?'
    ).get(input.id) as {
      id: string;
      name: string;
      description: string;
      scope_level: string;
      on_scope_exit: string;
      loop_enabled: number;
      loop_count: number | null;
    } | undefined;
    if (!existing) throw new Error(`Macro not found: ${input.id}`);

    const updateMacro = this.db.prepare(
      `UPDATE actions
       SET name = ?, description = ?, scope_level = ?, on_scope_exit = ?, loop_enabled = ?, loop_count = ?, updated_at = ?
       WHERE id = ?`
    );
    const deleteMacroCues = this.db.prepare('DELETE FROM action_steps WHERE action_id = ?');
    const insertMacroCue = this.db.prepare(
      `INSERT INTO action_steps
       (id, action_id, cue_id, kind, order_index, payload_json, failure_policy, delay_before_ms, delay_after_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = nowIso();

    const tx = this.db.transaction(() => {
      updateMacro.run(
        input.name?.trim() || existing.name,
        input.description?.trim() ?? existing.description,
        input.scopeLevel ?? existing.scope_level,
        input.onScopeExit ?? existing.on_scope_exit,
        input.loopEnabled !== undefined ? (input.loopEnabled ? 1 : 0) : existing.loop_enabled,
        input.loopCount !== undefined ? normalizeLoopCount(input.loopCount) : existing.loop_count,
        now,
        input.id,
      );

      if (input.cues !== undefined) {
        deleteMacroCues.run(input.id);
        for (const macroCue of input.cues) {
          const cue = this.getCue(macroCue.cueId);
          insertMacroCue.run(
            macroCue.id ?? createId(),
            input.id,
            cue.id,
            cue.kind,
            macroCue.orderIndex,
            JSON.stringify(cue.payload),
            cue.failurePolicy,
            normalizeDelayMs(macroCue.delayBeforeMs),
            normalizeDelayMs(macroCue.delayAfterMs),
            now,
            now,
          );
        }
      }
    });
    tx();

    return this.buildPatch({ upsertMacroIds: [input.id] });
  }

  deleteMacro(id: Id): SnapshotPatch {
    const exists = this.db.prepare('SELECT id FROM actions WHERE id = ?').get(id);
    if (!exists) throw new Error(`Macro not found: ${id}`);
    const orphanedBindingIds = (this.db.prepare(
      "SELECT id FROM trigger_bindings WHERE target_type = 'macro' AND target_id = ?"
    ).all(id) as Array<{ id: string }>).map((row) => row.id);

    this.db.prepare('DELETE FROM actions WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM action_steps WHERE action_id = ?').run(id);
    this.db.prepare("DELETE FROM trigger_bindings WHERE target_type = 'macro' AND target_id = ?").run(id);
    const upsertMacroIds = this.normalizeOrderIndex('actions');
    return this.buildPatch({
      deletedMacroIds: [id],
      upsertMacroIds,
      deletedTriggerBindingIds: orphanedBindingIds,
    });
  }

  /** Absolute-position reorder of the macro list (v28 `order_index`). */
  setMacroOrder(macroId: Id, newOrder: number): SnapshotPatch {
    const upsertMacroIds = this.setFlatTableOrder('actions', macroId, newOrder, 'Macro');
    return this.buildPatch({ upsertMacroIds });
  }

  listTriggerBindings(): TriggerBinding[] {
    const rows = this.db.prepare(
      `SELECT id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at
       FROM trigger_bindings
       ORDER BY created_at ASC, id ASC`
    ).all() as Array<{
      id: string;
      trigger_type: string;
      source_id: string | null;
      target_type: string | null;
      target_id: string | null;
      config_json: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      triggerType: row.trigger_type as TriggerType,
      sourceId: row.source_id,
      targetType: (row.target_type ?? 'macro') as TriggerBindingTargetType,
      targetId: row.target_id ?? '',
      config: parseJson<Record<string, unknown>>(row.config_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  createTriggerBinding(input: TriggerBindingCreateInput): SnapshotPatch {
    const now = nowIso();
    const id = createId();
    this.db.prepare(
      `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.triggerType,
      input.sourceId,
      input.targetType,
      input.targetId,
      JSON.stringify(input.config ?? {}),
      input.enabled === false ? 0 : 1,
      now,
      now,
    );

    return this.buildPatch({ upsertTriggerBindingIds: [id] });
  }

  deleteTriggerBinding(id: Id): SnapshotPatch {
    this.db.prepare('DELETE FROM trigger_bindings WHERE id = ?').run(id);
    return this.buildPatch({ deletedTriggerBindingIds: [id] });
  }

  /**
   * Wipe every data table and re-insert the rows described by `snapshot`.
   * Used by global undo/redo: the renderer holds the pre-mutation snapshot
   * and asks the repo to swap the on-disk state to match. Wrapped in a
   * single transaction so a partial failure rolls back to the prior state.
   * Tables are deleted child-before-parent and re-inserted parent-before-
   * child — the same discipline `clearProjectBackupTables`/
   * `insertProjectBackupRows` use for the project-backup restore path.
   */
  restoreFromSnapshot(snapshot: AppSnapshot): AppSnapshot {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM trigger_bindings;
        DELETE FROM action_steps;
        DELETE FROM actions;
        DELETE FROM cues;
        DELETE FROM playlist_entries;
        DELETE FROM playlists;
        DELETE FROM talk_script_blocks;
        DELETE FROM slide_elements;
        DELETE FROM slides;
        DELETE FROM overlays;
        DELETE FROM stages;
        DELETE FROM presentations;
        DELETE FROM lyrics;
        DELETE FROM talks;
        DELETE FROM presentation_themes;
        DELETE FROM lyric_themes;
        DELETE FROM talk_themes;
        DELETE FROM overlay_themes;
        DELETE FROM image_assets;
        DELETE FROM video_assets;
        DELETE FROM audio_assets;
      `);

      const insertThemeRow = (table: ThemeTableName, themes: readonly PresentationTheme[]): void => {
        const insert = this.db.prepare(`INSERT INTO ${table} (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const containerKind = THEME_CONTAINER_KIND_BY_TABLE[table];
        for (const theme of themes) {
          const themeSlideId = theme.slideId ?? `${theme.id}:slide`;
          insert.run(theme.id, theme.name, theme.width, theme.height, theme.order, theme.createdAt, theme.updatedAt);
          this.createContainerSlide(themeSlideId, containerKind, theme.id, theme.width, theme.height, theme.createdAt);
          this.replaceContainerElements(themeSlideId, theme.elements, theme.updatedAt);
        }
      };
      insertThemeRow('presentation_themes', snapshot.presentationThemes);
      insertThemeRow('lyric_themes', snapshot.lyricThemes);
      insertThemeRow('talk_themes', snapshot.talkThemes);
      insertThemeRow('overlay_themes', snapshot.overlayThemes);

      const insertPresentation = this.db.prepare(
        'INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const presentation of snapshot.presentations) {
        insertPresentation.run(presentation.id, presentation.title, presentation.themeId ?? null, presentation.order, presentation.createdAt, presentation.updatedAt);
      }

      const insertLyric = this.db.prepare(
        'INSERT INTO lyrics (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const lyric of snapshot.lyrics) {
        insertLyric.run(lyric.id, lyric.title, lyric.themeId ?? null, lyric.order, lyric.createdAt, lyric.updatedAt);
      }

      const insertTalk = this.db.prepare(
        'INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const talk of snapshot.talks) {
        insertTalk.run(talk.id, talk.title, talk.themeId ?? null, talk.order, talk.createdAt, talk.updatedAt);
      }

      const insertSlide = this.db.prepare(
        `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const slide of snapshot.slides) {
        const backgroundJson = slide.background ? JSON.stringify(slide.background) : null;
        insertSlide.run(
          slide.id,
          slide.presentationId,
          slide.lyricId,
          slide.talkId,
          slide.kind,
          slide.width,
          slide.height,
          slide.notes,
          backgroundJson,
          slide.backgroundSource ?? 'local',
          slide.order,
          slide.createdAt,
          slide.updatedAt,
        );
      }

      const insertTalkScriptBlock = this.db.prepare(
        `INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const block of snapshot.talkScriptBlocks) {
        insertTalkScriptBlock.run(block.id, block.slideId, block.text, block.order, block.createdAt, block.updatedAt);
      }

      const insertSlideElement = this.db.prepare(
        `INSERT INTO slide_elements
          (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      // `snapshot.slideElements` (from `getSlideElements()`) is scoped to
      // item content slides, matching `snapshot.slides` exactly. Theme/
      // overlay/stage container elements are restored separately above/below
      // via `replaceContainerElements`, reusing the same element ids.
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
          element.sourceThemeElementId ?? null,
          element.createdAt,
          element.updatedAt,
        );
      }

      const insertPlaylist = this.db.prepare(
        'INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      for (const playlist of snapshot.playlists) {
        insertPlaylist.run(playlist.id, playlist.name, playlist.order, playlist.createdAt, playlist.updatedAt);
      }

      const insertEntry = this.db.prepare(
        `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of snapshot.playlistEntries) {
        if (row.kind === 'separator') {
          insertEntry.run(row.id, row.playlistId, 'separator', null, null, null, row.label, row.colorKey, row.order, row.createdAt, row.updatedAt);
        } else {
          const owner = toPlaylistItemOwnerColumns(row.reference);
          insertEntry.run(row.id, row.playlistId, 'item', owner.presentationId, owner.lyricId, owner.talkId, null, null, row.order, row.createdAt, row.updatedAt);
        }
      }

      const insertImageAsset = this.db.prepare(
        'INSERT INTO image_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertVideoAsset = this.db.prepare(
        'INSERT INTO video_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertAudioAsset = this.db.prepare(
        'INSERT INTO audio_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const asset of snapshot.mediaAssets) {
        const stmt = asset.type === 'image' ? insertImageAsset : asset.type === 'video' ? insertVideoAsset : insertAudioAsset;
        stmt.run(asset.id, asset.name, asset.src, asset.order, asset.createdAt, asset.updatedAt);
      }

      const insertOverlay = this.db.prepare(
        `INSERT INTO overlays (id, name, enabled, animation_json, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      snapshot.overlays.forEach((overlay, overlayIndex) => {
        const overlaySlideId = overlay.slideId ?? `${overlay.id}:slide`;
        // An undo/redo restore round-trips whatever `order` the snapshot
        // carried; a legacy snapshot without one falls back to array position
        // so the list keeps the order the caller was showing.
        insertOverlay.run(overlay.id, overlay.name, overlay.enabled ? 1 : 0, JSON.stringify(overlay.animation), overlay.order ?? overlayIndex, overlay.createdAt, overlay.updatedAt);
        this.createContainerSlide(overlaySlideId, 'overlay', overlay.id, DEFAULT_W, DEFAULT_H, overlay.createdAt);
        this.replaceContainerElements(overlaySlideId, overlay.elements, overlay.updatedAt);
      });

      const insertStage = this.db.prepare(
        `INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const stage of snapshot.stages) {
        const stageSlideId = stage.slideId ?? `${stage.id}:slide`;
        insertStage.run(stage.id, stage.name, stage.width, stage.height, stage.order, stage.createdAt, stage.updatedAt);
        this.createContainerSlide(stageSlideId, 'stage', stage.id, stage.width, stage.height, stage.createdAt);
        this.replaceContainerElements(stageSlideId, stage.elements, stage.updatedAt);
      }

      const insertCue = this.db.prepare(
        `INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const cue of snapshot.cues) {
        insertCue.run(cue.id, cue.kind, JSON.stringify(cue.payload), cue.failurePolicy, cue.createdAt, cue.updatedAt);
      }

      const insertMacro = this.db.prepare(
        `INSERT INTO actions (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertMacroStep = this.db.prepare(
        `INSERT INTO action_steps
         (id, action_id, cue_id, kind, order_index, payload_json, failure_policy, delay_before_ms, delay_after_ms, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      snapshot.macros.forEach((macro, macroIndex) => {
        insertMacro.run(
          macro.id,
          macro.name,
          macro.description,
          macro.scopeLevel,
          macro.onScopeExit,
          macro.loopEnabled ? 1 : 0,
          macro.loopCount,
          macro.order ?? macroIndex,
          macro.createdAt,
          macro.updatedAt,
        );
        for (const step of macro.cues) {
          insertMacroStep.run(
            step.id,
            macro.id,
            step.cueId,
            step.cue.kind,
            step.orderIndex,
            JSON.stringify(step.cue.payload),
            step.cue.failurePolicy,
            normalizeDelayMs(step.delayBeforeMs),
            normalizeDelayMs(step.delayAfterMs),
            step.createdAt,
            step.updatedAt,
          );
        }
      });

      const insertTriggerBinding = this.db.prepare(
        `INSERT INTO trigger_bindings
         (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const binding of snapshot.triggerBindings) {
        insertTriggerBinding.run(
          binding.id,
          binding.triggerType,
          binding.sourceId,
          binding.targetType,
          binding.targetId,
          JSON.stringify(binding.config),
          binding.enabled ? 1 : 0,
          binding.createdAt,
          binding.updatedAt,
        );
      }
    });
    tx();
    this.patchVersion += 1;
    return this.getSnapshot();
  }

  exportBundle(itemIds: Id[], options: BundleExportOptions = {}): BundleManifest {
    const playlistIds = Array.from(new Set(options.playlistIds ?? []));
    const playlists = playlistIds
      .map((playlistId) => this.getBundlePlaylistById(playlistId))
      .filter((playlist): playlist is BundlePlaylist => playlist !== null)
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

    const playlistItemIds = collectBundlePlaylistItemIds(playlists);

    const uniqueIds = Array.from(new Set([...itemIds, ...playlistItemIds]));
    const items = uniqueIds
      .map((itemId) => this.getBundleItemById(itemId))
      .filter((item): item is BundleItem => item !== null)
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));

    const includedItemIds = new Set(items.map((item) => item.id));
    const filteredPlaylists: BundlePlaylist[] = filterBundlePlaylistsToIncludedItems(playlists, includedItemIds);

    let themes: BundleTheme[];
    if (options.includeAllThemes) {
      themes = [
        ...this.getThemeRows('presentation_themes').map((theme) => toBundleTheme(theme, 'presentation')),
        ...this.getThemeRows('lyric_themes').map((theme) => toBundleTheme(theme, 'lyric')),
        ...this.getThemeRows('talk_themes').map((theme) => toBundleTheme(theme, 'talk')),
        ...this.getThemeRows('overlay_themes').map((theme) => toBundleTheme(theme, 'overlay')),
      ];
    } else {
      const themeRefs = new Map<Id, ThemeOwnerType>();
      for (const item of items) {
        if (item.themeId) themeRefs.set(item.themeId, item.type);
      }
      themes = Array.from(themeRefs.entries())
        .map(([themeId, themeType]) => this.getBundleThemeById(themeId, themeType))
        .filter((theme): theme is BundleTheme => theme !== null)
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
    }

    const overlays = options.includeOverlays
      ? this.getOverlays().map(toBundleOverlay)
      : [];

    const stages = options.includeStages
      ? this.getStages().map(toBundleStage)
      : [];

    return {
      format: 'cast-deck-bundle',
      version: 2,
      exportedAt: nowIso(),
      items,
      themes,
      overlays,
      stages,
      playlists: filteredPlaylists,
      mediaReferences: collectBundleMediaReferences(items, themes, overlays, stages),
    };
  }

  inspectImportBundle(manifest: BundleManifest): BundleInspection {
    const validatedManifest = this.assertValidBundleManifest(manifest, 'inspectImportBundle');
    const normalizedManifest = cloneBundleManifest(validatedManifest);
    const overlays = normalizedManifest.overlays ?? [];
    const stages = normalizedManifest.stages ?? [];
    const playlists = normalizedManifest.playlists ?? [];
    const mediaReferences = collectBundleMediaReferences(
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
      playlistCount: playlists.length,
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
        .map((theme): BundleInspectionTheme => ({
          id: theme.id,
          name: theme.name,
          themeType: theme.themeType,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      overlays: overlays
        .map((overlay): BundleInspectionOverlay => ({ id: overlay.id, name: overlay.name, type: overlay.type }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      stages: stages
        .map((stage): BundleInspectionStage => ({ id: stage.id, name: stage.name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      playlists: playlists
        .map((playlist): BundleInspectionPlaylist => ({
          id: playlist.id,
          name: playlist.name,
          separatorCount: playlist.rows.filter((row) => row.kind === 'separator').length,
          entryCount: playlist.rows.filter((row) => row.kind === 'item').length,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      mediaReferences,
      brokenReferences,
    };
  }

  finalizeImportBundle(manifest: BundleManifest, decisions: BundleBrokenReferenceDecision[]): AppSnapshot {
    const validatedManifest = this.assertValidBundleManifest(manifest, 'finalizeImportBundle');
    const workingManifest = cloneBundleManifest(validatedManifest);
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
    const normalizedReplacementSources = this.collectReplacementMediaSources(brokenReferences, decisionMap);
    const nextMediaAssetOrder = this.getNextMediaAssetOrderIndex();

    const insertPresentationTheme = this.db.prepare('INSERT INTO presentation_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertLyricTheme = this.db.prepare('INSERT INTO lyric_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertTalkTheme = this.db.prepare('INSERT INTO talk_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertOverlayTheme = this.db.prepare('INSERT INTO overlay_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertThemeStmtByType: Record<ThemeOwnerType, ReturnType<SqliteDatabase['prepare']>> = {
      presentation: insertPresentationTheme,
      lyric: insertLyricTheme,
      talk: insertTalkTheme,
      overlay: insertOverlayTheme,
    };
    const insertPresentation = this.db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertLyric = this.db.prepare('INSERT INTO lyrics (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertTalk = this.db.prepare('INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertSlide = this.db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertTalkScriptBlock = this.db.prepare('INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertImageAsset = this.db.prepare('INSERT INTO image_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertVideoAsset = this.db.prepare('INSERT INTO video_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertAudioAsset = this.db.prepare('INSERT INTO audio_assets (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const insertMediaAsset = (id: Id, name: string, type: MediaAssetType, src: string, order: number, createdAt: string, updatedAt: string): void => {
      const stmt = type === 'image' ? insertImageAsset : type === 'video' ? insertVideoAsset : insertAudioAsset;
      stmt.run(id, name, src, order, createdAt, updatedAt);
    };
    const insertOverlay = this.db.prepare('INSERT INTO overlays (id, name, enabled, animation_json, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertStage = this.db.prepare('INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const insertPlaylist = this.db.prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertPlaylistEntry = this.db.prepare(
      `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const nextStageOrder = (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM stages').get() as { next_order: number }).next_order;
    let nextOverlayOrder = this.getNextOrderIndex('overlays');
    const nextPlaylistOrderBase = (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM playlists').get() as { next_order: number }).next_order;
    const nextOrderByItemType: Record<ItemType, number> = {
      presentation: (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM presentations').get() as { next_order: number }).next_order,
      lyric: (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM lyrics').get() as { next_order: number }).next_order,
      talk: (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM talks').get() as { next_order: number }).next_order,
    };
    const nextOrderByThemeType: Record<ThemeOwnerType, number> = {
      presentation: this.getNextThemeOrderIndex('presentation_themes'),
      lyric: this.getNextThemeOrderIndex('lyric_themes'),
      talk: this.getNextThemeOrderIndex('talk_themes'),
      overlay: this.getNextThemeOrderIndex('overlay_themes'),
    };

    const tx = this.db.transaction(() => {
      const themeIdMap = new Map<Id, Id>();
      const itemIdMap = new Map<Id, Id>();
      const replacementAssetKeys = new Set<string>();
      // Maps each original (pre-import) theme element id to the newly
      // materialized theme element id, plus the original theme id it
      // belongs to. Item elements translate their `sourceThemeElementId`
      // through this map at insert time.
      const themeElementIdMap = new Map<Id, { newId: Id; originalThemeId: Id }>();

      workingManifest.themes
        .slice()
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
        .forEach((theme) => {
          const newThemeId = createId();
          const newThemeSlideId = `${newThemeId}:slide`;
          themeIdMap.set(theme.id, newThemeId);
          const nextElements = theme.elements.map((element, elementIndex) => {
            const importedElement = this.createImportedThemeElement(element, newThemeSlideId, now, elementIndex);
            if (element.id) {
              themeElementIdMap.set(element.id, { newId: importedElement.id, originalThemeId: theme.id });
            }
            return importedElement;
          });
          const order = nextOrderByThemeType[theme.themeType]++;
          insertThemeStmtByType[theme.themeType].run(newThemeId, theme.name, theme.width, theme.height, order, now, now);
          this.createContainerSlide(newThemeSlideId, themeContainerKind(theme.themeType), newThemeId, theme.width, theme.height, now);
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
          nextMediaAssetOrder + replacementIndex,
          now,
          now,
        );
      });

      workingManifest.items
        .slice()
        .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title))
        .forEach((item) => {
          const newItemId = createId();
          itemIdMap.set(item.id, newItemId);
          const importedThemeId = item.themeId ? themeIdMap.get(item.themeId) ?? null : null;
          if (item.themeId && !importedThemeId) {
            throw new Error(`Missing imported theme for ${item.title}`);
          }
          const order = nextOrderByItemType[item.type]++;

          if (item.type === 'presentation') {
            insertPresentation.run(newItemId, item.title, importedThemeId, order, now, now);
          } else if (item.type === 'talk') {
            insertTalk.run(newItemId, item.title, importedThemeId, order, now, now);
          } else {
            insertLyric.run(newItemId, item.title, importedThemeId, order, now, now);
          }

          item.slides
            .slice()
            .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
            .forEach((slide, slideIndex) => {
              const newSlideId = createId();
              const backgroundJson = slide.background ? JSON.stringify(slide.background) : null;
              const backgroundSource = slide.backgroundSource ?? 'local';
              insertSlide.run(
                newSlideId,
                item.type === 'presentation' ? newItemId : null,
                item.type === 'lyric' ? newItemId : null,
                item.type === 'talk' ? newItemId : null,
                item.type,
                slide.width,
                slide.height,
                slide.notes,
                backgroundJson,
                backgroundSource,
                slideIndex,
                now,
                now,
              );

              slide.elements.forEach((element, elementIndex) => {
                const nextElement = this.createImportedSlideElement(element, newSlideId, now, elementIndex);
                const mappedProvenance = element.sourceThemeElementId
                  ? themeElementIdMap.get(element.sourceThemeElementId)
                  : undefined;
                const resolvedSourceThemeElementId = mappedProvenance && item.themeId && mappedProvenance.originalThemeId === item.themeId
                  ? mappedProvenance.newId
                  : null;
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
                  resolvedSourceThemeElementId,
                  now,
                  now,
                );
              });
              for (const block of slide.scriptBlocks ?? []) {
                insertTalkScriptBlock.run(createId(), newSlideId, block.text, block.order, now, now);
              }
            });
        });

      (workingManifest.overlays ?? []).forEach((overlay) => {
        const newOverlayId = createId();
        const newOverlaySlideId = `${newOverlayId}:slide`;
        insertOverlay.run(newOverlayId, overlay.name, overlay.enabled ? 1 : 0, JSON.stringify(normalizeOverlayAnimation(overlay.animation)), nextOverlayOrder++, now, now);
        this.createContainerSlide(newOverlaySlideId, 'overlay', newOverlayId, DEFAULT_W, DEFAULT_H, now);
        // Regenerate element ids exactly like the theme/item import paths
        // above: the manifest's elements still carry the exporting
        // database's original ids, which collide (PRIMARY KEY) with the
        // still-live source overlay's own slide_elements rows whenever the
        // source item wasn't deleted (e.g. importing a bundle back into the
        // project it was exported from). No theme-element provenance concept
        // exists for overlays (there is no persisted overlays.theme_id and
        // no syncThemeToLinkedItems for this owner type), so provenance is
        // cleared rather than carried over unverified.
        const importedOverlayElements = overlay.elements.map((element, elementIndex) => ({
          ...this.createImportedSlideElement(element, newOverlaySlideId, now, elementIndex),
          sourceThemeElementId: null,
        }));
        this.replaceContainerElements(newOverlaySlideId, importedOverlayElements, now);
      });

      (workingManifest.stages ?? []).forEach((stage, stageIndex) => {
        const newStageId = createId();
        const newStageSlideId = `${newStageId}:slide`;
        insertStage.run(newStageId, stage.name, stage.width, stage.height, nextStageOrder + stageIndex, now, now);
        this.createContainerSlide(newStageSlideId, 'stage', newStageId, stage.width, stage.height, now);
        // Same fix as overlays above: regenerate element ids so they can't
        // collide with the source stage's own still-live slide_elements rows.
        const importedStageElements = stage.elements.map((element, elementIndex) => ({
          ...this.createImportedSlideElement(element, newStageSlideId, now, elementIndex),
          sourceThemeElementId: null,
        }));
        this.replaceContainerElements(newStageSlideId, importedStageElements, now);
      });

      const importedPlaylists = workingManifest.playlists ?? [];
      importedPlaylists
        .slice()
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
        .forEach((playlist, playlistIndex) => {
          const newPlaylistId = createId();
          insertPlaylist.run(newPlaylistId, playlist.name, nextPlaylistOrderBase + playlistIndex, now, now);

          playlist.rows
            .slice()
            .sort((left, right) => left.order - right.order)
            .forEach((row, rowIndex) => {
              if (row.kind === 'separator') {
                insertPlaylistEntry.run(createId(), newPlaylistId, 'separator', null, null, null, row.label, row.colorKey, rowIndex, now, now);
                return;
              }
              const sourceReference = getBundlePlaylistEntryReference(row);
              const importedItemId = itemIdMap.get(sourceReference.itemId);
              if (!importedItemId) return;
              const owner = toPlaylistItemOwnerColumns(makePlaylistItemReference(sourceReference.type, importedItemId));
              insertPlaylistEntry.run(createId(), newPlaylistId, 'item', owner.presentationId, owner.lyricId, owner.talkId, null, null, rowIndex, now, now);
            });
        });
    });

    tx();
    return this.getSnapshot();
  }

  createPlaylist(name: string): SnapshotPatch {
    const now = nowIso();
    const id = createId();
    const currentOrder = (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlists').get() as { maxOrder: number | null }).maxOrder ?? -1;
    this.db
      .prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, currentOrder + 1, now, now);
    return this.buildPatch({ upsertPlaylistIds: [id] });
  }

  createSeparator(playlistId: Id, label: string): SnapshotPatch {
    const exists = this.db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
    if (!exists) throw new Error(`Playlist not found: ${playlistId}`);
    const now = nowIso();
    const id = createId();
    const currentOrder = (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE playlist_id = ?').get(playlistId) as { maxOrder: number | null }).maxOrder ?? -1;
    this.db
      .prepare(
        `INSERT INTO playlist_entries (id, playlist_id, kind, label, color_key, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, playlistId, 'separator', label, null, currentOrder + 1, now, now);
    return this.buildPatch({ upsertPlaylistEntryIds: [id] });
  }

  renameSeparator(id: Id, label: string): SnapshotPatch {
    const result = this.db
      .prepare("UPDATE playlist_entries SET label = ?, updated_at = ? WHERE id = ? AND kind = 'separator'")
      .run(label, nowIso(), id);
    if (result.changes === 0) throw new Error(`Separator not found: ${id}`);
    return this.buildPatch({ upsertPlaylistEntryIds: [id] });
  }

  setSeparatorColor(id: Id, colorKey: string | null): SnapshotPatch {
    const result = this.db
      .prepare("UPDATE playlist_entries SET color_key = ?, updated_at = ? WHERE id = ? AND kind = 'separator'")
      .run(colorKey, nowIso(), id);
    if (result.changes === 0) throw new Error(`Separator not found: ${id}`);
    return this.buildPatch({ upsertPlaylistEntryIds: [id] });
  }

  /** Absolute-position reorder within a playlist's flat row list — works on an item entry or a separator alike. */
  movePlaylistRow(rowId: Id, newOrder: number): SnapshotPatch {
    const current = this.db.prepare('SELECT id, playlist_id FROM playlist_entries WHERE id = ?').get(rowId) as { id: string; playlist_id: string } | undefined;
    if (!current) throw new Error(`Playlist row not found: ${rowId}`);

    const siblings = this.db
      .prepare('SELECT id FROM playlist_entries WHERE playlist_id = ? ORDER BY order_index ASC')
      .all(current.playlist_id) as Array<{ id: string }>;
    const currentIndex = siblings.findIndex((sibling) => sibling.id === rowId);
    if (currentIndex === -1) return this.buildPatch({});

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, index) => index !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const now = nowIso();
    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db.prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?').run(index, now, sibling.id);
      });
    });
    tx();

    return this.buildPatch({ upsertPlaylistEntryIds: reordered.map((sibling) => sibling.id) });
  }

  /** Detaches any row (item entry or separator) from its playlist. Never deletes the underlying Presentation/Lyric/Talk. */
  removePlaylistRow(rowId: Id): SnapshotPatch {
    const row = this.db.prepare('SELECT id, playlist_id FROM playlist_entries WHERE id = ?').get(rowId) as { id: string; playlist_id: string } | undefined;
    if (!row) return this.buildPatch({});
    this.db.prepare('DELETE FROM playlist_entries WHERE id = ?').run(rowId);
    const changedIds = this.normalizePlaylistRowOrder(row.playlist_id);
    return this.buildPatch({ deletedPlaylistEntryIds: [rowId], upsertPlaylistEntryIds: changedIds });
  }

  /** Attaches an EXISTING item to a playlist as a new row. Appends when `position` is omitted. */
  addItemToPlaylist(playlistId: Id, itemRef: ItemRef, position?: number): SnapshotPatch {
    const playlistExists = this.db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
    if (!playlistExists) throw new Error(`Playlist not found: ${playlistId}`);
    const owner = this.resolveItemOwnerRow(itemRef.id);
    if (!owner || owner.type !== itemRef.type) throw new Error(`Item not found: ${itemRef.type} ${itemRef.id}`);

    this.insertPlaylistItemRow(playlistId, itemRef, position);
    return this.buildPatch({ upsertPlaylistEntryIds: this.getPlaylistRows(playlistId).map((row) => row.id) });
  }

  createPresentation(title: string): SnapshotPatch {
    const now = nowIso();
    const id = createId();
    const currentOrder = (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM presentations').get() as { maxOrder: number | null }).maxOrder ?? -1;
    this.db
      .prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, title, null, currentOrder + 1, now, now);
    return this.buildPatch({ upsertPresentationIds: [id] });
  }

  createLyric(title: string): SnapshotPatch {
    const now = nowIso();
    const id = createId();
    const currentOrder = (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM lyrics').get() as { maxOrder: number | null }).maxOrder ?? -1;
    this.db
      .prepare('INSERT INTO lyrics (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, title, null, currentOrder + 1, now, now);
    return this.buildPatch({ upsertLyricIds: [id] });
  }

  createTalk(title: string): SnapshotPatch {
    const now = nowIso();
    const id = createId();
    const currentOrder = (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM talks').get() as { maxOrder: number | null }).maxOrder ?? -1;
    this.db
      .prepare('INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, title, null, currentOrder + 1, now, now);
    return this.buildPatch({ upsertTalkIds: [id] });
  }

  createTheme(input: ThemeCreateInput): SnapshotPatch {
    const table = THEME_TABLE_BY_TYPE[input.themeType];
    const now = nowIso();
    const themeId = createId();
    const slideId = `${themeId}:slide`;
    const currentOrder = (this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM ${table}`).get() as { maxOrder: number | null }).maxOrder ?? -1;
    const sourceElements = input.elements
      ? JSON.parse(JSON.stringify(input.elements)) as SlideElement[]
      : createDefaultThemeElements(input.themeType, slideId, now);
    // New container — regenerate element IDs so cloned input can't collide
    // with the source theme's existing slide_elements rows.
    const elements = this.normalizeContainerElementOwnership(sourceElements, slideId)
      .map((el) => ({ ...el, id: createId() }));
    const width = input.width ?? DEFAULT_W;
    const height = input.height ?? DEFAULT_H;
    const backgroundJson = input.background ? JSON.stringify(input.background) : null;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO ${table} (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(themeId, input.name, width, height, currentOrder + 1, now, now);
      this.createContainerSlide(slideId, themeContainerKind(input.themeType), themeId, width, height, now);
      if (backgroundJson !== null) {
        this.db.prepare('UPDATE slides SET background_json = ?, updated_at = ? WHERE id = ?').run(backgroundJson, now, slideId);
      }
      this.replaceContainerElements(slideId, elements, now);
    });
    tx();
    return this.buildPatch(this.themeUpsertSpec(input.themeType, [themeId]));
  }

  updateTheme(input: ThemeUpdateInput): SnapshotPatch {
    const table = THEME_TABLE_BY_TYPE[input.themeType];
    const existing = this.db
      .prepare(`SELECT id, name, width, height FROM ${table} WHERE id = ?`)
      .get(input.id) as { id: string; name: string; width: number; height: number } | undefined;
    if (!existing) throw new Error(`Theme not found: ${input.id}`);

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
      if (input.background !== undefined) {
        const backgroundJson = input.background ? JSON.stringify(input.background) : null;
        this.db.prepare('UPDATE slides SET background_json = ?, updated_at = ? WHERE id = ?').run(backgroundJson, now, slideId);
      }
      this.db
        .prepare(`UPDATE ${table} SET name = ?, width = ?, height = ?, updated_at = ? WHERE id = ?`)
        .run(input.name ?? existing.name, width, height, now, input.id);
    });
    tx();
    return this.buildPatch(this.themeUpsertSpec(input.themeType, [input.id]));
  }

  deleteTheme(themeId: Id, themeType: ThemeOwnerType): SnapshotPatch {
    const table = THEME_TABLE_BY_TYPE[themeType];
    const exists = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(themeId);
    if (!exists) throw new Error(`Theme not found: ${themeId}`);
    const ownerSlideId = `${themeId}:slide`;

    let affectedItemIds: Id[] = [];
    const tx = this.db.transaction(() => {
      if (themeType === 'presentation' || themeType === 'lyric' || themeType === 'talk') {
        const itemTable = ITEM_TABLE_BY_TYPE[themeType];
        affectedItemIds = (this.db.prepare(`SELECT id FROM ${itemTable} WHERE theme_id = ?`).all(themeId) as Array<{ id: string }>).map((row) => row.id);
        this.db.prepare(`UPDATE ${itemTable} SET theme_id = NULL, updated_at = ? WHERE theme_id = ?`).run(nowIso(), themeId);
      }
      this.deleteContainerSlide(ownerSlideId);
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(themeId);
    });
    tx();
    this.normalizeThemeOrder(table);
    const remainingThemeIds = (this.db.prepare(`SELECT id FROM ${table} ORDER BY order_index ASC`).all() as Array<{ id: string }>).map((row) => row.id);

    const patchSpec: BuildPatchSpec = {
      ...this.themeUpsertSpec(themeType, remainingThemeIds),
      ...this.themeDeleteSpec(themeType, [themeId]),
    };
    if (themeType === 'presentation') patchSpec.upsertPresentationIds = affectedItemIds;
    else if (themeType === 'lyric') patchSpec.upsertLyricIds = affectedItemIds;
    else if (themeType === 'talk') patchSpec.upsertTalkIds = affectedItemIds;
    return this.buildPatch(patchSpec);
  }

  applyThemeToItem(themeId: Id, itemRef: ItemRef): SnapshotPatch {
    const theme = this.getThemeRowById(THEME_TABLE_BY_TYPE[itemRef.type], themeId);
    if (!theme) throw new Error(`Theme not found: ${themeId}`);
    const itemTable = ITEM_TABLE_BY_TYPE[itemRef.type];
    const ownerColumn = ITEM_OWNER_COLUMN_BY_TYPE[itemRef.type];
    const exists = this.db.prepare(`SELECT id FROM ${itemTable} WHERE id = ?`).get(itemRef.id);
    if (!exists) throw new Error(`Item not found: ${itemRef.id}`);

    const slides = this.db
      .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(itemRef.id) as Array<{ id: string }>;
    const selectElements = this.db.prepare(
      `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
       FROM slide_elements
       WHERE slide_id = ?
       ORDER BY layer ASC, z_index ASC, created_at ASC`
    );
    const deleteElements = this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?');
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const setSlideBackground = this.db.prepare('UPDATE slides SET background_json = ?, background_source = ?, updated_at = ? WHERE id = ?');
    const themeBackgroundJson = theme.background ? JSON.stringify(theme.background) : null;

    const deletedElementIds: Id[] = [];
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE ${itemTable} SET theme_id = ?, updated_at = ? WHERE id = ?`).run(themeId, now, itemRef.id);
      for (const slide of slides) {
        setSlideBackground.run(themeBackgroundJson, 'theme', now, slide.id);
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
          source_theme_element_id: string | null;
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
          payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('applyThemeToItem', `slide_elements.${row.id}.payload_json`)),
          sourceThemeElementId: row.source_theme_element_id,
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
            element.sourceThemeElementId ?? null,
            element.createdAt,
            now,
          );
        }
      }
    });
    tx();

    return this.buildPatch({
      ...(itemRef.type === 'presentation' ? { upsertPresentationIds: [itemRef.id] } : itemRef.type === 'lyric' ? { upsertLyricIds: [itemRef.id] } : { upsertTalkIds: [itemRef.id] }),
      upsertSlideIds: slides.map((slide) => slide.id),
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds(slides.map((slide) => slide.id)),
      deletedSlideElementIds: deletedElementIds,
    });
  }

  syncThemeToLinkedItems(themeId: Id, itemType: ItemType): SnapshotPatch {
    const theme = this.getThemeRowById(THEME_TABLE_BY_TYPE[itemType], themeId);
    if (!theme) throw new Error(`Theme not found: ${themeId}`);
    const itemTable = ITEM_TABLE_BY_TYPE[itemType];
    const ownerColumn = ITEM_OWNER_COLUMN_BY_TYPE[itemType];
    const linkedItemIds = (this.db.prepare(`SELECT id FROM ${itemTable} WHERE theme_id = ?`).all(themeId) as Array<{ id: string }>).map((row) => row.id);
    if (linkedItemIds.length === 0) return this.buildPatch({});

    const selectElements = this.db.prepare(
      `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
       FROM slide_elements
       WHERE slide_id = ?
       ORDER BY layer ASC, z_index ASC, created_at ASC`
    );
    const deleteElements = this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?');
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const setSlideBackground = this.db.prepare('UPDATE slides SET background_json = ?, background_source = ?, updated_at = ? WHERE id = ?');
    const slideBackgroundSource = this.db.prepare('SELECT background_source FROM slides WHERE id = ?');
    const themeBackgroundJson = theme.background ? JSON.stringify(theme.background) : null;

    const touchedSlideIds: string[] = [];
    const deletedElementIds: Id[] = [];
    const now = nowIso();
    const tx = this.db.transaction(() => {
      for (const itemId of linkedItemIds) {
        const slides = this.db
          .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
          .all(itemId) as Array<{ id: string }>;
        for (const slide of slides) {
          // Sync is non-destructive: only theme-owned backgrounds are
          // refreshed; a local override survives.
          const sourceRow = slideBackgroundSource.get(slide.id) as { background_source: string | null } | undefined;
          if (!sourceRow || sourceRow.background_source !== 'local') {
            setSlideBackground.run(themeBackgroundJson, 'theme', now, slide.id);
          }
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
            source_theme_element_id: string | null;
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
            payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('syncThemeToLinkedItems', `slide_elements.${row.id}.payload_json`)),
            sourceThemeElementId: row.source_theme_element_id,
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
              element.sourceThemeElementId ?? null,
              element.createdAt,
              now,
            );
          }
          touchedSlideIds.push(slide.id);
        }
      }
    });
    tx();

    return this.buildPatch({
      ...(itemType === 'presentation' ? { upsertPresentationIds: linkedItemIds } : itemType === 'lyric' ? { upsertLyricIds: linkedItemIds } : { upsertTalkIds: linkedItemIds }),
      upsertSlideIds: touchedSlideIds,
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds(touchedSlideIds),
      deletedSlideElementIds: deletedElementIds,
    });
  }

  detachThemeFromItem(itemRef: ItemRef): SnapshotPatch {
    const itemTable = ITEM_TABLE_BY_TYPE[itemRef.type];
    const ownerColumn = ITEM_OWNER_COLUMN_BY_TYPE[itemRef.type];
    const existing = this.db.prepare(`SELECT theme_id FROM ${itemTable} WHERE id = ?`).get(itemRef.id) as { theme_id: string | null } | undefined;
    if (!existing) throw new Error(`Item not found: ${itemRef.id}`);
    // Item exists but already has no theme assigned — genuine no-op (#214).
    if (existing.theme_id === null) return this.buildPatch({});

    const now = nowIso();
    const slideRows = this.db.prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`).all(itemRef.id) as Array<{ id: string }>;
    const slideIds = slideRows.map((row) => row.id);
    const elementIds = this.getSlideElementIdsBySlideIds(slideIds);

    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE ${itemTable} SET theme_id = NULL, updated_at = ? WHERE id = ?`).run(now, itemRef.id);
      const setBackgroundLocal = this.db.prepare('UPDATE slides SET background_source = ?, updated_at = ? WHERE id = ?');
      const clearProvenance = this.db.prepare('UPDATE slide_elements SET source_theme_element_id = NULL WHERE slide_id = ?');
      for (const slideId of slideIds) {
        setBackgroundLocal.run('local', now, slideId);
        clearProvenance.run(slideId);
      }
    });
    tx();

    return this.buildPatch({
      ...(itemRef.type === 'presentation' ? { upsertPresentationIds: [itemRef.id] } : itemRef.type === 'lyric' ? { upsertLyricIds: [itemRef.id] } : { upsertTalkIds: [itemRef.id] }),
      upsertSlideIds: slideIds.length > 0 ? slideIds : undefined,
      upsertSlideElementIds: elementIds.length > 0 ? elementIds : undefined,
    });
  }

  applyThemeToOverlay(themeId: Id, overlayId: Id): SnapshotPatch {
    const theme = this.getThemeRowById('overlay_themes', themeId);
    if (!theme) throw new Error(`Theme not found: ${themeId}`);
    const exists = this.db.prepare('SELECT id FROM overlays WHERE id = ?').get(overlayId) as { id: string } | undefined;
    if (!exists) throw new Error(`Overlay not found: ${overlayId}`);

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

  createItem(input: ItemCreateInput): ItemCreateResult {
    const trimmedTitle = (input.title ?? '').trim() || 'Untitled';
    const now = nowIso();
    const itemId = createId();
    const slideId = createId();
    const table = ITEM_TABLE_BY_TYPE[input.type];

    let theme: PresentationTheme | null = null;
    if (input.themeId) {
      theme = this.getThemeRowById(THEME_TABLE_BY_TYPE[input.type], input.themeId);
      if (!theme) throw new Error(`Theme not found: ${input.themeId}`);
    }

    if (input.playlistId) {
      const playlistExists = this.db.prepare('SELECT id FROM playlists WHERE id = ?').get(input.playlistId);
      if (!playlistExists) throw new Error(`Playlist not found: ${input.playlistId}`);
    }

    const currentOrder = (this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM ${table}`).get() as { maxOrder: number | null }).maxOrder ?? -1;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO ${table} (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(itemId, trimmedTitle, input.themeId ?? null, currentOrder + 1, now, now);

      this.db
        .prepare(
          `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, ?, ?)`
        )
        .run(
          slideId,
          input.type === 'presentation' ? itemId : null,
          input.type === 'lyric' ? itemId : null,
          input.type === 'talk' ? itemId : null,
          input.type,
          theme?.width ?? DEFAULT_W,
          theme?.height ?? DEFAULT_H,
          theme?.background ? JSON.stringify(theme.background) : null,
          theme ? 'theme' : 'local',
          now,
          now,
        );

      const elements = theme
        ? applyThemeToElements(theme, [], slideId)
        : createDefaultThemeElements(input.type, slideId, now);

      for (const element of elements) {
        this.db
          .prepare(
            `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
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
            element.sourceThemeElementId ?? null,
            element.createdAt,
            now,
          );
      }
    });
    tx();

    // Deliberately a separate transaction from the item/slide/element insert
    // above: `insertPlaylistItemRow` opens its own transaction, and this
    // lightweight sqlite wrapper's BEGIN IMMEDIATE/COMMIT does not nest.
    if (input.playlistId) {
      this.insertPlaylistItemRow(input.playlistId, { type: input.type, id: itemId }, input.position);
    }

    const patchSpec: BuildPatchSpec = {
      upsertSlideIds: [slideId],
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds([slideId]),
    };
    if (input.type === 'presentation') patchSpec.upsertPresentationIds = [itemId];
    else if (input.type === 'lyric') patchSpec.upsertLyricIds = [itemId];
    else patchSpec.upsertTalkIds = [itemId];
    if (input.playlistId) {
      patchSpec.upsertPlaylistEntryIds = this.getPlaylistRows(input.playlistId).map((row) => row.id);
    }

    return { itemId, patch: this.buildPatch(patchSpec) };
  }

  duplicateItem(input: ItemDuplicateInput): ItemDuplicateResult {
    const table = ITEM_TABLE_BY_TYPE[input.type];
    const fkColumn = ITEM_OWNER_COLUMN_BY_TYPE[input.type];
    const now = nowIso();

    const source = this.db
      .prepare(`SELECT id, title, theme_id, order_index FROM ${table} WHERE id = ?`)
      .get(input.id) as { id: string; title: string; theme_id: string | null; order_index: number } | undefined;
    if (!source) throw new Error(`Item not found: ${input.id}`);

    let candidateTitle = `${source.title} Copy`;
    const existingTitles = new Set(
      (this.db.prepare(`SELECT title FROM ${table}`).all() as Array<{ title: string }>).map((row) => row.title.toLowerCase())
    );
    while (existingTitles.has(candidateTitle.toLowerCase())) {
      const match = candidateTitle.match(/^(.+?) Copy(?: (\d+))?$/);
      if (match) {
        const num = match[2] ? parseInt(match[2], 10) + 1 : 2;
        candidateTitle = `${match[1]} Copy ${num}`;
      } else {
        candidateTitle = `${candidateTitle} 2`;
      }
    }

    const sourceOrder = source.order_index;
    const sourceSlides = this.db
      .prepare(
        `SELECT id, kind, width, height, background_json, background_source, notes, order_index
         FROM slides
         WHERE ${fkColumn} = ?
         ORDER BY order_index ASC`
      )
      .all(input.id) as Array<{
        id: string;
        kind: string;
        width: number;
        height: number;
        background_json: string | null;
        background_source: string | null;
        notes: string;
        order_index: number;
      }>;

    const sourceElementsMap = new Map<string, Array<{
      type: string;
      x: number; y: number; width: number; height: number;
      rotation: number; opacity: number; z_index: number;
      layer: string; payload_json: string;
      source_theme_element_id: string | null;
    }>>();
    for (const slide of sourceSlides) {
      const elements = this.db
        .prepare(
          `SELECT type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id
           FROM slide_elements WHERE slide_id = ? ORDER BY z_index ASC, created_at ASC`
        )
        .all(slide.id) as Array<{
          type: string; x: number; y: number; width: number; height: number;
          rotation: number; opacity: number; z_index: number; layer: string;
          payload_json: string; source_theme_element_id: string | null;
        }>;
      sourceElementsMap.set(slide.id, elements);
    }

    const shiftedSiblings = this.db
      .prepare(`SELECT id FROM ${table} WHERE order_index >= ? AND id != ? ORDER BY order_index ASC`)
      .all(sourceOrder + 1, input.id) as Array<{ id: string }>;
    const shiftedSiblingIds = shiftedSiblings.map((row) => row.id);

    const newOwnerId = createId();
    const newSlideIds: Id[] = [];
    const newElementIds: Id[] = [];

    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE ${table} SET order_index = order_index + 1, updated_at = ? WHERE order_index >= ?`).run(now, sourceOrder + 1);
      this.db
        .prepare(`INSERT INTO ${table} (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(newOwnerId, candidateTitle, source.theme_id, sourceOrder + 1, now, now);

      for (const sourceSlide of sourceSlides) {
        const newSlideId = createId();
        newSlideIds.push(newSlideId);
        this.db
          .prepare(
            `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, background_json, background_source, notes, order_index, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            newSlideId,
            input.type === 'presentation' ? newOwnerId : null,
            input.type === 'lyric' ? newOwnerId : null,
            null,
            sourceSlide.kind,
            sourceSlide.width,
            sourceSlide.height,
            sourceSlide.background_json,
            sourceSlide.background_source ?? 'local',
            sourceSlide.notes,
            sourceSlide.order_index,
            now,
            now,
          );

        const sourceElements = sourceElementsMap.get(sourceSlide.id) ?? [];
        for (const sourceElement of sourceElements) {
          const elementId = createId();
          newElementIds.push(elementId);
          this.db
            .prepare(
              `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              elementId,
              newSlideId,
              sourceElement.type,
              sourceElement.x,
              sourceElement.y,
              sourceElement.width,
              sourceElement.height,
              sourceElement.rotation,
              sourceElement.opacity,
              sourceElement.z_index,
              sourceElement.layer,
              sourceElement.payload_json,
              sourceElement.source_theme_element_id,
              now,
              now,
            );
        }
      }
    });
    tx();

    const patchSpec: BuildPatchSpec = {
      upsertSlideIds: newSlideIds,
      upsertSlideElementIds: newElementIds,
    };
    if (input.type === 'presentation') patchSpec.upsertPresentationIds = [newOwnerId, ...shiftedSiblingIds];
    else patchSpec.upsertLyricIds = [newOwnerId, ...shiftedSiblingIds];

    return { itemId: newOwnerId, patch: this.buildPatch(patchSpec) };
  }

  movePresentation(id: Id, direction: 'up' | 'down'): SnapshotPatch {
    const touchedIds = this.moveItemOrder('presentations', id, direction);
    return touchedIds.length > 0 ? this.buildPatch({ upsertPresentationIds: touchedIds }) : this.buildPatch({});
  }

  moveLyric(id: Id, direction: 'up' | 'down'): SnapshotPatch {
    const touchedIds = this.moveItemOrder('lyrics', id, direction);
    return touchedIds.length > 0 ? this.buildPatch({ upsertLyricIds: touchedIds }) : this.buildPatch({});
  }

  moveTalk(id: Id, direction: 'up' | 'down'): SnapshotPatch {
    const touchedIds = this.moveItemOrder('talks', id, direction);
    return touchedIds.length > 0 ? this.buildPatch({ upsertTalkIds: touchedIds }) : this.buildPatch({});
  }

  movePlaylist(id: Id, direction: 'up' | 'down'): SnapshotPatch {
    const touchedIds = this.moveItemOrder('playlists', id, direction);
    return touchedIds.length > 0 ? this.buildPatch({ upsertPlaylistIds: touchedIds }) : this.buildPatch({});
  }

  setPlaylistOrder(playlistId: Id, newOrder: number): SnapshotPatch {
    const now = nowIso();
    const siblings = this.db
      .prepare('SELECT id, order_index FROM playlists ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string; order_index: number }>;

    const currentIndex = siblings.findIndex((sibling) => sibling.id === playlistId);
    if (currentIndex === -1) throw new Error(`Playlist not found: ${playlistId}`);

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, index) => index !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db.prepare('UPDATE playlists SET order_index = ?, updated_at = ? WHERE id = ?').run(index, now, sibling.id);
      });
    });
    tx();

    return this.buildPatch({ upsertPlaylistIds: reordered.map((sibling) => sibling.id) });
  }

  deletePlaylist(id: Id): SnapshotPatch {
    const deletedPlaylistEntryIds = (this.db.prepare('SELECT id FROM playlist_entries WHERE playlist_id = ?').all(id) as Array<{ id: string }>).map((row) => row.id);
    const tx = this.db.transaction((playlistId: Id) => {
      this.db.prepare('DELETE FROM playlist_entries WHERE playlist_id = ?').run(playlistId);
      this.db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
    });
    tx(id);
    return this.buildPatch({ deletedPlaylistIds: [id], deletedPlaylistEntryIds });
  }

  deletePresentation(id: Id): SnapshotPatch {
    const deletedSlideIds = (this.db.prepare('SELECT id FROM slides WHERE presentation_id = ?').all(id) as Array<{ id: string }>).map((row) => row.id);
    const deletedSlideElementIds = this.getSlideElementIdsBySlideIds(deletedSlideIds);
    const { deletedIds: deletedPlaylistEntryIds, upsertIds: upsertPlaylistEntryIds } = this.cascadeDeleteItemPlaylistRows('presentation_id', id);

    const tx = this.db.transaction((presentationId: Id) => {
      this.db.prepare('DELETE FROM slide_elements WHERE slide_id IN (SELECT id FROM slides WHERE presentation_id = ?)').run(presentationId);
      this.db.prepare('DELETE FROM slides WHERE presentation_id = ?').run(presentationId);
      this.db.prepare('DELETE FROM presentations WHERE id = ?').run(presentationId);
    });
    tx(id);
    this.normalizeItemOrder('presentations');
    const remainingIds = (this.db.prepare('SELECT id FROM presentations ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);

    return this.buildPatch({
      upsertPresentationIds: remainingIds,
      deletedPresentationIds: [id],
      deletedSlideIds,
      deletedSlideElementIds,
      deletedPlaylistEntryIds,
      upsertPlaylistEntryIds,
    });
  }

  deleteLyric(id: Id): SnapshotPatch {
    const deletedSlideIds = (this.db.prepare('SELECT id FROM slides WHERE lyric_id = ?').all(id) as Array<{ id: string }>).map((row) => row.id);
    const deletedSlideElementIds = this.getSlideElementIdsBySlideIds(deletedSlideIds);
    const { deletedIds: deletedPlaylistEntryIds, upsertIds: upsertPlaylistEntryIds } = this.cascadeDeleteItemPlaylistRows('lyric_id', id);

    const tx = this.db.transaction((lyricId: Id) => {
      this.db.prepare('DELETE FROM slide_elements WHERE slide_id IN (SELECT id FROM slides WHERE lyric_id = ?)').run(lyricId);
      this.db.prepare('DELETE FROM slides WHERE lyric_id = ?').run(lyricId);
      this.db.prepare('DELETE FROM lyrics WHERE id = ?').run(lyricId);
    });
    tx(id);
    this.normalizeItemOrder('lyrics');
    const remainingIds = (this.db.prepare('SELECT id FROM lyrics ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);

    return this.buildPatch({
      upsertLyricIds: remainingIds,
      deletedLyricIds: [id],
      deletedSlideIds,
      deletedSlideElementIds,
      deletedPlaylistEntryIds,
      upsertPlaylistEntryIds,
    });
  }

  deleteTalk(id: Id): SnapshotPatch {
    const deletedSlideIds = (this.db.prepare('SELECT id FROM slides WHERE talk_id = ?').all(id) as Array<{ id: string }>).map((row) => row.id);
    const deletedSlideElementIds = this.getSlideElementIdsBySlideIds(deletedSlideIds);
    const deletedTalkScriptBlockIds = this.getTalkScriptBlockIdsBySlideIds(deletedSlideIds);
    const { deletedIds: deletedPlaylistEntryIds, upsertIds: upsertPlaylistEntryIds } = this.cascadeDeleteItemPlaylistRows('talk_id', id);

    const tx = this.db.transaction((talkId: Id) => {
      this.db.prepare('DELETE FROM talk_script_blocks WHERE slide_id IN (SELECT id FROM slides WHERE talk_id = ?)').run(talkId);
      this.db.prepare('DELETE FROM slide_elements WHERE slide_id IN (SELECT id FROM slides WHERE talk_id = ?)').run(talkId);
      this.db.prepare('DELETE FROM slides WHERE talk_id = ?').run(talkId);
      this.db.prepare('DELETE FROM talks WHERE id = ?').run(talkId);
    });
    tx(id);
    this.normalizeItemOrder('talks');
    const remainingIds = (this.db.prepare('SELECT id FROM talks ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);

    return this.buildPatch({
      upsertTalkIds: remainingIds,
      deletedTalkIds: [id],
      deletedSlideIds,
      deletedSlideElementIds,
      deletedTalkScriptBlockIds,
      deletedPlaylistEntryIds,
      upsertPlaylistEntryIds,
    });
  }

  renamePlaylist(id: Id, name: string): SnapshotPatch {
    const result = this.db.prepare('UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), id);
    if (result.changes === 0) throw new Error(`Playlist not found: ${id}`);
    return this.buildPatch({ upsertPlaylistIds: [id] });
  }

  renamePresentation(id: Id, title: string): SnapshotPatch {
    const result = this.db.prepare('UPDATE presentations SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), id);
    if (result.changes === 0) throw new Error(`Item not found: ${id}`);
    return this.buildPatch({ upsertPresentationIds: [id] });
  }

  renameLyric(id: Id, title: string): SnapshotPatch {
    const result = this.db.prepare('UPDATE lyrics SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), id);
    if (result.changes === 0) throw new Error(`Item not found: ${id}`);
    return this.buildPatch({ upsertLyricIds: [id] });
  }

  renameTalk(id: Id, title: string): SnapshotPatch {
    const result = this.db.prepare('UPDATE talks SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), id);
    if (result.changes === 0) throw new Error(`Item not found: ${id}`);
    return this.buildPatch({ upsertTalkIds: [id] });
  }

  createSlide(input: SlideCreateInput): SnapshotPatch {
    const owner = this.resolveSlideOwnerInput(input);
    if (!owner) return this.buildPatch({});

    const now = nowIso();
    const slideId = createId();
    const ownerColumn = ITEM_OWNER_COLUMN_BY_TYPE[owner.type];
    const currentOrder = (this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM slides WHERE ${ownerColumn} = ?`).get(owner.id) as { maxOrder: number | null }).maxOrder ?? -1;
    const theme = owner.themeId ? this.getThemeRowById(THEME_TABLE_BY_TYPE[owner.type], owner.themeId) : null;
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    this.db
      .prepare(
        'INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        slideId,
        owner.type === 'presentation' ? owner.id : null,
        owner.type === 'lyric' ? owner.id : null,
        owner.type === 'talk' ? owner.id : null,
        owner.type,
        input.width ?? DEFAULT_W,
        input.height ?? DEFAULT_H,
        '',
        theme?.background ? JSON.stringify(theme.background) : null,
        theme ? 'theme' : 'local',
        currentOrder + 1,
        now,
        now
      );

    const initialElements = theme
      ? applyThemeToElements(theme, [], slideId)
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
        null,
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
      .prepare('SELECT presentation_id, lyric_id, talk_id FROM slides WHERE id = ?')
      .get(slideId) as { presentation_id: string | null; lyric_id: string | null; talk_id: string | null } | undefined;

    if (!slide) return this.buildPatch({});

    const ownerColumn = slide.presentation_id ? 'presentation_id' : slide.lyric_id ? 'lyric_id' : 'talk_id';
    const ownerId = slide.presentation_id ?? slide.lyric_id ?? slide.talk_id;
    if (!ownerId) return this.buildPatch({});
    const deletedElementIds = this.getSlideElementIdsBySlideIds([slideId]);
    const deletedTalkScriptBlockIds = this.getTalkScriptBlockIdsBySlideIds([slideId]);

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM talk_script_blocks WHERE slide_id = ?').run(slideId);
      this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
      this.db.prepare('DELETE FROM slides WHERE id = ?').run(slideId);
      this.normalizeSlideOrder(ownerColumn, ownerId);
    });

    tx();
    return this.buildPatch({
      upsertSlideIds: this.getSlideIdsForOwner(ownerColumn, ownerId),
      deletedSlideIds: [slideId],
      deletedSlideElementIds: deletedElementIds,
      deletedTalkScriptBlockIds,
    });
  }

  updateSlideNotes(input: SlideNotesUpdateInput): SnapshotPatch {
    const now = nowIso();
    this.db
      .prepare('UPDATE slides SET notes = ?, updated_at = ? WHERE id = ?')
      .run(input.notes, now, input.slideId);
    return this.buildPatch({ upsertSlideIds: [input.slideId] });
  }

  updateSlideBackground(input: SlideBackgroundUpdateInput): SnapshotPatch {
    const now = nowIso();
    const container = this.getSlideContainerOwner(input.slideId);
    const backgroundSource = container ? 'theme' : 'local';

    this.db
      .prepare('UPDATE slides SET background_json = ?, background_source = ?, updated_at = ? WHERE id = ?')
      .run(input.background ? JSON.stringify(input.background) : null, backgroundSource, now, input.slideId);

    if (!container) return this.buildPatch({ upsertSlideIds: [input.slideId] });

    switch (container.kind) {
      case 'presentationTheme':
        this.db.prepare('UPDATE presentation_themes SET updated_at = ? WHERE id = ?').run(now, container.id);
        return this.buildPatch({ upsertPresentationThemeIds: [container.id] });
      case 'lyricTheme':
        this.db.prepare('UPDATE lyric_themes SET updated_at = ? WHERE id = ?').run(now, container.id);
        return this.buildPatch({ upsertLyricThemeIds: [container.id] });
      case 'talkTheme':
        this.db.prepare('UPDATE talk_themes SET updated_at = ? WHERE id = ?').run(now, container.id);
        return this.buildPatch({ upsertTalkThemeIds: [container.id] });
      case 'overlayTheme':
        this.db.prepare('UPDATE overlay_themes SET updated_at = ? WHERE id = ?').run(now, container.id);
        return this.buildPatch({ upsertOverlayThemeIds: [container.id] });
      case 'overlay':
        this.db.prepare('UPDATE overlays SET updated_at = ? WHERE id = ?').run(now, container.id);
        return this.buildPatch({ upsertOverlayIds: [container.id] });
      case 'stage':
        this.db.prepare('UPDATE stages SET updated_at = ? WHERE id = ?').run(now, container.id);
        return this.buildPatch({ upsertStageIds: [container.id] });
    }
  }

  createTalkScriptBlock(input: TalkScriptBlockCreateInput): SnapshotPatch {
    const slide = this.db
      .prepare('SELECT id, talk_id FROM slides WHERE id = ?')
      .get(input.slideId) as { id: string; talk_id: string | null } | undefined;
    if (!slide?.talk_id) return this.buildPatch({});

    const now = nowIso();
    const id = createId();
    const currentMax = (this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) AS maxOrder FROM talk_script_blocks WHERE slide_id = ?')
      .get(input.slideId) as { maxOrder: number }).maxOrder;
    const order = input.order == null ? currentMax + 1 : Math.max(0, input.order);

    const tx = this.db.transaction(() => {
      this.db
        .prepare('UPDATE talk_script_blocks SET order_index = order_index + 1, updated_at = ? WHERE slide_id = ? AND order_index >= ?')
        .run(now, input.slideId, order);
      this.db
        .prepare('INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, input.slideId, input.text ?? '', order, now, now);
      this.normalizeTalkScriptBlockOrder(input.slideId);
    });
    tx();

    return this.buildPatch({ upsertTalkScriptBlockIds: this.getTalkScriptBlockIdsBySlideIds([input.slideId]) });
  }

  updateTalkScriptBlock(input: TalkScriptBlockUpdateInput): SnapshotPatch {
    const now = nowIso();
    this.db
      .prepare('UPDATE talk_script_blocks SET text = ?, updated_at = ? WHERE id = ?')
      .run(input.text, now, input.id);
    return this.buildPatch({ upsertTalkScriptBlockIds: [input.id] });
  }

  deleteTalkScriptBlock(id: Id): SnapshotPatch {
    const row = this.db
      .prepare('SELECT slide_id FROM talk_script_blocks WHERE id = ?')
      .get(id) as { slide_id: string } | undefined;
    if (!row) return this.buildPatch({});
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM talk_script_blocks WHERE id = ?').run(id);
      this.normalizeTalkScriptBlockOrder(row.slide_id);
    });
    tx();
    return this.buildPatch({
      upsertTalkScriptBlockIds: this.getTalkScriptBlockIdsBySlideIds([row.slide_id]),
      deletedTalkScriptBlockIds: [id],
    });
  }

  setTalkScriptBlockOrder(input: TalkScriptBlockOrderUpdateInput): SnapshotPatch {
    const row = this.db
      .prepare('SELECT slide_id, order_index FROM talk_script_blocks WHERE id = ?')
      .get(input.id) as { slide_id: string; order_index: number } | undefined;
    if (!row) return this.buildPatch({});

    const blockIds = this.getTalkScriptBlockIdsBySlideIds([row.slide_id]);
    const currentIndex = blockIds.indexOf(input.id);
    if (currentIndex < 0) return this.buildPatch({});
    const nextIndex = Math.max(0, Math.min(input.newOrder, blockIds.length - 1));
    if (currentIndex === nextIndex) return this.buildPatch({});

    const reordered = [...blockIds];
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, moved);
    const now = nowIso();
    const update = this.db.prepare('UPDATE talk_script_blocks SET order_index = ?, updated_at = ? WHERE id = ?');
    const tx = this.db.transaction(() => {
      reordered.forEach((blockId, index) => update.run(index, now, blockId));
    });
    tx();

    return this.buildPatch({ upsertTalkScriptBlockIds: reordered });
  }

  duplicateSlide(slideId: Id): SnapshotPatch {
    const original = this.db
      .prepare('SELECT id, presentation_id, lyric_id, talk_id, width, height, notes, background_json, background_source, order_index FROM slides WHERE id = ?')
      .get(slideId) as {
        id: string;
        presentation_id: string | null;
        lyric_id: string | null;
        talk_id: string | null;
        width: number;
        height: number;
        notes: string | null;
        background_json: string | null;
        background_source: string | null;
        order_index: number;
      } | undefined;
    if (!original) return this.buildPatch({});

    const ownerColumn = original.presentation_id !== null ? 'presentation_id' : original.lyric_id !== null ? 'lyric_id' : 'talk_id';
    const ownerValue = original.presentation_id ?? original.lyric_id ?? original.talk_id;
    if (!ownerValue) return this.buildPatch({});

    const now = nowIso();
    const newSlideId = createId();
    const insertOrder = original.order_index + 1;

    const elements = this.db
      .prepare(
        `SELECT type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id
         FROM slide_elements WHERE slide_id = ? ORDER BY layer ASC, z_index ASC, created_at ASC`
      )
      .all(slideId) as Array<{
        type: SlideElement['type'];
        x: number; y: number; width: number; height: number;
        rotation: number; opacity: number; z_index: number;
        layer: SlideElement['layer']; payload_json: string;
        source_theme_element_id: string | null;
      }>;
    const scriptBlocks = this.db
      .prepare('SELECT text, order_index FROM talk_script_blocks WHERE slide_id = ? ORDER BY order_index ASC')
      .all(slideId) as Array<{ text: string; order_index: number }>;

    const shiftOrder = this.db.prepare(
      `UPDATE slides SET order_index = order_index + 1, updated_at = ? WHERE ${ownerColumn} = ? AND order_index >= ?`
    );
    const insertSlide = this.db.prepare(
      'INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const insertScriptBlock = this.db.prepare(
      'INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const newElementIds: Id[] = [];
    const tx = this.db.transaction(() => {
      shiftOrder.run(now, ownerValue, insertOrder);
      insertSlide.run(
        newSlideId,
        original.presentation_id,
        original.lyric_id,
        original.talk_id,
        original.presentation_id ? 'presentation' : original.lyric_id ? 'lyric' : 'talk',
        original.width,
        original.height,
        original.notes ?? '',
        original.background_json,
        original.background_source ?? 'local',
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
          el.source_theme_element_id,
          now, now,
        );
      }
      for (const block of scriptBlocks) {
        insertScriptBlock.run(createId(), newSlideId, block.text, block.order_index, now, now);
      }
    });
    tx();

    return this.buildPatch({
      upsertSlideIds: this.getSlideIdsForOwner(ownerColumn, ownerValue),
      upsertSlideElementIds: newElementIds,
      upsertTalkScriptBlockIds: this.getTalkScriptBlockIdsBySlideIds([newSlideId]),
    });
  }

  setSlideOrder(input: SlideOrderUpdateInput): SnapshotPatch {
    const now = nowIso();

    const slide = this.db
      .prepare('SELECT id, presentation_id, lyric_id, talk_id FROM slides WHERE id = ?')
      .get(input.slideId) as { id: string; presentation_id: string | null; lyric_id: string | null; talk_id: string | null } | undefined;

    if (!slide) return this.buildPatch({});

    const ownerColumn = slide.presentation_id !== null ? 'presentation_id' : slide.lyric_id !== null ? 'lyric_id' : 'talk_id';
    const ownerId = slide.presentation_id ?? slide.lyric_id ?? slide.talk_id;

    if (!ownerId) return this.buildPatch({});

    const siblings = this.db
      .prepare(`SELECT id, order_index FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(ownerId) as { id: string; order_index: number }[];

    const currentIndex = siblings.findIndex(s => s.id === input.slideId);
    if (currentIndex === -1) return this.buildPatch({});

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(input.newOrder, maxOrder));

    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, i) => i !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE slides SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    return this.buildPatch({ upsertSlideIds: reordered.map((sibling) => sibling.id) });
  }

  createElement(input: ElementCreateInput): SnapshotPatch {
    const now = nowIso();
    const newId = input.id ?? createId();
    this.db
      .prepare(
        `INSERT INTO slide_elements
          (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        input.sourceThemeElementId ?? null,
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
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          input.sourceThemeElementId ?? null,
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
          type: SlideElement['type'];
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
        // A replacement payload is validated against the variant the *existing
        // row* declares (issue #224). The IPC codec structurally cannot do this
        // — an update does not carry `type`, and that discriminant lives only
        // here — so this is the first layer that can resolve the variant.
        JSON.stringify(
          input.payload
            ? decodeSlideElementPayload(
              input.payload,
              existing.type,
              resolvedInputContext('updateElement', `slide_elements.${existing.id}.payload`),
            )
            : decodeSlideElementPayloadJson(existing.payload_json, existing.type, persistedContext('updateElement', `slide_elements.${existing.id}.payload_json`)),
        ),
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
              type: SlideElement['type'];
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
        if (!existing) throw new Error(`Slide element not found: ${input.id}`);
        update.run(
          input.x ?? existing.x,
          input.y ?? existing.y,
          input.width ?? existing.width,
          input.height ?? existing.height,
          input.rotation ?? existing.rotation,
          input.opacity ?? existing.opacity,
          input.zIndex ?? existing.z_index,
          input.layer ?? existing.layer,
          // See updateElement: the replacement payload is validated against the
          // variant the existing row declares (issue #224). This runs inside
          // the batch transaction, so one mismatched payload rolls the whole
          // batch back rather than applying a partial update.
          JSON.stringify(
            input.payload
              ? decodeSlideElementPayload(
                input.payload,
                existing.type,
                resolvedInputContext('updateElementsBatch', `slide_elements.${existing.id}.payload`),
              )
              : decodeSlideElementPayloadJson(existing.payload_json, existing.type, persistedContext('updateElementsBatch', `slide_elements.${existing.id}.payload_json`)),
          ),
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
    this.db
      .prepare(`INSERT INTO ${table} (id, name, src, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(assetId, asset.name, asset.src, currentOrder + 1, now, now);
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
    throw new Error(`Media asset not found: ${id}`);
  }

  updateMediaAssetSrc(id: Id, src: string): SnapshotPatch {
    this.assertMediaSource(src);
    for (const table of MEDIA_ASSET_TABLES) {
      const result = this.db.prepare(`UPDATE ${table} SET src = ?, updated_at = ? WHERE id = ?`).run(src, nowIso(), id);
      if (result.changes > 0) {
        return this.buildPatch({ upsertMediaAssetIds: [id] });
      }
    }
    throw new Error(`Media asset not found: ${id}`);
  }

  private mediaAssetTable(type: MediaAssetType): 'image_assets' | 'video_assets' | 'audio_assets' {
    return type === 'image' ? 'image_assets' : type === 'video' ? 'video_assets' : 'audio_assets';
  }

  createOverlay(input: OverlayCreateInput): SnapshotPatch {
    const now = nowIso();
    const overlayId = createId();
    const slideId = `${overlayId}:slide`;
    // New container — regenerate element IDs so cloned/duplicated input
    // can't collide with the source overlay's existing slide_elements rows.
    const elements = (input.elements ?? []).map((el) => ({ ...el, id: createId(), slideId }));

    const nextOrder = this.getNextOrderIndex('overlays');

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO overlays (id, name, enabled, animation_json, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          overlayId,
          input.name,
          1,
          JSON.stringify(normalizeOverlayAnimation(input.animation ?? { kind: 'none', durationMs: 0, autoClearDurationMs: null })),
          nextOrder,
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

    if (!existing) throw new Error(`Overlay not found: ${input.id}`);

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
          JSON.stringify(normalizeOverlayAnimation(input.animation ?? decodeOverlayAnimationJson(existing.animation_json, persistedContext('updateOverlay', `overlays.${existing.id}.animation_json`)))),
          now,
          input.id,
        );
    });
    tx();

    return this.buildPatch({ upsertOverlayIds: [input.id] });
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
    const upsertOverlayIds = this.normalizeOrderIndex('overlays');
    return this.buildPatch({ deletedOverlayIds: [overlayId], upsertOverlayIds });
  }

  /** Absolute-position reorder of the overlay list (v28 `order_index`). */
  setOverlayOrder(overlayId: Id, newOrder: number): SnapshotPatch {
    const upsertOverlayIds = this.setFlatTableOrder('overlays', overlayId, newOrder, 'Overlay');
    return this.buildPatch({ upsertOverlayIds });
  }

  // ─── Stages ───────────────────────────────────────────────────────
  // A Stage is a named container of SlideElement[] that maps to its own NDI
  // sender. Schema mirrors themes (no kind, no theme-application links).

  createStage(input: StageCreateInput): SnapshotPatch {
    const now = nowIso();
    const stageId = createId();
    const slideId = `${stageId}:slide`;
    // New container — regenerate element IDs so cloned input can't collide
    // with the source stage's existing slide_elements rows.
    const elements = (input.elements ?? []).map((el) => ({ ...el, id: createId(), slideId }));
    const width = input.width ?? 1920;
    const height = input.height ?? 1080;
    const nextOrderRow = this.db
      .prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM stages')
      .get() as { next_order: number };

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(stageId, input.name, width, height, nextOrderRow.next_order, now, now);
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

    if (!existing) throw new Error(`Stage not found: ${input.id}`);

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
    const exists = this.db.prepare('SELECT id FROM stages WHERE id = ?').get(stageId);
    if (!exists) throw new Error(`Stage not found: ${stageId}`);
    const slideId = `${stageId}:slide`;
    const tx = this.db.transaction(() => {
      // Drop the owning slide first (its stage_id FK references the stage).
      this.deleteContainerSlide(slideId);
      this.db.prepare('DELETE FROM stages WHERE id = ?').run(stageId);
    });
    tx();
    this.normalizeStageOrder();
    const remainingStageIds = (this.db.prepare('SELECT id FROM stages ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    return this.buildPatch({ deletedStageIds: [stageId], upsertStageIds: remainingStageIds });
  }

  /**
   * Absolute-position reorder of the stage list. `stages.order_index` has
   * existed since v8; until the list panels became drag-reorderable nothing
   * ever wrote it after creation.
   */
  setStageOrder(stageId: Id, newOrder: number): SnapshotPatch {
    const siblings = this.db
      .prepare('SELECT id FROM stages ORDER BY order_index ASC, created_at ASC, id ASC')
      .all() as Array<{ id: string }>;
    const currentIndex = siblings.findIndex((sibling) => sibling.id === stageId);
    if (currentIndex === -1) throw new Error(`Stage not found: ${stageId}`);

    const targetOrder = Math.max(0, Math.min(newOrder, siblings.length - 1));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, index) => index !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const update = this.db.prepare('UPDATE stages SET order_index = ? WHERE id = ?');
    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => update.run(index, sibling.id));
    });
    tx();

    return this.buildPatch({ upsertStageIds: reordered.map((sibling) => sibling.id) });
  }

  /** Absolute-position reorder within one of the four per-owner theme tables. */
  setThemeOrder(themeId: Id, themeType: ThemeOwnerType, newOrder: number): SnapshotPatch {
    const table = THEME_TABLE_BY_TYPE[themeType];
    const siblings = this.db
      .prepare(`SELECT id FROM ${table} ORDER BY order_index ASC, created_at ASC, id ASC`)
      .all() as Array<{ id: string }>;
    const currentIndex = siblings.findIndex((sibling) => sibling.id === themeId);
    if (currentIndex === -1) throw new Error(`Theme not found: ${themeId}`);

    const targetOrder = Math.max(0, Math.min(newOrder, siblings.length - 1));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, index) => index !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const update = this.db.prepare(`UPDATE ${table} SET order_index = ? WHERE id = ?`);
    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => update.run(index, sibling.id));
    });
    tx();

    return this.buildPatch(this.themeUpsertSpec(themeType, reordered.map((sibling) => sibling.id)));
  }

  duplicateStage(stageId: Id): SnapshotPatch {
    const existing = this.db
      .prepare('SELECT id, name, width, height FROM stages WHERE id = ?')
      .get(stageId) as
      | { id: string; name: string; width: number; height: number }
      | undefined;

    if (!existing) throw new Error(`Stage not found: ${stageId}`);

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
          `INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(newId, `${existing.name} copy`, existing.width, existing.height, nextOrderRow.next_order, now, now);
      this.createContainerSlide(newSlideId, 'stage', newId, existing.width, existing.height, now);
      this.replaceContainerElements(newSlideId, clonedElements, now);
    });
    tx();

    return this.buildPatch({ upsertStageIds: [newId] });
  }

  private getCue(cueId: Id): Cue {
    const row = this.db.prepare(
      `SELECT id, kind, payload_json, failure_policy, created_at, updated_at
       FROM cues WHERE id = ?`
    ).get(cueId) as {
      id: string;
      kind: string;
      payload_json: string;
      failure_policy: string;
      created_at: string;
      updated_at: string;
    } | undefined;

    if (!row) throw new Error(`Cue not found: ${cueId}`);

    return {
      id: row.id,
      kind: row.kind as CueKind,
      payload: decodeCuePayloadJson(row.payload_json, persistedContext('getCueById', `cues.${row.id}.payload_json`)),
      failurePolicy: row.failure_policy as CueFailurePolicy,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getMacroCuesByMacroIds(macroIds: Id[]): Map<Id, MacroCue[]> {
    const byMacroId = new Map<Id, MacroCue[]>();
    for (const macroId of macroIds) byMacroId.set(macroId, []);
    if (macroIds.length === 0) return byMacroId;

    const placeholders = macroIds.map(() => '?').join(', ');
    const rows = this.db.prepare(
      `SELECT step.id, step.action_id, step.cue_id, step.order_index,
              step.delay_before_ms AS step_delay_before_ms, step.delay_after_ms AS step_delay_after_ms,
              step.created_at, step.updated_at,
              cue.kind AS cue_kind, cue.payload_json AS cue_payload_json,
              cue.failure_policy AS cue_failure_policy,
              cue.created_at AS cue_created_at, cue.updated_at AS cue_updated_at
       FROM action_steps step
       JOIN cues cue ON cue.id = step.cue_id
       WHERE step.action_id IN (${placeholders})
       ORDER BY step.order_index ASC, step.created_at ASC, step.id ASC`
    ).all(...macroIds) as Array<{
      id: string;
      action_id: string;
      cue_id: string;
      order_index: number;
      step_delay_before_ms: number;
      step_delay_after_ms: number;
      created_at: string;
      updated_at: string;
      cue_kind: string;
      cue_payload_json: string;
      cue_failure_policy: string;
      cue_created_at: string;
      cue_updated_at: string;
    }>;

    for (const row of rows) {
      const cues = byMacroId.get(row.action_id) ?? [];
      cues.push({
        id: row.id,
        macroId: row.action_id,
        cueId: row.cue_id,
        cue: {
          id: row.cue_id,
          kind: row.cue_kind as CueKind,
          payload: decodeCuePayloadJson(row.cue_payload_json, persistedContext('getMacroCuesByMacroIds', `cues.${row.cue_id}.payload_json`)),
          failurePolicy: row.cue_failure_policy as CueFailurePolicy,
          createdAt: row.cue_created_at,
          updatedAt: row.cue_updated_at,
        },
        orderIndex: row.order_index,
        delayBeforeMs: row.step_delay_before_ms,
        delayAfterMs: row.step_delay_after_ms,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
      byMacroId.set(row.action_id, cues);
    }

    return byMacroId;
  }

  private getCuesByIds(ids: Id[]): Cue[] {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return this.listCues().filter((cue) => wanted.has(cue.id));
  }

  private getMacrosByIds(ids: Id[]): Macro[] {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return this.listMacros().filter((macro) => wanted.has(macro.id));
  }

  private getTriggerBindingsByIds(ids: Id[]): TriggerBinding[] {
    if (ids.length === 0) return [];
    const wanted = new Set(ids);
    return this.listTriggerBindings().filter((binding) => wanted.has(binding.id));
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

  private normalizeSlideOrder(ownerColumn: 'presentation_id' | 'lyric_id' | 'talk_id', ownerId: Id): void {
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

  private normalizeTalkScriptBlockOrder(slideId: Id): void {
    const now = nowIso();
    this.db
      .prepare(
        `WITH ranked AS (
           SELECT id, ROW_NUMBER() OVER (ORDER BY order_index ASC, created_at ASC, id ASC) - 1 AS next_order
           FROM talk_script_blocks
           WHERE slide_id = ?
         )
         UPDATE talk_script_blocks
         SET order_index = (SELECT next_order FROM ranked WHERE ranked.id = talk_script_blocks.id),
             updated_at = ?
         WHERE slide_id = ?`
      )
      .run(slideId, now, slideId);
  }

  private assertMediaSource(src: string): void {
    if (src.startsWith('blob:')) {
      throw new Error('Transient blob media sources are not allowed. Import from a local file path.');
    }
  }

  private inferLayer(type: string): 'background' | 'media' | 'content' {
    if (type === 'shape') return 'background';
    if (type === 'image' || type === 'video') return 'media';
    return 'content';
  }

  /** Generic same-table up/down neighbor swap, reused for the three item tables and `playlists`. */
  private moveItemOrder(table: ItemTableName | 'playlists', id: Id, direction: 'up' | 'down'): Id[] {
    const current = this.db.prepare(`SELECT id, order_index FROM ${table} WHERE id = ?`).get(id) as { id: string; order_index: number } | undefined;
    if (!current) throw new Error(`Row not found in ${table}: ${id}`);

    const neighbor = direction === 'up'
      ? this.db.prepare(`SELECT id, order_index FROM ${table} WHERE order_index < ? ORDER BY order_index DESC LIMIT 1`).get(current.order_index)
      : this.db.prepare(`SELECT id, order_index FROM ${table} WHERE order_index > ? ORDER BY order_index ASC LIMIT 1`).get(current.order_index);
    if (!neighbor) return [];

    const n = neighbor as { id: string; order_index: number };
    const now = nowIso();
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ?`).run(n.order_index, now, current.id);
      this.db.prepare(`UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ?`).run(current.order_index, now, n.id);
    });
    tx();
    return [current.id, n.id];
  }

  /** Densely renumbers one item table's order_index 0..n after a delete. */
  private normalizeItemOrder(table: ItemTableName): void {
    const rows = this.db.prepare(`SELECT id FROM ${table} ORDER BY order_index ASC, created_at ASC`).all() as Array<{ id: string }>;
    const update = this.db.prepare(`UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ?`);
    const now = nowIso();
    const tx = this.db.transaction(() => {
      rows.forEach((row, index) => update.run(index, now, row.id));
    });
    tx();
  }

  private resolveItemOwnerRow(id: Id): ItemOwnerRow | null {
    const presentation = this.db.prepare('SELECT theme_id FROM presentations WHERE id = ?').get(id) as { theme_id: string | null } | undefined;
    if (presentation) return { type: 'presentation', themeId: presentation.theme_id };

    const lyric = this.db.prepare('SELECT theme_id FROM lyrics WHERE id = ?').get(id) as { theme_id: string | null } | undefined;
    if (lyric) return { type: 'lyric', themeId: lyric.theme_id };

    const talk = this.db.prepare('SELECT theme_id FROM talks WHERE id = ?').get(id) as { theme_id: string | null } | undefined;
    if (talk) return { type: 'talk', themeId: talk.theme_id };

    return null;
  }

  private resolveSlideOwnerInput(input: SlideCreateInput): (ItemOwnerRow & { id: Id }) | null {
    const providedIds = [input.presentationId, input.lyricId, input.talkId].filter(Boolean);
    if (providedIds.length !== 1) return null;
    const ownerId = input.presentationId ?? input.lyricId ?? input.talkId ?? null;
    if (!ownerId) return null;

    const owner = this.resolveItemOwnerRow(ownerId);
    if (!owner) return null;

    if (owner.type === 'presentation' && input.presentationId) return { ...owner, id: input.presentationId };
    if (owner.type === 'lyric' && input.lyricId) return { ...owner, id: input.lyricId };
    if (owner.type === 'talk' && input.talkId) return { ...owner, id: input.talkId };
    return null;
  }

  /** Detaches every playlist row referencing `itemId` (owner column `ownerColumn`) and densifies each affected playlist's remaining order. */
  private cascadeDeleteItemPlaylistRows(ownerColumn: 'presentation_id' | 'lyric_id' | 'talk_id', itemId: Id): { deletedIds: Id[]; upsertIds: Id[] } {
    const rows = this.db.prepare(`SELECT id, playlist_id FROM playlist_entries WHERE ${ownerColumn} = ?`).all(itemId) as Array<{ id: string; playlist_id: string }>;
    if (rows.length === 0) return { deletedIds: [], upsertIds: [] };
    this.db.prepare(`DELETE FROM playlist_entries WHERE ${ownerColumn} = ?`).run(itemId);
    const affectedPlaylistIds = new Set(rows.map((row) => row.playlist_id));
    const upsertIds: Id[] = [];
    for (const playlistId of affectedPlaylistIds) upsertIds.push(...this.normalizePlaylistRowOrder(playlistId));
    return { deletedIds: rows.map((row) => row.id), upsertIds };
  }

  /** Inserts a new item-entry row into a playlist at `position` (append when omitted), shifting later rows. Returns the new row's id. */
  private insertPlaylistItemRow(playlistId: Id, itemRef: ItemRef, position?: number): Id {
    const now = nowIso();
    const id = createId();
    const owner = toPlaylistItemOwnerColumns(makePlaylistItemReference(itemRef.type, itemRef.id));
    const siblingCount = (this.db.prepare('SELECT COUNT(*) AS count FROM playlist_entries WHERE playlist_id = ?').get(playlistId) as { count: number }).count;
    const order = position === undefined ? siblingCount : Math.max(0, Math.min(position, siblingCount));

    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE playlist_entries SET order_index = order_index + 1, updated_at = ? WHERE playlist_id = ? AND order_index >= ?').run(now, playlistId, order);
      this.db
        .prepare(
          `INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
           VALUES (?, ?, 'item', ?, ?, ?, ?, ?, ?)`
        )
        .run(id, playlistId, owner.presentationId, owner.lyricId, owner.talkId, order, now, now);
    });
    tx();
    return id;
  }

  /** Densely renumbers one playlist's row order after a removal. Returns only the ids whose order_index actually changed. */
  private normalizePlaylistRowOrder(playlistId: Id): Id[] {
    const rows = this.db
      .prepare('SELECT id, order_index FROM playlist_entries WHERE playlist_id = ? ORDER BY order_index ASC, created_at ASC')
      .all(playlistId) as Array<{ id: string; order_index: number }>;
    const now = nowIso();
    const changed: Id[] = [];
    const tx = this.db.transaction(() => {
      rows.forEach((row, index) => {
        if (row.order_index !== index) {
          this.db.prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?').run(index, now, row.id);
          changed.push(row.id);
        }
      });
    });
    tx();
    return changed;
  }

  private themeUpsertSpec(themeType: ThemeOwnerType, ids: Id[]): BuildPatchSpec {
    switch (themeType) {
      case 'presentation': return { upsertPresentationThemeIds: ids };
      case 'lyric': return { upsertLyricThemeIds: ids };
      case 'talk': return { upsertTalkThemeIds: ids };
      case 'overlay': return { upsertOverlayThemeIds: ids };
    }
  }

  private themeDeleteSpec(themeType: ThemeOwnerType, ids: Id[]): BuildPatchSpec {
    switch (themeType) {
      case 'presentation': return { deletedPresentationThemeIds: ids };
      case 'lyric': return { deletedLyricThemeIds: ids };
      case 'talk': return { deletedTalkThemeIds: ids };
      case 'overlay': return { deletedOverlayThemeIds: ids };
    }
  }

  private getBundleItemById(itemId: Id): BundleItem | null {
    const owner = this.resolveItemOwnerRow(itemId);
    if (!owner) return null;

    const table = ITEM_TABLE_BY_TYPE[owner.type];
    const row = this.db.prepare(`SELECT id, title, theme_id, order_index FROM ${table} WHERE id = ?`).get(itemId) as
      | { id: string; title: string; theme_id: string | null; order_index: number }
      | undefined;
    if (!row) return null;

    const ownerColumn = ITEM_OWNER_COLUMN_BY_TYPE[owner.type];
    const slides = this.db
      .prepare(
        `SELECT id, width, height, notes, background_json, background_source, order_index
         FROM slides
         WHERE ${ownerColumn} = ?
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(itemId) as Array<{ id: string; width: number; height: number; notes: string; background_json: string | null; background_source: string | null; order_index: number }>;

    const bundleSlides = slides.map((slide): BundleSlide => ({
      id: slide.id,
      width: slide.width,
      height: slide.height,
      notes: slide.notes,
      order: slide.order_index,
      background: slide.background_json ? decodeSlideBackgroundJson(slide.background_json, persistedContext('exportBundle', `slides.${slide.id}.background_json`)) : null,
      backgroundSource: (slide.background_source ?? 'local') as SlideBackgroundSource,
      elements: this.getSlideElementsBySlideId(slide.id),
      scriptBlocks: owner.type === 'talk'
        ? (this.getTalkScriptBlocksByIds(this.getTalkScriptBlockIdsBySlideIds([slide.id])).map((block): BundleTalkScriptBlock => ({
          id: block.id,
          text: block.text,
          order: block.order,
        })))
        : undefined,
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

  private getBundlePlaylistById(playlistId: Id): BundlePlaylist | null {
    const row = this.db.prepare('SELECT id, name, order_index FROM playlists WHERE id = ?').get(playlistId) as
      | { id: string; name: string; order_index: number }
      | undefined;
    if (!row) return null;

    const rows: BundlePlaylistRow[] = this.getPlaylistRows(playlistId).map((entry) => {
      if (entry.kind === 'separator') {
        return { id: entry.id, kind: 'separator', label: entry.label, colorKey: entry.colorKey, order: entry.order };
      }
      const owner = toPlaylistItemOwnerColumns(entry.reference);
      return { id: entry.id, kind: 'item', presentationId: owner.presentationId, lyricId: owner.lyricId, talkId: owner.talkId, order: entry.order };
    });

    return { id: row.id, name: row.name, order: row.order_index, rows };
  }

  private getBundleThemeById(themeId: Id, themeType: ThemeOwnerType): BundleTheme | null {
    const theme = this.getThemeRowById(THEME_TABLE_BY_TYPE[themeType], themeId);
    if (!theme) return null;
    return toBundleTheme(theme, themeType);
  }

  /**
   * Structural validation is @lumacast/protocol's single named validation
   * entry point for the bundle wire contract. It also decodes and converts a
   * legacy v1 manifest to the current v2 shape (`normalizeBundleManifestV1`,
   * wave K) — the RETURNED manifest, not the caller's original argument, is
   * the one every downstream step (inspect/finalize) must use, so a v1
   * import actually sees flat rows and `themeType`-tagged themes rather than
   * the raw pre-#219 shape. Then checks the referential domain rules that
   * don't belong in the protocol layer: theme existence/compatibility within
   * this manifest.
   */
  private assertValidBundleManifest(manifest: BundleManifest, operation: string): BundleManifest {
    const validated = validateBundleManifest(manifest, { boundary: 'bundle-import', operation, path: 'manifest' });

    const themesById = new Map(validated.themes.map((theme) => [theme.id, theme] as const));
    for (const item of validated.items) {
      if (!item.themeId) continue;
      const theme = themesById.get(item.themeId);
      if (!theme) throw new Error(`Bundle item ${item.title} references a missing theme.`);
      if (theme.themeType !== item.type) throw new Error(`Bundle item ${item.title} has an incompatible theme.`);
    }
    return validated;
  }

  private collectBrokenBundleReferences(manifest: BundleManifest): BrokenBundleReference[] {
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
    manifest: BundleManifest,
    decisionMap: ReadonlyMap<string, BundleBrokenReferenceDecision>,
  ): void {
    function rewriteElements(
      elements: SlideElement[],
      localDecisionMap: ReadonlyMap<string, BundleBrokenReferenceDecision>,
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
    manifest.mediaReferences = collectBundleMediaReferences(
      manifest.items,
      manifest.themes,
      manifest.overlays ?? [],
      manifest.stages ?? [],
    );
  }

  private collectReplacementMediaSources(
    brokenReferences: BrokenBundleReference[],
    decisionMap: ReadonlyMap<string, BundleBrokenReferenceDecision>,
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
    themeSlideId: Id,
    now: string,
    elementIndex: number,
  ): SlideElement {
    return {
      ...JSON.parse(JSON.stringify(element)) as SlideElement,
      id: `${themeSlideId}:theme:${elementIndex}`,
      slideId: themeSlideId,
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

  /**
   * Next appended position for one of the flat, globally-ordered tables
   * (`overlays`/`actions`). Mirrors getNextThemeOrderIndex for the two tables
   * that gained an `order_index` in the v28 `list-order-index` migration.
   */
  private getNextOrderIndex(table: 'overlays' | 'actions'): number {
    const row = this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM ${table}`).get() as { maxOrder: number | null };
    return (row.maxOrder ?? -1) + 1;
  }

  /**
   * Renumbers `table` to a dense 0..n-1 `order_index`, preserving relative
   * order, and returns every id whose position changed so the caller can put
   * exactly those rows in its patch. `updated_at` is deliberately left alone:
   * a neighbour shifting up because something above it was deleted is not an
   * edit to that neighbour, and the macro list sorts stably without it.
   */
  private normalizeOrderIndex(table: 'overlays' | 'actions'): Id[] {
    const rows = this.db
      .prepare(`SELECT id, order_index FROM ${table} ORDER BY order_index ASC, created_at ASC, id ASC`)
      .all() as Array<{ id: string; order_index: number }>;
    const update = this.db.prepare(`UPDATE ${table} SET order_index = ? WHERE id = ?`);
    const changed: Id[] = [];
    const tx = this.db.transaction(() => {
      rows.forEach((row, index) => {
        if (row.order_index === index) return;
        update.run(index, row.id);
        changed.push(row.id);
      });
    });
    tx();
    return changed;
  }

  /**
   * Absolute-position reorder for `overlays`/`actions`: lifts the row out and
   * reinserts it at `newOrder`, then renumbers densely — the same
   * remove-then-insert semantics as setPlaylistOrder/movePlaylistRow, which is
   * exactly what a drag-and-drop drop index means. Out-of-range targets clamp
   * instead of throwing, and a no-op move returns an empty patch.
   */
  private setFlatTableOrder(table: 'overlays' | 'actions', id: Id, newOrder: number, label: string): Id[] {
    const siblings = this.db
      .prepare(`SELECT id FROM ${table} ORDER BY order_index ASC, created_at ASC, id ASC`)
      .all() as Array<{ id: string }>;
    const currentIndex = siblings.findIndex((sibling) => sibling.id === id);
    if (currentIndex === -1) throw new Error(`${label} not found: ${id}`);

    const targetOrder = Math.max(0, Math.min(newOrder, siblings.length - 1));
    if (currentIndex === targetOrder) return [];

    const reordered = siblings.filter((_, index) => index !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const update = this.db.prepare(`UPDATE ${table} SET order_index = ? WHERE id = ?`);
    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => update.run(index, sibling.id));
    });
    tx();

    return reordered.map((sibling) => sibling.id);
  }

  private getNextThemeOrderIndex(table: ThemeTableName): number {
    const row = this.db.prepare(`SELECT MAX(order_index) AS maxOrder FROM ${table}`).get() as { maxOrder: number | null };
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

  private getPresentations(): Presentation[] {
    const rows = this.db
      .prepare('SELECT id, title, theme_id, order_index, created_at, updated_at FROM presentations ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getPresentationsByIds(ids: Id[]): Presentation[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, title, theme_id, order_index, created_at, updated_at FROM presentations WHERE id IN (${placeholders}) ORDER BY order_index ASC, created_at ASC`)
      .all(...ids) as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getLyrics(): Lyric[] {
    const rows = this.db
      .prepare('SELECT id, title, theme_id, order_index, created_at, updated_at FROM lyrics ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getLyricsByIds(ids: Id[]): Lyric[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, title, theme_id, order_index, created_at, updated_at FROM lyrics WHERE id IN (${placeholders}) ORDER BY order_index ASC, created_at ASC`)
      .all(...ids) as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getTalks(): Talk[] {
    const rows = this.db
      .prepare('SELECT id, title, theme_id, order_index, created_at, updated_at FROM talks ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getTalksByIds(ids: Id[]): Talk[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, title, theme_id, order_index, created_at, updated_at FROM talks WHERE id IN (${placeholders}) ORDER BY order_index ASC, created_at ASC`)
      .all(...ids) as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      themeId: row.theme_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Content slides only (presentation/lyric/talk owned) — theme/overlay/
  // stage container slides surface via their owning container's `elements`
  // field instead, so their six non-item owner columns are always null here.
  private getSlides(): Slide[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.presentation_id, s.lyric_id, s.talk_id, s.kind, s.width, s.height, s.notes, s.background_json, s.background_source, s.order_index, s.created_at, s.updated_at,
                COALESCE(d.order_index, l.order_index, t.order_index) AS content_order
         FROM slides s
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         LEFT JOIN talks t ON t.id = s.talk_id
         WHERE s.presentation_id IS NOT NULL OR s.lyric_id IS NOT NULL OR s.talk_id IS NOT NULL
         ORDER BY content_order ASC, s.order_index ASC`
      )
      .all() as Array<{
        id: string;
        presentation_id: string | null;
        lyric_id: string | null;
        talk_id: string | null;
        kind: SlideKind;
        width: number;
        height: number;
        notes: string;
        background_json: string | null;
        background_source: string | null;
        order_index: number;
        created_at: string;
        updated_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      talkId: row.talk_id,
      presentationThemeId: null,
      lyricThemeId: null,
      talkThemeId: null,
      overlayThemeId: null,
      overlayId: null,
      stageId: null,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      background: row.background_json ? decodeSlideBackgroundJson(row.background_json, persistedContext('getSlides', `slides.${row.id}.background_json`)) : null,
      backgroundSource: (row.background_source ?? 'local') as SlideBackgroundSource,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getSlidesByIds(ids: Id[]): Slide[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT s.id, s.presentation_id, s.lyric_id, s.talk_id, s.kind, s.width, s.height, s.notes, s.background_json, s.background_source, s.order_index, s.created_at, s.updated_at,
                COALESCE(d.order_index, l.order_index, t.order_index) AS content_order
         FROM slides s
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         LEFT JOIN talks t ON t.id = s.talk_id
         WHERE s.id IN (${placeholders}) AND (s.presentation_id IS NOT NULL OR s.lyric_id IS NOT NULL OR s.talk_id IS NOT NULL)
         ORDER BY content_order ASC, s.order_index ASC`
      )
      .all(...ids) as Array<{
        id: string;
        presentation_id: string | null;
        lyric_id: string | null;
        talk_id: string | null;
        kind: SlideKind;
        width: number;
        height: number;
        notes: string;
        background_json: string | null;
        background_source: string | null;
        order_index: number;
        created_at: string;
        updated_at: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      talkId: row.talk_id,
      presentationThemeId: null,
      lyricThemeId: null,
      talkThemeId: null,
      overlayThemeId: null,
      overlayId: null,
      stageId: null,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      background: row.background_json ? decodeSlideBackgroundJson(row.background_json, persistedContext('getSlidesByIds', `slides.${row.id}.background_json`)) : null,
      backgroundSource: (row.background_source ?? 'local') as SlideBackgroundSource,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Scoped to item-owned slides (presentation/lyric/talk), matching
  // `getSlides()` exactly. Theme/overlay/stage container elements surface
  // via their owning container's `elements` field instead.
  private getSlideElements(): SlideElement[] {
    const rows = this.db
      .prepare(
        `SELECT se.id, se.slide_id, se.type, se.x, se.y, se.width, se.height, se.rotation, se.opacity, se.z_index, se.layer, se.payload_json, se.source_theme_element_id, se.created_at, se.updated_at
         FROM slide_elements se
         JOIN slides s ON s.id = se.slide_id
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         LEFT JOIN talks t ON t.id = s.talk_id
         WHERE s.presentation_id IS NOT NULL OR s.lyric_id IS NOT NULL OR s.talk_id IS NOT NULL
         ORDER BY COALESCE(d.order_index, l.order_index, t.order_index) ASC, s.order_index ASC, se.layer ASC, se.z_index ASC`
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
      source_theme_element_id: string | null;
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
      payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('getSlideElements', `slide_elements.${row.id}.payload_json`)),
      sourceThemeElementId: row.source_theme_element_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getMediaAssetsByIds(ids: Id[]): MediaAsset[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, name, src, order_index, created_at, updated_at, 'image' AS type FROM image_assets WHERE id IN (${placeholders})
         UNION ALL
         SELECT id, name, src, order_index, created_at, updated_at, 'video' AS type FROM video_assets WHERE id IN (${placeholders})
         UNION ALL
         SELECT id, name, src, order_index, created_at, updated_at, 'audio' AS type FROM audio_assets WHERE id IN (${placeholders})
         ORDER BY order_index ASC, created_at ASC, id ASC`
      )
      .all(...ids, ...ids, ...ids) as Array<{
      id: string;
      name: string;
      type: MediaAssetType;
      src: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      src: row.src,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getOverlaysByIds(ids: Id[]): Overlay[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, name, enabled, animation_json, order_index, created_at, updated_at FROM overlays WHERE id IN (${placeholders}) ORDER BY order_index ASC, created_at ASC, id ASC`)
      .all(...ids) as Array<{ id: string; name: string; enabled: number; animation_json: string; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => {
      const slideId = `${row.id}:slide`;
      return {
        id: row.id,
        slideId,
        name: row.name,
        enabled: row.enabled === 1,
        order: row.order_index,
        elements: this.getSlideElementsBySlideId(slideId),
        background: this.getSlideBackgroundBySlideId(slideId),
        animation: normalizeOverlayAnimation(decodeOverlayAnimationJson(row.animation_json, persistedContext('getOverlaysByIds', `overlays.${row.id}.animation_json`))),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getThemeRows(table: ThemeTableName): PresentationTheme[] {
    const rows = this.db
      .prepare(`SELECT id, name, width, height, order_index, created_at, updated_at FROM ${table} ORDER BY order_index ASC, created_at ASC`)
      .all() as Array<{ id: string; name: string; width: number; height: number; order_index: number; created_at: string; updated_at: string }>;
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
        background: this.getSlideBackgroundBySlideId(slideId),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getThemeRowsByIds(table: ThemeTableName, ids: Id[]): PresentationTheme[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, name, width, height, order_index, created_at, updated_at FROM ${table} WHERE id IN (${placeholders}) ORDER BY order_index ASC, created_at ASC`)
      .all(...ids) as Array<{ id: string; name: string; width: number; height: number; order_index: number; created_at: string; updated_at: string }>;
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
        background: this.getSlideBackgroundBySlideId(slideId),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getThemeRowById(table: ThemeTableName, themeId: Id): PresentationTheme | null {
    const row = this.db
      .prepare(`SELECT id, name, width, height, order_index, created_at, updated_at FROM ${table} WHERE id = ?`)
      .get(themeId) as { id: string; name: string; width: number; height: number; order_index: number; created_at: string; updated_at: string } | undefined;
    if (!row) return null;
    const slideId = `${row.id}:slide`;
    return {
      id: row.id,
      slideId,
      name: row.name,
      width: row.width,
      height: row.height,
      order: row.order_index,
      elements: this.getSlideElementsBySlideId(slideId),
      background: this.getSlideBackgroundBySlideId(slideId),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getSlideElementsByIds(ids: Id[]): SlideElement[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
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
        source_theme_element_id: string | null;
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
      payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('getSlideElementsByIds', `slide_elements.${row.id}.payload_json`)),
      sourceThemeElementId: row.source_theme_element_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Create the owning slide row for a theme/overlay/stage container. Sets
   * exactly one of the six non-item owner columns back to the container.
   */
  private createContainerSlide(
    slideId: Id,
    kind: ContainerKind,
    parentId: Id,
    width: number,
    height: number,
    now: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
         VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)`
      )
      .run(
        slideId,
        kind === 'presentationTheme' ? parentId : null,
        kind === 'lyricTheme' ? parentId : null,
        kind === 'talkTheme' ? parentId : null,
        kind === 'overlayTheme' ? parentId : null,
        kind === 'overlay' ? parentId : null,
        kind === 'stage' ? parentId : null,
        kind,
        width,
        height,
        now,
        now,
      );
  }

  private updateContainerSlideGeometry(slideId: Id, width: number, height: number, now: string): void {
    this.db
      .prepare('UPDATE slides SET width = ?, height = ?, updated_at = ? WHERE id = ?')
      .run(width, height, now, slideId);
  }

  private replaceContainerElements(slideId: Id, elements: SlideElement[], now: string): void {
    this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
    const insert = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        element.sourceThemeElementId ?? null,
        element.createdAt ?? now,
        element.updatedAt ?? now,
      );
    }
  }

  private normalizeContainerElementOwnership(elements: SlideElement[], slideId: Id): SlideElement[] {
    return elements.map((element) => {
      const normalized = { ...element, slideId };
      if (normalized.type !== 'group') return normalized;
      const payload = normalized.payload as GroupElementPayload;
      return {
        ...normalized,
        payload: {
          ...payload,
          children: this.normalizeContainerElementOwnership(payload.children ?? [], slideId),
        },
      };
    });
  }

  private deleteContainerSlide(slideId: Id): void {
    this.db.prepare('DELETE FROM slide_elements WHERE slide_id = ?').run(slideId);
    this.db.prepare('DELETE FROM slides WHERE id = ?').run(slideId);
  }

  private getSlideBackgroundBySlideId(slideId: Id): SlideBackground | null {
    const row = this.db
      .prepare('SELECT background_json FROM slides WHERE id = ?')
      .get(slideId) as { background_json: string | null } | undefined;
    return row?.background_json ? decodeSlideBackgroundJson(row.background_json, persistedContext('getSlideBackgroundBySlideId', `slides.${slideId}.background_json`)) : null;
  }

  private getSlideElementsBySlideId(slideId: Id): SlideElement[] {
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
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
      source_theme_element_id: string | null;
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
      payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('getSlideElementsBySlideId', `slide_elements.${row.id}.payload_json`)),
      sourceThemeElementId: row.source_theme_element_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getSlideIdsForOwner(ownerColumn: 'presentation_id' | 'lyric_id' | 'talk_id', ownerId: Id): Id[] {
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

  private getTalkScriptBlockIdsBySlideIds(slideIds: Id[]): Id[] {
    if (slideIds.length === 0) return [];
    const placeholders = slideIds.map(() => '?').join(',');
    return (this.db
      .prepare(`SELECT id FROM talk_script_blocks WHERE slide_id IN (${placeholders}) ORDER BY order_index ASC, id ASC`)
      .all(...slideIds) as Array<{ id: string }>)
      .map((row) => row.id);
  }

  /** Resolves which of the six non-item owner columns a slide has set, if any (null for an ordinary content slide). */
  private getSlideContainerOwner(slideId: Id): { kind: ContainerKind; id: Id } | null {
    const row = this.db
      .prepare(
        'SELECT presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id FROM slides WHERE id = ?'
      )
      .get(slideId) as {
        presentation_theme_id: string | null;
        lyric_theme_id: string | null;
        talk_theme_id: string | null;
        overlay_theme_id: string | null;
        overlay_id: string | null;
        stage_id: string | null;
      } | undefined;
    if (!row) return null;
    if (row.presentation_theme_id) return { kind: 'presentationTheme', id: row.presentation_theme_id };
    if (row.lyric_theme_id) return { kind: 'lyricTheme', id: row.lyric_theme_id };
    if (row.talk_theme_id) return { kind: 'talkTheme', id: row.talk_theme_id };
    if (row.overlay_theme_id) return { kind: 'overlayTheme', id: row.overlay_theme_id };
    if (row.overlay_id) return { kind: 'overlay', id: row.overlay_id };
    if (row.stage_id) return { kind: 'stage', id: row.stage_id };
    return null;
  }

  private getTalkScriptBlocks(): TalkScriptBlock[] {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.slide_id, b.text, b.order_index, b.created_at, b.updated_at
         FROM talk_script_blocks b
         JOIN slides s ON s.id = b.slide_id
         LEFT JOIN talks t ON t.id = s.talk_id
         ORDER BY COALESCE(t.order_index, 0) ASC, s.order_index ASC, b.order_index ASC`
      )
      .all() as Array<{
      id: string;
      slide_id: string;
      text: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      slideId: row.slide_id,
      text: row.text,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getTalkScriptBlocksByIds(ids: Id[]): TalkScriptBlock[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, text, order_index, created_at, updated_at
         FROM talk_script_blocks
         WHERE id IN (${placeholders})
         ORDER BY order_index ASC`
      )
      .all(...ids) as Array<{
      id: string;
      slide_id: string;
      text: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      slideId: row.slide_id,
      text: row.text,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getPlaylists(): Playlist[] {
    const rows = this.db
      .prepare('SELECT id, name, order_index, created_at, updated_at FROM playlists ORDER BY order_index ASC, created_at ASC')
      .all() as Array<{ id: string; name: string; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private getPlaylistsByIds(ids: Id[]): Playlist[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(`SELECT id, name, order_index, created_at, updated_at FROM playlists WHERE id IN (${placeholders}) ORDER BY order_index ASC, created_at ASC`)
      .all(...ids) as Array<{ id: string; name: string; order_index: number; created_at: string; updated_at: string }>;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  private toPlaylistRow(row: {
    id: string;
    playlist_id: string;
    kind: 'item' | 'separator';
    presentation_id: string | null;
    lyric_id: string | null;
    talk_id: string | null;
    label: string | null;
    color_key: string | null;
    order_index: number;
    created_at: string;
    updated_at: string;
  }): PlaylistRow {
    if (row.kind === 'separator') {
      const separator: PlaylistSeparator = {
        id: row.id,
        playlistId: row.playlist_id,
        kind: 'separator',
        label: row.label ?? '',
        colorKey: row.color_key,
        order: row.order_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      return separator;
    }
    const owner: PlaylistItemOwnerColumns = {
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      talkId: row.talk_id,
    };
    const reference: PlaylistItemReference = parsePlaylistItemReference(owner, `playlist entry ${row.id}`);
    const entry: PlaylistItemEntry = {
      id: row.id,
      playlistId: row.playlist_id,
      kind: 'item',
      reference,
      presentationId: row.presentation_id,
      lyricId: row.lyric_id,
      talkId: row.talk_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    return entry;
  }

  private getPlaylistRows(playlistId: Id): PlaylistRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at
         FROM playlist_entries WHERE playlist_id = ? ORDER BY order_index ASC`
      )
      .all(playlistId) as Array<{
        id: string; playlist_id: string; kind: 'item' | 'separator';
        presentation_id: string | null; lyric_id: string | null; talk_id: string | null;
        label: string | null; color_key: string | null; order_index: number;
        created_at: string; updated_at: string;
      }>;
    return rows.map((row) => this.toPlaylistRow(row));
  }

  private getAllPlaylistRows(): PlaylistRow[] {
    const rows = this.db
      .prepare(
        `SELECT pe.id, pe.playlist_id, pe.kind, pe.presentation_id, pe.lyric_id, pe.talk_id, pe.label, pe.color_key, pe.order_index, pe.created_at, pe.updated_at
         FROM playlist_entries pe
         JOIN playlists p ON p.id = pe.playlist_id
         ORDER BY p.order_index ASC, p.created_at ASC, pe.order_index ASC`
      )
      .all() as Array<{
        id: string; playlist_id: string; kind: 'item' | 'separator';
        presentation_id: string | null; lyric_id: string | null; talk_id: string | null;
        label: string | null; color_key: string | null; order_index: number;
        created_at: string; updated_at: string;
      }>;
    return rows.map((row) => this.toPlaylistRow(row));
  }

  private getPlaylistRowsByIds(ids: Id[]): PlaylistRow[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at
         FROM playlist_entries WHERE id IN (${placeholders}) ORDER BY created_at ASC, id ASC`
      )
      .all(...ids) as Array<{
        id: string; playlist_id: string; kind: 'item' | 'separator';
        presentation_id: string | null; lyric_id: string | null; talk_id: string | null;
        label: string | null; color_key: string | null; order_index: number;
        created_at: string; updated_at: string;
      }>;
    return rows.map((row) => this.toPlaylistRow(row));
  }

  private getMediaAssets(): MediaAsset[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, src, order_index, created_at, updated_at, 'image' AS type FROM image_assets
         UNION ALL
         SELECT id, name, src, order_index, created_at, updated_at, 'video' AS type FROM video_assets
         UNION ALL
         SELECT id, name, src, order_index, created_at, updated_at, 'audio' AS type FROM audio_assets
         ORDER BY order_index ASC, created_at ASC, id ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      type: MediaAssetType;
      src: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      src: row.src,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getOverlays(): Overlay[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, animation_json, order_index, created_at, updated_at
         FROM overlays
         ORDER BY order_index ASC, created_at ASC, id ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      enabled: number;
      animation_json: string;
      order_index: number;
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
        order: row.order_index,
        elements: this.getSlideElementsBySlideId(slideId),
        background: this.getSlideBackgroundBySlideId(slideId),
        animation: normalizeOverlayAnimation(decodeOverlayAnimationJson(row.animation_json, persistedContext('getOverlays', `overlays.${row.id}.animation_json`))),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private getStages(): Stage[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, width, height, order_index, created_at, updated_at
         FROM stages
         ORDER BY order_index ASC, created_at ASC`
      )
      .all() as Array<{
      id: string;
      name: string;
      width: number;
      height: number;
      order_index: number;
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
        background: this.getSlideBackgroundBySlideId(slideId),
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
        `SELECT id, name, width, height, order_index, created_at, updated_at
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
        background: this.getSlideBackgroundBySlideId(slideId),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  private normalizeStageOrder(): void {
    const rows = this.db.prepare('SELECT id, order_index FROM stages ORDER BY order_index ASC, created_at ASC, id ASC').all() as Array<{ id: string; order_index: number }>;
    const update = this.db.prepare('UPDATE stages SET order_index = ? WHERE id = ?');
    const tx = this.db.transaction(() => {
      rows.forEach((row, index) => {
        if (row.order_index === index) return;
        update.run(index, row.id);
      });
    });
    tx();
  }

  private normalizeThemeOrder(table: ThemeTableName): void {
    const rows = this.db.prepare(`SELECT id FROM ${table} ORDER BY order_index ASC, created_at ASC`).all() as Array<{ id: string }>;
    const update = this.db.prepare(`UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ?`);
    const now = nowIso();
    const tx = this.db.transaction(() => {
      rows.forEach((row, index) => update.run(index, now, row.id));
    });
    tx();
  }

  private nextPatchVersion(): number {
    this.patchVersion += 1;
    return this.patchVersion;
  }

  private buildPatch(spec: BuildPatchSpec): SnapshotPatch {
    const patch: SnapshotPatch = {
      version: this.nextPatchVersion(),
      upserts: {},
      deletes: {},
    };

    if (spec.upsertPresentationIds && spec.upsertPresentationIds.length > 0) patch.upserts.presentations = this.getPresentationsByIds(spec.upsertPresentationIds);
    if (spec.upsertLyricIds && spec.upsertLyricIds.length > 0) patch.upserts.lyrics = this.getLyricsByIds(spec.upsertLyricIds);
    if (spec.upsertTalkIds && spec.upsertTalkIds.length > 0) patch.upserts.talks = this.getTalksByIds(spec.upsertTalkIds);
    if (spec.upsertSlideIds && spec.upsertSlideIds.length > 0) patch.upserts.slides = this.getSlidesByIds(spec.upsertSlideIds);
    if (spec.upsertTalkScriptBlockIds && spec.upsertTalkScriptBlockIds.length > 0) patch.upserts.talkScriptBlocks = this.getTalkScriptBlocksByIds(spec.upsertTalkScriptBlockIds);
    if (spec.upsertSlideElementIds && spec.upsertSlideElementIds.length > 0) patch.upserts.slideElements = this.getSlideElementsByIds(spec.upsertSlideElementIds);
    if (spec.upsertMediaAssetIds && spec.upsertMediaAssetIds.length > 0) patch.upserts.mediaAssets = this.getMediaAssetsByIds(spec.upsertMediaAssetIds);
    if (spec.upsertOverlayIds && spec.upsertOverlayIds.length > 0) patch.upserts.overlays = this.getOverlaysByIds(spec.upsertOverlayIds);
    if (spec.upsertPresentationThemeIds && spec.upsertPresentationThemeIds.length > 0) patch.upserts.presentationThemes = this.getThemeRowsByIds('presentation_themes', spec.upsertPresentationThemeIds);
    if (spec.upsertLyricThemeIds && spec.upsertLyricThemeIds.length > 0) patch.upserts.lyricThemes = this.getThemeRowsByIds('lyric_themes', spec.upsertLyricThemeIds);
    if (spec.upsertTalkThemeIds && spec.upsertTalkThemeIds.length > 0) patch.upserts.talkThemes = this.getThemeRowsByIds('talk_themes', spec.upsertTalkThemeIds);
    if (spec.upsertOverlayThemeIds && spec.upsertOverlayThemeIds.length > 0) patch.upserts.overlayThemes = this.getThemeRowsByIds('overlay_themes', spec.upsertOverlayThemeIds);
    if (spec.upsertStageIds && spec.upsertStageIds.length > 0) patch.upserts.stages = this.getStagesByIds(spec.upsertStageIds);
    if (spec.upsertPlaylistIds && spec.upsertPlaylistIds.length > 0) patch.upserts.playlists = this.getPlaylistsByIds(spec.upsertPlaylistIds);
    if (spec.upsertPlaylistEntryIds && spec.upsertPlaylistEntryIds.length > 0) patch.upserts.playlistEntries = this.getPlaylistRowsByIds(spec.upsertPlaylistEntryIds);
    if (spec.upsertCueIds && spec.upsertCueIds.length > 0) patch.upserts.cues = this.getCuesByIds(spec.upsertCueIds);
    if (spec.upsertMacroIds && spec.upsertMacroIds.length > 0) patch.upserts.macros = this.getMacrosByIds(spec.upsertMacroIds);
    if (spec.upsertTriggerBindingIds && spec.upsertTriggerBindingIds.length > 0) patch.upserts.triggerBindings = this.getTriggerBindingsByIds(spec.upsertTriggerBindingIds);

    if (spec.deletedPresentationIds && spec.deletedPresentationIds.length > 0) patch.deletes.presentations = [...spec.deletedPresentationIds];
    if (spec.deletedLyricIds && spec.deletedLyricIds.length > 0) patch.deletes.lyrics = [...spec.deletedLyricIds];
    if (spec.deletedTalkIds && spec.deletedTalkIds.length > 0) patch.deletes.talks = [...spec.deletedTalkIds];
    if (spec.deletedSlideIds && spec.deletedSlideIds.length > 0) patch.deletes.slides = [...spec.deletedSlideIds];
    if (spec.deletedTalkScriptBlockIds && spec.deletedTalkScriptBlockIds.length > 0) patch.deletes.talkScriptBlocks = [...spec.deletedTalkScriptBlockIds];
    if (spec.deletedSlideElementIds && spec.deletedSlideElementIds.length > 0) patch.deletes.slideElements = [...spec.deletedSlideElementIds];
    if (spec.deletedMediaAssetIds && spec.deletedMediaAssetIds.length > 0) patch.deletes.mediaAssets = [...spec.deletedMediaAssetIds];
    if (spec.deletedOverlayIds && spec.deletedOverlayIds.length > 0) patch.deletes.overlays = [...spec.deletedOverlayIds];
    if (spec.deletedPresentationThemeIds && spec.deletedPresentationThemeIds.length > 0) patch.deletes.presentationThemes = [...spec.deletedPresentationThemeIds];
    if (spec.deletedLyricThemeIds && spec.deletedLyricThemeIds.length > 0) patch.deletes.lyricThemes = [...spec.deletedLyricThemeIds];
    if (spec.deletedTalkThemeIds && spec.deletedTalkThemeIds.length > 0) patch.deletes.talkThemes = [...spec.deletedTalkThemeIds];
    if (spec.deletedOverlayThemeIds && spec.deletedOverlayThemeIds.length > 0) patch.deletes.overlayThemes = [...spec.deletedOverlayThemeIds];
    if (spec.deletedStageIds && spec.deletedStageIds.length > 0) patch.deletes.stages = [...spec.deletedStageIds];
    if (spec.deletedPlaylistIds && spec.deletedPlaylistIds.length > 0) patch.deletes.playlists = [...spec.deletedPlaylistIds];
    if (spec.deletedPlaylistEntryIds && spec.deletedPlaylistEntryIds.length > 0) patch.deletes.playlistEntries = [...spec.deletedPlaylistEntryIds];
    if (spec.deletedCueIds && spec.deletedCueIds.length > 0) patch.deletes.cues = [...spec.deletedCueIds];
    if (spec.deletedMacroIds && spec.deletedMacroIds.length > 0) patch.deletes.macros = [...spec.deletedMacroIds];
    if (spec.deletedTriggerBindingIds && spec.deletedTriggerBindingIds.length > 0) patch.deletes.triggerBindings = [...spec.deletedTriggerBindingIds];

    return patch;
  }

  // ---------------------------------------------------------------------------
  // Project backup (#145): complete, deterministic serialization of every
  // application-owned table. All readers are pure — they never mutate the
  // database — and every row field is constructed explicitly (no object
  // spread) so the column mapping is the visible contract.
  // ---------------------------------------------------------------------------

  exportProjectBackup(): ProjectBackup {
    const schemaVersion = this.db.pragma('user_version', { simple: true }) as number;
    if (schemaVersion !== LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Cannot export a project backup: database schema version ${schemaVersion} does not match the supported version ${LATEST_SCHEMA_VERSION}.`,
      );
    }

    const backup: ProjectBackup = {
      format: PROJECT_BACKUP_FORMAT,
      version: PROJECT_BACKUP_VERSION,
      schemaVersion,
      tables: buildProjectBackupTables(this.db),
    };
    return validateProjectBackupDocument(backup);
  }

  /** Validates a project-backup document against the contract without touching the database. */
  validateProjectBackup(backup: unknown): ProjectBackup {
    return validateProjectBackupDocument(backup);
  }

  /**
   * Restores a validated project backup (#146). The active database is never
   * deleted or overwritten in place: rows are inserted into a throwaway
   * same-directory temporary database, validated for row counts and FK
   * integrity, and only then promoted over the active database via a
   * recoverable file swap. `options.hooks` are test-only failure-injection
   * seams; production callers pass no options.
   *
   * A v1/schema-22 document (#219 item-model refactor, wave K) is handled
   * BEFORE the normal v2 validation: `isLegacyProjectBackup` is a cheap
   * classification (format + version only), and `validateLegacyProjectBackup`
   * fully structurally validates it against the frozen v22 schema, rejecting
   * garbage explicitly (always naming it as an older app version — see
   * @lumacast/protocol's deck-bundles.ts). A structurally plausible v1
   * document is migrated by `migrateLegacyProjectBackup` — materialized at
   * schema 22, replayed through the exact tested migrations 23+ code path,
   * and read back out as a current-shape (v2) document — then restored
   * through this same method, recursively, so every safety net below
   * (referential integrity, row-count/FK verification, the recoverable file
   * swap) applies identically whether the source was v1 or v2.
   */
  restoreProjectBackup(backup: ProjectBackup, options: RestoreProjectBackupOptions = {}): ProjectRestoreResult {
    if (isLegacyProjectBackup(backup)) {
      const legacy = validateLegacyProjectBackup(backup);
      const migrated = migrateLegacyProjectBackup(legacy);
      return this.restoreProjectBackup(migrated, options);
    }

    const document = validateProjectBackupDocument(backup);
    assertProjectBackupReferences(document);

    const tempPath = nextUniqueSiblingPath(this.dbPath, 'restore');
    let tempDb: SqliteDatabase | undefined;
    try {
      tempDb = new SqliteDatabase(tempPath);
      this.applyConnectionTuning(tempDb);
      runMigrations(tempDb, tempPath);
      const tempSchemaVersion = tempDb.pragma('user_version', { simple: true }) as number;
      if (tempSchemaVersion !== LATEST_SCHEMA_VERSION) {
        throw new ProjectBackupValidationError(
          `Invalid project backup: temporary database schema version ${tempSchemaVersion} does not match the supported version ${LATEST_SCHEMA_VERSION}.`,
        );
      }
      if (tempSchemaVersion !== document.schemaVersion) {
        throw new ProjectBackupValidationError(
          `Invalid project backup: document schema version ${document.schemaVersion} does not match the restored database schema version ${tempSchemaVersion}.`,
        );
      }

      options.hooks?.beforeInsert?.(tempDb);
      insertProjectBackupRows(tempDb, document);
      options.hooks?.afterInsert?.(tempDb);
      assertProjectBackupRowCounts(tempDb, document);
      assertProjectBackupForeignKeys(tempDb);
      options.hooks?.beforePromotion?.();

      return this.promoteRestoredDatabase(tempDb, tempPath, options.hooks?.afterRetainActive);
    } catch (error) {
      if (tempDb) {
        try {
          tempDb.close();
        } catch {
          // Already closed by a failed promotion; the temporary file is
          // removed below regardless.
        }
      }
      removeSqliteSidecars(tempPath);
      fs.rmSync(tempPath, { force: true });
      throw error;
    }
  }

  /**
   * The recoverable same-filesystem swap: retain the active database under a
   * unique `*.prerecovery-*.sqlite` sibling and move the validated temporary
   * database into the active path.
   */
  private promoteRestoredDatabase(
    tempDb: SqliteDatabase,
    tempPath: string,
    afterRetainActive?: () => void,
  ): ProjectRestoreResult {
    tempDb.pragma('wal_checkpoint(TRUNCATE)');
    tempDb.close();
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();

    const retainedPath = nextUniqueSiblingPath(this.dbPath, 'prerecovery');
    try {
      fs.renameSync(this.dbPath, retainedPath);
      moveSqliteSidecars(this.dbPath, retainedPath);
    } catch (error) {
      this.reopenRepositoryConnection();
      throw error;
    }

    try {
      afterRetainActive?.();
      fs.renameSync(tempPath, this.dbPath);
      moveSqliteSidecars(tempPath, this.dbPath);
    } catch (error) {
      let rollbackError: unknown = null;
      try {
        fs.renameSync(retainedPath, this.dbPath);
        moveSqliteSidecars(retainedPath, this.dbPath);
      } catch (rollbackFailure) {
        rollbackError = rollbackFailure;
      }
      removeSqliteSidecars(tempPath);
      fs.rmSync(tempPath, { force: true });
      this.reopenRepositoryConnection();
      if (rollbackError !== null) {
        throw new Error(
          `Project recovery promotion failed and the previous database could not be moved back; it is retained at ${retainedPath}: ${String(rollbackError)}`,
        );
      }
      throw error;
    }

    removeSqliteSidecars(tempPath);
    this.reopenRepositoryConnection();
    return { snapshot: this.getSnapshot(), retainedDatabasePath: retainedPath };
  }

  private reopenRepositoryConnection(): void {
    this.db = new SqliteDatabase(this.dbPath);
    this.applyConnectionTuning();
    // The promoted database is already at LATEST_SCHEMA_VERSION; running the
    // migrations again is a no-op. Seeding is deliberately skipped so the
    // restored state is reproduced faithfully even if the backup legitimately
    // contains no playlist rows.
    runMigrations(this.db, this.dbPath);
  }
}
