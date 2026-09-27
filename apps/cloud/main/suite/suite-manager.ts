// Composes the suite model into the one object main/ipc.ts talks to: cached
// overview state (host info, settings, catalog status, per-app install
// state, self-update state), the operation queue, and the two push events
// the renderer subscribes to. Everything it depends on is injected as a
// narrow interface (not the concrete classes), so tests drive it with fakes
// instead of real settings files, network access, or a real platform
// adapter.
import { EventEmitter } from 'node:events';
import {
  SUITE_APP_IDS,
  deriveAppState,
  suiteApp,
  type AppRelease,
  type AppState,
  type HostArch,
  type HostPlatform,
  type InstalledApp,
  type SuiteAppId,
  type UpdateMetadata,
} from '@lumacast/suite';
import type {
  CatalogStatus,
  CloudSettings,
  CloudSettingsPatch,
  OperationSnapshot,
  SelfUpdateState,
  SuiteOverview,
  UninstallOptions,
} from '../../shared/desktop-api';
import type { PlatformAdapter } from '../platform/adapter';
import { assertGranted } from './permissions';
import { OperationQueue } from './operations';

const TERMINAL_OPERATION_STATUSES: ReadonlySet<OperationSnapshot['status']> = new Set([
  'done',
  'failed',
  'cancelled',
]);

export interface SuiteSettingsStore {
  get(): CloudSettings;
  update(patch: CloudSettingsPatch): Promise<CloudSettings>;
  grant(app: SuiteAppId, bundleId: string): Promise<CloudSettings>;
  revoke(app: SuiteAppId): Promise<CloudSettings>;
}

export interface SuiteCatalog {
  readonly status: CatalogStatus;
  readonly fetchedAt: string | null;
  readonly error: string | null;
  refresh(): Promise<void>;
  releasesFor(app: SuiteAppId): AppRelease[] | null;
  metadataFor(release: AppRelease, platform: HostPlatform): Promise<UpdateMetadata>;
}

export interface SuiteManagerDeps {
  settings: SuiteSettingsStore;
  catalog: SuiteCatalog;
  adapter: PlatformAdapter;
  platform: HostPlatform;
  arch: HostArch;
  /** `app.isPackaged`. */
  packaged: boolean;
  /** Cloud's own version (`app.getVersion()`) — Cloud is never adapter-discovered. */
  selfVersion: string;
  /** Cloud's own install location (derived from `process.execPath`). */
  selfLocation: string;
  selfUpdate: () => SelfUpdateState;
  downloadsDir: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  idFactory?: () => string;
}

export declare interface SuiteManager {
  on(event: 'overview-change', listener: (overview: SuiteOverview) => void): this;
  on(event: 'operation-change', listener: (operation: OperationSnapshot) => void): this;
  off(event: 'overview-change', listener: (overview: SuiteOverview) => void): this;
  off(event: 'operation-change', listener: (operation: OperationSnapshot) => void): this;
}

export class SuiteManager extends EventEmitter {
  private readonly operationQueue: OperationQueue;
  private appStates: AppState[] = [];
  private systemScopeWritableCache = false;

