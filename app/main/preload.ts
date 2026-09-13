import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { AGENT_ACTION_EVENTS, AGENT_EVENTS, APP_MENU_EVENTS, IPC, MEDIA_DERIVATIVE_EVENTS, MEDIA_LIBRARY_EVENTS, NDI_AUDIO_TRANSPORT_PORT_CHANNEL, NDI_EVENTS, NDI_FRAME_TRANSPORT_PORT_CHANNEL, PERSISTENCE_CHANNELS, PERSISTENCE_EVENTS, isNdiAudioTransportPortAnnouncement, isNdiFrameTransportPortAnnouncement, type AgentActionCancelledEvent, type AgentActionRequest, type AgentActionResponse, type AgentBatchEvent, type ItemCreateInput, type ItemCreateResult, type ItemDuplicateInput, type ItemDuplicateResult, type MainApi, type ProjectRestoreResult } from '@lumacast/protocol';
import type { SnapshotPatch } from '@lumacast/protocol';
import type {
  AgentConfig,
  AgentConfigUpdate,
  AgentCredentialStatus,
  AgentModelInfo,
  AgentThread,
  AgentThreadCreateInput,
  AgentThreadSummary,
} from '@lumacast/protocol';
import type {
  AgentDocumentText,
  AgentExtractDocumentInput,
  AgentFilesystemRootInput,
  AgentImportMediaInput,
  AgentListModelsInput,
  AgentMcpClientCreateInput,
  AgentMcpClientCreated,
  AgentMcpClientIdInput,
  AgentMcpClientPermissionsInput,
  AgentMcpEnabledInput,
  AgentMcpStatus,
  AgentModelValidation,
  AgentProviderInput,
  AgentRenameThreadInput,
  AgentReplaceMediaSourceInput,
  AgentSendMessageInput,
  AgentSetCredentialInput,
  AgentSetThreadModelInput,
  AgentThreadEvent,
  AgentThreadIdInput,
  AgentValidateModelInput,
} from '@lumacast/protocol';
import type { Id } from '@lumacast/kernel';
import type { ItemRef, ItemType, SlideTag, ThemeOwnerType } from '@lumacast/composition';
import type { Cue, Macro, PlaybackSchedule, TriggerBinding } from '@lumacast/automation';
import type {
  CueCreateInput,
  CueUpdateInput,
  BundleExportOptions,
  ElementCreateInput,
  ElementUpdateInput,
  ItemListInput,
  ItemGetInput,
  MacroCreateInput,
  MacroUpdateInput,
  MediaAssetCreateInput,
  MediaAssetListInput,
  OverlayCreateInput,
  OverlayUpdateInput,
  PlaylistGetInput,
  SearchContentInput,
  SlideBackgroundUpdateInput,
  SlideCreateInput,
  SlideGetInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput,
  SlideTagAssignInput,
  SlideTagCreateInput,
  SlideTagUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  ThemeCreateInput,
  ThemeListInput,
  ThemeUpdateInput,
  TriggerBindingCreateInput,
} from '@lumacast/protocol';
import type { AppSnapshot, BundleBrokenReferenceDecision, BundleInspection } from '@lumacast/protocol';
import type {
  ItemDetail,
  ItemSummary,
  MediaAssetSummary,
  OverlaySummary,
  PlaylistDetail,
  PlaylistSummary,
  ProjectOverview,
  SearchResult,
  SlideDetail,
  StageSummary,
  ThemeSummary,
} from '@lumacast/protocol';
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
} from '@lumacast/protocol';
import type { ProjectBackup } from '@lumacast/protocol';

ipcRenderer.on(NDI_FRAME_TRANSPORT_PORT_CHANNEL, (event, announcement: unknown) => {
  const [port] = event.ports;
  if (!port || event.ports.length !== 1 || !isNdiFrameTransportPortAnnouncement(announcement)) {
    for (const candidate of event.ports) candidate.close();
    return;
  }
  // MessagePort is intentionally handed to the main world outside
  // contextBridge: contextBridge would clone calls crossing isolated worlds.
  // The renderer validates source, origin and the typed announcement before
  // transferring this port into its readback worker.
  window.postMessage(announcement, '*', [port]);
});

