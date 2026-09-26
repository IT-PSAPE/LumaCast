import { app, BrowserWindow } from 'electron';
import { APP_IDENTITY } from './app-identity';
import { createMainWindow } from './window';

app.setName(APP_IDENTITY.name);

let mainWindow: BrowserWindow | null = null;

function openMainWindow(): void {
  mainWindow = createMainWindow();
  mainWindow.on('closed', () => {
    if (mainWindow !== null) {
      mainWindow = null;
    }
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_IDENTITY.id);
  }

  app.setAboutPanelOptions({
    applicationName: APP_IDENTITY.name,
    applicationVersion: app.getVersion(),
  });

  openMainWindow();

  // macOS keeps the process alive with no windows; clicking the dock icon
  // reopens the shell rather than doing nothing.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      openMainWindow();
    }
  });
}).catch((error: unknown) => {
  console.error('[main] app.whenReady failed', error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
