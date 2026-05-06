import { app, BrowserWindow, Menu, nativeImage, protocol, type BrowserWindowConstructorOptions } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CastRepository } from '@database/store';
import { AppUpdater } from './app-updater';
import { createApplicationMenu } from './application-menu';
import { registerIpcHandlers } from './ipc';
import { initializeLogger, getLogFilePath } from './logger';
import { NdiServiceProxy } from './ndi/ndi-service-proxy';
import { NoopNdiService } from './ndi/ndi-noop-service';
import { NdiConfigStore } from './ndi/ndi-config-store';
import type { NdiServiceLike } from './ndi/ndi-protocol';
import {
  createForbiddenResponse,
  createNotFoundResponse,
  fetchLocalFileResponse,
  resolveTrustedCastMediaRequest,
} from './security';

protocol.registerSchemesAsPrivileged([{
  scheme: 'cast-media',
  privileges: { secure: true, supportFetchAPI: true, stream: true },
}]);

interface CliOptions {
  rendererView: 'app' | 'ui-spec';
  userDataDir: string | null;
}

type RendererView = CliOptions['rendererView'];

const APP_NAME = 'LumaCast';
const APP_ID = 'com.lumacast.app';
const cliOptions = resolveCliOptions(process.argv);
app.setName(APP_NAME);
if (cliOptions.userDataDir) {
  app.setPath('userData', path.resolve(cliOptions.userDataDir));
}

const documentsDataDir = path.join(app.getPath('documents'), APP_NAME);
try {
  fs.mkdirSync(documentsDataDir, { recursive: true });
} catch (error) {
  // Logger will fall back to stderr-only if the Documents dir is not writable.
  console.error('[Main process documents dir mkdir failed]', error);
}
initializeLogger(documentsDataDir);
console.log(`[main] userData=${app.getPath('userData')}`);
console.log(`[main] documentsDataDir=${documentsDataDir}`);
console.log(`[main] logFile=${getLogFilePath()}`);
console.log(`[main] argv=${process.argv.slice(1).join(' ')}`);

let mainWindow: BrowserWindow | null = null;
const WORKBENCH_MIN_WIDTH = 140 + 360 + 140;
const WORKBENCH_MIN_HEIGHT = Math.max(360 + 96, 240 + 120) + 96;
const repository = new CastRepository();
const ndiConfigStore = new NdiConfigStore();
let ndiService: NdiServiceLike | null = null;
let isShuttingDown = false;
const appUpdater = new AppUpdater({
  getMainWindow: () => mainWindow,
});

function teardownNdi(reason: string, error?: unknown) {
  if (error !== undefined) {
    console.error(`[Main process ${reason}]`, error);
  }
  if (!ndiService) return;
  console.log(`[Main process NDI teardown] reason=${reason}`);
  try {
    // destroy() now performs its own best-effort blackout burst before
    // releasing the native sender, so receivers see a clean cutoff.
    ndiService.destroy();
  } catch (destroyError) {
    console.error('[Main process NDI teardown failure]', destroyError);
  }
}

function quitAfterFatalMainProcessError(reason: string, error: unknown): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  teardownNdi(reason, error);

  const exit = () => {
    try {
      app.exit(1);
    } catch (exitError) {
      console.error('[Main process fatal exit failure]', exitError);
      process.exitCode = 1;
      process.exit(1);
    }
  };

  if (app.isReady()) {
    app.quit();
    setTimeout(exit, 1500).unref();
    return;
  }

  exit();
}

process.on('uncaughtException', (error) => {
  quitAfterFatalMainProcessError('uncaughtException', error);
});

process.on('unhandledRejection', (reason) => {
  quitAfterFatalMainProcessError('unhandledRejection', reason);
});

process.on('exit', () => {
  teardownNdi('exit');
});

if (process.platform !== 'win32') {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      teardownNdi(signal);
      app.quit();
    });
  }
}

function getAppIcon(): string {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath)
    : path.join(__dirname, '../../resources');

  if (process.platform === 'win32') {
    return path.join(resourcesPath, 'icon.ico');
  }
  return path.join(resourcesPath, 'icon.png');
}

