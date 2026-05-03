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
} from './types';
import type { SnapshotPatch } from './snapshot-patch';

export interface MainApi {
  platform: NodeJS.Platform;
  getPathForFile: (file: File) => string;
  readClipboardText: () => Promise<string>;
  writeClipboardText: (text: string) => Promise<void>;
  getInlineWindowMenuItems: () => Promise<InlineWindowMenuItem[]>;
  popupInlineWindowMenu: (menuId: string, bounds: InlineWindowMenuBounds) => Promise<void>;
  updateAppMenuState: (state: AppMenuState) => Promise<void>;
  checkForAppUpdates: (manual?: boolean) => Promise<void>;
  onAppMenuCommand: (callback: (commandId: AppMenuCommandId) => void) => () => void;
  getSnapshot: () => Promise<AppSnapshot>;
  restoreFromSnapshot: (snapshot: AppSnapshot) => Promise<AppSnapshot>;
  chooseDeckBundleExportPath: (suggestedName: string) => Promise<string | null>;
  chooseDeckBundleImportPath: () => Promise<string | null>;
  chooseImportReplacementMediaPath: () => Promise<string | null>;
  exportDeckBundle: (itemIds: Id[], filePath: string, options?: DeckBundleExportOptions) => Promise<{ filePath: string; itemCount: number }>;
  inspectImportBundle: (filePath: string) => Promise<DeckBundleInspection>;
  finalizeImportBundle: (filePath: string, decisions: DeckBundleBrokenReferenceDecision[]) => Promise<AppSnapshot>;
  createLibrary: (name: string) => Promise<SnapshotPatch>;
  createPlaylist: (libraryId: Id, name: string) => Promise<SnapshotPatch>;
  createPlaylistSegment: (playlistId: Id, name: string) => Promise<SnapshotPatch>;
  renamePlaylistSegment: (id: Id, name: string) => Promise<SnapshotPatch>;
  setPlaylistSegmentColor: (id: Id, colorKey: string | null) => Promise<SnapshotPatch>;
  movePlaylist: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  addDeckItemToSegment: (segmentId: Id, itemId: Id) => Promise<SnapshotPatch>;
  moveDeckItemToSegment: (playlistId: Id, itemId: Id, segmentId: Id | null) => Promise<SnapshotPatch>;
  movePlaylistEntryToSegment: (entryId: Id, segmentId: Id | null) => Promise<SnapshotPatch>;
  moveDeckItem: (id: Id, direction: 'up' | 'down') => Promise<SnapshotPatch>;
  createPresentation: (title: string) => Promise<SnapshotPatch>;
  createLyric: (title: string) => Promise<SnapshotPatch>;
  createSlide: (input: SlideCreateInput) => Promise<SnapshotPatch>;
  duplicateSlide: (slideId: Id) => Promise<SnapshotPatch>;
  deleteSlide: (slideId: Id) => Promise<SnapshotPatch>;
  updateSlideNotes: (input: SlideNotesUpdateInput) => Promise<SnapshotPatch>;
  movePlaylistEntry: (entryId: Id, direction: 'up' | 'down') => Promise<AppSnapshot>;
  setSlideOrder: (input: SlideOrderUpdateInput) => Promise<SnapshotPatch>;
  setLibraryOrder: (libraryId: Id, newOrder: number) => Promise<SnapshotPatch>;
  setPlaylistOrder: (playlistId: Id, newOrder: number) => Promise<SnapshotPatch>;
  setPlaylistSegmentOrder: (segmentId: Id, newOrder: number) => Promise<SnapshotPatch>;
  movePlaylistEntryTo: (entryId: Id, segmentId: Id, newOrder: number) => Promise<SnapshotPatch>;
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
  createStage: (input: StageCreateInput) => Promise<SnapshotPatch>;
  updateStage: (input: StageUpdateInput) => Promise<SnapshotPatch>;
  deleteStage: (stageId: Id) => Promise<SnapshotPatch>;
  duplicateStage: (stageId: Id) => Promise<SnapshotPatch>;
  renameLibrary: (id: Id, name: string) => Promise<SnapshotPatch>;
  renamePlaylist: (id: Id, name: string) => Promise<SnapshotPatch>;
  renamePresentation: (id: Id, title: string) => Promise<SnapshotPatch>;
  renameLyric: (id: Id, title: string) => Promise<SnapshotPatch>;
  deleteLibrary: (id: Id) => Promise<SnapshotPatch>;
  deletePlaylist: (id: Id) => Promise<SnapshotPatch>;
  deletePlaylistSegment: (id: Id) => Promise<SnapshotPatch>;
  deletePresentation: (id: Id) => Promise<SnapshotPatch>;
  deleteLyric: (id: Id) => Promise<SnapshotPatch>;
  setNdiOutputEnabled: (name: NdiOutputName, enabled: boolean) => Promise<NdiOutputState>;
  getNdiOutputState: () => Promise<NdiOutputState>;
  getNdiOutputConfigs: () => Promise<NdiOutputConfigMap>;
  updateNdiOutputConfig: (name: NdiOutputName, config: Partial<NdiOutputConfig>) => Promise<NdiOutputConfigMap>;
  getNdiDiagnostics: () => Promise<NdiDiagnostics>;
  sendNdiFrame: (
    name: NdiOutputName,
    buffer: ArrayBuffer,
    width: number,
    height: number,
    telemetry?: NdiFrameTelemetry,
  ) => void;
  onNdiOutputStateChanged: (callback: (state: NdiOutputState) => void) => () => void;
  getAudioCoverArt: (src: string) => Promise<string | null>;
  onNdiDiagnosticsChanged: (callback: (diagnostics: NdiDiagnostics) => void) => () => void;
  createCollection: (input: CollectionCreateInput) => Promise<SnapshotPatch>;
  renameCollection: (input: CollectionRenameInput) => Promise<SnapshotPatch>;
  deleteCollection: (input: CollectionDeleteInput) => Promise<SnapshotPatch>;
  reorderCollections: (input: CollectionReorderInput) => Promise<SnapshotPatch>;
  setItemCollection: (input: CollectionAssignmentInput) => Promise<SnapshotPatch>;
}

