import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { createSecureWebPreferences, isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';

const PRELOAD_PATH = path.join(__dirname, '../preload/preload.js');
const RENDERER_INDEX_PATH = path.join(__dirname, '../renderer/index.html');

export function createMainWindow(): BrowserWindow {
  const options: BrowserWindowConstructorOptions = {
    title: 'LumaSoundboard', width: 1100, height: 760, minWidth: 760, minHeight: 520,
    show: false, backgroundColor: '#151515', webPreferences: createSecureWebPreferences(PRELOAD_PATH),
  };
  const window = new BrowserWindow(options);
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  const trusted = (url: string) => isTrustedRendererUrl(url, { packagedRendererFile: RENDERER_INDEX_PATH, devServerOrigin: resolveDevServerOrigin(devUrl) });
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (devUrl) void window.loadURL(devUrl); else void window.loadFile(RENDERER_INDEX_PATH);
  return window;
}
