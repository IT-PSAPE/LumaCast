import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import {
  PROJECT_BACKUP_FORMAT,
  PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
  PROJECT_BACKUP_VERSION,
  ProjectBackupValidationError,
  validateProjectBackup,
} from '@core/deck-bundles';
import type { DeckBundleManifest, ProjectBackup, ProjectBackupTables } from '@core/types';
import {
  readDeckBundleArchive,
  readProjectBackupArchive,
  writeDeckBundleArchive,
  writeProjectBackupArchive,
} from '../main/deck-bundle-archive';
import { LATEST_SCHEMA_VERSION } from './migrations';
import { CastRepository } from './store';
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

// Recomputes the stored entry's CRC over the current payload bytes and writes
// it back into both the local and central headers, so a test that mutates the
// payload can still pass the archive-layer CRC checks and reach the
// document-validation boundary it is exercising.
function recomputeEntryCrc(bytes: Buffer): void {
  const eocd = bytes.length - 22;
  const centralDirOffset = bytes.readUInt32LE(eocd + 16);
  const localHeaderOffset = bytes.readUInt32LE(centralDirOffset + 42);
  const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
  const extraFieldLength = bytes.readUInt16LE(localHeaderOffset + 28);
  const dataOffset = localHeaderOffset + 30 + localNameLength + extraFieldLength;
  const dataLength = bytes.readUInt32LE(localHeaderOffset + 22);
  const crc = crc32(bytes.subarray(dataOffset, dataOffset + dataLength));
  bytes.writeUInt32LE(crc, localHeaderOffset + 14);
  bytes.writeUInt32LE(crc, centralDirOffset + 16);
}

// ---------------------------------------------------------------------------
// Fixture. Every application-owned v22 table gets a maximally populated,
// fully deterministic row set: fixed ids and fixed ISO timestamps, inserted
// directly through the repository's connection in FK-safe order (parents
// before children). All JSON columns are serialized with JSON.stringify of a
// literal object, and the expected backup below asserts the exact resulting
// strings — proving each field mapping explicitly. `step-4` deliberately
// carries `cue_id: null` (the v22 column has no NOT NULL constraint) so the
// nullable-column contract is exercised by a real exported row.
// ---------------------------------------------------------------------------

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-01T01:00:00.000Z';
const T2 = '2026-01-01T02:00:00.000Z';
const T3 = '2026-01-01T03:00:00.000Z';
const T4 = '2026-01-01T04:00:00.000Z';
const T5 = '2026-01-01T05:00:00.000Z';
const T6 = '2026-01-01T06:00:00.000Z';
const T7 = '2026-01-01T07:00:00.000Z';
const T8 = '2026-01-01T08:00:00.000Z';
const T9 = '2026-01-01T09:00:00.000Z';

const THEME1_BACKGROUND = { type: 'color', color: '#101820' } as const;
const THEME2_BACKGROUND = { type: 'image', mediaAssetId: 'image-2', src: 'cast-media://image-2', fit: 'cover' };
const OVERLAY_SLIDE_BACKGROUND = { type: 'video', mediaAssetId: 'video-1', src: 'cast-media://video-1', fit: 'cover' };
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

const TEXT_PAYLOAD = {
  text: 'Announcements',
  fontFamily: 'Helvetica',
  fontSize: 64,
  color: '#FFFFFF',
  alignment: 'center',
  weight: '700',
};
const IMAGE_PAYLOAD = { src: 'cast-media://image-1', name: 'Logo', visible: true };
const SHAPE_PAYLOAD = { fillColor: '#101820CC', borderColor: '#FFFFFF33', borderWidth: 2, borderRadius: 12 };
const VIDEO_PAYLOAD = {
  src: 'cast-media://video-1',
  autoplay: true,
  loop: false,
  muted: true,
  playbackRate: 1,
};
const RICH_PAYLOAD = {
  text: 'Verse 1',
  fontFamily: 'Helvetica',
  fontSize: 48,
  color: '#FFFFFF',
  alignment: 'left',
  weight: '400',
  format: 'rich',
  richBody: [{ runs: [{ text: 'Verse 1', weight: 700 }], indent: 0 }],
};
const GROUP_PAYLOAD = {
  children: [
    {
      id: 'nested-1',
      slideId: 'slide-pres-2',
      type: 'text',
      x: 0,
      y: 0,
      width: 300,
      height: 40,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      layer: 'content',
      payload: {
        text: 'Child',
        fontFamily: 'Helvetica',
        fontSize: 24,
        color: '#FFFFFF',
        alignment: 'left',
        weight: '400',
      },
      sourceThemeElementId: null,
      createdAt: T3,
      updatedAt: T3,
    },
  ],
};
const THEME_TEXT_PAYLOAD = {
  text: 'Brand',
  fontFamily: 'Helvetica',
  fontSize: 40,
  color: '#FFFFFF',
  alignment: 'left',
  weight: '700',
};
const SONG_TEXT_PAYLOAD = {
  text: 'Song',
  fontFamily: 'Helvetica',
  fontSize: 40,
  color: '#FFFFFF',
  alignment: 'left',
  weight: '400',
};
const LOWER_THIRD_SHAPE_PAYLOAD = { fillColor: '#FF0000', borderColor: '#000000', borderWidth: 1, borderRadius: 0 };
const OVERLAY_TEXT_PAYLOAD = {
  text: 'CAST',
  fontFamily: 'Helvetica',
  fontSize: 28,
  color: '#FFFFFF',
  alignment: 'right',
  weight: '600',
};
const STAGE_TEXT_PAYLOAD = {
  text: 'Stage',
  fontFamily: 'Helvetica',
  fontSize: 24,
  color: '#FFFFFF',
  alignment: 'left',
  weight: '400',
};

const CUE_1_PAYLOAD = { overlayId: 'overlay-1' };
const CUE_2_PAYLOAD = { assetId: 'video-1' };
const CUE_3_PAYLOAD = { action: 'cancel', target: '*' };
const CUE_4_PAYLOAD = { assetId: 'video-1' };
const CUE_5_PAYLOAD = { stageId: 'stage-1' };
const CUE_6_PAYLOAD = { layer: 'media' };
const CUE_7_PAYLOAD = { assetId: 'audio-1' };

