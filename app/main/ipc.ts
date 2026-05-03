import { BrowserWindow, clipboard, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { CastRepository } from '@database/store';
import { IPC, NDI_EVENTS, type AppMenuState, type InlineWindowMenuBounds, type InlineWindowMenuItem } from '@core/ipc';
import type {
  AppSnapshot,
  DeckBundleBrokenReferenceDecision,
  DeckBundleExportOptions,
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
  NdiFrameTelemetry,
  NdiOutputConfig,
  NdiOutputName,
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
import { getInlineWindowMenuItems, popupInlineWindowMenu, updateApplicationMenu } from './application-menu';
import type { AppUpdater } from './app-updater';
import { readDeckBundleArchive, writeDeckBundleArchive } from './deck-bundle-archive';
import { NdiService } from './ndi/ndi-service';
import { assertTrustedIpcSender } from './security';

const NDI_OUTPUT_NAMES = new Set<NdiOutputName>(['audience', 'stage']);

function isSafeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeHandle<Args extends unknown[], R>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => R,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      assertTrustedIpcSender(event);
      return await handler(event, ...(args as Args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[IPC ${channel}]`, message);
      throw new Error(message);
    }
  });
}

export const registerIpcHandlers = (
  repo: CastRepository,
  ndiService: NdiService,
  getMainWindow: () => BrowserWindow | null,
  appUpdater: AppUpdater,
): void => {
  function getDialogWindow(event: IpcMainInvokeEvent): BrowserWindow | null {
    return BrowserWindow.fromWebContents(event.sender) ?? getMainWindow();
  }

  function sanitizeSuggestedBundleName(name: string): string {
    const sanitized = name.trim().replace(/[<>:"/\\|?*\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ');
    return sanitized || 'cast-deck';
  }

  function ensureBundleExtension(filePath: string): string {
    return filePath.endsWith('.cst') ? filePath : `${filePath}.cst`;
  }

  function showSaveDialogForEvent(event: IpcMainInvokeEvent, options: Electron.SaveDialogOptions) {
    const browserWindow = getDialogWindow(event);
    return browserWindow ? dialog.showSaveDialog(browserWindow, options) : dialog.showSaveDialog(options);
  }

  function showOpenDialogForEvent(event: IpcMainInvokeEvent, options: Electron.OpenDialogOptions) {
    const browserWindow = getDialogWindow(event);
    return browserWindow ? dialog.showOpenDialog(browserWindow, options) : dialog.showOpenDialog(options);
  }

  ndiService.onOutputStateChanged((state) => {
    getMainWindow()?.webContents.send(NDI_EVENTS.outputStateChanged, state);
  });
  ndiService.onDiagnosticsChanged((diagnostics) => {
    getMainWindow()?.webContents.send(NDI_EVENTS.diagnosticsChanged, diagnostics);
  });

  safeHandle(IPC.readClipboardText, () => clipboard.readText());
  safeHandle(IPC.writeClipboardText, (_event, text: string) => {
    if (typeof text !== 'string') {
      throw new Error('Invalid clipboard payload');
    }
    clipboard.writeText(text);
  });
  safeHandle(IPC.getInlineWindowMenuItems, (): InlineWindowMenuItem[] => getInlineWindowMenuItems());
  safeHandle(IPC.popupInlineWindowMenu, async (event, menuId: string, bounds: InlineWindowMenuBounds) => {
    const browserWindow = getDialogWindow(event);
    if (!browserWindow) return;
    if (
      typeof menuId !== 'string'
      || typeof bounds !== 'object'
      || bounds === null
      || !isSafeFiniteNumber(bounds.x)
      || !isSafeFiniteNumber(bounds.y)
    ) {
      throw new Error('Invalid inline menu payload');
    }
    await popupInlineWindowMenu(menuId, browserWindow, bounds);
  });
  safeHandle(IPC.updateAppMenuState, (event, state: AppMenuState) => {
    const browserWindow = getDialogWindow(event);
    updateApplicationMenu(browserWindow, state);
  });
  safeHandle(IPC.checkForAppUpdates, async (event, manual = false) => {
    const browserWindow = getDialogWindow(event);
    await appUpdater.checkForUpdates(Boolean(manual), browserWindow);
  });
  safeHandle(IPC.getSnapshot, () => repo.getSnapshot());
  safeHandle(IPC.restoreFromSnapshot, (_event, snapshot: AppSnapshot) => repo.restoreFromSnapshot(snapshot));
  safeHandle(IPC.chooseDeckBundleExportPath, async (event, suggestedName: string) => {
    const result = await showSaveDialogForEvent(event, {
      title: 'Export Deck Bundle',
      defaultPath: `${sanitizeSuggestedBundleName(suggestedName)}.cst`,
      filters: [{ name: 'CST Bundle', extensions: ['cst'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) return null;
    return ensureBundleExtension(result.filePath);
  });
  safeHandle(IPC.chooseDeckBundleImportPath, async (event) => {
    const result = await showOpenDialogForEvent(event, {
      title: 'Import Deck Bundle',
      filters: [{ name: 'CST Bundle', extensions: ['cst'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  safeHandle(IPC.chooseImportReplacementMediaPath, async (event) => {
    const result = await showOpenDialogForEvent(event, {
      title: 'Choose Replacement Media',
      filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v'] }],
      properties: ['openFile'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  safeHandle(IPC.exportDeckBundle, async (_event, itemIds: Id[], filePath: string, options?: DeckBundleExportOptions) => {
    const bundle = repo.exportDeckBundle(itemIds, options);
    const normalizedPath = ensureBundleExtension(filePath);
    await writeDeckBundleArchive(normalizedPath, bundle);
    return { filePath: normalizedPath, itemCount: bundle.items.length };
  });
  safeHandle(IPC.inspectImportBundle, async (_event, filePath: string) => {
    const bundle = await readDeckBundleArchive(filePath);
    return repo.inspectImportBundle(bundle);
  });
  safeHandle(IPC.finalizeImportBundle, async (_event, filePath: string, decisions: DeckBundleBrokenReferenceDecision[]) => {
    const bundle = await readDeckBundleArchive(filePath);
    return repo.finalizeImportBundle(bundle, decisions);
  });
  safeHandle(IPC.createLibrary, (_event, name: string) => repo.createLibrary(name));
  safeHandle(IPC.createPlaylist, (_event, libraryId: Id, name: string) => repo.createPlaylist(libraryId, name));
  safeHandle(IPC.createPlaylistSegment, (_event, playlistId: Id, name: string) =>
    repo.createPlaylistSegment(playlistId, name)
  );
  safeHandle(IPC.renamePlaylistSegment, (_event, id: Id, name: string) =>
    repo.renamePlaylistSegment(id, name)
  );
  safeHandle(IPC.setPlaylistSegmentColor, (_event, id: Id, colorKey: string | null) =>
    repo.setPlaylistSegmentColor(id, colorKey)
  );
  safeHandle(IPC.movePlaylist, (_event, id: Id, direction: 'up' | 'down') =>
    repo.movePlaylist(id, direction)
  );
  safeHandle(IPC.addDeckItemToSegment, (_event, segmentId: Id, itemId: Id) =>
    repo.addDeckItemToSegment(segmentId, itemId)
  );
  safeHandle(IPC.moveDeckItemToSegment, (_event, playlistId: Id, itemId: Id, segmentId: Id | null) =>
    repo.moveDeckItemToSegment(playlistId, itemId, segmentId)
  );
  safeHandle(IPC.movePlaylistEntryToSegment, (_event, entryId: Id, segmentId: Id | null) =>
    repo.movePlaylistEntryToSegment(entryId, segmentId)
  );
  safeHandle(IPC.movePlaylistEntry, (_event, entryId: Id, direction: 'up' | 'down') =>
    repo.movePlaylistEntry(entryId, direction)
  );
  safeHandle(IPC.moveDeckItem, (_event, id: Id, direction: 'up' | 'down') =>
    repo.moveDeckItem(id, direction)
  );
  safeHandle(IPC.createPresentation, (_event, title: string) => repo.createPresentation(title));
  safeHandle(IPC.createLyric, (_event, title: string) =>
    repo.createLyric(title)
  );
  safeHandle(IPC.createSlide, (_event, input: SlideCreateInput) => repo.createSlide(input));
  safeHandle(IPC.duplicateSlide, (_event, slideId: Id) => repo.duplicateSlide(slideId));
  safeHandle(IPC.deleteSlide, (_event, slideId: Id) => repo.deleteSlide(slideId));
  safeHandle(IPC.updateSlideNotes, (_event, input: SlideNotesUpdateInput) => repo.updateSlideNotes(input));
  safeHandle(IPC.setSlideOrder, (_event, input: SlideOrderUpdateInput) => repo.setSlideOrder(input));
  safeHandle(IPC.setLibraryOrder, (_event, libraryId: Id, newOrder: number) => repo.setLibraryOrder(libraryId, newOrder));
  safeHandle(IPC.setPlaylistOrder, (_event, playlistId: Id, newOrder: number) => repo.setPlaylistOrder(playlistId, newOrder));
  safeHandle(IPC.setPlaylistSegmentOrder, (_event, segmentId: Id, newOrder: number) => repo.setPlaylistSegmentOrder(segmentId, newOrder));
  safeHandle(IPC.movePlaylistEntryTo, (_event, entryId: Id, segmentId: Id, newOrder: number) => repo.movePlaylistEntryTo(entryId, segmentId, newOrder));
  safeHandle(IPC.createElement, (_event, input: ElementCreateInput) => repo.createElement(input));
  safeHandle(IPC.createElementsBatch, (_event, inputs: ElementCreateInput[]) => repo.createElementsBatch(inputs));
  safeHandle(IPC.updateElement, (_event, input: ElementUpdateInput) => repo.updateElement(input));
  safeHandle(IPC.updateElementsBatch, (_event, inputs: ElementUpdateInput[]) => repo.updateElementsBatch(inputs));
  safeHandle(IPC.deleteElement, (_event, id: Id) => repo.deleteElement(id));
  safeHandle(IPC.deleteElementsBatch, (_event, ids: Id[]) => repo.deleteElementsBatch(ids));
  safeHandle(IPC.createMediaAsset, (_event, asset: MediaAssetCreateInput) =>
    repo.createMediaAsset(asset)
  );
  safeHandle(IPC.deleteMediaAsset, (_event, id: Id) => repo.deleteMediaAsset(id));
  safeHandle(IPC.updateMediaAssetSrc, (_event, id: Id, src: string) => repo.updateMediaAssetSrc(id, src));
  safeHandle(IPC.getAudioCoverArt, async (_event, src: string) => {
    const { resolveLocalMediaSourcePath } = await import('@database/media-source-utils');
    const filePath = resolveLocalMediaSourcePath(src);
    if (!filePath) return null;
    try {
      const { parseFile } = await import('music-metadata');
      const metadata = await parseFile(filePath);
      const picture = metadata.common.picture?.[0];
      if (!picture) return null;
      return `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`;
    } catch {
      return null;
    }
  });
  safeHandle(IPC.createOverlay, (_event, overlay: OverlayCreateInput) => repo.createOverlay(overlay));
  safeHandle(IPC.updateOverlay, (_event, input: OverlayUpdateInput) => repo.updateOverlay(input));
  safeHandle(IPC.setOverlayEnabled, (_event, overlayId: Id, enabled: boolean) => repo.setOverlayEnabled(overlayId, enabled));
  safeHandle(IPC.deleteOverlay, (_event, overlayId: Id) => repo.deleteOverlay(overlayId));
  safeHandle(IPC.createTheme, (_event, input: ThemeCreateInput) => repo.createTheme(input));
  safeHandle(IPC.updateTheme, (_event, input: ThemeUpdateInput) => repo.updateTheme(input));
  safeHandle(IPC.deleteTheme, (_event, themeId: Id) => repo.deleteTheme(themeId));
  safeHandle(IPC.applyThemeToDeckItem, (_event, themeId: Id, itemId: Id) =>
    repo.applyThemeToDeckItem(themeId, itemId)
  );
  safeHandle(IPC.detachThemeFromDeckItem, (_event, itemId: Id) =>
    repo.detachThemeFromDeckItem(itemId)
  );
  safeHandle(IPC.syncThemeToLinkedDeckItems, (_event, themeId: Id) =>
    repo.syncThemeToLinkedDeckItems(themeId)
  );
  safeHandle(IPC.applyThemeToOverlay, (_event, themeId: Id, overlayId: Id) =>
    repo.applyThemeToOverlay(themeId, overlayId)
  );
  safeHandle(IPC.createStage, (_event, input: StageCreateInput) => repo.createStage(input));
  safeHandle(IPC.updateStage, (_event, input: StageUpdateInput) => repo.updateStage(input));
  safeHandle(IPC.deleteStage, (_event, stageId: Id) => repo.deleteStage(stageId));
  safeHandle(IPC.duplicateStage, (_event, stageId: Id) => repo.duplicateStage(stageId));
  safeHandle(IPC.renameLibrary, (_event, id: Id, name: string) => repo.renameLibrary(id, name));
  safeHandle(IPC.renamePlaylist, (_event, id: Id, name: string) => repo.renamePlaylist(id, name));
  safeHandle(IPC.renamePresentation, (_event, id: Id, title: string) => repo.renamePresentation(id, title));
  safeHandle(IPC.renameLyric, (_event, id: Id, title: string) => repo.renameLyric(id, title));
  safeHandle(IPC.deleteLibrary, (_event, id: Id) => repo.deleteLibrary(id));
  safeHandle(IPC.deletePlaylist, (_event, id: Id) => repo.deletePlaylist(id));
  safeHandle(IPC.deletePlaylistSegment, (_event, id: Id) => repo.deletePlaylistSegment(id));
  safeHandle(IPC.deletePresentation, (_event, id: Id) => repo.deletePresentation(id));
  safeHandle(IPC.deleteLyric, (_event, id: Id) => repo.deleteLyric(id));
  safeHandle(IPC.createCollection, (_event, input: CollectionCreateInput) => repo.createCollection(input));
  safeHandle(IPC.renameCollection, (_event, input: CollectionRenameInput) => repo.renameCollection(input));
  safeHandle(IPC.deleteCollection, (_event, input: CollectionDeleteInput) => repo.deleteCollection(input));
  safeHandle(IPC.reorderCollections, (_event, input: CollectionReorderInput) => repo.reorderCollections(input));
  safeHandle(IPC.setItemCollection, (_event, input: CollectionAssignmentInput) => repo.setItemCollection(input));
  safeHandle(IPC.setNdiOutputEnabled, (_event, name: NdiOutputName, enabled: boolean) => {
    if (!NDI_OUTPUT_NAMES.has(name) || typeof enabled !== 'boolean') {
      throw new Error('Invalid NDI output toggle payload');
    }
    return ndiService.setOutputEnabled(name, enabled);
  });
  safeHandle(IPC.getNdiOutputState, () => ndiService.getOutputState());
  safeHandle(IPC.getNdiOutputConfigs, () => ndiService.getOutputConfigs());
  safeHandle(IPC.updateNdiOutputConfig, (_event, name: NdiOutputName, config: Partial<NdiOutputConfig>) => {
    if (!NDI_OUTPUT_NAMES.has(name) || !config || typeof config !== 'object') {
      throw new Error('Invalid NDI output config payload');
    }
    return ndiService.updateOutputConfig(name, config);
  });
  safeHandle(IPC.getNdiDiagnostics, (): NdiDiagnostics => ndiService.getDiagnostics());
  ipcMain.on(
    IPC.sendNdiFrame,
    (event, name: NdiOutputName, buffer: ArrayBuffer, width: number, height: number, telemetry?: NdiFrameTelemetry) => {
    try {
      assertTrustedIpcSender(event);
      if (!NDI_OUTPUT_NAMES.has(name)) {
        throw new Error(`Invalid NDI output name: ${String(name)}`);
      }
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error('NDI frame payload must be an ArrayBuffer');
      }
      ndiService.receiveFrame(name, new Uint8Array(buffer), width, height, telemetry);
    } catch (error) {
      console.error(`[IPC ${IPC.sendNdiFrame}]`, error);
    }
    },
  );
};
