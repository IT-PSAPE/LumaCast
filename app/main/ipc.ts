import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell, type IpcMainInvokeEvent, type MessagePortMain } from 'electron';
import { MEDIA_DERIVATIVE_EVENTS, MEDIA_LIBRARY_EVENTS, PERSISTENCE_CHANNELS, PERSISTENCE_EVENTS, validateProjectBackupAsync } from '@lumacast/protocol';
import {
  IPC,
  NDI_EVENTS,
  NDI_FRAME_CHANNEL_NAMES,
  NDI_FRAME_TRANSPORT_PORT_CHANNEL,
  NDI_FRAME_TRANSPORT_VERSION,
  NDI_FRAME_TRANSPORT_WINDOW_MESSAGE,
  type InlineWindowMenuBounds,
  type InlineWindowMenuItem,
  type ItemCreateInput,
  type ItemDuplicateInput,
  type PersistenceProgress,
  type RpcOperations,
} from '@lumacast/protocol';
import type { AppMenuState } from '@lumacast/commands';
import type { Id } from '@lumacast/kernel';
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
} from '@lumacast/protocol';
import type { AppSnapshot, BundleBrokenReferenceDecision } from '@lumacast/protocol';
import type { NdiDiagnostics, NdiFrameTelemetry, NdiOutputConfig, NdiOutputName } from '@lumacast/protocol';
import type { ProjectBackup } from '@lumacast/protocol';
import {
  CodecError,
  RPC_MOVE_DIRECTIONS,
  expectRpcPrimitiveArgs,
  decodeAppSnapshotShape,
  decodeSnapshotPatchShape,
  decodeCueCreateInput,
  decodeCueUpdateInput,
  decodeBundleBrokenReferenceDecision,
  decodeBundleExportOptions,
  decodeItemCreateInput,
  decodeItemDuplicateInput,
  decodeElementCreateInput,
  decodeElementUpdateInput,
  decodeInlineWindowMenuBounds,
  decodeMacroCreateInput,
  decodeMacroUpdateInput,
  decodeMediaAssetCreateInput,
  sanitizeNdiFrameTelemetry,
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
import {
  MediaDerivativeService,
  fitWithinBounds,
  validateEncodedImageForNativeDecode,
  MAX_TRUSTED_EMBEDDED_IMAGE_BYTES,
  MAX_EMBEDDED_IMAGE_OUTPUT_BYTES,
} from './media-derivatives';
import { MediaLibraryService } from './media-library';
import type { NdiServiceLike } from '@lumacast/engine';
import { sampleSystemMetrics } from '@lumacast/engine';
import { assertTrustedIpcSender } from './security';
import type { PersistenceServiceLike } from './persistence/persistence-service-proxy';

const SNAPSHOT_HEARTBEAT_INTERVAL_MS = 5_000;

// The three ipcMain.on frame channels near the bottom of this file are the
// only consumers of this set; their inline
// validation is deliberately left untouched by issue #150 (frame transport
// is out of scope), so this stays exactly as it was rather than being
// folded into the codec-based `decodeNdiOutputName` used by the RPC
// handlers below.
const NDI_OUTPUT_NAMES = new Set<NdiOutputName>(['audience', 'stage']);

/** Context for the renderer-originated RPC codecs in app/contracts/codecs.ts (issue #150). */
function rpcContext(operation: string, path = ''): CodecContext {
  return { boundary: 'rpc', operation, path };
}

const ITEM_TYPES = ['presentation', 'lyric', 'talk'] as const satisfies readonly ItemType[];
const THEME_OWNER_TYPES = ['presentation', 'lyric', 'talk', 'overlay'] as const satisfies readonly ThemeOwnerType[];

function childContext(context: CodecContext, field: string): CodecContext {
  return { ...context, path: context.path ? `${context.path}.${field}` : field };
}

interface MediaDerivativePatchReconcilePlan {
  invalidateIds: string[];
  scheduleIds: string[];
}

async function buildMediaDerivativePatchReconcilePlan(
  repo: PersistenceServiceLike,
  patch: import('@lumacast/protocol').SnapshotPatch,
): Promise<MediaDerivativePatchReconcilePlan> {
  const upserts = patch.upserts.mediaAssets ?? [];
  const deletedIds = new Set(patch.deletes.mediaAssets ?? []);
  if (upserts.length === 0 && deletedIds.size === 0) {
    return { invalidateIds: [], scheduleIds: [] };
  }

  const currentById = new Map<string, Awaited<ReturnType<PersistenceServiceLike['getMediaAsset']>>>();
  for (const asset of upserts) {
    if (currentById.has(asset.id)) continue;
    currentById.set(asset.id, await repo.getMediaAsset(asset.id));
  }

  const invalidateIds = new Set<string>(deletedIds);
  const scheduleIds = new Set<string>();
  for (const asset of upserts) {
    const current = currentById.get(asset.id);
    if (!current) {
      scheduleIds.add(asset.id);
      continue;
    }
    if (current.src !== asset.src) {
      invalidateIds.add(asset.id);
      scheduleIds.add(asset.id);
    }
  }

  return {
    invalidateIds: [...invalidateIds],
    scheduleIds: [...scheduleIds],
  };
}

function executeMediaDerivativePatchReconcilePlan(
  plan: MediaDerivativePatchReconcilePlan,
  mediaDerivatives: MediaDerivativeService,
): void {
  mediaDerivatives.invalidateMany(plan.invalidateIds);
  mediaDerivatives.scheduleBatch(plan.scheduleIds);
}

function reconcileMediaDerivativeSnapshotChange(
  previous: AppSnapshot,
  next: AppSnapshot,
  mediaDerivatives: MediaDerivativeService,
): void {
  const previousById = new Map(previous.mediaAssets.map((asset) => [asset.id, asset]));
  const nextById = new Map(next.mediaAssets.map((asset) => [asset.id, asset]));
  const ids = new Set<string>([...previousById.keys(), ...nextById.keys()]);
  const invalidateIds = new Set<string>();
  const scheduleIds = new Set<string>();
  for (const id of ids) {
    const before = previousById.get(id);
    const after = nextById.get(id);
    if (!after) {
      invalidateIds.add(id);
      continue;
    }
    if (!before) {
      scheduleIds.add(id);
      continue;
    }
    if (before.src !== after.src) {
      invalidateIds.add(id);
      scheduleIds.add(id);
    }
  }
  mediaDerivatives.invalidateMany([...invalidateIds]);
  mediaDerivatives.scheduleBatch([...scheduleIds]);
}

// #219 item-model refactor: `ItemRef` (decision D1's typed `{ type, id }`
// reference) crosses the wire on `applyThemeToItem`, `detachThemeFromItem`,
// and `addItemToPlaylist`, but is structural rather than a named RPC input
// type in @lumacast/protocol's rpc-inputs.ts — so unlike every other
// structured argument in this file, its codec lives here rather than being
// imported from `@lumacast/protocol`.
function decodeItemRef(value: unknown, context: CodecContext): ItemRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CodecError(context, `must be an object, got ${value === null ? 'null' : typeof value}`);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'type' && key !== 'id') throw new CodecError(childContext(context, key), 'unknown field');
  }
  const { type } = record;
  if (typeof type !== 'string' || !(ITEM_TYPES as readonly string[]).includes(type)) {
    throw new CodecError(childContext(context, 'type'), `must be one of [${ITEM_TYPES.join(', ')}], got ${JSON.stringify(type)}`);
  }
  const { id } = record;
  if (typeof id !== 'string') {
    throw new CodecError(childContext(context, 'id'), `must be a string, got ${JSON.stringify(id)}`);
  }
  return { type: type as ItemType, id };
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
 * calls. Iterating `IPC` (skipping the three frame/control channels) rather than
 * `Object.keys(handlers)` means a rogue registration under a channel string
 * absent from `IPC` is structurally impossible from inside this function.
 * Frame channels are excluded by construction — `NDI_FRAME_CHANNEL_NAME_SET`
 * is checked before dispatch — so the NDI frame/control channels can never
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
function registerRpcHandlers(
  handlers: RpcHandlerMap,
  transformResult: (result: unknown) => unknown = (result) => result,
): void {
  for (const key of Object.keys(IPC) as (keyof typeof IPC)[]) {
    if (NDI_FRAME_CHANNEL_NAME_SET.has(key)) continue;
    const operation = key as RpcChannelName;
    const handler = handlers[operation] as AnyRpcHandler;
    const resolvesOwnMedia = SELF_RESOLVING_MEDIA_OPERATIONS.has(operation);

    safeHandle(IPC[key], async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const resolvedArgs = resolvesOwnMedia ? args : resolveManagedMediaArgs(args);
      const result = await handler(event, ...(resolvedArgs as never[]));
      return maskManagedMediaResult(transformResult(result));
    });
  }
}

