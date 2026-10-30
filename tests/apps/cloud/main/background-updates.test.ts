import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppState, SuiteAppId } from '@lumacast/suite';
import type {
  SelfUpdateState,
  SuiteOverview,
} from '../../../../apps/cloud/shared/desktop-api';
import { BackgroundUpdateMonitor } from '../../../../apps/cloud/main/background-updates';

function appState(
  app: SuiteAppId,
  status: AppState['status'],
  version: string | null,
): AppState {
  const latest = version
    ? {
        app,
        version,
        tag: `${app}-v${version}`,
        legacy: false,
        publishedAt: '2026-01-01T00:00:00.000Z',
        notesUrl: `https://github.com/IT-PSAPE/LumaCast/releases/tag/${app}-v${version}`,
        assets: [],
      }
    : null;
  return {
    app,
    status,
    installed:
      status === 'not-installed'
        ? null
        : { app, version: '1.0.0', location: '/apps', scope: 'user' },
    latest,
    releases: latest ? [latest] : [],
  };
}

function overview(options: {
  fetchedAt: string | null;
  catalogStatus?: SuiteOverview['catalog']['status'];
  apps?: AppState[];
  selfUpdate?: SelfUpdateState;
}): SuiteOverview {
  return {
    host: {
      platform: 'linux',
      arch: 'x64',
      cloudVersion: '0.1.0',
      packaged: true,
      installLocations: { user: '/home/user', system: '/opt' },
      systemScopeWritable: false,
    },
    settings: {
      installScope: 'user',
      checkOnLaunch: true,
      checkInBackground: true,
      grants: [],
    },
    catalog: {
      status: options.catalogStatus ?? 'ready',
      fetchedAt: options.fetchedAt,
      error: null,
    },
    apps: options.apps ?? [],
    selfUpdate: options.selfUpdate ?? {
      status: 'idle',
      availableVersion: null,
      percent: null,
      error: null,
      checkedAt: null,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('apps/cloud BackgroundUpdateMonitor', () => {
  it('notifies once per newly available version after a successful catalog refresh', async () => {
    let fetchNumber = 1;
    const current = () =>
      overview({
        fetchedAt: `2026-01-01T00:00:0${fetchNumber}.000Z`,
        apps: [
          appState(
            'cast',
            'update-available',
            fetchNumber > 2 ? '1.2.0' : '1.1.0',
          ),
        ],
      });
    const refresh = vi.fn(async () => {
      fetchNumber += 1;
      return current();
    });
    const notify = vi.fn();
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: overview({
        fetchedAt: '2026-01-01T00:00:00.000Z',
        apps: [appState('cast', 'up-to-date', '1.0.0')],
      }),
      refresh,
      notify,
    });
    monitor.setEnabled(true);

    await monitor.checkNow();
    await monitor.checkNow();
    await monitor.checkNow();

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, {
      appName: 'LumaCast',
      version: '1.1.0',
    });
    expect(notify).toHaveBeenNthCalledWith(2, {
      appName: 'LumaCast',
      version: '1.2.0',
    });
  });

  it('does not notify on cached state or failed catalog checks', () => {
    const notify = vi.fn();
    const initial = overview({
      fetchedAt: '2026-01-01T00:00:00.000Z',
      apps: [appState('cast', 'up-to-date', '1.0.0')],
    });
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: initial,
      refresh: vi.fn(),
      notify,
    });
    monitor.setEnabled(true);

    monitor.observeOverview(
      overview({
        fetchedAt: initial.catalog.fetchedAt,
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );
    monitor.observeOverview(
      overview({
        fetchedAt: initial.catalog.fetchedAt,
        catalogStatus: 'error',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );

    expect(notify).not.toHaveBeenCalled();

    monitor.observeOverview(
      overview({
        fetchedAt: '2026-01-01T00:00:01.000Z',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );
    expect(notify).toHaveBeenCalledOnce();
  });

  it('notifies once when the first fresh catalog confirms an update already in the cache', () => {
    const notify = vi.fn();
    const cached = overview({
      fetchedAt: '2026-01-01T00:00:00.000Z',
      apps: [appState('cast', 'update-available', '1.1.0')],
    });
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: cached,
      refresh: vi.fn(),
      notify,
    });
    monitor.setEnabled(true);

    monitor.observeOverview(
      overview({
        fetchedAt: '2026-01-01T00:00:01.000Z',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );
    monitor.observeOverview(
      overview({
        fetchedAt: '2026-01-01T00:00:02.000Z',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      appName: 'LumaCast',
      version: '1.1.0',
    });
    monitor.stop();
  });

  it('does not consume an app update found while background notifications are disabled', () => {
    const notify = vi.fn();
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: overview({ fetchedAt: null }),
      refresh: vi.fn(),
      notify,
    });

    monitor.observeOverview(
      overview({
        fetchedAt: '2026-01-01T00:00:01.000Z',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );
    expect(notify).not.toHaveBeenCalled();

    monitor.setEnabled(true);
    monitor.observeOverview(
      overview({
        fetchedAt: '2026-01-01T00:00:02.000Z',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );
    monitor.observeOverview(
      overview({
        fetchedAt: '2026-01-01T00:00:03.000Z',
        apps: [appState('cast', 'update-available', '1.1.0')],
      }),
    );

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      appName: 'LumaCast',
      version: '1.1.0',
    });
    monitor.stop();
  });

  it('does not consume a Cloud update found while background notifications are disabled', () => {
    const notify = vi.fn();
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: overview({ fetchedAt: null }),
      refresh: vi.fn(),
      notify,
    });
    const available: SelfUpdateState = {
      status: 'available',
      availableVersion: '0.2.0',
      percent: null,
      error: null,
      checkedAt: null,
    };

    monitor.observeSelfUpdate(available);
    expect(notify).not.toHaveBeenCalled();

    monitor.setEnabled(true);
    monitor.observeSelfUpdate(available);
    monitor.observeSelfUpdate(available);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      appName: 'LumaCloud',
      version: '0.2.0',
    });
    monitor.stop();
  });

  it('runs background checks on its interval, stops when disabled, and permits manual checks', async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => overview({ fetchedAt: null }));
    const checkSelfUpdate = vi.fn(async (): Promise<SelfUpdateState> => ({
      status: 'up-to-date',
      availableVersion: null,
      percent: null,
      error: null,
      checkedAt: null,
    }));
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: overview({ fetchedAt: null }),
      refresh,
      checkSelfUpdate,
      notify: vi.fn(),
      intervalMs: 1000,
    });

    monitor.setEnabled(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledOnce();
    expect(checkSelfUpdate).toHaveBeenCalledOnce();

    monitor.setEnabled(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(refresh).toHaveBeenCalledOnce();
    expect(checkSelfUpdate).toHaveBeenCalledOnce();

    await monitor.checkNow();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(checkSelfUpdate).toHaveBeenCalledOnce();
    monitor.stop();
  });

  it('coalesces overlapping checks and deduplicates Cloud self-update notices', async () => {
    let resolveRefresh!: (value: SuiteOverview) => void;
    const refresh = vi.fn(
      () =>
        new Promise<SuiteOverview>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    const notify = vi.fn();
    const monitor = new BackgroundUpdateMonitor({
      initialOverview: overview({ fetchedAt: null }),
      refresh,
      notify,
    });
    monitor.setEnabled(true);

    const first = monitor.checkNow();
    const second = monitor.checkNow();
    expect(refresh).toHaveBeenCalledOnce();
    resolveRefresh(overview({ fetchedAt: '2026-01-01T00:00:01.000Z' }));
    await Promise.all([first, second]);

    const available: SelfUpdateState = {
      status: 'available',
      availableVersion: '0.2.0',
      percent: null,
      error: null,
      checkedAt: null,
    };
    monitor.observeSelfUpdate(available);
    monitor.observeSelfUpdate(available);
    monitor.observeSelfUpdate({ ...available, availableVersion: '0.3.0' });

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, {
      appName: 'LumaCloud',
      version: '0.2.0',
    });
    expect(notify).toHaveBeenNthCalledWith(2, {
      appName: 'LumaCloud',
      version: '0.3.0',
    });
  });
});
