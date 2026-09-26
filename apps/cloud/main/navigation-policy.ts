import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This module is the renderer's trust boundary and is deliberately free of any
// `electron` import, so the policy can be unit-tested as pure functions
// without launching or stubbing an Electron process. main/window.ts is the
// only place that binds it to real BrowserWindow events.

// Vite's dev server is only ever reachable on loopback. Matching the exact
// origin (scheme + host + port), not just the host, keeps a second local
// process on another port from inheriting navigation trust.
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

// LumaCloud has no outbound links yet, so the external allow-list starts empty.
// It is the only place a destination may be added, and only for an https:
// origin the app deliberately links to; entries must never come from renderer
// input, IPC payloads, or configuration.
const APPROVED_EXTERNAL_ORIGINS: ReadonlySet<string> = new Set();

export interface RendererTrustOptions {
  /**
   * Absolute path to this app's own built renderer entry point. Resolved by
   * main/window.ts from its own __dirname, so it is the same file the window
   * actually loads.
   */
  packagedRendererFile: string;
  /**
   * Origin of the Vite dev server, or null outside `electron-vite dev`. A dev
   * origin is only honoured when the dev server itself is on loopback.
   */
  devServerOrigin: string | null;
}

/**
 * The webPreferences that define this app's renderer trust boundary. Exposed
 * as a plain literal so the security posture is asserted by tests rather than
 * only by reading main/window.ts.
 */
export interface SecureWebPreferences {
  preload: string;
  sandbox: boolean;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  nodeIntegrationInWorker: boolean;
  nodeIntegrationInSubFrames: boolean;
  webSecurity: boolean;
  allowRunningInsecureContent: boolean;
  experimentalFeatures: boolean;
}

export function createSecureWebPreferences(preloadPath: string): SecureWebPreferences {
  return {
    preload: preloadPath,
    // The renderer needs no Node access, so it runs fully sandboxed behind a
    // preload that exposes no bridge surface yet.
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
  };
}

function hasUrlCredentials(parsed: URL): boolean {
  return parsed.username !== '' || parsed.password !== '';
}

/**
 * Turns electron-vite's `ELECTRON_RENDERER_URL` into a trusted origin, or null
 * when it is absent, unparseable, credentialed, non-HTTP(S), or not loopback.
 * Returning null (rather than the input) means a bad dev URL degrades to
 * file-only trust instead of widening navigation to an arbitrary host.
 */
export function resolveDevServerOrigin(devServerUrl: string | null | undefined): string | null {
  if (!devServerUrl) return null;

  let parsed: URL;
  try {
    parsed = new URL(devServerUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // Reject credentials before trusting the host: `http://user:pass@localhost/`
  // parses with hostname `localhost` and would otherwise pass unchanged.
  if (hasUrlCredentials(parsed)) return null;
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return null;

  return parsed.origin;
}

/**
 * Deny-by-default navigation check for `will-navigate`. A URL is trusted only
 * if it is this app's own packaged renderer file, or — in dev — the exact
 * origin of the loopback dev server that served it.
 */
export function isTrustedRendererUrl(value: string, options: RendererTrustOptions): boolean {
  if (!value) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol === 'file:') {
    if (hasUrlCredentials(parsed)) return false;

    let filePath: string;
    try {
      filePath = fileURLToPath(parsed);
    } catch {
      return false;
    }

    // Exact normalized-path equality, never a path suffix: a suffix check such
    // as `endsWith('/renderer/index.html')` would also match an
    // attacker-supplied `/tmp/attacker/renderer/index.html`, which is a real
    // local-file escape.
    return path.normalize(filePath) === path.normalize(options.packagedRendererFile);
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    if (hasUrlCredentials(parsed)) return false;
    if (!options.devServerOrigin) return false;
    return parsed.origin === options.devServerOrigin;
  }

  // Everything else — javascript:, data:, blob:, vbscript:, non-web schemes —
  // is denied.
  return false;
}

/**
 * Whether a window-open request may be handed to the OS browser. Window
 * creation is denied either way; this only decides whether the destination is
 * forwarded to `shell.openExternal`. Matching is by origin, so approving an
 * origin approves any path under it.
 */
export function isApprovedExternalUrl(value: string): boolean {
  if (!value) return false;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (hasUrlCredentials(parsed)) return false;
  return APPROVED_EXTERNAL_ORIGINS.has(parsed.origin);
}

/**
 * For denial logging only: reports the URL's scheme (or 'unparseable') without
 * ever surfacing the rest of the URL, which for file: URLs contains an
 * absolute filesystem path.
 */
export function describeUrlSchemeForLogging(value: string): string {
  try {
    return new URL(value).protocol;
  } catch {
    return 'unparseable';
  }
}
