import fs from 'node:fs';
import path from 'node:path';
import {
  cloneDeckBundleManifest,
  collectDeckBundleMediaReferences,
  collectDeckBundlePlaylistItemIds,
  filterDeckBundlePlaylistsToIncludedItems,
  getDeckBundlePlaylistEntryReference,
  PROJECT_BACKUP_FORMAT,
  PROJECT_BACKUP_VERSION,
  ProjectBackupValidationError,
  readElementMediaReference,
  validateDeckBundleManifest,
  validateProjectBackup as validateProjectBackupDocument,
  type ProjectBackupTableKey,
} from '@core/deck-bundles';
import type { ProjectRestoreResult } from '@core/ipc';
import { buildDeckItem } from '@core/deck-items';
import {
  makePlaylistItemReference,
  parsePlaylistItemReference,
  toPlaylistItemOwnerColumns,
  type PlaylistItemOwnerColumns,
  type PlaylistItemReference,
} from '@core/playlist-item-reference';
import { applyThemeToElements, createDefaultThemeElements, syncThemeToElements } from '@core/themes';
import { isThemeCompatibleWithDeckItem, isThemeCompatibleWithOwnerKind } from '@core/theme-capabilities';
import { createId, nowIso } from '@core/utils';
import {
  decodeCuePayloadJson,
  decodeOverlayAnimationJson,
  decodeSlideBackgroundJson,
  decodeSlideElementPayloadJson,
  type CodecContext,
} from '../contracts/codecs';
import { SqliteDatabase } from './sqlite';
import { LATEST_SCHEMA_VERSION, runMigrations } from './migrations';
// Domain primitives (#153): owned by app/core/domain/, imported directly
// rather than through the app/core/types.ts facade.
import type { Id } from '@core/domain/ids';
import type {
  Library,
  LibraryPlaylistBundle,
  Playlist,
  PlaylistEntry,
  PlaylistGroup,
  PlaylistTree,
} from '@core/domain/library';
import type { DeckItem, DeckItemType, Presentation, Lyric, Talk } from '@core/domain/decks';
import type { Slide, SlideKind, SlideBackground, SlideBackgroundSource, TalkScriptBlock } from '@core/domain/slides';
import type { SlideElement, SlideElementPayload, GroupElementPayload } from '@core/domain/slide-elements';
import type { MediaAsset, MediaAssetType } from '@core/domain/media-assets';
import type { Overlay } from '@core/domain/overlays';
import type { Theme, ThemeKind } from '@core/domain/theme';
import type { Stage } from '@core/domain/stages';
import type { Collection, CollectionBinKind, CollectionItemType } from '@core/domain/collections';
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
} from '@core/domain/automation';
// The ProjectBackup family moved to app/contracts/project-backup.ts under
// #215 (parent #116/#153): it is a serialization contract, not a persistence
// DTO, so it lives in the neutral app/contracts/ boundary core, database and
// main all import — see docs/ARCHITECTURE.md for the recorded rationale.
import type {
  ProjectBackup,
  ProjectBackupCollectionRow,
  ProjectBackupCueRow,
  ProjectBackupDeckItemRow,
  ProjectBackupLibraryRow,
  ProjectBackupMacroRow,
  ProjectBackupMacroStepRow,
  ProjectBackupMediaAssetRow,
  ProjectBackupOverlayRow,
  ProjectBackupPlaylistEntryRow,
  ProjectBackupPlaylistGroupRow,
  ProjectBackupPlaylistRow,
  ProjectBackupSlideElementRow,
  ProjectBackupSlideRow,
  ProjectBackupStageRow,
  ProjectBackupTables,
  ProjectBackupTalkScriptBlockRow,
  ProjectBackupThemeRow,
  ProjectBackupTriggerBindingRow,
} from '../contracts/project-backup';
// Everything below has not moved under #153 and remains on the
// app/core/types.ts facade: IPC/application contracts (#154) and the
// deck-bundle wire format.
import type {
  AppSnapshot,
  CueCreateInput,
  CueUpdateInput,
  BrokenDeckBundleReference,
  CollectionAssignmentInput,
  CollectionCreateInput,
  CollectionDeleteInput,
  CollectionRenameInput,
  CollectionReorderInput,
  DeckBundleBrokenReferenceDecision,
  DeckBundleExportOptions,
  DeckBundleInspection,
  DeckBundleInspectionOverlay,
  DeckBundleInspectionPlaylist,
  DeckBundleInspectionStage,
  DeckBundleInspectionTheme,
  DeckBundleItem,
  DeckBundleManifest,
  DeckBundleOverlay,
  DeckBundlePlaylist,
  DeckBundlePlaylistGroup,
  DeckBundleSlide,
  DeckBundleStage,
  DeckBundleTheme,
  ElementCreateInput,
  ElementUpdateInput,
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
} from '@core/types';
import { isBrokenMediaSource, toCastMediaSource } from './media-source-utils';
import type { SnapshotPatch } from '@core/snapshot-patch';

const DEFAULT_W = 1920;
const DEFAULT_H = 1080;

const COLLECTION_BIN_KINDS: readonly CollectionBinKind[] = ['deck', 'image', 'video', 'audio', 'theme', 'overlay', 'stage', 'macro'];

const MEDIA_ASSET_TABLES = ['image_assets', 'video_assets', 'audio_assets'] as const;
type MediaAssetTableName = typeof MEDIA_ASSET_TABLES[number];

const PROJECT_BACKUP_COLLECTION_TABLES = [
  'deck_collections',
  'image_collections',
  'video_collections',
  'audio_collections',
  'theme_collections',
  'overlay_collections',
  'stage_collections',
  'macro_collections',
] as const;
type ProjectBackupCollectionTableName = typeof PROJECT_BACKUP_COLLECTION_TABLES[number];

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
  macro: 'macro_collections',
};

const DEFAULT_COLLECTION_NAME = 'Default Collection';

// ---------------------------------------------------------------------------
// Project recovery (#146): restore + promotion.
//
// `restoreProjectBackup` restores a validated `ProjectBackup` into a
// throwaway same-directory database, validates the restored state, and only
// then promotes it over the active database via a recoverable file swap. The
// active database is never deleted or overwritten in place: it is first
// renamed to a timestamped `*.prerecovery-*.sqlite` sibling that is retained
// forever (never deleted by the app), and the swap is rolled back if any step
// after the retain fails. The hooks below are the test-only failure-injection
// seams for this API; production callers pass no hooks, so there is no
// production-global state involved.
// ---------------------------------------------------------------------------

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

const PROJECT_BACKUP_DECK_ITEM_TABLES = ['presentations', 'lyrics', 'talks'] as const;

const PROJECT_BACKUP_MEDIA_ASSET_TABLES = MEDIA_ASSET_TABLES;

