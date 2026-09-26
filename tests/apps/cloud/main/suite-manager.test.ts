import { describe, expect, it } from 'vitest';
import { suiteApp, type AppRelease, type HostArch, type HostPlatform, type InstalledApp, type SuiteAppDescriptor, type SuiteAppId } from '@lumacast/suite';
import { SuiteManager, type SuiteCatalog, type SuiteSettingsStore } from '../../../../apps/cloud/main/suite/suite-manager';
import { PermissionError } from '../../../../apps/cloud/main/suite/permissions';
import type { InstallRequest, PlatformAdapter, UninstallRequest } from '../../../../apps/cloud/main/platform/adapter';
import type { CloudSettings, OperationSnapshot, SelfUpdateState } from '../../../../apps/cloud/shared/desktop-api';

class FakeSettingsStore implements SuiteSettingsStore {
  private state: CloudSettings;

  constructor(initial: CloudSettings = { installScope: 'user', checkOnLaunch: true, grants: [] }) {
    this.state = initial;
  }

  get(): CloudSettings {
    return this.state;
  }

  async update(patch: Partial<Pick<CloudSettings, 'installScope' | 'checkOnLaunch'>>): Promise<CloudSettings> {
    this.state = { ...this.state, ...patch };
    return this.state;
  }

  async grant(app: SuiteAppId, bundleId: string): Promise<CloudSettings> {
    if (app === 'cloud') return this.state;
    if (bundleId !== suiteApp(app).bundleId) return this.state;
    if (this.state.grants.some((g) => g.app === app)) return this.state;
    this.state = { ...this.state, grants: [...this.state.grants, { app, bundleId, grantedAt: '2026-01-01T00:00:00.000Z' }] };
    return this.state;
  }

  async revoke(app: SuiteAppId): Promise<CloudSettings> {
    this.state = { ...this.state, grants: this.state.grants.filter((g) => g.app !== app) };
    return this.state;
  }
}

class FakeCatalog implements SuiteCatalog {
  status: SuiteCatalog['status'] = 'idle';
  fetchedAt: string | null = null;
  error: string | null = null;
  private releases = new Map<SuiteAppId, AppRelease[]>();
  refreshCount = 0;

  setReleases(app: SuiteAppId, releases: AppRelease[]): void {
    this.releases.set(app, releases);
  }

  async refresh(): Promise<void> {
    this.refreshCount += 1;
    this.status = 'ready';
    this.fetchedAt = `refresh-${this.refreshCount}`;
    this.error = null;
  }

  releasesFor(app: SuiteAppId): AppRelease[] | null {
    return this.releases.get(app) ?? [];
  }

  async metadataFor(): Promise<never> {
    throw new Error('metadataFor is not exercised by suite-manager tests');
  }
}

class FakeAdapter implements PlatformAdapter {
  readonly platform: HostPlatform = 'darwin';
  private installed = new Map<SuiteAppId, InstalledApp>();
  readonly discoverCalls: SuiteAppId[] = [];
  readonly launchCalls: SuiteAppId[] = [];

  constructor(seed: Partial<Record<SuiteAppId, InstalledApp>> = {}) {
    for (const [app, installedApp] of Object.entries(seed) as [SuiteAppId, InstalledApp][]) {
      this.installed.set(app, installedApp);
    }
  }

  installLocations(): Record<'user' | 'system', string> {
    return { user: '/Users/test/Applications', system: '/Applications' };
  }

  async systemScopeWritable(): Promise<boolean> {
    return true;
  }

  async discover(app: SuiteAppDescriptor): Promise<InstalledApp | null> {
    this.discoverCalls.push(app.id);
    return this.installed.get(app.id) ?? null;
  }

  async install(request: InstallRequest): Promise<InstalledApp> {
    const installedApp: InstalledApp = {
      app: request.app.id,
      version: '9.9.9',
      location: `/Applications/${request.app.mac.bundleName}`,
      scope: request.scope,
    };
    this.installed.set(request.app.id, installedApp);
    return installedApp;
  }

  async uninstall(request: UninstallRequest): Promise<void> {
    this.installed.delete(request.app.id);
  }

  async launch(app: SuiteAppDescriptor): Promise<void> {
    this.launchCalls.push(app.id);
  }

  revealPath(installed: InstalledApp): string {
    return installed.location;
  }
}

function idleSelfUpdate(): SelfUpdateState {
  return { status: 'idle', availableVersion: null, percent: null, error: null, checkedAt: null };
}

