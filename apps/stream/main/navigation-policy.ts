import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveDevServerOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
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

export function isProjectorPopupUrl(value: string): boolean {
  return value === 'about:blank';
}
