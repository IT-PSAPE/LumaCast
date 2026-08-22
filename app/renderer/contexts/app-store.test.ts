// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { invertPatch, type AppSnapshot, type SnapshotPatch } from '@lumacast/protocol';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeSnapshot(partial: Partial<AppSnapshot> = {}): AppSnapshot {
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
    ...partial,
  };
}

function makePresentation(id: string, title: string) {
  return {
    id,
    title,
    themeId: null,
    order: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

function makeMediaAsset(id: string, partial: Partial<AppSnapshot['mediaAssets'][number]> = {}) {
  return {
    id,
    name: `Asset ${id}`,
    type: 'image' as const,
    src: `cast-media://${id}`,
    thumbnailSrc: null,
    width: null,
    height: null,
    duration: null,
    codec: null,
    order: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  };
}

async function loadFreshStore(initialSnapshot: AppSnapshot) {
  vi.resetModules();
  window.localStorage.clear();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });

  const castApi = {
    getSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
    applySnapshotPatch: vi.fn().mockResolvedValue(undefined),
    restoreFromSnapshot: vi.fn().mockResolvedValue(initialSnapshot),
    setNdiOutputEnabled: vi.fn(),
    updateNdiOutputConfig: vi.fn(),
  };
  (window as unknown as { castApi: unknown }).castApi = castApi;

  const module = await import('./app-store');
  await module.useAppStore.getState().retrySnapshotLoad();

  return {
    castApi,
    useAppStore: module.useAppStore,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
  window.localStorage.clear();
});

describe('app-store persistence inactivity watchdog', () => {
  it('resets snapshot inactivity timeout when persistence reports progress', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    let resolveSnapshot!: (snapshot: AppSnapshot) => void;
    const snapshotPromise = new Promise<AppSnapshot>((resolve) => { resolveSnapshot = resolve; });
    Object.defineProperty(window, 'castApi', {
      configurable: true,
      writable: true,
      value: {
        getSnapshot: vi.fn(() => snapshotPromise),
      },
    });
    const module = await import('./app-store');

    const loading = module.useAppStore.getState().retrySnapshotLoad();
    await vi.advanceTimersByTimeAsync(14_000);
    module.useAppStore.getState().handlePersistenceProgress({
      operation: 'initialize',
      phase: 'migrating',
      completed: 1,
      total: 2,
    });
    await vi.advanceTimersByTimeAsync(14_000);

    expect(module.useAppStore.getState().isLoadingSnapshot).toBe(true);
    expect(module.useAppStore.getState().snapshotLoadError).toBeNull();
    resolveSnapshot(makeSnapshot());
    await loading;
    expect(module.useAppStore.getState().snapshotLoadError).toBeNull();
  });

  it('clears restore status when promotion completes', async () => {
    const { useAppStore } = await loadFreshStore(makeSnapshot());

    useAppStore.getState().handlePersistenceProgress({
      operation: 'restoreProjectBackup',
      phase: 'promotion',
      completed: 5,
      total: 6,
    });
    expect(useAppStore.getState()).toMatchObject({
      statusText: 'Restoring project',
      statusTextSource: 'persistence',
    });

    useAppStore.getState().handlePersistenceProgress({
      operation: 'restoreProjectBackup',
      phase: 'complete',
      completed: 6,
      total: 6,
    });
    expect(useAppStore.getState()).toMatchObject({
      statusText: 'Ready',
      statusTextSource: 'default',
    });
  });
});

