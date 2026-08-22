import type { Id } from '@lumacast/kernel';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import type { ItemRef, ItemType, ThemeOwnerType } from '@lumacast/composition';
import type {
  CueCreateInput,
  CueUpdateInput,
  BundleExportOptions,
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
} from './rpc-inputs';
import type { AppSnapshot, BundleBrokenReferenceDecision, BundleInspection } from './rpc-results';
import type {
  LogReadResult,
  LogSessionSummary,
  NdiDiagnostics,
  NdiFrameRelease,
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiOutputName,
  NdiOutputState,
  SystemMetricsSnapshot,
} from './ndi-observability';
import type { SnapshotPatch } from './snapshot-patch';
import type { ProjectBackup } from './project-backup';
import type { AppMenuCommandId, AppMenuState } from '@lumacast/commands';

export interface RpcError {
  message: string;
}

// Canonical request/response contract (issue #151): one typed map keyed by
// operation name, each entry carrying its input tuple, output type, and
// serialized error category. Every operation here corresponds to exactly one
// non-frame channel in `IPC` below (see the completeness assertion near the
// bottom of this file, next to `NDI_FRAME_CHANNEL_NAMES`). This is the single
// source of truth main, preload, and the renderer round-trip against. It
// deliberately excludes events/subscriptions (`NdiEventPayloads`,
// `AppMenuEventPayloads`) and frame/message channels (`NdiFrameChannels`)
// below — those are separate maps and must never be folded into this one.
//
// Managed media (issue #159): every `src` field crossing this contract — on
// `MediaAsset`, on a `SlideBackground`, on an image/video element payload, and
// the `src` argument of `getAudioCoverArt` — carries an opaque **managed media
// id** in the form `cast-media://<id>`, never a filesystem path. Main mints
// those ids on the way out and resolves them on the way in
// (`app/main/media-capability.ts`); the renderer treats them as opaque URLs it
// may render or hand back, and never constructs or parses one. The single
// exception is a file the user just selected in a native dialog or dropped on
// the window: that short-lived import capability travels inbound as a raw
// `cast-media://<encoded path>` string and is deliberately not generalized
// into the managed-id mechanism.
//
// #219 item-model refactor: there is no collection concept, no library
// concept, and no unified "deck item" concept left on this surface (decisions
// D1/D3/D4). Presentation/Lyric/Talk are independent entities with per-table
// reorder ops; `ItemType`/`ItemRef` is the wire vocabulary wherever an
// operation structurally needs "one of presentation | lyric | talk";
// playlist groups are gone — a playlist is a flat, ordered row list where a
// row is either an item entry or a separator (decision D5).
interface RpcMethodSignatures {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  getInlineWindowMenuItems: () => Promise<InlineWindowMenuItem[]>;
  popupInlineWindowMenu: (menuId: string, bounds: InlineWindowMenuBounds) => Promise<void>;
  updateAppMenuState: (state: AppMenuState) => Promise<void>;
  checkForAppUpdates: (manual?: boolean) => Promise<void>;
  getSnapshot: () => Promise<AppSnapshot>;
  applySnapshotPatch: (patch: SnapshotPatch) => Promise<void>;
  restoreFromSnapshot: (snapshot: AppSnapshot) => Promise<AppSnapshot>;
  chooseBundleExportPath: (suggestedName: string) => Promise<string | null>;
  chooseBundleImportPath: () => Promise<string | null>;
  chooseImportReplacementMediaPath: () => Promise<string | null>;
  exportBundle: (itemIds: Id[], filePath: string, options?: BundleExportOptions) => Promise<{ filePath: string; itemCount: number }>;
  inspectImportBundle: (filePath: string) => Promise<BundleInspection>;
  finalizeImportBundle: (filePath: string, decisions: BundleBrokenReferenceDecision[]) => Promise<AppSnapshot>;
  listCues: () => Promise<Cue[]>;
  createCue: (input: CueCreateInput) => Promise<SnapshotPatch>;
  updateCue: (input: CueUpdateInput) => Promise<SnapshotPatch>;
  deleteCue: (id: Id) => Promise<SnapshotPatch>;
  listMacros: () => Promise<Macro[]>;
  createMacro: (input: MacroCreateInput) => Promise<SnapshotPatch>;
  updateMacro: (input: MacroUpdateInput) => Promise<SnapshotPatch>;
  deleteMacro: (id: Id) => Promise<SnapshotPatch>;
  listTriggerBindings: () => Promise<TriggerBinding[]>;
  createTriggerBinding: (input: TriggerBindingCreateInput) => Promise<SnapshotPatch>;
  deleteTriggerBinding: (id: Id) => Promise<SnapshotPatch>;
  createPlaylist: (name: string) => Promise<SnapshotPatch>;
  // Separator CRUD (decision D5): a separator is a plain divider row inside
  // the flat playlist row list — it keeps its own label and color and never
  // collapses. Replaces the 9 `*PlaylistGroup*`/`*DeckItemToGroup*` channels.
  createSeparator: (playlistId: Id, label: string) => Promise<SnapshotPatch>;
  renameSeparator: (id: Id, label: string) => Promise<SnapshotPatch>;
  setSeparatorColor: (id: Id, colorKey: string | null) => Promise<SnapshotPatch>;
  movePlaylist: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  // Position-based row ops (decision D5): operate on any row of a playlist's
  // flat, ordered row list — an item entry or a separator alike — identified
  // by the row's own id, never by a group. `removePlaylistRow` is the
  // explicit successor to today's `movePlaylistEntryToGroup(entryId, null)`
  // ("remove"); it detaches the row from its playlist without touching the
  // underlying Presentation/Lyric/Talk it may reference.
  movePlaylistRow: (rowId: Id, newOrder: number) => Promise<SnapshotPatch>;
  removePlaylistRow: (rowId: Id) => Promise<SnapshotPatch>;
  // Attach an EXISTING item to a playlist as a new row (successor to
  // `addDeckItemToGroup`; `createItem`'s playlistId/position only covers
  // placement at creation time). Appends when `position` is omitted.
  addItemToPlaylist: (playlistId: Id, itemRef: ItemRef, position?: number) => Promise<SnapshotPatch>;
  createPresentation: (title: string) => Promise<SnapshotPatch>;
  createLyric: (title: string) => Promise<SnapshotPatch>;
  createTalk: (title: string) => Promise<SnapshotPatch>;
  createSlide: (input: SlideCreateInput) => Promise<SnapshotPatch>;
  duplicateSlide: (slideId: Id) => Promise<SnapshotPatch>;
  deleteSlide: (slideId: Id) => Promise<SnapshotPatch>;
  updateSlideNotes: (input: SlideNotesUpdateInput) => Promise<SnapshotPatch>;
  updateSlideBackground: (input: SlideBackgroundUpdateInput) => Promise<SnapshotPatch>;
  createTalkScriptBlock: (input: TalkScriptBlockCreateInput) => Promise<SnapshotPatch>;
  updateTalkScriptBlock: (input: TalkScriptBlockUpdateInput) => Promise<SnapshotPatch>;
  deleteTalkScriptBlock: (id: Id) => Promise<SnapshotPatch>;
  setTalkScriptBlockOrder: (input: TalkScriptBlockOrderUpdateInput) => Promise<SnapshotPatch>;
  setSlideOrder: (input: SlideOrderUpdateInput) => Promise<SnapshotPatch>;
  setPlaylistOrder: (playlistId: Id, newOrder: number) => Promise<SnapshotPatch>;
  // Absolute-position list reorders, one per list panel that can be dragged.
  // All four take the drop index in the visible list and clamp out-of-range
  // targets, matching setPlaylistOrder/movePlaylistRow's remove-then-insert
  // semantics. `setOverlayOrder`/`setMacroOrder` became possible with the v28
  // `list-order-index` migration; stages and themes have had an order column
  // since v8/v4 but nothing ever wrote it after creation.
  setOverlayOrder: (overlayId: Id, newOrder: number) => Promise<SnapshotPatch>;
  setStageOrder: (stageId: Id, newOrder: number) => Promise<SnapshotPatch>;
  setThemeOrder: (themeId: Id, themeType: ThemeOwnerType, newOrder: number) => Promise<SnapshotPatch>;
  setMacroOrder: (macroId: Id, newOrder: number) => Promise<SnapshotPatch>;
  createElement: (input: ElementCreateInput) => Promise<SnapshotPatch>;
  createElementsBatch: (inputs: ElementCreateInput[]) => Promise<SnapshotPatch>;
  updateElement: (input: ElementUpdateInput) => Promise<SnapshotPatch>;
  updateElementsBatch: (inputs: ElementUpdateInput[]) => Promise<SnapshotPatch>;
  deleteElement: (id: Id) => Promise<SnapshotPatch>;
  deleteElementsBatch: (ids: Id[]) => Promise<SnapshotPatch>;
  createMediaAsset: (asset: MediaAssetCreateInput) => Promise<SnapshotPatch>;
  deleteMediaAsset: (id: Id) => Promise<SnapshotPatch>;
  updateMediaAssetSrc: (id: Id, src: string) => Promise<SnapshotPatch>;
  ensureMediaDerivative: (assetId: Id) => Promise<EnsureMediaDerivativeResult>;
  uploadMediaDerivativeFallback: (
    assetId: Id,
    generationToken: string,
    sourceFingerprint: string,
    bytes: Uint8Array,
  ) => Promise<EnsureMediaDerivativeResult>;
  createOverlay: (overlay: OverlayCreateInput) => Promise<SnapshotPatch>;
  updateOverlay: (input: OverlayUpdateInput) => Promise<SnapshotPatch>;
  setOverlayEnabled: (overlayId: Id, enabled: boolean) => Promise<SnapshotPatch>;
  deleteOverlay: (overlayId: Id) => Promise<SnapshotPatch>;
  createTheme: (input: ThemeCreateInput) => Promise<SnapshotPatch>;
  updateTheme: (input: ThemeUpdateInput) => Promise<SnapshotPatch>;
  // `themeType` selects which of the four per-owner theme tables `themeId`
  // lives in (decision D2) — theme ids are independent per table, so the
  // table can never be inferred from the id alone.
  deleteTheme: (themeId: Id, themeType: ThemeOwnerType) => Promise<SnapshotPatch>;
  applyThemeToItem: (themeId: Id, itemRef: ItemRef) => Promise<SnapshotPatch>;
  detachThemeFromItem: (itemRef: ItemRef) => Promise<SnapshotPatch>;
  // `itemType` scopes the sync to one item table (presentation/lyric/talk);
  // overlay themes have no linked-item concept to sync.
  syncThemeToLinkedItems: (themeId: Id, itemType: ItemType) => Promise<SnapshotPatch>;
  applyThemeToOverlay: (themeId: Id, overlayId: Id) => Promise<SnapshotPatch>;
  createItem: (input: ItemCreateInput) => Promise<ItemCreateResult>;
  duplicateItem: (input: ItemDuplicateInput) => Promise<ItemDuplicateResult>;
  createStage: (input: StageCreateInput) => Promise<SnapshotPatch>;
  updateStage: (input: StageUpdateInput) => Promise<SnapshotPatch>;
  deleteStage: (stageId: Id) => Promise<SnapshotPatch>;
  duplicateStage: (stageId: Id) => Promise<SnapshotPatch>;
  renamePlaylist: (id: Id, name: string) => Promise<SnapshotPatch>;
  renamePresentation: (id: Id, title: string) => Promise<SnapshotPatch>;
  renameLyric: (id: Id, title: string) => Promise<SnapshotPatch>;
  renameTalk: (id: Id, title: string) => Promise<SnapshotPatch>;
  // Per-type reorder (decision D1): each of the three item tables keeps its
  // own `order_index` sequence — there is no cross-type "deck order" left to
  // reorder within, so the old `moveDeckItem` splits one-for-one per table.
  movePresentation: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  moveLyric: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  moveTalk: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  deletePlaylist: (id: Id) => Promise<SnapshotPatch>;
  deletePresentation: (id: Id) => Promise<SnapshotPatch>;
  deleteLyric: (id: Id) => Promise<SnapshotPatch>;
  deleteTalk: (id: Id) => Promise<SnapshotPatch>;
  setNdiOutputEnabled: (name: NdiOutputName, enabled: boolean) => Promise<NdiOutputState>;
  getNdiOutputState: () => Promise<NdiOutputState>;
  getNdiOutputConfigs: () => Promise<NdiOutputConfigMap>;
  updateNdiOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) => Promise<NdiOutputConfigMap>;
  getNdiDiagnostics: () => Promise<NdiDiagnostics>;
  getAudioCoverArt: (src: string) => Promise<string | null>;
  // Observability
  obsListLogSessions: () => Promise<LogSessionSummary[]>;
  obsReadLogSession: (filePath: string, offset: number, limit: number) => Promise<LogReadResult>;
  obsGetCurrentLogPath: () => Promise<string | null>;
  obsOpenLogFolder: () => Promise<void>;
  obsGetSystemMetrics: () => Promise<SystemMetricsSnapshot>;
  /**
   * Restores a validated project backup (#146). The pre-recovery database is
   * never deleted: the active database is retained as a timestamped
   * `*.prerecovery-*.sqlite` sibling and the result carries its path. This is
   * deliberately NOT routine Undo — it is a distinct channel that returns a
   * full snapshot instead of a `SnapshotPatch`.
   */
  restoreProjectBackup: (backup: ProjectBackup) => Promise<ProjectRestoreResult>;
}

