// #145 project backup serialization, rewritten for the #219 item-model
// refactor (backup format version 2, pinned to schema version 27 -- see
// DESIGN.md D8 and schema-final.md). No libraries, no playlist_groups, no
// collection_id anywhere; themes split into four per-owner tables
// (presentation_themes/lyric_themes/talk_themes/overlay_themes);
// playlist_entries is flat (kind/label/color_key, no group_id).
//
// This file covers `exportProjectBackup()` (serialization) and the
// `validateProjectBackup` contract, including the explicit "older app
// version" rejection of a v1/schema-22 document (D8: a v1->v2 transform is a
// later compatibility wave's job, not this one's -- until it lands the
// validator must reject v1 outright, never silently). `restoreProjectBackup`
// (the recovery flow) is covered in project-recovery.test.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PROJECT_BACKUP_FORMAT,
  PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION,
  PROJECT_BACKUP_VERSION,
  ProjectBackupValidationError,
  validateProjectBackup,
} from '@lumacast/protocol';
import type { ProjectBackupTables } from '@lumacast/protocol';
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
  return new CastRepository({ dbPath: path.join(dir, 'lumacast.sqlite'), userDataPath: dir, documentsPath: dir, seed: false });
}

// ---------------------------------------------------------------------------
// Fixture. Every application-owned post-v27 table gets a maximally
// populated, fully deterministic row set: fixed ids and fixed ISO
// timestamps, inserted directly through the repository's connection in
// FK-safe order (parents before children). All JSON columns are serialized
// with JSON.stringify of a literal object, and the expected backup below
// asserts the exact resulting strings -- proving each field mapping
// explicitly. `step-4` deliberately carries `cue_id: null` (the column has
// no NOT NULL constraint) so the nullable-column contract is exercised by a
// real exported row.
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
const T10 = '2026-01-01T10:00:00.000Z';

const PTHEME_BACKGROUND = { type: 'color', color: '#101820' } as const;
const LTHEME_BACKGROUND = { type: 'image', mediaAssetId: 'image-2', src: 'cast-media://image-2', fit: 'cover' };
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

const TEXT_PAYLOAD = { text: 'Announcements', fontFamily: 'Helvetica', fontSize: 64, color: '#FFFFFF', alignment: 'center', weight: '700' };
const IMAGE_PAYLOAD = { src: 'cast-media://image-1', name: 'Logo', visible: true };
const SHAPE_PAYLOAD = { fillColor: '#101820CC', borderColor: '#FFFFFF33', borderWidth: 2, borderRadius: 12 };
const VIDEO_PAYLOAD = { src: 'cast-media://video-1', autoplay: true, loop: false, muted: true, playbackRate: 1 };
const RICH_PAYLOAD = {
  text: 'Verse 1', fontFamily: 'Helvetica', fontSize: 48, color: '#FFFFFF', alignment: 'left', weight: '400',
  format: 'rich', richBody: [{ runs: [{ text: 'Verse 1', weight: 700 }], indent: 0 }],
};
const PTHEME_TEXT_PAYLOAD = { text: 'Brand', fontFamily: 'Helvetica', fontSize: 40, color: '#FFFFFF', alignment: 'left', weight: '700' };
const LTHEME_TEXT_PAYLOAD = { text: 'Song', fontFamily: 'Helvetica', fontSize: 40, color: '#FFFFFF', alignment: 'left', weight: '400' };
const TTHEME_TEXT_PAYLOAD = { text: 'Sermon Brand', fontFamily: 'Helvetica', fontSize: 36, color: '#FFFFFF', alignment: 'left', weight: '400' };
const OTHEME_SHAPE_PAYLOAD = { fillColor: '#FF0000', borderColor: '#000000', borderWidth: 1, borderRadius: 0 };
const OVERLAY_TEXT_PAYLOAD = { text: 'CAST', fontFamily: 'Helvetica', fontSize: 28, color: '#FFFFFF', alignment: 'right', weight: '600' };
const STAGE_TEXT_PAYLOAD = { text: 'Stage', fontFamily: 'Helvetica', fontSize: 24, color: '#FFFFFF', alignment: 'left', weight: '400' };

