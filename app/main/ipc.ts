import { BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { CastRepository } from '@lumacast/persistence-sqlite';
import { validateProjectBackup } from '@lumacast/protocol';
import {
  IPC,
  NDI_EVENTS,
  NDI_FRAME_CHANNEL_NAMES,
  type DeckItemCreateWithThemeInput,
  type InlineWindowMenuBounds,
  type InlineWindowMenuItem,
  type RpcOperations,
} from '@lumacast/protocol';
import type { AppMenuState } from '@lumacast/commands';
import type { Id } from '@lumacast/kernel';
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
} from '@lumacast/protocol';
import type { AppSnapshot, DeckBundleBrokenReferenceDecision } from '@lumacast/protocol';
import type { NdiDiagnostics, NdiFrameTelemetry, NdiOutputConfig, NdiOutputName } from '@lumacast/protocol';
import type { ProjectBackup } from '@lumacast/protocol';
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
} from '@lumacast/protocol';
import { getInlineWindowMenuItems, popupInlineWindowMenu, updateApplicationMenu } from './application-menu';
import type { AppUpdater } from './app-updater';
import { readDeckBundleArchive, writeDeckBundleArchive } from './deck-bundle-archive';
import {
  getLogFilePath,
  getLogsDir,
  listLogSessions,
  readLogSession,
} from './logger';
import {
  maskManagedMediaResult,
  resolveManagedMedia,
  resolveManagedMediaArgs,
  revokeAllManagedMedia,
} from './media-capability';
import type { NdiServiceLike } from '@lumacast/engine';
import { sampleSystemMetrics } from '@lumacast/engine';
import { assertTrustedIpcSender } from './security';

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

// Registration is keyed by the canonical operation map (issue #152).
// `RpcChannelName` is every non-frame `IPC` key — the same set `RpcOperations`
// covers (`RpcOperationsMatchIpcChannels` in app/core/ipc.ts already proves
// those are identical) — and `RpcHandlerMap` requires exactly one property per
// name, typed against that operation's own input/output tuple via
// `RpcOperations`. Building `rpcHandlers` below as an object literal assigned
// to this type makes a missing operation a compile error ("Property '...' is
// missing in type ...") and a stray or renamed one a compile error too
// ("Object literal may only specify known properties") — the same
// excess-property checking that already makes `preload.ts`'s
// `satisfies MainApi` complete. Per-operation argument and return types are
// preserved on every entry; nothing here type-erases to `unknown[]`.
//
// This is a compile-time guarantee about the *shape* of `rpcHandlers`, not a
// guarantee that `registerRpcHandlers(rpcHandlers)` is actually called, or
// called exactly once, or that nothing else in this file calls
// `ipcMain.handle` directly outside this path. Those are runtime properties,
// covered by `app/main/ipc-registration.test.ts`, which asserts the exact set
// of channels the mocked `ipcMain.handle` receives against `IPC`.
type RpcChannelName = keyof RpcOperations;

type RpcHandlerFn<K extends RpcChannelName> = (
  event: IpcMainInvokeEvent,
  ...args: RpcOperations[K]['input']
) => RpcOperations[K]['output'] | Promise<RpcOperations[K]['output']>;

type RpcHandlerMap = { [K in RpcChannelName]: RpcHandlerFn<K> };

const NDI_FRAME_CHANNEL_NAME_SET = new Set<string>(NDI_FRAME_CHANNEL_NAMES);

