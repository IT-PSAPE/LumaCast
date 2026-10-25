import { createAppWindow, windowChromeOptions } from '@lumacast/desktop';
import type { BrowserWindow } from 'electron';
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

export function createMainWindow(): BrowserWindow {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  const devServerOrigin = resolveDevServerOrigin(devServerUrl);

  return createAppWindow({
    title: APP_IDENTITY.name,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    backgroundColor: '#171717',
    // Custom title bar (renderer/features/shell/title-bar.tsx) replaces the
    // native one; native window controls stay (traffic lights / caption overlay).
    chrome: windowChromeOptions(process.platform),
    webPreferences: createSecureWebPreferences(PRELOAD_PATH),
    rendererIndexPath: RENDERER_INDEX_PATH,
    devServerUrl,
    isTrustedUrl: (url) => isTrustedRendererUrl(url, { packagedRendererFile: RENDERER_INDEX_PATH, devServerOrigin }),
    isApprovedExternalUrl,
    describeUrlScheme: describeUrlSchemeForLogging,
  });
}
