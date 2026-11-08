const { app, BrowserWindow, session } = require('electron');
app.setPath('userData', process.env.CHORD_EXPORT_FIXTURE_DATA);
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({ show: false, webPreferences: {
    contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
  } });
  await window.loadURL(process.env.CHORD_EXPORT_FIXTURE_URL);
});
app.on('window-all-closed', () => app.quit());