  constructor(private readonly deps: SuiteManagerDeps) {
    super();

    this.operationQueue = new OperationQueue({
      catalog: {
        releasesFor: (app) => this.deps.catalog.releasesFor(app),
        metadataFor: (release, platform) => this.deps.catalog.metadataFor(release, platform),
      },
      adapter: this.deps.adapter,
      settings: { get: () => this.deps.settings.get() },
      discover: (app) => this.discoverApp(app),
      platform: this.deps.platform,
      arch: this.deps.arch,
      downloadsDir: this.deps.downloadsDir,
      fetch: this.deps.fetch,
      now: this.deps.now,
      idFactory: this.deps.idFactory,
    });

    this.operationQueue.on('change', (operation) => {
      if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
        // Reinstalling/uninstalling/updating changes what's on disk. Rescan
        // *before* telling listeners the operation is done: emitting
        // 'operation-change' first (rescanning only afterwards, in the
        // background) let a caller that reacts to the terminal status —
        // including `overview()` read synchronously right after seeing
        // 'done' — observe stale install state, since the rescan is an
        // async install-discovery pass that hadn't finished yet.
        // A failed rescan must not swallow the terminal event: listeners still
        // learn the operation ended, on the previous install view.
        void this.rescanInstalls()
          .catch((error) => {
            console.error('[suite-manager] rescan after operation failed', error);
          })
          .then(() => {
            this.emit('operation-change', operation);
            this.emitOverviewChange();
          });
      } else {
        this.emit('operation-change', operation);
      }
    });
  }

  /** Runs the initial install scan. Call once at startup before serving `overview()`. */
  async initialize(): Promise<SuiteOverview> {
    try {
      await this.rescanInstalls();
    } catch (error) {
      console.error('[suite-manager] initial install scan failed', error);
    }
    return this.overview();
  }

  overview(): SuiteOverview {
    return {
      host: {
        platform: this.deps.platform,
        arch: this.deps.arch,
        cloudVersion: this.deps.selfVersion,
        packaged: this.deps.packaged,
        installLocations: this.deps.adapter.installLocations(),
        systemScopeWritable: this.systemScopeWritableCache,
      },
      settings: this.deps.settings.get(),
      catalog: {
        status: this.deps.catalog.status,
        fetchedAt: this.deps.catalog.fetchedAt,
        error: this.deps.catalog.error,
      },
      apps: this.appStates,
      selfUpdate: this.deps.selfUpdate(),
    };
  }

  async refresh(): Promise<SuiteOverview> {
    await this.deps.catalog.refresh();
    await this.rescanInstalls();
    this.emitOverviewChange();
    return this.overview();
  }

  releases(app: SuiteAppId): AppRelease[] {
    return this.deps.catalog.releasesFor(app) ?? [];
  }

  async grant(app: SuiteAppId): Promise<CloudSettings> {
    const settings = await this.deps.settings.grant(app, suiteApp(app).bundleId);
    this.emitOverviewChange();
    return settings;
  }

  async revoke(app: SuiteAppId): Promise<CloudSettings> {
    const settings = await this.deps.settings.revoke(app);
    this.emitOverviewChange();
    return settings;
  }

  async updateSettings(patch: CloudSettingsPatch): Promise<CloudSettings> {
    const settings = await this.deps.settings.update(patch);
    this.emitOverviewChange();
    return settings;
  }

  async install(app: SuiteAppId, version?: string): Promise<OperationSnapshot> {
    assertGranted(this.deps.settings.get(), app);
    return this.operationQueue.enqueueInstall({ app, version });
  }

  async uninstall(app: SuiteAppId, options?: UninstallOptions): Promise<OperationSnapshot> {
    assertGranted(this.deps.settings.get(), app);
    return this.operationQueue.enqueueUninstall({ app, removeUserData: options?.removeUserData ?? false });
  }

  async cancel(operationId: string): Promise<void> {
    await this.operationQueue.cancel(operationId);
  }

  operations(): OperationSnapshot[] {
    return this.operationQueue.operations();
  }

  async open(app: SuiteAppId): Promise<void> {
    assertGranted(this.deps.settings.get(), app);
    const descriptor = suiteApp(app);
    const installed = await this.discoverApp(app);
    if (!installed) {
      throw new Error(`${descriptor.productName} is not installed`);
    }
    await this.deps.adapter.launch(descriptor, installed);
  }

  /** The path for main to hand to `shell.showItemInFolder`. No grant required — read-only. */
  reveal(app: SuiteAppId): string {
    if (app === 'cloud') return this.deps.selfLocation;

    const installed = this.appStates.find((state) => state.app === app)?.installed;
    if (!installed) {
      throw new Error(`${suiteApp(app).productName} is not installed`);
    }
    return this.deps.adapter.revealPath(installed);
  }

  releaseNotesUrl(app: SuiteAppId, version: string): string {
    const descriptor = suiteApp(app);
    const release = (this.deps.catalog.releasesFor(app) ?? []).find(
      (candidate) => candidate.version === version,
    );
    if (!release) {
      throw new Error(`${descriptor.productName} ${version} is not in the release catalog`);
    }
    if (!release.notesUrl.startsWith('https://github.com/')) {
      throw new Error(`Refusing to open a release-notes URL outside github.com: ${release.notesUrl}`);
    }
    return release.notesUrl;
  }

  private async discoverApp(app: SuiteAppId): Promise<InstalledApp | null> {
    if (app === 'cloud') {
      return {
        app: 'cloud',
        version: this.deps.selfVersion,
        location: this.deps.selfLocation,
        scope: 'unknown',
      };
    }
    return this.deps.adapter.discover(suiteApp(app));
  }

  private async rescanInstalls(): Promise<void> {
    const [appStates, systemScopeWritable] = await Promise.all([
      Promise.all(
        SUITE_APP_IDS.map(async (app) => {
          const installed = await this.discoverApp(app);
          const releases = this.deps.catalog.releasesFor(app);
          return deriveAppState({ app: suiteApp(app), installed, releases });
        }),
      ),
      this.deps.adapter.systemScopeWritable(),
    ]);
    this.appStates = appStates;
    this.systemScopeWritableCache = systemScopeWritable;
  }

  private emitOverviewChange(): void {
    this.emit('overview-change', this.overview());
  }
}