function createRendererWindowOptions(width: number, height: number): BrowserWindowConstructorOptions {
  return {
    title: APP_NAME,
    width,
    height,
    minWidth: WORKBENCH_MIN_WIDTH,
    minHeight: WORKBENCH_MIN_HEIGHT,
    show: false,
    backgroundColor: '#121212',
    icon: getAppIcon(),
    ...(process.platform === 'win32'
      ? {
        titleBarStyle: 'hidden' as const,
        titleBarOverlay: {
          color: '#00000000',
          symbolColor: '#d4d4d4',
          height: 36,
        },
      }
      : process.platform === 'darwin'
        ? {
          titleBarStyle: 'hidden' as const,
          trafficLightPosition: { x: 13, y: 13 },
        }
        : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: false,
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

function loadRendererView(window: BrowserWindow, view: RendererView): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const targetUrl = new URL(process.env.ELECTRON_RENDERER_URL);
    if (view !== 'app') {
      targetUrl.searchParams.set('view', view);
    }
    void window.loadURL(targetUrl.toString());
    return;
  }

  const rendererFile = path.join(__dirname, '../renderer/index.html');
  if (view !== 'app') {
    void window.loadFile(rendererFile, { query: { view } });
    return;
  }
  void window.loadFile(rendererFile);
}

function createMainWindow(): void {
  const window = new BrowserWindow(createRendererWindowOptions(1680, 980));
  mainWindow = window;
  window.setTitle(APP_NAME);
  if (process.platform === 'win32') {
    window.setMenuBarVisibility(false);
  }

  let shown = false;
  const showWindow = (reason: string) => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    console.log(`[window] showing (${reason})`);
    window.show();
  };

  window.once('ready-to-show', () => showWindow('ready-to-show'));

  // Fallback: if ready-to-show never fires (renderer crash, blocked load),
  // show the window anyway so the user isn't stuck with a hidden process.
  setTimeout(() => showWindow('fallback-timeout'), 5000);

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('[renderer] did-fail-load', { errorCode, errorDescription, validatedURL });
    showWindow('did-fail-load');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details);
    // The renderer is the source of NDI frames — once it's gone, receivers
    // would otherwise see whatever frame was in flight. Flush a quick
    // blackout burst so the cutoff is visually clean.
    if (ndiService) {
      try {
        ndiService.flushBlackoutAndDestroy(undefined, { totalBudgetMs: 500 });
      } catch (error) {
        console.error('[Main process render-process-gone blackout]', error);
      }
    }
    showWindow('render-process-gone');
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[renderer] preload-error', { preloadPath, message: error?.message, stack: error?.stack });
  });
  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:console l=${level}] ${message} (${sourceId}:${line})`);
  });
  window.on('unresponsive', () => {
    console.warn('[window] unresponsive');
  });

  loadRendererView(window, cliOptions.rendererView);
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
  }

  protocol.handle('cast-media', (request) => {
    const filePath = resolveTrustedCastMediaRequest(request);
    if (!filePath) {
      return createForbiddenResponse();
    }

    return fetchLocalFileResponse(filePath, request).catch((error: unknown) => {
      console.error('[cast-media] Failed to fetch local media', error);
      return createNotFoundResponse();
    });
  });

  const iconPngPath = path.join(
    app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../resources'),
    'icon.png',
  );

  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(iconPngPath));
  }

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    ...(process.platform === 'linux' ? { iconPath: iconPngPath } : {}),
  });

  Menu.setApplicationMenu(createApplicationMenu());
  const initialNdiConfigs = ndiConfigStore.load();
  try {
    ndiService = new NdiServiceProxy({
      outputConfigs: initialNdiConfigs,
      onOutputConfigsChanged: (configs) => {
        ndiConfigStore.save(configs);
      },
      hostModulePath: path.join(__dirname, 'ndi-host.js'),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Main process NDI init failed — continuing without NDI]', error);
    ndiService = new NoopNdiService(initialNdiConfigs, `NDI service unavailable: ${message}`);
  }
  registerIpcHandlers(repository, ndiService, () => mainWindow, appUpdater);
  createMainWindow();
  appUpdater.initialize();
  appUpdater.scheduleStartupCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
}).catch((error) => {
  console.error('[Main process app.whenReady failure]', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isShuttingDown = true;
  teardownNdi('before-quit');
});

app.on('will-quit', () => {
  teardownNdi('will-quit');
});

function resolveCliOptions(argv: string[]): CliOptions {
  let rendererView: CliOptions['rendererView'] = 'app';
  let userDataDir: string | null = null;

  for (const arg of argv.slice(2)) {
    if (arg === '--ui-spec') {
      rendererView = 'ui-spec';
      continue;
    }

    if (arg.startsWith('--user-data-dir=')) {
      const value = arg.slice('--user-data-dir='.length).trim();
      userDataDir = value ? value : null;
    }
  }

  return { rendererView, userDataDir };
}