const BINDING_1_CONFIG = { runOnExit: true };
const BINDING_3_CONFIG = { note: 'x' };

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
    'INSERT INTO themes (id, name, kind, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('theme-3', 'Lower Third', 'overlays', 1280, 720, 2, 'col-theme-1', T2, T2);

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
  ).run('overlay-1', 'Watermark', 1, JSON.stringify({ kind: 'dissolve', durationMs: 500, autoClearDurationMs: 3000 }), 'col-overlay-1', T0, T0);

  db.prepare(
    'INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('stage-1', 'Audience', 1920, 1080, 0, 'col-stage-1', T0, T0);
  db.prepare(
    'INSERT INTO stages (id, name, width, height, order_index, collection_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('stage-2', 'Stage Left', 1920, 1080, 1, 'col-stage-2', T1, T1);

  db.prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pl-1', 'lib-1', 'Sunday Service', 0, T0, T0);
  db.prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pl-2', 'lib-1', 'Evening', 1, T1, T1);
  db.prepare('INSERT INTO playlists (id, library_id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pl-3', 'lib-2', 'Archive', 0, T2, T2);

  const insertSlide = db.prepare(
    `INSERT INTO slides
       (id, presentation_id, lyric_id, talk_id, theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSlide.run('theme-1:slide', null, null, null, 'theme-1', null, null, 'theme', 1920, 1080, '', JSON.stringify(THEME1_BACKGROUND), null, 0, T0, T0);
  insertSlide.run('theme-2:slide', null, null, null, 'theme-2', null, null, 'theme', 1920, 1080, '', JSON.stringify(THEME2_BACKGROUND), 'local', 0, T1, T1);
  insertSlide.run('theme-3:slide', null, null, null, 'theme-3', null, null, 'theme', 1280, 720, '', null, 'local', 0, T2, T2);
  insertSlide.run('overlay-1:slide', null, null, null, null, 'overlay-1', null, 'overlay', 1920, 1080, '', JSON.stringify(OVERLAY_SLIDE_BACKGROUND), 'local', 0, T3, T3);
  insertSlide.run('stage-1:slide', null, null, null, null, null, 'stage-1', 'stage', 1920, 1080, '', null, 'local', 0, T4, T4);
  insertSlide.run('stage-2:slide', null, null, null, null, null, 'stage-2', 'stage', 1920, 1080, '', null, 'local', 0, T5, T5);
  insertSlide.run('slide-pres-1', 'pres-1', null, null, null, null, null, 'presentation', 1920, 1080, 'Announcement intro', JSON.stringify(THEME1_BACKGROUND), 'theme', 0, T6, T6);
  insertSlide.run('slide-pres-2', 'pres-1', null, null, null, null, null, 'presentation', 1920, 1080, '', JSON.stringify(GRADIENT_BACKGROUND), 'local', 1, T7, T7);
  insertSlide.run('slide-lyric-1', null, 'lyric-1', null, null, null, null, 'lyric', 1920, 1080, '', JSON.stringify(THEME2_BACKGROUND), 'theme', 0, T8, T8);
  insertSlide.run('slide-talk-1', null, null, 'talk-1', null, null, null, 'talk', 1920, 1080, 'Big sermon', null, 'local', 0, T9, T9);

  db.prepare(
    'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('grp-1', 'pl-1', 'Opening', 'blue', 0, T0, T0);
  db.prepare(
    'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('grp-2', 'pl-1', 'Closing', null, 1, T1, T1);
  db.prepare(
    'INSERT INTO playlist_groups (id, playlist_id, name, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('grp-3', 'pl-3', 'All', null, 0, T2, T2);

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
    'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-4', 'grp-2', 'pres-2', null, null, 0, T3, T3);
  db.prepare(
    'INSERT INTO playlist_entries (id, group_id, presentation_id, lyric_id, talk_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-5', 'grp-3', null, null, 'talk-1', 0, T4, T4);

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
  insertElement.run('t-elem-1', 'theme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(THEME_TEXT_PAYLOAD), null, T0, T0);
  insertElement.run('t-elem-2', 'theme-2:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(SONG_TEXT_PAYLOAD), null, T1, T1);
  insertElement.run('t-elem-3', 'theme-3:slide', 'shape', 0, 0, 1280, 120, 0, 1, 1, 'background', JSON.stringify(LOWER_THIRD_SHAPE_PAYLOAD), null, T2, T2);
  insertElement.run('o-elem-1', 'overlay-1:slide', 'text', 1540, 1010, 340, 40, 0, 0.65, 999, 'content', JSON.stringify(OVERLAY_TEXT_PAYLOAD), null, T3, T3);
  insertElement.run('st-elem-1', 'stage-1:slide', 'text', 10, 10, 400, 40, 0, 1, 2, 'content', JSON.stringify(STAGE_TEXT_PAYLOAD), null, T4, T4);
  insertElement.run('elem-pres-1', 'slide-pres-1', 'text', 100, 200, 800, 60, 0, 1, 10, 'content', JSON.stringify(TEXT_PAYLOAD), 't-elem-1', T0, T0);
  insertElement.run('elem-pres-2', 'slide-pres-1', 'image', 10, 10, 200, 200, 0, 0.8, 5, 'media', JSON.stringify(IMAGE_PAYLOAD), null, T1, T1);
  insertElement.run('elem-pres-3', 'slide-pres-2', 'shape', 0, 0, 1920, 1080, 0, 1, 1, 'background', JSON.stringify(SHAPE_PAYLOAD), null, T2, T2);
  insertElement.run('elem-pres-4', 'slide-pres-2', 'group', 50, 50, 400, 300, 0, 1, 3, 'content', JSON.stringify(GROUP_PAYLOAD), null, T3, T3);
  insertElement.run('elem-lyric-1', 'slide-lyric-1', 'text', 100, 100, 900, 60, 0, 1, 10, 'content', JSON.stringify(RICH_PAYLOAD), 't-elem-2', T4, T4);
  insertElement.run('elem-talk-1', 'slide-talk-1', 'video', 0, 0, 800, 450, 0, 1, 5, 'media', JSON.stringify(VIDEO_PAYLOAD), null, T5, T5);

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
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-4', 'video.arm', JSON.stringify(CUE_4_PAYLOAD), 'continue', T3, T3);
  db.prepare(
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-5', 'stage.set', JSON.stringify(CUE_5_PAYLOAD), 'continue', T4, T4);
  db.prepare(
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-6', 'layer.clear', JSON.stringify(CUE_6_PAYLOAD), 'continue', T5, T5);
  db.prepare(
    'INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('cue-7', 'audio.arm', JSON.stringify(CUE_7_PAYLOAD), 'continue', T6, T6);

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
  ).run('step-3', 'macro-2', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', 'cue-3', 0, 0, 0, T2, T2);
  db.prepare(
    `INSERT INTO action_steps
       (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-4', 'macro-2', 'layer.clear', JSON.stringify(CUE_6_PAYLOAD), 'continue', null, 1, 100, 100, T3, T3);

  db.prepare(
    `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-1', 'slide.take', null, 'macro', 'macro-1', JSON.stringify(BINDING_1_CONFIG), 1, T0, T0);
  db.prepare(
    `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-2', 'slide.activate', 'slide-pres-1', 'cue', 'cue-4', '{}', 0, T1, T1);
  db.prepare(
    `INSERT INTO trigger_bindings
       (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-3', 'app.startup', null, 'macro', 'macro-2', JSON.stringify(BINDING_3_CONFIG), 1, T2, T2);
}

// ---------------------------------------------------------------------------
// Expected tables: the exact rows above, in (created_at, id) order, with every
// column written out explicitly. Each row literal is the named assertion for
// its table/column mapping.
// ---------------------------------------------------------------------------

const EXPECTED_TABLES: ProjectBackupTables = {
  libraries: [
    { id: 'lib-1', name: 'Main Library', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'lib-2', name: 'Archives', order_index: 1, created_at: T1, updated_at: T2 },
  ],
  presentations: [
    { id: 'pres-1', title: 'Announcements', theme_id: 'theme-1', collection_id: 'col-deck-1', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'pres-2', title: 'Welcome', theme_id: null, collection_id: 'col-deck-2', order_index: 1, created_at: T1, updated_at: T1 },
  ],
  lyrics: [
    { id: 'lyric-1', title: 'Great Is Thy Faithfulness', theme_id: 'theme-2', collection_id: 'col-deck-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  talks: [
    { id: 'talk-1', title: 'Sunday Sermon', theme_id: null, collection_id: 'col-deck-2', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  slides: [
    { id: 'theme-1:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: 'theme-1', overlay_id: null, stage_id: null, kind: 'theme', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(THEME1_BACKGROUND), background_source: null, order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'theme-2:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: 'theme-2', overlay_id: null, stage_id: null, kind: 'theme', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(THEME2_BACKGROUND), background_source: 'local', order_index: 0, created_at: T1, updated_at: T1 },
    { id: 'theme-3:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: 'theme-3', overlay_id: null, stage_id: null, kind: 'theme', width: 1280, height: 720, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T2, updated_at: T2 },
    { id: 'overlay-1:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: null, overlay_id: 'overlay-1', stage_id: null, kind: 'overlay', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(OVERLAY_SLIDE_BACKGROUND), background_source: 'local', order_index: 0, created_at: T3, updated_at: T3 },
    { id: 'stage-1:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: null, overlay_id: null, stage_id: 'stage-1', kind: 'stage', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T4, updated_at: T4 },
    { id: 'stage-2:slide', presentation_id: null, lyric_id: null, talk_id: null, theme_id: null, overlay_id: null, stage_id: 'stage-2', kind: 'stage', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T5, updated_at: T5 },
    { id: 'slide-pres-1', presentation_id: 'pres-1', lyric_id: null, talk_id: null, theme_id: null, overlay_id: null, stage_id: null, kind: 'presentation', width: 1920, height: 1080, notes: 'Announcement intro', background_json: JSON.stringify(THEME1_BACKGROUND), background_source: 'theme', order_index: 0, created_at: T6, updated_at: T6 },
    { id: 'slide-pres-2', presentation_id: 'pres-1', lyric_id: null, talk_id: null, theme_id: null, overlay_id: null, stage_id: null, kind: 'presentation', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(GRADIENT_BACKGROUND), background_source: 'local', order_index: 1, created_at: T7, updated_at: T7 },
    { id: 'slide-lyric-1', presentation_id: null, lyric_id: 'lyric-1', talk_id: null, theme_id: null, overlay_id: null, stage_id: null, kind: 'lyric', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(THEME2_BACKGROUND), background_source: 'theme', order_index: 0, created_at: T8, updated_at: T8 },
    { id: 'slide-talk-1', presentation_id: null, lyric_id: null, talk_id: 'talk-1', theme_id: null, overlay_id: null, stage_id: null, kind: 'talk', width: 1920, height: 1080, notes: 'Big sermon', background_json: null, background_source: 'local', order_index: 0, created_at: T9, updated_at: T9 },
  ],
  slide_elements: [
    { id: 'elem-pres-1', slide_id: 'slide-pres-1', type: 'text', x: 100, y: 200, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 10, layer: 'content', payload_json: JSON.stringify(TEXT_PAYLOAD), source_theme_element_id: 't-elem-1', created_at: T0, updated_at: T0 },
    { id: 't-elem-1', slide_id: 'theme-1:slide', type: 'text', x: 100, y: 100, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(THEME_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T0, updated_at: T0 },
    { id: 'elem-pres-2', slide_id: 'slide-pres-1', type: 'image', x: 10, y: 10, width: 200, height: 200, rotation: 0, opacity: 0.8, z_index: 5, layer: 'media', payload_json: JSON.stringify(IMAGE_PAYLOAD), source_theme_element_id: null, created_at: T1, updated_at: T1 },
    { id: 't-elem-2', slide_id: 'theme-2:slide', type: 'text', x: 100, y: 100, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(SONG_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T1, updated_at: T1 },
    { id: 'elem-pres-3', slide_id: 'slide-pres-2', type: 'shape', x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, z_index: 1, layer: 'background', payload_json: JSON.stringify(SHAPE_PAYLOAD), source_theme_element_id: null, created_at: T2, updated_at: T2 },
    { id: 't-elem-3', slide_id: 'theme-3:slide', type: 'shape', x: 0, y: 0, width: 1280, height: 120, rotation: 0, opacity: 1, z_index: 1, layer: 'background', payload_json: JSON.stringify(LOWER_THIRD_SHAPE_PAYLOAD), source_theme_element_id: null, created_at: T2, updated_at: T2 },
    { id: 'elem-pres-4', slide_id: 'slide-pres-2', type: 'group', x: 50, y: 50, width: 400, height: 300, rotation: 0, opacity: 1, z_index: 3, layer: 'content', payload_json: JSON.stringify(GROUP_PAYLOAD), source_theme_element_id: null, created_at: T3, updated_at: T3 },
    { id: 'o-elem-1', slide_id: 'overlay-1:slide', type: 'text', x: 1540, y: 1010, width: 340, height: 40, rotation: 0, opacity: 0.65, z_index: 999, layer: 'content', payload_json: JSON.stringify(OVERLAY_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T3, updated_at: T3 },
    { id: 'elem-lyric-1', slide_id: 'slide-lyric-1', type: 'text', x: 100, y: 100, width: 900, height: 60, rotation: 0, opacity: 1, z_index: 10, layer: 'content', payload_json: JSON.stringify(RICH_PAYLOAD), source_theme_element_id: 't-elem-2', created_at: T4, updated_at: T4 },
    { id: 'st-elem-1', slide_id: 'stage-1:slide', type: 'text', x: 10, y: 10, width: 400, height: 40, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(STAGE_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T4, updated_at: T4 },
    { id: 'elem-talk-1', slide_id: 'slide-talk-1', type: 'video', x: 0, y: 0, width: 800, height: 450, rotation: 0, opacity: 1, z_index: 5, layer: 'media', payload_json: JSON.stringify(VIDEO_PAYLOAD), source_theme_element_id: null, created_at: T5, updated_at: T5 },
  ],
  talk_script_blocks: [
    { id: 'block-1', slide_id: 'slide-talk-1', text: 'Welcome everyone', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'block-2', slide_id: 'slide-talk-1', text: 'Then we pray', order_index: 1, created_at: T1, updated_at: T1 },
  ],
  playlists: [
    { id: 'pl-1', library_id: 'lib-1', name: 'Sunday Service', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'pl-2', library_id: 'lib-1', name: 'Evening', order_index: 1, created_at: T1, updated_at: T1 },
    { id: 'pl-3', library_id: 'lib-2', name: 'Archive', order_index: 0, created_at: T2, updated_at: T2 },
  ],
  playlist_groups: [
    { id: 'grp-1', playlist_id: 'pl-1', name: 'Opening', color_key: 'blue', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'grp-2', playlist_id: 'pl-1', name: 'Closing', color_key: null, order_index: 1, created_at: T1, updated_at: T1 },
    { id: 'grp-3', playlist_id: 'pl-3', name: 'All', color_key: null, order_index: 0, created_at: T2, updated_at: T2 },
  ],
  playlist_entries: [
    { id: 'entry-1', group_id: 'grp-1', presentation_id: 'pres-1', lyric_id: null, talk_id: null, order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'entry-2', group_id: 'grp-1', presentation_id: null, lyric_id: 'lyric-1', talk_id: null, order_index: 1, created_at: T1, updated_at: T1 },
    { id: 'entry-3', group_id: 'grp-1', presentation_id: null, lyric_id: null, talk_id: 'talk-1', order_index: 2, created_at: T2, updated_at: T2 },
    { id: 'entry-4', group_id: 'grp-2', presentation_id: 'pres-2', lyric_id: null, talk_id: null, order_index: 0, created_at: T3, updated_at: T3 },
    { id: 'entry-5', group_id: 'grp-3', presentation_id: null, lyric_id: null, talk_id: 'talk-1', order_index: 0, created_at: T4, updated_at: T4 },
  ],
  image_assets: [
    { id: 'image-1', name: 'Logo', src: 'cast-media://image-1', collection_id: 'col-image-1', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'image-2', name: 'Backdrop', src: 'cast-media://image-2', collection_id: 'col-image-2', order_index: 1, created_at: T1, updated_at: T1 },
  ],
  video_assets: [
    { id: 'video-1', name: 'Intro', src: 'cast-media://video-1', collection_id: 'col-video-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  audio_assets: [
    { id: 'audio-1', name: 'Sting', src: 'cast-media://audio-1', collection_id: 'col-audio-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  overlays: [
    { id: 'overlay-1', name: 'Watermark', enabled: 1, animation_json: JSON.stringify({ kind: 'dissolve', durationMs: 500, autoClearDurationMs: 3000 }), collection_id: 'col-overlay-1', created_at: T0, updated_at: T0 },
  ],
  themes: [
    { id: 'theme-1', name: 'Brand', kind: 'slides', width: 1920, height: 1080, order_index: 0, collection_id: 'col-theme-1', created_at: T0, updated_at: T1 },
    { id: 'theme-2', name: 'Song Background', kind: 'lyrics', width: 1920, height: 1080, order_index: 1, collection_id: 'col-theme-2', created_at: T1, updated_at: T1 },
    { id: 'theme-3', name: 'Lower Third', kind: 'overlays', width: 1280, height: 720, order_index: 2, collection_id: 'col-theme-1', created_at: T2, updated_at: T2 },
  ],
  stages: [
    { id: 'stage-1', name: 'Audience', width: 1920, height: 1080, order_index: 0, collection_id: 'col-stage-1', created_at: T0, updated_at: T0 },
    { id: 'stage-2', name: 'Stage Left', width: 1920, height: 1080, order_index: 1, collection_id: 'col-stage-2', created_at: T1, updated_at: T1 },
  ],
  cues: [
    { id: 'cue-1', kind: 'overlay.activate', payload_json: JSON.stringify(CUE_1_PAYLOAD), failure_policy: 'continue', created_at: T0, updated_at: T0 },
    { id: 'cue-2', kind: 'mediaLayer.set', payload_json: JSON.stringify(CUE_2_PAYLOAD), failure_policy: 'abort', created_at: T1, updated_at: T1 },
    { id: 'cue-3', kind: 'flow.lifecycle', payload_json: JSON.stringify(CUE_3_PAYLOAD), failure_policy: 'continue', created_at: T2, updated_at: T2 },
    { id: 'cue-4', kind: 'video.arm', payload_json: JSON.stringify(CUE_4_PAYLOAD), failure_policy: 'continue', created_at: T3, updated_at: T3 },
    { id: 'cue-5', kind: 'stage.set', payload_json: JSON.stringify(CUE_5_PAYLOAD), failure_policy: 'continue', created_at: T4, updated_at: T4 },
    { id: 'cue-6', kind: 'layer.clear', payload_json: JSON.stringify(CUE_6_PAYLOAD), failure_policy: 'continue', created_at: T5, updated_at: T5 },
    { id: 'cue-7', kind: 'audio.arm', payload_json: JSON.stringify(CUE_7_PAYLOAD), failure_policy: 'continue', created_at: T6, updated_at: T6 },
  ],
  actions: [
    { id: 'macro-1', name: 'Run Service Cues', description: 'Auto-advance service', collection_id: 'col-macro-1', scope_level: 'global', on_scope_exit: 'cancel', loop_enabled: 0, loop_count: null, created_at: T0, updated_at: T0 },
    { id: 'macro-2', name: 'Slide Loop', description: 'Loop the slide', collection_id: 'col-macro-2', scope_level: 'slide', on_scope_exit: 'revert', loop_enabled: 1, loop_count: 3, created_at: T1, updated_at: T1 },
  ],
  action_steps: [
    { id: 'step-1', action_id: 'macro-1', kind: 'overlay.activate', payload_json: JSON.stringify(CUE_1_PAYLOAD), failure_policy: 'continue', cue_id: 'cue-1', order_index: 0, delay_before_ms: 0, delay_after_ms: 250, created_at: T0, updated_at: T0 },
    { id: 'step-2', action_id: 'macro-1', kind: 'mediaLayer.set', payload_json: JSON.stringify(CUE_2_PAYLOAD), failure_policy: 'abort', cue_id: 'cue-2', order_index: 1, delay_before_ms: 500, delay_after_ms: 0, created_at: T1, updated_at: T1 },
    { id: 'step-3', action_id: 'macro-2', kind: 'flow.lifecycle', payload_json: JSON.stringify(CUE_3_PAYLOAD), failure_policy: 'continue', cue_id: 'cue-3', order_index: 0, delay_before_ms: 0, delay_after_ms: 0, created_at: T2, updated_at: T2 },
    { id: 'step-4', action_id: 'macro-2', kind: 'layer.clear', payload_json: JSON.stringify(CUE_6_PAYLOAD), failure_policy: 'continue', cue_id: null, order_index: 1, delay_before_ms: 100, delay_after_ms: 100, created_at: T3, updated_at: T3 },
  ],
  trigger_bindings: [
    { id: 'binding-1', trigger_type: 'slide.take', source_id: null, target_type: 'macro', target_id: 'macro-1', config_json: JSON.stringify(BINDING_1_CONFIG), enabled: 1, created_at: T0, updated_at: T0 },
    { id: 'binding-2', trigger_type: 'slide.activate', source_id: 'slide-pres-1', target_type: 'cue', target_id: 'cue-4', config_json: '{}', enabled: 0, created_at: T1, updated_at: T1 },
    { id: 'binding-3', trigger_type: 'app.startup', source_id: null, target_type: 'macro', target_id: 'macro-2', config_json: JSON.stringify(BINDING_3_CONFIG), enabled: 1, created_at: T2, updated_at: T2 },
  ],
  deck_collections: [
    { id: 'col-deck-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
    { id: 'col-deck-2', name: 'Worship', order_index: 1, is_default: 0, created_at: T1, updated_at: T1 },
  ],
  image_collections: [
    { id: 'col-image-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
    { id: 'col-image-2', name: 'Backdrops', order_index: 1, is_default: 0, created_at: T1, updated_at: T1 },
  ],
  video_collections: [
    { id: 'col-video-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
  ],
  audio_collections: [
    { id: 'col-audio-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
  ],
  theme_collections: [
    { id: 'col-theme-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
    { id: 'col-theme-2', name: 'Branding', order_index: 1, is_default: 0, created_at: T1, updated_at: T1 },
  ],
  overlay_collections: [
    { id: 'col-overlay-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
  ],
  stage_collections: [
    { id: 'col-stage-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
    { id: 'col-stage-2', name: 'Stage Areas', order_index: 1, is_default: 0, created_at: T1, updated_at: T1 },
  ],
  macro_collections: [
    { id: 'col-macro-1', name: 'Default Collection', order_index: 0, is_default: 1, created_at: T0, updated_at: T0 },
    { id: 'col-macro-2', name: 'Service Macros', order_index: 1, is_default: 0, created_at: T1, updated_at: T1 },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumacast-project-backup-'));
  repo = makeRepo(tmpDir);
  seedMaximalFixture(rawDb(repo));
});

afterEach(() => {
  closeRepo(repo);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('project backup serialization (#145)', () => {
  it('produces the exact expected document for the maximally populated fixture (envelope + all 28 tables)', () => {
    const backup = repo.exportProjectBackup();

    expect(backup).toEqual({
      format: PROJECT_BACKUP_FORMAT,
      version: PROJECT_BACKUP_VERSION,
      schemaVersion: LATEST_SCHEMA_VERSION,
      tables: EXPECTED_TABLES,
    });
  });

  it('maps libraries, deck items, and their collections fields explicitly', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.libraries).toEqual(EXPECTED_TABLES.libraries);
    expect(tables.presentations).toEqual(EXPECTED_TABLES.presentations);
    expect(tables.lyrics).toEqual(EXPECTED_TABLES.lyrics);
    expect(tables.talks).toEqual(EXPECTED_TABLES.talks);
    expect(tables.deck_collections).toEqual(EXPECTED_TABLES.deck_collections);
    expect(tables.image_collections).toEqual(EXPECTED_TABLES.image_collections);
    expect(tables.video_collections).toEqual(EXPECTED_TABLES.video_collections);
    expect(tables.audio_collections).toEqual(EXPECTED_TABLES.audio_collections);
    expect(tables.theme_collections).toEqual(EXPECTED_TABLES.theme_collections);
    expect(tables.overlay_collections).toEqual(EXPECTED_TABLES.overlay_collections);
    expect(tables.stage_collections).toEqual(EXPECTED_TABLES.stage_collections);
    expect(tables.macro_collections).toEqual(EXPECTED_TABLES.macro_collections);
  });

  it('maps slides (deck and container), elements with provenance, and script blocks field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.slides).toEqual(EXPECTED_TABLES.slides);
    expect(tables.slide_elements).toEqual(EXPECTED_TABLES.slide_elements);
    expect(tables.talk_script_blocks).toEqual(EXPECTED_TABLES.talk_script_blocks);
  });

  it('maps playlist trees, entries with owner columns, and metadata/order field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.playlists).toEqual(EXPECTED_TABLES.playlists);
    expect(tables.playlist_groups).toEqual(EXPECTED_TABLES.playlist_groups);
    expect(tables.playlist_entries).toEqual(EXPECTED_TABLES.playlist_entries);
  });

  it('maps media assets (references/metadata only, never media files) and container assets field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.image_assets).toEqual(EXPECTED_TABLES.image_assets);
    expect(tables.video_assets).toEqual(EXPECTED_TABLES.video_assets);
    expect(tables.audio_assets).toEqual(EXPECTED_TABLES.audio_assets);
    for (const table of ['image_assets', 'video_assets', 'audio_assets'] as const) {
      for (const row of tables[table]) {
        expect(row.src, `${table} src must be a reference, not a payload`).toMatch(/^cast-media:\/\//);
      }
    }
  });

  it('maps themes, overlays, stages, and their backgrounds field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.themes).toEqual(EXPECTED_TABLES.themes);
    expect(tables.overlays).toEqual(EXPECTED_TABLES.overlays);
    expect(tables.stages).toEqual(EXPECTED_TABLES.stages);
  });

  it('maps cues, macros, macro steps, and trigger bindings field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.cues).toEqual(EXPECTED_TABLES.cues);
    expect(tables.actions).toEqual(EXPECTED_TABLES.actions);
    expect(tables.action_steps).toEqual(EXPECTED_TABLES.action_steps);
    expect(tables.trigger_bindings).toEqual(EXPECTED_TABLES.trigger_bindings);
  });

  it('serializes deterministically: repeated exports of unchanged data are byte-for-byte identical', () => {
    const first = repo.exportProjectBackup();
    const second = repo.exportProjectBackup();

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('refuses to export when the database schema version is not exactly the supported one', () => {
    rawDb(repo).exec(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION - 1}`);

    expect(() => repo.exportProjectBackup()).toThrow(/does not match the supported version/);
  });

  it('gates the produced document through its own validator before returning', () => {
    // The cues table carries no CHECK constraint on failure_policy, so a
    // rogue value can only reach the export boundary in raw database state.
    // The export's self-validation gate must reject it.
    const db = rawDb(repo);
    db.prepare(
      `INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at)
       VALUES ('cue-rogue', 'layer.clear', '{}', 'bogus', ?, ?)`,
    ).run(T0, T0);

    expect(() => repo.exportProjectBackup()).toThrow(ProjectBackupValidationError);
    expect(() => repo.exportProjectBackup()).toThrow(/failure_policy must be one of/);
  });

  it('does not mutate the active repository (pre/post snapshot equality)', () => {
    const before = repo.getSnapshot();

    const backup = repo.exportProjectBackup();
    repo.validateProjectBackup(backup);
    repo.validateProjectBackup(JSON.parse(JSON.stringify(backup)));

    expect(repo.getSnapshot()).toEqual(before);
  });

  it('validates the produced document without touching the database', () => {
    const backup = repo.exportProjectBackup();

    expect(repo.validateProjectBackup(backup)).toBe(backup);
    expect(validateProjectBackup(backup)).toBe(backup);
    expect(validateProjectBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
  });
});

describe('project backup validation (#145)', () => {
  it('keeps the core-supported schema version in lockstep with the database migrations', () => {
    expect(PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION).toBe(LATEST_SCHEMA_VERSION);
  });

  it('rejects a future backup format version', () => {
    const backup = repo.exportProjectBackup();
    const future = { ...backup, version: 2 };

    expect(() => validateProjectBackup(future)).toThrow(ProjectBackupValidationError);
    expect(() => validateProjectBackup(future)).toThrow(/Future backup format version 2/);
    expect(() => repo.validateProjectBackup(future)).toThrow(/Future backup format version 2/);
  });

  it('rejects an unknown backup format and an unsupported version value', () => {
    const backup = repo.exportProjectBackup();

    expect(() => validateProjectBackup({ ...backup, format: 'cast-deck-bundle' })).toThrow(
      /Unsupported backup format/,
    );
    expect(() => validateProjectBackup({ ...backup, version: 0 })).toThrow(/Unsupported backup format version/);
    expect(() => validateProjectBackup({ ...backup, version: '1' })).toThrow(/Unsupported backup format version/);
  });

  it('rejects any schema version other than the exact supported one', () => {
    const backup = repo.exportProjectBackup();

    expect(() => validateProjectBackup({ ...backup, schemaVersion: 23 })).toThrow(/schema version/);
    expect(() => validateProjectBackup({ ...backup, schemaVersion: 21 })).toThrow(/schema version/);
    expect(() => validateProjectBackup({ ...backup, schemaVersion: 0 })).toThrow(/schema version/);
    expect(() => validateProjectBackup({ ...backup, schemaVersion: 1.5 })).toThrow(/schema version/);
  });

  it('rejects documents that are not plain objects or lack the envelope', () => {
    expect(() => validateProjectBackup(null)).toThrow(/must be an object/);
    expect(() => validateProjectBackup('nope')).toThrow(/must be an object/);
    expect(() => validateProjectBackup([])).toThrow(/must be an object/);

    const backup = repo.exportProjectBackup();
    expect(() => validateProjectBackup({ ...backup, format: undefined })).toThrow(/Unsupported backup format/);
    expect(() => validateProjectBackup({ ...backup, schemaVersion: undefined })).toThrow(/schema version/);
    expect(() => validateProjectBackup({ ...backup, tables: undefined })).toThrow(/tables must be an object/);
  });

  it('rejects a document with a rogue or missing envelope key', () => {
    const backup = repo.exportProjectBackup();

    // The exact four-key envelope check catches both a rogue key and a
    // missing one.
    const rogue = { ...backup, rogueKey: 1 };
    expect(() => validateProjectBackup(rogue)).toThrow(/envelope must have exactly the keys/);

    const missingTables = { ...backup };
    delete (missingTables as Partial<ProjectBackup>).tables;
    expect(() => validateProjectBackup(missingTables)).toThrow(/envelope must have exactly the keys/);

    // Required-field discriminant checks run first and keep their useful
    // messages.
    const missingVersion = { ...backup };
    delete (missingVersion as Partial<ProjectBackup>).version;
    expect(() => validateProjectBackup(missingVersion)).toThrow(/Unsupported backup format version/);
  });

  it('rejects missing or extra tables in the tables object', () => {
    const backup = repo.exportProjectBackup();

    const missing = { ...backup, tables: { ...backup.tables } };
    delete (missing.tables as Partial<ProjectBackupTables>).image_collections;
    expect(() => validateProjectBackup(missing)).toThrow(/must have exactly/);

    const extra = { ...backup, tables: { ...backup.tables, rogue_table: [] } };
    expect(() => validateProjectBackup(extra)).toThrow(/must have exactly/);

    expect(() => validateProjectBackup({ ...backup, tables: [] })).toThrow(/tables must be an object/);
    expect(() => validateProjectBackup({ ...backup, tables: { ...backup.tables, libraries: 'nope' } })).toThrow(
      /tables\.libraries must be an array/,
    );
  });

  it('rejects rows with missing or extra columns', () => {
    const backup = repo.exportProjectBackup();

    const missingColumn = { ...backup, tables: { ...backup.tables, libraries: [{ id: 'lib-1', name: 'Main Library', order_index: 0, created_at: T0 }] } };
    expect(() => validateProjectBackup(missingColumn)).toThrow(/must have exactly the columns/);

    const extraColumn = {
      ...backup,
      tables: {
        ...backup.tables,
        libraries: [{ ...backup.tables.libraries[0], rogue: 1 }],
      },
    };
    expect(() => validateProjectBackup(extraColumn)).toThrow(/must have exactly the columns/);
  });

  it('rejects row values that violate the column contract', () => {
    const backup = repo.exportProjectBackup();

    const nullName = { ...backup, tables: { ...backup.tables, libraries: [{ ...backup.tables.libraries[0], name: null }] } };
    expect(() => validateProjectBackup(nullName)).toThrow(/libraries\[0\]\.name must not be null/);

    const badEnum = { ...backup, tables: { ...backup.tables, slides: [{ ...backup.tables.slides[0], kind: 'banana' }] } };
    expect(() => validateProjectBackup(badEnum)).toThrow(/slides\[0\]\.kind must be one of/);

    const badFlag = { ...backup, tables: { ...backup.tables, overlays: [{ ...backup.tables.overlays[0], enabled: 2 }] } };
    expect(() => validateProjectBackup(badFlag)).toThrow(/overlays\[0\]\.enabled must be 0 or 1/);

    const badJson = { ...backup, tables: { ...backup.tables, cues: [{ ...backup.tables.cues[0], payload_json: '{oops' }] } };
    expect(() => validateProjectBackup(badJson)).toThrow(/cues\[0\]\.payload_json is not valid JSON/);

    const badType = { ...backup, tables: { ...backup.tables, playlists: [{ ...backup.tables.playlists[0], order_index: 'zero' }] } };
    expect(() => validateProjectBackup(badType)).toThrow(/playlists\[0\]\.order_index must be a finite number/);
  });

  it('rejects slide rows without exactly one owner (mirroring the schema CHECK)', () => {
    const backup = repo.exportProjectBackup();

    const noOwner = { ...backup, tables: { ...backup.tables, slides: [{ ...backup.tables.slides[0], theme_id: null }] } };
    expect(() => validateProjectBackup(noOwner)).toThrow(/slides\[0\] must have exactly one owner/);

    const twoOwners = {
      ...backup,
      tables: {
        ...backup.tables,
        slides: [{ ...backup.tables.slides[0], presentation_id: 'pres-1' }],
      },
    };
    expect(() => validateProjectBackup(twoOwners)).toThrow(/slides\[0\] must have exactly one owner/);
  });

  it('accepts a null cue_id on an action step (v22 column has no NOT NULL constraint)', () => {
    const backup = repo.exportProjectBackup();

    const withNullCueId = {
      ...backup,
      tables: {
        ...backup.tables,
        action_steps: [{ ...backup.tables.action_steps[0], cue_id: null }],
      },
    };
    expect(validateProjectBackup(withNullCueId)).toEqual(withNullCueId);
  });
});

describe('project backup archive (#145)', () => {
  it('round-trips a produced backup through the archive unchanged', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'project-backup.pbc');

    await writeProjectBackupArchive(archivePath, backup);
    const read = await readProjectBackupArchive(archivePath);

    expect(read).toEqual(backup);
  });

  it('rejects a future-version backup at the archive write boundary and at read', async () => {
    const backup = repo.exportProjectBackup();
    const future = { ...backup, version: 2 } as unknown as ProjectBackup;

    const writePath = path.join(tmpDir, 'future-write.pbc');
    await expect(writeProjectBackupArchive(writePath, future)).rejects.toThrow(ProjectBackupValidationError);
    await expect(writeProjectBackupArchive(writePath, future)).rejects.toThrow(/Future backup format version 2/);
    expect(fs.existsSync(writePath)).toBe(false);

    // Core read validation remains covered: patch a valid archive's envelope
    // to a future format version, keep the entry CRC coherent so the
    // archive-layer checks pass, and confirm read still rejects it.
    const validPath = path.join(tmpDir, 'valid.pbc');
    await writeProjectBackupArchive(validPath, backup);
    const bytes = fs.readFileSync(validPath);
    const needle = Buffer.from('"version": 1', 'utf8');
    const needleIndex = bytes.indexOf(needle);
    expect(needleIndex).toBeGreaterThanOrEqual(0);
    bytes.write('"version": 2', needleIndex, 'utf8');
    recomputeEntryCrc(bytes);
    const futureReadPath = path.join(tmpDir, 'future-read.pbc');
    fs.writeFileSync(futureReadPath, bytes);

    await expect(readProjectBackupArchive(futureReadPath)).rejects.toThrow(ProjectBackupValidationError);
    await expect(readProjectBackupArchive(futureReadPath)).rejects.toThrow(/Future backup format version 2/);
  });

  it('rejects archives with truncated or missing zip metadata', async () => {
    const backup = repo.exportProjectBackup();

    // EOCD record cut short: the signature is present but the record is incomplete.
    const truncatedPath = path.join(tmpDir, 'truncated.pbc');
    await writeProjectBackupArchive(truncatedPath, backup);
    const truncated = fs.readFileSync(truncatedPath);
    fs.writeFileSync(truncatedPath, truncated.subarray(0, truncated.length - 1));
    await expect(readProjectBackupArchive(truncatedPath)).rejects.toThrow(/Invalid bundle archive/);

    // Only the bare EOCD signature, no record at all.
    const barePath = path.join(tmpDir, 'bare-eocd.pbc');
    fs.writeFileSync(barePath, Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    await expect(readProjectBackupArchive(barePath)).rejects.toThrow(/Invalid bundle archive/);
  });

  it('rejects archives whose offsets or lengths point outside the archive', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'out-of-range.pbc');
    await writeProjectBackupArchive(archivePath, backup);
    const bytes = fs.readFileSync(archivePath);
    const eocd = bytes.length - 22;
    const centralDirOffset = bytes.readUInt32LE(eocd + 16);
    const localHeaderOffset = bytes.readUInt32LE(centralDirOffset + 42);

    const cases: Array<[string, (b: Buffer) => void]> = [
      ['central directory offset beyond the archive', (b) => b.writeUInt32LE(0xfffffff0, eocd + 16)],
      ['central directory size overrunning the archive', (b) => b.writeUInt32LE(0xfffffff0, eocd + 12)],
      ['data length spilling past the central directory', (b) => b.writeUInt32LE(0x7fffffff, localHeaderOffset + 22)],
      ['local header offset that cannot fit before the central directory', (b) => b.writeUInt32LE(0xffffffff, centralDirOffset + 42)],
    ];

    for (const [label, patch] of cases) {
      const patched = Buffer.from(bytes);
      patch(patched);
      fs.writeFileSync(archivePath, patched);
      await expect(readProjectBackupArchive(archivePath), label).rejects.toThrow(/Invalid bundle archive/);
    }
  });

  it('rejects multi-entry metadata and central/local name mismatches', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'multi-entry.pbc');
    await writeProjectBackupArchive(archivePath, backup);
    const bytes = fs.readFileSync(archivePath);
    const eocd = bytes.length - 22;
    const centralDirOffset = bytes.readUInt32LE(eocd + 16);

    // EOCD claims two entries instead of exactly one.
    const multiEntry = Buffer.from(bytes);
    multiEntry.writeUInt16LE(2, eocd + 8);
    multiEntry.writeUInt16LE(2, eocd + 10);
    fs.writeFileSync(archivePath, multiEntry);
    await expect(readProjectBackupArchive(archivePath)).rejects.toThrow(/Invalid bundle archive/);

    // Central entry name disagrees with the local header name.
    const nameMismatch = Buffer.from(bytes);
    nameMismatch.write('xackup.json', centralDirOffset + 46, 'utf8');
    fs.writeFileSync(archivePath, nameMismatch);
    await expect(readProjectBackupArchive(archivePath)).rejects.toThrow(/Invalid bundle archive/);
  });

  it('rejects an archive whose single entry is not the backup document', async () => {
    const wrongEntryPath = path.join(tmpDir, 'wrong-entry.pbc');
    const manifestEntry = { format: 'cast-deck-bundle', version: 1, exportedAt: T0, items: [], themes: [], mediaReferences: [] };

    // Simulate a foreign single-entry archive by writing the backup payload
    // under the deck-bundle entry name via the deck-bundle writer.
    const { writeDeckBundleArchive } = await import('../main/deck-bundle-archive');
    await writeDeckBundleArchive(wrongEntryPath, manifestEntry as never);

    await expect(readProjectBackupArchive(wrongEntryPath)).rejects.toThrow(/Invalid backup entry/);
  });

  it('rejects unparsable backup JSON at the archive read boundary', async () => {
    const archivePath = path.join(tmpDir, 'corrupt.pbc');
    fs.writeFileSync(archivePath, Buffer.from('this is not a zip'));
    await expect(readProjectBackupArchive(archivePath)).rejects.toThrow(/Invalid bundle archive/);
  });

  it('rejects a structurally valid archive whose payload is unparsable JSON', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'corrupt-payload.pbc');
    await writeProjectBackupArchive(archivePath, backup);

    // Overwrite the start of the payload with garbage while keeping the zip
    // structure, entry name, and offsets intact, then keep the entry CRC
    // coherent so the rejection comes from the JSON parse boundary.
    const bytes = fs.readFileSync(archivePath);
    const eocd = bytes.length - 22;
    const centralDirOffset = bytes.readUInt32LE(eocd + 16);
    const localHeaderOffset = bytes.readUInt32LE(centralDirOffset + 42);
    const localNameLength = bytes.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = bytes.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLength + extraFieldLength;
    bytes.write('garbage!', dataOffset, 'utf8');
    recomputeEntryCrc(bytes);
    fs.writeFileSync(archivePath, bytes);

    await expect(readProjectBackupArchive(archivePath)).rejects.toThrow(/Invalid backup document/);
  });

  it('rejects a payload byte changed inside a JSON string without updating the CRC', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'tampered-byte.pbc');
    await writeProjectBackupArchive(archivePath, backup);
    const bytes = fs.readFileSync(archivePath);

    // Flip one ASCII byte inside a JSON string ('Main Library' -> 'Nain
    // Library'): same length, still valid JSON, but the recorded CRC no
    // longer matches the payload.
    const needle = Buffer.from('Main Library', 'utf8');
    const needleIndex = bytes.indexOf(needle);
    expect(needleIndex).toBeGreaterThanOrEqual(0);
    bytes[needleIndex] = 0x4e;
    fs.writeFileSync(archivePath, bytes);

    await expect(readProjectBackupArchive(archivePath)).rejects.toThrow(/Invalid bundle archive/);
  });

  it('rejects patched CRC or size metadata in the local or central headers', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'tampered-metadata.pbc');
    await writeProjectBackupArchive(archivePath, backup);
    const bytes = fs.readFileSync(archivePath);
    const eocd = bytes.length - 22;
    const centralDirOffset = bytes.readUInt32LE(eocd + 16);
    const localHeaderOffset = bytes.readUInt32LE(centralDirOffset + 42);

    const cases: Array<[string, (b: Buffer) => void]> = [
      ['central CRC', (b) => b.writeUInt32LE(0xdeadbeef, centralDirOffset + 16)],
      ['local CRC', (b) => b.writeUInt32LE(0xdeadbeef, localHeaderOffset + 14)],
      ['central compressed size', (b) => b.writeUInt32LE(0xdeadbeef, centralDirOffset + 20)],
      ['central uncompressed size', (b) => b.writeUInt32LE(0xdeadbeef, centralDirOffset + 24)],
      ['local compressed size', (b) => b.writeUInt32LE(0xdeadbeef, localHeaderOffset + 18)],
      ['local uncompressed size', (b) => b.writeUInt32LE(0xdeadbeef, localHeaderOffset + 22)],
    ];

    for (const [label, patch] of cases) {
      const patched = Buffer.from(bytes);
      patch(patched);
      fs.writeFileSync(archivePath, patched);
      await expect(readProjectBackupArchive(archivePath), label).rejects.toThrow(/Invalid bundle archive/);
    }
  });

  it('rejects a central entry name length that overruns its record', async () => {
    const backup = repo.exportProjectBackup();
    const archivePath = path.join(tmpDir, 'name-length.pbc');
    await writeProjectBackupArchive(archivePath, backup);
    const bytes = fs.readFileSync(archivePath);
    const eocd = bytes.length - 22;
    const centralDirOffset = bytes.readUInt32LE(eocd + 16);

    const patched = Buffer.from(bytes);
    patched.writeUInt16LE(0xffff, centralDirOffset + 28);
    fs.writeFileSync(archivePath, patched);

    await expect(readProjectBackupArchive(archivePath)).rejects.toThrow(/Invalid bundle archive/);
  });
});

