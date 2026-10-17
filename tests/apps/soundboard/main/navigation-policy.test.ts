import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSecureWebPreferences, isTrustedRendererUrl, resolveDevServerOrigin } from '../../../../apps/soundboard/main/navigation-policy';

describe('soundboard renderer security policy', () => {
  it('uses sandboxed isolated renderer preferences', () => {
    expect(createSecureWebPreferences('preload.js')).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  });

  it('trusts only exact packaged entry and loopback development origin', () => {
    const file = path.join(path.sep, 'app', 'out', 'renderer', 'index.html');
    expect(isTrustedRendererUrl(`file://${file.replaceAll('\\', '/')}`, { packagedRendererFile: file, devServerOrigin: null })).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/child', { packagedRendererFile: file, devServerOrigin: resolveDevServerOrigin('http://localhost:5173') })).toBe(true);
    expect(resolveDevServerOrigin('https://example.com')).toBeNull();
    expect(isTrustedRendererUrl('https://example.com', { packagedRendererFile: file, devServerOrigin: null })).toBe(false);
  });
});
