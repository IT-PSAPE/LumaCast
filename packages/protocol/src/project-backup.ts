import type { Id } from '@lumacast/kernel';
import type { SlideKind, SlideBackgroundSource, SlideElementType, SlideElementBase } from '@lumacast/composition';
import type {
  CueFailurePolicy,
  CueKind,
  ScopeLevel,
  OnScopeExit,
  TriggerType,
  TriggerBindingTargetType,
} from '@lumacast/automation';

// ---------------------------------------------------------------------------
// Project backup (#145): a complete, versioned serialization of every
// application-owned table. This is a separate contract from the narrow
// deck-bundle manifest: every table and every column is enumerated explicitly
// in deterministic table/row order, and the document carries references and
// metadata only — never copies of managed media files.
//
// Column names mirror the SQL schema verbatim (`order_index`, `payload_json`,
// …) so the mapping is unambiguous; JSON-valued columns are stored as their
// raw serialized strings, exactly as persisted. `format`/`version` identify
// the backup document contract; `schemaVersion` records the database
// `PRAGMA user_version` at export time (see ADR-0006). The envelope carries no
// timestamp, so two exports of unchanged data serialize byte-for-byte
// identically.
//
// Category decision (#215, parent #116/#153): despite the SQL-mirroring row
// shape, this family is not a persistence DTO — it is consumed as a
// type-level dependency by app/core/deck-bundles.ts (validateProjectBackup,
// ProjectBackupTableKey), by the IPC contract (app/core/ipc.ts), and by
// app/main (deck-bundle-archive.ts, ipc.ts, preload.ts), in addition to the
// database layer that produces and restores it (app/database/store.ts).
// core-purity forbids core from importing app/database, so app/database/dto/
// is architecturally unreachable for a family core must validate. It lives
// here instead, in app/contracts/ — the neutral serialization-contract
// boundary every zone may import (issue #149) — alongside the codecs that
// already decode/validate other wire formats. See docs/ARCHITECTURE.md
// ("Dependency Boundaries" / "Project Backup") for the recorded rationale.
//
// #219 item-model refactor (decision D8): format version 2, pinned to
// schema version 27 (the last of the item-model migrations, v23–v27 — see
// the design doc's D7). No `libraries`, no `playlist_groups`, no
// `collection_id` anywhere, and no single `themes` table: the four per-owner
// theme tables each get their own key. Version 1 backups (schema 22, the
// last pre-#219 schema) are no longer silently unreadable: `deck-bundles.ts`
// exports `isLegacyProjectBackup`/`validateLegacyProjectBackup`, a documented
// way to classify a v1 document as legacy-but-structurally-plausible instead
// of throwing, and @lumacast/persistence-sqlite's `restoreProjectBackup`
// (wave K) materializes a validated v1 document through the real v23–v27
// migrations and restores the result via this same v2 path. A v1 document
// that is NOT structurally plausible (garbage, or any schema version other
// than 22) is still rejected explicitly, never silently. `validateProjectBackup`
// below keeps rejecting version 1 outright — it validates a v2 document,
// full stop; the legacy pair is a separate, deliberate opt-in for callers
// that want to import an old file rather than reject it.
// ---------------------------------------------------------------------------

