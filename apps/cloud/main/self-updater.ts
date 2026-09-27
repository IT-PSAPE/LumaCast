// Wraps electron-updater's `autoUpdater` (generic provider, configured in
// electron-builder.yml) into the typed SelfUpdateState the renderer renders.
// No dialogs here — unlike apps/cast/main/app-updater.ts, which drives
// message boxes directly, Cloud's own update flow is just another part of
// the suite-manager UI, so the state is pushed and the renderer decides how
// to show it.
import { EventEmitter } from 'node:events';
import { app } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { SelfUpdateState, SelfUpdateStatus } from '../shared/desktop-api';

export interface SelfUpdaterOptions {
  now?: () => Date;
}

export declare interface SelfUpdater {
  on(event: 'change', listener: (state: SelfUpdateState) => void): this;
  off(event: 'change', listener: (state: SelfUpdateState) => void): this;
}

export class SelfUpdater extends EventEmitter {
  private status: SelfUpdateStatus;
  private availableVersion: string | null = null;
  private percent: number | null = null;
  private error: string | null = null;
  private checkedAt: string | null = null;
  private initialized = false;
  private installPromise: Promise<void> | null = null;
  private readonly now: () => Date;

  constructor(options: SelfUpdaterOptions = {}) {
    super();
    this.now = options.now ?? (() => new Date());
    this.status = app.isPackaged ? 'idle' : 'unavailable';
  }

  private initialize(): void {
    if (this.initialized || !app.isPackaged) return;
    this.initialized = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.apply({ status: 'checking', error: null });
    });
    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.apply({ status: 'available', availableVersion: info.version, percent: null, error: null });
    });
    autoUpdater.on('update-not-available', () => {
      this.apply({ status: 'up-to-date', availableVersion: null, percent: null, error: null });
    });
    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.apply({ status: 'downloading', percent: progress.percent });
    });
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.apply({ status: 'ready', availableVersion: info.version, percent: 100, error: null });
    });
    autoUpdater.on('error', (error: Error) => {
      this.apply({ status: 'error', error: error.message });
    });
  }

  state(): SelfUpdateState {
    return {
      status: this.status,
      availableVersion: this.availableVersion,
      percent: this.percent,
      error: this.error,
      checkedAt: this.checkedAt,
    };
  }

  async check(): Promise<SelfUpdateState> {
    if (!app.isPackaged) return this.state();
    this.initialize();

    this.checkedAt = this.now().toISOString();
    this.apply({ status: 'checking', error: null });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      this.apply({ status: 'error', error: error instanceof Error ? error.message : String(error) });
    }
    return this.state();
  }

  async download(): Promise<void> {
    if (!app.isPackaged) return;
    this.initialize();
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      this.apply({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /**
   * Installs Cloud's own pending update, downloading it first when it is
   * merely `available` and only restarting once it is `ready`. Previously
   * this called `quitAndInstall()` directly while `autoDownload` is false,
   * so clicking "Install Update" on an update that had never downloaded
   * always failed. A second call while a download is in flight joins it
   * instead of starting another download.
   */
  async installAndRestart(): Promise<void> {
    if (!app.isPackaged) return;
    this.initialize();
    if (this.installPromise) {
      await this.installPromise;
      return;
    }
    this.installPromise = this.runInstallAndRestart();
    try {
      await this.installPromise;
    } finally {
      this.installPromise = null;
    }
  }

  private async runInstallAndRestart(): Promise<void> {
    if (this.status === 'available') {
      await this.download();
    }
    if (this.status !== 'ready') {
      throw new Error(this.error ?? 'No Cloud update is ready to install');
    }
    autoUpdater.quitAndInstall();
  }

  /** Called once from main/index.ts after `app.whenReady()`. */
  scheduleStartupCheck(): void {
    if (!app.isPackaged) return;
    setTimeout(() => {
      void this.check();
    }, 1500).unref();
  }

  private apply(patch: Partial<SelfUpdateState>): void {
    if (patch.status !== undefined) this.status = patch.status;
    if (patch.availableVersion !== undefined) this.availableVersion = patch.availableVersion;
    if (patch.percent !== undefined) this.percent = patch.percent;
    if (patch.error !== undefined) this.error = patch.error;
    if (patch.checkedAt !== undefined) this.checkedAt = patch.checkedAt;
    this.emit('change', this.state());
  }
}
