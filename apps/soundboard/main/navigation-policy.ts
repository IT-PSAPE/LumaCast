import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function createSecureWebPreferences(preload: string): SecureWebPreferences {
  return { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false, webSecurity: true, allowRunningInsecureContent: false, experimentalFeatures: false };
}

export function resolveDevServerOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

export function isTrustedRendererUrl(value: string, options: { packagedRendererFile: string; devServerOrigin: string | null }): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'file:') return path.normalize(fileURLToPath(url)) === path.normalize(options.packagedRendererFile);
    return (url.protocol === 'http:' || url.protocol === 'https:') && options.devServerOrigin !== null && url.origin === options.devServerOrigin;
  } catch { return false; }
}

export function describeUrlSchemeForLogging(value: string): string {
  try { return new URL(value).protocol; } catch { return 'unparseable'; }
}