ipcRenderer.on(NDI_AUDIO_TRANSPORT_PORT_CHANNEL, (event, announcement: unknown) => {
  const [port] = event.ports;
  if (!port || event.ports.length !== 1 || !isNdiAudioTransportPortAnnouncement(announcement)) {
    for (const candidate of event.ports) candidate.close();
    return;
  }
  window.postMessage(announcement, '*', [port]);
});

const api = {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readClipboardText: () => ipcRenderer.invoke(IPC.readClipboardText) as Promise<string>,
  writeClipboardText: (text: string) => ipcRenderer.invoke(IPC.writeClipboardText, text) as Promise<void>,
  getInlineWindowMenuItems: () => ipcRenderer.invoke(IPC.getInlineWindowMenuItems) as Promise<import('@lumacast/protocol').InlineWindowMenuItem[]>,
  popupInlineWindowMenu: (menuId: string, bounds: import('@lumacast/protocol').InlineWindowMenuBounds) =>
    ipcRenderer.invoke(IPC.popupInlineWindowMenu, menuId, bounds) as Promise<void>,
  updateAppMenuState: (state: import('@lumacast/commands').AppMenuState) =>
    ipcRenderer.invoke(IPC.updateAppMenuState, state) as Promise<void>,
  checkForAppUpdates: (manual = false) =>
    ipcRenderer.invoke(IPC.checkForAppUpdates, manual) as Promise<void>,
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  applySnapshotPatch: (patch: SnapshotPatch) => ipcRenderer.invoke(IPC.applySnapshotPatch, patch) as Promise<void>,
  restoreFromSnapshot: (snapshot: AppSnapshot) => ipcRenderer.invoke(IPC.restoreFromSnapshot, snapshot) as Promise<AppSnapshot>,
  chooseBundleExportPath: (suggestedName: string) => ipcRenderer.invoke(IPC.chooseBundleExportPath, suggestedName) as Promise<string | null>,
  chooseBundleImportPath: () => ipcRenderer.invoke(IPC.chooseBundleImportPath) as Promise<string | null>,
  chooseImportReplacementMediaPath: () => ipcRenderer.invoke(IPC.chooseImportReplacementMediaPath) as Promise<string | null>,
  exportBundle: (itemIds: Id[], filePath: string, options?: BundleExportOptions) =>
    ipcRenderer.invoke(IPC.exportBundle, itemIds, filePath, options) as Promise<{ filePath: string; itemCount: number }>,
  inspectImportBundle: (filePath: string) => ipcRenderer.invoke(IPC.inspectImportBundle, filePath) as Promise<BundleInspection>,
  finalizeImportBundle: (filePath: string, decisions: BundleBrokenReferenceDecision[]) =>
    ipcRenderer.invoke(IPC.finalizeImportBundle, filePath, decisions) as Promise<AppSnapshot>,
  listCues: () => ipcRenderer.invoke(IPC.listCues) as Promise<Cue[]>,
  createCue: (input: CueCreateInput) => ipcRenderer.invoke(IPC.createCue, input) as Promise<SnapshotPatch>,
  updateCue: (input: CueUpdateInput) => ipcRenderer.invoke(IPC.updateCue, input) as Promise<SnapshotPatch>,
  deleteCue: (id: Id) => ipcRenderer.invoke(IPC.deleteCue, id) as Promise<SnapshotPatch>,
  listMacros: () => ipcRenderer.invoke(IPC.listMacros) as Promise<Macro[]>,
  createMacro: (input: MacroCreateInput) => ipcRenderer.invoke(IPC.createMacro, input) as Promise<SnapshotPatch>,
  updateMacro: (input: MacroUpdateInput) => ipcRenderer.invoke(IPC.updateMacro, input) as Promise<SnapshotPatch>,
  deleteMacro: (id: Id) => ipcRenderer.invoke(IPC.deleteMacro, id) as Promise<SnapshotPatch>,
  listTriggerBindings: () => ipcRenderer.invoke(IPC.listTriggerBindings) as Promise<TriggerBinding[]>,
  createTriggerBinding: (input: TriggerBindingCreateInput) => ipcRenderer.invoke(IPC.createTriggerBinding, input) as Promise<SnapshotPatch>,
  deleteTriggerBinding: (id: Id) => ipcRenderer.invoke(IPC.deleteTriggerBinding, id) as Promise<SnapshotPatch>,
  listPlaybackSchedules: () => ipcRenderer.invoke(IPC.listPlaybackSchedules) as Promise<PlaybackSchedule[]>,
  savePlaybackSchedule: (schedule: PlaybackSchedule) => ipcRenderer.invoke(IPC.savePlaybackSchedule, schedule) as Promise<SnapshotPatch>,
  deletePlaybackSchedule: (id: Id) => ipcRenderer.invoke(IPC.deletePlaybackSchedule, id) as Promise<SnapshotPatch>,
  listSlideTags: () => ipcRenderer.invoke(IPC.listSlideTags) as Promise<SlideTag[]>,
  createSlideTag: (input: SlideTagCreateInput) => ipcRenderer.invoke(IPC.createSlideTag, input) as Promise<SnapshotPatch>,
  updateSlideTag: (input: SlideTagUpdateInput) => ipcRenderer.invoke(IPC.updateSlideTag, input) as Promise<SnapshotPatch>,
  deleteSlideTag: (id: Id) => ipcRenderer.invoke(IPC.deleteSlideTag, id) as Promise<SnapshotPatch>,
  assignSlideTags: (input: SlideTagAssignInput) => ipcRenderer.invoke(IPC.assignSlideTags, input) as Promise<SnapshotPatch>,
  createPlaylist: (name: string) => ipcRenderer.invoke(IPC.createPlaylist, name),
  createSeparator: (playlistId: Id, label: string) => ipcRenderer.invoke(IPC.createSeparator, playlistId, label),
  renameSeparator: (id: Id, label: string) => ipcRenderer.invoke(IPC.renameSeparator, id, label),
  setSeparatorColor: (id: Id, colorKey: string | null) => ipcRenderer.invoke(IPC.setSeparatorColor, id, colorKey),
  movePlaylist: (id: Id, direction: 'up' | 'down') => ipcRenderer.invoke(IPC.movePlaylist, id, direction),
  movePlaylistRow: (rowId: Id, newOrder: number) => ipcRenderer.invoke(IPC.movePlaylistRow, rowId, newOrder),
  removePlaylistRow: (rowId: Id) => ipcRenderer.invoke(IPC.removePlaylistRow, rowId),
  addItemToPlaylist: (playlistId: Id, itemRef: ItemRef, position?: number) =>
    ipcRenderer.invoke(IPC.addItemToPlaylist, playlistId, itemRef, position) as Promise<SnapshotPatch>,
  createPresentation: (title: string) => ipcRenderer.invoke(IPC.createPresentation, title),
  createLyric: (title: string) => ipcRenderer.invoke(IPC.createLyric, title),
  createSlide: (input: SlideCreateInput) => ipcRenderer.invoke(IPC.createSlide, input),
  duplicateSlide: (slideId: Id) => ipcRenderer.invoke(IPC.duplicateSlide, slideId),
  deleteSlide: (slideId: Id) => ipcRenderer.invoke(IPC.deleteSlide, slideId),
  updateSlideNotes: (input: SlideNotesUpdateInput) => ipcRenderer.invoke(IPC.updateSlideNotes, input),
  updateSlideBackground: (input: SlideBackgroundUpdateInput) => ipcRenderer.invoke(IPC.updateSlideBackground, input),
  setSlideOrder: (input: SlideOrderUpdateInput) => ipcRenderer.invoke(IPC.setSlideOrder, input),
  setPlaylistOrder: (playlistId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setPlaylistOrder, playlistId, newOrder),
  setOverlayOrder: (overlayId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setOverlayOrder, overlayId, newOrder),
  setStageOrder: (stageId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setStageOrder, stageId, newOrder),
  setThemeOrder: (themeId: Id, themeType: ThemeOwnerType, newOrder: number) => ipcRenderer.invoke(IPC.setThemeOrder, themeId, themeType, newOrder),
  setMacroOrder: (macroId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setMacroOrder, macroId, newOrder),
  createElement: (input: ElementCreateInput) => ipcRenderer.invoke(IPC.createElement, input),
  createElementsBatch: (inputs: ElementCreateInput[]) => ipcRenderer.invoke(IPC.createElementsBatch, inputs),
  updateElement: (input: ElementUpdateInput) => ipcRenderer.invoke(IPC.updateElement, input),
  updateElementsBatch: (inputs: ElementUpdateInput[]) => ipcRenderer.invoke(IPC.updateElementsBatch, inputs),
  deleteElement: (id: Id) => ipcRenderer.invoke(IPC.deleteElement, id),
  deleteElementsBatch: (ids: Id[]) => ipcRenderer.invoke(IPC.deleteElementsBatch, ids),
  createMediaAsset: (asset: MediaAssetCreateInput) => ipcRenderer.invoke(IPC.createMediaAsset, asset),
  deleteMediaAsset: (id: Id) => ipcRenderer.invoke(IPC.deleteMediaAsset, id),
  updateMediaAssetSrc: (id: Id, src: string) => ipcRenderer.invoke(IPC.updateMediaAssetSrc, id, src),
  reclaimMediaLibrary: () => ipcRenderer.invoke(IPC.reclaimMediaLibrary),
  ensureMediaDerivative: (assetId: Id) => ipcRenderer.invoke(IPC.ensureMediaDerivative, assetId),
  uploadMediaDerivativeFallback: (assetId: Id, generationToken: string, sourceFingerprint: string, bytes: Uint8Array) =>
    ipcRenderer.invoke(IPC.uploadMediaDerivativeFallback, assetId, generationToken, sourceFingerprint, bytes),
  getAudioCoverArt: (src: string) => ipcRenderer.invoke(IPC.getAudioCoverArt, src) as Promise<string | null>,
  createOverlay: (overlay: OverlayCreateInput) => ipcRenderer.invoke(IPC.createOverlay, overlay),
  updateOverlay: (input: OverlayUpdateInput) => ipcRenderer.invoke(IPC.updateOverlay, input),
  setOverlayEnabled: (overlayId: Id, enabled: boolean) => ipcRenderer.invoke(IPC.setOverlayEnabled, overlayId, enabled),
  deleteOverlay: (overlayId: Id) => ipcRenderer.invoke(IPC.deleteOverlay, overlayId),
  createTheme: (input: ThemeCreateInput) => ipcRenderer.invoke(IPC.createTheme, input),
  updateTheme: (input: ThemeUpdateInput) => ipcRenderer.invoke(IPC.updateTheme, input),
  deleteTheme: (themeId: Id, themeType: ThemeOwnerType) => ipcRenderer.invoke(IPC.deleteTheme, themeId, themeType),
  applyThemeToItem: (themeId: Id, itemRef: ItemRef) =>
    ipcRenderer.invoke(IPC.applyThemeToItem, themeId, itemRef) as Promise<SnapshotPatch>,
  detachThemeFromItem: (itemRef: ItemRef) =>
    ipcRenderer.invoke(IPC.detachThemeFromItem, itemRef) as Promise<SnapshotPatch>,
  syncThemeToLinkedItems: (themeId: Id, itemType: ItemType) =>
    ipcRenderer.invoke(IPC.syncThemeToLinkedItems, themeId, itemType) as Promise<SnapshotPatch>,
  applyThemeToOverlay: (themeId: Id, overlayId: Id) =>
    ipcRenderer.invoke(IPC.applyThemeToOverlay, themeId, overlayId),
  createItem: (input: ItemCreateInput) =>
    ipcRenderer.invoke(IPC.createItem, input) as Promise<ItemCreateResult>,
  duplicateItem: (input: ItemDuplicateInput) =>
    ipcRenderer.invoke(IPC.duplicateItem, input) as Promise<ItemDuplicateResult>,
  createStage: (input: StageCreateInput) => ipcRenderer.invoke(IPC.createStage, input),
  updateStage: (input: StageUpdateInput) => ipcRenderer.invoke(IPC.updateStage, input),
  deleteStage: (stageId: Id) => ipcRenderer.invoke(IPC.deleteStage, stageId),
  duplicateStage: (stageId: Id) => ipcRenderer.invoke(IPC.duplicateStage, stageId),
  renamePlaylist: (id: Id, name: string) => ipcRenderer.invoke(IPC.renamePlaylist, id, name),
  renamePresentation: (id: Id, title: string) => ipcRenderer.invoke(IPC.renamePresentation, id, title),
  renameLyric: (id: Id, title: string) => ipcRenderer.invoke(IPC.renameLyric, id, title),
  movePresentation: (id: Id, direction: 'up' | 'down') => ipcRenderer.invoke(IPC.movePresentation, id, direction),
  moveLyric: (id: Id, direction: 'up' | 'down') => ipcRenderer.invoke(IPC.moveLyric, id, direction),
  deletePlaylist: (id: Id) => ipcRenderer.invoke(IPC.deletePlaylist, id),
  deletePresentation: (id: Id) => ipcRenderer.invoke(IPC.deletePresentation, id),
  deleteLyric: (id: Id) => ipcRenderer.invoke(IPC.deleteLyric, id),
  setNdiOutputEnabled: (name: NdiOutputName, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setNdiOutputEnabled, name, enabled),
  getNdiOutputState: () => ipcRenderer.invoke(IPC.getNdiOutputState),
  getNdiOutputConfigs: () => ipcRenderer.invoke(IPC.getNdiOutputConfigs) as Promise<NdiOutputConfigMap>,
  updateNdiOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) =>
    ipcRenderer.invoke(IPC.updateNdiOutputConfig, name, config) as Promise<NdiOutputConfigMap>,
  getNdiDiagnostics: () => ipcRenderer.invoke(IPC.getNdiDiagnostics) as Promise<NdiDiagnostics>,
  requestNdiFrameTransport: (name: NdiOutputName) => {
    ipcRenderer.send(IPC.requestNdiFrameTransport, { name });
  },
  requestNdiAudioTransport: (name: NdiOutputName) => {
    ipcRenderer.send(IPC.requestNdiAudioTransport, { name });
  },
  sendNdiFrame: (name: NdiOutputName, buffer: ArrayBuffer, width: number, height: number, telemetry?: NdiFrameTelemetry) => {
    // Use ordinary IPC cloning for frame delivery. Electron's renderer
    // transfer-list path rejects ArrayBuffer here, which prevents frames from
    // reaching main and leaves NDI diagnostics stuck at zero.
    const stamped: NdiFrameTelemetry | undefined = telemetry
      ? { ...telemetry, rendererSendAtMs: Date.now() }
      : undefined;
    ipcRenderer.send(IPC.sendNdiFrame, { name, buffer, width, height, telemetry: stamped });
  },
  sendNdiAudio: (
    name: NdiOutputName,
    samples: Float32Array,
    sampleRate: number,
    channels: number,
    samplesPerChannel: number,
  ) => {
    // Slice so the buffer we ship is exactly the audio data — Float32Array
    // views can sit inside a larger backing buffer.
    const buffer = samples.slice().buffer as ArrayBuffer;
    ipcRenderer.send(IPC.sendNdiAudio, { name, buffer, sampleRate, channels, samplesPerChannel });
  },
  onNdiOutputStateChanged: (callback: (state: NdiOutputState) => void) => {
    const handler = (_event: IpcRendererEvent, state: NdiOutputState) => callback(state);
    ipcRenderer.on(NDI_EVENTS.outputStateChanged, handler);
    return () => { ipcRenderer.removeListener(NDI_EVENTS.outputStateChanged, handler); };
  },
  onNdiDiagnosticsChanged: (callback: (diagnostics: NdiDiagnostics) => void) => {
    const handler = (_event: IpcRendererEvent, diagnostics: NdiDiagnostics) => callback(diagnostics);
    ipcRenderer.on(NDI_EVENTS.diagnosticsChanged, handler);
    return () => { ipcRenderer.removeListener(NDI_EVENTS.diagnosticsChanged, handler); };
  },
  onNdiFrameReleased: (callback: (release: import('@lumacast/protocol').NdiFrameRelease) => void) => {
    const handler = (_event: IpcRendererEvent, release: import('@lumacast/protocol').NdiFrameRelease) => callback(release);
    ipcRenderer.on(NDI_EVENTS.frameReleased, handler);
    return () => { ipcRenderer.removeListener(NDI_EVENTS.frameReleased, handler); };
  },
  restoreProjectBackup: (backup: ProjectBackup) =>
    ipcRenderer.invoke(IPC.restoreProjectBackup, backup) as Promise<ProjectRestoreResult>,
  listPlaylists: () => ipcRenderer.invoke(IPC.listPlaylists) as Promise<PlaylistSummary[]>,
  getPlaylist: (input: PlaylistGetInput) => ipcRenderer.invoke(IPC.getPlaylist, input) as Promise<PlaylistDetail>,
  listItems: (input: ItemListInput) => ipcRenderer.invoke(IPC.listItems, input) as Promise<ItemSummary[]>,
  getItem: (input: ItemGetInput) => ipcRenderer.invoke(IPC.getItem, input) as Promise<ItemDetail>,
  getSlide: (input: SlideGetInput) => ipcRenderer.invoke(IPC.getSlide, input) as Promise<SlideDetail>,
  listMediaAssets: (input: MediaAssetListInput) => ipcRenderer.invoke(IPC.listMediaAssets, input) as Promise<MediaAssetSummary[]>,
  listThemes: (input: ThemeListInput) => ipcRenderer.invoke(IPC.listThemes, input) as Promise<ThemeSummary[]>,
  listOverlays: () => ipcRenderer.invoke(IPC.listOverlays) as Promise<OverlaySummary[]>,
  listStages: () => ipcRenderer.invoke(IPC.listStages) as Promise<StageSummary[]>,
  getProjectOverview: () => ipcRenderer.invoke(IPC.getProjectOverview) as Promise<ProjectOverview>,
  searchContent: (input: SearchContentInput) => ipcRenderer.invoke(IPC.searchContent, input) as Promise<SearchResult[]>,
  onAppMenuCommand: (callback: (commandId: import('@lumacast/commands').AppMenuCommandId) => void) => {
    const handler = (_event: IpcRendererEvent, commandId: import('@lumacast/commands').AppMenuCommandId) => callback(commandId);
    ipcRenderer.on(APP_MENU_EVENTS.command, handler);
    return () => { ipcRenderer.removeListener(APP_MENU_EVENTS.command, handler); };
  },
  onMediaDerivativeProgress: (callback: (progress: import('@lumacast/protocol').MediaDerivativeProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: import('@lumacast/protocol').MediaDerivativeProgress) => callback(progress);
    ipcRenderer.on(MEDIA_DERIVATIVE_EVENTS.progress, handler);
    return () => { ipcRenderer.removeListener(MEDIA_DERIVATIVE_EVENTS.progress, handler); };
  },
  onMediaLibraryProgress: (callback: (progress: import('@lumacast/protocol').MediaLibraryProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: import('@lumacast/protocol').MediaLibraryProgress) => callback(progress);
    ipcRenderer.on(MEDIA_LIBRARY_EVENTS.progress, handler);
    return () => { ipcRenderer.removeListener(MEDIA_LIBRARY_EVENTS.progress, handler); };
  },
  onPersistenceProgress: (callback: (progress: import('@lumacast/protocol').PersistenceProgress) => void) => {
    const handler = (_event: IpcRendererEvent, progress: import('@lumacast/protocol').PersistenceProgress) => callback(progress);
    ipcRenderer.on(PERSISTENCE_EVENTS.progress, handler);
    ipcRenderer.send(PERSISTENCE_CHANNELS.subscribe);
    return () => { ipcRenderer.removeListener(PERSISTENCE_EVENTS.progress, handler); };
  },
  obsListLogSessions: () => ipcRenderer.invoke(IPC.obsListLogSessions) as Promise<LogSessionSummary[]>,
  obsReadLogSession: (filePath: string, offset: number, limit: number) =>
    ipcRenderer.invoke(IPC.obsReadLogSession, filePath, offset, limit) as Promise<LogReadResult>,
  obsGetCurrentLogPath: () => ipcRenderer.invoke(IPC.obsGetCurrentLogPath) as Promise<string | null>,
  obsOpenLogFolder: () => ipcRenderer.invoke(IPC.obsOpenLogFolder) as Promise<void>,
  obsGetSystemMetrics: () => ipcRenderer.invoke(IPC.obsGetSystemMetrics) as Promise<SystemMetricsSnapshot>,
  agentRespondAction: (response: AgentActionResponse) =>
    ipcRenderer.invoke(IPC.agentRespondAction, response) as Promise<void>,
  onAgentActionRequest: (callback: (request: AgentActionRequest) => void) => {
    const handler = (_event: IpcRendererEvent, request: AgentActionRequest) => callback(request);
    ipcRenderer.on(AGENT_ACTION_EVENTS.request, handler);
    return () => { ipcRenderer.removeListener(AGENT_ACTION_EVENTS.request, handler); };
  },
  onAgentBatch: (callback: (event: AgentBatchEvent) => void) => {
    const handler = (_event: IpcRendererEvent, batch: AgentBatchEvent) => callback(batch);
    ipcRenderer.on(AGENT_ACTION_EVENTS.batch, handler);
    return () => { ipcRenderer.removeListener(AGENT_ACTION_EVENTS.batch, handler); };
  },
  onAgentActionCancelled: (callback: (event: AgentActionCancelledEvent) => void) => {
    const handler = (_event: IpcRendererEvent, cancelled: AgentActionCancelledEvent) => callback(cancelled);
    ipcRenderer.on(AGENT_ACTION_EVENTS.cancelled, handler);
    return () => { ipcRenderer.removeListener(AGENT_ACTION_EVENTS.cancelled, handler); };
  },
  agentListThreads: () => ipcRenderer.invoke(IPC.agentListThreads) as Promise<AgentThreadSummary[]>,
  agentGetThread: (input: AgentThreadIdInput) => ipcRenderer.invoke(IPC.agentGetThread, input) as Promise<AgentThread | null>,
  agentCreateThread: (input: AgentThreadCreateInput) => ipcRenderer.invoke(IPC.agentCreateThread, input) as Promise<AgentThread>,
  agentDeleteThread: (input: AgentThreadIdInput) => ipcRenderer.invoke(IPC.agentDeleteThread, input) as Promise<void>,
  agentRenameThread: (input: AgentRenameThreadInput) =>
    ipcRenderer.invoke(IPC.agentRenameThread, input) as Promise<AgentThreadSummary>,
  agentSetThreadModel: (input: AgentSetThreadModelInput) =>
    ipcRenderer.invoke(IPC.agentSetThreadModel, input) as Promise<AgentThreadSummary>,
  agentSendMessage: (input: AgentSendMessageInput) =>
    ipcRenderer.invoke(IPC.agentSendMessage, input) as Promise<{ runId: string }>,
  agentStopGeneration: (input: AgentThreadIdInput) => ipcRenderer.invoke(IPC.agentStopGeneration, input) as Promise<void>,
  agentGetConfig: () => ipcRenderer.invoke(IPC.agentGetConfig) as Promise<AgentConfig>,
  agentUpdateConfig: (update: AgentConfigUpdate) => ipcRenderer.invoke(IPC.agentUpdateConfig, update) as Promise<AgentConfig>,
  agentGetCredentialStatus: () => ipcRenderer.invoke(IPC.agentGetCredentialStatus) as Promise<AgentCredentialStatus[]>,
  agentSetCredential: (input: AgentSetCredentialInput) =>
    ipcRenderer.invoke(IPC.agentSetCredential, input) as Promise<AgentCredentialStatus[]>,
  agentDeleteCredential: (input: AgentProviderInput) =>
    ipcRenderer.invoke(IPC.agentDeleteCredential, input) as Promise<AgentCredentialStatus[]>,
  agentListModels: (input: AgentListModelsInput) => ipcRenderer.invoke(IPC.agentListModels, input) as Promise<AgentModelInfo[]>,
  agentValidateModel: (input: AgentValidateModelInput) =>
    ipcRenderer.invoke(IPC.agentValidateModel, input) as Promise<AgentModelValidation>,
  agentGrantFilesystemRoot: () => ipcRenderer.invoke(IPC.agentGrantFilesystemRoot) as Promise<AgentConfig | null>,
  agentRevokeFilesystemRoot: (input: AgentFilesystemRootInput) =>
    ipcRenderer.invoke(IPC.agentRevokeFilesystemRoot, input) as Promise<AgentConfig>,
  agentImportMedia: (input: AgentImportMediaInput) => ipcRenderer.invoke(IPC.agentImportMedia, input) as Promise<SnapshotPatch>,
  agentReplaceMediaSource: (input: AgentReplaceMediaSourceInput) =>
    ipcRenderer.invoke(IPC.agentReplaceMediaSource, input) as Promise<SnapshotPatch>,
  agentExtractDocumentText: (input: AgentExtractDocumentInput) =>
    ipcRenderer.invoke(IPC.agentExtractDocumentText, input) as Promise<AgentDocumentText>,
  agentGetMcpStatus: () => ipcRenderer.invoke(IPC.agentGetMcpStatus) as Promise<AgentMcpStatus>,
  agentSetMcpEnabled: (input: AgentMcpEnabledInput) => ipcRenderer.invoke(IPC.agentSetMcpEnabled, input) as Promise<AgentMcpStatus>,
  agentCreateMcpClient: (input: AgentMcpClientCreateInput) =>
    ipcRenderer.invoke(IPC.agentCreateMcpClient, input) as Promise<AgentMcpClientCreated>,
  agentRevokeMcpClient: (input: AgentMcpClientIdInput) =>
    ipcRenderer.invoke(IPC.agentRevokeMcpClient, input) as Promise<AgentMcpStatus>,
  agentUpdateMcpClientPermissions: (input: AgentMcpClientPermissionsInput) =>
    ipcRenderer.invoke(IPC.agentUpdateMcpClientPermissions, input) as Promise<AgentMcpStatus>,
  onAgentThreadEvent: (callback: (event: AgentThreadEvent) => void) => {
    const handler = (_event: IpcRendererEvent, threadEvent: AgentThreadEvent) => callback(threadEvent);
    ipcRenderer.on(AGENT_EVENTS.threadEvent, handler);
    return () => { ipcRenderer.removeListener(AGENT_EVENTS.threadEvent, handler); };
  },
  onAgentMcpStatus: (callback: (status: AgentMcpStatus) => void) => {
    const handler = (_event: IpcRendererEvent, status: AgentMcpStatus) => callback(status);
    ipcRenderer.on(AGENT_EVENTS.mcpStatus, handler);
    return () => { ipcRenderer.removeListener(AGENT_EVENTS.mcpStatus, handler); };
  },
} satisfies MainApi;

contextBridge.exposeInMainWorld('castApi', api);
