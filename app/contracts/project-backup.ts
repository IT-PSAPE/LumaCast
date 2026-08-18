import type { Id } from '@lumacast/kernel';
import type { SlideKind, SlideBackgroundSource, SlideElementType, SlideElementBase, ThemeKind } from '@lumacast/composition';
import type {
  CueFailurePolicy,
  CueKind,
  ScopeLevel,
  OnScopeExit,
  TriggerType,
  TriggerBindingTargetType,
} from '@core/domain/automation';

// ---------------------------------------------------------------------------
// Project backup (#145): a complete, versioned serialization of every
// application-owned v22 table. This is a separate contract from the narrow
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
// ---------------------------------------------------------------------------

export interface ProjectBackupLibraryRow {
  id: Id;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Shared row shape for presentations / lyrics / talks. */
export interface ProjectBackupDeckItemRow {
  id: Id;
  title: string;
  theme_id: Id | null;
  collection_id: Id;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupSlideRow {
  id: Id;
  presentation_id: Id | null;
  lyric_id: Id | null;
  talk_id: Id | null;
  theme_id: Id | null;
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
  library_id: Id;
  name: string;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupPlaylistGroupRow {
  id: Id;
  playlist_id: Id;
  name: string;
  color_key: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Legacy nullable owner columns exactly as persisted by playlist_entries. */
export interface ProjectBackupPlaylistEntryRow {
  id: Id;
  group_id: Id;
  presentation_id: Id | null;
  lyric_id: Id | null;
  talk_id: Id | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

/** Shared row shape for image_assets / video_assets / audio_assets. */
export interface ProjectBackupMediaAssetRow {
  id: Id;
  name: string;
  src: string;
  collection_id: Id;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupOverlayRow {
  id: Id;
  name: string;
  enabled: number;
  animation_json: string;
  collection_id: Id;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupThemeRow {
  id: Id;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  order_index: number;
  collection_id: Id;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupStageRow {
  id: Id;
  name: string;
  width: number;
  height: number;
  order_index: number;
  collection_id: Id;
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
  collection_id: Id;
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

/** Shared row shape for the eight per-bin collection tables. */
export interface ProjectBackupCollectionRow {
  id: Id;
  name: string;
  order_index: number;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectBackupTables {
  libraries: ProjectBackupLibraryRow[];
  presentations: ProjectBackupDeckItemRow[];
  lyrics: ProjectBackupDeckItemRow[];
  talks: ProjectBackupDeckItemRow[];
  slides: ProjectBackupSlideRow[];
  slide_elements: ProjectBackupSlideElementRow[];
  talk_script_blocks: ProjectBackupTalkScriptBlockRow[];
  playlists: ProjectBackupPlaylistRow[];
  playlist_groups: ProjectBackupPlaylistGroupRow[];
  playlist_entries: ProjectBackupPlaylistEntryRow[];
  image_assets: ProjectBackupMediaAssetRow[];
  video_assets: ProjectBackupMediaAssetRow[];
  audio_assets: ProjectBackupMediaAssetRow[];
  overlays: ProjectBackupOverlayRow[];
  themes: ProjectBackupThemeRow[];
  stages: ProjectBackupStageRow[];
  cues: ProjectBackupCueRow[];
  actions: ProjectBackupMacroRow[];
  action_steps: ProjectBackupMacroStepRow[];
  trigger_bindings: ProjectBackupTriggerBindingRow[];
  deck_collections: ProjectBackupCollectionRow[];
  image_collections: ProjectBackupCollectionRow[];
  video_collections: ProjectBackupCollectionRow[];
  audio_collections: ProjectBackupCollectionRow[];
  theme_collections: ProjectBackupCollectionRow[];
  overlay_collections: ProjectBackupCollectionRow[];
  stage_collections: ProjectBackupCollectionRow[];
  macro_collections: ProjectBackupCollectionRow[];
}

export interface ProjectBackup {
  format: 'cast-project-backup';
  version: 1;
  schemaVersion: number;
  tables: ProjectBackupTables;
}