/**
 * Registers every operation in `handlers` through `safeHandle`, driven by the
 * `IPC` map rather than a hand-maintained sequence of `safeHandle(IPC.x, ...)`
 * calls. Iterating `IPC` (skipping the two frame channels) rather than
 * `Object.keys(handlers)` means a rogue registration under a channel string
 * absent from `IPC` is structurally impossible from inside this function.
 * Frame channels are excluded by construction — `NDI_FRAME_CHANNEL_NAME_SET`
 * is checked before dispatch — so `sendNdiFrame`/`sendNdiAudio` can never
 * reach this path; they are registered directly via `ipcMain.on` below,
 * exactly as before.
 *
 * The cast to `AnyRpcHandler` below is deliberate, narrow type-erasure at the
 * dispatch boundary only: by this point `rpcHandlers` has already been
 * type-checked in full against `RpcHandlerMap` at its construction site, so
 * nothing here can compile with a missing or mistyped entry. The alternative
 * — keeping the precise per-key type through this loop — would require
 * TypeScript to unify a 107-member union of unrelated function signatures,
 * which is neither possible nor meaningful once the per-operation shape has
 * already been verified.
 */
type AnyRpcHandler = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;

// Operations that resolve their own managed-media arguments and must therefore
// see the raw capability id rather than the pre-resolved stored source (issue
// #159). `getAudioCoverArt` is the only one: it asserts the *declared use* of
// the id it is given ('audio'), which the generic argument transform
// deliberately does not do — a background or element may legitimately
// reference any granted media, while cover art may not.
const SELF_RESOLVING_MEDIA_OPERATIONS: ReadonlySet<RpcChannelName> = new Set<RpcChannelName>([
  'getAudioCoverArt',
]);