// The canonical operation map: derived mechanically from
// `RpcMethodSignatures` (not hand-transcribed) so it can never drift from the
// signatures above. `input` is the positional argument tuple, `output` is the
// resolved (unwrapped) promise value, and `error` is the serialized error
// category every main-process handler currently produces (see
// `app/main/ipc.ts`'s `safeHandle`, which always rejects with a plain
// `Error(message)`). A future operation needing a distinguished error union
// can override `error` without touching any other entry's shape.
export type RpcOperations = {
  [K in keyof RpcMethodSignatures]: {
    input: Parameters<RpcMethodSignatures[K]>;
    output: Awaited<ReturnType<RpcMethodSignatures[K]>>;
    error: RpcError;
  };
};

type RpcSurface = {
  [K in keyof RpcOperations]: (...args: RpcOperations[K]['input']) => Promise<RpcOperations[K]['output']>;
};

// Event/subscription contracts (main -> renderer, one-way). Kept as maps
// separate from `RpcOperations`: these are not request/response operations
// and must never be folded into the RPC surface above.
export interface NdiEventPayloads {
  outputStateChanged: NdiOutputState;
  diagnosticsChanged: NdiDiagnostics;
  frameReleased: NdiFrameRelease;
}

export interface AppMenuEventPayloads {
  command: AppMenuCommandId;
}