describe('deck-bundle archive path (#145)', () => {
  const explicitManifest: DeckBundleManifest = {
    format: 'cast-deck-bundle',
    version: 1,
    exportedAt: T0,
    items: [
      {
        id: 'item-1',
        type: 'presentation',
        title: 'Announcements',
        themeId: 'theme-1',
        order: 0,
        slides: [
          {
            id: 'slide-1',
            width: 1920,
            height: 1080,
            notes: 'Intro',
            order: 0,
            background: THEME1_BACKGROUND,
            backgroundSource: 'theme',
            elements: [
              {
                id: 'elem-1',
                slideId: 'slide-1',
                type: 'image',
                x: 0,
                y: 0,
                width: 200,
                height: 200,
                rotation: 0,
                opacity: 1,
                zIndex: 1,
                layer: 'media',
                payload: IMAGE_PAYLOAD,
                sourceThemeElementId: null,
                createdAt: T0,
                updatedAt: T0,
              },
            ],
          },
        ],
      },
    ],
    themes: [
      {
        id: 'theme-1',
        name: 'Brand',
        kind: 'slides',
        width: 1920,
        height: 1080,
        order: 0,
        elements: [],
      },
    ],
    mediaReferences: [{ source: 'cast-media://image-1', elementTypes: ['image'], occurrenceCount: 1 }],
    overlays: [],
    stages: [],
    playlists: [],
  };

  it('round-trips an explicit manifest through manifest.json unchanged', async () => {
    const archivePath = path.join(tmpDir, 'deck-bundle.pbc');

    await writeDeckBundleArchive(archivePath, explicitManifest);
    const read = await readDeckBundleArchive(archivePath);

    expect(read).toEqual(explicitManifest);
  });

  it('rejects an archive whose single entry is not the manifest (preserving Invalid bundle entry)', async () => {
    const backup = repo.exportProjectBackup();
    const backupPath = path.join(tmpDir, 'project-backup.pbc');
    await writeProjectBackupArchive(backupPath, backup);

    await expect(readDeckBundleArchive(backupPath)).rejects.toThrow('Invalid bundle entry.');
  });
});