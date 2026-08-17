// ---------------------------------------------------------------------------
// TEMPORARY COMPATIBILITY FACADE (#116 / #153)
//
// This module used to define every shared shape directly. Domain primitives
// and persistence-only DTOs have been split out to their explicit owners
// (app/core/domain/ and app/database/dto/ respectively — see #153); the
// exports below are re-exports only, kept so the ~150 existing importers of
// `@core/types` do not all need to change in the same slice as the move.
//
// Per the #116 fixed decisions this file gains no new declarations and no
// logic for migrated families — it is exports-only for them. IPC/application
// contracts (#154) and renderer view models (#155) have not moved yet; #155
// is the exit condition that removes this facade entirely once every
// consumer imports from the owning module directly.
// ---------------------------------------------------------------------------

export type { Id } from './domain/ids';
export type {
  Library,
  Playlist,
  PlaylistGroup,
  PlaylistEntry,
  PlaylistTree,
  LibraryPlaylistBundle,
} from './domain/library';
export type { DeckItemType, ThemeOwnerKind, Presentation, Lyric, Talk, DeckItem } from './domain/decks';
export type {
  SlideKind,
  SlideBackgroundFit,
  GradientStop,
  SlideGradient,
  SlideBackground,
  SlideBackgroundSource,
  Slide,
  TalkScriptBlock,
} from './domain/slides';
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
} from './domain/slide-elements';
export type { MediaAssetType, MediaAsset } from './domain/media-assets';
export type { OverlayType, OverlayAnimation, Overlay } from './domain/overlays';
export type { ThemeKind, Theme } from './domain/theme';
export type { Stage } from './domain/stages';
export type { CollectionBinKind, Collection, CollectionItemType } from './domain/collections';
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

// ---------------------------------------------------------------------------
// Imports of migrated declarations needed by the application-contract shapes
// that remain defined below (they have not moved — see #154). These are
// ordinary type-only imports, not part of the facade above.
// ---------------------------------------------------------------------------
import type { Id } from './domain/ids';
import type { Library, LibraryPlaylistBundle } from './domain/library';
import type { DeckItemType, Presentation, Lyric, Talk } from './domain/decks';
import type { SlideBackground, SlideBackgroundSource, Slide, TalkScriptBlock } from './domain/slides';
import type { SlideElementType, SlideElementBase, SlideElementPayload, SlideElement } from './domain/slide-elements';
import type { MediaAssetType, MediaAsset } from './domain/media-assets';
import type { OverlayType, OverlayAnimation, Overlay } from './domain/overlays';
import type { ThemeKind, Theme } from './domain/theme';
import type { Stage } from './domain/stages';
import type { CollectionBinKind, Collection, CollectionItemType } from './domain/collections';
import type {
  CueFailurePolicy,
  CueKind,
  TriggerType,
  TriggerBindingTargetType,
  ScopeLevel,
  OnScopeExit,
  CuePayload,
  Cue,
  Macro,
  TriggerBinding,
} from './domain/automation';

export interface SlideBackgroundUpdateInput {
  slideId: Id;
  background: SlideBackground | null;
}

export interface CollectionCreateInput {
  binKind: CollectionBinKind;
  name: string;
}

export interface CollectionRenameInput {
  binKind: CollectionBinKind;
  id: Id;
  name: string;
}

export interface CollectionDeleteInput {
  binKind: CollectionBinKind;
  id: Id;
}

export interface CollectionReorderInput {
  binKind: CollectionBinKind;
  ids: Id[];
}

export interface CollectionAssignmentInput {
  itemType: CollectionItemType;
  itemId: Id;
  collectionId: Id;
}