export interface MediaDerivativeEventPayloads {
  progress: MediaDerivativeProgress;
}

export interface PersistenceProgress {
  operation: string;
  phase: string;
  completed?: number;
  total?: number;
}

export interface PersistenceEventPayloads {
  progress: PersistenceProgress;
}

type NdiEventSurface = {
  onNdiOutputStateChanged: (callback: (state: NdiEventPayloads['outputStateChanged']) => void) => () => void;
  onNdiDiagnosticsChanged: (callback: (diagnostics: NdiEventPayloads['diagnosticsChanged']) => void) => () => void;
  onNdiFrameReleased: (callback: (release: NdiEventPayloads['frameReleased']) => void) => () => void;
};

type AppMenuEventSurface = {
  onAppMenuCommand: (callback: (commandId: AppMenuEventPayloads['command']) => void) => () => void;
};

type MediaDerivativeEventSurface = {
  onMediaDerivativeProgress: (callback: (progress: MediaDerivativeEventPayloads['progress']) => void) => () => void;
};

type PersistenceEventSurface = {
  onPersistenceProgress: (callback: (progress: PersistenceEventPayloads['progress']) => void) => () => void;
};

// High-frequency frame/message channel contracts (renderer -> main, one-way,
// fire-and-forget via `ipcRenderer.send`/`ipcMain.on` rather than
// invoke/handle). Kept separate from both `RpcOperations` and the event
// payloads above: these intentionally skip the request/response round trip
// for latency, and their direction is the opposite of the event maps.
export interface NdiFrameChannels {
  sendNdiFrame: { name: NdiOutputName; buffer: ArrayBuffer; width: number; height: number; telemetry?: NdiFrameTelemetry };
  sendNdiAudio: { name: NdiOutputName; buffer: ArrayBuffer; sampleRate: number; channels: number; samplesPerChannel: number };
}

