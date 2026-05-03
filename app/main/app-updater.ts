import { app, dialog, type BrowserWindow } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';

interface AppUpdaterOptions {
  getMainWindow: () => BrowserWindow | null;
}

interface UpdateRequestContext {
  manual: boolean;
  browserWindow: BrowserWindow | null;
}

export class AppUpdater {
  private readonly getMainWindow: AppUpdaterOptions['getMainWindow'];
  private isInitialized = false;
  private isChecking = false;
  private activeContext: UpdateRequestContext | null = null;
  private pendingDownloadContext: UpdateRequestContext | null = null;
  private downloadedVersion: string | null = null;

  constructor({ getMainWindow }: AppUpdaterOptions) {
    this.getMainWindow = getMainWindow;
  }

  initialize(): void {
    if (this.isInitialized) return;
    this.isInitialized = true;

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      void this.handleUpdateAvailable(info);
    });
    autoUpdater.on('update-not-available', (info) => {
      void this.handleUpdateNotAvailable(info.version);
    });
    autoUpdater.on('update-downloaded', (info) => {
      this.downloadedVersion = info.version;
      void this.handleUpdateDownloaded(info);
    });
    autoUpdater.on('error', (error) => {
      void this.handleUpdateError(error);
    });
  }

  scheduleStartupCheck(): void {
    if (!app.isPackaged) return;
    setTimeout(() => {
      void this.checkForUpdates(false);
    }, 1500).unref();
  }

  async checkForUpdates(manual: boolean, browserWindow?: BrowserWindow | null): Promise<void> {
    this.initialize();

    if (!app.isPackaged) {
      if (manual) {
        await this.showMessageBox(browserWindow ?? this.getMainWindow(), {
          type: 'info',
          title: 'Check for Updates',
          message: 'Update checks are only available in installed builds.',
        });
      }
      return;
    }

    if (this.downloadedVersion) {
      await this.promptToInstallDownloadedUpdate(browserWindow ?? this.getMainWindow(), this.downloadedVersion);
      return;
    }

    if (this.isChecking) {
      if (manual) {
        await this.showMessageBox(browserWindow ?? this.getMainWindow(), {
          type: 'info',
          title: 'Check for Updates',
          message: 'An update check is already in progress.',
        });
      }
      return;
    }

    this.isChecking = true;
    this.activeContext = {
      manual,
      browserWindow: browserWindow ?? this.getMainWindow(),
    };

    try {
      await autoUpdater.checkForUpdates();
    } finally {
      this.isChecking = false;
    }
  }

  private async handleUpdateAvailable(info: UpdateInfo): Promise<void> {
    const context = this.consumeActiveContext();
    const browserWindow = context?.browserWindow ?? this.getMainWindow();
    const result = await this.showMessageBox(browserWindow, {
      type: 'info',
      buttons: ['Download and Install', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Available',
      message: `LumaCast ${info.version} is available.`,
      detail: `You are currently on ${app.getVersion()}. Download the update now?`,
    });

    if (result.response === 0) {
      this.pendingDownloadContext = context;
      await autoUpdater.downloadUpdate();
    }
  }

  private async handleUpdateNotAvailable(version: string): Promise<void> {
    const context = this.consumeActiveContext();
    if (!context?.manual) return;
    await this.showMessageBox(context.browserWindow ?? this.getMainWindow(), {
      type: 'info',
      title: 'Check for Updates',
      message: 'You’re up to date.',
      detail: `LumaCast ${version} is the latest available version.`,
    });
  }

  private async handleUpdateDownloaded(info: UpdateInfo): Promise<void> {
    const context = this.consumePendingDownloadContext() ?? this.consumeActiveContext();
    await this.promptToInstallDownloadedUpdate(
      context?.browserWindow ?? this.getMainWindow(),
      info.version,
    );
  }

  private async promptToInstallDownloadedUpdate(browserWindow: BrowserWindow | null, version: string): Promise<void> {
    const result = await this.showMessageBox(browserWindow, {
      type: 'info',
      buttons: ['Install and Restart', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update Ready',
      message: `LumaCast ${version} has been downloaded.`,
      detail: 'Install the update and restart now?',
    });

    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  }

  private async handleUpdateError(error: Error): Promise<void> {
    const context = this.consumePendingDownloadContext() ?? this.consumeActiveContext();
    console.error('[AppUpdater]', error);
    if (!context?.manual) return;
    await this.showMessageBox(context.browserWindow ?? this.getMainWindow(), {
      type: 'error',
      title: 'Update Check Failed',
      message: 'Unable to check for updates right now.',
      detail: error.message,
    });
  }

  private consumeActiveContext(): UpdateRequestContext | null {
    const context = this.activeContext;
    this.activeContext = null;
    return context;
  }

  private consumePendingDownloadContext(): UpdateRequestContext | null {
    const context = this.pendingDownloadContext;
    this.pendingDownloadContext = null;
    return context;
  }

  private showMessageBox(
    browserWindow: BrowserWindow | null,
    options: Electron.MessageBoxOptions,
  ): Promise<Electron.MessageBoxReturnValue> {
    return browserWindow
      ? dialog.showMessageBox(browserWindow, options)
      : dialog.showMessageBox(options);
  }
}
