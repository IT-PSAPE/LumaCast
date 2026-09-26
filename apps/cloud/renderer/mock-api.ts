// An in-memory `CloudDesktopAPI`, deterministic and self-contained, so the
// renderer runs the same way under `vite`'s browser preview, in tests, and
// (until `window.lumacloud` exists) in the packaged app. It owns its own
// small catalog, simulates install/uninstall progress on a fixed tick, and
// pushes every change through the same `onOverview`/`onOperation` channels
// the real main process will use.
import { compareVersions, suiteApp, type AppRelease, type AppState, type AppStatus, type SuiteAppId } from '@lumacast/suite';
import type {
  CloudDesktopAPI,
  CloudSettingsPatch,
  HostInfo,
  InstallScope,
  OperationSnapshot,
  PermissionGrant,
  SuiteOverview,
} from '../shared/desktop-api';

const TICK_MS = 300;
const DOWNLOAD_TICKS = 5;
const DOWNLOAD_BYTES = 42_000_000;

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function release(app: SuiteAppId, version: string, tag: string, legacy: boolean, publishedAt: string): AppRelease {
  return {
    app,
    version,
    tag,
    legacy,
    publishedAt,
    notesUrl: `https://github.com/IT-PSAPE/LumaCast/releases/tag/${tag}`,
    assets: [],
  };
}

const RELEASES_BY_APP: Record<SuiteAppId, AppRelease[]> = {
  cast: [
    release('cast', '0.1.27', 'cast-v0.1.27', false, daysAgo(1)),
    release('cast', '0.1.26', 'cast-v0.1.26', false, daysAgo(9)),
    release('cast', '0.1.20', 'cast-v0.1.20', false, daysAgo(40)),
    release('cast', '0.1.0', 'v0.1.0', true, daysAgo(210)),
  ],
  flux: [
    release('flux', '0.11.0+1', 'flux-v0.11.0+1', false, daysAgo(3)),
    release('flux', '0.10.0', 'flux-v0.10.0', false, daysAgo(30)),
  ],
  cloud: [release('cloud', '0.1.0', 'cloud-v0.1.0', false, daysAgo(14))],
};

function computeStatus(app: SuiteAppId, installedVersion: string | null, latest: AppRelease | null): AppStatus {
  if (!installedVersion) return 'not-installed';
  if (!latest) return 'unknown';
  const comparison = compareVersions(installedVersion, latest.version, suiteApp(app).versionScheme);
  if (comparison === 0) return 'up-to-date';
  return comparison < 0 ? 'update-available' : 'ahead';
}

function installLocationFor(app: SuiteAppId, scope: InstallScope, host: HostInfo): string {
  const descriptor = suiteApp(app);
  const base = host.installLocations[scope];
  if (host.platform === 'darwin') return `${base}/${descriptor.mac.bundleName}`;
  if (host.platform === 'win32') return `${base}\\${descriptor.win.executableName}`;
  return `${base}/${descriptor.linux.executableName}`;
}

function buildInitialAppState(app: SuiteAppId, installedVersion: string | null, host: HostInfo): AppState {
  const releases = RELEASES_BY_APP[app];
  const latest = releases[0] ?? null;
  return {
    app,
    status: computeStatus(app, installedVersion, latest),
    installed: installedVersion
      ? { app, version: installedVersion, location: installLocationFor(app, 'user', host), scope: 'user' }
      : null,
    latest,
    releases,
  };
}

