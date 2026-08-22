import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent, MessagePortMain } from 'electron';

/**
 * Regression coverage for issue #152: main registers every RPC handler
 * through the canonical operation map (`IPC` / `RpcOperations` in
 * app/core/ipc.ts), and unknown operations or malformed input fail before
 * application/repository code rather than silently doing nothing.
 *
 * `app/main/ipc.ts` now builds a single `rpcHandlers` object literal typed
 * against `RpcHandlerMap` (a mapped type over `RpcOperations`) and registers
 * it in one call to `registerRpcHandlers`, which iterates the canonical `IPC`
 * map (skipping the three frame/control channels) and calls `ipcMain.handle` for each.
 * That gives a compile-time guarantee that `rpcHandlers` has exactly the
 * required keys — this file adds the runtime half: that the *actual*
 * `ipcMain.handle`/`ipcMain.on` registrations produced by
 * `registerIpcHandlers` match that map exactly, with nothing missing and
 * nothing extra.
 *
 * `electron` is mocked following the pattern in
 * app/main/application-menu.test.ts: `vi.mock('electron', ...)` with
 * `vi.fn()` spies, declared before importing the module under test.
 * `./security`'s `assertTrustedIpcSender` is also mocked to a no-op so tests
 * can invoke captured handlers directly without constructing a real trusted
 * `BrowserWindow`/webContents graph — sender-trust enforcement is covered by
 * its own test, not this one.
 *
 * `preload.ts` is deliberately never imported here (it calls
 * `contextBridge`/`ipcRenderer` at module scope and is not safely importable
 * in a test environment). Its completeness against the canonical map is
 * enforced at compile time instead: `preload.ts`'s exported `api` object
 * `satisfies MainApi`, and `MainApi`'s RPC surface is itself derived from
 * `RpcOperations`, so an extra, missing, or mistyped member there fails
 * `tsc`, not this test.
 */

// safeHandle in app/main/ipc.ts always registers an async wrapper, so every
// captured handler here is a promise-returning function at runtime.
type InvokeHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;
type OnListener = (...args: unknown[]) => void;

const { handleRegistrations, onRegistrations } = vi.hoisted(() => {
  return {
    handleRegistrations: new Map<string, InvokeHandler>(),
    onRegistrations: new Map<string, OnListener>(),
  };
});

vi.mock('electron', () => {
  const handle = vi.fn((channel: string, handler: InvokeHandler) => {
    handleRegistrations.set(channel, handler);
  });
  const on = vi.fn((channel: string, listener: OnListener) => {
    onRegistrations.set(channel, listener);
  });
  return {
    ipcMain: { handle, on },
    BrowserWindow: { fromWebContents: vi.fn(() => null) },
    Menu: {
      buildFromTemplate: vi.fn(() => []),
      setApplicationMenu: vi.fn(),
      getApplicationMenu: vi.fn(() => null),
    },
    app: { isPackaged: false, getPath: vi.fn(() => '/tmp') },
    clipboard: { readText: vi.fn(), writeText: vi.fn() },
    dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
    shell: { openPath: vi.fn(), openExternal: vi.fn() },
  };
});

vi.mock('./security', () => ({
  assertTrustedIpcSender: vi.fn(),
}));

import {
  IPC,
  MEDIA_DERIVATIVE_EVENTS,
  MEDIA_LIBRARY_EVENTS,
  NDI_FRAME_TRANSPORT_PORT_CHANNEL,
  NDI_FRAME_TRANSPORT_VERSION,
  NDI_FRAME_TRANSPORT_WINDOW_MESSAGE,
  NDI_FRAME_CHANNEL_NAMES,
  PERSISTENCE_CHANNELS,
  PERSISTENCE_EVENTS,
  type MediaDerivativeProgress,
  type MediaLibraryProgress,
  type NdiOutputName,
  type PersistenceProgress,
} from '@lumacast/protocol';
import { registerIpcHandlers } from './ipc';
import { MediaDerivativeService } from './media-derivatives';
import { MediaLibraryService } from './media-library';
import { maskManagedMediaSource, revokeManagedMediaSource } from './media-capability';
import type { PersistenceServiceLike } from './persistence/persistence-service-proxy';
import type { NdiServiceLike } from '@lumacast/engine';
import type { AppUpdater } from './app-updater';

