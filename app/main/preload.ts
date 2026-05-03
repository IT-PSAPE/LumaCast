import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { APP_MENU_EVENTS, IPC, NDI_EVENTS } from '@core/ipc';
import type {
  AppSnapshot,
  DeckBundleBrokenReferenceDecision,
  DeckBundleExportOptions,
  DeckBundleInspection,
  ElementCreateInput,
  ElementUpdateInput,
  Id,
  MediaAssetCreateInput,
  CollectionAssignmentInput,
  CollectionCreateInput,
  CollectionDeleteInput,
  CollectionRenameInput,
  CollectionReorderInput,
  NdiDiagnostics,
  NdiOutputConfig,
  NdiOutputConfigMap,
  NdiFrameTelemetry,
  NdiOutputName,
  NdiOutputState,
  OverlayCreateInput,
  OverlayUpdateInput,
  StageCreateInput,
  StageUpdateInput,
  ThemeCreateInput,
  ThemeUpdateInput,
  SlideCreateInput,
  SlideNotesUpdateInput,
  SlideOrderUpdateInput
} from '@core/types';

const api = {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  readClipboardText: () => ipcRenderer.invoke(IPC.readClipboardText) as Promise<string>,
  writeClipboardText: (text: string) => ipcRenderer.invoke(IPC.writeClipboardText, text) as Promise<void>,
  getInlineWindowMenuItems: () => ipcRenderer.invoke(IPC.getInlineWindowMenuItems) as Promise<import('@core/ipc').InlineWindowMenuItem[]>,
  popupInlineWindowMenu: (menuId: string, bounds: import('@core/ipc').InlineWindowMenuBounds) =>
    ipcRenderer.invoke(IPC.popupInlineWindowMenu, menuId, bounds) as Promise<void>,
  updateAppMenuState: (state: import('@core/ipc').AppMenuState) =>
    ipcRenderer.invoke(IPC.updateAppMenuState, state) as Promise<void>,
  checkForAppUpdates: (manual = false) =>
    ipcRenderer.invoke(IPC.checkForAppUpdates, manual) as Promise<void>,
  getSnapshot: () => ipcRenderer.invoke(IPC.getSnapshot),
  restoreFromSnapshot: (snapshot: AppSnapshot) => ipcRenderer.invoke(IPC.restoreFromSnapshot, snapshot) as Promise<AppSnapshot>,
  chooseDeckBundleExportPath: (suggestedName: string) => ipcRenderer.invoke(IPC.chooseDeckBundleExportPath, suggestedName) as Promise<string | null>,
  chooseDeckBundleImportPath: () => ipcRenderer.invoke(IPC.chooseDeckBundleImportPath) as Promise<string | null>,
  chooseImportReplacementMediaPath: () => ipcRenderer.invoke(IPC.chooseImportReplacementMediaPath) as Promise<string | null>,
  exportDeckBundle: (itemIds: Id[], filePath: string, options?: DeckBundleExportOptions) =>
    ipcRenderer.invoke(IPC.exportDeckBundle, itemIds, filePath, options) as Promise<{ filePath: string; itemCount: number }>,
  inspectImportBundle: (filePath: string) => ipcRenderer.invoke(IPC.inspectImportBundle, filePath) as Promise<DeckBundleInspection>,
  finalizeImportBundle: (filePath: string, decisions: DeckBundleBrokenReferenceDecision[]) =>
    ipcRenderer.invoke(IPC.finalizeImportBundle, filePath, decisions) as Promise<AppSnapshot>,
  createLibrary: (name: string) => ipcRenderer.invoke(IPC.createLibrary, name),
  createPlaylist: (libraryId: Id, name: string) => ipcRenderer.invoke(IPC.createPlaylist, libraryId, name),
  createPlaylistSegment: (playlistId: Id, name: string) => ipcRenderer.invoke(IPC.createPlaylistSegment, playlistId, name),
  renamePlaylistSegment: (id: Id, name: string) => ipcRenderer.invoke(IPC.renamePlaylistSegment, id, name),
  setPlaylistSegmentColor: (id: Id, colorKey: string | null) => ipcRenderer.invoke(IPC.setPlaylistSegmentColor, id, colorKey),
  movePlaylist: (id: Id, direction: 'up' | 'down') => ipcRenderer.invoke(IPC.movePlaylist, id, direction),
  addDeckItemToSegment: (segmentId: Id, itemId: Id) =>
    ipcRenderer.invoke(IPC.addDeckItemToSegment, segmentId, itemId),
  moveDeckItemToSegment: (playlistId: Id, itemId: Id, segmentId: Id | null) =>
    ipcRenderer.invoke(IPC.moveDeckItemToSegment, playlistId, itemId, segmentId),
  movePlaylistEntryToSegment: (entryId: Id, segmentId: Id | null) =>
    ipcRenderer.invoke(IPC.movePlaylistEntryToSegment, entryId, segmentId),
  movePlaylistEntry: (entryId: Id, direction: 'up' | 'down') =>
    ipcRenderer.invoke(IPC.movePlaylistEntry, entryId, direction),
  moveDeckItem: (id: Id, direction: 'up' | 'down') => ipcRenderer.invoke(IPC.moveDeckItem, id, direction),
  createPresentation: (title: string) => ipcRenderer.invoke(IPC.createPresentation, title),
  createLyric: (title: string) => ipcRenderer.invoke(IPC.createLyric, title),
  createSlide: (input: SlideCreateInput) => ipcRenderer.invoke(IPC.createSlide, input),
  duplicateSlide: (slideId: Id) => ipcRenderer.invoke(IPC.duplicateSlide, slideId),
  deleteSlide: (slideId: Id) => ipcRenderer.invoke(IPC.deleteSlide, slideId),
  updateSlideNotes: (input: SlideNotesUpdateInput) => ipcRenderer.invoke(IPC.updateSlideNotes, input),
  setSlideOrder: (input: SlideOrderUpdateInput) => ipcRenderer.invoke(IPC.setSlideOrder, input),
  setLibraryOrder: (libraryId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setLibraryOrder, libraryId, newOrder),
  setPlaylistOrder: (playlistId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setPlaylistOrder, playlistId, newOrder),
  setPlaylistSegmentOrder: (segmentId: Id, newOrder: number) => ipcRenderer.invoke(IPC.setPlaylistSegmentOrder, segmentId, newOrder),
  movePlaylistEntryTo: (entryId: Id, segmentId: Id, newOrder: number) => ipcRenderer.invoke(IPC.movePlaylistEntryTo, entryId, segmentId, newOrder),
  createElement: (input: ElementCreateInput) => ipcRenderer.invoke(IPC.createElement, input),
  createElementsBatch: (inputs: ElementCreateInput[]) => ipcRenderer.invoke(IPC.createElementsBatch, inputs),
  updateElement: (input: ElementUpdateInput) => ipcRenderer.invoke(IPC.updateElement, input),
  updateElementsBatch: (inputs: ElementUpdateInput[]) => ipcRenderer.invoke(IPC.updateElementsBatch, inputs),
  deleteElement: (id: Id) => ipcRenderer.invoke(IPC.deleteElement, id),
  deleteElementsBatch: (ids: Id[]) => ipcRenderer.invoke(IPC.deleteElementsBatch, ids),
  createMediaAsset: (asset: MediaAssetCreateInput) => ipcRenderer.invoke(IPC.createMediaAsset, asset),
  deleteMediaAsset: (id: Id) => ipcRenderer.invoke(IPC.deleteMediaAsset, id),
  updateMediaAssetSrc: (id: Id, src: string) => ipcRenderer.invoke(IPC.updateMediaAssetSrc, id, src),
  getAudioCoverArt: (src: string) => ipcRenderer.invoke(IPC.getAudioCoverArt, src) as Promise<string | null>,
  createOverlay: (overlay: OverlayCreateInput) => ipcRenderer.invoke(IPC.createOverlay, overlay),
  updateOverlay: (input: OverlayUpdateInput) => ipcRenderer.invoke(IPC.updateOverlay, input),
  setOverlayEnabled: (overlayId: Id, enabled: boolean) => ipcRenderer.invoke(IPC.setOverlayEnabled, overlayId, enabled),
  deleteOverlay: (overlayId: Id) => ipcRenderer.invoke(IPC.deleteOverlay, overlayId),
  createTheme: (input: ThemeCreateInput) => ipcRenderer.invoke(IPC.createTheme, input),
  updateTheme: (input: ThemeUpdateInput) => ipcRenderer.invoke(IPC.updateTheme, input),
  deleteTheme: (themeId: Id) => ipcRenderer.invoke(IPC.deleteTheme, themeId),
  applyThemeToDeckItem: (themeId: Id, itemId: Id) =>
    ipcRenderer.invoke(IPC.applyThemeToDeckItem, themeId, itemId),
  detachThemeFromDeckItem: (itemId: Id) =>
    ipcRenderer.invoke(IPC.detachThemeFromDeckItem, itemId),
  syncThemeToLinkedDeckItems: (themeId: Id) =>
    ipcRenderer.invoke(IPC.syncThemeToLinkedDeckItems, themeId),
  applyThemeToOverlay: (themeId: Id, overlayId: Id) =>
    ipcRenderer.invoke(IPC.applyThemeToOverlay, themeId, overlayId),
  createStage: (input: StageCreateInput) => ipcRenderer.invoke(IPC.createStage, input),
  updateStage: (input: StageUpdateInput) => ipcRenderer.invoke(IPC.updateStage, input),
  deleteStage: (stageId: Id) => ipcRenderer.invoke(IPC.deleteStage, stageId),
  duplicateStage: (stageId: Id) => ipcRenderer.invoke(IPC.duplicateStage, stageId),
  renameLibrary: (id: Id, name: string) => ipcRenderer.invoke(IPC.renameLibrary, id, name),
  renamePlaylist: (id: Id, name: string) => ipcRenderer.invoke(IPC.renamePlaylist, id, name),
  renamePresentation: (id: Id, title: string) => ipcRenderer.invoke(IPC.renamePresentation, id, title),
  renameLyric: (id: Id, title: string) => ipcRenderer.invoke(IPC.renameLyric, id, title),
  deleteLibrary: (id: Id) => ipcRenderer.invoke(IPC.deleteLibrary, id),
  deletePlaylist: (id: Id) => ipcRenderer.invoke(IPC.deletePlaylist, id),
  deletePlaylistSegment: (id: Id) => ipcRenderer.invoke(IPC.deletePlaylistSegment, id),
  deletePresentation: (id: Id) => ipcRenderer.invoke(IPC.deletePresentation, id),
  deleteLyric: (id: Id) => ipcRenderer.invoke(IPC.deleteLyric, id),
  setNdiOutputEnabled: (name: NdiOutputName, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setNdiOutputEnabled, name, enabled),
  getNdiOutputState: () => ipcRenderer.invoke(IPC.getNdiOutputState),
  getNdiOutputConfigs: () => ipcRenderer.invoke(IPC.getNdiOutputConfigs) as Promise<NdiOutputConfigMap>,
  updateNdiOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) =>
    ipcRenderer.invoke(IPC.updateNdiOutputConfig, name, config) as Promise<NdiOutputConfigMap>,
  getNdiDiagnostics: () => ipcRenderer.invoke(IPC.getNdiDiagnostics) as Promise<NdiDiagnostics>,
  sendNdiFrame: (name: NdiOutputName, buffer: ArrayBuffer, width: number, height: number, telemetry?: NdiFrameTelemetry) => {
    ipcRenderer.send(IPC.sendNdiFrame, name, buffer, width, height, telemetry);
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
  createCollection: (input: CollectionCreateInput) => ipcRenderer.invoke(IPC.createCollection, input),
  renameCollection: (input: CollectionRenameInput) => ipcRenderer.invoke(IPC.renameCollection, input),
  deleteCollection: (input: CollectionDeleteInput) => ipcRenderer.invoke(IPC.deleteCollection, input),
  reorderCollections: (input: CollectionReorderInput) => ipcRenderer.invoke(IPC.reorderCollections, input),
  setItemCollection: (input: CollectionAssignmentInput) => ipcRenderer.invoke(IPC.setItemCollection, input),
  onAppMenuCommand: (callback: (commandId: import('@core/ipc').AppMenuCommandId) => void) => {
    const handler = (_event: IpcRendererEvent, commandId: import('@core/ipc').AppMenuCommandId) => callback(commandId);
    ipcRenderer.on(APP_MENU_EVENTS.command, handler);
    return () => { ipcRenderer.removeListener(APP_MENU_EVENTS.command, handler); };
  },
};

contextBridge.exposeInMainWorld('castApi', api);
