import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  protocol,
  shell,
  type OpenDialogOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_FILE_EXTENSION } from '../shared/project';
import type { CueFileFormat, ImportKind } from '../shared/desktop-api';
import { APP_IDENTITY } from './app-identity';
import { installApplicationMenu, rebuildRecentMenu, RELEASES_URL, setEditableFocus } from './application-menu';
import { isApprovedExternalUrl } from './navigation-policy';
import { ExportSinkRegistry } from './export-sink';
import {
  DocumentDirtyTracker,
  createIpcHandlers,
  registerIpc,
  sendMenuCommand,
  sendOpenProjectRequest,
  type IpcDeps,
  type IpcDialogs,
} from './ipc';
import { MediaAdmissions, MEDIA_EXTENSIONS_BY_KIND, MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES, createMediaProtocolHandler } from './media-scheme';
import { PROJECT_DIALOG_FILTERS, RecentProjectsStore, readProjectFile, readTextFileWithLimit, writeProjectFile, writeTextFile } from './project-io';
import { resolveUserData } from './user-data';
import { createMainWindow } from './window';
import { WindowLifetime } from './window-lifetime';

// Registered before app.whenReady(): privileges cannot be granted afterwards.
// `standard` keeps `lumachord://` same-origin with the renderer document
// (covered by the default-src 'self' CSP); `bypassCSP: false` is explicit —
// media served this way is still subject to the renderer's CSP.
protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }]);

// User data must be pinned before anything reads it, and before the single
// instance lock, so a second launch is judged against the same directory.
const userData = resolveUserData({
  packaged: app.isPackaged,
  appData: app.getPath('appData'),
  override: process.env.LUMACHORD_DATA_DIR,
});
app.setName(userData.name);
app.setPath('userData', userData.dir);

const MEDIA_KIND_LABEL: Record<ImportKind, string> = {
  audio: 'Audio',
  image: 'Image',
  video: 'Video',
  cues: 'Lyrics',
};

const CUE_FORMAT_LABEL: Record<CueFileFormat, string> = {
  csv: 'CSV',
  lrc: 'LRC',
  srt: 'SRT',
};

/** A `.lumachord` path passed on the command line (Windows/Linux open-with),
 *  as opposed to macOS's `open-file` event. Returns the first match. */
