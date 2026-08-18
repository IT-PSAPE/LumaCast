import type { Id } from '@lumacast/kernel';
import type { Cue, Macro, TriggerBinding } from '@lumacast/automation';
import type {
  CollectionAssignmentInput,
  CollectionCreateInput,
  CollectionDeleteInput,
  CollectionRenameInput,
  CollectionReorderInput,
  CueCreateInput,
  CueUpdateInput,
  DeckBundleExportOptions,
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
import type { AppSnapshot, DeckBundleBrokenReferenceDecision, DeckBundleInspection } from './rpc-results';
import type {
  LogReadResult,
  LogSessionSummary,
  NdiDiagnostics,
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
interface RpcMethodSignatures {
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  getInlineWindowMenuItems: () => Promise<InlineWindowMenuItem[]>;
  popupInlineWindowMenu: (menuId: string, bounds: InlineWindowMenuBounds) => Promise<void>;
  updateAppMenuState: (state: AppMenuState) => Promise<void>;
  checkForAppUpdates: (manual?: boolean) => Promise<void>;
  getSnapshot: () => Promise<AppSnapshot>;
  restoreFromSnapshot: (snapshot: AppSnapshot) => Promise<AppSnapshot>;
  chooseDeckBundleExportPath: (suggestedName: string) => Promise<string | null>;
  chooseDeckBundleImportPath: () => Promise<string | null>;
  chooseImportReplacementMediaPath: () => Promise<string | null>;
  exportDeckBundle: (itemIds: Id[], filePath: string, options?: DeckBundleExportOptions) => Promise<{ filePath: string; itemCount: number }>;
  inspectImportBundle: (filePath: string) => Promise<DeckBundleInspection>;
  finalizeImportBundle: (filePath: string, decisions: DeckBundleBrokenReferenceDecision[]) => Promise<AppSnapshot>;
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
  createLibrary: (name: string) => Promise<SnapshotPatch>;
  createPlaylist: (libraryId: Id, name: string) => Promise<SnapshotPatch>;
  createPlaylistGroup: (playlistId: Id, name: string) => Promise<SnapshotPatch>;
  renamePlaylistGroup: (id: Id, name: string) => Promise<SnapshotPatch>;
  setPlaylistGroupColor: (id: Id, colorKey: string | null) => Promise<SnapshotPatch>;
  movePlaylist: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  addDeckItemToGroup: (playlistId: Id, groupId: Id, itemId: Id) => Promise<SnapshotPatch>;
  moveDeckItemToGroup: (playlistId: Id, itemId: Id, groupId: Id | null) => Promise<SnapshotPatch>;
  movePlaylistEntryToGroup: (entryId: Id, groupId: Id | null) => Promise<SnapshotPatch>;
  moveDeckItem: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
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
  movePlaylistEntry: (entryId: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  setSlideOrder: (input: SlideOrderUpdateInput) => Promise<SnapshotPatch>;
  setLibraryOrder: (libraryId: Id, newOrder: number) => Promise<SnapshotPatch>;
  setPlaylistOrder: (playlistId: Id, newOrder: number) => Promise<SnapshotPatch>;
  setPlaylistGroupOrder: (groupId: Id, newOrder: number) => Promise<SnapshotPatch>;
  movePlaylistEntryTo: (entryId: Id, groupId: Id, newOrder: number) => Promise<SnapshotPatch>;
  createElement: (input: ElementCreateInput) => Promise<SnapshotPatch>;
  createElementsBatch: (inputs: ElementCreateInput[]) => Promise<SnapshotPatch>;
  updateElement: (input: ElementUpdateInput) => Promise<SnapshotPatch>;
  updateElementsBatch: (inputs: ElementUpdateInput[]) => Promise<SnapshotPatch>;
  deleteElement: (id: Id) => Promise<SnapshotPatch>;
  deleteElementsBatch: (ids: Id[]) => Promise<SnapshotPatch>;
  createMediaAsset: (asset: MediaAssetCreateInput) => Promise<SnapshotPatch>;
  deleteMediaAsset: (id: Id) => Promise<SnapshotPatch>;
  updateMediaAssetSrc: (id: Id, src: string) => Promise<SnapshotPatch>;
  createOverlay: (overlay: OverlayCreateInput) => Promise<SnapshotPatch>;
  updateOverlay: (input: OverlayUpdateInput) => Promise<SnapshotPatch>;
  setOverlayEnabled: (overlayId: Id, enabled: boolean) => Promise<SnapshotPatch>;
  deleteOverlay: (overlayId: Id) => Promise<SnapshotPatch>;
  createTheme: (input: ThemeCreateInput) => Promise<SnapshotPatch>;
  updateTheme: (input: ThemeUpdateInput) => Promise<SnapshotPatch>;
  deleteTheme: (themeId: Id) => Promise<SnapshotPatch>;
  applyThemeToDeckItem: (themeId: Id, itemId: Id) => Promise<SnapshotPatch>;
  detachThemeFromDeckItem: (itemId: Id) => Promise<SnapshotPatch>;
  syncThemeToLinkedDeckItems: (themeId: Id) => Promise<SnapshotPatch>;
  applyThemeToOverlay: (themeId: Id, overlayId: Id) => Promise<SnapshotPatch>;
  createDeckItemWithTheme: (input: DeckItemCreateWithThemeInput) => Promise<DeckItemCreateResult>;
  duplicateDeckItem: (itemId: Id) => Promise<DeckItemDuplicateResult>;
  createStage: (input: StageCreateInput) => Promise<SnapshotPatch>;
  updateStage: (input: StageUpdateInput) => Promise<SnapshotPatch>;
  deleteStage: (stageId: Id) => Promise<SnapshotPatch>;
  duplicateStage: (stageId: Id) => Promise<SnapshotPatch>;
  renameLibrary: (id: Id, name: string) => Promise<SnapshotPatch>;
  renamePlaylist: (id: Id, name: string) => Promise<SnapshotPatch>;
  renamePresentation: (id: Id, title: string) => Promise<SnapshotPatch>;
  renameLyric: (id: Id, title: string) => Promise<SnapshotPatch>;
  renameTalk: (id: Id, title: string) => Promise<SnapshotPatch>;
  deleteLibrary: (id: Id) => Promise<SnapshotPatch>;
  deletePlaylist: (id: Id) => Promise<SnapshotPatch>;
  deletePlaylistGroup: (id: Id) => Promise<SnapshotPatch>;
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
  createCollection: (input: CollectionCreateInput) => Promise<SnapshotPatch>;
  renameCollection: (input: CollectionRenameInput) => Promise<SnapshotPatch>;
  deleteCollection: (input: CollectionDeleteInput) => Promise<SnapshotPatch>;
  reorderCollections: (input: CollectionReorderInput) => Promise<SnapshotPatch>;
  setItemCollection: (input: CollectionAssignmentInput) => Promise<SnapshotPatch>;
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
  frameAck: NdiOutputName;
}

export interface AppMenuEventPayloads {
  command: AppMenuCommandId;
}

type NdiEventSurface = {
  onNdiOutputStateChanged: (callback: (state: NdiEventPayloads['outputStateChanged']) => void) => () => void;
  onNdiDiagnosticsChanged: (callback: (diagnostics: NdiEventPayloads['diagnosticsChanged']) => void) => () => void;
  onNdiFrameAck: (callback: (name: NdiEventPayloads['frameAck']) => void) => () => void;
};

type AppMenuEventSurface = {
  onAppMenuCommand: (callback: (commandId: AppMenuEventPayloads['command']) => void) => () => void;
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
export type MainApi = RpcSurface & NdiEventSurface & AppMenuEventSurface & NdiFrameSurface & MainUtilApi;

export interface DeckItemCreateWithThemeInput {
  type: 'presentation' | 'lyric' | 'talk';
  title: string;
  collectionId?: Id | null;
  themeId?: Id | null;
  groupId?: Id | null;
}

// Atomic deck-item creation returns the created owner's id explicitly so the
// renderer never has to infer it by diffing entity arrays before/after the
// mutation (see docs/adr for the atomic-deck-creation ADR).
export interface DeckItemCreateResult {
  itemId: Id;
  patch: SnapshotPatch;
}

// Mirrors DeckItemCreateResult: whole-deck duplication (#103) returns the
// duplicate's owner id explicitly so the renderer never has to infer it by
// diffing entity arrays before/after the mutation.
export interface DeckItemDuplicateResult {
  itemId: Id;
  patch: SnapshotPatch;
}

// Result of restoring a project backup (#146): the promoted snapshot plus the
// path of the retained pre-recovery database file (never deleted).
export interface ProjectRestoreResult {
  snapshot: AppSnapshot;
  retainedDatabasePath: string;
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
  restoreFromSnapshot: 'cast:restoreFromSnapshot',
  chooseDeckBundleExportPath: 'cast:chooseDeckBundleExportPath',
  chooseDeckBundleImportPath: 'cast:chooseDeckBundleImportPath',
  chooseImportReplacementMediaPath: 'cast:chooseImportReplacementMediaPath',
  exportDeckBundle: 'cast:exportDeckBundle',
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
  createLibrary: 'cast:createLibrary',
  createPlaylist: 'cast:createPlaylist',
  createPlaylistGroup: 'cast:createPlaylistGroup',
  renamePlaylistGroup: 'cast:renamePlaylistGroup',
  setPlaylistGroupColor: 'cast:setPlaylistGroupColor',
  movePlaylist: 'cast:movePlaylist',
  addDeckItemToGroup: 'cast:addDeckItemToGroup',
  moveDeckItemToGroup: 'cast:moveDeckItemToGroup',
  movePlaylistEntryToGroup: 'cast:movePlaylistEntryToGroup',
  movePlaylistEntry: 'cast:movePlaylistEntry',
  moveDeckItem: 'cast:moveDeckItem',
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
  setLibraryOrder: 'cast:setLibraryOrder',
  setPlaylistOrder: 'cast:setPlaylistOrder',
  setPlaylistGroupOrder: 'cast:setPlaylistGroupOrder',
  movePlaylistEntryTo: 'cast:movePlaylistEntryTo',
  createElement: 'cast:createElement',
  createElementsBatch: 'cast:createElementsBatch',
  updateElement: 'cast:updateElement',
  updateElementsBatch: 'cast:updateElementsBatch',
  deleteElement: 'cast:deleteElement',
  deleteElementsBatch: 'cast:deleteElementsBatch',
  createMediaAsset: 'cast:createMediaAsset',
  deleteMediaAsset: 'cast:deleteMediaAsset',
  updateMediaAssetSrc: 'cast:updateMediaAssetSrc',
  createOverlay: 'cast:createOverlay',
  updateOverlay: 'cast:updateOverlay',
  setOverlayEnabled: 'cast:setOverlayEnabled',
  deleteOverlay: 'cast:deleteOverlay',
  createTheme: 'cast:createTheme',
  updateTheme: 'cast:updateTheme',
  deleteTheme: 'cast:deleteTheme',
  applyThemeToDeckItem: 'cast:applyThemeToDeckItem',
  detachThemeFromDeckItem: 'cast:detachThemeFromDeckItem',
  syncThemeToLinkedDeckItems: 'cast:syncThemeToLinkedDeckItems',
  applyThemeToOverlay: 'cast:applyThemeToOverlay',
  createDeckItemWithTheme: 'cast:createDeckItemWithTheme',
  duplicateDeckItem: 'cast:duplicateDeckItem',
  createStage: 'cast:createStage',
  updateStage: 'cast:updateStage',
  deleteStage: 'cast:deleteStage',
  duplicateStage: 'cast:duplicateStage',
  renameLibrary: 'cast:renameLibrary',
  renamePlaylist: 'cast:renamePlaylist',
  renamePresentation: 'cast:renamePresentation',
  renameLyric: 'cast:renameLyric',
  renameTalk: 'cast:renameTalk',
  deleteLibrary: 'cast:deleteLibrary',
  deletePlaylist: 'cast:deletePlaylist',
  deletePlaylistGroup: 'cast:deletePlaylistGroup',
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
  createCollection: 'cast:createCollection',
  renameCollection: 'cast:renameCollection',
  deleteCollection: 'cast:deleteCollection',
  reorderCollections: 'cast:reorderCollections',
  setItemCollection: 'cast:setItemCollection',
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
  frameAck: 'ndi:frameAck',
} as const;

export const APP_MENU_EVENTS = {
  command: 'app-menu:command',
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
