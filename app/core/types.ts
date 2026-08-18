// ---------------------------------------------------------------------------
// TEMPORARY COMPATIBILITY FACADE (#116 / #153 / #154)
//
// This module used to define every shared shape directly. Domain primitives
// (app/core/domain/, #153), persistence-only DTOs (found to have zero
// candidates once ProjectBackup* was reclassified as a serialization
// contract, #153/#215), and IPC/application contracts (app/contracts/,
// #154) have all been split out to their explicit owners; the exports below
// are re-exports only, kept so the existing importers of `@core/types` —
// chiefly the renderer and database layers, both outside this slice's write
// boundary — do not all need to change in the same slice as each move.
//
// Per the #116 fixed decisions this file gains no new declarations and no
// logic for migrated families — it is exports-only for them. Only renderer
// view models (`PlaybackState`, `SlideBrowserMode`) remain declared directly
// below; #155 is the exit condition that moves them and removes this facade
// entirely once every consumer imports from the owning module directly.
// ---------------------------------------------------------------------------

export type { Id } from '@lumacast/kernel';
export type {
  Library,
  Playlist,
  PlaylistGroup,
  PlaylistEntry,
  PlaylistTree,
  LibraryPlaylistBundle,
} from '@lumacast/composition';
export type { DeckItemType, ThemeOwnerKind, Presentation, Lyric, Talk, DeckItem } from '@lumacast/composition';
export type {
  SlideKind,
  SlideBackgroundFit,
  GradientStop,
  SlideGradient,
  SlideBackground,
  SlideBackgroundSource,
  Slide,
  TalkScriptBlock,
} from '@lumacast/composition';
export type {
  SlideElementType,
  SlideElementBase,
  TextHorizontalAlign,
  TextVerticalAlign,
  TextCaseTransform,
  StrokePosition,
  TextBindingKind,
  ClockFormat,
  TimerFormat,
  TextBinding,
  ElementVisualPayload,
  TextElementPayload,
  ImageElementPayload,
  VideoElementPayload,
  ShapeElementPayload,
  GroupElementPayload,
  SlideElementPayload,
  SlideElement,
} from '@lumacast/composition';
export type { MediaAssetType, MediaAsset } from '@lumacast/composition';
export type { OverlayType, OverlayAnimation, Overlay } from '@lumacast/composition';
export type { ThemeKind, Theme } from '@lumacast/composition';
export type { Stage } from '@lumacast/composition';
export type { CollectionBinKind, Collection, CollectionItemType } from '@lumacast/composition';
export type {
  CueFailurePolicy,
  CueClearLayer,
  CueKind,
  TriggerType,
  TriggerBindingTargetType,
  ScopeLevel,
  OnScopeExit,
  LifecycleAction,
  LifecycleTarget,
  CuePayload,
  Cue,
  MacroCue,
  Macro,
  TriggerBinding,
} from './domain/automation';

// Ordinary type-only import (not part of the re-export facade above): needed
// by `PlaybackState` below, which has not moved (#155, not this slice).
import type { Id } from '@lumacast/kernel';

// ---------------------------------------------------------------------------
// IPC mutation inputs (#154, parent #116): moved to app/contracts/rpc-inputs
// — the argument shapes of RpcMethodSignatures (app/core/ipc.ts). Re-exported
// here only for existing `@core/types` importers (renderer/database, outside
// this slice's write boundary); #155 is the exit condition that removes
// these re-exports entirely.
// ---------------------------------------------------------------------------

export type {
  SlideBackgroundUpdateInput,
  CollectionCreateInput,
  CollectionRenameInput,
  CollectionDeleteInput,
  CollectionReorderInput,
  CollectionAssignmentInput,
  CueCreateInput,
  CueUpdateInput,
  MacroCreateInput,
  MacroUpdateInput,
  TriggerBindingCreateInput,
  SlideCreateInput,
  TalkScriptBlockCreateInput,
  TalkScriptBlockUpdateInput,
  TalkScriptBlockOrderUpdateInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput,
  ElementCreateInput,
  ElementUpdateInput,
  OverlayCreateInput,
  OverlayUpdateInput,
  ThemeCreateInput,
  ThemeUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  MediaAssetCreateInput,
  DeckBundleExportOptions,
} from '../contracts/rpc-inputs';

// ---------------------------------------------------------------------------
// Deck bundle manifest (#154, parent #116): the on-disk `.cst` file format,
// moved to app/contracts/deck-bundle-manifest as an APPLICATION contract
// (never named in RpcMethodSignatures — see that module's header comment and
// docs/ARCHITECTURE.md, "Project Backup", for the same category-decision
// precedent #215 set for `ProjectBackup*`). Re-exported here only for
// existing `@core/types` importers; #155 removes these re-exports.
// ---------------------------------------------------------------------------