const FRAME_CHANNEL_NAME_SET = new Set<string>(NDI_FRAME_CHANNEL_NAMES);
let repositoryMethods: Record<string, ReturnType<typeof vi.fn>>;
let ndiService: NdiServiceLike;
let latestPersistenceProgress: PersistenceProgress | null;
let reportedPersistenceProgress: PersistenceProgress[];
let createNdiFrameTransport = vi.fn<(name: NdiOutputName) => MessagePortMain | null>(() => null);

// Every `IPC` key that is not one of the three frame/control channels: this is the set
// `registerRpcHandlers` is expected to register through `ipcMain.handle`,
// mirroring `RpcChannelName` (`keyof RpcOperations`) in app/main/ipc.ts.
const RPC_CHANNEL_NAMES = (Object.keys(IPC) as (keyof typeof IPC)[]).filter(
  (name) => !FRAME_CHANNEL_NAME_SET.has(name),
);

function fakeEvent(): IpcMainInvokeEvent {
  return {} as IpcMainInvokeEvent;
}

function emptySnapshot() {
  return {
    presentations: [],
    lyrics: [],
    talks: [],
    slides: [],
    talkScriptBlocks: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    presentationThemes: [],
    lyricThemes: [],
    talkThemes: [],
    overlayThemes: [],
    stages: [],
    playlists: [],
    playlistEntries: [],
    cues: [],
    macros: [],
    triggerBindings: [],
  };
}

