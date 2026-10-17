import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { projectorTitleForFrameName } from '../shared/projector';
import { isProjectorPopupUrl, isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';

export function createMainWindow(): BrowserWindow {
  const preload = path.join(__dirname, '../preload/preload.js');
  const rendererFile = path.join(__dirname, '../renderer/index.html');
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const navigationOptions = { packagedRendererFile: rendererFile, devServerOrigin: resolveDevServerOrigin(devUrl) };
  const window = new BrowserWindow({
    title: 'LumaStream',
    width: 1560,
    height: 960,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#101114',
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  } satisfies BrowserWindowConstructorOptions);
  const trusted = (url: string) => isTrustedRendererUrl(url, navigationOptions);
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (!isProjectorPopupUrl(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        title: projectorTitleForFrameName(frameName),
        width: 1280,
        height: 720,
        minWidth: 480,
        minHeight: 270,
        show: true,
        backgroundColor: '#000000',
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          nodeIntegrationInWorker: false,
          nodeIntegrationInSubFrames: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
        },
      },
    };
  });
  if (devUrl) void window.loadURL(devUrl); else void window.loadFile(rendererFile);
  return window;
}