const CUE_1_PAYLOAD = { overlayId: 'overlay-1' };
const CUE_2_PAYLOAD = { assetId: 'video-1' };
const CUE_3_PAYLOAD = { action: 'cancel', target: '*' };
const CUE_5_PAYLOAD = { stageId: 'stage-1' };
const CUE_6_PAYLOAD = { layer: 'media' };

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
  db.prepare('INSERT INTO talk_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('ttheme-1', 'Sermon Brand', 1920, 1080, 0, T2, T2);
  db.prepare('INSERT INTO overlay_themes (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('otheme-1', 'Lower Third', 1280, 720, 0, T3, T3);

  db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pres-1', 'Announcements', 'ptheme-1', 0, T0, T0);
  db.prepare('INSERT INTO presentations (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('pres-2', 'Welcome', null, 1, T1, T1);
  db.prepare('INSERT INTO lyrics (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('lyric-1', 'Great Is Thy Faithfulness', 'ltheme-1', 0, T0, T0);
  db.prepare('INSERT INTO talks (id, title, theme_id, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('talk-1', 'Sunday Sermon', 'ttheme-1', 0, T0, T0);

  db.prepare('INSERT INTO overlays (id, name, enabled, animation_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('overlay-1', 'Watermark', 1, JSON.stringify({ kind: 'dissolve', durationMs: 500, autoClearDurationMs: 3000 }), T0, T0);

  db.prepare('INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('stage-1', 'Audience', 1920, 1080, 0, T0, T0);
  db.prepare('INSERT INTO stages (id, name, width, height, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('stage-2', 'Stage Left', 1920, 1080, 1, T1, T1);

  db.prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('pl-1', 'Sunday Service', 0, T0, T0);
  db.prepare('INSERT INTO playlists (id, name, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('pl-2', 'Evening', 1, T1, T1);

  const insertSlide = db.prepare(
    `INSERT INTO slides
       (id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height, notes, background_json, background_source, order_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertSlide.run('ptheme-1:slide', null, null, null, 'ptheme-1', null, null, null, null, null, 'presentationTheme', 1920, 1080, '', JSON.stringify(PTHEME_BACKGROUND), null, 0, T0, T0);
  insertSlide.run('ltheme-1:slide', null, null, null, null, 'ltheme-1', null, null, null, null, 'lyricTheme', 1920, 1080, '', JSON.stringify(LTHEME_BACKGROUND), 'local', 0, T1, T1);
  insertSlide.run('ttheme-1:slide', null, null, null, null, null, 'ttheme-1', null, null, null, 'talkTheme', 1920, 1080, '', null, 'local', 0, T2, T2);
  insertSlide.run('otheme-1:slide', null, null, null, null, null, null, 'otheme-1', null, null, 'overlayTheme', 1280, 720, '', null, 'local', 0, T3, T3);
  insertSlide.run('overlay-1:slide', null, null, null, null, null, null, null, 'overlay-1', null, 'overlay', 1920, 1080, '', JSON.stringify(OVERLAY_SLIDE_BACKGROUND), 'local', 0, T4, T4);
  insertSlide.run('stage-1:slide', null, null, null, null, null, null, null, null, 'stage-1', 'stage', 1920, 1080, '', null, 'local', 0, T5, T5);
  insertSlide.run('stage-2:slide', null, null, null, null, null, null, null, null, 'stage-2', 'stage', 1920, 1080, '', null, 'local', 0, T6, T6);
  insertSlide.run('slide-pres-1', 'pres-1', null, null, null, null, null, null, null, null, 'presentation', 1920, 1080, 'Announcement intro', JSON.stringify(PTHEME_BACKGROUND), 'theme', 0, T7, T7);
  insertSlide.run('slide-pres-2', 'pres-1', null, null, null, null, null, null, null, null, 'presentation', 1920, 1080, '', JSON.stringify(GRADIENT_BACKGROUND), 'local', 1, T8, T8);
  insertSlide.run('slide-lyric-1', null, 'lyric-1', null, null, null, null, null, null, null, 'lyric', 1920, 1080, '', JSON.stringify(LTHEME_BACKGROUND), 'theme', 0, T9, T9);
  insertSlide.run('slide-talk-1', null, null, 'talk-1', null, null, null, null, null, null, 'talk', 1920, 1080, 'Big sermon', null, 'local', 0, T10, T10);

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
  ).run('entry-3', 'pl-1', 'item', null, null, 'talk-1', null, null, 3, T3, T3);
  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('sep-2', 'pl-1', 'separator', null, null, null, 'Closing', null, 4, T4, T4);
  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-4', 'pl-1', 'item', 'pres-2', null, null, null, null, 5, T5, T5);
  db.prepare(
    'INSERT INTO playlist_entries (id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('entry-5', 'pl-2', 'item', null, null, 'talk-1', null, null, 0, T6, T6);

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
  insertElement.run('pt-elem-1', 'ptheme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(PTHEME_TEXT_PAYLOAD), null, T0, T0);
  insertElement.run('lt-elem-1', 'ltheme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(LTHEME_TEXT_PAYLOAD), null, T1, T1);
  insertElement.run('tt-elem-1', 'ttheme-1:slide', 'text', 100, 100, 800, 60, 0, 1, 2, 'content', JSON.stringify(TTHEME_TEXT_PAYLOAD), null, T2, T2);
  insertElement.run('ot-elem-1', 'otheme-1:slide', 'shape', 0, 0, 1280, 120, 0, 1, 1, 'background', JSON.stringify(OTHEME_SHAPE_PAYLOAD), null, T3, T3);
  insertElement.run('o-elem-1', 'overlay-1:slide', 'text', 1540, 1010, 340, 40, 0, 0.65, 999, 'content', JSON.stringify(OVERLAY_TEXT_PAYLOAD), null, T4, T4);
  insertElement.run('st-elem-1', 'stage-1:slide', 'text', 10, 10, 400, 40, 0, 1, 2, 'content', JSON.stringify(STAGE_TEXT_PAYLOAD), null, T5, T5);
  insertElement.run('elem-pres-1', 'slide-pres-1', 'text', 100, 200, 800, 60, 0, 1, 10, 'content', JSON.stringify(TEXT_PAYLOAD), 'pt-elem-1', T6, T6);
  insertElement.run('elem-pres-2', 'slide-pres-1', 'image', 10, 10, 200, 200, 0, 0.8, 5, 'media', JSON.stringify(IMAGE_PAYLOAD), null, T7, T7);
  insertElement.run('elem-pres-3', 'slide-pres-2', 'shape', 0, 0, 1920, 1080, 0, 1, 1, 'background', JSON.stringify(SHAPE_PAYLOAD), null, T8, T8);
  insertElement.run('elem-lyric-1', 'slide-lyric-1', 'text', 100, 100, 900, 60, 0, 1, 10, 'content', JSON.stringify(RICH_PAYLOAD), 'lt-elem-1', T9, T9);
  insertElement.run('elem-talk-1', 'slide-talk-1', 'video', 0, 0, 800, 450, 0, 1, 5, 'media', JSON.stringify(VIDEO_PAYLOAD), null, T10, T10);

  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-1', 'overlay.activate', JSON.stringify(CUE_1_PAYLOAD), 'continue', T0, T0);
  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-2', 'mediaLayer.set', JSON.stringify(CUE_2_PAYLOAD), 'abort', T1, T1);
  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-3', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', T2, T2);
  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-5', 'stage.set', JSON.stringify(CUE_5_PAYLOAD), 'continue', T3, T3);
  db.prepare('INSERT INTO cues (id, kind, payload_json, failure_policy, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cue-6', 'layer.clear', JSON.stringify(CUE_6_PAYLOAD), 'continue', T4, T4);

  db.prepare(
    `INSERT INTO actions (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('macro-1', 'Run Service Cues', 'Auto-advance service', 'item', 'cancel', 0, null, T0, T0);
  db.prepare(
    `INSERT INTO actions (id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('macro-2', 'Slide Loop', 'Loop the slide', 'slide', 'revert', 1, 3, T1, T1);

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
  ).run('step-3', 'macro-2', 'flow.lifecycle', JSON.stringify(CUE_3_PAYLOAD), 'continue', 'cue-3', 0, 0, 0, T2, T2);
  db.prepare(
    `INSERT INTO action_steps (id, action_id, kind, payload_json, failure_policy, cue_id, order_index, delay_before_ms, delay_after_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('step-4', 'macro-2', 'layer.clear', JSON.stringify(CUE_6_PAYLOAD), 'continue', null, 1, 100, 100, T3, T3);

  db.prepare(
    `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-1', 'slide.take', null, 'macro', 'macro-1', JSON.stringify(BINDING_1_CONFIG), 1, T0, T0);
  db.prepare(
    `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-2', 'slide.activate', 'slide-pres-1', 'cue', 'cue-5', '{}', 0, T1, T1);
  db.prepare(
    `INSERT INTO trigger_bindings (id, trigger_type, source_id, target_type, target_id, config_json, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('binding-3', 'app.startup', null, 'macro', 'macro-2', JSON.stringify(BINDING_3_CONFIG), 1, T2, T2);
}

// ---------------------------------------------------------------------------
// Expected tables: the exact rows above, in (created_at, id) order, with
// every column written out explicitly. Each row literal is the named
// assertion for its table/column mapping.
// ---------------------------------------------------------------------------

const EXPECTED_TABLES: ProjectBackupTables = {
  presentations: [
    { id: 'pres-1', title: 'Announcements', theme_id: 'ptheme-1', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'pres-2', title: 'Welcome', theme_id: null, order_index: 1, created_at: T1, updated_at: T1 },
  ],
  lyrics: [
    { id: 'lyric-1', title: 'Great Is Thy Faithfulness', theme_id: 'ltheme-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  talks: [
    { id: 'talk-1', title: 'Sunday Sermon', theme_id: 'ttheme-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  slides: [
    { id: 'ptheme-1:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: 'ptheme-1', lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'presentationTheme', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(PTHEME_BACKGROUND), background_source: null, order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'ltheme-1:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: 'ltheme-1', talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'lyricTheme', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(LTHEME_BACKGROUND), background_source: 'local', order_index: 0, created_at: T1, updated_at: T1 },
    { id: 'ttheme-1:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: 'ttheme-1', overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'talkTheme', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T2, updated_at: T2 },
    { id: 'otheme-1:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: 'otheme-1', overlay_id: null, stage_id: null, kind: 'overlayTheme', width: 1280, height: 720, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T3, updated_at: T3 },
    { id: 'overlay-1:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: 'overlay-1', stage_id: null, kind: 'overlay', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(OVERLAY_SLIDE_BACKGROUND), background_source: 'local', order_index: 0, created_at: T4, updated_at: T4 },
    { id: 'stage-1:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: 'stage-1', kind: 'stage', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T5, updated_at: T5 },
    { id: 'stage-2:slide', presentation_id: null, lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: 'stage-2', kind: 'stage', width: 1920, height: 1080, notes: '', background_json: null, background_source: 'local', order_index: 0, created_at: T6, updated_at: T6 },
    { id: 'slide-pres-1', presentation_id: 'pres-1', lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'presentation', width: 1920, height: 1080, notes: 'Announcement intro', background_json: JSON.stringify(PTHEME_BACKGROUND), background_source: 'theme', order_index: 0, created_at: T7, updated_at: T7 },
    { id: 'slide-pres-2', presentation_id: 'pres-1', lyric_id: null, talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'presentation', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(GRADIENT_BACKGROUND), background_source: 'local', order_index: 1, created_at: T8, updated_at: T8 },
    { id: 'slide-lyric-1', presentation_id: null, lyric_id: 'lyric-1', talk_id: null, presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'lyric', width: 1920, height: 1080, notes: '', background_json: JSON.stringify(LTHEME_BACKGROUND), background_source: 'theme', order_index: 0, created_at: T9, updated_at: T9 },
    { id: 'slide-talk-1', presentation_id: null, lyric_id: null, talk_id: 'talk-1', presentation_theme_id: null, lyric_theme_id: null, talk_theme_id: null, overlay_theme_id: null, overlay_id: null, stage_id: null, kind: 'talk', width: 1920, height: 1080, notes: 'Big sermon', background_json: null, background_source: 'local', order_index: 0, created_at: T10, updated_at: T10 },
  ],
  slide_elements: [
    { id: 'pt-elem-1', slide_id: 'ptheme-1:slide', type: 'text', x: 100, y: 100, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(PTHEME_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T0, updated_at: T0 },
    { id: 'lt-elem-1', slide_id: 'ltheme-1:slide', type: 'text', x: 100, y: 100, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(LTHEME_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T1, updated_at: T1 },
    { id: 'tt-elem-1', slide_id: 'ttheme-1:slide', type: 'text', x: 100, y: 100, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(TTHEME_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T2, updated_at: T2 },
    { id: 'ot-elem-1', slide_id: 'otheme-1:slide', type: 'shape', x: 0, y: 0, width: 1280, height: 120, rotation: 0, opacity: 1, z_index: 1, layer: 'background', payload_json: JSON.stringify(OTHEME_SHAPE_PAYLOAD), source_theme_element_id: null, created_at: T3, updated_at: T3 },
    { id: 'o-elem-1', slide_id: 'overlay-1:slide', type: 'text', x: 1540, y: 1010, width: 340, height: 40, rotation: 0, opacity: 0.65, z_index: 999, layer: 'content', payload_json: JSON.stringify(OVERLAY_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T4, updated_at: T4 },
    { id: 'st-elem-1', slide_id: 'stage-1:slide', type: 'text', x: 10, y: 10, width: 400, height: 40, rotation: 0, opacity: 1, z_index: 2, layer: 'content', payload_json: JSON.stringify(STAGE_TEXT_PAYLOAD), source_theme_element_id: null, created_at: T5, updated_at: T5 },
    { id: 'elem-pres-1', slide_id: 'slide-pres-1', type: 'text', x: 100, y: 200, width: 800, height: 60, rotation: 0, opacity: 1, z_index: 10, layer: 'content', payload_json: JSON.stringify(TEXT_PAYLOAD), source_theme_element_id: 'pt-elem-1', created_at: T6, updated_at: T6 },
    { id: 'elem-pres-2', slide_id: 'slide-pres-1', type: 'image', x: 10, y: 10, width: 200, height: 200, rotation: 0, opacity: 0.8, z_index: 5, layer: 'media', payload_json: JSON.stringify(IMAGE_PAYLOAD), source_theme_element_id: null, created_at: T7, updated_at: T7 },
    { id: 'elem-pres-3', slide_id: 'slide-pres-2', type: 'shape', x: 0, y: 0, width: 1920, height: 1080, rotation: 0, opacity: 1, z_index: 1, layer: 'background', payload_json: JSON.stringify(SHAPE_PAYLOAD), source_theme_element_id: null, created_at: T8, updated_at: T8 },
    { id: 'elem-lyric-1', slide_id: 'slide-lyric-1', type: 'text', x: 100, y: 100, width: 900, height: 60, rotation: 0, opacity: 1, z_index: 10, layer: 'content', payload_json: JSON.stringify(RICH_PAYLOAD), source_theme_element_id: 'lt-elem-1', created_at: T9, updated_at: T9 },
    { id: 'elem-talk-1', slide_id: 'slide-talk-1', type: 'video', x: 0, y: 0, width: 800, height: 450, rotation: 0, opacity: 1, z_index: 5, layer: 'media', payload_json: JSON.stringify(VIDEO_PAYLOAD), source_theme_element_id: null, created_at: T10, updated_at: T10 },
  ],
  talk_script_blocks: [
    { id: 'block-1', slide_id: 'slide-talk-1', text: 'Welcome everyone', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'block-2', slide_id: 'slide-talk-1', text: 'Then we pray', order_index: 1, created_at: T1, updated_at: T1 },
  ],
  playlists: [
    { id: 'pl-1', name: 'Sunday Service', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'pl-2', name: 'Evening', order_index: 1, created_at: T1, updated_at: T1 },
  ],
  playlist_entries: [
    { id: 'sep-1', playlist_id: 'pl-1', kind: 'separator', presentation_id: null, lyric_id: null, talk_id: null, label: 'Opening', color_key: 'blue', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'entry-1', playlist_id: 'pl-1', kind: 'item', presentation_id: 'pres-1', lyric_id: null, talk_id: null, label: null, color_key: null, order_index: 1, created_at: T1, updated_at: T1 },
    { id: 'entry-2', playlist_id: 'pl-1', kind: 'item', presentation_id: null, lyric_id: 'lyric-1', talk_id: null, label: null, color_key: null, order_index: 2, created_at: T2, updated_at: T2 },
    { id: 'entry-3', playlist_id: 'pl-1', kind: 'item', presentation_id: null, lyric_id: null, talk_id: 'talk-1', label: null, color_key: null, order_index: 3, created_at: T3, updated_at: T3 },
    { id: 'sep-2', playlist_id: 'pl-1', kind: 'separator', presentation_id: null, lyric_id: null, talk_id: null, label: 'Closing', color_key: null, order_index: 4, created_at: T4, updated_at: T4 },
    { id: 'entry-4', playlist_id: 'pl-1', kind: 'item', presentation_id: 'pres-2', lyric_id: null, talk_id: null, label: null, color_key: null, order_index: 5, created_at: T5, updated_at: T5 },
    { id: 'entry-5', playlist_id: 'pl-2', kind: 'item', presentation_id: null, lyric_id: null, talk_id: 'talk-1', label: null, color_key: null, order_index: 0, created_at: T6, updated_at: T6 },
  ],
  image_assets: [
    { id: 'image-1', name: 'Logo', src: 'cast-media://image-1', order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'image-2', name: 'Backdrop', src: 'cast-media://image-2', order_index: 1, created_at: T1, updated_at: T1 },
  ],
  video_assets: [
    { id: 'video-1', name: 'Intro', src: 'cast-media://video-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  audio_assets: [
    { id: 'audio-1', name: 'Sting', src: 'cast-media://audio-1', order_index: 0, created_at: T0, updated_at: T0 },
  ],
  overlays: [
    { id: 'overlay-1', name: 'Watermark', enabled: 1, animation_json: JSON.stringify({ kind: 'dissolve', durationMs: 500, autoClearDurationMs: 3000 }), created_at: T0, updated_at: T0 },
  ],
  presentation_themes: [
    { id: 'ptheme-1', name: 'Brand', width: 1920, height: 1080, order_index: 0, created_at: T0, updated_at: T1 },
  ],
  lyric_themes: [
    { id: 'ltheme-1', name: 'Song Background', width: 1920, height: 1080, order_index: 0, created_at: T1, updated_at: T1 },
  ],
  talk_themes: [
    { id: 'ttheme-1', name: 'Sermon Brand', width: 1920, height: 1080, order_index: 0, created_at: T2, updated_at: T2 },
  ],
  overlay_themes: [
    { id: 'otheme-1', name: 'Lower Third', width: 1280, height: 720, order_index: 0, created_at: T3, updated_at: T3 },
  ],
  stages: [
    { id: 'stage-1', name: 'Audience', width: 1920, height: 1080, order_index: 0, created_at: T0, updated_at: T0 },
    { id: 'stage-2', name: 'Stage Left', width: 1920, height: 1080, order_index: 1, created_at: T1, updated_at: T1 },
  ],
  cues: [
    { id: 'cue-1', kind: 'overlay.activate', payload_json: JSON.stringify(CUE_1_PAYLOAD), failure_policy: 'continue', created_at: T0, updated_at: T0 },
    { id: 'cue-2', kind: 'mediaLayer.set', payload_json: JSON.stringify(CUE_2_PAYLOAD), failure_policy: 'abort', created_at: T1, updated_at: T1 },
    { id: 'cue-3', kind: 'flow.lifecycle', payload_json: JSON.stringify(CUE_3_PAYLOAD), failure_policy: 'continue', created_at: T2, updated_at: T2 },
    { id: 'cue-5', kind: 'stage.set', payload_json: JSON.stringify(CUE_5_PAYLOAD), failure_policy: 'continue', created_at: T3, updated_at: T3 },
    { id: 'cue-6', kind: 'layer.clear', payload_json: JSON.stringify(CUE_6_PAYLOAD), failure_policy: 'continue', created_at: T4, updated_at: T4 },
  ],
  actions: [
    { id: 'macro-1', name: 'Run Service Cues', description: 'Auto-advance service', scope_level: 'item', on_scope_exit: 'cancel', loop_enabled: 0, loop_count: null, created_at: T0, updated_at: T0 },
    { id: 'macro-2', name: 'Slide Loop', description: 'Loop the slide', scope_level: 'slide', on_scope_exit: 'revert', loop_enabled: 1, loop_count: 3, created_at: T1, updated_at: T1 },
  ],
  action_steps: [
    { id: 'step-1', action_id: 'macro-1', kind: 'overlay.activate', payload_json: JSON.stringify(CUE_1_PAYLOAD), failure_policy: 'continue', cue_id: 'cue-1', order_index: 0, delay_before_ms: 0, delay_after_ms: 250, created_at: T0, updated_at: T0 },
    { id: 'step-2', action_id: 'macro-1', kind: 'mediaLayer.set', payload_json: JSON.stringify(CUE_2_PAYLOAD), failure_policy: 'abort', cue_id: 'cue-2', order_index: 1, delay_before_ms: 500, delay_after_ms: 0, created_at: T1, updated_at: T1 },
    { id: 'step-3', action_id: 'macro-2', kind: 'flow.lifecycle', payload_json: JSON.stringify(CUE_3_PAYLOAD), failure_policy: 'continue', cue_id: 'cue-3', order_index: 0, delay_before_ms: 0, delay_after_ms: 0, created_at: T2, updated_at: T2 },
    { id: 'step-4', action_id: 'macro-2', kind: 'layer.clear', payload_json: JSON.stringify(CUE_6_PAYLOAD), failure_policy: 'continue', cue_id: null, order_index: 1, delay_before_ms: 100, delay_after_ms: 100, created_at: T3, updated_at: T3 },
  ],
  trigger_bindings: [
    { id: 'binding-1', trigger_type: 'slide.take', source_id: null, target_type: 'macro', target_id: 'macro-1', config_json: JSON.stringify(BINDING_1_CONFIG), enabled: 1, created_at: T0, updated_at: T0 },
    { id: 'binding-2', trigger_type: 'slide.activate', source_id: 'slide-pres-1', target_type: 'cue', target_id: 'cue-5', config_json: '{}', enabled: 0, created_at: T1, updated_at: T1 },
    { id: 'binding-3', trigger_type: 'app.startup', source_id: null, target_type: 'macro', target_id: 'macro-2', config_json: JSON.stringify(BINDING_3_CONFIG), enabled: 1, created_at: T2, updated_at: T2 },
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

describe('project backup serialization (#145, backup v2)', () => {
  it('produces the exact expected document for the maximally populated fixture (envelope + all 21 tables)', () => {
    const backup = repo.exportProjectBackup();

    expect(backup).toEqual({
      format: PROJECT_BACKUP_FORMAT,
      version: PROJECT_BACKUP_VERSION,
      schemaVersion: LATEST_SCHEMA_VERSION,
      tables: EXPECTED_TABLES,
    });
  });

  it('maps the four per-owner theme tables and items (no collection_id, no libraries) field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.presentations).toEqual(EXPECTED_TABLES.presentations);
    expect(tables.lyrics).toEqual(EXPECTED_TABLES.lyrics);
    expect(tables.talks).toEqual(EXPECTED_TABLES.talks);
    expect(tables.presentation_themes).toEqual(EXPECTED_TABLES.presentation_themes);
    expect(tables.lyric_themes).toEqual(EXPECTED_TABLES.lyric_themes);
    expect(tables.talk_themes).toEqual(EXPECTED_TABLES.talk_themes);
    expect(tables.overlay_themes).toEqual(EXPECTED_TABLES.overlay_themes);
    for (const table of ['presentations', 'lyrics', 'talks', 'presentation_themes', 'lyric_themes', 'talk_themes', 'overlay_themes'] as const) {
      for (const row of tables[table]) {
        expect(row, `${table} row must not carry a collection_id`).not.toHaveProperty('collection_id');
      }
    }
  });

  it('maps slides (item and container) with the nine owner columns, elements with provenance, and script blocks field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.slides).toEqual(EXPECTED_TABLES.slides);
    expect(tables.slide_elements).toEqual(EXPECTED_TABLES.slide_elements);
    expect(tables.talk_script_blocks).toEqual(EXPECTED_TABLES.talk_script_blocks);
    // Every slide row has exactly one of the nine owner ids set.
    for (const row of tables.slides) {
      const ownerCount = [
        row.presentation_id, row.lyric_id, row.talk_id,
        row.presentation_theme_id, row.lyric_theme_id, row.talk_theme_id, row.overlay_theme_id,
        row.overlay_id, row.stage_id,
      ].filter((value) => value !== null).length;
      expect(ownerCount, `slide ${row.id} must have exactly one owner`).toBe(1);
    }
  });

  it('maps flat playlists/playlist_entries (kind/label/color_key, no group_id, no library_id) field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.playlists).toEqual(EXPECTED_TABLES.playlists);
    expect(tables.playlist_entries).toEqual(EXPECTED_TABLES.playlist_entries);
    for (const row of tables.playlists) {
      expect(row, 'playlists row must not carry a library_id').not.toHaveProperty('library_id');
    }
    for (const row of tables.playlist_entries) {
      expect(row, 'playlist_entries row must not carry a group_id').not.toHaveProperty('group_id');
      if (row.kind === 'separator') {
        expect(row.presentation_id).toBeNull();
        expect(row.lyric_id).toBeNull();
        expect(row.talk_id).toBeNull();
      } else {
        expect(row.label).toBeNull();
      }
    }
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

  it('maps overlays and stages field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.overlays).toEqual(EXPECTED_TABLES.overlays);
    expect(tables.stages).toEqual(EXPECTED_TABLES.stages);
  });

  it('maps cues, macros (renamed deckItem scope), macro steps, and trigger bindings field by field', () => {
    const tables = repo.exportProjectBackup().tables;

    expect(tables.cues).toEqual(EXPECTED_TABLES.cues);
    expect(tables.actions).toEqual(EXPECTED_TABLES.actions);
    expect(tables.action_steps).toEqual(EXPECTED_TABLES.action_steps);
    expect(tables.trigger_bindings).toEqual(EXPECTED_TABLES.trigger_bindings);
    expect(tables.actions.find((a) => a.id === 'macro-1')!.scope_level).toBe('item');
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

describe('project backup validation (#145, backup v2)', () => {
  it('keeps the core-supported schema version in lockstep with the database migrations', () => {
    expect(PROJECT_BACKUP_SUPPORTED_SCHEMA_VERSION).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBe(27);
  });

  it('rejects a v1/schema-22 backup with an explicit "older app version" message, not a silent/generic failure', () => {
    const legacyBackup = {
      format: PROJECT_BACKUP_FORMAT,
      version: 1,
      schemaVersion: 22,
      tables: {},
    };

    expect(() => validateProjectBackup(legacyBackup)).toThrow(ProjectBackupValidationError);
    expect(() => validateProjectBackup(legacyBackup)).toThrow(/older app version/);
    expect(() => repo.validateProjectBackup(legacyBackup)).toThrow(/older app version/);
    // The rejection fires before the generic "unsupported version" message,
    // not the generic schema-version message either.
    try {
      validateProjectBackup(legacyBackup);
      throw new Error('expected validateProjectBackup to throw');
    } catch (error) {
      expect(String((error as Error).message)).not.toMatch(/Unsupported backup format version/);
    }
  });

  it('rejects a future backup format version', () => {
    const backup = repo.exportProjectBackup();
    const future = { ...backup, version: 3 };

    expect(() => validateProjectBackup(future)).toThrow(ProjectBackupValidationError);
    expect(() => validateProjectBackup(future)).toThrow(/Future backup format version 3/);
    expect(() => repo.validateProjectBackup(future)).toThrow(/Future backup format version 3/);
  });

  it('rejects an unknown backup format and an unsupported version value', () => {
    const backup = repo.exportProjectBackup();

    expect(() => validateProjectBackup({ ...backup, format: 'cast-deck-bundle' })).toThrow(/Unsupported backup format/);
    expect(() => validateProjectBackup({ ...backup, version: 0 })).toThrow(/Unsupported backup format version/);
    expect(() => validateProjectBackup({ ...backup, version: '2' })).toThrow(/Unsupported backup format version/);
  });

  it('rejects any schema version other than the exact supported one', () => {
    const backup = repo.exportProjectBackup();

    expect(() => validateProjectBackup({ ...backup, schemaVersion: 26 })).toThrow(/schema version/);
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

    const rogue = { ...backup, rogueKey: 1 };
    expect(() => validateProjectBackup(rogue)).toThrow(/envelope must have exactly the keys/);

    const missingTables = { ...backup };
    delete (missingTables as Partial<typeof backup>).tables;
    expect(() => validateProjectBackup(missingTables)).toThrow(/envelope must have exactly the keys/);

    const missingVersion = { ...backup };
    delete (missingVersion as Partial<typeof backup>).version;
    expect(() => validateProjectBackup(missingVersion)).toThrow(/Unsupported backup format version/);
  });

  it('rejects missing or extra tables in the tables object', () => {
    const backup = repo.exportProjectBackup();

    const missing = { ...backup, tables: { ...backup.tables } };
    delete (missing.tables as Partial<ProjectBackupTables>).presentation_themes;
    expect(() => validateProjectBackup(missing)).toThrow(/must have exactly/);

    const extra = { ...backup, tables: { ...backup.tables, rogue_table: [] } };
    expect(() => validateProjectBackup(extra)).toThrow(/must have exactly/);

    expect(() => validateProjectBackup({ ...backup, tables: [] })).toThrow(/tables must be an object/);
    expect(() => validateProjectBackup({ ...backup, tables: { ...backup.tables, playlists: 'nope' } })).toThrow(
      /tables\.playlists must be an array/,
    );
  });

  it('rejects rows with missing or extra columns', () => {
    const backup = repo.exportProjectBackup();

    const missingColumn = { ...backup, tables: { ...backup.tables, playlists: [{ id: 'pl-1', name: 'Sunday Service', order_index: 0, created_at: T0 }] } };
    expect(() => validateProjectBackup(missingColumn)).toThrow(/must have exactly the columns/);

    const extraColumn = {
      ...backup,
      tables: {
        ...backup.tables,
        playlists: [{ ...backup.tables.playlists[0], rogue: 1 }],
      },
    };
    expect(() => validateProjectBackup(extraColumn)).toThrow(/must have exactly the columns/);
  });

  it('rejects row values that violate the column contract', () => {
    const backup = repo.exportProjectBackup();

    const nullName = { ...backup, tables: { ...backup.tables, playlists: [{ ...backup.tables.playlists[0], name: null }] } };
    expect(() => validateProjectBackup(nullName)).toThrow(/playlists\[0\]\.name must not be null/);

    const badEnum = { ...backup, tables: { ...backup.tables, slides: [{ ...backup.tables.slides[0], kind: 'banana' }] } };
    expect(() => validateProjectBackup(badEnum)).toThrow(/slides\[0\]\.kind must be one of/);

    const badFlag = { ...backup, tables: { ...backup.tables, overlays: [{ ...backup.tables.overlays[0], enabled: 2 }] } };
    expect(() => validateProjectBackup(badFlag)).toThrow(/overlays\[0\]\.enabled must be 0 or 1/);

    const badJson = { ...backup, tables: { ...backup.tables, cues: [{ ...backup.tables.cues[0], payload_json: '{oops' }] } };
    expect(() => validateProjectBackup(badJson)).toThrow(/cues\[0\]\.payload_json is not valid JSON/);

    const badType = { ...backup, tables: { ...backup.tables, playlists: [{ ...backup.tables.playlists[0], order_index: 'zero' }] } };
    expect(() => validateProjectBackup(badType)).toThrow(/playlists\[0\]\.order_index must be a finite number/);
  });

  it('rejects slide rows without exactly one of the nine owners (mirroring the schema CHECK)', () => {
    const backup = repo.exportProjectBackup();

    const noOwner = { ...backup, tables: { ...backup.tables, slides: [{ ...backup.tables.slides[0], presentation_theme_id: null }] } };
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

  it('accepts a null cue_id on an action step (the column has no NOT NULL constraint)', () => {
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

  it('rejects a playlist_entries row that carries both label and an owner id, or both label and no owner incorrectly', () => {
    const backup = repo.exportProjectBackup();

    // A 'separator' row's owner columns must all stay null even if one is
    // forced non-null -- the column-level spec allows presentation_id to be
    // a string, so this exercises the slide-owner-style exclusivity is only
    // enforced for slides; playlist_entries relies on its own CHECK at
    // restore time (project-recovery.test.ts), not structural validation
    // here. This test instead pins the column-level nullable contract: a
    // separator's label may be null or a string, never anything else.
    const badLabelType = {
      ...backup,
      tables: { ...backup.tables, playlist_entries: [{ ...backup.tables.playlist_entries[0], label: 42 }] },
    };
    expect(() => validateProjectBackup(badLabelType)).toThrow(/playlist_entries\[0\]\.label must be a string/);
  });
});