function makeFakeNdiService(): NdiServiceLike {
  return {
    getOutputState: vi.fn(),
    getOutputConfigs: vi.fn(),
    getDiagnostics: vi.fn(),
    setOutputEnabled: vi.fn(),
    updateOutputConfig: vi.fn(),
    receiveFrame: vi.fn(),
    receiveAudioFrame: vi.fn(),
    onOutputStateChanged: vi.fn(() => () => {}),
    onDiagnosticsChanged: vi.fn(() => () => {}),
    onFrameReleased: vi.fn(() => () => {}),
    flushBlackoutAndDestroy: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('main IPC registration (issue #152)', () => {
  beforeEach(() => {
    handleRegistrations.clear();
    onRegistrations.clear();
    vi.clearAllMocks();

    // A minimal repo stub is enough: every test either checks registration
    // shape without invoking a handler, or invokes a handler whose codec
    // validation throws before any `repo.*` method is reached.
    repositoryMethods = {};
    // `registerIpcHandlers` now starts a media library adoption pass off the
    // `PERSISTENCE_CHANNELS.subscribe` handler, which several tests below
    // invoke directly for unrelated reasons; a default empty snapshot keeps
    // that pass a same-tick no-op (no pending assets) for every test that
    // doesn't care about it, rather than an unhandled `getSnapshot is not a
    // function` rejection on every subscribe.
    repositoryMethods.getSnapshot = vi.fn(() => Promise.resolve(emptySnapshot()));
    latestPersistenceProgress = null;
    reportedPersistenceProgress = [];
    createNdiFrameTransport = vi.fn<(name: NdiOutputName) => MessagePortMain | null>(() => null);
    const repo = repositoryMethods as unknown as PersistenceServiceLike;
    ndiService = makeFakeNdiService();
    const appUpdater = {} as unknown as AppUpdater;

    registerIpcHandlers(repo, ndiService, () => null, appUpdater, {
      onPersistenceProgress: (progress) => reportedPersistenceProgress.push(progress),
      getLatestPersistenceProgress: () => latestPersistenceProgress,
      createNdiFrameTransport,
    });
  });

  it('registers a handler for every operation in the canonical map (missing-registration regression)', () => {
    const missing = RPC_CHANNEL_NAMES.filter((name) => !handleRegistrations.has(IPC[name]));
    expect(missing, `missing ipcMain.handle registration for: ${missing.join(', ')}`).toEqual([]);
    // Sanity: this is the full 103-operation surface, not a partial list.
    expect(RPC_CHANNEL_NAMES.length).toBe(103);
  });

  it('registers nothing outside the canonical map (extra-registration regression)', () => {
    // Widened to Set<string> deliberately: the registered channels this is
    // compared against are Map keys typed as plain strings, and the point of
    // the test is to catch a channel *outside* the canonical union.
    const canonicalChannels = new Set<string>(RPC_CHANNEL_NAMES.map((name) => IPC[name]));
    const registeredChannels = [...handleRegistrations.keys()];
    const extra = registeredChannels.filter((channel) => !canonicalChannels.has(channel));

    expect(extra, `unexpected ipcMain.handle registration(s) for: ${extra.join(', ')}`).toEqual([]);
    expect(registeredChannels.length).toBe(canonicalChannels.size);
  });

  it('fails rather than silently succeeding for an unknown/unregistered operation', async () => {
    const bogusChannel = 'cast:totallyMadeUpOperation';
    expect(handleRegistrations.has(bogusChannel)).toBe(false);

    // Mirrors Electron's own ipcMain.handle/invoke contract: calling invoke
    // on a channel with no registered handler rejects instead of resolving
    // silently. There is no real `ipcRenderer.invoke` in this unit test, so
    // this small wrapper models exactly that documented failure mode against
    // the handler map `registerIpcHandlers` actually produced.
    async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handleRegistrations.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      return handler(fakeEvent(), ...args);
    }

    await expect(invoke(bogusChannel)).rejects.toThrow(`No handler registered for '${bogusChannel}'`);
  });

  it('registers the three NDI frame channels via ipcMain.on only, never through the RPC handle path', () => {
    for (const frameChannelName of NDI_FRAME_CHANNEL_NAMES) {
      const channel = IPC[frameChannelName];
      expect(onRegistrations.has(channel), `expected ${frameChannelName} to be registered via ipcMain.on`).toBe(true);
      expect(handleRegistrations.has(channel), `${frameChannelName} must not be registered via ipcMain.handle`).toBe(false);
    }
  });

  it('creates and transfers a direct NDI frame port only for a valid trusted output request', () => {
    const postMessage = vi.fn();
    const close = vi.fn();
    const port = { close } as unknown as MessagePortMain;
    createNdiFrameTransport.mockReturnValue(port);
    const listener = onRegistrations.get(IPC.requestNdiFrameTransport);
    expect(listener).toBeDefined();

    listener!({ senderFrame: { postMessage } }, { name: 'audience' });

    expect(createNdiFrameTransport).toHaveBeenCalledWith('audience');
    expect(postMessage).toHaveBeenCalledWith(
      NDI_FRAME_TRANSPORT_PORT_CHANNEL,
      {
        type: NDI_FRAME_TRANSPORT_WINDOW_MESSAGE,
        version: NDI_FRAME_TRANSPORT_VERSION,
        name: 'audience',
      },
      [port],
    );

    createNdiFrameTransport.mockClear();
    postMessage.mockClear();
    listener!({ senderFrame: { postMessage } }, { name: 'preview' });
    expect(createNdiFrameTransport).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does not create a transport without a sender frame and closes a port when transfer fails', () => {
    const listener = onRegistrations.get(IPC.requestNdiFrameTransport);
    expect(listener).toBeDefined();

    listener!({ senderFrame: null }, { name: 'audience' });
    expect(createNdiFrameTransport).not.toHaveBeenCalled();

    const close = vi.fn();
    const port = { close } as unknown as MessagePortMain;
    createNdiFrameTransport.mockReturnValue(port);
    listener!(
      { senderFrame: { postMessage: vi.fn(() => { throw new Error('transfer failed'); }) } },
      { name: 'stage' },
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('replays the latest persistence progress when the preload subscribes after window creation', () => {
    const send = vi.fn();
    latestPersistenceProgress = {
      operation: 'initialize',
      phase: 'migration',
      completed: 4,
      total: 8,
    };
    const listener = onRegistrations.get(PERSISTENCE_CHANNELS.subscribe);
    expect(listener).toBeDefined();

    listener!({
      sender: {
        isDestroyed: () => false,
        send,
      },
    });

    expect(send).toHaveBeenCalledWith(PERSISTENCE_EVENTS.progress, latestPersistenceProgress);
  });

  it('keeps snapshot loading active with main-process heartbeats while the host is synchronously busy', async () => {
    vi.useFakeTimers();
    let resolveSnapshot!: (snapshot: ReturnType<typeof emptySnapshot>) => void;
    repositoryMethods.getSnapshot = vi.fn(() => new Promise<ReturnType<typeof emptySnapshot>>((resolve) => {
      resolveSnapshot = resolve;
    }));
    const handler = handleRegistrations.get(IPC.getSnapshot);
    expect(handler).toBeDefined();

    const pending = handler!(fakeEvent());
    expect(reportedPersistenceProgress).toEqual([{
      operation: 'getSnapshot',
      phase: 'running',
      completed: 0,
      total: 1,
    }]);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(reportedPersistenceProgress.filter((progress) => progress.phase === 'running')).toHaveLength(5);

    resolveSnapshot(emptySnapshot());
    await expect(pending).resolves.toEqual(emptySnapshot());
    expect(reportedPersistenceProgress.at(-1)).toEqual({
      operation: 'getSnapshot',
      phase: 'complete',
      completed: 1,
      total: 1,
    });
    const progressCount = reportedPersistenceProgress.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reportedPersistenceProgress).toHaveLength(progressCount);
    vi.useRealTimers();
  });

  it('serializes a typed CodecError instead of swallowing it, after malformed input is rejected before repository code', async () => {
    const handler = handleRegistrations.get(IPC.deleteCue);
    expect(handler).toBeDefined();

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // `deleteCue`'s only argument must be a string id. Passing a number is
    // rejected by `expectRpcPrimitiveArgs` before `repo.deleteCue` — which
    // this test's stub repo does not even implement — is ever reached.
    await expect(handler!(fakeEvent(), 123)).rejects.toThrow(/\[rpc\/deleteCue\].*must be a string/);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(`[IPC ${IPC.deleteCue}]`),
      expect.stringContaining('must be a string'),
    );

    consoleErrorSpy.mockRestore();
  });

  it('does not split a media deletion into separately interleavable repository calls', async () => {
    const order: string[] = [];
    repositoryMethods.getMediaAsset = vi.fn();
    repositoryMethods.deleteMediaAsset = vi.fn(async () => {
      order.push('delete');
      return { version: 1, upserts: {}, deletes: { mediaAssets: ['asset-1'] } };
    });
    const handler = handleRegistrations.get(IPC.deleteMediaAsset);
    expect(handler).toBeDefined();

    await handler!(fakeEvent(), 'asset-1');
    expect(order).toEqual(['delete']);
    expect(repositoryMethods.getMediaAsset).not.toHaveBeenCalled();
  });

  it('reconciles derivative invalidation and rescheduling when applySnapshotPatch replaces a media source', async () => {
    const order: string[] = [];
    const invalidateManySpy = vi.spyOn(MediaDerivativeService.prototype, 'invalidateMany').mockImplementation(() => {});
    const scheduleBatchSpy = vi.spyOn(MediaDerivativeService.prototype, 'scheduleBatch').mockImplementation(() => {});
    invalidateManySpy.mockImplementation(() => {
      order.push('invalidate');
    });
    scheduleBatchSpy.mockImplementation(() => {
      order.push('schedule');
    });
    repositoryMethods.getMediaAsset = vi.fn(async () => {
      order.push('get');
      return {
        id: 'asset-1',
        src: 'cast-media://%2Fold.mp4',
      };
    });
    repositoryMethods.applyPatch = vi.fn(async () => {
      order.push('apply');
    });
    const handler = handleRegistrations.get(IPC.applySnapshotPatch);
    expect(handler).toBeDefined();

    await handler!(fakeEvent(), {
      version: 1,
      deletes: {},
      upserts: {
        mediaAssets: [{
          id: 'asset-1',
          name: 'Asset 1',
          type: 'image',
          src: 'cast-media://%2Fnew.mp4',
          width: 640,
          height: 360,
          duration: null,
          codec: null,
          order: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }],
      },
    });

    expect(repositoryMethods.getMediaAsset).toHaveBeenCalledWith('asset-1');
    expect(repositoryMethods.applyPatch).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['get', 'apply', 'invalidate', 'schedule']);
    expect(invalidateManySpy).toHaveBeenCalledWith(['asset-1']);
    expect(scheduleBatchSpy).toHaveBeenCalledWith(['asset-1']);
  });

  it('masks progress patches before sending them to the renderer', () => {
    handleRegistrations.clear();
    onRegistrations.clear();
    const send = vi.fn();
    const progressListeners: Array<(progress: MediaDerivativeProgress) => void> = [];
    vi.spyOn(MediaDerivativeService.prototype, 'onProgress').mockImplementation(function (listener) {
      progressListeners.push(listener);
      return () => {};
    });

    registerIpcHandlers(
      repositoryMethods as unknown as PersistenceServiceLike,
      ndiService,
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      {} as unknown as AppUpdater,
      { getLatestPersistenceProgress: () => latestPersistenceProgress },
    );

    const listener = progressListeners.at(-1);
    expect(listener).toBeDefined();

    listener!({
      active: 1,
      queued: 0,
      completed: 0,
      failed: 0,
      total: 1,
      statusText: 'Generating media thumbnails 0/1',
      patch: {
        version: 1,
        deletes: {},
        upserts: {
          mediaAssets: [{
            id: 'asset-progress',
            name: 'Progress asset',
            type: 'image',
            src: '/tmp/progress-source.png',
            thumbnailSrc: '/tmp/thumbs/progress-thumb.png',
            width: 640,
            height: 360,
            duration: null,
            codec: null,
            order: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
        },
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      MEDIA_DERIVATIVE_EVENTS.progress,
      expect.objectContaining({
        statusText: 'Generating media thumbnails 0/1',
        patch: expect.objectContaining({
          upserts: expect.objectContaining({
            mediaAssets: [expect.objectContaining({
              src: expect.stringMatching(/^cast-media:\/\//),
            })],
          }),
        }),
      }),
    );
    const payload = send.mock.calls[0]?.[1] as {
      patch?: { upserts?: { mediaAssets?: Array<{ src: string; thumbnailSrc?: string | null }> } };
    };
    expect(payload.patch?.upserts?.mediaAssets?.[0]?.src).not.toBe('/tmp/progress-source.png');
    expect(payload.patch?.upserts?.mediaAssets?.[0]?.thumbnailSrc).not.toBe('/tmp/thumbs/progress-thumb.png');
  });

  it('starts the media library adoption pass at most once, no matter how many times the renderer subscribes', () => {
    handleRegistrations.clear();
    onRegistrations.clear();
    const adoptExistingAssets = vi.spyOn(MediaLibraryService.prototype, 'adoptExistingAssets')
      .mockResolvedValue({ adopted: 0, unreadable: 0, failed: 0, cancelled: false });

    registerIpcHandlers(
      repositoryMethods as unknown as PersistenceServiceLike,
      ndiService,
      () => null,
      {} as unknown as AppUpdater,
      { getLatestPersistenceProgress: () => latestPersistenceProgress },
    );

    const subscribeListener = onRegistrations.get(PERSISTENCE_CHANNELS.subscribe);
    expect(subscribeListener).toBeDefined();

    const fakeSubscribeEvent = { sender: { isDestroyed: () => false, send: vi.fn() } };
    // A second window subscribing (or the same one subscribing twice) must
    // not restart the pass — it runs at most once per process.
    subscribeListener!(fakeSubscribeEvent);
    subscribeListener!(fakeSubscribeEvent);
    subscribeListener!(fakeSubscribeEvent);

    expect(adoptExistingAssets).toHaveBeenCalledTimes(1);
    expect(adoptExistingAssets).toHaveBeenCalledWith(
      repositoryMethods,
      expect.objectContaining({ onProgress: expect.any(Function), isCancelled: expect.any(Function) }),
    );
  });

  it('masks media library adoption progress before sending it to the renderer', () => {
    handleRegistrations.clear();
    onRegistrations.clear();
    const send = vi.fn();
    let capturedOnProgress: ((progress: MediaLibraryProgress) => void) | undefined;
    vi.spyOn(MediaLibraryService.prototype, 'adoptExistingAssets').mockImplementation(async (_repo, options = {}) => {
      capturedOnProgress = options.onProgress;
      return { adopted: 0, unreadable: 0, failed: 0, cancelled: false };
    });

    registerIpcHandlers(
      repositoryMethods as unknown as PersistenceServiceLike,
      ndiService,
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      {} as unknown as AppUpdater,
      { getLatestPersistenceProgress: () => latestPersistenceProgress },
    );

    const subscribeListener = onRegistrations.get(PERSISTENCE_CHANNELS.subscribe);
    subscribeListener!({ sender: { isDestroyed: () => false, send: vi.fn() } });
    expect(capturedOnProgress).toBeDefined();

    capturedOnProgress!({
      copied: 1,
      total: 2,
      statusText: 'Copying media into the library (1/2)',
      patch: {
        version: 1,
        deletes: {},
        upserts: {
          mediaAssets: [{
            id: 'asset-adopted',
            name: 'Adopted asset',
            type: 'image',
            src: '/Users/someone/Pictures/original.png',
            thumbnailSrc: null,
            width: 640,
            height: 360,
            duration: null,
            codec: null,
            order: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          }],
        },
      },
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      MEDIA_LIBRARY_EVENTS.progress,
      expect.objectContaining({
        statusText: 'Copying media into the library (1/2)',
        patch: expect.objectContaining({
          upserts: expect.objectContaining({
            mediaAssets: [expect.objectContaining({
              src: expect.stringMatching(/^cast-media:\/\//),
            })],
          }),
        }),
      }),
    );
    const payload = send.mock.calls[0]?.[1] as {
      patch?: { upserts?: { mediaAssets?: Array<{ src: string }> } };
    };
    expect(payload.patch?.upserts?.mediaAssets?.[0]?.src).not.toBe('/Users/someone/Pictures/original.png');
  });

  it('accepts undo patches for deleted media assets even after the derivative thumbnail capability was revoked', async () => {
    const source = 'cast-media:///tmp/restored-delete.png';
    const derivativeSource = 'cast-media:///tmp/restored-delete-thumb.png';
    const maskedSrc = maskManagedMediaSource(source, 'image');
    const maskedThumbnail = maskManagedMediaSource(derivativeSource, 'image');
    expect(revokeManagedMediaSource(derivativeSource, 'image')).toBe(true);
    repositoryMethods.getMediaAsset = vi.fn().mockResolvedValue(null);
    repositoryMethods.applyPatch = vi.fn().mockResolvedValue(undefined);
    const scheduleBatchSpy = vi.spyOn(MediaDerivativeService.prototype, 'scheduleBatch').mockImplementation(() => {});
    const handler = handleRegistrations.get(IPC.applySnapshotPatch);
    expect(handler).toBeDefined();

    await expect(handler!(fakeEvent(), {
      version: 1,
      deletes: {},
      upserts: {
        mediaAssets: [{
          id: 'asset-delete',
          name: 'Deleted asset',
          type: 'image',
          src: maskedSrc,
          thumbnailSrc: maskedThumbnail,
          width: 640,
          height: 360,
          duration: null,
          codec: null,
          order: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    })).resolves.toBeUndefined();

    expect(repositoryMethods.applyPatch).toHaveBeenCalledWith(expect.objectContaining({
      upserts: expect.objectContaining({
        mediaAssets: [expect.objectContaining({
          src: source,
          thumbnailSrc: undefined,
        })],
      }),
    }));
    expect(scheduleBatchSpy).toHaveBeenCalledWith(['asset-delete']);
  });

  it('accepts undo patches for media source replacement even after the old derivative thumbnail capability was revoked', async () => {
    const oldSource = 'cast-media:///tmp/source-before.png';
    const derivativeSource = 'cast-media:///tmp/source-before-thumb.png';
    const maskedOldSource = maskManagedMediaSource(oldSource, 'image');
    const maskedOldThumbnail = maskManagedMediaSource(derivativeSource, 'image');
    expect(revokeManagedMediaSource(derivativeSource, 'image')).toBe(true);
    repositoryMethods.getMediaAsset = vi.fn().mockResolvedValue({
      id: 'asset-replace',
      src: 'cast-media:///tmp/source-after.png',
    });
    repositoryMethods.applyPatch = vi.fn().mockResolvedValue(undefined);
    const invalidateManySpy = vi.spyOn(MediaDerivativeService.prototype, 'invalidateMany').mockImplementation(() => {});
    const scheduleBatchSpy = vi.spyOn(MediaDerivativeService.prototype, 'scheduleBatch').mockImplementation(() => {});
    const handler = handleRegistrations.get(IPC.applySnapshotPatch);
    expect(handler).toBeDefined();

    await expect(handler!(fakeEvent(), {
      version: 1,
      deletes: {},
      upserts: {
        mediaAssets: [{
          id: 'asset-replace',
          name: 'Replaced asset',
          type: 'image',
          src: maskedOldSource,
          thumbnailSrc: maskedOldThumbnail,
          width: 640,
          height: 360,
          duration: null,
          codec: null,
          order: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }],
      },
    })).resolves.toBeUndefined();

    expect(repositoryMethods.applyPatch).toHaveBeenCalledWith(expect.objectContaining({
      upserts: expect.objectContaining({
        mediaAssets: [expect.objectContaining({
          src: oldSource,
          thumbnailSrc: undefined,
        })],
      }),
    }));
    expect(invalidateManySpy).toHaveBeenCalledWith(['asset-replace']);
    expect(scheduleBatchSpy).toHaveBeenCalledWith(['asset-replace']);
  });

  it('reconciles derivative invalidation when restoreFromSnapshot deletes a media row', async () => {
    const invalidateManySpy = vi.spyOn(MediaDerivativeService.prototype, 'invalidateMany').mockImplementation(() => {});
    repositoryMethods.getSnapshot = vi.fn().mockResolvedValue({
      ...emptySnapshot(),
      mediaAssets: [{ id: 'asset-1', src: 'cast-media://%2Fold.mp4' }],
    });
    repositoryMethods.restoreFromSnapshot = vi.fn().mockResolvedValue(emptySnapshot());
    const handler = handleRegistrations.get(IPC.restoreFromSnapshot);
    expect(handler).toBeDefined();

    await handler!(fakeEvent(), emptySnapshot());

    expect(repositoryMethods.restoreFromSnapshot).toHaveBeenCalledTimes(1);
    expect(invalidateManySpy).toHaveBeenCalledWith(['asset-1']);
  });

  it('keeps the NDI frame relay responsive while an async persistence RPC is pending', async () => {
    let resolveSnapshot!: (value: unknown) => void;
    repositoryMethods.getSnapshot = vi.fn(() => new Promise((resolve) => {
      resolveSnapshot = resolve;
    }));
    const snapshotHandler = handleRegistrations.get(IPC.getSnapshot);
    const frameListener = onRegistrations.get(IPC.sendNdiFrame);

    const pendingSnapshot = snapshotHandler!(fakeEvent());
    const buffer = new ArrayBuffer(4);
    frameListener!(fakeEvent(), {
      name: 'audience',
      buffer,
      width: 1,
      height: 1,
    });

    expect(ndiService.receiveFrame).toHaveBeenCalledWith(
      'audience',
      new Uint8Array(buffer),
      1,
      1,
      undefined,
    );
    resolveSnapshot({ presentations: [] });
    await pendingSnapshot;
  });
});
