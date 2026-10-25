import { type BrowserWindow } from 'electron';
import path from 'node:path';
import { createAppWindow, windowChromeOptions } from '@lumacast/desktop';
import { APP_IDENTITY } from './app-identity';
import {
  createSecureWebPreferences,
  describeUrlSchemeForLogging,
  isApprovedExternalUrl,
  isTrustedRendererUrl,
  resolveDevServerOrigin,
} from './navigation-policy';

// Both paths are resolved from this bundle's own __dirname, so the main-process
// bundle and the preload bundle each derive the same files they are built
// beside in out/.
const PRELOAD_PATH = path.join(__dirname, '../preload/preload.js');
const RENDERER_INDEX_PATH = path.join(__dirname, '../renderer/index.html');

export function createMainWindow(): BrowserWindow {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const devServerOrigin = resolveDevServerOrigin(devServerUrl);
  return createAppWindow({
    title: APP_IDENTITY.name,
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#171717',
    // Custom title bar (renderer/App.tsx, WindowChrome) replaces the native one
    // while keeping native window controls.
    chrome: windowChromeOptions(process.platform),
    webPreferences: createSecureWebPreferences(PRELOAD_PATH),
    rendererIndexPath: RENDERER_INDEX_PATH,
    devServerUrl,
    isTrustedUrl: (url) => isTrustedRendererUrl(url, { packagedRendererFile: RENDERER_INDEX_PATH, devServerOrigin }),
    isApprovedExternalUrl,
    describeUrlScheme: describeUrlSchemeForLogging,
  });
}
