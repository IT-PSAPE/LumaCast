import { describe, expect, it, vi, type Mock } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  CloudDesktopAPI,
  OperationSnapshot,
  SuiteOverview,
} from '../../../../../apps/cloud/shared/desktop-api';
import { useSuite } from '../../../../../apps/cloud/renderer/hooks/use-suite';

function makeOverview(overrides: Partial<SuiteOverview> = {}): SuiteOverview {
  return {
    host: {
      platform: 'darwin',
      arch: 'arm64',
      cloudVersion: '0.1.0',
      packaged: false,
      installLocations: { user: '/Users/mock/Applications', system: '/Applications' },
      systemScopeWritable: true,
    },
    settings: { installScope: 'user', checkOnLaunch: true, checkInBackground: true, grants: [] },
    catalog: { status: 'ready', fetchedAt: '2026-09-26T00:00:00.000Z', error: null },
    apps: [],
    selfUpdate: { status: 'up-to-date', availableVersion: null, percent: null, error: null, checkedAt: null },
    ...overrides,
  };
}

function makeOperation(overrides: Partial<OperationSnapshot> = {}): OperationSnapshot {
  return {
    id: 'op-1',
    app: 'cast',
    kind: 'install',
    version: '0.1.27',
    status: 'downloading',
    progress: { transferred: 0, total: 1000, percent: 0, bytesPerSecond: null },
    error: null,
    startedAt: '2026-09-26T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

interface FakeApi {
  api: CloudDesktopAPI;
  refreshMock: Mock<CloudDesktopAPI['refresh']>;
  emitOverview: (overview: SuiteOverview) => void;
  emitOperation: (operation: OperationSnapshot) => void;
  overviewListenerCount: () => number;
  operationListenerCount: () => number;
}

function createFakeApi(initialOverview: SuiteOverview): FakeApi {
  const overviewListeners = new Set<(overview: SuiteOverview) => void>();
  const operationListeners = new Set<(operation: OperationSnapshot) => void>();
  const refreshMock = vi.fn(async () => initialOverview);

  const api: CloudDesktopAPI = {
    overview: vi.fn(async () => initialOverview),
    refresh: refreshMock,
    releases: vi.fn(async () => []),
    grant: vi.fn(async () => initialOverview.settings),
    revoke: vi.fn(async () => initialOverview.settings),
    updateSettings: vi.fn(async () => initialOverview.settings),
    install: vi.fn(async () => makeOperation()),
    uninstall: vi.fn(async () => makeOperation()),
    cancel: vi.fn(async () => {}),
    operations: vi.fn(async () => []),
    open: vi.fn(async () => {}),
    reveal: vi.fn(async () => {}),
    openReleaseNotes: vi.fn(async () => {}),
    checkForSelfUpdate: vi.fn(async () => initialOverview.selfUpdate),
    installSelfUpdate: vi.fn(async () => {}),
    onOverview: vi.fn((callback: (overview: SuiteOverview) => void) => {
      overviewListeners.add(callback);
      return () => overviewListeners.delete(callback);
    }),
    onOperation: vi.fn((callback: (operation: OperationSnapshot) => void) => {
      operationListeners.add(callback);
      return () => operationListeners.delete(callback);
    }),
  };

  return {
    api,
    refreshMock,
    emitOverview: (overview) => overviewListeners.forEach((listener) => listener(overview)),
    emitOperation: (operation) => operationListeners.forEach((listener) => listener(operation)),
    overviewListenerCount: () => overviewListeners.size,
    operationListenerCount: () => operationListeners.size,
  };
}

describe('useSuite', () => {
  it('loads the initial overview from the api', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);

    const { result } = renderHook(() => useSuite(fake.api));

    expect(result.current.overview).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.overview).toEqual(initial));
    expect(fake.api.overview).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('applies a pushed overview update from onOverview', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);
    const { result } = renderHook(() => useSuite(fake.api));

    await waitFor(() => expect(result.current.overview).toEqual(initial));

    const updated = makeOverview({ catalog: { status: 'error', fetchedAt: null, error: 'network down' } });
    act(() => fake.emitOverview(updated));

    await waitFor(() => expect(result.current.overview).toEqual(updated));
  });

  it('merges pushed operations, newest first by startedAt', async () => {
    const fake = createFakeApi(makeOverview());
    const { result } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).not.toBeNull());

    const older = makeOperation({ id: 'op-older', startedAt: '2026-09-26T00:00:00.000Z' });
    const newer = makeOperation({ id: 'op-newer', startedAt: '2026-09-26T01:00:00.000Z' });
    act(() => {
      fake.emitOperation(older);
      fake.emitOperation(newer);
    });

    await waitFor(() => expect(result.current.operations.map((operation) => operation.id)).toEqual(['op-newer', 'op-older']));

    const updatedOlder = { ...older, status: 'done' as const };
    act(() => fake.emitOperation(updatedOlder));
    await waitFor(() =>
      expect(result.current.operations.find((operation) => operation.id === 'op-older')?.status).toBe('done'),
    );
    expect(result.current.operations).toHaveLength(2);
  });

  it('unsubscribes from both channels on unmount', async () => {
    const fake = createFakeApi(makeOverview());
    const { result, unmount } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).not.toBeNull());

    expect(fake.overviewListenerCount()).toBe(1);
    expect(fake.operationListenerCount()).toBe(1);

    unmount();

    expect(fake.overviewListenerCount()).toBe(0);
    expect(fake.operationListenerCount()).toBe(0);
  });

  it('refresh() calls the api and applies the returned overview', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);
    const refreshed = makeOverview({ catalog: { status: 'ready', fetchedAt: '2026-09-26T02:00:00.000Z', error: null } });
    fake.refreshMock.mockResolvedValueOnce(refreshed);

    const { result } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).toEqual(initial));

    await act(async () => { await result.current.refresh(); });

    await waitFor(() => expect(result.current.overview).toEqual(refreshed));
  });
});