type NdiFrameSurface = {
  sendNdiFrame: (
    name: NdiOutputName,
    buffer: ArrayBuffer,
    width: number,
    height: number,
    telemetry?: NdiFrameTelemetry,
  ) => void;
  sendNdiAudio: (
    name: NdiOutputName,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ) => void;
};

// Bridge-local utilities that never cross a channel at all (no main round
// trip): `platform` is a value snapshotted at preload load, and
// `getPathForFile` is a synchronous `webUtils` call. Neither belongs in
// `RpcOperations` or either channel map above.
interface MainUtilApi {
  platform: NodeJS.Platform;
  getPathForFile: (file: File) => string;
}

// MainApi is the canonical shape of the whole `castApi` bridge exposed by
// preload (issue #151): the RPC surface derived from `RpcOperations`,
// intersected with the event subscriptions, frame-channel senders, and the
// two non-channel utilities above. `app/main/preload.ts` asserts its
// implementation object `satisfies MainApi`, so an extra, missing, or
// mistyped member fails compilation there. `app/renderer/env.d.ts` types
// `window.castApi` as `MainApi`, so existing renderer call sites stay typed
// against exactly this shape.
export type MainApi = RpcSurface & NdiEventSurface & AppMenuEventSurface & MediaDerivativeEventSurface & PersistenceEventSurface & NdiFrameSurface & MainUtilApi;

