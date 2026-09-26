import {
  app,
  BrowserWindow,
  dialog,
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
import { installApplicationMenu, rebuildRecentMenu, RELEASES_URL } from './application-menu';
import { isApprovedExternalUrl } from './navigation-policy';
import { ExportSinkRegistry } from './export-sink';
import {
  DocumentDirtyTracker,
  admitProjectMedia,
  createIpcHandlers,
  registerIpc,
  sendMenuCommand,
  sendOpenDocument,
  type IpcDeps,
  type IpcDialogs,
} from './ipc';
import { MediaAdmissions, MEDIA_EXTENSIONS_BY_KIND, MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES, createMediaProtocolHandler } from './media-scheme';
import { PROJECT_DIALOG_FILTERS, RecentProjectsStore, readProjectFile, readTextFileWithLimit, writeProjectFile, writeTextFile } from './project-io';
import { resolveUserData } from './user-data';
import { createMainWindow } from './window';

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
  const exportSinks = new ExportSinkRegistry();
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
      setTitle: (title) => mainWindow?.setTitle(title),
      setDocumentEdited: (edited) => {
        if (process.platform === 'darwin') mainWindow?.setDocumentEdited(edited);
      },
    },
    shellEffects: {
      showItemInFolder: (targetPath) => shell.showItemInFolder(targetPath),
    },
    projectStore: {
      read: (targetPath) => readProjectFile(targetPath),
      write: (targetPath, project) => writeProjectFile(targetPath, project),
    },
    recentProjects: recentStore,
    admissions,
    exportSinks,
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

  /**
   * Reads, admits, and pushes a project to the renderer — shared by the OS
   * open-file flow (macOS `open-file`, Windows/Linux argv/second-instance)
   * and clicking an Open Recent menu item, since neither carries the path
   * through a normal `openProject` IPC round trip.
   */
  async function handleOpenDocument(filePath: string): Promise<void> {
    try {
      const document = await readProjectFile(filePath);
      await admitProjectMedia(admissions, document.project);
      const recent = await recentStore.push({
        path: filePath,
        title: document.project.title,
        openedAt: new Date().toISOString(),
      });
      rebuildRecentMenu(recent);

      if (mainWindow && !mainWindow.isDestroyed()) {
        sendOpenDocument(mainWindow, document);
        mainWindow.show();
        mainWindow.focus();
      }
    } catch (error) {
      console.error('[main] failed to open document', filePath, error);
    }
  }

  function openDocumentPath(filePath: string): void {
    if (!mainWindow) {
      pendingOpenPath = filePath;
      return;
    }
    // A cold start via file-open races the renderer's mount: the window
    // exists but hasn't attached its onOpenDocument listener yet, so a push
    // sent now would be silently lost. Deferring to did-finish-load is what
    // keeps double-clicking a .lumachord file on a fresh launch reliable.
    if (mainWindow.webContents.isLoading()) {
      const targetWindow = mainWindow;
      targetWindow.webContents.once('did-finish-load', () => {
        void handleOpenDocument(filePath);
      });
      return;
    }
    void handleOpenDocument(filePath);
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

  function openMainWindow(): void {
    mainWindow = createMainWindow();

    // Simplified close-confirmation flow (documented, not a full native save
    // sheet): a dirty document blocks the close and prompts. "Save" cancels
    // the close and asks the renderer to save via the same 'save' menu
    // command the File menu uses; the renderer is responsible for calling
    // setDocumentState({ dirty: false }) once the save completes and for
    // closing the window again afterwards (e.g. the user's next close
    // attempt, or the renderer calling window.close() itself). "Don't Save"
    // clears the dirty flag and closes immediately; "Cancel" leaves the
    // window open.
    mainWindow.on('close', (event) => {
      if (!dirtyTracker.get()) return;
      event.preventDefault();

      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'question',
        buttons: ["Don't Save", 'Cancel', 'Save'],
        defaultId: 2,
        cancelId: 1,
        message: 'Save changes to this project before closing?',
      });

      if (choice === 2) {
        sendMenuCommand(mainWindow, 'save');
        return;
      }
      if (choice === 0) {
        dirtyTracker.set(false);
        mainWindow?.close();
      }
      // choice === 1 (Cancel) or the dialog was dismissed: stay open.
    });

    mainWindow.on('closed', () => {
      if (mainWindow !== null) mainWindow = null;
    });

    if (pendingOpenPath) {
      const filePath = pendingOpenPath;
      pendingOpenPath = null;
      openDocumentPath(filePath);
    }
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

    openMainWindow();

    // macOS keeps the process alive with no windows; clicking the dock icon
    // reopens the shell rather than doing nothing.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        openMainWindow();
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

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