describe('useSuite recovery and response authority', () => {
  it('reports a failed initial overview and retries local snapshots without refreshing the catalog', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);
    vi.mocked(fake.api.overview).mockRejectedValueOnce(new Error('Bridge unavailable'));
    const { result } = renderHook(() => useSuite(fake.api));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.overview).toBeNull();
    expect(result.current.error).toEqual({ source: 'overview', message: 'Could not load apps. Bridge unavailable' });

    await act(async () => { await result.current.retry(); });

    expect(result.current.overview).toEqual(initial);
    expect(result.current.error).toBeNull();
    expect(fake.api.overview).toHaveBeenCalledTimes(2);
    expect(fake.api.operations).toHaveBeenCalledTimes(2);
    expect(fake.api.refresh).not.toHaveBeenCalled();
  });

  it('keeps a usable overview when activity fails and recovers the missing history on retry', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);
    vi.mocked(fake.api.operations).mockRejectedValueOnce(new Error('History unavailable'));
    const { result } = renderHook(() => useSuite(fake.api));

    await waitFor(() => expect(result.current.error?.source).toBe('operations'));
    expect(result.current.overview).toEqual(initial);
    expect(result.current.loading).toBe(false);

    const history = makeOperation();
    vi.mocked(fake.api.operations).mockResolvedValueOnce([history]);
    await act(async () => { await result.current.retry(); });

    expect(result.current.operations).toEqual([history]);
    expect(result.current.error).toBeNull();
  });

  it.each(['success', 'failure'] as const)('keeps pushed overview data when the initial reply is a delayed %s', async (outcome) => {
    const initial = deferred<SuiteOverview>();
    const fake = createFakeApi(makeOverview());
    vi.mocked(fake.api.overview).mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useSuite(fake.api));
    const pushed = makeOverview({ host: { ...makeOverview().host, cloudVersion: '2.0.0' } });

    act(() => fake.emitOverview(pushed));
    await act(async () => {
      if (outcome === 'success') initial.resolve(makeOverview());
      else initial.reject(new Error('Stale failure'));
    });

    expect(result.current.overview).toEqual(pushed);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('merges a delayed operation snapshot with newer events without dropping unrelated history', async () => {
    const initial = deferred<OperationSnapshot[]>();
    const fake = createFakeApi(makeOverview());
    vi.mocked(fake.api.operations).mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useSuite(fake.api));
    const oldVersion = makeOperation();
    const done = makeOperation({ status: 'done', finishedAt: '2026-09-26T02:00:00.000Z' });
    const unrelated = makeOperation({ id: 'history' });
    const newOperation = makeOperation({ id: 'new-operation' });

    act(() => {
      fake.emitOperation(done);
      fake.emitOperation(newOperation);
    });
    await act(async () => initial.resolve([oldVersion, unrelated]));

    expect(result.current.operations).toHaveLength(3);
    expect(result.current.operations.find((operation) => operation.id === done.id)).toEqual(done);
    expect(result.current.operations).toContainEqual(unrelated);
    expect(result.current.operations).toContainEqual(newOperation);
  });

  it('does not treat an individual operation event as recovery of failed activity history', async () => {
    const initial = deferred<OperationSnapshot[]>();
    const fake = createFakeApi(makeOverview());
    vi.mocked(fake.api.operations).mockReturnValueOnce(initial.promise);
    const { result } = renderHook(() => useSuite(fake.api));
    const pushed = makeOperation();
    act(() => fake.emitOperation(pushed));
    await act(async () => initial.reject(new Error('History unavailable')));

    expect(result.current.operations).toEqual([pushed]);
    expect(result.current.error?.source).toBe('operations');
    expect(result.current.overview).not.toBeNull();
  });

  it('preserves the current overview and reports a refresh failure without rejecting to event callers', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);
    fake.refreshMock.mockRejectedValueOnce(new Error('Network unavailable'));
    const { result } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).toEqual(initial));

    await act(async () => { await expect(result.current.refresh()).resolves.toBeUndefined(); });

    expect(result.current.overview).toEqual(initial);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toEqual({ source: 'refresh', message: 'Could not refresh apps. Network unavailable' });
  });

  it.each(['success', 'failure'] as const)('ignores a delayed refresh %s after a newer pushed overview', async (outcome) => {
    const pending = deferred<SuiteOverview>();
    const fake = createFakeApi(makeOverview());
    fake.refreshMock.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    expect(result.current.refreshing).toBe(true);
    const pushed = makeOverview({ host: { ...makeOverview().host, cloudVersion: '2.0.0' } });
    act(() => fake.emitOverview(pushed));
    await act(async () => {
      if (outcome === 'success') pending.resolve(makeOverview());
      else pending.reject(new Error('Outdated refresh'));
      await refresh;
    });

    expect(result.current.overview).toEqual(pushed);
    expect(result.current.error).toBeNull();
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps the newest refresh result when overlapping requests complete out of order', async () => {
    const first = deferred<SuiteOverview>();
    const second = deferred<SuiteOverview>();
    const fake = createFakeApi(makeOverview());
    fake.refreshMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).not.toBeNull());
    let oldRefresh!: Promise<void>;
    let newRefresh!: Promise<void>;
    act(() => {
      oldRefresh = result.current.refresh();
      newRefresh = result.current.refresh();
    });
    const newest = makeOverview({ host: { ...makeOverview().host, cloudVersion: '3.0.0' } });
    await act(async () => {
      second.resolve(newest);
      await newRefresh;
      first.reject(new Error('Old refresh failed'));
      await oldRefresh;
    });

    expect(result.current.overview).toEqual(newest);
    expect(result.current.error).toBeNull();
  });

  it('keeps a successful retry when the earlier initial request later fails', async () => {
    const oldOverview = deferred<SuiteOverview>();
    const oldOperations = deferred<OperationSnapshot[]>();
    const fake = createFakeApi(makeOverview());
    vi.mocked(fake.api.overview).mockReturnValueOnce(oldOverview.promise);
    vi.mocked(fake.api.operations).mockReturnValueOnce(oldOperations.promise);
    const { result } = renderHook(() => useSuite(fake.api));
    await act(async () => { await result.current.retry(); });
    const current = result.current.overview;
    await act(async () => {
      oldOverview.reject(new Error('Old overview failed'));
      oldOperations.reject(new Error('Old history failed'));
    });

    expect(result.current.overview).toEqual(current);
    expect(result.current.error).toBeNull();
  });

  it('discards the previous API session and ignores its pending responses and captured actions', async () => {
    const oldOverview = deferred<SuiteOverview>();
    const oldOperations = deferred<OperationSnapshot[]>();
    const old = createFakeApi(makeOverview());
    vi.mocked(old.api.overview).mockReturnValueOnce(oldOverview.promise);
    vi.mocked(old.api.operations).mockReturnValueOnce(oldOperations.promise);
    const nextOverview = deferred<SuiteOverview>();
    const next = createFakeApi(makeOverview());
    vi.mocked(next.api.overview).mockReturnValueOnce(nextOverview.promise);
    const { result, rerender } = renderHook(({ api }) => useSuite(api), { initialProps: { api: old.api } });
    const oldActions = { retry: result.current.retry, refresh: result.current.refresh };
    rerender({ api: next.api });

    expect(result.current.overview).toBeNull();
    expect(result.current.operations).toEqual([]);
    expect(result.current.loading).toBe(true);
    expect(old.overviewListenerCount()).toBe(0);
    await act(async () => {
      oldOverview.resolve(makeOverview());
      oldOperations.reject(new Error('Old history failed'));
      await oldActions.retry();
      await oldActions.refresh();
    });
    expect(old.api.overview).toHaveBeenCalledTimes(1);
    expect(old.api.refresh).not.toHaveBeenCalled();
    expect(result.current.overview).toBeNull();
    const current = makeOverview({ host: { ...makeOverview().host, cloudVersion: '4.0.0' } });
    await act(async () => nextOverview.resolve(current));
    expect(result.current.overview).toEqual(current);
    expect(result.current.error).toBeNull();
  });

  it('settles pending work and makes captured actions inert after unmount', async () => {
    const initial = deferred<SuiteOverview>();
    const operations = deferred<OperationSnapshot[]>();
    const refresh = deferred<SuiteOverview>();
    const fake = createFakeApi(makeOverview());
    vi.mocked(fake.api.overview).mockReturnValueOnce(initial.promise);
    vi.mocked(fake.api.operations).mockReturnValueOnce(operations.promise);
    fake.refreshMock.mockReturnValueOnce(refresh.promise);
    const { result, unmount } = renderHook(() => useSuite(fake.api));
    const actions = { retry: result.current.retry, refresh: result.current.refresh };
    let pending!: Promise<void>;
    act(() => { pending = actions.refresh(); });
    unmount();
    await act(async () => {
      initial.reject(new Error('Initial rejected'));
      operations.reject(new Error('History rejected'));
      refresh.reject(new Error('Refresh rejected'));
      await pending;
      await actions.retry();
      await actions.refresh();
    });

    expect(fake.api.overview).toHaveBeenCalledTimes(1);
    expect(fake.api.operations).toHaveBeenCalledTimes(1);
    expect(fake.api.refresh).toHaveBeenCalledTimes(1);
    expect(fake.overviewListenerCount()).toBe(0);
    expect(fake.operationListenerCount()).toBe(0);
  });
});