export interface DeckBundleTheme {
  id: Id;
  name: string;
  kind: ThemeKind;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

export interface DeckBundleSlide {
  id: Id;
  width: number;
  height: number;
  notes: string;
  order: number;
  background?: SlideBackground | null;
  backgroundSource?: SlideBackgroundSource;
  elements: SlideElement[];
  scriptBlocks?: DeckBundleTalkScriptBlock[];
}

export interface DeckBundleTalkScriptBlock {
  id: Id;
  text: string;
  order: number;
}

export interface DeckBundleItem {
  id: Id;
  type: DeckItemType;
  title: string;
  themeId: Id | null;
  order: number;
  slides: DeckBundleSlide[];
}

export interface DeckBundleMediaReference {
  source: string;
  elementTypes: Array<'image' | 'video'>;
  occurrenceCount: number;
}

export interface DeckBundleStage {
  id: Id;
  name: string;
  width: number;
  height: number;
  order: number;
  elements: SlideElement[];
}

export interface DeckBundleOverlay {
  id: Id;
  name: string;
  type: OverlayType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  zIndex: number;
  enabled: boolean;
  elements: SlideElement[];
  animation: OverlayAnimation;
}

// Wire format for the deck-bundle export/import file. Intentionally mirrors
// the legacy owner-column shape (not `PlaylistItemReference`) so exported
// bundles keep a stable, versioned on-disk schema; interpret and construct
// these columns only via @core/playlist-item-reference and @core/deck-bundles.
export interface DeckBundlePlaylistEntry {
  id: Id;
  presentationId: Id | null;
  lyricId: Id | null;
  talkId?: Id | null;
  order: number;
}

export interface DeckBundlePlaylistGroup {
  id: Id;
  name: string;
  colorKey: string | null;
  order: number;
  entries: DeckBundlePlaylistEntry[];
}

export interface DeckBundlePlaylist {
  id: Id;
  name: string;
  libraryName: string;
  order: number;
  groups: DeckBundlePlaylistGroup[];
}

export interface DeckBundleManifest {
  format: 'cast-deck-bundle';
  version: 1;
  exportedAt: string;
  items: DeckBundleItem[];
  themes: DeckBundleTheme[];
  mediaReferences: DeckBundleMediaReference[];
  overlays?: DeckBundleOverlay[];
  stages?: DeckBundleStage[];
  playlists?: DeckBundlePlaylist[];
}

export interface DeckBundleExportOptions {
  includeAllThemes?: boolean;
  includeOverlays?: boolean;
  includeStages?: boolean;
  playlistIds?: Id[];
}

export interface DeckBundleInspectionItem {
  id: Id;
  title: string;
  type: DeckItemType;
  slideCount: number;
  themeId: Id | null;
}

export interface DeckBundleInspectionTheme {
  id: Id;
  name: string;
  kind: ThemeKind;
}

export interface DeckBundleInspectionOverlay {
  id: Id;
  name: string;
  type: OverlayType;
}

export interface DeckBundleInspectionStage {
  id: Id;
  name: string;
}

export interface DeckBundleInspectionPlaylist {
  id: Id;
  name: string;
  libraryName: string;
  groupCount: number;
  entryCount: number;
}

export interface BrokenDeckBundleReference {
  source: string;
  elementTypes: Array<'image' | 'video'>;
  occurrenceCount: number;
  itemTitles: string[];
  themeNames: string[];
  overlayNames: string[];
  stageNames: string[];
}

export interface DeckBundleInspection {
  exportedAt: string;
  itemCount: number;
  themeCount: number;
  mediaReferenceCount: number;
  overlayCount: number;
  stageCount: number;
  playlistCount: number;
  items: DeckBundleInspectionItem[];
  themes: DeckBundleInspectionTheme[];
  overlays: DeckBundleInspectionOverlay[];
  stages: DeckBundleInspectionStage[];
  playlists: DeckBundleInspectionPlaylist[];
  mediaReferences: DeckBundleMediaReference[];
  brokenReferences: BrokenDeckBundleReference[];
}

export type DeckBundleBrokenReferenceAction = 'replace' | 'remove' | 'leave';

export interface DeckBundleBrokenReferenceDecision {
  source: string;
  action: DeckBundleBrokenReferenceAction;
  replacementPath?: string;
}

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

export interface CueCreateInput {
  kind: CueKind;
  payload: CuePayload;
  failurePolicy?: CueFailurePolicy;
}

export interface CueUpdateInput {
  id: Id;
  kind?: CueKind;
  payload?: CuePayload;
  failurePolicy?: CueFailurePolicy;
}

export interface MacroCreateInput {
  name: string;
  description?: string;
  collectionId?: Id;
  scopeLevel?: ScopeLevel;
  onScopeExit?: OnScopeExit;
  loopEnabled?: boolean;
  loopCount?: number | null;
  cues?: Array<{
    cueId: Id;
    orderIndex: number;
    delayBeforeMs?: number;
    delayAfterMs?: number;
  }>;
}

export interface MacroUpdateInput {
  id: Id;
  name?: string;
  description?: string;
  scopeLevel?: ScopeLevel;
  onScopeExit?: OnScopeExit;
  loopEnabled?: boolean;
  loopCount?: number | null;
  cues?: Array<{
    id?: Id;
    cueId: Id;
    orderIndex: number;
    delayBeforeMs?: number;
    delayAfterMs?: number;
  }>;
}

export interface TriggerBindingCreateInput {
  triggerType: TriggerType;
  sourceId: Id | null;
  targetType: TriggerBindingTargetType;
  targetId: Id;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface AppSnapshot {
  libraries: Library[];
  libraryBundles: LibraryPlaylistBundle[];
  presentations: Presentation[];
  lyrics: Lyric[];
  talks: Talk[];
  slides: Slide[];
  talkScriptBlocks: TalkScriptBlock[];
  slideElements: SlideElement[];
  mediaAssets: MediaAsset[];
  overlays: Overlay[];
  themes: Theme[];
  stages: Stage[];
  collections: Collection[];
  cues: Cue[];
  macros: Macro[];
  triggerBindings: TriggerBinding[];
}

export interface PlaybackState {
  playlistId: Id | null;
  deckItemId: Id | null;
  slideIndex: number;
}

export type SlideBrowserMode = 'library' | 'playlist' | 'deck' | 'deck-editor';

export interface SlideCreateInput {
  presentationId?: Id | null;
  lyricId?: Id | null;
  talkId?: Id | null;
  width?: number;
  height?: number;
}

export interface TalkScriptBlockCreateInput {
  slideId: Id;
  text?: string;
  order?: number;
}

export interface TalkScriptBlockUpdateInput {
  id: Id;
  text: string;
}

export interface TalkScriptBlockOrderUpdateInput {
  id: Id;
  newOrder: number;
}

export interface SlideNotesUpdateInput {
  slideId: Id;
  notes: string;
}

export interface SlideOrderUpdateInput {
  slideId: Id;
  newOrder: number;
}

export interface ElementCreateInput {
  id?: Id;
  slideId: Id;
  type: SlideElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  layer?: SlideElementBase['layer'];
  payload: SlideElementPayload;
  sourceThemeElementId?: Id | null;
}

export interface ElementUpdateInput {
  id: Id;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  layer?: SlideElementBase['layer'];
  payload?: SlideElementPayload;
}

export type NdiOutputName = 'audience' | 'stage';

export interface NdiOutputState {
  audience: boolean;
  stage: boolean;
}

export type NdiSourceStatus = 'idle' | 'live';

export interface NdiOutputConfig {
  senderName: string;
  withAlpha: boolean;
}

export type NdiOutputConfigMap = Record<NdiOutputName, NdiOutputConfig>;

export interface NdiTallyState {
  onProgram: boolean;
  onPreview: boolean;
}

export interface NdiActiveSenderDiagnostics {
  senderName: string;
  width: number;
  height: number;
  withAlpha: boolean;
  asyncVideoSend: boolean;
  connectionCount: number | null;
  // Bidirectional NDI tally signal (receiver tells sender "I'm on program /
  // preview"). Null if the loaded runtime doesn't expose tally polling.
  tally: NdiTallyState | null;
  startedAtMs: number;
  performance: NdiSenderPerformanceDiagnostics;
  audio: NdiSenderAudioDiagnostics;
}

export interface NdiFrameTelemetry {
  captureDurationMs: number;
  readbackDurationMs: number;
  skippedCaptures: number;
  framesDroppedBackpressure: number;
  // Cross-process Date.now() timestamps. Each stage stamps as the frame
  // travels: renderer sets signature/capture/rendererSend; main sets
  // mainReceived and proxyForwarded; utility sets hostReceived. The native
  // send timestamp is computed inside the service and not echoed back.
  // Optional — older telemetry shapes still validate.
  signatureChangedAtMs?: number | null;
  captureStartedAtMs?: number;
  rendererSendAtMs?: number;
  mainReceivedAtMs?: number;
  proxyForwardedAtMs?: number;
  hostReceivedAtMs?: number;
}

export interface NdiPipelineStageStats {
  p50: number;
  p95: number;
  lastMs: number;
  count: number;
}

export interface NdiPipelineLatencyDiagnostics {
  // Headline numbers — the user's symptom is sender-side latency, and
  // signatureToWire is how long between a state change and bits on the wire.
  frameAgeAtWire: NdiPipelineStageStats;
  signatureToWire: NdiPipelineStageStats;
  // Per-stage spans — for attributing where time goes when the headline
  // numbers are too high.
  captureToRendererSend: NdiPipelineStageStats;
  rendererToMainIpc: NdiPipelineStageStats;
  mainHandler: NdiPipelineStageStats;
  mainToHostIpc: NdiPipelineStageStats;
  hostToNative: NdiPipelineStageStats;
}

export interface NdiSenderPerformanceDiagnostics {
  framesCaptured: number;
  framesSent: number;
  framesReplayed: number;
  framesRejected: number;
  framesSkippedNoConnections: number;
  skippedCaptures: number;
  framesDroppedBackpressure: number;
  bytesReceived: number;
  cacheCopyBytes: number;
  avgCaptureDurationMs: number;
  avgReadbackDurationMs: number;
  avgSendDurationMs: number;
  // p50/p95/p99 of send durations over the rolling window — captures
  // latency tail not visible from the average.
  p50SendDurationMs: number;
  p95SendDurationMs: number;
  p99SendDurationMs: number;
  // Standard deviation of the inter-send interval. High jitter is a
  // strong signal that something upstream (capture, IPC, GC) is stalling.
  sendIntervalJitterMs: number;
  lastFrameBytes: number;
  minFrameBytes: number;
  maxFrameBytes: number;
  blackoutFramesSent: number;
  // Stage-by-stage pipeline latency for diagnosing where sender-side time
  // is going (renderer capture → IPC → utility process → native send).
  pipeline: NdiPipelineLatencyDiagnostics;
}

export interface NdiSenderAudioDiagnostics {
  audioFramesReceived: number;
  audioFramesSent: number;
  audioFramesRejected: number;
  audioSamplesSent: number;
  audioSilenceFramesSent: number;
  lastSampleRate: number;
  lastChannels: number;
}

export interface NdiDiagnostics {
  outputState: NdiOutputState;
  outputConfig: NdiOutputConfig;
  outputConfigs: NdiOutputConfigMap;
  runtimeLoaded: boolean;
  runtimePath: string | null;
  activeSender: NdiActiveSenderDiagnostics | null;
  senders: Record<NdiOutputName, NdiActiveSenderDiagnostics | null>;
  sourceStatus: NdiSourceStatus;
  lastError: string | null;
}

export interface OverlayCreateInput {
  name: string;
  elements?: SlideElement[];
  animation?: OverlayAnimation;
  collectionId?: Id;
}

export interface OverlayUpdateInput {
  id: Id;
  name?: string;
  elements?: SlideElement[];
  animation?: OverlayAnimation;
}

export interface ThemeCreateInput {
  name: string;
  kind: ThemeKind;
  width?: number;
  height?: number;
  background?: SlideBackground | null;
  elements?: SlideElement[];
  collectionId?: Id;
}

export interface ThemeUpdateInput {
  id: Id;
  name?: string;
  kind?: ThemeKind;
  width?: number;
  height?: number;
  background?: SlideBackground | null;
  elements?: SlideElement[];
}

export interface StageCreateInput {
  name: string;
  width?: number;
  height?: number;
  elements?: SlideElement[];
  collectionId?: Id;
}

export interface StageUpdateInput {
  id: Id;
  name?: string;
  width?: number;
  height?: number;
  elements?: SlideElement[];
}

export interface MediaAssetCreateInput {
  name: string;
  type: MediaAssetType;
  src: string;
  collectionId?: Id;
}

export interface SystemProcessMetrics {
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  externalBytes: number;
  cpuPercent: number;
}

export interface SystemMetricsSnapshot {
  capturedAtMs: number;
  uptimeSeconds: number;
  main: SystemProcessMetrics;
}

export interface LogSessionSummary {
  path: string;
  fileName: string;
  sizeBytes: number;
  modifiedAtMs: number;
  isCurrent: boolean;
}

export interface LogReadResult {
  totalBytes: number;
  // Byte offset returned to the caller for incremental reads. Pass back as
  // `offset` to fetch the next chunk after `lines`.
  nextOffset: number;
  lines: string[];
}