describe('app-store undo/redo persistence contract', () => {
  it('uses applySnapshotPatch for patch-backed undo and redo entries', async () => {
    const before = makeSnapshot({ presentations: [makePresentation('presentation-1', 'Deck')] });
    const afterPresentation = makePresentation('presentation-1', 'Deck Renamed');
    const patch: SnapshotPatch = {
      version: 1,
      upserts: { presentations: [afterPresentation] },
      deletes: {},
    };
    const inverse = invertPatch(before, patch);
    const { castApi, useAppStore } = await loadFreshStore(before);

    await useAppStore.getState().mutatePatch(async () => patch);
    await useAppStore.getState().undo();
    await useAppStore.getState().redo();

    expect(castApi.applySnapshotPatch).toHaveBeenNthCalledWith(1, inverse);
    expect(castApi.applySnapshotPatch).toHaveBeenNthCalledWith(2, patch);
    expect(castApi.restoreFromSnapshot).not.toHaveBeenCalled();
    expect(useAppStore.getState().snapshot?.presentations[0]?.title).toBe('Deck Renamed');
    expect(useAppStore.getState().canUndo).toBe(true);
    expect(useAppStore.getState().canRedo).toBe(false);
  });

  it('uses restoreFromSnapshot for snapshot-backed undo and redo entries', async () => {
    const before = makeSnapshot({ presentations: [makePresentation('presentation-1', 'Deck')] });
    const after = makeSnapshot({ presentations: [makePresentation('presentation-1', 'Deck Renamed')] });
    const { castApi, useAppStore } = await loadFreshStore(before);

    await useAppStore.getState().mutate(async () => after);
    await useAppStore.getState().undo();
    await useAppStore.getState().redo();

    expect(castApi.applySnapshotPatch).not.toHaveBeenCalled();
    expect(castApi.restoreFromSnapshot).toHaveBeenNthCalledWith(1, before);
    expect(castApi.restoreFromSnapshot).toHaveBeenNthCalledWith(2, after);
    expect(useAppStore.getState().snapshot).toEqual(after);
    expect(useAppStore.getState().canUndo).toBe(true);
    expect(useAppStore.getState().canRedo).toBe(false);
  });

  it('keeps snapshot and history unchanged when applySnapshotPatch IPC fails during undo', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const before = makeSnapshot({ presentations: [makePresentation('presentation-1', 'Deck')] });
    const afterPresentation = makePresentation('presentation-1', 'Deck Renamed');
    const patch: SnapshotPatch = {
      version: 1,
      upserts: { presentations: [afterPresentation] },
      deletes: {},
    };
    const { castApi, useAppStore } = await loadFreshStore(before);

    await useAppStore.getState().mutatePatch(async () => patch);
    castApi.applySnapshotPatch.mockRejectedValueOnce(new Error('apply failed'));

    const snapshotBeforeUndo = useAppStore.getState().snapshot;
    await useAppStore.getState().undo();

    expect(castApi.applySnapshotPatch).toHaveBeenCalledTimes(1);
    expect(castApi.restoreFromSnapshot).not.toHaveBeenCalled();
    expect(useAppStore.getState().snapshot).toEqual(snapshotBeforeUndo);
    expect(useAppStore.getState().canUndo).toBe(true);
    expect(useAppStore.getState().canRedo).toBe(false);
    expect(useAppStore.getState().statusText).toBe('Undo failed');
    consoleError.mockRestore();
  });

  it('serializes background patches behind a pending mutatePatch result instead of overwriting them', async () => {
    const before = makeSnapshot({
      presentations: [makePresentation('presentation-1', 'Deck')],
      mediaAssets: [makeMediaAsset('asset-1')],
    });
    const deferred = createDeferred<SnapshotPatch>();
    const backgroundPatch: SnapshotPatch = {
      version: 1,
      upserts: {
        mediaAssets: [makeMediaAsset('asset-1', {
          width: 1920,
          height: 1080,
          updatedAt: '2024-01-02T00:00:00.000Z',
        })],
      },
      deletes: {},
    };
    const userPatch: SnapshotPatch = {
      version: 1,
      upserts: { presentations: [makePresentation('presentation-1', 'Deck Renamed')] },
      deletes: {},
    };
    const { useAppStore } = await loadFreshStore(before);

    const mutation = useAppStore.getState().mutatePatch(async () => deferred.promise);
    const background = useAppStore.getState().applyPatchLocally(backgroundPatch);
    deferred.resolve(userPatch);

    await mutation;
    await background;

    expect(useAppStore.getState().snapshot?.presentations[0]?.title).toBe('Deck Renamed');
    expect(useAppStore.getState().snapshot?.mediaAssets[0]?.width).toBe(1920);
    expect(useAppStore.getState().snapshot?.mediaAssets[0]?.height).toBe(1080);
  });

  it('serializes background patches behind a pending mutate result instead of overwriting them', async () => {
    const before = makeSnapshot({
      presentations: [makePresentation('presentation-1', 'Deck')],
      mediaAssets: [makeMediaAsset('asset-1')],
    });
    const deferred = createDeferred<AppSnapshot>();
    const backgroundPatch: SnapshotPatch = {
      version: 1,
      upserts: {
        mediaAssets: [makeMediaAsset('asset-1', {
          width: 1280,
          height: 720,
          updatedAt: '2024-01-02T00:00:00.000Z',
        })],
      },
      deletes: {},
    };
    const after = makeSnapshot({
      presentations: [makePresentation('presentation-1', 'Deck Renamed')],
      mediaAssets: [makeMediaAsset('asset-1')],
    });
    const { useAppStore } = await loadFreshStore(before);

    const mutation = useAppStore.getState().mutate(async () => deferred.promise);
    const background = useAppStore.getState().applyPatchLocally(backgroundPatch);
    deferred.resolve(after);

    await mutation;
    await background;

    expect(useAppStore.getState().snapshot?.presentations[0]?.title).toBe('Deck Renamed');
    expect(useAppStore.getState().snapshot?.mediaAssets[0]?.width).toBe(1280);
    expect(useAppStore.getState().snapshot?.mediaAssets[0]?.height).toBe(720);
  });

  it('defers background patches that arrive before the initial snapshot finishes loading', async () => {
    vi.resetModules();
    window.localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });
    const deferredSnapshot = createDeferred<AppSnapshot>();
    (window as unknown as { castApi: unknown }).castApi = {
      getSnapshot: vi.fn(() => deferredSnapshot.promise),
      applySnapshotPatch: vi.fn().mockResolvedValue(undefined),
      restoreFromSnapshot: vi.fn(),
      setNdiOutputEnabled: vi.fn(),
      updateNdiOutputConfig: vi.fn(),
    };

    const module = await import('./app-store');
    const loading = module.useAppStore.getState().retrySnapshotLoad();
    const background = module.useAppStore.getState().applyPatchLocally({
      version: 1,
      upserts: {
        mediaAssets: [makeMediaAsset('asset-1', {
          width: 640,
          height: 360,
          updatedAt: '2024-01-02T00:00:00.000Z',
        })],
      },
      deletes: {},
    });

    deferredSnapshot.resolve(makeSnapshot({
      mediaAssets: [makeMediaAsset('asset-1')],
    }));

    await background;
    await loading;

    expect(module.useAppStore.getState().snapshot?.mediaAssets[0]?.width).toBe(640);
    expect(module.useAppStore.getState().snapshot?.mediaAssets[0]?.height).toBe(360);
  });

  it('drops a stale deferred derivative patch after a full snapshot replacement changes the media source', async () => {
    const oldAsset = makeMediaAsset('asset-1', { src: 'cast-media://old-source' });
    const replacementAsset = makeMediaAsset('asset-1', {
      src: 'cast-media://new-source',
      updatedAt: '2024-01-03T00:00:00.000Z',
    });
    const before = makeSnapshot({ mediaAssets: [oldAsset] });
    const deferred = createDeferred<AppSnapshot>();
    const stalePatch: SnapshotPatch = {
      version: 1,
      upserts: {
        mediaAssets: [makeMediaAsset('asset-1', {
          src: 'cast-media://old-source',
          width: 1920,
          height: 1080,
          updatedAt: '2024-01-02T00:00:00.000Z',
        })],
      },
      deletes: {},
    };
    const { useAppStore } = await loadFreshStore(before);

    const mutation = useAppStore.getState().mutate(async () => deferred.promise);
    const background = useAppStore.getState().applyPatchLocally(stalePatch);
    deferred.resolve(makeSnapshot({ mediaAssets: [replacementAsset] }));

    await mutation;
    await background;

    expect(useAppStore.getState().snapshot?.mediaAssets).toEqual([replacementAsset]);
  });
});