function extractProjectPathFromArgv(argv: string[]): string | null {
  const suffix = `.${PROJECT_FILE_EXTENSION}`.toLowerCase();
  return argv.find((arg) => arg.toLowerCase().endsWith(suffix)) ?? null;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let pendingOpenPath: string | null = null;

  const admissions = new MediaAdmissions();
  let mainLifetime: WindowLifetime | null = null;
  let predecessorDrain: Promise<void> = Promise.resolve();
  let predecessor: WindowLifetime | null = null;
  let opening: Promise<void> | null = null;
  let quitting = false;
  let allowQuit = false;
  let rendererReady = false;
  let initialized = false;

  const currentSinks = () => {
    if (!mainLifetime) throw new Error('No active renderer');
    return mainLifetime.sinks;
  };
  const dirtyTracker = new DocumentDirtyTracker();
  const recentStore = new RecentProjectsStore(path.join(userData.dir, 'recent-projects.json'));

  const dialogs: IpcDialogs = {
    async showOpenProjectDialog() {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: PROJECT_DIALOG_FILTERS,
      });
      return result.filePaths[0] ?? null;
    },
    async showSaveProjectDialog(suggestedName) {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${suggestedName}.${PROJECT_FILE_EXTENSION}`,
        filters: PROJECT_DIALOG_FILTERS,
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
    async showOpenMediaDialog(kind) {
      if (!mainWindow) return null;
      // A background is an image or a video; one picker offers both and the
      // handler admits whichever kind the chosen file actually is.
      const filters: OpenDialogOptions['filters'] = kind === 'image' || kind === 'video'
        ? [
            { name: 'Images and videos', extensions: [...MEDIA_EXTENSIONS_BY_KIND.image, ...MEDIA_EXTENSIONS_BY_KIND.video] },
            { name: MEDIA_KIND_LABEL.image, extensions: [...MEDIA_EXTENSIONS_BY_KIND.image] },
            { name: MEDIA_KIND_LABEL.video, extensions: [...MEDIA_EXTENSIONS_BY_KIND.video] },
          ]
        : [{ name: MEDIA_KIND_LABEL[kind], extensions: [...MEDIA_EXTENSIONS_BY_KIND[kind]] }];
      const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters });
      return result.filePaths[0] ?? null;
    },
    async showSaveCueDialog(suggestedName, format) {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${suggestedName}.${format}`,
        filters: [{ name: CUE_FORMAT_LABEL[format], extensions: [format] }],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
    async showSaveExportDialog(suggestedName, extension) {
      if (!mainWindow) return null;
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: `${suggestedName}.${extension}`,
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  };

  const ipcDeps: IpcDeps = {
    dialogs,
    windowControl: {
      documentNavigationReady: async () => {
        const lifetime = mainLifetime;
        const window = mainWindow;
        if (!lifetime || !window) return;
        const ready = await lifetime.rendererReady();
        if (!ready || mainLifetime !== lifetime || mainWindow !== window) return;
        rendererReady = true;
        flushOpenPath();
      },
      requestWindowClose: (approved) => mainLifetime?.finishClose(approved) ?? Promise.resolve(false),
      setTitle: (title) => mainWindow?.setTitle(title),
      setDocumentEdited: (edited) => {
        if (process.platform === 'darwin') mainWindow?.setDocumentEdited(edited);
      },
      setEditableFocus: (editable) => setEditableFocus(editable),
      showApplicationMenu: (x, y) => {
        if (!mainWindow) return;
        Menu.getApplicationMenu()?.popup({ window: mainWindow, x: Math.round(x), y: Math.round(y) });
      },
    },
    shellEffects: {
      showItemInFolder: (targetPath) => shell.showItemInFolder(targetPath),
    },
    projectStore: {
      read: (targetPath) => readProjectFile(targetPath),
      write: (targetPath, project) => writeProjectFile(targetPath, project),
    },
    recentProjects: {
      list: () => recentStore.list(),
      push: async (entry) => {
        const recent = await recentStore.push(entry);
        rebuildRecentMenu(recent);
        return recent;
      },
    },
    admissions,
    exportSinks: {
      open: (target) => currentSinks().open(target),
      write: (id, position, bytes) => currentSinks().write(id, position, bytes),
      close: (id) => currentSinks().close(id),
      abort: (id) => currentSinks().abort(id),
    },
    clock: {
      now: () => new Date().toISOString(),
      createId: () => randomUUID(),
    },
    dirty: dirtyTracker,
    textFiles: {
      readTextFileWithLimit: (targetPath, maxBytes) => readTextFileWithLimit(targetPath, maxBytes),
      writeTextFile: (targetPath, text) => writeTextFile(targetPath, text),
    },
  };

  const ipcHandlers = createIpcHandlers(ipcDeps);

  function flushOpenPath(): void {
    if (!rendererReady || !mainWindow || !pendingOpenPath) return;
    const filePath = pendingOpenPath;
    pendingOpenPath = null;
    sendOpenProjectRequest(mainWindow, filePath);
    mainWindow.show();
    mainWindow.focus();
  }

  function openDocumentPath(filePath: string): void {
    // Send the intent before file I/O. Renderer navigation owns acquisition,
    // consent, and request order for OS, recent, and ordinary Open alike.
    pendingOpenPath = filePath;
    flushOpenPath();
    if (!mainWindow && initialized) void openMainWindow().catch((error: unknown) => console.error('[main] window creation failed', error));
  }

  // Must be registered before app.whenReady(): macOS can deliver open-file
  // for a double-clicked project before the app has finished launching.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    openDocumentPath(filePath);
  });

  app.on('second-instance', (_event, argv) => {
    mainWindow?.show();
    mainWindow?.focus();
    const filePath = extractProjectPathFromArgv(argv);
    if (filePath) openDocumentPath(filePath);
  });

  function openMainWindow(): Promise<void> {
    if (mainWindow) return Promise.resolve();
    if (opening) return opening;
    opening = (async () => {
      // A successor never admits export work before its predecessor drains.
      await (predecessor?.retire() ?? predecessorDrain);
      if (mainWindow || quitting || allowQuit) return;
      const window = createMainWindow();
      mainWindow = window;
      rendererReady = false;
      const lifetime = new WindowLifetime({
        createSinks: () => new ExportSinkRegistry(),
        sendCloseRequest: () => {
          if (mainWindow === window && mainLifetime === lifetime) sendMenuCommand(window, 'close');
        },
        replayClose: () => {
          if (mainWindow === window && mainLifetime === lifetime && !window.isDestroyed()) window.close();
        },
        onCloseSettled: (closed) => { if (!closed && mainLifetime === lifetime) quitting = false; },
      });
      mainLifetime = lifetime;
      window.on('close', (event) => lifetime.nativeClose(event));
      window.webContents.on('will-prevent-unload', () => lifetime.unloadPrevented());
      const retireRenderer = (gone: boolean) => {
        const current = mainWindow === window && mainLifetime === lifetime;
        if (current) rendererReady = false;
        const drain = lifetime.rendererLost(gone);
        if (current) { predecessor = lifetime; predecessorDrain = drain; }
        void drain.catch((error: unknown) => console.error('[main] renderer cleanup failed', error));
      };
      window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) retireRenderer(false);
      });
      window.webContents.on('render-process-gone', () => retireRenderer(true));
      window.webContents.on('destroyed', () => retireRenderer(true));
      window.on('closed', () => {
        const drain = lifetime.closed();
        if (mainWindow === window && mainLifetime === lifetime) {
          predecessorDrain = drain;
          predecessor = lifetime;
          mainWindow = null;
          mainLifetime = null;
          rendererReady = false;
        }
        void drain.then(() => {
          if (quitting && !mainWindow && !allowQuit) { allowQuit = true; app.quit(); }
        }, (error: unknown) => console.error('[main] window cleanup failed', error));
      });
      flushOpenPath();
    })().finally(() => { opening = null; });
    return opening;
  }

  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId(APP_IDENTITY.id);
    }
    app.setAboutPanelOptions({
      applicationName: APP_IDENTITY.name,
      applicationVersion: app.getVersion(),
    });

    await mkdir(userData.dir, { recursive: true });

    protocol.handle(MEDIA_SCHEME, createMediaProtocolHandler(admissions));

    registerIpc({ handlers: ipcHandlers, getWindow: () => mainWindow });

    installApplicationMenu({
      platform: process.platform,
      isPackaged: app.isPackaged,
      recentProjects: await recentStore.list(),
      emit: (command) => sendMenuCommand(mainWindow, command),
      onOpenRecent: (recentPath) => openDocumentPath(recentPath),
      onOpenReleaseNotes: () => {
        // Defense in depth: RELEASES_URL is a fixed https://github.com/...
        // constant, but shell.openExternal only ever runs behind this
        // app-wide allow-list check, same as window-open in main/window.ts.
        if (!isApprovedExternalUrl(RELEASES_URL)) return;
        void shell.openExternal(RELEASES_URL);
      },
    });

    initialized = true;
    await openMainWindow();

    // macOS keeps the process alive with no windows; clicking the dock icon
    // reopens the shell rather than doing nothing.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void openMainWindow().catch((error: unknown) => console.error('[main] window creation failed', error));
      }
    });

    // Windows/Linux "open with" on first launch: no open-file event fires,
    // so the path arrives as a plain argv entry.
    const argvPath = extractProjectPathFromArgv(process.argv);
    if (argvPath) openDocumentPath(argvPath);
  }).catch((error: unknown) => {
    console.error('[main] app.whenReady failed', error);
    app.exit(1);
  });

  app.on('before-quit', (event) => {
    if (allowQuit) return;
    event.preventDefault();
    quitting = true;
    if (mainWindow) mainWindow.close();
    else void (predecessor?.retire() ?? predecessorDrain).then(() => {
      if (quitting && !mainWindow && !allowQuit) { allowQuit = true; app.quit(); }
    }, (error: unknown) => { quitting = false; console.error('[main] quit cleanup failed', error); });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
