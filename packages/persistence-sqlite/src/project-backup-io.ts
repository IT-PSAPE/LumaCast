import type {
  ProjectBackupCueRow,
  ProjectBackupItemRow,
  ProjectBackupMacroRow,
  ProjectBackupMacroStepRow,
  ProjectBackupMediaAssetRow,
  ProjectBackupOverlayRow,
  ProjectBackupPlaylistEntryRow,
  ProjectBackupPlaylistRow,
  ProjectBackupSlideElementRow,
  ProjectBackupSlideRow,
  ProjectBackupStageRow,
  ProjectBackupTables,
  ProjectBackupTalkScriptBlockRow,
  ProjectBackupThemeRow,
  ProjectBackupTriggerBindingRow,
} from '@lumacast/protocol';
import type {
  CueFailurePolicy,
  CueKind,
  OnScopeExit,
  ScopeLevel,
  TriggerBindingTargetType,
  TriggerType,
} from '@lumacast/automation';
import type { SlideBackgroundSource, SlideElement, SlideKind } from '@lumacast/composition';
import type { SqliteDatabase } from './sqlite';

// #219 item-model refactor (wave K): pure row-projection reads for the
// project-backup contract, extracted out of `CastRepository` so both the
// live repository (`store.ts`'s `exportProjectBackup`) and the legacy (v1)
// import path (`legacy-project-backup.ts`, which runs these same queries
// against a throwaway database it has just migrated from schema 22 up to
// LATEST_SCHEMA_VERSION) can produce a `ProjectBackupTables` document from
// any `SqliteDatabase` handle without needing a full repository instance.
// No business logic lives here — every function is a straight
// `SELECT ... ORDER BY created_at ASC, id ASC` plus a field-by-field mapping,
// identical in shape to `ProjectBackup`'s row contract.

type ItemTableName = 'presentations' | 'lyrics' | 'talks';
type ThemeTableName = 'presentation_themes' | 'lyric_themes' | 'talk_themes' | 'overlay_themes';
type MediaAssetTableName = 'image_assets' | 'video_assets' | 'audio_assets';