/** Shared row shape for presentations / lyrics / talks. */
export interface ProjectBackupItemRow {
  id: Id;
  title: string;
  theme_id: Id | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupSlideRow {
  id: Id;
  presentation_id: Id | null;
  lyric_id: Id | null;
  talk_id: Id | null;
  presentation_theme_id: Id | null;
  lyric_theme_id: Id | null;
  talk_theme_id: Id | null;
  overlay_theme_id: Id | null;
  overlay_id: Id | null;
  stage_id: Id | null;
  kind: SlideKind;
  width: number;
  height: number;
  notes: string;
  background_json: string | null;
  background_source: SlideBackgroundSource | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupSlideElementRow {
  id: Id;
  slide_id: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  z_index: number;
  layer: SlideElementBase['layer'];
  payload_json: string;
  source_theme_element_id: Id | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupTalkScriptBlockRow {
  id: Id;
  slide_id: Id;
  text: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupPlaylistRow {
  id: Id;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/**
 * Flat playlist row (decision D5): `kind` discriminates an item entry from a
 * separator. `kind='item'` rows populate exactly one of
 * presentation_id/lyric_id/talk_id and leave label/color_key null;
 * `kind='separator'` rows leave all three owner columns null and carry
 * label/color_key instead. There is no `group_id` — playlists are flat.
 */
export interface ProjectBackupPlaylistEntryRow {
  id: Id;
  playlist_id: Id;
  kind: 'item' | 'separator';
  presentation_id: Id | null;
  lyric_id: Id | null;
  talk_id: Id | null;
  label: string | null;
  color_key: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Shared row shape for image_assets / video_assets / audio_assets. */
export interface ProjectBackupMediaAssetRow {
  id: Id;
  name: string;
  src: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupOverlayRow {
  id: Id;
  name: string;
  enabled: number;
  animation_json: string;
  created_at: string;
  updated_at: string;
}

/** Shared row shape for the four per-owner theme tables (decision D2). */
export interface ProjectBackupThemeRow {
  id: Id;
  name: string;
  width: number;
  height: number;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupStageRow {
  id: Id;
  name: string;
  width: number;
  height: number;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupCueRow {
  id: Id;
  kind: CueKind;
  payload_json: string;
  failure_policy: CueFailurePolicy;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupMacroRow {
  id: Id;
  name: string;
  description: string;
  scope_level: ScopeLevel;
  on_scope_exit: OnScopeExit;
  loop_enabled: number;
  loop_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupMacroStepRow {
  id: Id;
  action_id: Id;
  kind: CueKind;
  payload_json: string;
  failure_policy: CueFailurePolicy;
  /** Nullable in v22: the physical column has no NOT NULL constraint, so direct or externally maintained database state may contain null. */
  cue_id: Id | null;
  order_index: number;
  delay_before_ms: number;
  delay_after_ms: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupTriggerBindingRow {
  id: Id;
  trigger_type: TriggerType;
  source_id: Id | null;
  target_type: TriggerBindingTargetType;
  target_id: Id;
  config_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupTables {
  presentations: ProjectBackupItemRow[];
  lyrics: ProjectBackupItemRow[];
  talks: ProjectBackupItemRow[];
  slides: ProjectBackupSlideRow[];
  slide_elements: ProjectBackupSlideElementRow[];
  talk_script_blocks: ProjectBackupTalkScriptBlockRow[];
  playlists: ProjectBackupPlaylistRow[];
  playlist_entries: ProjectBackupPlaylistEntryRow[];
  image_assets: ProjectBackupMediaAssetRow[];
  video_assets: ProjectBackupMediaAssetRow[];
  audio_assets: ProjectBackupMediaAssetRow[];
  overlays: ProjectBackupOverlayRow[];
  presentation_themes: ProjectBackupThemeRow[];
  lyric_themes: ProjectBackupThemeRow[];
  talk_themes: ProjectBackupThemeRow[];
  overlay_themes: ProjectBackupThemeRow[];
  stages: ProjectBackupStageRow[];
  cues: ProjectBackupCueRow[];
  actions: ProjectBackupMacroRow[];
  action_steps: ProjectBackupMacroStepRow[];
  trigger_bindings: ProjectBackupTriggerBindingRow[];
}

export interface ProjectBackup {
  format: 'cast-project-backup';
  version: 2;
  schemaVersion: number;
  tables: ProjectBackupTables;
}

// ---------------------------------------------------------------------------
// Legacy (v1) project backup shapes — format version 1, pinned to schema
// version 22 (the last pre-#219 schema; see the frozen migrations in
// @lumacast/persistence-sqlite/src/migrations/definitions.ts, versions 1–22).
// Column names mirror that schema verbatim, exactly as the v2 shapes above
// mirror the current one. These types exist solely so
// `isLegacyProjectBackup`/`validateLegacyProjectBackup` (deck-bundles.ts) and
// @lumacast/persistence-sqlite's legacy import path have something precise to
// decode a v1 document into — never construct one of these by hand outside
// that import path, and never evolve these shapes to track schema changes:
// they describe one frozen historical schema, forever.
// ---------------------------------------------------------------------------

export interface ProjectBackupV1LibraryRow {
  id: Id;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Shared v1 row shape for presentations / lyrics / talks (each carried a `collection_id`). */
export interface ProjectBackupV1ItemRow {
  id: Id;
  title: string;
  theme_id: Id | null;
  collection_id: Id;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** The v1 `slides.kind` domain: a single bare `'theme'` value, not yet split per owner. */
export type ProjectBackupV1SlideKind = 'presentation' | 'lyric' | 'talk' | 'theme' | 'overlay' | 'stage';

export interface ProjectBackupV1SlideRow {
  id: Id;
  presentation_id: Id | null;
  lyric_id: Id | null;
  talk_id: Id | null;
  theme_id: Id | null;
  overlay_id: Id | null;
  stage_id: Id | null;
  kind: ProjectBackupV1SlideKind;
  width: number;
  height: number;
  notes: string;
  background_json: string | null;
  background_source: SlideBackgroundSource | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1SlideElementRow {
  id: Id;
  slide_id: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  z_index: number;
  layer: SlideElementBase['layer'];
  payload_json: string;
  source_theme_element_id: Id | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1TalkScriptBlockRow {
  id: Id;
  slide_id: Id;
  text: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1PlaylistRow {
  id: Id;
  library_id: Id;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1PlaylistGroupRow {
  id: Id;
  playlist_id: Id;
  name: string;
  color_key: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Legacy nullable owner columns exactly as persisted by v1 `playlist_entries`. */
export interface ProjectBackupV1PlaylistEntryRow {
  id: Id;
  group_id: Id;
  presentation_id: Id | null;
  lyric_id: Id | null;
  talk_id: Id | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Shared v1 row shape for image_assets / video_assets / audio_assets. */
export interface ProjectBackupV1MediaAssetRow {
  id: Id;
  name: string;
  src: string;
  collection_id: Id;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1OverlayRow {
  id: Id;
  name: string;
  enabled: number;
  animation_json: string;
  collection_id: Id;
  created_at: string;
  updated_at: string;
}

/** The v1 single-table theme `kind` domain, pre-per-owner-table split. */
export type ProjectBackupV1ThemeKind = 'slides' | 'lyrics' | 'overlays';

export interface ProjectBackupV1ThemeRow {
  id: Id;
  name: string;
  kind: ProjectBackupV1ThemeKind;
  width: number;
  height: number;
  order_index: number;
  collection_id: Id;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1StageRow {
  id: Id;
  name: string;
  width: number;
  height: number;
  order_index: number;
  collection_id: Id;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1CueRow {
  id: Id;
  kind: CueKind;
  payload_json: string;
  failure_policy: CueFailurePolicy;
  created_at: string;
  updated_at: string;
}

/** The v1 macro scope domain: `'deckItem'`, renamed to `'item'` by migration v27 (decision D6). */
export type ProjectBackupV1ScopeLevel = 'global' | 'deckItem' | 'slide';

export interface ProjectBackupV1MacroRow {
  id: Id;
  name: string;
  description: string;
  collection_id: Id;
  scope_level: ProjectBackupV1ScopeLevel;
  on_scope_exit: OnScopeExit;
  loop_enabled: number;
  loop_count: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1MacroStepRow {
  id: Id;
  action_id: Id;
  kind: CueKind;
  payload_json: string;
  failure_policy: CueFailurePolicy;
  /** Nullable in v22: the physical column has no NOT NULL constraint. */
  cue_id: Id | null;
  order_index: number;
  delay_before_ms: number;
  delay_after_ms: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1TriggerBindingRow {
  id: Id;
  trigger_type: TriggerType;
  source_id: Id | null;
  target_type: TriggerBindingTargetType;
  target_id: Id;
  config_json: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

/** Shared v1 row shape for the eight per-bin collection tables (decision D3: all destroyed). */
export interface ProjectBackupV1CollectionRow {
  id: Id;
  name: string;
  order_index: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupV1Tables {
  libraries: ProjectBackupV1LibraryRow[];
  presentations: ProjectBackupV1ItemRow[];
  lyrics: ProjectBackupV1ItemRow[];
  talks: ProjectBackupV1ItemRow[];
  slides: ProjectBackupV1SlideRow[];
  slide_elements: ProjectBackupV1SlideElementRow[];
  talk_script_blocks: ProjectBackupV1TalkScriptBlockRow[];
  playlists: ProjectBackupV1PlaylistRow[];
  playlist_groups: ProjectBackupV1PlaylistGroupRow[];
  playlist_entries: ProjectBackupV1PlaylistEntryRow[];
  image_assets: ProjectBackupV1MediaAssetRow[];
  video_assets: ProjectBackupV1MediaAssetRow[];
  audio_assets: ProjectBackupV1MediaAssetRow[];
  overlays: ProjectBackupV1OverlayRow[];
  themes: ProjectBackupV1ThemeRow[];
  stages: ProjectBackupV1StageRow[];
  cues: ProjectBackupV1CueRow[];
  actions: ProjectBackupV1MacroRow[];
  action_steps: ProjectBackupV1MacroStepRow[];
  trigger_bindings: ProjectBackupV1TriggerBindingRow[];
  deck_collections: ProjectBackupV1CollectionRow[];
  image_collections: ProjectBackupV1CollectionRow[];
  video_collections: ProjectBackupV1CollectionRow[];
  audio_collections: ProjectBackupV1CollectionRow[];
  theme_collections: ProjectBackupV1CollectionRow[];
  overlay_collections: ProjectBackupV1CollectionRow[];
  stage_collections: ProjectBackupV1CollectionRow[];
  macro_collections: ProjectBackupV1CollectionRow[];
}

export interface ProjectBackupV1 {
  format: 'cast-project-backup';
  version: 1;
  schemaVersion: number;
  tables: ProjectBackupV1Tables;
}
