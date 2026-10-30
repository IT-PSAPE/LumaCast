import { suiteApp } from '@lumacast/suite';
import type { SelfUpdateState, SuiteOverview } from '../shared/desktop-api';

export const BACKGROUND_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface UpdateNotice {
  appName: string;
  version: string;
}

export interface BackgroundUpdateMonitorOptions {
  refresh: () => Promise<SuiteOverview>;
  checkSelfUpdate?: () => Promise<SelfUpdateState>;
  notify: (notice: UpdateNotice) => void;
  initialOverview: SuiteOverview;
  intervalMs?: number;
}

/** Periodically refreshes the read-only catalog and reports newly available versions. */
export class BackgroundUpdateMonitor {
  private readonly refresh: BackgroundUpdateMonitorOptions['refresh'];
  private readonly checkSelfUpdate: BackgroundUpdateMonitorOptions['checkSelfUpdate'];
  private readonly notify: BackgroundUpdateMonitorOptions['notify'];
  private readonly intervalMs: number;
  private readonly notifiedAppVersions = new Map<string, string>();
  private notifiedCloudVersion: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checkPromise: Promise<void> | null = null;
  private enabled = false;
  private lastCatalogFetchedAt: string | null;

  constructor(options: BackgroundUpdateMonitorOptions) {
    this.refresh = options.refresh;
    this.checkSelfUpdate = options.checkSelfUpdate;
    this.notify = options.notify;
    this.intervalMs = options.intervalMs ?? BACKGROUND_UPDATE_CHECK_INTERVAL_MS;
    this.lastCatalogFetchedAt = options.initialOverview.catalog.fetchedAt;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;

    if (enabled) {
      this.timer = setInterval(() => {
        void this.checkInBackground();
      }, this.intervalMs);
      this.timer.unref?.();
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop(): void {
    this.setEnabled(false);
  }

  /** Manual checks remain available even when background checking is disabled. */
  async checkNow(): Promise<void> {
    await this.runCheck();
  }

  private async checkInBackground(): Promise<void> {
    if (!this.enabled) return;
    await this.runCheck(true);
  }

  private async runCheck(includeSelfUpdate = false): Promise<void> {
    if (this.checkPromise) return this.checkPromise;

    const checks: Promise<unknown>[] = [
      this.refresh().then((overview) => this.observeOverview(overview)),
    ];
    if (includeSelfUpdate && this.checkSelfUpdate) {
      checks.push(
        this.checkSelfUpdate().then((state) => this.observeSelfUpdate(state)),
      );
    }

    this.checkPromise = Promise.allSettled(checks)
      .then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error(
              '[background-updates] update check failed',
              result.reason,
            );
          }
        }
      })
      .finally(() => {
        this.checkPromise = null;
      });
    return this.checkPromise;
  }

  observeOverview(overview: SuiteOverview): void {
    const fetchedAt = overview.catalog.fetchedAt;
    if (
      overview.catalog.status !== 'ready' ||
      fetchedAt === null ||
      fetchedAt === this.lastCatalogFetchedAt
    )
      return;
    this.lastCatalogFetchedAt = fetchedAt;

    for (const state of overview.apps) {
      if (state.app === 'cloud') continue;
      const version = state.latest?.version;
      if (state.status !== 'update-available' || !version) {
        this.notifiedAppVersions.delete(state.app);
        continue;
      }

      if (this.notifiedAppVersions.get(state.app) !== version && this.enabled) {
        this.notify({ appName: suiteApp(state.app).productName, version });
        this.notifiedAppVersions.set(state.app, version);
      }
    }
  }

  observeSelfUpdate(state: SelfUpdateState): void {
    const version =
      state.status === 'available' ? state.availableVersion : null;
    if (!version || version === this.notifiedCloudVersion) return;
    if (!this.enabled) return;

    this.notify({ appName: suiteApp('cloud').productName, version });
    this.notifiedCloudVersion = version;
  }
}