function readProjectBackupItems(db: SqliteDatabase, table: ItemTableName): ProjectBackupItemRow[] {
  const rows = db
    .prepare(`SELECT id, title, theme_id, order_index, created_at, updated_at FROM ${table} ORDER BY created_at ASC, id ASC`)
    .all() as Array<{ id: string; title: string; theme_id: string | null; order_index: number; created_at: string; updated_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    theme_id: row.theme_id,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupSlides(db: SqliteDatabase): ProjectBackupSlideRow[] {
  const rows = db
    .prepare(
      `SELECT id, presentation_id, lyric_id, talk_id, presentation_theme_id, lyric_theme_id, talk_theme_id, overlay_theme_id, overlay_id, stage_id, kind, width, height,
              notes, background_json, background_source, order_index, created_at, updated_at
       FROM slides
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{
    id: string;
    presentation_id: string | null;
    lyric_id: string | null;
    talk_id: string | null;
    presentation_theme_id: string | null;
    lyric_theme_id: string | null;
    talk_theme_id: string | null;
    overlay_theme_id: string | null;
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
    presentation_theme_id: row.presentation_theme_id,
    lyric_theme_id: row.lyric_theme_id,
    talk_theme_id: row.talk_theme_id,
    overlay_theme_id: row.overlay_theme_id,
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

function readProjectBackupSlideElements(db: SqliteDatabase): ProjectBackupSlideElementRow[] {
  const rows = db
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

function readProjectBackupTalkScriptBlocks(db: SqliteDatabase): ProjectBackupTalkScriptBlockRow[] {
  const rows = db
    .prepare(
      `SELECT id, slide_id, text, order_index, created_at, updated_at
       FROM talk_script_blocks
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; slide_id: string; text: string; order_index: number; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    slide_id: row.slide_id,
    text: row.text,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupPlaylists(db: SqliteDatabase): ProjectBackupPlaylistRow[] {
  const rows = db
    .prepare('SELECT id, name, order_index, created_at, updated_at FROM playlists ORDER BY created_at ASC, id ASC')
    .all() as Array<{ id: string; name: string; order_index: number; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupPlaylistEntries(db: SqliteDatabase): ProjectBackupPlaylistEntryRow[] {
  const rows = db
    .prepare(
      `SELECT id, playlist_id, kind, presentation_id, lyric_id, talk_id, label, color_key, order_index, created_at, updated_at
       FROM playlist_entries
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{
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
  }>;

  return rows.map((row) => ({
    id: row.id,
    playlist_id: row.playlist_id,
    kind: row.kind,
    presentation_id: row.presentation_id,
    lyric_id: row.lyric_id,
    talk_id: row.talk_id,
    label: row.label,
    color_key: row.color_key,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupMediaAssets(db: SqliteDatabase, table: MediaAssetTableName): ProjectBackupMediaAssetRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, src, order_index, created_at, updated_at
       FROM ${table}
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; name: string; src: string; order_index: number; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    src: row.src,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupOverlays(db: SqliteDatabase): ProjectBackupOverlayRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, enabled, animation_json, order_index, created_at, updated_at
       FROM overlays
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; name: string; enabled: number; animation_json: string; order_index: number; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    animation_json: row.animation_json,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupThemeRows(db: SqliteDatabase, table: ThemeTableName): ProjectBackupThemeRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, width, height, order_index, created_at, updated_at
       FROM ${table}
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; name: string; width: number; height: number; order_index: number; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupStages(db: SqliteDatabase): ProjectBackupStageRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, width, height, order_index, created_at, updated_at
       FROM stages
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; name: string; width: number; height: number; order_index: number; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    width: row.width,
    height: row.height,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupCues(db: SqliteDatabase): ProjectBackupCueRow[] {
  const rows = db
    .prepare(
      `SELECT id, kind, payload_json, failure_policy, created_at, updated_at
       FROM cues
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{ id: string; kind: string; payload_json: string; failure_policy: string; created_at: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind as CueKind,
    payload_json: row.payload_json,
    failure_policy: row.failure_policy as CueFailurePolicy,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupActions(db: SqliteDatabase): ProjectBackupMacroRow[] {
  const rows = db
    .prepare(
      `SELECT id, name, description, scope_level, on_scope_exit, loop_enabled, loop_count,
              order_index, created_at, updated_at
       FROM actions
       ORDER BY created_at ASC, id ASC`,
    )
    .all() as Array<{
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

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    scope_level: row.scope_level as ScopeLevel,
    on_scope_exit: row.on_scope_exit as OnScopeExit,
    loop_enabled: row.loop_enabled,
    loop_count: row.loop_count,
    order_index: row.order_index,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

function readProjectBackupActionSteps(db: SqliteDatabase): ProjectBackupMacroStepRow[] {
  const rows = db
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

function readProjectBackupTriggerBindings(db: SqliteDatabase): ProjectBackupTriggerBindingRow[] {
  const rows = db
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

/** Assembles a `ProjectBackupTables` document by reading every application-owned table off `db`, in the same deterministic order `CastRepository.exportProjectBackup` has always used. */
export function buildProjectBackupTables(db: SqliteDatabase): ProjectBackupTables {
  return {
    presentations: readProjectBackupItems(db, 'presentations'),
    lyrics: readProjectBackupItems(db, 'lyrics'),
    talks: readProjectBackupItems(db, 'talks'),
    slides: readProjectBackupSlides(db),
    slide_elements: readProjectBackupSlideElements(db),
    talk_script_blocks: readProjectBackupTalkScriptBlocks(db),
    playlists: readProjectBackupPlaylists(db),
    playlist_entries: readProjectBackupPlaylistEntries(db),
    image_assets: readProjectBackupMediaAssets(db, 'image_assets'),
    video_assets: readProjectBackupMediaAssets(db, 'video_assets'),
    audio_assets: readProjectBackupMediaAssets(db, 'audio_assets'),
    overlays: readProjectBackupOverlays(db),
    presentation_themes: readProjectBackupThemeRows(db, 'presentation_themes'),
    lyric_themes: readProjectBackupThemeRows(db, 'lyric_themes'),
    talk_themes: readProjectBackupThemeRows(db, 'talk_themes'),
    overlay_themes: readProjectBackupThemeRows(db, 'overlay_themes'),
    stages: readProjectBackupStages(db),
    cues: readProjectBackupCues(db),
    actions: readProjectBackupActions(db),
    action_steps: readProjectBackupActionSteps(db),
    trigger_bindings: readProjectBackupTriggerBindings(db),
  };
}