export interface InlineWindowMenuItem {
  id: string;
  label: string;
}

export interface InlineWindowMenuBounds {
  x: number;
  y: number;
}

export type AppMenuCommandId =
  | 'file.newPresentation'
  | 'file.newLyric'
  | 'file.newLibrary'
  | 'file.newPlaylist'
  | 'file.newSegment'
  | 'file.newSlide'
  | 'file.exportCurrentItem'
  | 'file.exportWorkspace'
  | 'app.openSettings'
  | 'app.checkForUpdates'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.duplicate'
  | 'edit.delete'
  | 'edit.clearSelection'
  | 'view.openCommandPalette'
  | 'view.mode.show'
  | 'view.mode.deckEditor'
  | 'view.mode.overlayEditor'
  | 'view.mode.themeEditor'
  | 'view.mode.stageEditor'
  | 'view.mode.settings'
  | 'view.slideBrowser.grid'
  | 'view.slideBrowser.list'
  | 'view.playlistBrowser.current'
  | 'view.playlistBrowser.tabs'
  | 'view.playlistBrowser.continuous'
  | 'playback.takeSlide'
  | 'playback.previousSlide'
  | 'playback.nextSlide'
  | 'playback.toggleAudienceOutput'
  | 'playback.toggleStageOutput';

export interface AppMenuState {
  workbenchMode: 'show' | 'deck-editor' | 'overlay-editor' | 'theme-editor' | 'stage-editor' | 'settings';
  slideBrowserMode: 'grid' | 'list';
  playlistBrowserMode: 'current' | 'tabs' | 'continuous';
  hasCurrentLibrary: boolean;
  hasCurrentPlaylist: boolean;
  hasCurrentDeckItem: boolean;
  hasCurrentSlide: boolean;
  hasMultipleSlides: boolean;
  hasEditableSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
  canDuplicate: boolean;
  canDelete: boolean;
  canClearSelection: boolean;
  canTakeSlide: boolean;
  canGoToPreviousSlide: boolean;
  canGoToNextSlide: boolean;
  canExportWorkspace: boolean;
  audienceOutputEnabled: boolean;
  stageOutputEnabled: boolean;
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
  createLibrary: 'cast:createLibrary',
  createPlaylist: 'cast:createPlaylist',
  createPlaylistSegment: 'cast:createPlaylistSegment',
  renamePlaylistSegment: 'cast:renamePlaylistSegment',
  setPlaylistSegmentColor: 'cast:setPlaylistSegmentColor',
  movePlaylist: 'cast:movePlaylist',
  addDeckItemToSegment: 'cast:addDeckItemToSegment',
  moveDeckItemToSegment: 'cast:moveDeckItemToSegment',
  movePlaylistEntryToSegment: 'cast:movePlaylistEntryToSegment',
  movePlaylistEntry: 'cast:movePlaylistEntry',
  moveDeckItem: 'cast:moveDeckItem',
  createPresentation: 'cast:createPresentation',
  createLyric: 'cast:createLyric',
  createSlide: 'cast:createSlide',
  duplicateSlide: 'cast:duplicateSlide',
  deleteSlide: 'cast:deleteSlide',
  updateSlideNotes: 'cast:updateSlideNotes',
  setSlideOrder: 'cast:setSlideOrder',
  setLibraryOrder: 'cast:setLibraryOrder',
  setPlaylistOrder: 'cast:setPlaylistOrder',
  setPlaylistSegmentOrder: 'cast:setPlaylistSegmentOrder',
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
  createStage: 'cast:createStage',
  updateStage: 'cast:updateStage',
  deleteStage: 'cast:deleteStage',
  duplicateStage: 'cast:duplicateStage',
  renameLibrary: 'cast:renameLibrary',
  renamePlaylist: 'cast:renamePlaylist',
  renamePresentation: 'cast:renamePresentation',
  renameLyric: 'cast:renameLyric',
  deleteLibrary: 'cast:deleteLibrary',
  deletePlaylist: 'cast:deletePlaylist',
  deletePlaylistSegment: 'cast:deletePlaylistSegment',
  deletePresentation: 'cast:deletePresentation',
  deleteLyric: 'cast:deleteLyric',
  getAudioCoverArt: 'cast:getAudioCoverArt',
  setNdiOutputEnabled: 'ndi:setOutputEnabled',
  getNdiOutputState: 'ndi:getOutputState',
  getNdiOutputConfigs: 'ndi:getOutputConfigs',
  updateNdiOutputConfig: 'ndi:updateOutputConfig',
  getNdiDiagnostics: 'ndi:getDiagnostics',
  sendNdiFrame: 'ndi:sendFrame',
  createCollection: 'cast:createCollection',
  renameCollection: 'cast:renameCollection',
  deleteCollection: 'cast:deleteCollection',
  reorderCollections: 'cast:reorderCollections',
  setItemCollection: 'cast:setItemCollection',
} as const;

export const NDI_EVENTS = {
  outputStateChanged: 'ndi:outputStateChanged',
  diagnosticsChanged: 'ndi:diagnosticsChanged',
} as const;

export const APP_MENU_EVENTS = {
  command: 'app-menu:command',
} as const;
