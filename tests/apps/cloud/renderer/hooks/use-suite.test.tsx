import { describe, expect, it, vi, type Mock } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
    settings: { installScope: 'user', checkOnLaunch: true, grants: [] },
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
    await waitFor(() => expect(result.current.overview).toEqual(initial));
    expect(fake.api.overview).toHaveBeenCalledTimes(1);
  });

  it('applies a pushed overview update from onOverview', async () => {
    const initial = makeOverview();
    const fake = createFakeApi(initial);
    const { result } = renderHook(() => useSuite(fake.api));

    await waitFor(() => expect(result.current.overview).toEqual(initial));

    const updated = makeOverview({ catalog: { status: 'error', fetchedAt: null, error: 'network down' } });
    fake.emitOverview(updated);

    await waitFor(() => expect(result.current.overview).toEqual(updated));
  });

  it('merges pushed operations, newest first by startedAt', async () => {
    const fake = createFakeApi(makeOverview());
    const { result } = renderHook(() => useSuite(fake.api));
    await waitFor(() => expect(result.current.overview).not.toBeNull());

    const older = makeOperation({ id: 'op-older', startedAt: '2026-09-26T00:00:00.000Z' });
    const newer = makeOperation({ id: 'op-newer', startedAt: '2026-09-26T01:00:00.000Z' });
    fake.emitOperation(older);
    fake.emitOperation(newer);

    await waitFor(() => expect(result.current.operations.map((operation) => operation.id)).toEqual(['op-newer', 'op-older']));

    const updatedOlder = { ...older, status: 'done' as const };
    fake.emitOperation(updatedOlder);
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

    await result.current.refresh();

    await waitFor(() => expect(result.current.overview).toEqual(refreshed));
  });
});