// #219 item-model refactor decision D8: replaces `DeckItemCreateWithThemeInput`
// — no `collectionId`/`groupId` (collections and library-grouped playlists
// are gone), and playlist placement happens at creation time via the
// optional `playlistId`/`position` pair rather than a separate group-add
// call.
export interface ItemCreateInput {
  type: ItemType;
  title?: string;
  themeId?: Id | null;
  playlistId?: Id | null;
  position?: number;
}

// Atomic item creation returns the created item's id explicitly so the
// renderer never has to infer it by diffing entity arrays before/after the
// mutation (see docs/adr for the atomic-deck-creation ADR).
export interface ItemCreateResult {
  itemId: Id;
  patch: SnapshotPatch;
}

// Talks are deliberately excluded (decision D1: there is simply no
// `duplicateTalk`, matching today's per-type absence rather than a thrown
// error) — `type` only ever admits the two duplicable item types.
export interface ItemDuplicateInput {
  type: 'presentation' | 'lyric';
  id: Id;
}

// Mirrors ItemCreateResult: whole-item duplication (#103) returns the
// duplicate's id explicitly so the renderer never has to infer it by
// diffing entity arrays before/after the mutation.
export interface ItemDuplicateResult {
  itemId: Id;
  patch: SnapshotPatch;
}

// Result of restoring a project backup (#146): the promoted snapshot plus the
// path of the retained pre-recovery database file (never deleted).
export interface ProjectRestoreResult {
  snapshot: AppSnapshot;
  retainedDatabasePath: string;
}

export type MediaDerivativeStatus = 'ready' | 'needs-upload' | 'missing' | 'failed';

export interface MediaDerivativeProgress {
  active: number;
  queued: number;
  completed: number;
  total: number;
  failed: number;
  statusText: string | null;
  patch?: SnapshotPatch;
}

export interface EnsureMediaDerivativeResult {
  assetId: Id;
  status: MediaDerivativeStatus;
  patch?: SnapshotPatch;
  generationToken?: string;
  sourceFingerprint?: string;
}

export interface InlineWindowMenuItem {
  id: string;
  label: string;
}

export interface InlineWindowMenuBounds {
  x: number;
  y: number;
}

