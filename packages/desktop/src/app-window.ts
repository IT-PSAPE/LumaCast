import { BrowserWindow, shell, type BrowserWindowConstructorOptions, type WebPreferences } from 'electron';

export interface AppWindowOptions {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  backgroundColor: string;
  /** Per-app secure web preferences (including `preload`). */
  webPreferences: WebPreferences;
  /** Extra constructor options, e.g. `windowChromeOptions(process.platform)`. Cannot override the options above. */
  chrome?: Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'>;
  /** Absolute path of the packaged renderer's index.html. */
  rendererIndexPath: string;
  /** Dev-server URL (`ELECTRON_RENDERER_URL`); when set it is loaded instead of the packaged file. */
  devServerUrl: string | undefined;
  /** True when navigation to `url` may stay inside the window. */
  isTrustedUrl: (url: string) => boolean;
  /** True when a window-open request may be handed to the OS browser. Omit to deny all. */
  isApprovedExternalUrl?: (url: string) => boolean;
  /** Log-safe description of a URL (scheme only: a file: URL carries a filesystem path). */
  describeUrlScheme: (url: string) => string;
  /** Show the window anyway after this many ms if `ready-to-show` never arrives. Default 5000. */
  showFallbackMs?: number;
}

/**
 * Creates a main window with the behaviour LumaChord, LumaCloud and LumaFlux
 * share: shown on first paint with a timed fallback (a never-visible window
 * reads as a hung app), diagnostic logging of load/renderer/preload failures,
 * navigation confined to the app's own renderer, no in-app windows (approved
 * https URLs go to the OS browser), and dev-server-or-file loading. Size,
 * title, colors and web preferences stay the caller's.
 */
export function createAppWindow(options: AppWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    title: options.title,
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    show: false,
    backgroundColor: options.backgroundColor,
    ...options.chrome,
    webPreferences: options.webPreferences,
  });

  let shown = false;
  const showWindow = (reason: string): void => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    console.log(`[window] showing (${reason})`);
    window.show();
  };

  window.once('ready-to-show', () => showWindow('ready-to-show'));
  const showFallback = setTimeout(() => showWindow('fallback-timeout'), options.showFallbackMs ?? 5000);
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

  window.webContents.on('will-navigate', (event, url) => {
    if (options.isTrustedUrl(url)) return;
    event.preventDefault();
    console.warn('[security] denied navigation to untrusted origin', { scheme: options.describeUrlScheme(url) });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (options.isApprovedExternalUrl?.(url)) {
      void shell.openExternal(url);
    } else {
      console.warn('[security] denied window-open request', { scheme: options.describeUrlScheme(url) });
    }
    return { action: 'deny' };
  });

  if (options.devServerUrl) void window.loadURL(options.devServerUrl);
  else void window.loadFile(options.rendererIndexPath);
  return window;
}
