import { BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { CastRepository } from '@database/store';
import { validateProjectBackup } from '@core/deck-bundles';
import { IPC, NDI_EVENTS, type AppMenuState, type DeckItemCreateWithThemeInput, type InlineWindowMenuBounds, type InlineWindowMenuItem } from '@core/ipc';
import type {
  AppSnapshot,
  CueCreateInput,
  CueUpdateInput,
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
  MacroCreateInput,
  MacroUpdateInput,
  ThemeCreateInput,
  ThemeUpdateInput,
  TriggerBindingCreateInput,
  SlideCreateInput,
  SlideNotesUpdateInput,
  SlideBackgroundUpdateInput,
  SlideOrderUpdateInput,
  TalkScriptBlockCreateInput,
  TalkScriptBlockOrderUpdateInput,
  TalkScriptBlockUpdateInput
} from '@core/types';
import type { ProjectBackup } from '../contracts/project-backup';
import {
  CodecError,
  RPC_MOVE_DIRECTIONS,
  expectRpcPrimitiveArgs,
  decodeAppSnapshotShape,
  decodeCollectionAssignmentInput,
  decodeCollectionCreateInput,
  decodeCollectionDeleteInput,
  decodeCollectionReorderInput,
  decodeCollectionRenameInput,
  decodeCueCreateInput,
  decodeCueUpdateInput,
  decodeDeckBundleBrokenReferenceDecision,
  decodeDeckBundleExportOptions,
  decodeDeckItemCreateWithThemeInput,
  decodeElementCreateInput,
  decodeElementUpdateInput,
  decodeInlineWindowMenuBounds,
  decodeMacroCreateInput,
  decodeMacroUpdateInput,
  decodeMediaAssetCreateInput,
  decodeNdiOutputConfigInput,
  decodeNdiOutputName,
  decodeOverlayCreateInput,
  decodeOverlayUpdateInput,
  decodeSlideBackgroundUpdateInput,
  decodeSlideCreateInput,
  decodeSlideNotesUpdateInput,
  decodeSlideOrderUpdateInput,
  decodeStageCreateInput,
  decodeStageUpdateInput,
  decodeTalkScriptBlockCreateInput,
  decodeTalkScriptBlockOrderUpdateInput,
  decodeTalkScriptBlockUpdateInput,
  decodeThemeCreateInput,
  decodeThemeUpdateInput,
  decodeTriggerBindingCreateInput,
  type CodecContext,
} from '../contracts/codecs';
import { getInlineWindowMenuItems, popupInlineWindowMenu, updateApplicationMenu } from './application-menu';
import type { AppUpdater } from './app-updater';
import { readDeckBundleArchive, writeDeckBundleArchive } from './deck-bundle-archive';
import {
  getLogFilePath,
  getLogsDir,
  listLogSessions,
  readLogSession,
} from './logger';
import type { NdiServiceLike } from './ndi/ndi-protocol';
import { assertTrustedIpcSender } from './security';
import { sampleSystemMetrics } from './system-metrics';

// `sendNdiFrame`/`sendNdiAudio` (the two ipcMain.on frame channels near the
// bottom of this file) are the only consumers of this set; their inline
// validation is deliberately left untouched by issue #150 (frame transport
// is out of scope), so this stays exactly as it was rather than being
// folded into the codec-based `decodeNdiOutputName` used by the RPC
// handlers below.
const NDI_OUTPUT_NAMES = new Set<NdiOutputName>(['audience', 'stage']);

/** Context for the renderer-originated RPC codecs in app/contracts/codecs.ts (issue #150). */
function rpcContext(operation: string, path = ''): CodecContext {
  return { boundary: 'rpc', operation, path };
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
  ndiService: NdiServiceLike,
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
    expectRpcPrimitiveArgs([text], [{ name: 'text', kind: 'string' }], rpcContext('writeClipboardText'));
    clipboard.writeText(text);
  });
  safeHandle(IPC.getInlineWindowMenuItems, (): InlineWindowMenuItem[] => getInlineWindowMenuItems());
  safeHandle(IPC.popupInlineWindowMenu, async (event, menuId: string, bounds: InlineWindowMenuBounds) => {
    const ctx = rpcContext('popupInlineWindowMenu');
    expectRpcPrimitiveArgs([menuId], [{ name: 'menuId', kind: 'string' }], ctx);
    const validatedBounds = decodeInlineWindowMenuBounds(bounds, rpcContext('popupInlineWindowMenu', 'bounds'));
    const browserWindow = getDialogWindow(event);
    if (!browserWindow) return;
    await popupInlineWindowMenu(menuId, browserWindow, validatedBounds);
  });
  // updateAppMenuState is intentionally left without a codec: its ~20 boolean
  // fields only drive the native Electron menu's enabled/checked state, not
  // any repository or filesystem call — a malformed value at worst produces
  // a stale menu item, not data corruption or a security bypass. See the
  // issue #150 report's cut line for the full reasoning.
  safeHandle(IPC.updateAppMenuState, (event, state: AppMenuState) => {
    const browserWindow = getDialogWindow(event);
    updateApplicationMenu(browserWindow, state);
  });
  safeHandle(IPC.checkForAppUpdates, async (event, manual?: boolean) => {
    expectRpcPrimitiveArgs([manual], [{ name: 'manual', kind: 'optionalBoolean' }], rpcContext('checkForAppUpdates'));
    const browserWindow = getDialogWindow(event);
    await appUpdater.checkForUpdates(Boolean(manual), browserWindow);
  });
  safeHandle(IPC.getSnapshot, () => repo.getSnapshot());
  safeHandle(IPC.restoreFromSnapshot, (_event, snapshot: AppSnapshot) =>
    repo.restoreFromSnapshot(decodeAppSnapshotShape(snapshot, rpcContext('restoreFromSnapshot')))
  );
  safeHandle(IPC.chooseDeckBundleExportPath, async (event, suggestedName: string) => {
    expectRpcPrimitiveArgs([suggestedName], [{ name: 'suggestedName', kind: 'string' }], rpcContext('chooseDeckBundleExportPath'));
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
    const ctx = rpcContext('exportDeckBundle');
    expectRpcPrimitiveArgs(
      [itemIds, filePath],
      [
        { name: 'itemIds', kind: 'stringArray' },
        { name: 'filePath', kind: 'string' },
      ],
      ctx,
    );
    const validatedOptions = options === undefined
      ? undefined
      : decodeDeckBundleExportOptions(options, rpcContext('exportDeckBundle', 'options'));
    const bundle = repo.exportDeckBundle(itemIds, validatedOptions);
    const normalizedPath = ensureBundleExtension(filePath);
    await writeDeckBundleArchive(normalizedPath, bundle);
    return { filePath: normalizedPath, itemCount: bundle.items.length };
  });
  safeHandle(IPC.inspectImportBundle, async (_event, filePath: string) => {
    expectRpcPrimitiveArgs([filePath], [{ name: 'filePath', kind: 'string' }], rpcContext('inspectImportBundle'));
    const bundle = await readDeckBundleArchive(filePath);
    return repo.inspectImportBundle(bundle);
  });
  safeHandle(IPC.finalizeImportBundle, async (_event, filePath: string, decisions: DeckBundleBrokenReferenceDecision[]) => {
    const ctx = rpcContext('finalizeImportBundle');
    expectRpcPrimitiveArgs([filePath], [{ name: 'filePath', kind: 'string' }], ctx);
    if (!Array.isArray(decisions)) {
      throw new CodecError(ctx, `decisions must be an array, got ${typeof decisions}`);
    }
    const validatedDecisions = decisions.map((decision, index) =>
      decodeDeckBundleBrokenReferenceDecision(decision, rpcContext('finalizeImportBundle', `decisions[${index}]`))
    );
    const bundle = await readDeckBundleArchive(filePath);
    return repo.finalizeImportBundle(bundle, validatedDecisions);
  });
  safeHandle(IPC.listCues, () => repo.listCues());
  safeHandle(IPC.createCue, (_event, input: CueCreateInput) =>
    repo.createCue(decodeCueCreateInput(input, rpcContext('createCue')))
  );
  safeHandle(IPC.updateCue, (_event, input: CueUpdateInput) =>
    repo.updateCue(decodeCueUpdateInput(input, rpcContext('updateCue')))
  );
  safeHandle(IPC.deleteCue, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteCue'));
    return repo.deleteCue(id);
  });
  safeHandle(IPC.listMacros, () => repo.listMacros());
  safeHandle(IPC.createMacro, (_event, input: MacroCreateInput) =>
    repo.createMacro(decodeMacroCreateInput(input, rpcContext('createMacro')))
  );
  safeHandle(IPC.updateMacro, (_event, input: MacroUpdateInput) =>
    repo.updateMacro(decodeMacroUpdateInput(input, rpcContext('updateMacro')))
  );
  safeHandle(IPC.deleteMacro, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteMacro'));
    return repo.deleteMacro(id);
  });
  safeHandle(IPC.listTriggerBindings, () => repo.listTriggerBindings());
  safeHandle(IPC.createTriggerBinding, (_event, input: TriggerBindingCreateInput) =>
    repo.createTriggerBinding(decodeTriggerBindingCreateInput(input, rpcContext('createTriggerBinding')))
  );
  safeHandle(IPC.deleteTriggerBinding, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteTriggerBinding'));
    return repo.deleteTriggerBinding(id);
  });
  safeHandle(IPC.createLibrary, (_event, name: string) => {
    expectRpcPrimitiveArgs([name], [{ name: 'name', kind: 'string' }], rpcContext('createLibrary'));
    return repo.createLibrary(name);
  });
  safeHandle(IPC.createPlaylist, (_event, libraryId: Id, name: string) => {
    expectRpcPrimitiveArgs(
      [libraryId, name],
      [{ name: 'libraryId', kind: 'string' }, { name: 'name', kind: 'string' }],
      rpcContext('createPlaylist'),
    );
    return repo.createPlaylist(libraryId, name);
  });
  safeHandle(IPC.createPlaylistGroup, (_event, playlistId: Id, name: string) => {
    expectRpcPrimitiveArgs(
      [playlistId, name],
      [{ name: 'playlistId', kind: 'string' }, { name: 'name', kind: 'string' }],
      rpcContext('createPlaylistGroup'),
    );
    return repo.createPlaylistGroup(playlistId, name);
  });
  safeHandle(IPC.renamePlaylistGroup, (_event, id: Id, name: string) => {
    expectRpcPrimitiveArgs(
      [id, name],
      [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }],
      rpcContext('renamePlaylistGroup'),
    );
    return repo.renamePlaylistGroup(id, name);
  });
  safeHandle(IPC.setPlaylistGroupColor, (_event, id: Id, colorKey: string | null) => {
    expectRpcPrimitiveArgs(
      [id, colorKey],
      [{ name: 'id', kind: 'string' }, { name: 'colorKey', kind: 'nullableString' }],
      rpcContext('setPlaylistGroupColor'),
    );
    return repo.setPlaylistGroupColor(id, colorKey);
  });
  safeHandle(IPC.movePlaylist, (_event, id: Id, direction: 'up' | 'down') => {
    expectRpcPrimitiveArgs(
      [id, direction],
      [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
      rpcContext('movePlaylist'),
    );
    return repo.movePlaylist(id, direction);
  });
  safeHandle(IPC.addDeckItemToGroup, (_event, playlistId: Id, groupId: Id, itemId: Id) => {
    expectRpcPrimitiveArgs(
      [playlistId, groupId, itemId],
      [{ name: 'playlistId', kind: 'string' }, { name: 'groupId', kind: 'string' }, { name: 'itemId', kind: 'string' }],
      rpcContext('addDeckItemToGroup'),
    );
    return repo.addDeckItemToGroup(playlistId, groupId, itemId);
  });
  safeHandle(IPC.moveDeckItemToGroup, (_event, playlistId: Id, itemId: Id, groupId: Id | null) => {
    expectRpcPrimitiveArgs(
      [playlistId, itemId, groupId],
      [{ name: 'playlistId', kind: 'string' }, { name: 'itemId', kind: 'string' }, { name: 'groupId', kind: 'nullableString' }],
      rpcContext('moveDeckItemToGroup'),
    );
    return repo.moveDeckItemToGroup(playlistId, itemId, groupId);
  });
  safeHandle(IPC.movePlaylistEntryToGroup, (_event, entryId: Id, groupId: Id | null) => {
    expectRpcPrimitiveArgs(
      [entryId, groupId],
      [{ name: 'entryId', kind: 'string' }, { name: 'groupId', kind: 'nullableString' }],
      rpcContext('movePlaylistEntryToGroup'),
    );
    return repo.movePlaylistEntryToGroup(entryId, groupId);
  });
  safeHandle(IPC.movePlaylistEntry, (_event, entryId: Id, direction: 'up' | 'down') => {
    expectRpcPrimitiveArgs(
      [entryId, direction],
      [{ name: 'entryId', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
      rpcContext('movePlaylistEntry'),
    );
    return repo.movePlaylistEntry(entryId, direction);
  });
  safeHandle(IPC.moveDeckItem, (_event, id: Id, direction: 'up' | 'down') => {
    expectRpcPrimitiveArgs(
      [id, direction],
      [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
      rpcContext('moveDeckItem'),
    );
    return repo.moveDeckItem(id, direction);
  });
  safeHandle(IPC.createPresentation, (_event, title: string) => {
    expectRpcPrimitiveArgs([title], [{ name: 'title', kind: 'string' }], rpcContext('createPresentation'));
    return repo.createPresentation(title);
  });
  safeHandle(IPC.createLyric, (_event, title: string) => {
    expectRpcPrimitiveArgs([title], [{ name: 'title', kind: 'string' }], rpcContext('createLyric'));
    return repo.createLyric(title);
  });
  safeHandle(IPC.createTalk, (_event, title: string) => {
    expectRpcPrimitiveArgs([title], [{ name: 'title', kind: 'string' }], rpcContext('createTalk'));
    return repo.createTalk(title);
  });
  safeHandle(IPC.createSlide, (_event, input: SlideCreateInput) =>
    repo.createSlide(decodeSlideCreateInput(input, rpcContext('createSlide')))
  );
  safeHandle(IPC.duplicateSlide, (_event, slideId: Id) => {
    expectRpcPrimitiveArgs([slideId], [{ name: 'slideId', kind: 'string' }], rpcContext('duplicateSlide'));
    return repo.duplicateSlide(slideId);
  });
  safeHandle(IPC.deleteSlide, (_event, slideId: Id) => {
    expectRpcPrimitiveArgs([slideId], [{ name: 'slideId', kind: 'string' }], rpcContext('deleteSlide'));
    return repo.deleteSlide(slideId);
  });
  safeHandle(IPC.updateSlideNotes, (_event, input: SlideNotesUpdateInput) =>
    repo.updateSlideNotes(decodeSlideNotesUpdateInput(input, rpcContext('updateSlideNotes')))
  );
  safeHandle(IPC.updateSlideBackground, (_event, input: SlideBackgroundUpdateInput) =>
    repo.updateSlideBackground(decodeSlideBackgroundUpdateInput(input, rpcContext('updateSlideBackground')))
  );
  safeHandle(IPC.createTalkScriptBlock, (_event, input: TalkScriptBlockCreateInput) =>
    repo.createTalkScriptBlock(decodeTalkScriptBlockCreateInput(input, rpcContext('createTalkScriptBlock')))
  );
  safeHandle(IPC.updateTalkScriptBlock, (_event, input: TalkScriptBlockUpdateInput) =>
    repo.updateTalkScriptBlock(decodeTalkScriptBlockUpdateInput(input, rpcContext('updateTalkScriptBlock')))
  );
  safeHandle(IPC.deleteTalkScriptBlock, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteTalkScriptBlock'));
    return repo.deleteTalkScriptBlock(id);
  });
  safeHandle(IPC.setTalkScriptBlockOrder, (_event, input: TalkScriptBlockOrderUpdateInput) =>
    repo.setTalkScriptBlockOrder(decodeTalkScriptBlockOrderUpdateInput(input, rpcContext('setTalkScriptBlockOrder')))
  );
  safeHandle(IPC.setSlideOrder, (_event, input: SlideOrderUpdateInput) =>
    repo.setSlideOrder(decodeSlideOrderUpdateInput(input, rpcContext('setSlideOrder')))
  );
  safeHandle(IPC.setLibraryOrder, (_event, libraryId: Id, newOrder: number) => {
    expectRpcPrimitiveArgs(
      [libraryId, newOrder],
      [{ name: 'libraryId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
      rpcContext('setLibraryOrder'),
    );
    return repo.setLibraryOrder(libraryId, newOrder);
  });
  safeHandle(IPC.setPlaylistOrder, (_event, playlistId: Id, newOrder: number) => {
    expectRpcPrimitiveArgs(
      [playlistId, newOrder],
      [{ name: 'playlistId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
      rpcContext('setPlaylistOrder'),
    );
    return repo.setPlaylistOrder(playlistId, newOrder);
  });
  safeHandle(IPC.setPlaylistGroupOrder, (_event, groupId: Id, newOrder: number) => {
    expectRpcPrimitiveArgs(
      [groupId, newOrder],
      [{ name: 'groupId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
      rpcContext('setPlaylistGroupOrder'),
    );
    return repo.setPlaylistGroupOrder(groupId, newOrder);
  });
  safeHandle(IPC.movePlaylistEntryTo, (_event, entryId: Id, groupId: Id, newOrder: number) => {
    expectRpcPrimitiveArgs(
      [entryId, groupId, newOrder],
      [{ name: 'entryId', kind: 'string' }, { name: 'groupId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
      rpcContext('movePlaylistEntryTo'),
    );
    return repo.movePlaylistEntryTo(entryId, groupId, newOrder);
  });
  safeHandle(IPC.createElement, (_event, input: ElementCreateInput) =>
    repo.createElement(decodeElementCreateInput(input, rpcContext('createElement')))
  );
  safeHandle(IPC.createElementsBatch, (_event, inputs: ElementCreateInput[]) => {
    const ctx = rpcContext('createElementsBatch');
    if (!Array.isArray(inputs)) throw new CodecError(ctx, `inputs must be an array, got ${typeof inputs}`);
    const validated = inputs.map((input, index) =>
      decodeElementCreateInput(input, rpcContext('createElementsBatch', `inputs[${index}]`))
    );
    return repo.createElementsBatch(validated);
  });
  safeHandle(IPC.updateElement, (_event, input: ElementUpdateInput) =>
    repo.updateElement(decodeElementUpdateInput(input, rpcContext('updateElement')))
  );
  safeHandle(IPC.updateElementsBatch, (_event, inputs: ElementUpdateInput[]) => {
    const ctx = rpcContext('updateElementsBatch');
    if (!Array.isArray(inputs)) throw new CodecError(ctx, `inputs must be an array, got ${typeof inputs}`);
    const validated = inputs.map((input, index) =>
      decodeElementUpdateInput(input, rpcContext('updateElementsBatch', `inputs[${index}]`))
    );
    return repo.updateElementsBatch(validated);
  });
  safeHandle(IPC.deleteElement, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteElement'));
    return repo.deleteElement(id);
  });
  safeHandle(IPC.deleteElementsBatch, (_event, ids: Id[]) => {
    expectRpcPrimitiveArgs([ids], [{ name: 'ids', kind: 'stringArray' }], rpcContext('deleteElementsBatch'));
    return repo.deleteElementsBatch(ids);
  });
  safeHandle(IPC.createMediaAsset, (_event, asset: MediaAssetCreateInput) =>
    repo.createMediaAsset(decodeMediaAssetCreateInput(asset, rpcContext('createMediaAsset')))
  );
  safeHandle(IPC.deleteMediaAsset, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteMediaAsset'));
    return repo.deleteMediaAsset(id);
  });
  safeHandle(IPC.updateMediaAssetSrc, (_event, id: Id, src: string) => {
    expectRpcPrimitiveArgs(
      [id, src],
      [{ name: 'id', kind: 'string' }, { name: 'src', kind: 'string' }],
      rpcContext('updateMediaAssetSrc'),
    );
    return repo.updateMediaAssetSrc(id, src);
  });
  safeHandle(IPC.getAudioCoverArt, async (_event, src: string) => {
    expectRpcPrimitiveArgs([src], [{ name: 'src', kind: 'string' }], rpcContext('getAudioCoverArt'));
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
  safeHandle(IPC.createOverlay, (_event, overlay: OverlayCreateInput) =>
    repo.createOverlay(decodeOverlayCreateInput(overlay, rpcContext('createOverlay')))
  );
  safeHandle(IPC.updateOverlay, (_event, input: OverlayUpdateInput) =>
    repo.updateOverlay(decodeOverlayUpdateInput(input, rpcContext('updateOverlay')))
  );
  safeHandle(IPC.setOverlayEnabled, (_event, overlayId: Id, enabled: boolean) => {
    expectRpcPrimitiveArgs(
      [overlayId, enabled],
      [{ name: 'overlayId', kind: 'string' }, { name: 'enabled', kind: 'boolean' }],
      rpcContext('setOverlayEnabled'),
    );
    return repo.setOverlayEnabled(overlayId, enabled);
  });
  safeHandle(IPC.deleteOverlay, (_event, overlayId: Id) => {
    expectRpcPrimitiveArgs([overlayId], [{ name: 'overlayId', kind: 'string' }], rpcContext('deleteOverlay'));
    return repo.deleteOverlay(overlayId);
  });
  safeHandle(IPC.createTheme, (_event, input: ThemeCreateInput) =>
    repo.createTheme(decodeThemeCreateInput(input, rpcContext('createTheme')))
  );
  safeHandle(IPC.updateTheme, (_event, input: ThemeUpdateInput) =>
    repo.updateTheme(decodeThemeUpdateInput(input, rpcContext('updateTheme')))
  );
  safeHandle(IPC.deleteTheme, (_event, themeId: Id) => {
    expectRpcPrimitiveArgs([themeId], [{ name: 'themeId', kind: 'string' }], rpcContext('deleteTheme'));
    return repo.deleteTheme(themeId);
  });
  safeHandle(IPC.applyThemeToDeckItem, (_event, themeId: Id, itemId: Id) => {
    expectRpcPrimitiveArgs(
      [themeId, itemId],
      [{ name: 'themeId', kind: 'string' }, { name: 'itemId', kind: 'string' }],
      rpcContext('applyThemeToDeckItem'),
    );
    return repo.applyThemeToDeckItem(themeId, itemId);
  });
  safeHandle(IPC.detachThemeFromDeckItem, (_event, itemId: Id) => {
    expectRpcPrimitiveArgs([itemId], [{ name: 'itemId', kind: 'string' }], rpcContext('detachThemeFromDeckItem'));
    return repo.detachThemeFromDeckItem(itemId);
  });
  safeHandle(IPC.syncThemeToLinkedDeckItems, (_event, themeId: Id) => {
    expectRpcPrimitiveArgs([themeId], [{ name: 'themeId', kind: 'string' }], rpcContext('syncThemeToLinkedDeckItems'));
    return repo.syncThemeToLinkedDeckItems(themeId);
  });
  safeHandle(IPC.applyThemeToOverlay, (_event, themeId: Id, overlayId: Id) => {
    expectRpcPrimitiveArgs(
      [themeId, overlayId],
      [{ name: 'themeId', kind: 'string' }, { name: 'overlayId', kind: 'string' }],
      rpcContext('applyThemeToOverlay'),
    );
    return repo.applyThemeToOverlay(themeId, overlayId);
  });
  safeHandle(IPC.createDeckItemWithTheme, (_event, input: DeckItemCreateWithThemeInput) =>
    repo.createDeckItemWithFirstSlide(decodeDeckItemCreateWithThemeInput(input, rpcContext('createDeckItemWithTheme')))
  );
  safeHandle(IPC.duplicateDeckItem, (_event, itemId: Id) => {
    expectRpcPrimitiveArgs([itemId], [{ name: 'itemId', kind: 'string' }], rpcContext('duplicateDeckItem'));
    return repo.duplicateDeckItem(itemId);
  });
  safeHandle(IPC.createStage, (_event, input: StageCreateInput) =>
    repo.createStage(decodeStageCreateInput(input, rpcContext('createStage')))
  );
  safeHandle(IPC.updateStage, (_event, input: StageUpdateInput) =>
    repo.updateStage(decodeStageUpdateInput(input, rpcContext('updateStage')))
  );
  safeHandle(IPC.deleteStage, (_event, stageId: Id) => {
    expectRpcPrimitiveArgs([stageId], [{ name: 'stageId', kind: 'string' }], rpcContext('deleteStage'));
    return repo.deleteStage(stageId);
  });
  safeHandle(IPC.duplicateStage, (_event, stageId: Id) => {
    expectRpcPrimitiveArgs([stageId], [{ name: 'stageId', kind: 'string' }], rpcContext('duplicateStage'));
    return repo.duplicateStage(stageId);
  });
  safeHandle(IPC.renameLibrary, (_event, id: Id, name: string) => {
    expectRpcPrimitiveArgs(
      [id, name],
      [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }],
      rpcContext('renameLibrary'),
    );
    return repo.renameLibrary(id, name);
  });
  safeHandle(IPC.renamePlaylist, (_event, id: Id, name: string) => {
    expectRpcPrimitiveArgs(
      [id, name],
      [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }],
      rpcContext('renamePlaylist'),
    );
    return repo.renamePlaylist(id, name);
  });
  safeHandle(IPC.renamePresentation, (_event, id: Id, title: string) => {
    expectRpcPrimitiveArgs(
      [id, title],
      [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }],
      rpcContext('renamePresentation'),
    );
    return repo.renamePresentation(id, title);
  });
  safeHandle(IPC.renameLyric, (_event, id: Id, title: string) => {
    expectRpcPrimitiveArgs(
      [id, title],
      [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }],
      rpcContext('renameLyric'),
    );
    return repo.renameLyric(id, title);
  });
  safeHandle(IPC.renameTalk, (_event, id: Id, title: string) => {
    expectRpcPrimitiveArgs(
      [id, title],
      [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }],
      rpcContext('renameTalk'),
    );
    return repo.renameTalk(id, title);
  });
  safeHandle(IPC.deleteLibrary, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteLibrary'));
    return repo.deleteLibrary(id);
  });
  safeHandle(IPC.deletePlaylist, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePlaylist'));
    return repo.deletePlaylist(id);
  });
  safeHandle(IPC.deletePlaylistGroup, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePlaylistGroup'));
    return repo.deletePlaylistGroup(id);
  });
  safeHandle(IPC.deletePresentation, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePresentation'));
    return repo.deletePresentation(id);
  });
  safeHandle(IPC.deleteLyric, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteLyric'));
    return repo.deleteLyric(id);
  });
  safeHandle(IPC.deleteTalk, (_event, id: Id) => {
    expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteTalk'));
    return repo.deleteTalk(id);
  });
  safeHandle(IPC.createCollection, (_event, input: CollectionCreateInput) =>
    repo.createCollection(decodeCollectionCreateInput(input, rpcContext('createCollection')))
  );
  safeHandle(IPC.renameCollection, (_event, input: CollectionRenameInput) =>
    repo.renameCollection(decodeCollectionRenameInput(input, rpcContext('renameCollection')))
  );
  safeHandle(IPC.deleteCollection, (_event, input: CollectionDeleteInput) =>
    repo.deleteCollection(decodeCollectionDeleteInput(input, rpcContext('deleteCollection')))
  );
  safeHandle(IPC.reorderCollections, (_event, input: CollectionReorderInput) =>
    repo.reorderCollections(decodeCollectionReorderInput(input, rpcContext('reorderCollections')))
  );
  safeHandle(IPC.setItemCollection, (_event, input: CollectionAssignmentInput) =>
    repo.setItemCollection(decodeCollectionAssignmentInput(input, rpcContext('setItemCollection')))
  );
  // Reuses the existing full project-backup validator (app/core/deck-bundles,
  // issue #145/#146) instead of re-implementing per-table validation here —
  // that would mirror internal domain shapes wholesale, which issue #150's
  // fixed decisions rule out. `app/database/store.ts`'s own
  // `restoreProjectBackup` also validates before mutating (it never touches
  // the live database before that check passes), but that validation lives
  // in the repository, not main; running it here too satisfies "validation
  // occurs in main before repository invocation" directly. The thrown
  // `ProjectBackupValidationError` is re-wrapped as a `CodecError` so its
  // message carries the same `[boundary/operation]` shape as every other
  // RPC failure.
  safeHandle(IPC.restoreProjectBackup, (_event, backup: ProjectBackup) => {
    try {
      validateProjectBackup(backup);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CodecError(rpcContext('restoreProjectBackup'), message);
    }
    return repo.restoreProjectBackup(backup);
  });
  safeHandle(IPC.setNdiOutputEnabled, (_event, name: NdiOutputName, enabled: boolean) => {
    const ctx = rpcContext('setNdiOutputEnabled');
    const validatedName = decodeNdiOutputName(name, ctx);
    expectRpcPrimitiveArgs([enabled], [{ name: 'enabled', kind: 'boolean' }], ctx);
    console.log(`[ipc] setNdiOutputEnabled ${validatedName}=${enabled}`);
    return ndiService.setOutputEnabled(validatedName, enabled);
  });
  safeHandle(IPC.getNdiOutputState, () => ndiService.getOutputState());
  safeHandle(IPC.getNdiOutputConfigs, () => ndiService.getOutputConfigs());
  safeHandle(IPC.updateNdiOutputConfig, (_event, name: NdiOutputName, config: Partial<NdiOutputConfig>) => {
    const ctx = rpcContext('updateNdiOutputConfig');
    const validatedName = decodeNdiOutputName(name, ctx);
    const validatedConfig = decodeNdiOutputConfigInput(config, rpcContext('updateNdiOutputConfig', 'config'));
    return ndiService.updateOutputConfig(validatedName, validatedConfig);
  });
  safeHandle(IPC.getNdiDiagnostics, (): NdiDiagnostics => ndiService.getDiagnostics());
  // Frame transport (issue #150 acceptance criterion): sendNdiFrame's inline
  // validation below is untouched — no codec, no refactor, exactly as it was.
  ipcMain.on(
    IPC.sendNdiFrame,
    (event, payload: {
      name: NdiOutputName;
      buffer: ArrayBuffer;
      width: number;
      height: number;
      telemetry?: NdiFrameTelemetry;
    }) => {
    const mainReceivedAtMs = Date.now();
    const ackName = payload?.name;
    try {
      assertTrustedIpcSender(event);
      if (!payload || typeof payload !== 'object') {
        throw new Error('NDI frame payload must be an object');
      }
      const { name, buffer, width, height, telemetry } = payload;
      if (!NDI_OUTPUT_NAMES.has(name)) {
        throw new Error(`Invalid NDI output name: ${String(name)}`);
      }
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error('NDI frame payload must include an ArrayBuffer');
      }
      const stampedTelemetry: NdiFrameTelemetry | undefined = telemetry
        ? { ...telemetry, mainReceivedAtMs }
        : undefined;
      ndiService.receiveFrame(name, new Uint8Array(buffer), width, height, stampedTelemetry);
    } catch (error) {
      console.error(`[IPC ${IPC.sendNdiFrame}]`, error);
    } finally {
      // Always ack so renderer back-pressure releases even after a rejected frame.
      if (ackName && !event.sender.isDestroyed()) {
        event.sender.send(NDI_EVENTS.frameAck, ackName);
      }
    }
    },
  );
  safeHandle(IPC.obsListLogSessions, () => listLogSessions());
  safeHandle(IPC.obsReadLogSession, (_event, filePath: string, offset: number, limit: number) => {
    expectRpcPrimitiveArgs(
      [filePath, offset, limit],
      [
        { name: 'filePath', kind: 'string' },
        { name: 'offset', kind: 'number' },
        { name: 'limit', kind: 'number' },
      ],
      rpcContext('obsReadLogSession'),
    );
    const cappedLimit = Math.max(1, Math.min(5000, Math.floor(limit)));
    return readLogSession(filePath, Math.floor(offset), cappedLimit);
  });
  safeHandle(IPC.obsGetCurrentLogPath, () => getLogFilePath());
  safeHandle(IPC.obsOpenLogFolder, async () => {
    const dir = getLogsDir();
    if (!dir) return;
    await shell.openPath(dir);
  });
  safeHandle(IPC.obsGetSystemMetrics, () => sampleSystemMetrics());
  // Frame transport (issue #150 acceptance criterion): sendNdiAudio's inline
  // validation below is untouched — no codec, no refactor, exactly as it was.
  ipcMain.on(
    IPC.sendNdiAudio,
    (event, payload: {
      name: NdiOutputName;
      buffer: ArrayBuffer;
      sampleRate: number;
      channels: number;
      samplesPerChannel: number;
    }) => {
      try {
        assertTrustedIpcSender(event);
        if (!payload || typeof payload !== 'object') {
          throw new Error('NDI audio payload must be an object');
        }
        const { name, buffer, sampleRate, channels, samplesPerChannel } = payload;
        if (!NDI_OUTPUT_NAMES.has(name)) {
          throw new Error(`Invalid NDI output name: ${String(name)}`);
        }
        if (!(buffer instanceof ArrayBuffer)) {
          throw new Error('NDI audio payload must include an ArrayBuffer');
        }
        ndiService.receiveAudioFrame(name, new Float32Array(buffer), sampleRate, channels, samplesPerChannel);
      } catch (error) {
        console.error(`[IPC ${IPC.sendNdiAudio}]`, error);
      }
    },
  );
};