export type {
  DeckBundleManifest,
  DeckBundleTheme,
  DeckBundleSlide,
  DeckBundleTalkScriptBlock,
  DeckBundleItem,
  DeckBundleMediaReference,
  DeckBundleStage,
  DeckBundleOverlay,
  DeckBundlePlaylistEntry,
  DeckBundlePlaylistGroup,
  DeckBundlePlaylist,
} from '../contracts/deck-bundle-manifest';

// ---------------------------------------------------------------------------
// IPC query/result shapes (#154, parent #116): moved to
// app/contracts/rpc-results. `AppSnapshot` is dual-natured (wire payload AND
// the database layer's undo representation AND the renderer's cached state)
// — see the comment at its declaration in that module for the full account.
// Re-exported here only for existing `@core/types` importers; #155 removes
// these re-exports.
// ---------------------------------------------------------------------------

export type {
  AppSnapshot,
  DeckBundleInspectionItem,
  DeckBundleInspectionTheme,
  DeckBundleInspectionOverlay,
  DeckBundleInspectionStage,
  DeckBundleInspectionPlaylist,
  BrokenDeckBundleReference,
  DeckBundleInspection,
  DeckBundleBrokenReferenceAction,
  DeckBundleBrokenReferenceDecision,
} from '../contracts/rpc-results';

// ---------------------------------------------------------------------------
// NDI output/diagnostics and observability surface (#154, parent #116):
// moved to app/contracts/ndi-observability. Re-exported here only for
// existing `@core/types` importers; #155 removes these re-exports.
// ---------------------------------------------------------------------------

export type {
  NdiOutputName,
  NdiOutputState,
  NdiSourceStatus,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiTallyState,
  NdiActiveSenderDiagnostics,
  NdiFrameTelemetry,
  NdiPipelineStageStats,
  NdiPipelineLatencyDiagnostics,
  NdiSenderPerformanceDiagnostics,
  NdiSenderAudioDiagnostics,
  NdiDiagnostics,
  SystemProcessMetrics,
  SystemMetricsSnapshot,
  LogSessionSummary,
  LogReadResult,
} from '../contracts/ndi-observability';

// ---------------------------------------------------------------------------
// Project backup (#145): a complete, versioned serialization of every
// application-owned v22 table. See app/contracts/project-backup.ts for the
// full description of the envelope and column conventions.
//
// Moved to app/contracts/ under #215 (parent #116/#153): despite the
// SQL-mirroring row shape, this family is a serialization contract, not a
// persistence DTO — it is consumed as a type-level dependency by
// app/core/deck-bundles.ts, app/core/ipc.ts, and app/main (deck-bundle
// archive, ipc, preload), in addition to the database layer. core-purity
// forbids core from importing app/database, so app/database/dto/ was
// architecturally unreachable for it. See docs/ARCHITECTURE.md for the
// recorded category decision. The re-exports below are kept for consumers
// that still import this family from `@core/types`; #155 is the exit
// condition that removes this facade entirely.
// ---------------------------------------------------------------------------

export type {
  ProjectBackup,
  ProjectBackupTables,
  ProjectBackupLibraryRow,
  ProjectBackupDeckItemRow,
  ProjectBackupSlideRow,
  ProjectBackupSlideElementRow,
  ProjectBackupTalkScriptBlockRow,
  ProjectBackupPlaylistRow,
  ProjectBackupPlaylistGroupRow,
  ProjectBackupPlaylistEntryRow,
  ProjectBackupMediaAssetRow,
  ProjectBackupOverlayRow,
  ProjectBackupThemeRow,
  ProjectBackupStageRow,
  ProjectBackupCueRow,
  ProjectBackupMacroRow,
  ProjectBackupMacroStepRow,
  ProjectBackupTriggerBindingRow,
  ProjectBackupCollectionRow,
} from '../contracts/project-backup';

// ---------------------------------------------------------------------------
// Renderer view models (#155, not this slice): kept as direct declarations
// here. #154's write boundary excludes renderer files, so these cannot move
// yet — #155 is the slice that relocates them and removes this facade.
// ---------------------------------------------------------------------------

export interface PlaybackState {
  playlistId: Id | null;
  deckItemId: Id | null;
  slideIndex: number;
}

export type SlideBrowserMode = 'library' | 'playlist' | 'deck' | 'deck-editor';
