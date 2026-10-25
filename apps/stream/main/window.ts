import { BrowserWindow, nativeTheme, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { projectorTitleForFrameName } from '../shared/projector';
import { toStreamPlatform } from '../shared/platform-capabilities';
import { isProjectorPopupUrl, isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';
import { hardenPopupWebContents } from './popup-policy';
import { applyTitleBarOverlay, windowChromeOptions } from '@lumacast/desktop';

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
    backgroundColor: '#171717',
    // Custom title bar (renderer/chrome/title-bar.tsx) replaces the native one
    // while keeping native window controls: macOS traffic lights, Windows/Linux
    // caption-button overlay. Projector popups below keep native chrome.
    ...windowChromeOptions(toStreamPlatform(process.platform)),
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
  // Caption buttons follow the OS theme (no-op on macOS). Same pattern as
  // createAppWindow in @lumacast/desktop. Projector popups are plain native
  // frames with no overlay, so they are deliberately not included.
  const syncOverlay = (): void => applyTitleBarOverlay(window, nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  syncOverlay();
  nativeTheme.on('updated', syncOverlay);
  window.once('closed', () => nativeTheme.off('updated', syncOverlay));
  const trusted = (url: string) => isTrustedRendererUrl(url, navigationOptions);
  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event, url) => { if (!trusted(url)) event.preventDefault(); });
  // Projector/multiview popups below get no further navigation policy of
  // their own once Electron creates them; harden each one as it's created.
  window.webContents.on('did-create-window', (popup) => { hardenPopupWebContents(popup.webContents); });
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
