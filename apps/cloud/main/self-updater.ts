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
    await autoUpdater.downloadUpdate();
  }

  installAndRestart(): void {
    if (!app.isPackaged) return;
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