// The managed-media translation boundary (issue #159): every operation's
// arguments have managed media ids resolved back to stored sources on the way
// in, and every result has stored sources replaced by managed ids on the way
// out. Wrapping here rather than per handler means no operation can be added
// that accidentally hands the renderer a filesystem path, and no repository
// method has to know that managed ids exist at all.
function registerRpcHandlers(handlers: RpcHandlerMap): void {
  for (const key of Object.keys(IPC) as (keyof typeof IPC)[]) {
    if (NDI_FRAME_CHANNEL_NAME_SET.has(key)) continue;
    const operation = key as RpcChannelName;
    const handler = handlers[operation] as AnyRpcHandler;
    const resolvesOwnMedia = SELF_RESOLVING_MEDIA_OPERATIONS.has(operation);

    safeHandle(IPC[key], async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const resolvedArgs = resolvesOwnMedia ? args : resolveManagedMediaArgs(args);
      const result = await handler(event, ...(resolvedArgs as never[]));
      return maskManagedMediaResult(result);
    });
  }
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

  // Every non-frame operation is authored here, once, as a single object
  // literal typed against `RpcHandlerMap` (see the type above `safeHandle`).
  // That assignment is where the compile-time completeness guarantee lives:
  // remove an entry, misspell one, or add one that isn't in the canonical
  // map, and this fails to compile before `registerRpcHandlers` ever runs.
  const rpcHandlers: RpcHandlerMap = {
    readClipboardText: () => clipboard.readText(),
    writeClipboardText: (_event, text: string) => {
      expectRpcPrimitiveArgs([text], [{ name: 'text', kind: 'string' }], rpcContext('writeClipboardText'));
      clipboard.writeText(text);
    },
    getInlineWindowMenuItems: (): InlineWindowMenuItem[] => getInlineWindowMenuItems(),
    popupInlineWindowMenu: async (event, menuId: string, bounds: InlineWindowMenuBounds) => {
      const ctx = rpcContext('popupInlineWindowMenu');
      expectRpcPrimitiveArgs([menuId], [{ name: 'menuId', kind: 'string' }], ctx);
      const validatedBounds = decodeInlineWindowMenuBounds(bounds, rpcContext('popupInlineWindowMenu', 'bounds'));
      const browserWindow = getDialogWindow(event);
      if (!browserWindow) return;
      await popupInlineWindowMenu(menuId, browserWindow, validatedBounds);
    },
    // updateAppMenuState is intentionally left without a codec: its ~20
    // boolean fields only drive the native Electron menu's enabled/checked
    // state, not any repository or filesystem call — a malformed value at
    // worst produces a stale menu item, not data corruption or a security
    // bypass. See the issue #150 report's cut line for the full reasoning.
    updateAppMenuState: (event, state: AppMenuState) => {
      const browserWindow = getDialogWindow(event);
      updateApplicationMenu(browserWindow, state);
    },
    checkForAppUpdates: async (event, manual?: boolean) => {
      expectRpcPrimitiveArgs([manual], [{ name: 'manual', kind: 'optionalBoolean' }], rpcContext('checkForAppUpdates'));
      const browserWindow = getDialogWindow(event);
      await appUpdater.checkForUpdates(Boolean(manual), browserWindow);
    },
    getSnapshot: () => repo.getSnapshot(),
    restoreFromSnapshot: (_event, snapshot: AppSnapshot) =>
      repo.restoreFromSnapshot(decodeAppSnapshotShape(snapshot, rpcContext('restoreFromSnapshot'))),
    chooseDeckBundleExportPath: async (event, suggestedName: string) => {
      expectRpcPrimitiveArgs([suggestedName], [{ name: 'suggestedName', kind: 'string' }], rpcContext('chooseDeckBundleExportPath'));
      const result = await showSaveDialogForEvent(event, {
        title: 'Export Deck Bundle',
        defaultPath: `${sanitizeSuggestedBundleName(suggestedName)}.cst`,
        filters: [{ name: 'CST Bundle', extensions: ['cst'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      return ensureBundleExtension(result.filePath);
    },
    chooseDeckBundleImportPath: async (event) => {
      const result = await showOpenDialogForEvent(event, {
        title: 'Import Deck Bundle',
        filters: [{ name: 'CST Bundle', extensions: ['cst'] }],
        properties: ['openFile'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    chooseImportReplacementMediaPath: async (event) => {
      const result = await showOpenDialogForEvent(event, {
        title: 'Choose Replacement Media',
        filters: [{ name: 'Media', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v'] }],
        properties: ['openFile'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    exportDeckBundle: async (_event, itemIds: Id[], filePath: string, options?: DeckBundleExportOptions) => {
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
    },
    inspectImportBundle: async (_event, filePath: string) => {
      expectRpcPrimitiveArgs([filePath], [{ name: 'filePath', kind: 'string' }], rpcContext('inspectImportBundle'));
      const bundle = await readDeckBundleArchive(filePath);
      return repo.inspectImportBundle(bundle);
    },
    finalizeImportBundle: async (_event, filePath: string, decisions: DeckBundleBrokenReferenceDecision[]) => {
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
    },
    listCues: () => repo.listCues(),
    createCue: (_event, input: CueCreateInput) =>
      repo.createCue(decodeCueCreateInput(input, rpcContext('createCue'))),
    updateCue: (_event, input: CueUpdateInput) =>
      repo.updateCue(decodeCueUpdateInput(input, rpcContext('updateCue'))),
    deleteCue: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteCue'));
      return repo.deleteCue(id);
    },
    listMacros: () => repo.listMacros(),
    createMacro: (_event, input: MacroCreateInput) =>
      repo.createMacro(decodeMacroCreateInput(input, rpcContext('createMacro'))),
    updateMacro: (_event, input: MacroUpdateInput) =>
      repo.updateMacro(decodeMacroUpdateInput(input, rpcContext('updateMacro'))),
    deleteMacro: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteMacro'));
      return repo.deleteMacro(id);
    },
    listTriggerBindings: () => repo.listTriggerBindings(),
    createTriggerBinding: (_event, input: TriggerBindingCreateInput) =>
      repo.createTriggerBinding(decodeTriggerBindingCreateInput(input, rpcContext('createTriggerBinding'))),
    deleteTriggerBinding: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteTriggerBinding'));
      return repo.deleteTriggerBinding(id);
    },
    createLibrary: (_event, name: string) => {
      expectRpcPrimitiveArgs([name], [{ name: 'name', kind: 'string' }], rpcContext('createLibrary'));
      return repo.createLibrary(name);
    },
    createPlaylist: (_event, libraryId: Id, name: string) => {
      expectRpcPrimitiveArgs(
        [libraryId, name],
        [{ name: 'libraryId', kind: 'string' }, { name: 'name', kind: 'string' }],
        rpcContext('createPlaylist'),
      );
      return repo.createPlaylist(libraryId, name);
    },
    createPlaylistGroup: (_event, playlistId: Id, name: string) => {
      expectRpcPrimitiveArgs(
        [playlistId, name],
        [{ name: 'playlistId', kind: 'string' }, { name: 'name', kind: 'string' }],
        rpcContext('createPlaylistGroup'),
      );
      return repo.createPlaylistGroup(playlistId, name);
    },
    renamePlaylistGroup: (_event, id: Id, name: string) => {
      expectRpcPrimitiveArgs(
        [id, name],
        [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }],
        rpcContext('renamePlaylistGroup'),
      );
      return repo.renamePlaylistGroup(id, name);
    },
    setPlaylistGroupColor: (_event, id: Id, colorKey: string | null) => {
      expectRpcPrimitiveArgs(
        [id, colorKey],
        [{ name: 'id', kind: 'string' }, { name: 'colorKey', kind: 'nullableString' }],
        rpcContext('setPlaylistGroupColor'),
      );
      return repo.setPlaylistGroupColor(id, colorKey);
    },
    movePlaylist: (_event, id: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [id, direction],
        [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('movePlaylist'),
      );
      return repo.movePlaylist(id, direction);
    },
    addDeckItemToGroup: (_event, playlistId: Id, groupId: Id, itemId: Id) => {
      expectRpcPrimitiveArgs(
        [playlistId, groupId, itemId],
        [{ name: 'playlistId', kind: 'string' }, { name: 'groupId', kind: 'string' }, { name: 'itemId', kind: 'string' }],
        rpcContext('addDeckItemToGroup'),
      );
      return repo.addDeckItemToGroup(playlistId, groupId, itemId);
    },
    moveDeckItemToGroup: (_event, playlistId: Id, itemId: Id, groupId: Id | null) => {
      expectRpcPrimitiveArgs(
        [playlistId, itemId, groupId],
        [{ name: 'playlistId', kind: 'string' }, { name: 'itemId', kind: 'string' }, { name: 'groupId', kind: 'nullableString' }],
        rpcContext('moveDeckItemToGroup'),
      );
      return repo.moveDeckItemToGroup(playlistId, itemId, groupId);
    },
    movePlaylistEntryToGroup: (_event, entryId: Id, groupId: Id | null) => {
      expectRpcPrimitiveArgs(
        [entryId, groupId],
        [{ name: 'entryId', kind: 'string' }, { name: 'groupId', kind: 'nullableString' }],
        rpcContext('movePlaylistEntryToGroup'),
      );
      return repo.movePlaylistEntryToGroup(entryId, groupId);
    },
    movePlaylistEntry: (_event, entryId: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [entryId, direction],
        [{ name: 'entryId', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('movePlaylistEntry'),
      );
      return repo.movePlaylistEntry(entryId, direction);
    },
    moveDeckItem: (_event, id: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [id, direction],
        [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('moveDeckItem'),
      );
      return repo.moveDeckItem(id, direction);
    },
    createPresentation: (_event, title: string) => {
      expectRpcPrimitiveArgs([title], [{ name: 'title', kind: 'string' }], rpcContext('createPresentation'));
      return repo.createPresentation(title);
    },
    createLyric: (_event, title: string) => {
      expectRpcPrimitiveArgs([title], [{ name: 'title', kind: 'string' }], rpcContext('createLyric'));
      return repo.createLyric(title);
    },
    createTalk: (_event, title: string) => {
      expectRpcPrimitiveArgs([title], [{ name: 'title', kind: 'string' }], rpcContext('createTalk'));
      return repo.createTalk(title);
    },
    createSlide: (_event, input: SlideCreateInput) =>
      repo.createSlide(decodeSlideCreateInput(input, rpcContext('createSlide'))),
    duplicateSlide: (_event, slideId: Id) => {
      expectRpcPrimitiveArgs([slideId], [{ name: 'slideId', kind: 'string' }], rpcContext('duplicateSlide'));
      return repo.duplicateSlide(slideId);
    },
    deleteSlide: (_event, slideId: Id) => {
      expectRpcPrimitiveArgs([slideId], [{ name: 'slideId', kind: 'string' }], rpcContext('deleteSlide'));
      return repo.deleteSlide(slideId);
    },
    updateSlideNotes: (_event, input: SlideNotesUpdateInput) =>
      repo.updateSlideNotes(decodeSlideNotesUpdateInput(input, rpcContext('updateSlideNotes'))),
    updateSlideBackground: (_event, input: SlideBackgroundUpdateInput) =>
      repo.updateSlideBackground(decodeSlideBackgroundUpdateInput(input, rpcContext('updateSlideBackground'))),
    createTalkScriptBlock: (_event, input: TalkScriptBlockCreateInput) =>
      repo.createTalkScriptBlock(decodeTalkScriptBlockCreateInput(input, rpcContext('createTalkScriptBlock'))),
    updateTalkScriptBlock: (_event, input: TalkScriptBlockUpdateInput) =>
      repo.updateTalkScriptBlock(decodeTalkScriptBlockUpdateInput(input, rpcContext('updateTalkScriptBlock'))),
    deleteTalkScriptBlock: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteTalkScriptBlock'));
      return repo.deleteTalkScriptBlock(id);
    },
    setTalkScriptBlockOrder: (_event, input: TalkScriptBlockOrderUpdateInput) =>
      repo.setTalkScriptBlockOrder(decodeTalkScriptBlockOrderUpdateInput(input, rpcContext('setTalkScriptBlockOrder'))),
    setSlideOrder: (_event, input: SlideOrderUpdateInput) =>
      repo.setSlideOrder(decodeSlideOrderUpdateInput(input, rpcContext('setSlideOrder'))),
    setLibraryOrder: (_event, libraryId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [libraryId, newOrder],
        [{ name: 'libraryId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setLibraryOrder'),
      );
      return repo.setLibraryOrder(libraryId, newOrder);
    },
    setPlaylistOrder: (_event, playlistId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [playlistId, newOrder],
        [{ name: 'playlistId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setPlaylistOrder'),
      );
      return repo.setPlaylistOrder(playlistId, newOrder);
    },
    setPlaylistGroupOrder: (_event, groupId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [groupId, newOrder],
        [{ name: 'groupId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setPlaylistGroupOrder'),
      );
      return repo.setPlaylistGroupOrder(groupId, newOrder);
    },
    movePlaylistEntryTo: (_event, entryId: Id, groupId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [entryId, groupId, newOrder],
        [{ name: 'entryId', kind: 'string' }, { name: 'groupId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('movePlaylistEntryTo'),
      );
      return repo.movePlaylistEntryTo(entryId, groupId, newOrder);
    },
    createElement: (_event, input: ElementCreateInput) =>
      repo.createElement(decodeElementCreateInput(input, rpcContext('createElement'))),
    createElementsBatch: (_event, inputs: ElementCreateInput[]) => {
      const ctx = rpcContext('createElementsBatch');
      if (!Array.isArray(inputs)) throw new CodecError(ctx, `inputs must be an array, got ${typeof inputs}`);
      const validated = inputs.map((input, index) =>
        decodeElementCreateInput(input, rpcContext('createElementsBatch', `inputs[${index}]`))
      );
      return repo.createElementsBatch(validated);
    },
    updateElement: (_event, input: ElementUpdateInput) =>
      repo.updateElement(decodeElementUpdateInput(input, rpcContext('updateElement'))),
    updateElementsBatch: (_event, inputs: ElementUpdateInput[]) => {
      const ctx = rpcContext('updateElementsBatch');
      if (!Array.isArray(inputs)) throw new CodecError(ctx, `inputs must be an array, got ${typeof inputs}`);
      const validated = inputs.map((input, index) =>
        decodeElementUpdateInput(input, rpcContext('updateElementsBatch', `inputs[${index}]`))
      );
      return repo.updateElementsBatch(validated);
    },
    deleteElement: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteElement'));
      return repo.deleteElement(id);
    },
    deleteElementsBatch: (_event, ids: Id[]) => {
      expectRpcPrimitiveArgs([ids], [{ name: 'ids', kind: 'stringArray' }], rpcContext('deleteElementsBatch'));
      return repo.deleteElementsBatch(ids);
    },
    createMediaAsset: (_event, asset: MediaAssetCreateInput) =>
      repo.createMediaAsset(decodeMediaAssetCreateInput(asset, rpcContext('createMediaAsset'))),
    deleteMediaAsset: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteMediaAsset'));
      return repo.deleteMediaAsset(id);
    },
    updateMediaAssetSrc: (_event, id: Id, src: string) => {
      expectRpcPrimitiveArgs(
        [id, src],
        [{ name: 'id', kind: 'string' }, { name: 'src', kind: 'string' }],
        rpcContext('updateMediaAssetSrc'),
      );
      return repo.updateMediaAssetSrc(id, src);
    },
    // `src` is a managed media id (issue #159), resolved here with an explicit
    // declared use: cover art is only ever read off a grant issued for audio.
    // An unknown, revoked, malformed or wrong-use reference returns null — the
    // same "no cover art" result an unreadable file already produced, with no
    // path and no reason disclosed to the renderer.
    getAudioCoverArt: async (_event, src: string) => {
      expectRpcPrimitiveArgs([src], [{ name: 'src', kind: 'string' }], rpcContext('getAudioCoverArt'));
      const resolved = resolveManagedMedia(src, 'audio');
      if (!resolved.ok) return null;
      const filePath = resolved.filePath;
      try {
        const { parseFile } = await import('music-metadata');
        const metadata = await parseFile(filePath);
        const picture = metadata.common.picture?.[0];
        if (!picture) return null;
        return `data:${picture.format};base64,${Buffer.from(picture.data).toString('base64')}`;
      } catch {
        return null;
      }
    },
    createOverlay: (_event, overlay: OverlayCreateInput) =>
      repo.createOverlay(decodeOverlayCreateInput(overlay, rpcContext('createOverlay'))),
    updateOverlay: (_event, input: OverlayUpdateInput) =>
      repo.updateOverlay(decodeOverlayUpdateInput(input, rpcContext('updateOverlay'))),
    setOverlayEnabled: (_event, overlayId: Id, enabled: boolean) => {
      expectRpcPrimitiveArgs(
        [overlayId, enabled],
        [{ name: 'overlayId', kind: 'string' }, { name: 'enabled', kind: 'boolean' }],
        rpcContext('setOverlayEnabled'),
      );
      return repo.setOverlayEnabled(overlayId, enabled);
    },
    deleteOverlay: (_event, overlayId: Id) => {
      expectRpcPrimitiveArgs([overlayId], [{ name: 'overlayId', kind: 'string' }], rpcContext('deleteOverlay'));
      return repo.deleteOverlay(overlayId);
    },
    createTheme: (_event, input: ThemeCreateInput) =>
      repo.createTheme(decodeThemeCreateInput(input, rpcContext('createTheme'))),
    updateTheme: (_event, input: ThemeUpdateInput) =>
      repo.updateTheme(decodeThemeUpdateInput(input, rpcContext('updateTheme'))),
    deleteTheme: (_event, themeId: Id) => {
      expectRpcPrimitiveArgs([themeId], [{ name: 'themeId', kind: 'string' }], rpcContext('deleteTheme'));
      return repo.deleteTheme(themeId);
    },
    applyThemeToDeckItem: (_event, themeId: Id, itemId: Id) => {
      expectRpcPrimitiveArgs(
        [themeId, itemId],
        [{ name: 'themeId', kind: 'string' }, { name: 'itemId', kind: 'string' }],
        rpcContext('applyThemeToDeckItem'),
      );
      return repo.applyThemeToDeckItem(themeId, itemId);
    },
    detachThemeFromDeckItem: (_event, itemId: Id) => {
      expectRpcPrimitiveArgs([itemId], [{ name: 'itemId', kind: 'string' }], rpcContext('detachThemeFromDeckItem'));
      return repo.detachThemeFromDeckItem(itemId);
    },
    syncThemeToLinkedDeckItems: (_event, themeId: Id) => {
      expectRpcPrimitiveArgs([themeId], [{ name: 'themeId', kind: 'string' }], rpcContext('syncThemeToLinkedDeckItems'));
      return repo.syncThemeToLinkedDeckItems(themeId);
    },
    applyThemeToOverlay: (_event, themeId: Id, overlayId: Id) => {
      expectRpcPrimitiveArgs(
        [themeId, overlayId],
        [{ name: 'themeId', kind: 'string' }, { name: 'overlayId', kind: 'string' }],
        rpcContext('applyThemeToOverlay'),
      );
      return repo.applyThemeToOverlay(themeId, overlayId);
    },
    createDeckItemWithTheme: (_event, input: DeckItemCreateWithThemeInput) =>
      repo.createDeckItemWithFirstSlide(decodeDeckItemCreateWithThemeInput(input, rpcContext('createDeckItemWithTheme'))),
    duplicateDeckItem: (_event, itemId: Id) => {
      expectRpcPrimitiveArgs([itemId], [{ name: 'itemId', kind: 'string' }], rpcContext('duplicateDeckItem'));
      return repo.duplicateDeckItem(itemId);
    },
    createStage: (_event, input: StageCreateInput) =>
      repo.createStage(decodeStageCreateInput(input, rpcContext('createStage'))),
    updateStage: (_event, input: StageUpdateInput) =>
      repo.updateStage(decodeStageUpdateInput(input, rpcContext('updateStage'))),
    deleteStage: (_event, stageId: Id) => {
      expectRpcPrimitiveArgs([stageId], [{ name: 'stageId', kind: 'string' }], rpcContext('deleteStage'));
      return repo.deleteStage(stageId);
    },
    duplicateStage: (_event, stageId: Id) => {
      expectRpcPrimitiveArgs([stageId], [{ name: 'stageId', kind: 'string' }], rpcContext('duplicateStage'));
      return repo.duplicateStage(stageId);
    },
    renameLibrary: (_event, id: Id, name: string) => {
      expectRpcPrimitiveArgs(
        [id, name],
        [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }],
        rpcContext('renameLibrary'),
      );
      return repo.renameLibrary(id, name);
    },
    renamePlaylist: (_event, id: Id, name: string) => {
      expectRpcPrimitiveArgs(
        [id, name],
        [{ name: 'id', kind: 'string' }, { name: 'name', kind: 'string' }],
        rpcContext('renamePlaylist'),
      );
      return repo.renamePlaylist(id, name);
    },
    renamePresentation: (_event, id: Id, title: string) => {
      expectRpcPrimitiveArgs(
        [id, title],
        [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }],
        rpcContext('renamePresentation'),
      );
      return repo.renamePresentation(id, title);
    },
    renameLyric: (_event, id: Id, title: string) => {
      expectRpcPrimitiveArgs(
        [id, title],
        [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }],
        rpcContext('renameLyric'),
      );
      return repo.renameLyric(id, title);
    },
    renameTalk: (_event, id: Id, title: string) => {
      expectRpcPrimitiveArgs(
        [id, title],
        [{ name: 'id', kind: 'string' }, { name: 'title', kind: 'string' }],
        rpcContext('renameTalk'),
      );
      return repo.renameTalk(id, title);
    },
    deleteLibrary: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteLibrary'));
      return repo.deleteLibrary(id);
    },
    deletePlaylist: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePlaylist'));
      return repo.deletePlaylist(id);
    },
    deletePlaylistGroup: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePlaylistGroup'));
      return repo.deletePlaylistGroup(id);
    },
    deletePresentation: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePresentation'));
      return repo.deletePresentation(id);
    },
    deleteLyric: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteLyric'));
      return repo.deleteLyric(id);
    },
    deleteTalk: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteTalk'));
      return repo.deleteTalk(id);
    },
    createCollection: (_event, input: CollectionCreateInput) =>
      repo.createCollection(decodeCollectionCreateInput(input, rpcContext('createCollection'))),
    renameCollection: (_event, input: CollectionRenameInput) =>
      repo.renameCollection(decodeCollectionRenameInput(input, rpcContext('renameCollection'))),
    deleteCollection: (_event, input: CollectionDeleteInput) =>
      repo.deleteCollection(decodeCollectionDeleteInput(input, rpcContext('deleteCollection'))),
    reorderCollections: (_event, input: CollectionReorderInput) =>
      repo.reorderCollections(decodeCollectionReorderInput(input, rpcContext('reorderCollections'))),
    setItemCollection: (_event, input: CollectionAssignmentInput) =>
      repo.setItemCollection(decodeCollectionAssignmentInput(input, rpcContext('setItemCollection'))),
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
    restoreProjectBackup: (_event, backup: ProjectBackup) => {
      try {
        validateProjectBackup(backup);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CodecError(rpcContext('restoreProjectBackup'), message);
      }
      const result = repo.restoreProjectBackup(backup);
      // Recovery swaps the entire database out from under the renderer, so
      // every managed-media capability minted from the pre-recovery project
      // stops resolving here (issue #159). The result this returns is masked
      // on the way out, which re-mints grants for the restored project — the
      // renderer's new snapshot is complete, and any id it still holds from
      // the replaced project now fails as `revoked-id`.
      revokeAllManagedMedia();
      return result;
    },
    setNdiOutputEnabled: (_event, name: NdiOutputName, enabled: boolean) => {
      const ctx = rpcContext('setNdiOutputEnabled');
      const validatedName = decodeNdiOutputName(name, ctx);
      expectRpcPrimitiveArgs([enabled], [{ name: 'enabled', kind: 'boolean' }], ctx);
      console.log(`[ipc] setNdiOutputEnabled ${validatedName}=${enabled}`);
      return ndiService.setOutputEnabled(validatedName, enabled);
    },
    getNdiOutputState: () => ndiService.getOutputState(),
    getNdiOutputConfigs: () => ndiService.getOutputConfigs(),
    updateNdiOutputConfig: (_event, name: NdiOutputName, config: Partial<NdiOutputConfig>) => {
      const ctx = rpcContext('updateNdiOutputConfig');
      const validatedName = decodeNdiOutputName(name, ctx);
      const validatedConfig = decodeNdiOutputConfigInput(config, rpcContext('updateNdiOutputConfig', 'config'));
      return ndiService.updateOutputConfig(validatedName, validatedConfig);
    },
    getNdiDiagnostics: (): NdiDiagnostics => ndiService.getDiagnostics(),
    obsListLogSessions: () => listLogSessions(),
    obsReadLogSession: (_event, filePath: string, offset: number, limit: number) => {
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
    },
    obsGetCurrentLogPath: () => getLogFilePath(),
    obsOpenLogFolder: async () => {
      const dir = getLogsDir();
      if (!dir) return;
      await shell.openPath(dir);
    },
    obsGetSystemMetrics: () => sampleSystemMetrics(),
  };
  registerRpcHandlers(rpcHandlers);

  // Frame transport (issue #150 acceptance criterion): sendNdiFrame's inline
  // validation below is untouched — no codec, no refactor, exactly as it was.
  // Registered directly via `ipcMain.on`, never through `registerRpcHandlers`
  // (fixed decision: frame channels never go through the RPC helper).
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
  // Frame transport (issue #150 acceptance criterion): sendNdiAudio's inline
  // validation below is untouched — no codec, no refactor, exactly as it was.
  // Registered directly via `ipcMain.on`, never through `registerRpcHandlers`
  // (fixed decision: frame channels never go through the RPC helper).
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
