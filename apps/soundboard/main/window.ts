import { type BrowserWindow } from 'electron';
import path from 'node:path';
import { createAppWindow, windowChromeOptions } from '@lumacast/desktop';
import { createSecureWebPreferences, describeUrlSchemeForLogging, isTrustedRendererUrl, resolveDevServerOrigin } from './navigation-policy';

const PRELOAD_PATH = path.join(__dirname, '../preload/preload.js');
const RENDERER_INDEX_PATH = path.join(__dirname, '../renderer/index.html');

export function createMainWindow(): BrowserWindow {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const devServerOrigin = resolveDevServerOrigin(devServerUrl);
  return createAppWindow({
    title: 'LumaSoundboard',
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#151515',
    // Custom title bar (renderer/App.tsx, WindowChrome) replaces the native one
    // while keeping native window controls.
    chrome: windowChromeOptions(process.platform),
    webPreferences: createSecureWebPreferences(PRELOAD_PATH),
    rendererIndexPath: RENDERER_INDEX_PATH,
    devServerUrl,
    isTrustedUrl: (url) => isTrustedRendererUrl(url, { packagedRendererFile: RENDERER_INDEX_PATH, devServerOrigin }),
    describeUrlScheme: describeUrlSchemeForLogging,
  });
}