export const registerIpcHandlers = (
  repo: PersistenceServiceLike,
  ndiService: NdiServiceLike,
  getMainWindow: () => BrowserWindow | null,
  appUpdater: AppUpdater,
  options: {
    onPersistenceProgress?: (progress: PersistenceProgress) => void;
    getLatestPersistenceProgress?: () => PersistenceProgress | null;
    createNdiFrameTransport?: (name: NdiOutputName) => MessagePortMain | null;
  } = {},
): void => {
  const mediaDerivatives = new MediaDerivativeService(repo, app.getPath('userData'));
  const mediaLibrary = new MediaLibraryService(app.getPath('userData'));

  function reportPersistenceProgress(progress: PersistenceProgress): void {
    try {
      options.onPersistenceProgress?.(progress);
    } catch {
      // Progress is observational and cannot alter validation or restore.
    }
  }

  async function getSnapshotWithHeartbeat(): Promise<AppSnapshot> {
    const heartbeat: PersistenceProgress = {
      operation: 'getSnapshot',
      phase: 'running',
      completed: 0,
      total: 1,
    };
    reportPersistenceProgress(heartbeat);
    const interval = setInterval(() => {
      reportPersistenceProgress(heartbeat);
    }, SNAPSHOT_HEARTBEAT_INTERVAL_MS);
    try {
      const snapshot = await repo.getSnapshot();
      reportPersistenceProgress({
        operation: 'getSnapshot',
        phase: 'complete',
        completed: 1,
        total: 1,
      });
      return snapshot;
    } finally {
      clearInterval(interval);
    }
  }

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

  ndiService.onFrameReleased((release) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(NDI_EVENTS.frameReleased, release);
  });

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
  mediaDerivatives.onProgress((progress) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(
      MEDIA_DERIVATIVE_EVENTS.progress,
      maskManagedMediaResult(mediaDerivatives.attachToResult(progress)),
    );
  });
  // `registerIpcHandlers` is never handed a process-wide "is the app
  // quitting" flag (app/main/index.ts's `isShuttingDown` is local to that
  // module) — the main window being gone is an equally good signal that the
  // background adoption pass below should stop: there is no renderer left to
  // report progress to, and no reason to keep copying bytes past that point.
  function isMainWindowGone(): boolean {
    const window = getMainWindow();
    return !window || window.isDestroyed();
  }

  let mediaLibraryAdoptionStarted = false;

  ipcMain.on(PERSISTENCE_CHANNELS.subscribe, (event) => {
    try {
      assertTrustedIpcSender(event);
      const latest = options.getLatestPersistenceProgress?.();
      if (latest && !event.sender.isDestroyed()) {
        event.sender.send(PERSISTENCE_EVENTS.progress, latest);
      }

      // Triggered from here, not at registration: this channel fires when
      // the renderer mounts its subscription, which is exactly when a window
      // exists to send patches to and a snapshot is being kept in sync to
      // receive them. Guarded to run at most once per process — a second
      // window subscribing (or a second subscribe call) must not restart it.
      if (!mediaLibraryAdoptionStarted) {
        mediaLibraryAdoptionStarted = true;
        void mediaLibrary.adoptExistingAssets(repo, {
          onProgress: (progress) => {
            const window = getMainWindow();
            if (!window || window.isDestroyed()) return;
            window.webContents.send(MEDIA_LIBRARY_EVENTS.progress, maskManagedMediaResult(progress));
          },
          isCancelled: isMainWindowGone,
        }).catch((error) => {
          // A failed adoption pass must never take down the app; the assets
          // it would have adopted simply stay on their original paths.
          console.error('[MediaLibrary] Background adoption pass failed', error);
        });
      }
    } catch (error) {
      console.error(`[IPC ${PERSISTENCE_CHANNELS.subscribe}]`, error);
    }
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
    getSnapshot: () => getSnapshotWithHeartbeat(),
    applySnapshotPatch: async (_event, patch: import('@lumacast/protocol').SnapshotPatch) => {
      const decoded = decodeSnapshotPatchShape(patch, rpcContext('applySnapshotPatch'));
      const reconcilePlan = await buildMediaDerivativePatchReconcilePlan(repo, decoded);
      await repo.applyPatch(decoded);
      executeMediaDerivativePatchReconcilePlan(reconcilePlan, mediaDerivatives);
    },
    restoreFromSnapshot: async (_event, snapshot: AppSnapshot) => {
      const decoded = decodeAppSnapshotShape(snapshot, rpcContext('restoreFromSnapshot'));
      const previous = await repo.getSnapshot();
      const restored = await repo.restoreFromSnapshot(decoded);
      reconcileMediaDerivativeSnapshotChange(previous, restored, mediaDerivatives);
      return restored;
    },
    chooseBundleExportPath: async (event, suggestedName: string) => {
      expectRpcPrimitiveArgs([suggestedName], [{ name: 'suggestedName', kind: 'string' }], rpcContext('chooseBundleExportPath'));
      const result = await showSaveDialogForEvent(event, {
        title: 'Export Deck Bundle',
        defaultPath: `${sanitizeSuggestedBundleName(suggestedName)}.cst`,
        filters: [{ name: 'CST Bundle', extensions: ['cst'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      return ensureBundleExtension(result.filePath);
    },
    chooseBundleImportPath: async (event) => {
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
    exportBundle: async (_event, itemIds: Id[], filePath: string, options?: BundleExportOptions) => {
      const ctx = rpcContext('exportBundle');
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
        : decodeBundleExportOptions(options, rpcContext('exportBundle', 'options'));
      const bundle = await repo.exportBundle(itemIds, validatedOptions);
      const normalizedPath = ensureBundleExtension(filePath);
      await writeDeckBundleArchive(normalizedPath, bundle);
      return { filePath: normalizedPath, itemCount: bundle.items.length };
    },
    inspectImportBundle: async (_event, filePath: string) => {
      expectRpcPrimitiveArgs([filePath], [{ name: 'filePath', kind: 'string' }], rpcContext('inspectImportBundle'));
      const bundle = await readDeckBundleArchive(filePath);
      return repo.inspectImportBundle(bundle);
    },
    finalizeImportBundle: async (_event, filePath: string, decisions: BundleBrokenReferenceDecision[]) => {
      const ctx = rpcContext('finalizeImportBundle');
      expectRpcPrimitiveArgs([filePath], [{ name: 'filePath', kind: 'string' }], ctx);
      if (!Array.isArray(decisions)) {
        throw new CodecError(ctx, `decisions must be an array, got ${typeof decisions}`);
      }
      const validatedDecisions = decisions.map((decision, index) =>
        decodeBundleBrokenReferenceDecision(decision, rpcContext('finalizeImportBundle', `decisions[${index}]`))
      );
      // A relink points at a file outside the app just as an import does, so
      // the replacement is copied into the library before it is persisted.
      const adoptedDecisions = await Promise.all(validatedDecisions.map(async (decision) => (
        decision.action === 'replace' && decision.replacementPath
          ? { ...decision, replacementPath: await mediaLibrary.adopt(decision.replacementPath) }
          : decision
      )));
      const bundle = await readDeckBundleArchive(filePath);
      const snapshot = await repo.finalizeImportBundle(bundle, adoptedDecisions);
      mediaDerivatives.scheduleBatch(snapshot.mediaAssets.map((asset) => asset.id));
      return snapshot;
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
    createPlaylist: (_event, name: string) => {
      expectRpcPrimitiveArgs([name], [{ name: 'name', kind: 'string' }], rpcContext('createPlaylist'));
      return repo.createPlaylist(name);
    },
    createSeparator: (_event, playlistId: Id, label: string) => {
      expectRpcPrimitiveArgs(
        [playlistId, label],
        [{ name: 'playlistId', kind: 'string' }, { name: 'label', kind: 'string' }],
        rpcContext('createSeparator'),
      );
      return repo.createSeparator(playlistId, label);
    },
    renameSeparator: (_event, id: Id, label: string) => {
      expectRpcPrimitiveArgs(
        [id, label],
        [{ name: 'id', kind: 'string' }, { name: 'label', kind: 'string' }],
        rpcContext('renameSeparator'),
      );
      return repo.renameSeparator(id, label);
    },
    setSeparatorColor: (_event, id: Id, colorKey: string | null) => {
      expectRpcPrimitiveArgs(
        [id, colorKey],
        [{ name: 'id', kind: 'string' }, { name: 'colorKey', kind: 'nullableString' }],
        rpcContext('setSeparatorColor'),
      );
      return repo.setSeparatorColor(id, colorKey);
    },
    movePlaylist: (_event, id: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [id, direction],
        [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('movePlaylist'),
      );
      return repo.movePlaylist(id, direction);
    },
    movePlaylistRow: (_event, rowId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [rowId, newOrder],
        [{ name: 'rowId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('movePlaylistRow'),
      );
      return repo.movePlaylistRow(rowId, newOrder);
    },
    removePlaylistRow: (_event, rowId: Id) => {
      expectRpcPrimitiveArgs([rowId], [{ name: 'rowId', kind: 'string' }], rpcContext('removePlaylistRow'));
      return repo.removePlaylistRow(rowId);
    },
    addItemToPlaylist: (_event, playlistId: Id, itemRef: ItemRef, position?: number) => {
      const ctx = rpcContext('addItemToPlaylist');
      expectRpcPrimitiveArgs([playlistId], [{ name: 'playlistId', kind: 'string' }], ctx);
      const validatedItemRef = decodeItemRef(itemRef, rpcContext('addItemToPlaylist', 'itemRef'));
      if (position !== undefined) {
        expectRpcPrimitiveArgs([position], [{ name: 'position', kind: 'number' }], ctx);
      }
      return repo.addItemToPlaylist(playlistId, validatedItemRef, position);
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
    setPlaylistOrder: (_event, playlistId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [playlistId, newOrder],
        [{ name: 'playlistId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setPlaylistOrder'),
      );
      return repo.setPlaylistOrder(playlistId, newOrder);
    },
    setOverlayOrder: (_event, overlayId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [overlayId, newOrder],
        [{ name: 'overlayId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setOverlayOrder'),
      );
      return repo.setOverlayOrder(overlayId, newOrder);
    },
    setStageOrder: (_event, stageId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [stageId, newOrder],
        [{ name: 'stageId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setStageOrder'),
      );
      return repo.setStageOrder(stageId, newOrder);
    },
    setThemeOrder: (_event, themeId: Id, themeType: ThemeOwnerType, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [themeId, themeType, newOrder],
        [
          { name: 'themeId', kind: 'string' },
          { name: 'themeType', kind: 'enum', values: THEME_OWNER_TYPES },
          { name: 'newOrder', kind: 'number' },
        ],
        rpcContext('setThemeOrder'),
      );
      return repo.setThemeOrder(themeId, themeType, newOrder);
    },
    setMacroOrder: (_event, macroId: Id, newOrder: number) => {
      expectRpcPrimitiveArgs(
        [macroId, newOrder],
        [{ name: 'macroId', kind: 'string' }, { name: 'newOrder', kind: 'number' }],
        rpcContext('setMacroOrder'),
      );
      return repo.setMacroOrder(macroId, newOrder);
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
    createMediaAsset: async (_event, asset: MediaAssetCreateInput) => {
      const input = decodeMediaAssetCreateInput(asset, rpcContext('createMediaAsset'));
      // The file the user picked is copied into the library first, so what gets
      // persisted is a reference to our copy and the project stops depending on
      // a path only they can keep alive.
      const patch = await repo.createMediaAsset({ ...input, src: await mediaLibrary.adopt(input.src) });
      const assetId = patch.upserts.mediaAssets?.[0]?.id;
      if (assetId) mediaDerivatives.schedule(assetId);
      return patch;
    },
    deleteMediaAsset: async (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deleteMediaAsset'));
      const patch = await repo.deleteMediaAsset(id);
      mediaDerivatives.invalidate(id);
      return patch;
    },
    updateMediaAssetSrc: async (_event, id: Id, src: string) => {
      expectRpcPrimitiveArgs(
        [id, src],
        [{ name: 'id', kind: 'string' }, { name: 'src', kind: 'string' }],
        rpcContext('updateMediaAssetSrc'),
      );
      const patch = await repo.updateMediaAssetSrc(id, await mediaLibrary.adopt(src));
      mediaDerivatives.invalidate(id);
      mediaDerivatives.schedule(id);
      return patch;
    },
    reclaimMediaLibrary: () => mediaLibrary.reclaim(repo),
    ensureMediaDerivative: (_event, assetId: Id) => {
      expectRpcPrimitiveArgs([assetId], [{ name: 'assetId', kind: 'string' }], rpcContext('ensureMediaDerivative'));
      return mediaDerivatives.ensure(assetId);
    },
    uploadMediaDerivativeFallback: (_event, assetId: Id, generationToken: string, sourceFingerprint: string, bytes: Uint8Array) => {
      expectRpcPrimitiveArgs(
        [assetId, generationToken, sourceFingerprint],
        [
          { name: 'assetId', kind: 'string' },
          { name: 'generationToken', kind: 'string' },
          { name: 'sourceFingerprint', kind: 'string' },
        ],
        rpcContext('uploadMediaDerivativeFallback'),
      );
      if (!(bytes instanceof Uint8Array)) {
        throw new CodecError(rpcContext('uploadMediaDerivativeFallback', 'bytes'), `must be a Uint8Array, got ${typeof bytes}`);
      }
      return mediaDerivatives.uploadFallback(assetId, generationToken, sourceFingerprint, bytes);
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
        const encoded = validateEncodedImageForNativeDecode(picture.data, MAX_TRUSTED_EMBEDDED_IMAGE_BYTES);
        const image = nativeImage.createFromBuffer(Buffer.from(picture.data));
        if (image.isEmpty()) return null;
        const targetSize = fitWithinBounds(encoded.width, encoded.height, 64, 64);
        const output = image.resize({ ...targetSize, quality: 'good' }).toPNG();
        if (output.byteLength > MAX_EMBEDDED_IMAGE_OUTPUT_BYTES) return null;
        return `data:image/png;base64,${output.toString('base64')}`;
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
    // `themeType` selects which of the four independent theme tables `themeId`
    // lives in (decision D2) — required even though it duplicates information
    // the id alone can't carry.
    deleteTheme: (_event, themeId: Id, themeType: ThemeOwnerType) => {
      expectRpcPrimitiveArgs(
        [themeId, themeType],
        [{ name: 'themeId', kind: 'string' }, { name: 'themeType', kind: 'enum', values: THEME_OWNER_TYPES }],
        rpcContext('deleteTheme'),
      );
      return repo.deleteTheme(themeId, themeType);
    },
    applyThemeToItem: (_event, themeId: Id, itemRef: ItemRef) => {
      expectRpcPrimitiveArgs([themeId], [{ name: 'themeId', kind: 'string' }], rpcContext('applyThemeToItem'));
      const validatedItemRef = decodeItemRef(itemRef, rpcContext('applyThemeToItem', 'itemRef'));
      return repo.applyThemeToItem(themeId, validatedItemRef);
    },
    detachThemeFromItem: (_event, itemRef: ItemRef) => {
      const validatedItemRef = decodeItemRef(itemRef, rpcContext('detachThemeFromItem', 'itemRef'));
      return repo.detachThemeFromItem(validatedItemRef);
    },
    // `itemType` scopes the sync to one item table; overlay themes have no
    // linked-item concept to sync.
    syncThemeToLinkedItems: (_event, themeId: Id, itemType: ItemType) => {
      expectRpcPrimitiveArgs(
        [themeId, itemType],
        [{ name: 'themeId', kind: 'string' }, { name: 'itemType', kind: 'enum', values: ITEM_TYPES }],
        rpcContext('syncThemeToLinkedItems'),
      );
      return repo.syncThemeToLinkedItems(themeId, itemType);
    },
    applyThemeToOverlay: (_event, themeId: Id, overlayId: Id) => {
      expectRpcPrimitiveArgs(
        [themeId, overlayId],
        [{ name: 'themeId', kind: 'string' }, { name: 'overlayId', kind: 'string' }],
        rpcContext('applyThemeToOverlay'),
      );
      return repo.applyThemeToOverlay(themeId, overlayId);
    },
    createItem: (_event, input: ItemCreateInput) =>
      repo.createItem(decodeItemCreateInput(input, rpcContext('createItem'))),
    duplicateItem: (_event, input: ItemDuplicateInput) =>
      repo.duplicateItem(decodeItemDuplicateInput(input, rpcContext('duplicateItem'))),
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
    // Per-type reorder (decision D1): each item table keeps its own
    // `order_index` sequence, so the old cross-type `moveDeckItem` splits
    // one-for-one per table.
    movePresentation: (_event, id: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [id, direction],
        [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('movePresentation'),
      );
      return repo.movePresentation(id, direction);
    },
    moveLyric: (_event, id: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [id, direction],
        [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('moveLyric'),
      );
      return repo.moveLyric(id, direction);
    },
    moveTalk: (_event, id: Id, direction: 'up' | 'down') => {
      expectRpcPrimitiveArgs(
        [id, direction],
        [{ name: 'id', kind: 'string' }, { name: 'direction', kind: 'enum', values: RPC_MOVE_DIRECTIONS }],
        rpcContext('moveTalk'),
      );
      return repo.moveTalk(id, direction);
    },
    deletePlaylist: (_event, id: Id) => {
      expectRpcPrimitiveArgs([id], [{ name: 'id', kind: 'string' }], rpcContext('deletePlaylist'));
      return repo.deletePlaylist(id);
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
    restoreProjectBackup: async (_event, backup: ProjectBackup) => {
      try {
        reportPersistenceProgress({
          operation: 'restoreProjectBackup',
          phase: 'validation',
          completed: 0,
          total: 0,
        });
        await validateProjectBackupAsync(backup, {
          onProgress: ({ validatedRows, totalRows }) => {
            reportPersistenceProgress({
              operation: 'restoreProjectBackup',
              phase: 'validation',
              completed: validatedRows,
              total: totalRows,
            });
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CodecError(rpcContext('restoreProjectBackup'), message);
      }
      const result = await repo.restoreProjectBackup(backup);
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
  registerRpcHandlers(rpcHandlers, (result) => mediaDerivatives.attachToResult(result));

  ipcMain.on(IPC.requestNdiFrameTransport, (event, payload: unknown) => {
    let port: MessagePortMain | null = null;
    try {
      assertTrustedIpcSender(event);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('NDI frame transport request must be an object');
      }
      const name = (payload as { name?: unknown }).name;
      if (typeof name !== 'string' || !NDI_OUTPUT_NAMES.has(name as NdiOutputName)) {
        throw new Error(`Invalid NDI output name: ${String(name)}`);
      }
      const senderFrame = event.senderFrame;
      if (!senderFrame) {
        throw new Error('NDI frame transport request has no sender frame');
      }
      port = options.createNdiFrameTransport?.(name as NdiOutputName) ?? null;
      if (!port) return;
      senderFrame.postMessage(
        NDI_FRAME_TRANSPORT_PORT_CHANNEL,
        {
          type: NDI_FRAME_TRANSPORT_WINDOW_MESSAGE,
          version: NDI_FRAME_TRANSPORT_VERSION,
          name,
        },
        [port],
      );
      port = null;
    } catch (error) {
      port?.close();
      console.error(`[IPC ${IPC.requestNdiFrameTransport}]`, error);
    }
  });

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
      const sanitizedTelemetry = sanitizeNdiFrameTelemetry(telemetry);
      const stampedTelemetry: NdiFrameTelemetry | undefined = sanitizedTelemetry
        ? { ...sanitizedTelemetry, mainReceivedAtMs }
        : undefined;
      ndiService.receiveFrame(name, new Uint8Array(buffer), width, height, stampedTelemetry);
    } catch (error) {
      console.error(`[IPC ${IPC.sendNdiFrame}]`, error);
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