const PROJECT_BACKUP_TABLE_KEYS = [
  'libraries',
  'presentations',
  'lyrics',
  'talks',
  'slides',
  'slide_elements',
  'talk_script_blocks',
  'playlists',
  'playlist_groups',
  'playlist_entries',
  'image_assets',
  'video_assets',
  'audio_assets',
  'overlays',
  'themes',
  'stages',
  'cues',
  'actions',
  'action_steps',
  'trigger_bindings',
  'deck_collections',
  'image_collections',
  'video_collections',
  'audio_collections',
  'theme_collections',
  'overlay_collections',
  'stage_collections',
  'macro_collections',
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
 * Validates every cross-table reference the v22 schema (or the application's
 * invariants) requires, entirely over the backup document before any
 * database work: each non-null FK column must name an id present in the
 * backup's parent table, and the schema-soft references
 * (`actions.collection_id`, `trigger_bindings` targets) are required too,
 * because the exporter's own operations can never produce a dangling one.
 * Throws `ProjectBackupValidationError` on the first broken reference.
 */
function assertProjectBackupReferences(backup: ProjectBackup): void {
  const t = backup.tables;
  const ids = {
    libraries: collectProjectBackupIds(t.libraries),
    presentations: collectProjectBackupIds(t.presentations),
    lyrics: collectProjectBackupIds(t.lyrics),
    talks: collectProjectBackupIds(t.talks),
    slides: collectProjectBackupIds(t.slides),
    slide_elements: collectProjectBackupIds(t.slide_elements),
    playlists: collectProjectBackupIds(t.playlists),
    playlist_groups: collectProjectBackupIds(t.playlist_groups),
    themes: collectProjectBackupIds(t.themes),
    overlays: collectProjectBackupIds(t.overlays),
    stages: collectProjectBackupIds(t.stages),
    cues: collectProjectBackupIds(t.cues),
    actions: collectProjectBackupIds(t.actions),
    deck_collections: collectProjectBackupIds(t.deck_collections),
    image_collections: collectProjectBackupIds(t.image_collections),
    video_collections: collectProjectBackupIds(t.video_collections),
    audio_collections: collectProjectBackupIds(t.audio_collections),
    theme_collections: collectProjectBackupIds(t.theme_collections),
    overlay_collections: collectProjectBackupIds(t.overlay_collections),
    stage_collections: collectProjectBackupIds(t.stage_collections),
    macro_collections: collectProjectBackupIds(t.macro_collections),
  };

  for (const row of t.presentations) {
    assertProjectBackupReference(ids.themes, 'presentations', 'theme_id', row.id, row.theme_id);
    assertProjectBackupReference(ids.deck_collections, 'presentations', 'collection_id', row.id, row.collection_id);
  }
  for (const row of t.lyrics) {
    assertProjectBackupReference(ids.themes, 'lyrics', 'theme_id', row.id, row.theme_id);
    assertProjectBackupReference(ids.deck_collections, 'lyrics', 'collection_id', row.id, row.collection_id);
  }
  for (const row of t.talks) {
    assertProjectBackupReference(ids.themes, 'talks', 'theme_id', row.id, row.theme_id);
    assertProjectBackupReference(ids.deck_collections, 'talks', 'collection_id', row.id, row.collection_id);
  }
  for (const row of t.slides) {
    assertProjectBackupReference(ids.presentations, 'slides', 'presentation_id', row.id, row.presentation_id);
    assertProjectBackupReference(ids.lyrics, 'slides', 'lyric_id', row.id, row.lyric_id);
    assertProjectBackupReference(ids.talks, 'slides', 'talk_id', row.id, row.talk_id);
    assertProjectBackupReference(ids.themes, 'slides', 'theme_id', row.id, row.theme_id);
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
  for (const row of t.playlists) {
    assertProjectBackupReference(ids.libraries, 'playlists', 'library_id', row.id, row.library_id);
  }
  for (const row of t.playlist_groups) {
    assertProjectBackupReference(ids.playlists, 'playlist_groups', 'playlist_id', row.id, row.playlist_id);
  }
  for (const row of t.playlist_entries) {
    assertProjectBackupReference(ids.playlist_groups, 'playlist_entries', 'group_id', row.id, row.group_id);
    assertProjectBackupReference(ids.presentations, 'playlist_entries', 'presentation_id', row.id, row.presentation_id);
    assertProjectBackupReference(ids.lyrics, 'playlist_entries', 'lyric_id', row.id, row.lyric_id);
    assertProjectBackupReference(ids.talks, 'playlist_entries', 'talk_id', row.id, row.talk_id);
  }
  for (const table of PROJECT_BACKUP_MEDIA_ASSET_TABLES) {
    for (const row of t[table]) {
      assertProjectBackupReference(ids[`${table.split('_')[0]}_collections` as keyof typeof ids], table, 'collection_id', row.id, row.collection_id);
    }
  }
  for (const row of t.themes) {
    assertProjectBackupReference(ids.theme_collections, 'themes', 'collection_id', row.id, row.collection_id);
  }
  for (const row of t.overlays) {
    assertProjectBackupReference(ids.overlay_collections, 'overlays', 'collection_id', row.id, row.collection_id);
  }
  for (const row of t.stages) {
    assertProjectBackupReference(ids.stage_collections, 'stages', 'collection_id', row.id, row.collection_id);
  }
  for (const row of t.actions) {
    assertProjectBackupReference(ids.macro_collections, 'actions', 'collection_id', row.id, row.collection_id);
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
 * Inserts every row of the backup into `db` in FK-safe parent-before-child
 * order, with every column mapped explicitly (no object spread at the
 * restore boundary). Runs in one transaction so a mid-insert failure leaves
 * the temporary database empty. The transaction starts by emptying every
 * application-owned table, because migrations seed default collection rows
 * when they run against a fresh file; the backup is the complete truth, so
 * the temporary database must end with exactly the backup's rows. The clear
 * and the insert are one atomic unit: a failure in either leaves the
 * temporary database empty.
 */
function insertProjectBackupRows(db: SqliteDatabase, backup: ProjectBackup): void {
  const t = backup.tables;

  const tx = db.transaction(() => {
    clearProjectBackupTables(db);
    const insertCollection = (tableName: string): void => {
      const insert = db.prepare(
        `INSERT INTO ${tableName} (id, name, order_index, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const row of t[tableName as keyof ProjectBackupTables]) {
        const collectionRow = row as unknown as ProjectBackupCollectionRow;
        insert.run(collectionRow.id, collectionRow.name, collectionRow.order_index, collectionRow.is_default, collectionRow.created_at, collectionRow.updated_at);
      }
    };
    for (const tableName of PROJECT_BACKUP_COLLECTION_TABLES) insertCollection(tableName);

    const insertLibrary = db.prepare(
      'INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    for (const row of t.libraries) {
      insertLibrary.run(row.id, row.name, row.order_index, row.created_at, row.updated_at);
    }

    const insertTheme = db.prepare(
      `INSERT INTO themes (id, name, kind, width, height, order_index, collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.themes) {
      insertTheme.run(row.id, row.name, row.kind, row.width, row.height, row.order_index, row.collection_id, row.created_at, row.updated_at);
    }

    const insertOverlay = db.prepare(
      `INSERT INTO overlays (id, name, enabled, animation_json, collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.overlays) {
      insertOverlay.run(row.id, row.name, row.enabled, row.animation_json, row.collection_id, row.created_at, row.updated_at);
    }

    const insertStage = db.prepare(
      `INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.stages) {
      insertStage.run(row.id, row.name, row.width, row.height, row.order_index, row.collection_id, row.created_at, row.updated_at);
    }

    for (const tableName of PROJECT_BACKUP_DECK_ITEM_TABLES) {
      const insertDeckItem = db.prepare(
        `INSERT INTO ${tableName} (id, title, theme_id, collection_id, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of t[tableName]) {
        insertDeckItem.run(row.id, row.title, row.theme_id, row.collection_id, row.order_index, row.created_at, row.updated_at);
      }
    }

    const insertCue = db.prepare(
      `INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.cues) {
      insertCue.run(row.id, row.kind, row.payload_json, row.failure_policy, row.created_at, row.updated_at);
    }

    const insertMacro = db.prepare(
      `INSERT INTO actions (id, name, description, collection_id, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.actions) {
      insertMacro.run(row.id, row.name, row.description, row.collection_id, row.scope_level, row.on_scope_exit, row.loop_enabled, row.loop_count, row.created_at, row.updated_at);
    }

    const insertSlide = db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.slides) {
      insertSlide.run(
        row.id,
        row.presentation_id,
        row.lyric_id,
        row.talk_id,
        row.theme_id,
        row.overlay_id,
        row.stage_id,
        row.kind,
        row.width,
        row.height,
        row.notes,
        row.background_json,
        row.background_source,
        row.order_index,
        row.created_at,
        row.updated_at,
      );
    }

    const insertSlideElement = db.prepare(
      `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.slide_elements) {
      insertSlideElement.run(
        row.id,
        row.slide_id,
        row.type,
        row.x,
        row.y,
        row.width,
        row.height,
        row.rotation,
        row.opacity,
        row.z_index,
        row.layer,
        row.payload_json,
        row.source_theme_element_id,
        row.created_at,
        row.updated_at,
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
        `INSERT INTO ${tableName} (id, name, src, collection_id, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of t[tableName]) {
        insertMediaAsset.run(row.id, row.name, row.src, row.collection_id, row.order_index, row.created_at, row.updated_at);
      }
    }

    const insertPlaylist = db.prepare(
      'INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.playlists) {
      insertPlaylist.run(row.id, row.library_id, row.name, row.order_index, row.created_at, row.updated_at);
    }

    const insertPlaylistGroup = db.prepare(
      'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const row of t.playlist_groups) {
      insertPlaylistGroup.run(row.id, row.playlist_id, row.name, row.color_key, row.order_index, row.created_at, row.updated_at);
    }

    const insertPlaylistEntry = db.prepare(
      `INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.playlist_entries) {
      insertPlaylistEntry.run(
        row.id,
        row.group_id,
        row.presentation_id,
        row.lyric_id,
        row.talk_id,
        row.order_index,
        row.created_at,
        row.updated_at,
      );
    }

    const insertMacroStep = db.prepare(
      `INSERT INTO action_steps (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.action_steps) {
      insertMacroStep.run(
        row.id,
        row.action_id,
        row.kind,
        row.payload_json,
        row.failure_policy,
        row.cue_id,
        row.order_index,
        row.delay_before_ms,
        row.delay_after_ms,
        row.created_at,
        row.updated_at,
      );
    }

    const insertTriggerBinding = db.prepare(
      `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of t.trigger_bindings) {
      insertTriggerBinding.run(
        row.id,
        row.trigger_type,
        row.source_id,
        row.target_type,
        row.target_id,
        row.config_json,
        row.enabled,
        row.created_at,
        row.updated_at,
      );
    }
  });
  tx();
}

/**
 * Completeness gate before promotion: every application-owned table in the
 * temporary database must hold exactly the number of rows the backup
 * declares. A silent partial insert can never slip past this check.
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
 * zero violations on the temporary database. Every FK column was already
 * validated over the document, so this is defense in depth against insertion
 * drift (and is independently exercised by the recovery tests).
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

/**
 * Every bin must carry exactly one default collection, matching the invariant
 * migrations and the repository enforce (defaults can never be deleted and
 * the app's create flows depend on them). A backup that lacks or duplicates
 * them cannot be the basis of a functioning project, so it is rejected
 * before any database work.
 */
function assertProjectBackupDefaultCollections(backup: ProjectBackup): void {
  for (const tableName of PROJECT_BACKUP_COLLECTION_TABLES) {
    const defaults = (backup.tables[tableName] as ProjectBackupCollectionRow[]).filter((row) => row.is_default === 1);
    if (defaults.length !== 1) {
      throw new ProjectBackupValidationError(
        `Invalid project backup: ${tableName} must contain exactly one default collection, found ${defaults.length}.`,
      );
    }
  }
}

/**
 * Every bin must carry exactly one default collection after a snapshot
 * restore, mirroring the invariant `assertProjectBackupDefaultCollections`
 * enforces for project backups (#146). `AppSnapshot.collections` is normally
 * produced by `getCollections()` off a database that already holds this
 * invariant, but restore is the one seam where a corrupted or hand-built
 * snapshot could otherwise silently leave a live database with two defaults
 * or none, so it is checked before any table is touched.
 */
function assertSnapshotCollectionDefaults(collections: readonly Collection[]): void {
  for (const bin of COLLECTION_BIN_KINDS) {
    const defaults = collections.filter((collection) => collection.binKind === bin && collection.isDefault);
    if (defaults.length !== 1) {
      throw new Error(
        `Invalid snapshot: bin "${bin}" must contain exactly one default collection, found ${defaults.length}.`,
      );
    }
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

/**
 * Empties every application-owned table of the (throwaway) temporary
 * database. Needed because migrations seed default collection rows when they
 * run against a fresh file; the backup is the complete truth, so the
 * temporary database must start with zero application rows and end with
 * exactly the backup's rows. Deletes run in child-before-parent order. Called
 * as the first statement of `insertProjectBackupRows`' transaction, so the
 * clear and the inserts are one atomic unit.
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

// Media assets live in three split tables (image_assets/video_assets/audio_assets),
// so they're resolved dynamically per id — see resolveItemTable below. Every
// other item type maps statically.
type StaticCollectionItemType = Exclude<CollectionItemType, 'media_asset'>;
const ITEM_TABLE_BY_TYPE: Record<StaticCollectionItemType, string> = {
  presentation: 'presentations',
  lyric: 'lyrics',
  talk: 'talks',
  theme: 'themes',
  overlay: 'overlays',
  stage: 'stages',
  macro: 'actions',
};

function isItemTypeAllowedInBin(
  itemType: CollectionItemType,
  binKind: CollectionBinKind,
  itemId: Id,
  store: CastRepository,
): boolean {
  if (itemType === 'presentation' || itemType === 'lyric' || itemType === 'talk') return binKind === 'deck';
  if (itemType === 'theme') return binKind === 'theme';
  if (itemType === 'overlay') return binKind === 'overlay';
  if (itemType === 'stage') return binKind === 'stage';
  if (itemType === 'macro') return binKind === 'macro';
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
  upsertTalkIds?: Id[];
  upsertMediaAssetIds?: Id[];
  upsertThemeIds?: Id[];
  upsertOverlayIds?: Id[];
  upsertStageIds?: Id[];
  upsertMacroIds?: Id[];
} {
  switch (itemType) {
    case 'presentation': return { upsertPresentationIds: [itemId] };
    case 'lyric': return { upsertLyricIds: [itemId] };
    case 'talk': return { upsertTalkIds: [itemId] };
    case 'media_asset': return { upsertMediaAssetIds: [itemId] };
    case 'theme': return { upsertThemeIds: [itemId] };
    case 'overlay': return { upsertOverlayIds: [itemId] };
    case 'stage': return { upsertStageIds: [itemId] };
    case 'macro': return { upsertMacroIds: [itemId] };
  }
}

/**
 * Error codes for the authoritative `deleteCollection` operation (#112).
 * `protected-default` — the target collection is the bin's default and can
 * never be deleted. `default-collection-missing` — the bin has no default
 * collection to reassign members onto; this must be checked, and thrown,
 * before any write happens so a data-integrity gap never leaves a
 * half-migrated collection.
 */
export type CollectionDeletionErrorCode = 'protected-default' | 'default-collection-missing';

export class CollectionDeletionError extends Error {
  readonly code: CollectionDeletionErrorCode;
  readonly binKind: CollectionBinKind;
  readonly collectionId: Id;

  constructor(code: CollectionDeletionErrorCode, binKind: CollectionBinKind, collectionId: Id, message: string) {
    super(message);
    this.name = 'CollectionDeletionError';
    this.code = code;
    this.binKind = binKind;
    this.collectionId = collectionId;
  }
}

/**
 * Thrown by `duplicateDeckItem` (#103) before any write when the source
 * owner's type does not support whole-deck duplication. Talk duplication is
 * an explicit non-goal: this is a typed, checked-before-writes error rather
 * than a partial copy or a generic `Error`, mirroring `CollectionDeletionError`.
 */
export type DeckItemDuplicationErrorCode = 'unsupported-owner-type';

export class DeckItemDuplicationError extends Error {
  readonly code: DeckItemDuplicationErrorCode;
  readonly itemId: Id;

  constructor(code: DeckItemDuplicationErrorCode, itemId: Id, message: string) {
    super(message);
    this.name = 'DeckItemDuplicationError';
    this.code = code;
    this.itemId = itemId;
  }
}

/**
 * Compile-time exhaustiveness guard for `CollectionBinKind`. If a new bin
 * kind is ever added to the union without adding a matching case to
 * `reassignItemsForCollection`'s switch, `binKind` stops being `never` here
 * and the file fails to compile — mirroring the `assertNeverPlaylistItemReferenceType`
 * pattern in `@core/playlist-item-reference`.
 */
function assertNeverCollectionBinKind(binKind: never): never {
  throw new Error(`Unsupported collection bin kind: ${String(binKind)}`);
}

interface CollectionMemberMoveResult {
  presentations: Id[];
  lyrics: Id[];
  talks: Id[];
  mediaAssets: Id[];
  themes: Id[];
  overlays: Id[];
  stages: Id[];
  macros: Id[];
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

/** Builds the codec context for a persisted JSON column read. */
const persistedContext = (operation: string, path: string): CodecContext => ({
  boundary: 'persisted',
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















  private hasColumn(tableName: string, columnName: string): boolean {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === columnName);
  }



  private hasTable(name: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) as { name: string } | undefined;

    return row?.name === name;
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
      if (this.hasTable('actions') && this.hasColumn('actions', 'collection_id')) {
        this.db
          .prepare("UPDATE actions SET collection_id = ? WHERE collection_id IS NULL OR collection_id = ''")
          .run(defaultIds.macro);
      }
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

  private assertCollectionNameAvailable(binKind: CollectionBinKind, name: string, excludeId?: Id): void {
    const table = COLLECTION_TABLE_BY_BIN[binKind];
    const existing = this.db.prepare(
      `SELECT id FROM ${table} WHERE lower(trim(name)) = lower(trim(?)) ${excludeId ? 'AND id != ?' : ''} LIMIT 1`,
    ).get(...(excludeId ? [name, excludeId] : [name])) as { id: string } | undefined;
    if (existing) {
      throw new Error(`A collection named "${name.trim()}" already exists.`);
    }
  }

  createCollection(input: CollectionCreateInput): SnapshotPatch {
    const table = COLLECTION_TABLE_BY_BIN[input.binKind];
    this.assertCollectionNameAvailable(input.binKind, input.name);
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
    if (!existing) {
      throw new Error(`Collection not found: ${input.id}`);
    }
    if (existing.is_default === 1) {
      throw new Error('Default collection cannot be renamed');
    }
    this.assertCollectionNameAvailable(input.binKind, input.name, input.id);
    this.db
      .prepare(`UPDATE ${table} SET name = ?, updated_at = ? WHERE id = ?`)
      .run(input.name, nowIso(), input.id);
    return this.buildPatch({ upsertCollectionIds: [input.id] });
  }

  /**
   * The single authoritative operation for deleting a bin collection (#112).
   * Exhaustive over every `CollectionBinKind` (including `macro`), validates
   * existence/protected-status/fallback-availability before any write, then
   * reassigns every member to the bin's default collection, deletes the now
   * empty collection, and compacts ordering — all inside one transaction so
   * a failure at any step restores the parent row, member ownership, and
   * ordering exactly as they were.
   *
   * This schema has no separate collection-membership join table: each
   * member row (`presentations`, `image_assets`, `actions`, …) carries its
   * own `collection_id` foreign key directly, enforced by `PRAGMA
   * foreign_keys = ON`. "Delete referencing membership rows" therefore means
   * reassigning those FK columns off the doomed collection before deleting
   * it, not deleting separate rows.
   */
  deleteCollection(input: CollectionDeleteInput): SnapshotPatch {
    const table = COLLECTION_TABLE_BY_BIN[input.binKind];
    const existing = this.db.prepare(`SELECT id, is_default FROM ${table} WHERE id = ?`).get(input.id) as
      | { id: string; is_default: number }
      | undefined;
    // NOT converted to a throw under #214 group 1, unlike the identical
    // guard in renameCollection: delete-collection.test.ts (#112, an
    // existing test file outside this change's write boundary) pins
    // "is a no-op for an id that does not exist" as the contract for this
    // exact branch. Revisit alongside that test in a follow-up.
    if (!existing) return this.buildPatch({});
    if (existing.is_default === 1) {
      throw new CollectionDeletionError(
        'protected-default',
        input.binKind,
        input.id,
        'Default collection cannot be deleted',
      );
    }

    // Validate fallback availability before any write: a missing default
    // must abort the whole operation, never self-heal mid-delete.
    const defaultId = this.findDefaultCollectionId(input.binKind);
    if (!defaultId) {
      throw new CollectionDeletionError(
        'default-collection-missing',
        input.binKind,
        input.id,
        `No default collection exists for bin: ${input.binKind}`,
      );
    }

    const tx = this.db.transaction((): { moved: CollectionMemberMoveResult; reorderedCollectionIds: Id[] } => {
      const moved = this.reassignItemsForCollection(input.binKind, input.id, defaultId);
      this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(input.id);
      const reorderedCollectionIds = this.compactCollectionOrdering(input.binKind);
      return { moved, reorderedCollectionIds };
    });
    const { moved, reorderedCollectionIds } = tx();

    return this.buildPatch({
      deletedCollectionIds: [input.id],
      upsertPresentationIds: moved.presentations,
      upsertLyricIds: moved.lyrics,
      upsertTalkIds: moved.talks,
      upsertMediaAssetIds: moved.mediaAssets,
      upsertThemeIds: moved.themes,
      upsertOverlayIds: moved.overlays,
      upsertStageIds: moved.stages,
      upsertMacroIds: moved.macros,
      upsertCollectionIds: reorderedCollectionIds,
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
    const itemTable = this.resolveItemTable(input.itemType, input.itemId);
    if (!itemTable) return this.buildPatch({});

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

  // Resolves the SQL table that holds a given collection item. Returns null
  // when the item is missing, matching the previous "missing item → empty
  // patch" behaviour. Media assets are spread across image/video/audio
  // tables since the v11 schema split, so we probe each one until we find
  // it; everything else maps statically.
  private resolveItemTable(itemType: CollectionItemType, itemId: Id): string | null {
    if (itemType === 'media_asset') {
      for (const table of MEDIA_ASSET_TABLES) {
        const row = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(itemId) as
          | { id: string }
          | undefined;
        if (row) return table;
      }
      return null;
    }
    const table = ITEM_TABLE_BY_TYPE[itemType];
    const row = this.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(itemId) as
      | { id: string }
      | undefined;
    return row ? table : null;
  }

  private reassignItemsForCollection(
    binKind: CollectionBinKind,
    fromCollectionId: Id,
    toCollectionId: Id,
  ): CollectionMemberMoveResult {
    const moved: CollectionMemberMoveResult = {
      presentations: [],
      lyrics: [],
      talks: [],
      mediaAssets: [],
      themes: [],
      overlays: [],
      stages: [],
      macros: [],
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
        if (this.hasTable('talks')) reassign('talks', moved.talks);
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
      case 'macro':
        reassign('actions', moved.macros);
        break;
      default:
        return assertNeverCollectionBinKind(binKind);
    }

    return moved;
  }

  /**
   * Finds the bin's default collection id without ever creating one.
   * Unlike `getDefaultCollectionId` (used by every content-creation path,
   * which self-heals by reseeding a missing default so authoring never
   * breaks), collection deletion must abort — before any write — if the
   * default is missing rather than silently minting a fresh one mid-delete.
   */
  private findDefaultCollectionId(binKind: CollectionBinKind): Id | null {
    const table = COLLECTION_TABLE_BY_BIN[binKind];
    const row = this.db
      .prepare(`SELECT id FROM ${table} WHERE is_default = 1 ORDER BY created_at ASC LIMIT 1`)
      .get() as { id: string } | undefined;
    return row ? row.id : null;
  }

  /**
   * Re-sequences `order_index` for every remaining collection in a bin to a
   * contiguous 0..n-1 range (preserving relative order), closing the gap
   * left by a deleted collection. Returns only the ids whose order actually
   * changed, so callers can report a precise patch.
   */
  private compactCollectionOrdering(binKind: CollectionBinKind): Id[] {
    const table = COLLECTION_TABLE_BY_BIN[binKind];
    const rows = this.db
      .prepare(`SELECT id, order_index FROM ${table} ORDER BY order_index ASC, created_at ASC`)
      .all() as Array<{ id: string; order_index: number }>;
    const now = nowIso();
    const changedIds: Id[] = [];
    rows.forEach((row, index) => {
      if (row.order_index !== index) {
        this.db.prepare(`UPDATE ${table} SET order_index = ?, updated_at = ? WHERE id = ?`).run(index, now, row.id);
        changedIds.push(row.id);
      }
    });
    return changedIds;
  }





  private seedIfEmpty(): void {
    const count = this.db.prepare('SELECT COUNT(*) AS count FROM libraries').get() as { count: number };
    if (count.count > 0) return;

    const libraryId = createId();
    const presentationId = createId();
    const slideId = createId();
    const playlistId = createId();
    const groupId = createId();
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
        .prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(playlistId, libraryId, 'Sunday Service', 0, now, now);

      this.db
        .prepare(
          'INSERT INTO playlist_groups (id, playlist_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(groupId, playlistId, 'Opening', 0, now, now);

      const welcomeEntryOwner = toPlaylistItemOwnerColumns(makePlaylistItemReference('presentation', presentationId));
      this.db
        .prepare(
          'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(createId(), groupId, welcomeEntryOwner.presentationId, welcomeEntryOwner.lyricId, welcomeEntryOwner.talkId, 0, now, now);

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
    const libraries = this.getLibraries();
    const presentations = this.getPresentations();
    const lyrics = this.getLyrics();
    const talks = this.getTalks();
    const itemsById = new Map<Id, DeckItem>([
      ...presentations.map((deck) => [deck.id, deck] as const),
      ...lyrics.map((lyric) => [lyric.id, lyric] as const),
      ...talks.map((talk) => [talk.id, talk] as const),
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
      talks,
      slides: this.getSlides(),
      talkScriptBlocks: this.getTalkScriptBlocks(),
      slideElements: this.getSlideElements(),
      mediaAssets: this.getMediaAssets(),
      overlays: this.getOverlays(),
      themes: this.getThemes(),
      stages: this.getStages(),
      collections: this.getCollections(),
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
      `SELECT id, name, description, collection_id, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at
       FROM actions ORDER BY updated_at DESC, created_at DESC, id ASC`
    ).all() as Array<{
      id: string;
      name: string;
      description: string;
      collection_id: string;
      scope_level: string;
      on_scope_exit: string;
      loop_enabled: number;
      loop_count: number | null;
      created_at: string;
      updated_at: string;
    }>;

    const cuesByMacroId = this.getMacroCuesByMacroIds(rows.map((row) => row.id));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      collectionId: row.collection_id,
      cues: cuesByMacroId.get(row.id) ?? [],
      scopeLevel: row.scope_level as ScopeLevel,
      onScopeExit: row.on_scope_exit as OnScopeExit,
      loopEnabled: row.loop_enabled === 1,
      loopCount: row.loop_count,
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
    const collectionId = input.collectionId ?? this.getDefaultCollectionId('macro');
    const scopeLevel: ScopeLevel = input.scopeLevel ?? 'global';
    const onScopeExit: OnScopeExit = input.onScopeExit ?? 'cancel';
    const loopEnabled = input.loopEnabled ? 1 : 0;
    const loopCount = normalizeLoopCount(input.loopCount);

    const insertMacro = this.db.prepare(
      `INSERT INTO actions
       (id, name, description, collection_id, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMacroCue = this.db.prepare(
      `INSERT INTO action_steps
       (id, action_id, cue_id, kind, order_index, payload_json, failure_policy, delay_before_ms, delay_after_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = this.db.transaction(() => {
      insertMacro.run(macroId, name, description, collectionId, scopeLevel, onScopeExit, loopEnabled, loopCount, now, now);
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
    if (!existing) return this.buildPatch({});

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
    const orphanedBindingIds = (this.db.prepare(
      "SELECT id FROM trigger_bindings WHERE target_type = 'macro' AND target_id = ?"
    ).all(id) as Array<{ id: string }>).map((row) => row.id);

    this.db.prepare('DELETE FROM actions WHERE id = ?').run(id);
    this.db.prepare('DELETE FROM action_steps WHERE action_id = ?').run(id);
    this.db.prepare("DELETE FROM trigger_bindings WHERE target_type = 'macro' AND target_id = ?").run(id);
    return this.buildPatch({
      deletedMacroIds: [id],
      deletedTriggerBindingIds: orphanedBindingIds,
    });
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
   *
   * Collection identity is snapshot-authoritative (#208): the eight
   * `*_collections` tables are cleared and re-seeded from `snapshot.collections`
   * exactly like every other table, rather than left holding whatever the
   * destination database had self-seeded. This matters even on the database
   * that produced the snapshot — `deleteCollection` performs a real `DELETE`
   * on the collection row, so undoing across a collection deletion needs the
   * deleted collection's row back, not just its default-bin siblings. Every
   * table whose rows carry a `collection_id` (themes, presentations, lyrics,
   * talks, media assets, overlays, stages, actions) is deleted before the
   * collection tables and re-inserted after them, so a collection row always
   * exists before anything can reference it — the same parent-before-child /
   * child-before-parent discipline `clearProjectBackupTables` and
   * `insertProjectBackupRows` use for the project-backup restore path.
   * `assertSnapshotCollectionDefaults` fails fast, before any table is
   * touched, if the snapshot doesn't carry exactly one default per bin.
   */
  restoreFromSnapshot(snapshot: AppSnapshot): AppSnapshot {
    assertSnapshotCollectionDefaults(snapshot.collections);
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM trigger_bindings;
        DELETE FROM action_steps;
        DELETE FROM actions;
        DELETE FROM cues;
        DELETE FROM playlist_entries;
        DELETE FROM talk_script_blocks;
        DELETE FROM slide_elements;
        DELETE FROM slides;
        DELETE FROM overlays;
        DELETE FROM themes;
        DELETE FROM stages;
        DELETE FROM playlist_groups;
        DELETE FROM playlists;
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

      // Collections must exist before anything below can reference them via
      // `collection_id` (themes, presentations/lyrics/talks, media assets,
      // overlays, stages, actions all insert after this loop).
      for (const bin of COLLECTION_BIN_KINDS) {
        const table = COLLECTION_TABLE_BY_BIN[bin];
        const insertCollection = this.db.prepare(
          `INSERT INTO ${table} (id, name, order_index, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const collection of snapshot.collections) {
          if (collection.binKind !== bin) continue;
          insertCollection.run(
            collection.id,
            collection.name,
            collection.order,
            collection.isDefault ? 1 : 0,
            collection.createdAt,
            collection.updatedAt,
          );
        }
      }

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

      const insertTalk = this.db.prepare(
        'INSERT INTO talks (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const talk of snapshot.talks) {
        insertTalk.run(
          talk.id,
          talk.title,
          talk.themeId ?? null,
          talk.collectionId,
          talk.order,
          talk.createdAt,
          talk.updatedAt,
        );
      }

      const insertSlide = this.db.prepare(
        `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const slide of snapshot.slides) {
        const backgroundJson = slide.background ? JSON.stringify(slide.background) : null;
        const backgroundSource = slide.backgroundSource ?? 'local';
        insertSlide.run(
          slide.id,
          slide.presentationId,
          slide.lyricId,
          slide.talkId,
          slide.themeId ?? null,
          slide.overlayId ?? null,
          slide.stageId ?? null,
          slide.kind ?? (slide.lyricId ? 'lyric' : slide.talkId ? 'talk' : 'presentation'),
          slide.width,
          slide.height,
          slide.notes,
          backgroundJson,
          backgroundSource,
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
        insertTalkScriptBlock.run(
          block.id,
          block.slideId,
          block.text,
          block.order,
          block.createdAt,
          block.updatedAt,
        );
      }

      const insertSlideElement = this.db.prepare(
        `INSERT INTO slide_elements
          (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      // `snapshot.slideElements` (from `getSlideElements()`) is scoped to
      // deck content slides, matching `snapshot.slides` (from `getSlides()`)
      // exactly (#211) -- it no longer carries theme/overlay/stage container
      // elements. Those are restored separately below via
      // `replaceContainerElements` (theme/overlay/stage loops, keyed off
      // each container's own `elements` field), which both recreates their
      // container slide first and reuses the same element ids; inserting
      // them again here would either violate the `slide_id` foreign key
      // (their container slide hasn't been created yet at this point in the
      // transaction) or duplicate a primary key (once it has). No extra
      // filtering is needed here any more -- the getter's own scope keeps
      // this loop to deck content elements (previously #208).
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
        'INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertGroup = this.db.prepare(
        'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertEntry = this.db.prepare(
        'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
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
          for (const { group, entries } of tree.groups) {
            insertGroup.run(
              group.id,
              group.playlistId,
              group.name,
              group.colorKey,
              group.order,
              group.createdAt,
              group.updatedAt,
            );
            for (const { entry } of entries) {
              const reference = this.resolvePlaylistEntryReference(entry);
              const owner = toPlaylistItemOwnerColumns(reference);
              insertEntry.run(
                entry.id,
                entry.groupId,
                owner.presentationId,
                owner.lyricId,
                owner.talkId,
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

      const insertCue = this.db.prepare(
        `INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const cue of snapshot.cues) {
        insertCue.run(
          cue.id,
          cue.kind,
          JSON.stringify(cue.payload),
          cue.failurePolicy,
          cue.createdAt,
          cue.updatedAt,
        );
      }

      const insertMacro = this.db.prepare(
        'INSERT INTO actions (id, name, description, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertMacroStep = this.db.prepare(
        `INSERT INTO action_steps
         (id, action_id, cue_id, kind, order_index, payload_json, failure_policy, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const macro of snapshot.macros) {
        insertMacro.run(
          macro.id,
          macro.name,
          macro.description,
          macro.collectionId,
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
            step.createdAt,
            step.updatedAt,
          );
        }
      }

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

  exportDeckBundle(itemIds: Id[], options: DeckBundleExportOptions = {}): DeckBundleManifest {
    const playlistIds = Array.from(new Set(options.playlistIds ?? []));
    const playlists = playlistIds
      .map((playlistId) => this.getDeckBundlePlaylistById(playlistId))
      .filter((playlist): playlist is DeckBundlePlaylist => playlist !== null)
      .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));

    const playlistItemIds = collectDeckBundlePlaylistItemIds(playlists);

    const uniqueIds = Array.from(new Set([...itemIds, ...playlistItemIds]));
    const items = uniqueIds
      .map((itemId) => this.getDeckBundleItemById(itemId))
      .filter((item): item is DeckBundleItem => item !== null)
      .sort((left, right) => left.order - right.order || left.title.localeCompare(right.title));

    const includedItemIds = new Set(items.map((item) => item.id));
    const filteredPlaylists: DeckBundlePlaylist[] = filterDeckBundlePlaylistsToIncludedItems(playlists, includedItemIds);

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
      playlists: filteredPlaylists,
      mediaReferences: collectDeckBundleMediaReferences(items, themes, overlays, stages),
    };
  }

  inspectImportBundle(manifest: DeckBundleManifest): DeckBundleInspection {
    this.assertValidDeckBundleManifest(manifest, 'inspectImportBundle');
    const normalizedManifest = cloneDeckBundleManifest(manifest);
    const overlays = normalizedManifest.overlays ?? [];
    const stages = normalizedManifest.stages ?? [];
    const playlists = normalizedManifest.playlists ?? [];
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
      playlists: playlists
        .map((playlist): DeckBundleInspectionPlaylist => ({
          id: playlist.id,
          name: playlist.name,
          libraryName: playlist.libraryName,
          groupCount: playlist.groups.length,
          entryCount: playlist.groups.reduce((sum, group) => sum + group.entries.length, 0),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      mediaReferences,
      brokenReferences,
    };
  }

  finalizeImportBundle(manifest: DeckBundleManifest, decisions: DeckBundleBrokenReferenceDecision[]): AppSnapshot {
    this.assertValidDeckBundleManifest(manifest, 'finalizeImportBundle');
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
    const insertTalk = this.db.prepare(
      'INSERT INTO talks (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertSlide = this.db.prepare(
      `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertTalkScriptBlock = this.db.prepare(
      'INSERT INTO talk_script_blocks (id, slide_id, text, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertElement = this.db.prepare(
      `INSERT INTO slide_elements
        (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    const insertLibrary = this.db.prepare(
      'INSERT INTO libraries (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insertPlaylist = this.db.prepare(
      'INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertPlaylistGroup = this.db.prepare(
      'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    const insertPlaylistEntry = this.db.prepare(
      `INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const nextStageOrder = (this.db.prepare('SELECT COALESCE(MAX(order_index), -1) + 1 AS next_order FROM stages').get() as { next_order: number }).next_order;
    const importDeckCollectionId = this.getDefaultCollectionId('deck');
    const importThemeCollectionId = this.getDefaultCollectionId('theme');
    const importOverlayCollectionId = this.getDefaultCollectionId('overlay');
    const importStageCollectionId = this.getDefaultCollectionId('stage');

    const tx = this.db.transaction(() => {
      const themeIdMap = new Map<Id, Id>();
      const itemIdMap = new Map<Id, Id>();
      const replacementAssetKeys = new Set<string>();
      // Maps each original (pre-import) theme element id to the newly
      // materialized theme element id, plus the original theme id it belongs
      // to. Deck-item elements translate their `sourceThemeElementId`
      // through this map at insert time; an id that fails to resolve here
      // (dangling, unknown, or pointing at a theme not present in the
      // bundle) is written as NULL rather than an unproven/broken id -
      // mirrors the conservative provenance repair in migration v22.
      const themeElementIdMap = new Map<Id, { newId: Id; originalThemeId: Id }>();

      workingManifest.themes
        .slice()
        .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
        .forEach((theme, index) => {
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
          itemIdMap.set(item.id, newItemId);
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
          } else if (item.type === 'talk') {
            insertTalk.run(newItemId, item.title, importedThemeId, importDeckCollectionId, nextContentOrder + itemIndex, now, now);
          } else {
            insertLyric.run(newItemId, item.title, importedThemeId, importDeckCollectionId, nextContentOrder + itemIndex, now, now);
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
                null,
                null,
                null,
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
                // Only trust provenance that resolves to a theme element
                // materialized in *this* import and belongs to the theme
                // actually assigned to this deck item; every other case
                // (dangling id, theme absent from the bundle, mismatched
                // theme) is written as NULL rather than a guess.
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

      const importedPlaylists = workingManifest.playlists ?? [];
      if (importedPlaylists.length > 0) {
        const libraryByName = new Map<string, Id>();
        for (const lib of this.getLibraries()) libraryByName.set(lib.name, lib.id);
        let nextLibraryOrder =
          ((this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM libraries').get() as { maxOrder: number | null }).maxOrder ?? -1) + 1;

        const resolveLibraryId = (libraryName: string): Id => {
          const trimmed = libraryName.trim();
          const lookupName = trimmed || 'Imported';
          const existing = libraryByName.get(lookupName);
          if (existing) return existing;
          const newLibraryId = createId();
          insertLibrary.run(newLibraryId, lookupName, nextLibraryOrder, now, now);
          nextLibraryOrder += 1;
          libraryByName.set(lookupName, newLibraryId);
          return newLibraryId;
        };

        const playlistOrderByLibrary = new Map<Id, number>();
        const nextPlaylistOrderFor = (libraryId: Id): number => {
          if (!playlistOrderByLibrary.has(libraryId)) {
            const maxOrder =
              (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlists WHERE library_id = ?').get(libraryId) as {
                maxOrder: number | null;
              }).maxOrder ?? -1;
            playlistOrderByLibrary.set(libraryId, maxOrder + 1);
          }
          const next = playlistOrderByLibrary.get(libraryId) ?? 0;
          playlistOrderByLibrary.set(libraryId, next + 1);
          return next;
        };

        importedPlaylists
          .slice()
          .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
          .forEach((playlist) => {
            const libraryId = resolveLibraryId(playlist.libraryName);
            const newPlaylistId = createId();
            insertPlaylist.run(newPlaylistId, libraryId, playlist.name, nextPlaylistOrderFor(libraryId), now, now);

            playlist.groups
              .slice()
              .sort((left, right) => left.order - right.order)
              .forEach((group, groupIndex) => {
                const newGroupId = createId();
                insertPlaylistGroup.run(
                  newGroupId,
                  newPlaylistId,
                  group.name,
                  group.colorKey,
                  groupIndex,
                  now,
                  now,
                );

                group.entries
                  .slice()
                  .sort((left, right) => left.order - right.order)
                  .forEach((entry, entryIndex) => {
                    // Validated by assertValidDeckBundleManifest above, so this
                    // is guaranteed to have exactly one populated owner.
                    const sourceReference = getDeckBundlePlaylistEntryReference(entry);
                    const importedItemId = itemIdMap.get(sourceReference.itemId);
                    if (!importedItemId) return;
                    const owner = toPlaylistItemOwnerColumns(
                      makePlaylistItemReference(sourceReference.type, importedItemId),
                    );
                    insertPlaylistEntry.run(
                      createId(),
                      newGroupId,
                      owner.presentationId,
                      owner.lyricId,
                      owner.talkId,
                      entryIndex,
                      now,
                      now,
                    );
                  });
              });
          });
      }
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

  createPlaylistGroup(playlistId: Id, name: string): SnapshotPatch {
    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_groups WHERE playlist_id = ?').get(playlistId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    this.db
      .prepare(
        'INSERT INTO playlist_groups (id, playlist_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(createId(), playlistId, name, currentOrder + 1, now, now);

    return this.buildPatch({ replaceLibraryBundles: true });
  }

  renamePlaylistGroup(id: Id, name: string): SnapshotPatch {
    this.db
      .prepare('UPDATE playlist_groups SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, nowIso(), id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  setPlaylistGroupColor(id: Id, colorKey: string | null): SnapshotPatch {
    this.db
      .prepare('UPDATE playlist_groups SET color_key = ?, updated_at = ? WHERE id = ?')
      .run(colorKey, nowIso(), id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  addDeckItemToGroup(groupId: Id, itemId: Id): SnapshotPatch {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) {
      throw new Error(`Deck item not found: ${itemId}`);
    }

    // NOTE (#214): this only confirms the group exists, not that it belongs
    // to any particular playlist — unlike moveDeckItemToGroup/
    // movePlaylistEntryToGroup, this method has no playlistId parameter to
    // scope against, so a group belonging to a different playlist than the
    // caller intended is still accepted. Closing that gap needs a signature
    // change (an explicit playlistId, mirroring moveDeckItemToGroup) that
    // cascades through app/core/ipc.ts, app/main/ipc.ts, app/main/preload.ts,
    // and the renderer callers — outside this change's write boundary. See
    // the #214 audit comment; tracked for a dedicated follow-up.
    const exists = this.db
      .prepare('SELECT id FROM playlist_groups WHERE id = ?')
      .get(groupId) as { id: string } | undefined;

    if (!exists) {
      throw new Error(`Group not found: ${groupId}`);
    }

    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE group_id = ?').get(groupId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    const newEntryOwner = toPlaylistItemOwnerColumns(makePlaylistItemReference(owner.type, itemId));
    this.db
      .prepare(
        `INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        createId(),
        groupId,
        newEntryOwner.presentationId,
        newEntryOwner.lyricId,
        newEntryOwner.talkId,
        currentOrder + 1,
        now,
        now,
      );

    return this.buildPatch({ replaceLibraryBundles: true });
  }

  moveDeckItemToGroup(playlistId: Id, itemId: Id, groupId: Id | null): SnapshotPatch {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) {
      throw new Error(`Deck item not found: ${itemId}`);
    }
    const ownerColumn = this.getDeckOwnerColumn(owner.type);

    // Validate the destination before any destructive work: an unresolvable
    // group (missing, or belonging to a different playlist) must fail loudly
    // rather than deleting the item's current entries and reporting success.
    if (groupId) {
      const exists = this.db
        .prepare('SELECT id FROM playlist_groups WHERE id = ? AND playlist_id = ?')
        .get(groupId, playlistId) as { id: string } | undefined;
      if (!exists) {
        throw new Error(`Group not found: ${groupId}`);
      }
    }

    const now = nowIso();
    const movedEntryOwner = toPlaylistItemOwnerColumns(makePlaylistItemReference(owner.type, itemId));

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM playlist_entries
           WHERE (${ownerColumn} = ?)
           AND group_id IN (SELECT id FROM playlist_groups WHERE playlist_id = ?)`
        )
        .run(itemId, playlistId);

      if (!groupId) return;

      const currentOrder =
        (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE group_id = ?').get(groupId) as {
          maxOrder: number | null;
        }).maxOrder ?? -1;

      this.db
        .prepare(
          `INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          createId(),
          groupId,
          movedEntryOwner.presentationId,
          movedEntryOwner.lyricId,
          movedEntryOwner.talkId,
          currentOrder + 1,
          now,
          now,
        );
    });

    tx();
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  movePlaylistEntry(entryId: Id, direction: 'up' | 'down'): SnapshotPatch {
    const current = this.db
      .prepare('SELECT id, group_id, order_index FROM playlist_entries WHERE id = ?')
      .get(entryId) as { id: string; group_id: string; order_index: number } | undefined;

    if (!current) return this.buildPatch({});

    const neighbor = direction === 'up'
      ? this.db
        .prepare(
          'SELECT id, order_index FROM playlist_entries WHERE group_id = ? AND order_index < ? ORDER BY order_index DESC LIMIT 1'
        )
        .get(current.group_id, current.order_index)
      : this.db
        .prepare(
          'SELECT id, order_index FROM playlist_entries WHERE group_id = ? AND order_index > ? ORDER BY order_index ASC LIMIT 1'
        )
        .get(current.group_id, current.order_index);

    if (!neighbor) return this.buildPatch({});

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
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  movePlaylistEntryToGroup(entryId: Id, groupId: Id | null): SnapshotPatch {
    const entry = this.db
      .prepare(
        `SELECT pe.id, pe.group_id, pg.playlist_id
         FROM playlist_entries pe
         JOIN playlist_groups pg ON pg.id = pe.group_id
         WHERE pe.id = ?`
      )
      .get(entryId) as { id: string; group_id: string; playlist_id: string } | undefined;

    if (!entry) return this.buildPatch({});

    if (!groupId) {
      this.db
        .prepare('DELETE FROM playlist_entries WHERE id = ?')
        .run(entryId);
      return this.buildPatch({ replaceLibraryBundles: true });
    }

    const targetGroup = this.db
      .prepare('SELECT id FROM playlist_groups WHERE id = ? AND playlist_id = ?')
      .get(groupId, entry.playlist_id) as { id: string } | undefined;

    if (!targetGroup) return this.buildPatch({});

    const now = nowIso();
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM playlist_entries WHERE group_id = ?').get(groupId) as {
        maxOrder: number | null;
      }).maxOrder ?? -1;

    this.db
      .prepare('UPDATE playlist_entries SET group_id = ?, order_index = ?, updated_at = ? WHERE id = ?')
      .run(groupId, currentOrder + 1, now, entryId);

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

  createTalk(title: string): SnapshotPatch {
    const now = nowIso();
    const talkId = createId();
    const currentOrder = this.getMaxDeckOrder();
    const deckCollectionId = this.getDefaultCollectionId('deck');
    this.db
      .prepare('INSERT INTO talks (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(talkId, title, null, deckCollectionId, currentOrder + 1, now, now);
    return this.buildPatch({ upsertTalkIds: [talkId] });
  }

  createTheme(input: ThemeCreateInput): SnapshotPatch {
    const now = nowIso();
    const themeId = createId();
    const slideId = `${themeId}:slide`;
    const currentOrder =
      (this.db.prepare('SELECT MAX(order_index) AS maxOrder FROM themes').get() as { maxOrder: number | null }).maxOrder ?? -1;
    const sourceElements = input.elements
      ? JSON.parse(JSON.stringify(input.elements)) as SlideElement[]
      : createDefaultThemeElements(input.kind, slideId, now);
    // New container — regenerate element IDs so cloned input can't collide
    // with the source theme's existing slide_elements rows.
    const elements = this.normalizeContainerElementOwnership(sourceElements, slideId)
      .map((el) => ({ ...el, id: createId() }));
    const collectionId = input.collectionId ?? this.getDefaultCollectionId('theme');
    const width = input.width ?? DEFAULT_W;
    const height = input.height ?? DEFAULT_H;
    const backgroundJson = input.background ? JSON.stringify(input.background) : null;

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
      // Set background on the container slide if provided
      if (backgroundJson !== null) {
        this.db.prepare('UPDATE slides SET background_json = ?, updated_at = ? WHERE id = ?').run(backgroundJson, now, slideId);
      }
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

    if (!existing) {
      throw new Error(`Theme not found: ${input.id}`);
    }

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
      // Handle background update: explicit null means clear, undefined means leave unchanged
      if (input.background !== undefined) {
        const backgroundJson = input.background ? JSON.stringify(input.background) : null;
        this.db.prepare('UPDATE slides SET background_json = ?, updated_at = ? WHERE id = ?').run(backgroundJson, now, slideId);
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
    const affectedTalkIds = (this.db
      .prepare('SELECT id FROM talks WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>)
      .map((row) => row.id);
    const ownerSlideId = `${themeId}:slide`;
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE presentations SET theme_id = NULL, updated_at = ? WHERE theme_id = ?').run(nowIso(), themeId);
      this.db.prepare('UPDATE lyrics SET theme_id = NULL, updated_at = ? WHERE theme_id = ?').run(nowIso(), themeId);
      this.db.prepare('UPDATE talks SET theme_id = NULL, updated_at = ? WHERE theme_id = ?').run(nowIso(), themeId);
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
      upsertTalkIds: affectedTalkIds,
      upsertThemeIds: remainingThemeIds,
      deletedThemeIds: [themeId],
      replaceLibraryBundles: true,
    });
  }

  applyThemeToDeckItem(themeId: Id, itemId: Id): SnapshotPatch {
    const theme = this.getThemeById(themeId);
    if (!theme) {
      throw new Error(`Theme not found: ${themeId}`);
    }
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) {
      throw new Error(`Deck item not found: ${itemId}`);
    }
    if (!isThemeCompatibleWithDeckItem(theme, owner.type)) {
      throw new Error(`Theme kind '${theme.kind}' is not compatible with deck item type '${owner.type}'`);
    }

    const ownerColumn = this.getDeckOwnerColumn(owner.type);
    const ownerTable = this.getDeckTableName(owner.type);

    const slides = this.db
      .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(itemId) as Array<{ id: string }>;
    const selectElements = this.db
      .prepare(
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
    const tx = this.db.transaction(() => {
      this.db.prepare(`UPDATE ${ownerTable} SET theme_id = ?, updated_at = ? WHERE id = ?`).run(themeId, nowIso(), itemId);
      for (const slide of slides) {
        setSlideBackground.run(themeBackgroundJson, 'theme', nowIso(), slide.id);
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
          payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('applyThemeToDeckItem', `slide_elements.${row.id}.payload_json`)),
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
            nowIso(),
          );
        }
      }
    });

    tx();
    return this.buildPatch({
      upsertPresentationIds: owner.type === 'presentation' ? [itemId] : undefined,
      upsertLyricIds: owner.type === 'lyric' ? [itemId] : undefined,
      upsertTalkIds: owner.type === 'talk' ? [itemId] : undefined,
      upsertSlideIds: slides.map((slide) => slide.id),
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds(slides.map((slide) => slide.id)),
      deletedSlideElementIds: deletedElementIds,
      replaceLibraryBundles: true,
    });
  }

  syncThemeToLinkedDeckItems(themeId: Id): SnapshotPatch {
    const theme = this.getThemeById(themeId);
    if (!theme) {
      throw new Error(`Theme not found: ${themeId}`);
    }

    const presentations = this.db
      .prepare('SELECT id FROM presentations WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>;
    const lyrics = this.db
      .prepare('SELECT id FROM lyrics WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>;
    const talks = this.db
      .prepare('SELECT id FROM talks WHERE theme_id = ?')
      .all(themeId) as Array<{ id: string }>;

    const linkedItems: Array<{ id: string; type: DeckItemType }> = [
      ...(theme.kind === 'slides' ? presentations.map((row) => ({ id: row.id, type: 'presentation' as DeckItemType })) : []),
      ...(theme.kind === 'slides' ? talks.map((row) => ({ id: row.id, type: 'talk' as DeckItemType })) : []),
      ...(theme.kind === 'lyrics' ? lyrics.map((row) => ({ id: row.id, type: 'lyric' as DeckItemType })) : []),
    ];

    if (linkedItems.length === 0) return this.buildPatch({});

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
    const tx = this.db.transaction(() => {
      for (const item of linkedItems) {
        const ownerColumn = this.getDeckOwnerColumn(item.type);
        const slides = this.db
          .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
          .all(item.id) as Array<{ id: string }>;
        for (const slide of slides) {
          // Sync is non-destructive: only theme-owned backgrounds are
          // refreshed; a local override survives.
          const sourceRow = slideBackgroundSource.get(slide.id) as { background_source: string | null } | undefined;
          if (!sourceRow || sourceRow.background_source !== 'local') {
            setSlideBackground.run(themeBackgroundJson, 'theme', nowIso(), slide.id);
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
            payload: decodeSlideElementPayloadJson(row.payload_json, row.type, persistedContext('syncThemeToLinkedDeckItems', `slide_elements.${row.id}.payload_json`)),
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
    const talkIds = linkedItems.filter((item) => item.type === 'talk').map((item) => item.id);

    return this.buildPatch({
      upsertPresentationIds: presentationIds.length > 0 ? presentationIds : undefined,
      upsertLyricIds: lyricIds.length > 0 ? lyricIds : undefined,
      upsertTalkIds: talkIds.length > 0 ? talkIds : undefined,
      upsertSlideIds: touchedSlideIds,
      upsertSlideElementIds: this.getSlideElementIdsBySlideIds(touchedSlideIds),
      deletedSlideElementIds: deletedElementIds,
      replaceLibraryBundles: true,
    });
  }

  detachThemeFromDeckItem(itemId: Id): SnapshotPatch {
    const owner = this.resolveDeckOwnerRow(itemId);
    if (!owner) {
      throw new Error(`Deck item not found: ${itemId}`);
    }
    // Item exists but already has no theme assigned — nothing to detach.
    // Genuine no-op (#214), distinct from the not-found case above.
    if (owner.themeId === null) return this.buildPatch({});

    const ownerTable = this.getDeckTableName(owner.type);
    const ownerColumn = this.getDeckOwnerColumn(owner.type);
    const now = nowIso();

    // Collect slide IDs before the transaction
    const slideRows = this.db
      .prepare(`SELECT id FROM slides WHERE ${ownerColumn} = ? ORDER BY order_index ASC`)
      .all(itemId) as Array<{ id: string }>;
    const slideIds = slideRows.map((r) => r.id);

    // Collect element IDs for those slides
    const elementIds: Id[] = [];
    if (slideIds.length > 0) {
      const placeholders = slideIds.map(() => '?').join(',');
      const elementRows = this.db
        .prepare(`SELECT id FROM slide_elements WHERE slide_id IN (${placeholders})`)
        .all(...slideIds) as Array<{ id: string }>;
      elementIds.push(...elementRows.map((r) => r.id));
    }

    const tx = this.db.transaction(() => {
      // Clear theme assignment on the owner
      this.db.prepare(`UPDATE ${ownerTable} SET theme_id = NULL, updated_at = ? WHERE id = ?`).run(now, itemId);

      // Mark all slides as locally-owned background and clear element provenance
      const setBackgroundLocal = this.db.prepare('UPDATE slides SET background_source = ?, updated_at = ? WHERE id = ?');
      const clearProvenance = this.db.prepare('UPDATE slide_elements SET source_theme_element_id = NULL WHERE slide_id = ?');

      for (const slideId of slideIds) {
        setBackgroundLocal.run('local', now, slideId);
        clearProvenance.run(slideId);
      }
    });

    tx();

    return this.buildPatch({
      upsertPresentationIds: owner.type === 'presentation' ? [itemId] : undefined,
      upsertLyricIds: owner.type === 'lyric' ? [itemId] : undefined,
      upsertTalkIds: owner.type === 'talk' ? [itemId] : undefined,
      upsertSlideIds: slideIds.length > 0 ? slideIds : undefined,
      upsertSlideElementIds: elementIds.length > 0 ? elementIds : undefined,
      replaceLibraryBundles: true,
    });
  }

  applyThemeToOverlay(themeId: Id, overlayId: Id): SnapshotPatch {
    const theme = this.getThemeById(themeId);
    if (!theme) {
      throw new Error(`Theme not found: ${themeId}`);
    }
    // Compatibility comes from the single capability matrix in @core/themes,
    // never a local kind comparison. Incompatible-theme and unresolvable-
    // overlay stay silent no-ops for now: neither has an existing throwing
    // sibling to mirror in this file, so #214 defers them to a later group.
    if (!isThemeCompatibleWithOwnerKind(theme, 'overlay')) return this.buildPatch({});
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

  // Preserved for existing direct-repository callers/tests that expect the
  // raw patch. The IPC boundary (app/main/ipc.ts) calls
  // createDeckItemWithFirstSlide below instead, which also returns the
  // created owner's id so the renderer never has to infer it.
  createDeckItemWithTheme(input: { type: 'presentation' | 'lyric' | 'talk'; title: string; collectionId?: Id | null; themeId?: Id | null; groupId?: Id | null }): SnapshotPatch {
    return this.createDeckItemWithFirstSlide(input).patch;
  }

  createDeckItemWithFirstSlide(input: { type: 'presentation' | 'lyric' | 'talk'; title: string; collectionId?: Id | null; themeId?: Id | null; groupId?: Id | null }): { itemId: Id; patch: SnapshotPatch } {
    // Validate input before first write
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected object');
    }
    if (input.type !== 'presentation' && input.type !== 'lyric' && input.type !== 'talk') {
      throw new Error(`Invalid deck item type: ${input.type}. Must be 'presentation', 'lyric', or 'talk'.`);
    }
    const trimmedTitle = input.title?.trim();
    if (!trimmedTitle) {
      throw new Error('Title is required and cannot be empty');
    }

    const now = nowIso();
    const itemId = createId();
    const slideId = createId();
    const collectionId = input.collectionId ?? this.getDefaultCollectionId('deck');

    // Validate collection exists and is a deck collection
    const collection = this.db.prepare(
      'SELECT id FROM deck_collections WHERE id = ?'
    ).get(collectionId) as { id: string } | undefined;
    if (!collection) {
      throw new Error(`Collection not found: ${collectionId}`);
    }

    // Validate theme if provided
    let theme: Theme | null = null;
    if (input.themeId) {
      theme = this.getThemeById(input.themeId);
      if (!theme) {
        throw new Error(`Theme not found: ${input.themeId}`);
      }
      if (!isThemeCompatibleWithDeckItem(theme, input.type)) {
        throw new Error(`Theme kind '${theme.kind}' is not compatible with '${input.type}'`);
      }
    }

    // Validate group if provided
    if (input.groupId) {
      const groupExists = this.db.prepare(
        'SELECT id FROM playlist_groups WHERE id = ?'
      ).get(input.groupId) as { id: string } | undefined;
      if (!groupExists) {
        throw new Error(`Group not found: ${input.groupId}`);
      }
    }

    // Compute correct owner order index for this collection
    const maxOrderRow = this.db.prepare(
      `SELECT MAX(order_index) as maxOrder FROM ${input.type === 'presentation' ? 'presentations' : input.type === 'lyric' ? 'lyrics' : 'talks'} WHERE collection_id = ?`
    ).get(collectionId) as { maxOrder: number | null } | undefined;
    const ownerOrderIndex = (maxOrderRow?.maxOrder ?? -1) + 1;

    const tx = this.db.transaction(() => {
      // 1. Create the owner with explicit order
      if (input.type === 'presentation') {
        this.db.prepare(
          `INSERT INTO presentations (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(itemId, trimmedTitle, input.themeId ?? null, collectionId, ownerOrderIndex, now, now);
      } else if (input.type === 'lyric') {
        this.db.prepare(
          `INSERT INTO lyrics (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(itemId, trimmedTitle, input.themeId ?? null, collectionId, ownerOrderIndex, now, now);
      } else {
        this.db.prepare(
          `INSERT INTO talks (id, title, theme_id, collection_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(itemId, trimmedTitle, input.themeId ?? null, collectionId, ownerOrderIndex, now, now);
      }

      // 2. Create the first slide
      this.db.prepare(
        `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, 0, ?, ?)`
      ).run(
        slideId,
        input.type === 'presentation' ? itemId : null,
        input.type === 'lyric' ? itemId : null,
        input.type === 'talk' ? itemId : null,
        'slide',
        theme?.width ?? DEFAULT_W,
        theme?.height ?? DEFAULT_H,
        theme?.background ? JSON.stringify(theme.background) : null,
        theme ? 'theme' : 'local',
        now,
        now,
      );

      // 3. Apply theme elements and background if theme is provided
      if (theme) {
        // Apply theme elements (with empty text values for new slide)
        const appliedElements = applyThemeToElements(theme, [], slideId);
        for (const element of appliedElements) {
          this.db.prepare(
            `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
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
      } else {
        // Create default elements for the slide based on type, reusing the
        // shared helper so atomic first-slide and later-slide creation cannot diverge.
        const defaultElements = createDefaultThemeElements(
          input.type === 'lyric' ? 'lyrics' : 'slides',
          slideId,
          now,
        );

        for (const element of defaultElements) {
          this.db.prepare(
            `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
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
            element.createdAt,
            now,
          );
        }
      }

      // 4. Add to group if provided
      if (input.groupId) {
        const maxOrder = this.db.prepare(
          `SELECT MAX(order_index) as maxOrder FROM playlist_entries WHERE group_id = ?`
        ).get(input.groupId) as { maxOrder: number | null } | undefined;

        const newItemOwner = toPlaylistItemOwnerColumns(makePlaylistItemReference(input.type, itemId));
        this.db.prepare(
          `INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          createId(),
          input.groupId,
          newItemOwner.presentationId,
          newItemOwner.lyricId,
          newItemOwner.talkId,
          (maxOrder?.maxOrder ?? -1) + 1,
          now,
          now,
        );
      }
    });

    tx();

    // Build the patch with all affected entities
    const patchSpec: {
      upsertPresentationIds?: Id[];
      upsertLyricIds?: Id[];
      upsertTalkIds?: Id[];
      upsertSlideIds?: Id[];
      upsertSlideElementIds?: Id[];
      replaceLibraryBundles?: boolean;
    } = {};

    if (input.type === 'presentation') {
      patchSpec.upsertPresentationIds = [itemId];
    } else if (input.type === 'lyric') {
      patchSpec.upsertLyricIds = [itemId];
    } else {
      patchSpec.upsertTalkIds = [itemId];
    }

    patchSpec.upsertSlideIds = [slideId];
    patchSpec.upsertSlideElementIds = this.getSlideElementIdsBySlideIds([slideId]);
    patchSpec.replaceLibraryBundles = true;

    return { itemId, patch: this.buildPatch(patchSpec) };
  }

  duplicateDeckItem(itemId: Id): { itemId: Id; patch: SnapshotPatch } {
    const now = nowIso();

    // 1. Find the source item (only presentation and lyric supported)
    const sourcePresentation = this.db
      .prepare('SELECT id, title, theme_id, collection_id, order_index FROM presentations WHERE id = ?')
      .get(itemId) as { id: string; title: string; theme_id: string | null; collection_id: string; order_index: number } | undefined;
    const sourceLyric = this.db
      .prepare('SELECT id, title, theme_id, collection_id, order_index FROM lyrics WHERE id = ?')
      .get(itemId) as { id: string; title: string; theme_id: string | null; collection_id: string; order_index: number } | undefined;
    const sourceTalk = this.db
      .prepare('SELECT id, title, theme_id, collection_id, order_index FROM talks WHERE id = ?')
      .get(itemId) as { id: string; title: string; theme_id: string | null; collection_id: string; order_index: number } | undefined;

    if (sourceTalk) {
      throw new DeckItemDuplicationError(
        'unsupported-owner-type',
        itemId,
        'Deck item duplication is not supported for Talk items',
      );
    }

    const sourceType: 'presentation' | 'lyric' | null = sourcePresentation ? 'presentation' : sourceLyric ? 'lyric' : null;
    if (!sourceType) {
      throw new Error(`Deck item not found: ${itemId}`);
    }

    const source = sourceType === 'presentation' ? sourcePresentation! : sourceLyric!;
    const sourceTable = sourceType === 'presentation' ? 'presentations' : 'lyrics';
    const fkColumn = sourceType === 'presentation' ? 'presentation_id' : 'lyric_id';

    // 2. Generate deterministic unique title (case-insensitive within same owner type only)
    const baseTitle = source.title;
    let candidateTitle = `${baseTitle} Copy`;
    const existingTitles = new Set(
      (this.db.prepare(
        `SELECT title FROM ${sourceTable}`
      ).all() as Array<{ title: string }>).map((row) => row.title.toLowerCase())
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

    // 3. Find the source's order position
    const sourceOrder = source.order_index;

    // 4. Get all source slides in order
    const sourceSlides = this.db
      .prepare(
        `SELECT id, kind, width, height, background_json, background_source, notes, order_index
         FROM slides
         WHERE ${fkColumn} = ?
         ORDER BY order_index ASC`
      )
      .all(itemId) as Array<{
        id: string;
        kind: string;
        width: number;
        height: number;
        background_json: string | null;
        background_source: string | null;
        notes: string;
        order_index: number;
      }>;

    // 5. Get all source elements for all slides
    const sourceElementsMap = new Map<string, Array<{
      id: string;
      slide_id: string;
      type: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      opacity: number;
      z_index: number;
      layer: string;
      payload_json: string;
      source_theme_element_id: string | null;
      created_at: string;
      updated_at: string;
    }>>();

    for (const slide of sourceSlides) {
      const elements = this.db.prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at
         FROM slide_elements
         WHERE slide_id = ?
         ORDER BY z_index ASC, created_at ASC`
      ).all(slide.id) as Array<{
        id: string;
        slide_id: string;
        type: string;
        x: number;
        y: number;
        width: number;
        height: number;
        rotation: number;
        opacity: number;
        z_index: number;
        layer: string;
        payload_json: string;
        source_theme_element_id: string | null;
        created_at: string;
        updated_at: string;
      }>;
      sourceElementsMap.set(slide.id, elements);
    }

    // 6. Get sibling IDs that will be shifted (for patch). Order is scoped to
    // the source's own collection — order_index is a per-(type, collection)
    // sequence (see createDeckItemWithFirstSlide's collection-scoped MAX
    // query), so an unscoped shift would corrupt ordering in unrelated
    // collections that happen to share order_index values.
    const shiftedSiblings = this.db
      .prepare(`SELECT id FROM ${sourceTable} WHERE collection_id = ? AND order_index >= ? AND id != ? ORDER BY order_index ASC`)
      .all(source.collection_id, sourceOrder + 1, itemId) as Array<{ id: string }>;
    const shiftedSiblingIds = shiftedSiblings.map((s) => s.id);

    // 7. Perform the duplication in a transaction
    const newOwnerId = createId();
    const slideIdMap = new Map<string, string>();

    const tx = this.db.transaction(() => {
      // 8. Shift later siblings within the same collection to make room
      this.db.prepare(
        `UPDATE ${sourceTable}
         SET order_index = order_index + 1, updated_at = ?
         WHERE collection_id = ? AND order_index >= ?`
      ).run(now, source.collection_id, sourceOrder + 1);

      // 9. Create the new owner at sourceOrder + 1
      this.db.prepare(
        `INSERT INTO ${sourceTable} (id, title, theme_id, collection_id, order_index, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(newOwnerId, candidateTitle, source.theme_id, source.collection_id, sourceOrder + 1, now, now);

      // 10. Deep-copy every source slide
      for (const sourceSlide of sourceSlides) {
        const newSlideId = createId();
        slideIdMap.set(sourceSlide.id, newSlideId);

        this.db.prepare(
          `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, kind, width, height, background_json, background_source, notes, order_index, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newSlideId,
          sourceType === 'presentation' ? newOwnerId : null,
          sourceType === 'lyric' ? newOwnerId : null,
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

        // Copy elements with new collision-free IDs, preserving sourceThemeElementId
        const sourceElements = sourceElementsMap.get(sourceSlide.id) ?? [];
        for (const sourceElement of sourceElements) {
          this.db.prepare(
            `INSERT INTO slide_elements (id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer, payload_json, source_theme_element_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            createId(),
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

    // 11. Build the patch with shifted siblings included
    const patchSpec: {
      upsertPresentationIds?: Id[];
      upsertLyricIds?: Id[];
      upsertTalkIds?: Id[];
      upsertSlideIds?: Id[];
      upsertSlideElementIds?: Id[];
      replaceLibraryBundles?: boolean;
    } = {};

    if (sourceType === 'presentation') {
      patchSpec.upsertPresentationIds = [newOwnerId, ...shiftedSiblingIds];
    } else {
      patchSpec.upsertLyricIds = [newOwnerId, ...shiftedSiblingIds];
    }

    const newSlideIds = [...slideIdMap.values()];
    patchSpec.upsertSlideIds = newSlideIds;
    patchSpec.upsertSlideElementIds = this.getSlideElementIdsBySlideIds(newSlideIds);
    patchSpec.replaceLibraryBundles = true;

    return { itemId: newOwnerId, patch: this.buildPatch(patchSpec) };
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
      upsertTalkIds: [current, neighbor].filter((item) => item.type === 'talk').map((item) => item.id),
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
        appliedTheme?.background ? JSON.stringify(appliedTheme.background) : null,
        appliedTheme ? 'theme' : 'local',
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
    // Mark background as locally set for deck slides (not theme/overlay/stage containers).
    const owner = this.db
      .prepare('SELECT theme_id, overlay_id, stage_id FROM slides WHERE id = ?')
      .get(input.slideId) as { theme_id: string | null; overlay_id: string | null; stage_id: string | null } | undefined;
    const isContainerSlide = Boolean(owner?.theme_id || owner?.overlay_id || owner?.stage_id);
    const backgroundSource = isContainerSlide ? 'theme' : 'local';

    this.db
      .prepare('UPDATE slides SET background_json = ?, background_source = ?, updated_at = ? WHERE id = ?')
      .run(input.background ? JSON.stringify(input.background) : null, backgroundSource, now, input.slideId);
    // Theme/overlay/stage slides don't flow through the snapshot's `slides`
    // array — they surface via their owning container, so upsert that instead.
    // Bump the container's own `updated_at` too: the renderer dedupes entity
    // arrays by id+updatedAt, so without this the new background is persisted
    // but the UI keeps the stale cached entity until a full reload.
    if (owner?.theme_id) {
      this.db.prepare('UPDATE themes SET updated_at = ? WHERE id = ?').run(now, owner.theme_id);
      return this.buildPatch({ upsertThemeIds: [owner.theme_id] });
    }
    if (owner?.overlay_id) {
      this.db.prepare('UPDATE overlays SET updated_at = ? WHERE id = ?').run(now, owner.overlay_id);
      return this.buildPatch({ upsertOverlayIds: [owner.overlay_id] });
    }
    if (owner?.stage_id) {
      this.db.prepare('UPDATE stages SET updated_at = ? WHERE id = ?').run(now, owner.stage_id);
      return this.buildPatch({ upsertStageIds: [owner.stage_id] });
    }
    return this.buildPatch({ upsertSlideIds: [input.slideId] });
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

    // Get the current slide to find its parent
    const slide = this.db
      .prepare('SELECT id, presentation_id, lyric_id, talk_id FROM slides WHERE id = ?')
      .get(input.slideId) as { id: string; presentation_id: string | null; lyric_id: string | null; talk_id: string | null } | undefined;

    if (!slide) return this.buildPatch({});

    // Determine parent column and value
    const ownerColumn = slide.presentation_id !== null ? 'presentation_id' : slide.lyric_id !== null ? 'lyric_id' : 'talk_id';
    const ownerId = slide.presentation_id ?? slide.lyric_id ?? slide.talk_id;

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

  movePlaylistEntryTo(entryId: Id, groupId: Id, newOrder: number): SnapshotPatch {
    const entry = this.db
      .prepare(
        `SELECT pe.id, pe.group_id, pg.playlist_id
         FROM playlist_entries pe
         JOIN playlist_groups pg ON pg.id = pe.group_id
         WHERE pe.id = ?`
      )
      .get(entryId) as { id: string; group_id: string; playlist_id: string } | undefined;
    if (!entry) return this.buildPatch({});

    const targetGroup = this.db
      .prepare('SELECT id FROM playlist_groups WHERE id = ? AND playlist_id = ?')
      .get(groupId, entry.playlist_id) as { id: string } | undefined;
    if (!targetGroup) return this.buildPatch({});

    const now = nowIso();
    const isSameGroup = entry.group_id === groupId;

    const tx = this.db.transaction(() => {
      if (isSameGroup) {
        const siblings = this.db
          .prepare('SELECT id FROM playlist_entries WHERE group_id = ? ORDER BY order_index ASC')
          .all(groupId) as { id: string }[];
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
        .prepare('SELECT id FROM playlist_entries WHERE group_id = ? ORDER BY order_index ASC')
        .all(groupId) as { id: string }[];
      const clampedOrder = Math.max(0, Math.min(newOrder, targetSiblings.length));
      const newTargetList = [...targetSiblings];
      newTargetList.splice(clampedOrder, 0, { id: entryId });
      newTargetList.forEach((item, index) => {
        if (item.id === entryId) {
          this.db
            .prepare('UPDATE playlist_entries SET group_id = ?, order_index = ?, updated_at = ? WHERE id = ?')
            .run(groupId, index, now, item.id);
        } else {
          this.db
            .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
            .run(index, now, item.id);
        }
      });

      const sourceSiblings = this.db
        .prepare('SELECT id FROM playlist_entries WHERE group_id = ? ORDER BY order_index ASC')
        .all(entry.group_id) as { id: string }[];
      sourceSiblings.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE playlist_entries SET order_index = ?, updated_at = ? WHERE id = ?')
          .run(index, now, sibling.id);
      });
    });

    tx();
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  setPlaylistGroupOrder(groupId: Id, newOrder: number): SnapshotPatch {
    const now = nowIso();
    const current = this.db
      .prepare('SELECT id, playlist_id, order_index FROM playlist_groups WHERE id = ?')
      .get(groupId) as { id: string; playlist_id: string; order_index: number } | undefined;

    if (!current) return this.buildPatch({});

    const siblings = this.db
      .prepare('SELECT id, order_index FROM playlist_groups WHERE playlist_id = ? ORDER BY order_index ASC')
      .all(current.playlist_id) as { id: string; order_index: number }[];

    const currentIndex = siblings.findIndex((s) => s.id === groupId);
    if (currentIndex === -1) return this.buildPatch({});

    const maxOrder = siblings.length - 1;
    const targetOrder = Math.max(0, Math.min(newOrder, maxOrder));
    if (currentIndex === targetOrder) return this.buildPatch({});

    const reordered = siblings.filter((_, i) => i !== currentIndex);
    reordered.splice(targetOrder, 0, siblings[currentIndex]);

    const tx = this.db.transaction(() => {
      reordered.forEach((sibling, index) => {
        this.db
          .prepare('UPDATE playlist_groups SET order_index = ?, updated_at = ? WHERE id = ?')
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
        JSON.stringify(input.payload ?? decodeSlideElementPayloadJson(existing.payload_json, existing.type, persistedContext('updateElement', `slide_elements.${existing.id}.payload_json`))),
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
          JSON.stringify(input.payload ?? decodeSlideElementPayloadJson(existing.payload_json, existing.type, persistedContext('updateElementsBatch', `slide_elements.${existing.id}.payload_json`))),
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
    // New container — regenerate element IDs so cloned/duplicated input
    // can't collide with the source overlay's existing slide_elements rows.
    const elements = (input.elements ?? []).map((el) => ({ ...el, id: createId(), slideId }));
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
          JSON.stringify(normalizeOverlayAnimation(input.animation ?? decodeOverlayAnimationJson(existing.animation_json, persistedContext('updateOverlay', `overlays.${existing.id}.animation_json`)))),
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

  renameTalk(id: Id, title: string): SnapshotPatch {
    this.db
      .prepare('UPDATE talks SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, nowIso(), id);
    return this.buildPatch({ upsertTalkIds: [id], replaceLibraryBundles: true });
  }

  deleteLibrary(id: Id): SnapshotPatch {
    const tx = this.db.transaction((libraryId: Id) => {
      this.db
        .prepare(
          `DELETE FROM playlist_entries
           WHERE group_id IN (
             SELECT pg.id
             FROM playlist_groups pg
             JOIN playlists p ON p.id = pg.playlist_id
             WHERE p.library_id = ?
           )`
        )
        .run(libraryId);

      this.db
        .prepare(
          `DELETE FROM playlist_groups
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
           WHERE group_id IN (SELECT id FROM playlist_groups WHERE playlist_id = ?)`
        )
        .run(playlistId);
      this.db
        .prepare('DELETE FROM playlist_groups WHERE playlist_id = ?')
        .run(playlistId);
      this.db
        .prepare('DELETE FROM playlists WHERE id = ?')
        .run(playlistId);
    });

    tx(id);
    if (row) this.normalizePlaylistOrder(row.library_id);
    return this.buildPatch({ replaceLibraryBundles: true });
  }

  deletePlaylistGroup(id: Id): SnapshotPatch {
    const tx = this.db.transaction((groupId: Id) => {
      this.db
        .prepare('DELETE FROM playlist_entries WHERE group_id = ?')
        .run(groupId);
      this.db
        .prepare('DELETE FROM playlist_groups WHERE id = ?')
        .run(groupId);
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

  deleteTalk(id: Id): SnapshotPatch {
    const deletedSlideIds = (this.db
      .prepare('SELECT id FROM slides WHERE talk_id = ?')
      .all(id) as Array<{ id: string }>)
      .map((row) => row.id);
    const deletedSlideElementIds = this.getSlideElementIdsBySlideIds(deletedSlideIds);
    const deletedTalkScriptBlockIds = this.getTalkScriptBlockIdsBySlideIds(deletedSlideIds);
    const tx = this.db.transaction((talkId: Id) => {
      this.db
        .prepare(
          `DELETE FROM talk_script_blocks
           WHERE slide_id IN (SELECT id FROM slides WHERE talk_id = ?)`
        )
        .run(talkId);
      this.db
        .prepare(
          `DELETE FROM slide_elements
           WHERE slide_id IN (SELECT id FROM slides WHERE talk_id = ?)`
        )
        .run(talkId);
      this.db
        .prepare('DELETE FROM slides WHERE talk_id = ?')
        .run(talkId);
      this.db
        .prepare('DELETE FROM playlist_entries WHERE talk_id = ?')
        .run(talkId);
      this.db
        .prepare('DELETE FROM talks WHERE id = ?')
        .run(talkId);
    });

    tx(id);
    this.normalizeDeckItemOrder();
    const remainingPresentationIds = (this.db.prepare('SELECT id FROM presentations ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    const remainingLyricIds = (this.db.prepare('SELECT id FROM lyrics ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    const remainingTalkIds = (this.db.prepare('SELECT id FROM talks ORDER BY order_index ASC').all() as Array<{ id: string }>).map((row) => row.id);
    return this.buildPatch({
      upsertPresentationIds: remainingPresentationIds,
      upsertLyricIds: remainingLyricIds,
      upsertTalkIds: remainingTalkIds,
      deletedTalkIds: [id],
      deletedSlideIds,
      deletedSlideElementIds,
      deletedTalkScriptBlockIds,
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
    // New container — regenerate element IDs so cloned input can't collide
    // with the source stage's existing slide_elements rows.
    const elements = (input.elements ?? []).map((el) => ({ ...el, id: createId(), slideId }));
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

  private normalizeThemeKind(kind: string | null | undefined): ThemeKind {
    if (kind === 'lyrics' || kind === 'overlays') return kind;
    return 'slides';
  }

  private inferLayer(type: string): 'background' | 'media' | 'content' {
    if (type === 'shape') return 'background';
    if (type === 'image' || type === 'video') return 'media';
    return 'content';
  }

  private getDeckTableName(type: DeckItemType): 'presentations' | 'lyrics' | 'talks' {
    if (type === 'presentation') return 'presentations';
    if (type === 'lyric') return 'lyrics';
    return 'talks';
  }

  private getDeckOwnerColumn(type: DeckItemType): 'presentation_id' | 'lyric_id' | 'talk_id' {
    if (type === 'presentation') return 'presentation_id';
    if (type === 'lyric') return 'lyric_id';
    return 'talk_id';
  }

  private getMaxDeckOrder(): number {
    const row = this.db.prepare(
      `SELECT MAX(order_index) AS maxOrder
       FROM (
         SELECT order_index FROM presentations
         UNION ALL
         SELECT order_index FROM lyrics
         UNION ALL
         SELECT order_index FROM talks
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
         UNION ALL
         SELECT id, 'talk' AS type, order_index, created_at FROM talks
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

    const talk = this.db
      .prepare('SELECT theme_id FROM talks WHERE id = ?')
      .get(id) as { theme_id: string | null } | undefined;
    if (talk) {
      return { type: 'talk', themeId: talk.theme_id };
    }

    return null;
  }

  private resolveSlideOwnerInput(input: SlideCreateInput): (DeckOwnerRow & { id: Id }) | null {
    const providedIds = [input.presentationId, input.lyricId, input.talkId].filter(Boolean);
    if (providedIds.length !== 1) return null;
    const ownerId = input.presentationId ?? input.lyricId ?? input.talkId ?? null;
    if (!ownerId) return null;

    const owner = this.resolveDeckOwnerRow(ownerId);
    if (!owner) return null;

    if (owner.type === 'presentation' && input.presentationId) return { ...owner, id: input.presentationId };
    if (owner.type === 'lyric' && input.lyricId) return { ...owner, id: input.lyricId };
    if (owner.type === 'talk' && input.talkId) return { ...owner, id: input.talkId };
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
        `SELECT id, width, height, notes, background_json, background_source, order_index
         FROM slides
         WHERE ${ownerColumn} = ?
         ORDER BY order_index ASC, created_at ASC`
      )
      .all(itemId) as Array<{ id: string; width: number; height: number; notes: string; background_json: string | null; background_source: string | null; order_index: number }>;

    const bundleSlides = slides.map((slide): DeckBundleSlide => ({
      id: slide.id,
      width: slide.width,
      height: slide.height,
      notes: slide.notes,
      order: slide.order_index,
      background: slide.background_json ? decodeSlideBackgroundJson(slide.background_json, persistedContext('exportDeckBundle', `slides.${slide.id}.background_json`)) : null,
      backgroundSource: (slide.background_source ?? 'local') as SlideBackgroundSource,
      elements: this.getSlideElementsBySlideId(slide.id),
      scriptBlocks: owner.type === 'talk'
        ? (this.getTalkScriptBlocksByIds(this.getTalkScriptBlockIdsBySlideIds([slide.id])).map((block) => ({
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

  private getDeckBundlePlaylistById(playlistId: Id): DeckBundlePlaylist | null {
    const row = this.db
      .prepare(
        `SELECT p.id, p.name, p.order_index, p.library_id, l.name AS library_name
         FROM playlists p
         LEFT JOIN libraries l ON l.id = p.library_id
         WHERE p.id = ?`
      )
      .get(playlistId) as
      | { id: string; name: string; order_index: number; library_id: string; library_name: string | null }
      | undefined;

    if (!row) return null;

    const groups = this.getPlaylistGroups(playlistId).map((group): DeckBundlePlaylistGroup => ({
      id: group.id,
      name: group.name,
      colorKey: group.colorKey,
      order: group.order,
      entries: this.getPlaylistEntries(group.id).map((entry) => {
        const owner = toPlaylistItemOwnerColumns(entry.reference);
        return {
          id: entry.id,
          presentationId: owner.presentationId,
          lyricId: owner.lyricId,
          talkId: owner.talkId,
          order: entry.order,
        };
      }),
    }));

    return {
      id: row.id,
      name: row.name,
      libraryName: row.library_name ?? '',
      order: row.order_index,
      groups,
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
    upsertTalkIds?: Id[];
    upsertSlideIds?: Id[];
    upsertTalkScriptBlockIds?: Id[];
    upsertSlideElementIds?: Id[];
    upsertMediaAssetIds?: Id[];
    upsertOverlayIds?: Id[];
    upsertThemeIds?: Id[];
    upsertStageIds?: Id[];
    upsertCollectionIds?: Id[];
    upsertCueIds?: Id[];
    upsertMacroIds?: Id[];
    upsertTriggerBindingIds?: Id[];
    deletedLibraryIds?: Id[];
    deletedPresentationIds?: Id[];
    deletedLyricIds?: Id[];
    deletedTalkIds?: Id[];
    deletedSlideIds?: Id[];
    deletedTalkScriptBlockIds?: Id[];
    deletedSlideElementIds?: Id[];
    deletedMediaAssetIds?: Id[];
    deletedOverlayIds?: Id[];
    deletedThemeIds?: Id[];
    deletedStageIds?: Id[];
    deletedCollectionIds?: Id[];
    deletedCueIds?: Id[];
    deletedMacroIds?: Id[];
    deletedTriggerBindingIds?: Id[];
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
    if (spec.upsertTalkIds && spec.upsertTalkIds.length > 0) {
      patch.upserts.talks = this.getTalksByIds(spec.upsertTalkIds);
    }
    if (spec.upsertSlideIds && spec.upsertSlideIds.length > 0) {
      patch.upserts.slides = this.getSlidesByIds(spec.upsertSlideIds);
    }
    if (spec.upsertTalkScriptBlockIds && spec.upsertTalkScriptBlockIds.length > 0) {
      patch.upserts.talkScriptBlocks = this.getTalkScriptBlocksByIds(spec.upsertTalkScriptBlockIds);
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
    if (spec.upsertCueIds && spec.upsertCueIds.length > 0) {
      patch.upserts.cues = this.getCuesByIds(spec.upsertCueIds);
    }
    if (spec.upsertMacroIds && spec.upsertMacroIds.length > 0) {
      patch.upserts.macros = this.getMacrosByIds(spec.upsertMacroIds);
    }
    if (spec.upsertTriggerBindingIds && spec.upsertTriggerBindingIds.length > 0) {
      patch.upserts.triggerBindings = this.getTriggerBindingsByIds(spec.upsertTriggerBindingIds);
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
    if (spec.deletedTalkIds && spec.deletedTalkIds.length > 0) {
      patch.deletes.talks = [...spec.deletedTalkIds];
    }
    if (spec.deletedSlideIds && spec.deletedSlideIds.length > 0) {
      patch.deletes.slides = [...spec.deletedSlideIds];
    }
    if (spec.deletedTalkScriptBlockIds && spec.deletedTalkScriptBlockIds.length > 0) {
      patch.deletes.talkScriptBlocks = [...spec.deletedTalkScriptBlockIds];
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
    if (spec.deletedCueIds && spec.deletedCueIds.length > 0) {
      patch.deletes.cues = [...spec.deletedCueIds];
    }
    if (spec.deletedMacroIds && spec.deletedMacroIds.length > 0) {
      patch.deletes.macros = [...spec.deletedMacroIds];
    }
    if (spec.deletedTriggerBindingIds && spec.deletedTriggerBindingIds.length > 0) {
      patch.deletes.triggerBindings = [...spec.deletedTriggerBindingIds];
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
    const talks = this.getTalks();
    const itemsById = new Map<Id, DeckItem>([
      ...presentations.map((deck) => [deck.id, deck] as const),
      ...lyrics.map((lyric) => [lyric.id, lyric] as const),
      ...talks.map((talk) => [talk.id, talk] as const),
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

  private getTalksByIds(ids: Id[]): Talk[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at
         FROM talks
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
      type: 'talk',
      themeId: row.theme_id,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) as Talk[];
  }

  private getSlidesByIds(ids: Id[]): Slide[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT s.id, s.presentation_id, s.lyric_id, s.talk_id, s.theme_id, s.overlay_id, s.stage_id, s.kind, s.width, s.height, s.notes, s.background_json, s.background_source, s.order_index, s.created_at, s.updated_at,
                COALESCE(d.order_index, l.order_index, t.order_index) AS content_order
         FROM slides s
         LEFT JOIN presentations d ON d.id = s.presentation_id
         LEFT JOIN lyrics l ON l.id = s.lyric_id
         LEFT JOIN talks t ON t.id = s.talk_id
         WHERE s.id IN (${placeholders})
         ORDER BY content_order ASC, s.order_index ASC`
      )
      .all(...ids) as Array<{
        id: string;
        presentation_id: string | null;
        lyric_id: string | null;
        talk_id: string | null;
        theme_id: string | null;
        overlay_id: string | null;
        stage_id: string | null;
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
      themeId: row.theme_id,
      overlayId: row.overlay_id,
      stageId: row.stage_id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      background: row.background_json ? decodeSlideBackgroundJson(row.background_json, persistedContext('getSnapshot', `slides.${row.id}.background_json`)) : null,
      backgroundSource: (row.background_source ?? 'local') as SlideBackgroundSource,
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
        background: this.getSlideBackgroundBySlideId(slideId),
        animation: normalizeOverlayAnimation(decodeOverlayAnimationJson(row.animation_json, persistedContext('getOverlaysByIds', `overlays.${row.id}.animation_json`))),
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
        background: this.getSlideBackgroundBySlideId(slideId),
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
        `INSERT INTO slides (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, order_index, created_at, updated_at)
         VALUES (?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, '', 0, ?, ?)`
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

  /**
   * Container rows own every element in their tree. Group children are stored
   * inside their parent's payload rather than in `slide_elements`, so they
   * need the same persisted slide-id rewrite as the top-level rows.
   */
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

  /**
   * Delete a container slide and all its slide_elements (used when the
   * owning theme/overlay/stage is deleted).
   */
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

  private assertValidDeckBundleManifest(manifest: DeckBundleManifest, operation: string): void {
    // Structural validation plus playlist-entry owner-column checking is
    // @core/deck-bundles's single named validation entry point for the
    // bundle wire contract; it is the authoritative boundary for bundle
    // shape, field types, enums, and owner-column referential rules. The
    // `operation` reflects the caller (inspect vs finalize) so a failure's
    // error carries the boundary/operation/path that actually produced it.
    validateDeckBundleManifest(manifest, { boundary: 'bundle-import', operation, path: 'manifest' });

    // Referential domain rules that validateDeckBundleManifest intentionally
    // does not mirror: theme existence/compatibility within this manifest.
    const themeIds = new Set<Id>();
    for (const theme of manifest.themes) {
      themeIds.add(theme.id);
    }

    for (const item of manifest.items) {
      if (item.themeId && !themeIds.has(item.themeId)) {
        throw new Error(`Bundle item ${item.title} references a missing theme.`);
      }
      if (item.themeId) {
        const theme = manifest.themes.find((entry) => entry.id === item.themeId) ?? null;
        if (!theme || !isThemeCompatibleWithDeckItem(theme as Theme, item.type)) {
          throw new Error(`Bundle item ${item.title} has an incompatible theme.`);
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

  private getTalks(): Talk[] {
    const rows = this.db
      .prepare(
        'SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at FROM talks ORDER BY order_index ASC, created_at ASC'
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
      type: 'talk',
      themeId: row.theme_id,
      collectionId: row.collection_id,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })) as Talk[];
  }

private getSlides(): Slide[] {
    // Only deck slides (presentation/lyric/talk kind) flow through the snapshot.
    // Theme/overlay/stage slides are surfaced via their owning container's
    // `elements` field instead.
    const rows = this.db
      .prepare(
        `SELECT s.id, s.presentation_id, s.lyric_id, s.talk_id, s.theme_id, s.overlay_id, s.stage_id, s.kind, s.width, s.height, s.notes, s.background_json, s.background_source, s.order_index, s.created_at, s.updated_at,
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
        theme_id: string | null;
        overlay_id: string | null;
        stage_id: string | null;
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
      themeId: row.theme_id,
      overlayId: row.overlay_id,
      stageId: row.stage_id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      background: row.background_json ? decodeSlideBackgroundJson(row.background_json, persistedContext('getSlides', `slides.${row.id}.background_json`)) : null,
      backgroundSource: (row.background_source ?? 'local') as SlideBackgroundSource,
      order: row.order_index,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  private getSlideElements(): SlideElement[] {
    // Scoped to deck-owned slides (presentation/lyric/talk), matching
    // `getSlides()` exactly (see #211). Theme/overlay/stage container
    // elements are surfaced via their owning container's `elements` field
    // instead (`getSlideElementsBySlideId`, used when building Theme/
    // Overlay/Stage records) -- not through this collection. Before #211,
    // this query was unfiltered and returned every `slide_elements` row
    // regardless of owner, which silently disagreed with `getSlides()` and
    // caused #208 (restoreFromSnapshot inserting container elements into
    // deck slides) and #209 (a rollback test whose count included container
    // elements it never created).
    const rows = this.db
      .prepare(
        `SELECT se.*
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

  private getPlaylistGroups(playlistId: Id): PlaylistGroup[] {
    const rows = this.db
      .prepare(
        'SELECT id, playlist_id, name, color_key, order_index, created_at, updated_at FROM playlist_groups WHERE playlist_id = ? ORDER BY order_index ASC'
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

  // Resolves the canonical reference for a full PlaylistEntry, falling back
  // to parsing its legacy owner columns for snapshots restored from an
  // older backup file that predates the `reference` field.
  private resolvePlaylistEntryReference(entry: PlaylistEntry): PlaylistItemReference {
    const provided = (entry as Partial<PlaylistEntry>).reference;
    if (provided) return provided;
    return parsePlaylistItemReference(entry, `playlist entry ${entry.id}`);
  }

  private getPlaylistEntries(groupId: Id): PlaylistEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at FROM playlist_entries WHERE group_id = ? ORDER BY order_index ASC'
      )
      .all(groupId) as Array<{
      id: string;
      group_id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      talk_id: string | null;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => {
      const owner: PlaylistItemOwnerColumns = {
        presentationId: row.presentation_id,
        lyricId: row.lyric_id,
        talkId: row.talk_id,
      };
      const reference = parsePlaylistItemReference(owner, `playlist entry ${row.id}`);
      return {
        id: row.id,
        groupId: row.group_id,
        reference,
        presentationId: row.presentation_id,
        lyricId: row.lyric_id,
        talkId: row.talk_id,
        order: row.order_index,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  }

  private getPlaylistTreesByLibrary(libraryId: Id, itemsById: ReadonlyMap<Id, DeckItem>): PlaylistTree[] {
    return this.getPlaylistsByLibrary(libraryId).map((playlist) => {
      const groups = this.getPlaylistGroups(playlist.id).map((group) => {
        const entries = this.getPlaylistEntries(group.id)
          .map((entry) => {
            const item = itemsById.get(entry.reference.itemId);
            if (!item) return null;
            return { entry, item };
          })
          .filter((value): value is { entry: PlaylistEntry; item: DeckItem } => value !== null);

        return { group, entries };
      });

      return {
        playlist,
        groups
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
        background: this.getSlideBackgroundBySlideId(slideId),
        animation: normalizeOverlayAnimation(decodeOverlayAnimationJson(row.animation_json, persistedContext('getOverlays', `overlays.${row.id}.animation_json`))),
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
        background: this.getSlideBackgroundBySlideId(slideId),
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
        background: this.getSlideBackgroundBySlideId(slideId),
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
        background: this.getSlideBackgroundBySlideId(slideId),
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
      background: this.getSlideBackgroundBySlideId(slideId),
      collectionId: row.collection_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Project backup (#145): complete, deterministic serialization of every
  // application-owned v22 table. All readers are pure — they never mutate the
  // database — and every row field is constructed explicitly (no object
  // spread) so the column mapping is the visible contract. Rows are ordered
  // by (created_at, id) — deterministic for any database state; the ordering
  // metadata the app cares about (order_index etc.) is itself serialized.
  // ---------------------------------------------------------------------------

  /**
   * Produces the complete project-backup document for the active database.
   * Read-only: mutates nothing. Refuses to export unless the database schema
   * version is exactly the supported version, so the produced document can
   * never be a future-version backup, and gates every produced document
   * through `validateProjectBackupDocument` before returning.
   */
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
      tables: {
        libraries: this.readProjectBackupLibraries(),
        presentations: this.readProjectBackupDeckItems('presentations'),
        lyrics: this.readProjectBackupDeckItems('lyrics'),
        talks: this.readProjectBackupDeckItems('talks'),
        slides: this.readProjectBackupSlides(),
        slide_elements: this.readProjectBackupSlideElements(),
        talk_script_blocks: this.readProjectBackupTalkScriptBlocks(),
        playlists: this.readProjectBackupPlaylists(),
        playlist_groups: this.readProjectBackupPlaylistGroups(),
        playlist_entries: this.readProjectBackupPlaylistEntries(),
        image_assets: this.readProjectBackupMediaAssets('image_assets'),
        video_assets: this.readProjectBackupMediaAssets('video_assets'),
        audio_assets: this.readProjectBackupMediaAssets('audio_assets'),
        overlays: this.readProjectBackupOverlays(),
        themes: this.readProjectBackupThemes(),
        stages: this.readProjectBackupStages(),
        cues: this.readProjectBackupCues(),
        actions: this.readProjectBackupActions(),
        action_steps: this.readProjectBackupActionSteps(),
        trigger_bindings: this.readProjectBackupTriggerBindings(),
        deck_collections: this.readProjectBackupCollections('deck_collections'),
        image_collections: this.readProjectBackupCollections('image_collections'),
        video_collections: this.readProjectBackupCollections('video_collections'),
        audio_collections: this.readProjectBackupCollections('audio_collections'),
        theme_collections: this.readProjectBackupCollections('theme_collections'),
        overlay_collections: this.readProjectBackupCollections('overlay_collections'),
        stage_collections: this.readProjectBackupCollections('stage_collections'),
        macro_collections: this.readProjectBackupCollections('macro_collections'),
      },
    };
    return validateProjectBackupDocument(backup);
  }

  /** Validates a project-backup document against the contract without touching the database. */
  validateProjectBackup(backup: unknown): ProjectBackup {
    return validateProjectBackupDocument(backup);
  }

  /**
   * Restores a validated project backup (#146). The active database is never
   * deleted or overwritten in place:
   *
   * 1. The document is validated through the #145 codec, then every required
   *    cross-table reference is checked over the document itself.
   * 2. The rows are inserted into a throwaway same-directory temporary
   *    database (fresh schema at `LATEST_SCHEMA_VERSION`, FK-safe
   *    parent-before-child order, every column mapped explicitly).
   * 3. Before promotion the temporary database must hold exactly the backup's
   *    declared row counts and pass `PRAGMA foreign_key_check`.
   * 4. Promotion checkpoints and closes both connections, renames the active
   *    database to a retained `*.prerecovery-*.sqlite` sibling (never
   *    deleted), renames the temporary database into place, and reopens the
   *    repository on the promoted file. Any failure after the retain step
   *    rolls the swap back so the previous project stays active.
   *
   * `options.hooks` are test-only failure-injection seams; production callers
   * pass no options, so no production-global state is involved. Recovery is
   * not exposed as routine Undo: it is a distinct operation from
   * `restoreFromSnapshot` and returns a full snapshot (plus the retained
   * database path) rather than a `SnapshotPatch`.
   */
  restoreProjectBackup(backup: ProjectBackup, options: RestoreProjectBackupOptions = {}): ProjectRestoreResult {
    const document = validateProjectBackupDocument(backup);
    assertProjectBackupReferences(document);
    assertProjectBackupDefaultCollections(document);

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
   * database into the active path. Both connections are checkpointed and
   * closed first so each main file is coherent on its own; SQLite sidecars
   * (`-wal`/`-shm`) are moved alongside their main files. If the swap fails
   * after the retain, it is rolled back so the previous project remains the
   * active one (and, if even the rollback fails, the retained file still
   * holds the full previous project).
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
    // contains no library rows.
    runMigrations(this.db, this.dbPath);
  }

  private readProjectBackupLibraries(): ProjectBackupLibraryRow[] {
    const rows = this.db
      .prepare('SELECT id, name, order_index, created_at, updated_at FROM libraries ORDER BY created_at ASC, id ASC')
      .all() as Array<{
      id: string;
      name: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupDeckItems(table: 'presentations' | 'lyrics' | 'talks'): ProjectBackupDeckItemRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, theme_id, collection_id, order_index, created_at, updated_at
         FROM ${table}
         ORDER BY created_at ASC, id ASC`,
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

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      theme_id: row.theme_id,
      collection_id: row.collection_id,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupSlides(): ProjectBackupSlideRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height,
                notes, background_json, background_source, order_index, created_at, updated_at
         FROM slides
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      talk_id: string | null;
      theme_id: string | null;
      overlay_id: string | null;
      stage_id: string | null;
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
      presentation_id: row.presentation_id,
      lyric_id: row.lyric_id,
      talk_id: row.talk_id,
      theme_id: row.theme_id,
      overlay_id: row.overlay_id,
      stage_id: row.stage_id,
      kind: row.kind,
      width: row.width,
      height: row.height,
      notes: row.notes,
      background_json: row.background_json,
      background_source: row.background_source as SlideBackgroundSource | null,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupSlideElements(): ProjectBackupSlideElementRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, type, x, y, width, height, rotation, opacity, z_index, layer,
                payload_json, source_theme_element_id, created_at, updated_at
         FROM slide_elements
         ORDER BY created_at ASC, id ASC`,
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
      slide_id: row.slide_id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      opacity: row.opacity,
      z_index: row.z_index,
      layer: row.layer,
      payload_json: row.payload_json,
      source_theme_element_id: row.source_theme_element_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupTalkScriptBlocks(): ProjectBackupTalkScriptBlockRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, slide_id, text, order_index, created_at, updated_at
         FROM talk_script_blocks
         ORDER BY created_at ASC, id ASC`,
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
      slide_id: row.slide_id,
      text: row.text,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupPlaylists(): ProjectBackupPlaylistRow[] {
    const rows = this.db
      .prepare(
        'SELECT id, library_id, name, order_index, created_at, updated_at FROM playlists ORDER BY created_at ASC, id ASC',
      )
      .all() as Array<{
      id: string;
      library_id: string;
      name: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      library_id: row.library_id,
      name: row.name,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupPlaylistGroups(): ProjectBackupPlaylistGroupRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, playlist_id, name, color_key, order_index, created_at, updated_at
         FROM playlist_groups
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
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
      playlist_id: row.playlist_id,
      name: row.name,
      color_key: row.color_key,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupPlaylistEntries(): ProjectBackupPlaylistEntryRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at
         FROM playlist_entries
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      group_id: string;
      presentation_id: string | null;
      lyric_id: string | null;
      talk_id: string | null;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      group_id: row.group_id,
      presentation_id: row.presentation_id,
      lyric_id: row.lyric_id,
      talk_id: row.talk_id,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupMediaAssets(table: MediaAssetTableName): ProjectBackupMediaAssetRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, src, collection_id, order_index, created_at, updated_at
         FROM ${table}
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      src: string;
      collection_id: string;
      order_index: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      src: row.src,
      collection_id: row.collection_id,
      order_index: row.order_index,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupOverlays(): ProjectBackupOverlayRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, enabled, animation_json, collection_id, created_at, updated_at
         FROM overlays
         ORDER BY created_at ASC, id ASC`,
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

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      animation_json: row.animation_json,
      collection_id: row.collection_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupThemes(): ProjectBackupThemeRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, kind, width, height, order_index, collection_id, created_at, updated_at
         FROM themes
         ORDER BY created_at ASC, id ASC`,
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

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as ThemeKind,
      width: row.width,
      height: row.height,
      order_index: row.order_index,
      collection_id: row.collection_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupStages(): ProjectBackupStageRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, width, height, order_index, collection_id, created_at, updated_at
         FROM stages
         ORDER BY created_at ASC, id ASC`,
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

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      width: row.width,
      height: row.height,
      order_index: row.order_index,
      collection_id: row.collection_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupCues(): ProjectBackupCueRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, kind, payload_json, failure_policy, created_at, updated_at
         FROM cues
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
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
      payload_json: row.payload_json,
      failure_policy: row.failure_policy as CueFailurePolicy,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupActions(): ProjectBackupMacroRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, description, collection_id, scope_level, on_scope_exit, loop_enabled, loop_count,
                created_at, updated_at
         FROM actions
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      description: string;
      collection_id: string;
      scope_level: string;
      on_scope_exit: string;
      loop_enabled: number;
      loop_count: number | null;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      collection_id: row.collection_id,
      scope_level: row.scope_level as ScopeLevel,
      on_scope_exit: row.on_scope_exit as OnScopeExit,
      loop_enabled: row.loop_enabled,
      loop_count: row.loop_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupActionSteps(): ProjectBackupMacroStepRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, action_id, kind, payload_json, failure_policy, cue_id, order_index,
                delay_before_ms, delay_after_ms, created_at, updated_at
         FROM action_steps
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      action_id: string;
      kind: string;
      payload_json: string;
      failure_policy: string;
      cue_id: string | null;
      order_index: number;
      delay_before_ms: number;
      delay_after_ms: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      action_id: row.action_id,
      kind: row.kind as CueKind,
      payload_json: row.payload_json,
      failure_policy: row.failure_policy as CueFailurePolicy,
      cue_id: row.cue_id,
      order_index: row.order_index,
      delay_before_ms: row.delay_before_ms,
      delay_after_ms: row.delay_after_ms,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupTriggerBindings(): ProjectBackupTriggerBindingRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at
         FROM trigger_bindings
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      trigger_type: string;
      source_id: string | null;
      target_type: string;
      target_id: string;
      config_json: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      trigger_type: row.trigger_type as TriggerType,
      source_id: row.source_id,
      target_type: row.target_type as TriggerBindingTargetType,
      target_id: row.target_id,
      config_json: row.config_json,
      enabled: row.enabled,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  private readProjectBackupCollections(table: ProjectBackupCollectionTableName): ProjectBackupCollectionRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, order_index, is_default, created_at, updated_at
         FROM ${table}
         ORDER BY created_at ASC, id ASC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      order_index: number;
      is_default: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      order_index: row.order_index,
      is_default: row.is_default,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
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