export const IPC = {
  readClipboardText: 'cast:readClipboardText',
  writeClipboardText: 'cast:writeClipboardText',
  getInlineWindowMenuItems: 'cast:getInlineWindowMenuItems',
  popupInlineWindowMenu: 'cast:popupInlineWindowMenu',
  updateAppMenuState: 'cast:updateAppMenuState',
  checkForAppUpdates: 'cast:checkForAppUpdates',
  getSnapshot: 'cast:getSnapshot',
  applySnapshotPatch: 'cast:applySnapshotPatch',
  restoreFromSnapshot: 'cast:restoreFromSnapshot',
  chooseBundleExportPath: 'cast:chooseBundleExportPath',
  chooseBundleImportPath: 'cast:chooseBundleImportPath',
  chooseImportReplacementMediaPath: 'cast:chooseImportReplacementMediaPath',
  exportBundle: 'cast:exportBundle',
  inspectImportBundle: 'cast:inspectImportBundle',
  finalizeImportBundle: 'cast:finalizeImportBundle',
  listCues: 'cast:listCues',
  createCue: 'cast:createCue',
  updateCue: 'cast:updateCue',
  deleteCue: 'cast:deleteCue',
  listMacros: 'cast:listMacros',
  createMacro: 'cast:createMacro',
  updateMacro: 'cast:updateMacro',
  deleteMacro: 'cast:deleteMacro',
  listTriggerBindings: 'cast:listTriggerBindings',
  createTriggerBinding: 'cast:createTriggerBinding',
  deleteTriggerBinding: 'cast:deleteTriggerBinding',
  createPlaylist: 'cast:createPlaylist',
  createSeparator: 'cast:createSeparator',
  renameSeparator: 'cast:renameSeparator',
  setSeparatorColor: 'cast:setSeparatorColor',
  movePlaylist: 'cast:movePlaylist',
  movePlaylistRow: 'cast:movePlaylistRow',
  removePlaylistRow: 'cast:removePlaylistRow',
  addItemToPlaylist: 'cast:addItemToPlaylist',
  createPresentation: 'cast:createPresentation',
  createLyric: 'cast:createLyric',
  createTalk: 'cast:createTalk',
  createSlide: 'cast:createSlide',
  duplicateSlide: 'cast:duplicateSlide',
  deleteSlide: 'cast:deleteSlide',
  updateSlideNotes: 'cast:updateSlideNotes',
  updateSlideBackground: 'cast:updateSlideBackground',
  createTalkScriptBlock: 'cast:createTalkScriptBlock',
  updateTalkScriptBlock: 'cast:updateTalkScriptBlock',
  deleteTalkScriptBlock: 'cast:deleteTalkScriptBlock',
  setTalkScriptBlockOrder: 'cast:setTalkScriptBlockOrder',
  setSlideOrder: 'cast:setSlideOrder',
  setPlaylistOrder: 'cast:setPlaylistOrder',
  setOverlayOrder: 'cast:setOverlayOrder',
  setStageOrder: 'cast:setStageOrder',
  setThemeOrder: 'cast:setThemeOrder',
  setMacroOrder: 'cast:setMacroOrder',
  createElement: 'cast:createElement',
  createElementsBatch: 'cast:createElementsBatch',
  updateElement: 'cast:updateElement',
  updateElementsBatch: 'cast:updateElementsBatch',
  deleteElement: 'cast:deleteElement',
  deleteElementsBatch: 'cast:deleteElementsBatch',
  createMediaAsset: 'cast:createMediaAsset',
  deleteMediaAsset: 'cast:deleteMediaAsset',
  updateMediaAssetSrc: 'cast:updateMediaAssetSrc',
  ensureMediaDerivative: 'cast:ensureMediaDerivative',
  uploadMediaDerivativeFallback: 'cast:uploadMediaDerivativeFallback',
  createOverlay: 'cast:createOverlay',
  updateOverlay: 'cast:updateOverlay',
  setOverlayEnabled: 'cast:setOverlayEnabled',
  deleteOverlay: 'cast:deleteOverlay',
  createTheme: 'cast:createTheme',
  updateTheme: 'cast:updateTheme',
  deleteTheme: 'cast:deleteTheme',
  applyThemeToItem: 'cast:applyThemeToItem',
  detachThemeFromItem: 'cast:detachThemeFromItem',
  syncThemeToLinkedItems: 'cast:syncThemeToLinkedItems',
  applyThemeToOverlay: 'cast:applyThemeToOverlay',
  createItem: 'cast:createItem',
  duplicateItem: 'cast:duplicateItem',
  createStage: 'cast:createStage',
  updateStage: 'cast:updateStage',
  deleteStage: 'cast:deleteStage',
  duplicateStage: 'cast:duplicateStage',
  renamePlaylist: 'cast:renamePlaylist',
  renamePresentation: 'cast:renamePresentation',
  renameLyric: 'cast:renameLyric',
  renameTalk: 'cast:renameTalk',
  movePresentation: 'cast:movePresentation',
  moveLyric: 'cast:moveLyric',
  moveTalk: 'cast:moveTalk',
  deletePlaylist: 'cast:deletePlaylist',
  deletePresentation: 'cast:deletePresentation',
  deleteLyric: 'cast:deleteLyric',
  deleteTalk: 'cast:deleteTalk',
  getAudioCoverArt: 'cast:getAudioCoverArt',
  setNdiOutputEnabled: 'ndi:setOutputEnabled',
  getNdiOutputState: 'ndi:getOutputState',
  getNdiOutputConfigs: 'ndi:getOutputConfigs',
  updateNdiOutputConfig: 'ndi:updateOutputConfig',
  getNdiDiagnostics: 'ndi:getDiagnostics',
  sendNdiFrame: 'ndi:sendFrame',
  sendNdiAudio: 'ndi:sendAudio',
  restoreProjectBackup: 'cast:restoreProjectBackup',
  obsListLogSessions: 'obs:listLogSessions',
  obsReadLogSession: 'obs:readLogSession',
  obsGetCurrentLogPath: 'obs:getCurrentLogPath',
  obsOpenLogFolder: 'obs:openLogFolder',
  obsGetSystemMetrics: 'obs:getSystemMetrics',
} as const;

