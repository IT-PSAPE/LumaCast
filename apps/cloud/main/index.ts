import { app, BrowserWindow, dialog, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { HostArch, HostPlatform } from '@lumacast/suite';
import { APP_IDENTITY } from './app-identity';
import { createMainWindow } from './window';
import { installApplicationMenu } from './application-menu';
import { registerIpc } from './ipc';
import { SelfUpdater } from './self-updater';
import { createPlatformAdapter } from './platform';
import { createNodePlatformDeps } from './platform/node-deps';
import type { PlatformEnv } from './platform/adapter';
import { CatalogService } from './suite/catalog-service';
import { SettingsStore } from './suite/settings-store';
import { SuiteManager } from './suite/suite-manager';

function narrowPlatform(value: NodeJS.Platform): HostPlatform {
  if (value === 'darwin' || value === 'win32' || value === 'linux') return value;
  dialog.showErrorBox('LumaCloud cannot run here', `Unsupported platform: ${value}`);
  app.exit(1);
  throw new Error(`Unsupported platform: ${value}`);
}

function narrowArch(value: string): HostArch {
  if (value === 'x64' || value === 'arm64') return value;
  dialog.showErrorBox('LumaCloud cannot run here', `Unsupported architecture: ${value}`);
  app.exit(1);
  throw new Error(`Unsupported architecture: ${value}`);
}

// Narrowed once, at the very top, before anything else runs — everything
// downstream (PlatformEnv, the adapter, the manager) is written against the
// three-platform/two-arch union and would otherwise have to re-guard itself.
const PLATFORM = narrowPlatform(process.platform);
const ARCH = narrowArch(process.arch);

/**
 * Cloud's own install location, derived from where this process binary
 * actually runs rather than tracked by the adapter (Cloud is never
 * discovered — it self-updates). Mirrors what each adapter's own `discover`
 * treats as `InstalledApp.location`: the mac .app bundle, the win install
 * directory, or the linux AppImage/binary path itself.
 */
function deriveSelfLocation(platform: HostPlatform, execPath: string): string {
  if (platform === 'darwin') {
    // .../LumaCloud.app/Contents/MacOS/LumaCloud -> .../LumaCloud.app
    return path.dirname(path.dirname(path.dirname(execPath)));
  }
  if (platform === 'win32') {
    return path.dirname(execPath);
  }
  return execPath;
}

app.setName(APP_IDENTITY.name);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let manager: SuiteManager | undefined;
  let selfUpdater: SelfUpdater | undefined;
  let quitting = false;

  function openMainWindow(): void {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app
    .whenReady()
    .then(async () => {
      if (PLATFORM === 'win32') {
        app.setAppUserModelId(APP_IDENTITY.id);
      }
      app.setAboutPanelOptions({
        applicationName: APP_IDENTITY.name,
        applicationVersion: app.getVersion(),
      });

      const userDataDir = app.getPath('userData');
      await mkdir(userDataDir, { recursive: true });
      const downloadsDir = path.join(userDataDir, 'downloads');

      const settings = await SettingsStore.open(path.join(userDataDir, 'settings.json'));

      const catalog = new CatalogService({
        cachePath: path.join(userDataDir, 'catalog-cache.json'),
        userAgent: `LumaCloud/${app.getVersion()}`,
      });
      await catalog.load();

      const env: PlatformEnv = {
        platform: PLATFORM,
        arch: ARCH,
        homeDir: app.getPath('home'),
        appDataDir: app.getPath('appData'),
        downloadsDir,
      };
      const adapter = createPlatformAdapter(createNodePlatformDeps(env, (p) => shell.trashItem(p)));

      selfUpdater = new SelfUpdater();

      manager = new SuiteManager({
        settings,
        catalog,
        adapter,
        platform: PLATFORM,
        arch: ARCH,
        packaged: app.isPackaged,
        selfVersion: app.getVersion(),
        selfLocation: deriveSelfLocation(PLATFORM, process.execPath),
        selfUpdate: () => selfUpdater!.state(),
        downloadsDir,
      });
      await manager.initialize();

      registerIpc({ manager, selfUpdater, getWindow: () => mainWindow });

      installApplicationMenu({
        onCheckForUpdates: () => {
          void selfUpdater?.check();
        },
        onRefresh: () => {
          void manager?.refresh();
        },
      });

      openMainWindow();

      // macOS keeps the process alive with no windows; clicking the dock icon
      // reopens the shell rather than doing nothing.
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          openMainWindow();
        }
      });

      selfUpdater.scheduleStartupCheck();
      if (settings.get().checkOnLaunch) {
        // Fire-and-forget: the window must not wait on a network round trip,
        // and the cached catalog already gave the UI something to render.
        void manager.refresh();
      }
    })
    .catch((error: unknown) => {
      console.error('[main] app.whenReady failed', error);
      app.exit(1);
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Quit is deferred once so an in-flight download/queue can drain: any
  // operation that has not reached the point of no return (actually
  // installing/removing) is cancelled, rather than left to write a
  // half-downloaded artifact after the process is gone.
  app.on('before-quit', (event) => {
    if (quitting || !manager) return;
    event.preventDefault();
    quitting = true;
    const activeManager = manager;
    void (async () => {
      try {
        const cancellable = activeManager
          .operations()
          .filter((operation) => operation.status === 'queued' || operation.status === 'downloading');
        await Promise.all(cancellable.map((operation) => activeManager.cancel(operation.id).catch(() => {})));
        await new Promise((resolve) => setTimeout(resolve, 250));
      } finally {
        app.quit();
      }
    })();
  });
}