function buildManager(opts: {
  settings?: FakeSettingsStore;
  catalog?: FakeCatalog;
  adapter?: FakeAdapter;
  packaged?: boolean;
} = {}) {
  const settings = opts.settings ?? new FakeSettingsStore();
  const catalog = opts.catalog ?? new FakeCatalog();
  const adapter = opts.adapter ?? new FakeAdapter();
  const manager = new SuiteManager({
    settings,
    catalog,
    adapter,
    platform: 'darwin',
    arch: 'arm64' as HostArch,
    packaged: opts.packaged ?? true,
    selfVersion: '0.5.0',
    selfLocation: '/Applications/LumaCloud.app',
    selfUpdate: idleSelfUpdate,
    downloadsDir: '/tmp/lumacloud-test-downloads',
  });
  return { manager, settings, catalog, adapter };
}

describe('apps/cloud SuiteManager overview', () => {
  it('synthesizes Cloud\'s own entry instead of discovering it via the adapter', async () => {
    const { manager, adapter } = buildManager();
    await manager.initialize();

    const overview = manager.overview();
    const cloudState = overview.apps.find((a) => a.app === 'cloud');
    expect(cloudState?.installed).toEqual({
      app: 'cloud',
      version: '0.5.0',
      location: '/Applications/LumaCloud.app',
      scope: 'unknown',
    });
    expect(adapter.discoverCalls).not.toContain('cloud');
  });

  it('composes host, settings, catalog, apps, and self-update into one overview', async () => {
    const installedCast: InstalledApp = { app: 'cast', version: '1.0.0', location: '/Applications/LumaCast.app', scope: 'user' };
    const { manager, catalog } = buildManager({ adapter: new FakeAdapter({ cast: installedCast }) });
    catalog.status = 'ready';
    catalog.fetchedAt = '2026-01-01T00:00:00.000Z';
    catalog.setReleases('cast', [
      {
        app: 'cast',
        version: '1.1.0',
        tag: 'cast-v1.1.0',
        legacy: false,
        publishedAt: null,
        notesUrl: 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.1.0',
        assets: [],
      },
    ]);

    await manager.initialize();
    const overview = manager.overview();

    expect(overview.host.platform).toBe('darwin');
    expect(overview.host.arch).toBe('arm64');
    expect(overview.host.cloudVersion).toBe('0.5.0');
    expect(overview.host.packaged).toBe(true);
    expect(overview.host.installLocations).toEqual({ user: '/Users/test/Applications', system: '/Applications' });
    expect(overview.host.systemScopeWritable).toBe(true);

    expect(overview.settings).toEqual({ installScope: 'user', checkOnLaunch: true, grants: [] });
    expect(overview.catalog).toEqual({ status: 'ready', fetchedAt: '2026-01-01T00:00:00.000Z', error: null });

    const castState = overview.apps.find((a) => a.app === 'cast');
    expect(castState?.status).toBe('update-available');
    expect(castState?.installed).toEqual(installedCast);
    expect(castState?.latest?.version).toBe('1.1.0');

    expect(overview.selfUpdate).toEqual(idleSelfUpdate());
  });

  it('refresh() refreshes the catalog and rescans installs, then emits overview-change', async () => {
    const { manager, catalog, adapter } = buildManager();
    await manager.initialize();

    const events: unknown[] = [];
    manager.on('overview-change', (overview) => events.push(overview));

    adapter.discoverCalls.length = 0;
    await manager.refresh();

    expect(catalog.refreshCount).toBe(1);
    expect(adapter.discoverCalls).toContain('cast');
    expect(events.length).toBeGreaterThan(0);
  });
});

describe('apps/cloud SuiteManager releaseNotesUrl', () => {
  it('returns the notes URL for a known release', async () => {
    const { manager, catalog } = buildManager();
    catalog.setReleases('cast', [
      {
        app: 'cast',
        version: '1.0.0',
        tag: 'cast-v1.0.0',
        legacy: false,
        publishedAt: null,
        notesUrl: 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.0.0',
        assets: [],
      },
    ]);
    await manager.initialize();
    expect(manager.releaseNotesUrl('cast', '1.0.0')).toBe('https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.0.0');
  });

  it('throws for a version not in the catalog', async () => {
    const { manager } = buildManager();
    await manager.initialize();
    expect(() => manager.releaseNotesUrl('cast', '9.9.9')).toThrow(/not in the release catalog/);
  });

  it('refuses a notes URL outside github.com, even from the catalog', async () => {
    const { manager, catalog } = buildManager();
    catalog.setReleases('cast', [
      {
        app: 'cast',
        version: '1.0.0',
        tag: 'cast-v1.0.0',
        legacy: false,
        publishedAt: null,
        notesUrl: 'https://evil.example.com/not-github',
        assets: [],
      },
    ]);
    await manager.initialize();
    expect(() => manager.releaseNotesUrl('cast', '1.0.0')).toThrow(/github\.com/);
  });
});