export function createMockApi(): CloudDesktopAPI {
  const host: HostInfo = {
    platform: 'darwin',
    arch: 'arm64',
    cloudVersion: '0.1.0',
    packaged: false,
    installLocations: {
      user: '/Users/nico/Applications',
      system: '/Applications',
    },
    systemScopeWritable: true,
  };

  const overview: SuiteOverview = {
    host,
    settings: {
      installScope: 'user',
      checkOnLaunch: true,
      grants: [],
    },
    catalog: {
      status: 'ready',
      fetchedAt: daysAgo(0),
      error: null,
    },
    apps: [
      buildInitialAppState('cast', '0.1.26', host),
      buildInitialAppState('flux', null, host),
      buildInitialAppState('cloud', host.cloudVersion, host),
    ],
    selfUpdate: {
      status: 'up-to-date',
      availableVersion: null,
      percent: null,
      error: null,
      checkedAt: daysAgo(1),
    },
  };

  const operationsById = new Map<string, OperationSnapshot>();
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  const overviewListeners = new Set<(overview: SuiteOverview) => void>();
  const operationListeners = new Set<(operation: OperationSnapshot) => void>();
  let operationSequence = 0;

  function cloneOverview(): SuiteOverview {
    return {
      host: { ...overview.host, installLocations: { ...overview.host.installLocations } },
      settings: { ...overview.settings, grants: overview.settings.grants.map((grant) => ({ ...grant })) },
      catalog: { ...overview.catalog },
      apps: overview.apps.map((state) => ({
        ...state,
        installed: state.installed ? { ...state.installed } : null,
        latest: state.latest ? { ...state.latest } : null,
        releases: state.releases.map((entry) => ({ ...entry })),
      })),
      selfUpdate: { ...overview.selfUpdate },
    };
  }

  function notifyOverview(): void {
    const snapshot = cloneOverview();
    overviewListeners.forEach((listener) => listener(snapshot));
  }

  function notifyOperation(operation: OperationSnapshot): void {
    const snapshot: OperationSnapshot = { ...operation, progress: { ...operation.progress } };
    operationListeners.forEach((listener) => listener(snapshot));
  }

  function findAppState(app: SuiteAppId): AppState {
    const state = overview.apps.find((entry) => entry.app === app);
    if (!state) throw new Error(`Unknown suite app "${app}"`);
    return state;
  }

  function clearTimer(operationId: string): void {
    const timer = timers.get(operationId);
    if (timer) {
      clearInterval(timer);
      timers.delete(operationId);
    }
  }

  function createOperation(app: SuiteAppId, kind: OperationSnapshot['kind'], version: string): OperationSnapshot {
    operationSequence += 1;
    const operation: OperationSnapshot = {
      id: `op-${operationSequence}`,
      app,
      kind,
      version,
      status: 'queued',
      progress: {
        transferred: 0,
        total: kind === 'uninstall' ? null : DOWNLOAD_BYTES,
        percent: kind === 'uninstall' ? null : 0,
        bytesPerSecond: null,
      },
      error: null,
      startedAt: nowIso(),
      finishedAt: null,
    };
    operationsById.set(operation.id, operation);
    notifyOperation(operation);
    return operation;
  }

  function applyInstalled(app: SuiteAppId, version: string): void {
    const state = findAppState(app);
    state.installed = { app, version, location: installLocationFor(app, overview.settings.installScope, host), scope: overview.settings.installScope };
    state.status = computeStatus(app, version, state.latest);
    notifyOverview();
  }

  function applyUninstalled(app: SuiteAppId): void {
    const state = findAppState(app);
    state.installed = null;
    state.status = 'not-installed';
    notifyOverview();
  }

  function simulateInstall(operation: OperationSnapshot, targetVersion: string): void {
    let step = 0;
    const timer = setInterval(() => {
      const current = operationsById.get(operation.id);
      if (!current || current.status === 'cancelled') {
        clearTimer(operation.id);
        return;
      }

      if (current.status === 'queued') {
        current.status = 'downloading';
      } else if (current.status === 'downloading') {
        step += 1;
        const total = current.progress.total ?? DOWNLOAD_BYTES;
        const transferred = Math.min(total, Math.round((total * step) / DOWNLOAD_TICKS));
        current.progress = {
          transferred,
          total,
          percent: Math.round((transferred / total) * 100),
          bytesPerSecond: Math.round(total / DOWNLOAD_TICKS / (TICK_MS / 1000)),
        };
        if (transferred >= total) current.status = 'verifying';
      } else if (current.status === 'verifying') {
        current.status = 'installing';
      } else if (current.status === 'installing') {
        current.status = 'done';
        current.finishedAt = nowIso();
        current.progress = { ...current.progress, percent: 100 };
        operationsById.set(current.id, current);
        notifyOperation(current);
        applyInstalled(current.app, targetVersion);
        clearTimer(operation.id);
        return;
      }

      operationsById.set(current.id, current);
      notifyOperation(current);
    }, TICK_MS);
    timers.set(operation.id, timer);
  }

  function simulateUninstall(operation: OperationSnapshot): void {
    let tick = 0;
    const timer = setInterval(() => {
      const current = operationsById.get(operation.id);
      if (!current || current.status === 'cancelled') {
        clearTimer(operation.id);
        return;
      }

      if (current.status === 'queued') {
        current.status = 'removing';
      } else {
        tick += 1;
        if (tick >= 2) {
          current.status = 'done';
          current.finishedAt = nowIso();
          operationsById.set(current.id, current);
          notifyOperation(current);
          applyUninstalled(current.app);
          clearTimer(operation.id);
          return;
        }
      }

      operationsById.set(current.id, current);
      notifyOperation(current);
    }, TICK_MS);
    timers.set(operation.id, timer);
  }

  return {
    async overview() {
      return cloneOverview();
    },

    async refresh() {
      overview.catalog = { status: 'ready', fetchedAt: nowIso(), error: null };
      notifyOverview();
      return cloneOverview();
    },

    async releases(app) {
      return RELEASES_BY_APP[app].map((entry) => ({ ...entry }));
    },

    async grant(app) {
      if (!overview.settings.grants.some((grant) => grant.app === app)) {
        const descriptor = suiteApp(app);
        const grant: PermissionGrant = { bundleId: descriptor.bundleId, app, grantedAt: nowIso() };
        overview.settings = { ...overview.settings, grants: [...overview.settings.grants, grant] };
        notifyOverview();
      }
      return { ...overview.settings, grants: overview.settings.grants.map((grant) => ({ ...grant })) };
    },

    async revoke(app) {
      overview.settings = { ...overview.settings, grants: overview.settings.grants.filter((grant) => grant.app !== app) };
      notifyOverview();
      return { ...overview.settings, grants: overview.settings.grants.map((grant) => ({ ...grant })) };
    },

    async updateSettings(patch: CloudSettingsPatch) {
      overview.settings = { ...overview.settings, ...patch };
      notifyOverview();
      return { ...overview.settings, grants: overview.settings.grants.map((grant) => ({ ...grant })) };
    },

    async install(app, version) {
      const state = findAppState(app);
      const releases = RELEASES_BY_APP[app];
      const target = version ? releases.find((entry) => entry.version === version) : releases[0];
      if (!target) throw new Error(`No release ${version ?? '(latest)'} found for "${app}"`);

      const kind: OperationSnapshot['kind'] = !state.installed
        ? 'install'
        : compareVersions(target.version, state.installed.version, suiteApp(app).versionScheme) < 0
          ? 'downgrade'
          : 'update';

      const operation = createOperation(app, kind, target.version);
      simulateInstall(operation, target.version);
      return { ...operation };
    },

    async uninstall(app, _options) {
      const state = findAppState(app);
      if (!state.installed) throw new Error(`"${app}" is not installed`);
      const operation = createOperation(app, 'uninstall', state.installed.version);
      simulateUninstall(operation);
      return { ...operation };
    },

    async cancel(operationId) {
      const current = operationsById.get(operationId);
      if (!current) return;
      clearTimer(operationId);
      if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') return;
      current.status = 'cancelled';
      current.finishedAt = nowIso();
      operationsById.set(operationId, current);
      notifyOperation(current);
    },

    async operations() {
      return Array.from(operationsById.values()).map((operation) => ({ ...operation }));
    },

    async open() {},
    async reveal() {},
    async openReleaseNotes() {},

    async checkForSelfUpdate() {
      overview.selfUpdate = { ...overview.selfUpdate, status: 'checking' };
      notifyOverview();
      await delay(TICK_MS);
      overview.selfUpdate = {
        status: 'up-to-date',
        availableVersion: null,
        percent: null,
        error: null,
        checkedAt: nowIso(),
      };
      notifyOverview();
      return { ...overview.selfUpdate };
    },

    async installSelfUpdate() {
      if (overview.selfUpdate.status !== 'available') return;
      overview.selfUpdate = { ...overview.selfUpdate, status: 'downloading', percent: 0 };
      notifyOverview();
      await delay(TICK_MS);
      overview.selfUpdate = { ...overview.selfUpdate, status: 'ready', percent: 100 };
      notifyOverview();
    },

    onOverview(callback) {
      overviewListeners.add(callback);
      return () => overviewListeners.delete(callback);
    },

    onOperation(callback) {
      operationListeners.add(callback);
      return () => operationListeners.delete(callback);
    },
  };
}
