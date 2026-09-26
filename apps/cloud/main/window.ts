import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron';
import path from 'node:path';
import { APP_IDENTITY } from './app-identity';
import {
  createSecureWebPreferences,
  describeUrlSchemeForLogging,
  isApprovedExternalUrl,
  isTrustedRendererUrl,
  resolveDevServerOrigin,
} from './navigation-policy';

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 800;
const WINDOW_MIN_WIDTH = 960;
const WINDOW_MIN_HEIGHT = 600;

// Both paths are resolved from this bundle's own __dirname, so the main-process
// bundle and the preload bundle each derive the same files they are built
// beside in out/.
const PRELOAD_PATH = path.join(__dirname, '../preload/preload.js');
const RENDERER_INDEX_PATH = path.join(__dirname, '../renderer/index.html');

function createWindowOptions(): BrowserWindowConstructorOptions {
  return {
    title: APP_IDENTITY.name,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: false,
    backgroundColor: '#171717',
    webPreferences: createSecureWebPreferences(PRELOAD_PATH),
  };
}

function loadRendererView(window: BrowserWindow, devServerUrl: string | undefined): void {
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
    return;
  }

  void window.loadFile(RENDERER_INDEX_PATH);
}

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow(createWindowOptions());
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const isTrusted = (url: string): boolean => isTrustedRendererUrl(url, {
    packagedRendererFile: RENDERER_INDEX_PATH,
    devServerOrigin: resolveDevServerOrigin(devServerUrl),
  });

  // A window that never becomes visible is indistinguishable from a hung app,
  // so show it once the first paint is ready, with a timed fallback in case
  // `ready-to-show` never arrives (renderer crash, blocked load).
  let shown = false;
  const showWindow = (reason: string): void => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    console.log(`[window] showing (${reason})`);
    window.show();
  };

  window.once('ready-to-show', () => showWindow('ready-to-show'));
  const showFallback = setTimeout(() => showWindow('fallback-timeout'), 5000);
  showFallback.unref();

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, isMainFrame) => {
    if (!isMainFrame) return;
    console.error('[renderer] did-fail-load', { errorCode, errorDescription });
    showWindow('did-fail-load');
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] render-process-gone', details);
    showWindow('render-process-gone');
  });
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[renderer] preload-error', { preloadPath, message: error?.message });
  });

  // Navigation may only stay inside this app's own renderer. Denials log the
  // scheme alone — a file: URL carries an absolute filesystem path.
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrusted(url)) return;
    event.preventDefault();
    console.warn('[security] denied navigation to untrusted origin', {
      scheme: describeUrlSchemeForLogging(url),
    });
  });

  // No window is ever opened in-app. An approved https: destination is handed
  // to the OS browser instead, and creation is denied either way.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isApprovedExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      console.warn('[security] denied window-open request', {
        scheme: describeUrlSchemeForLogging(url),
      });
    }
    return { action: 'deny' };
  });

  loadRendererView(window, devServerUrl);
  return window;
}