describe('apps/cloud SuiteManager permission gating', () => {
  it('refuses install/uninstall/open for an ungranted app', async () => {
    const { manager } = buildManager();
    await manager.initialize();

    await expect(manager.install('cast')).rejects.toBeInstanceOf(PermissionError);
    await expect(manager.uninstall('cast')).rejects.toBeInstanceOf(PermissionError);
    await expect(manager.open('cast')).rejects.toBeInstanceOf(PermissionError);
    expect(manager.operations()).toEqual([]);
  });

  it('refuses install/uninstall/open for Cloud itself even nominally "granted"', async () => {
    const { manager } = buildManager();
    await manager.initialize();

    await expect(manager.install('cloud')).rejects.toBeInstanceOf(PermissionError);
    await expect(manager.uninstall('cloud')).rejects.toBeInstanceOf(PermissionError);
    await expect(manager.open('cloud')).rejects.toBeInstanceOf(PermissionError);
  });

  it('allows open() once the app is granted and installed', async () => {
    const installedCast: InstalledApp = { app: 'cast', version: '1.0.0', location: '/Applications/LumaCast.app', scope: 'user' };
    const { manager, settings, adapter } = buildManager({ adapter: new FakeAdapter({ cast: installedCast }) });
    await manager.initialize();
    await settings.grant('cast', suiteApp('cast').bundleId);

    await manager.open('cast');
    expect(adapter.launchCalls).toEqual(['cast']);
  });

  it('open() throws when the app is granted but not installed', async () => {
    const { manager, settings } = buildManager();
    await manager.initialize();
    await settings.grant('cast', suiteApp('cast').bundleId);

    await expect(manager.open('cast')).rejects.toThrow(/not installed/);
  });
});

describe('apps/cloud SuiteManager reveal', () => {
  it('reveals Cloud itself without requiring a grant', async () => {
    const { manager } = buildManager();
    await manager.initialize();
    expect(manager.reveal('cloud')).toBe('/Applications/LumaCloud.app');
  });

  it('reveals an installed app\'s path', async () => {
    const installedCast: InstalledApp = { app: 'cast', version: '1.0.0', location: '/Applications/LumaCast.app', scope: 'user' };
    const { manager } = buildManager({ adapter: new FakeAdapter({ cast: installedCast }) });
    await manager.initialize();
    expect(manager.reveal('cast')).toBe('/Applications/LumaCast.app');
  });

  it('throws revealing an app that is not installed', async () => {
    const { manager } = buildManager();
    await manager.initialize();
    expect(() => manager.reveal('flux')).toThrow(/not installed/);
  });
});

describe('apps/cloud SuiteManager grant/revoke', () => {
  it('grants and revokes, persisting through the injected settings store and emitting overview-change', async () => {
    const { manager, settings } = buildManager();
    await manager.initialize();

    const overviewEvents: unknown[] = [];
    manager.on('overview-change', (overview) => overviewEvents.push(overview));

    const granted = await manager.grant('cast');
    expect(granted.grants.map((g) => g.app)).toEqual(['cast']);
    expect(settings.get().grants.map((g) => g.app)).toEqual(['cast']);

    const revoked = await manager.revoke('cast');
    expect(revoked.grants).toEqual([]);
    expect(overviewEvents.length).toBeGreaterThanOrEqual(2);
  });
});

describe('apps/cloud SuiteManager operation rescans', () => {
  it('rescans installs and emits overview-change after a finished operation', async () => {
    const installedCast: InstalledApp = { app: 'cast', version: '1.0.0', location: '/Applications/LumaCast.app', scope: 'user' };
    const { manager, settings } = buildManager({ adapter: new FakeAdapter({ cast: installedCast }) });
    await manager.initialize();
    await settings.grant('cast', suiteApp('cast').bundleId);

    expect(manager.overview().apps.find((a) => a.app === 'cast')?.installed).not.toBeNull();

    const overviewEvents: unknown[] = [];
    manager.on('overview-change', (overview) => overviewEvents.push(overview));
    const operationEvents: OperationSnapshot[] = [];
    manager.on('operation-change', (operation) => operationEvents.push(operation));

    const queued = await manager.uninstall('cast');

    await new Promise<void>((resolve) => {
      const check = () => {
        const finished = operationEvents.find((op) => op.id === queued.id && op.status === 'done');
        if (finished) {
          resolve();
        } else {
          setTimeout(check, 5);
        }
      };
      check();
    });

    expect(manager.overview().apps.find((a) => a.app === 'cast')?.installed).toBeNull();
    expect(overviewEvents.length).toBeGreaterThan(0);
  });
});