export const NDI_EVENTS = {
  outputStateChanged: 'ndi:outputStateChanged',
  diagnosticsChanged: 'ndi:diagnosticsChanged',
  frameReleased: 'ndi:frameReleased',
} as const;

export const APP_MENU_EVENTS = {
  command: 'app-menu:command',
} as const;

export const MEDIA_DERIVATIVE_EVENTS = {
  progress: 'media-derivatives:progress',
} as const;

export const PERSISTENCE_EVENTS = {
  progress: 'persistence:progress',
} as const;

export const PERSISTENCE_CHANNELS = {
  subscribe: 'persistence:subscribe',
} as const;

// ---------------------------------------------------------------------------
// Channel classification completeness (issue #151 acceptance criterion:
// "every current channel is classified exactly once").
//
// `IPC` above holds every request/response AND frame channel string. The two
// frame channels are the only entries that are not request/response
// operations; every other `IPC` key must have exactly one matching
// `RpcOperations` entry, checked at compile time below. `app/core/ipc-
// contract.test.ts` extends this with a runtime check that also folds in
// `NDI_EVENTS`/`APP_MENU_EVENTS`, so the classification covers every channel
// this module exports, not just the RPC/frame split.
// ---------------------------------------------------------------------------

export const NDI_FRAME_CHANNEL_NAMES = ['sendNdiFrame', 'sendNdiAudio'] as const satisfies readonly (keyof typeof IPC)[];

type FrameChannelName = (typeof NDI_FRAME_CHANNEL_NAMES)[number];
type RpcChannelName = Exclude<keyof typeof IPC, FrameChannelName>;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type AssertTrue<T extends true> = T;

// Fails to compile the moment an `IPC` channel (other than a frame channel)
// is added, removed, or renamed without a matching change to
// `RpcOperations`, or vice versa.
export type RpcOperationsMatchIpcChannels = AssertTrue<Equal<keyof RpcOperations, RpcChannelName>>;
