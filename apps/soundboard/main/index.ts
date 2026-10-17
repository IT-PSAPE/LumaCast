import { app, BrowserWindow, dialog, protocol } from 'electron';
import path from 'node:path';
import { LibraryStore } from './library-store';
import { createMediaProtocolHandler, MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES } from './media-scheme';
import { audioDialogExtensions, registerSoundboardIpc } from './ipc';
import { isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';
import { prepareUserDataDirectory } from './user-data';
import { createMainWindow } from './window';

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }]);
const dataDir = path.join(app.getPath('appData'), 'LumaSoundboard');
app.setName('LumaSoundboard');
try {
  prepareUserDataDirectory(dataDir, (name, value) => app.setPath(name, value));
} catch (error) {
  console.error('[main] could not prepare user data directory', error);
  dialog.showErrorBox('LumaSoundboard could not start', error instanceof Error ? error.message : String(error));
  app.quit();
  throw error;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  let mainWindow: BrowserWindow | null = null;
  const store = new LibraryStore(dataDir);
  const rendererFile = path.join(__dirname, '../renderer/index.html');
  const devServerOrigin = resolveDevServerOrigin(process.env.ELECTRON_RENDERER_URL);
  const unregisterIpc = registerSoundboardIpc(store, {
    async chooseAudioFiles() {
      if (!mainWindow || mainWindow.isDestroyed()) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio', extensions: audioDialogExtensions() }],
      });
      return result.canceled ? null : result.filePaths;
    },
  }, () => mainWindow?.webContents ?? null, (url) => isTrustedRendererUrl(url, { packagedRendererFile: rendererFile, devServerOrigin }));

  app.on('second-instance', () => { mainWindow?.show(); mainWindow?.focus(); });
  app.whenReady().then(async () => {
    await protocol.handle(MEDIA_SCHEME, createMediaProtocolHandler(dataDir, () => store.load()));
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => { mainWindow = null; });
  }).catch((error) => {
    console.error('[main] startup failed', error);
    dialog.showErrorBox('LumaSoundboard could not start', error instanceof Error ? error.message : String(error));
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', unregisterIpc);
}
