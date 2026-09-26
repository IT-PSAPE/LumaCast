import { describe, expect, it } from 'vitest';
import {
  createSecureWebPreferences,
  describeUrlSchemeForLogging,
  isApprovedExternalUrl,
  isTrustedRendererUrl,
  resolveDevServerOrigin,
} from '../../../../apps/flux/main/navigation-policy';

const PACKAGED_RENDERER = '/build/apps/flux/out/renderer/index.html';
const DEV_ORIGIN = 'http://localhost:5173';

function trustOptions(devServerOrigin: string | null = DEV_ORIGIN) {
  return { packagedRendererFile: PACKAGED_RENDERER, devServerOrigin };
}

describe('apps/flux isTrustedRendererUrl', () => {
  it('allows the exact packaged renderer file', () => {
    expect(
      isTrustedRendererUrl('file:///build/apps/flux/out/renderer/index.html', trustOptions(null)),
    ).toBe(true);
  });

  it('denies any other local file, even one under a mimicking path', () => {
    expect(isTrustedRendererUrl('file:///tmp/attacker/renderer/index.html', trustOptions(null))).toBe(false);
    expect(isTrustedRendererUrl('file:///build/apps/flux/out/other/index.html', trustOptions(null))).toBe(false);
  });

  it('denies file URLs carrying credentials', () => {
    expect(
      isTrustedRendererUrl('file://user:pass@localhost/build/apps/flux/out/renderer/index.html', trustOptions(null)),
    ).toBe(false);
  });

  it('allows the exact loopback dev-server origin', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/', trustOptions())).toBe(true);
    expect(isTrustedRendererUrl('http://localhost:5173/some/route', trustOptions())).toBe(true);
  });

  it('denies other schemes, hosts, and ports in dev', () => {
    expect(isTrustedRendererUrl('http://localhost:5174/', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('https://localhost:5173/', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('http://evil.com/', trustOptions())).toBe(false);
  });

  it('denies credentialed dev URLs', () => {
    expect(isTrustedRendererUrl('http://user:pass@localhost:5173/', trustOptions())).toBe(false);
  });

  it('denies https navigation entirely outside dev', () => {
    expect(isTrustedRendererUrl('https://example.com/', trustOptions(null))).toBe(false);
  });

  it('denies non-web schemes and unparseable values', () => {
    expect(isTrustedRendererUrl('data:text/html,<script>alert(1)</script>', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('javascript:alert(1)', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('blob:https://example.com/uuid', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('about:blank', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('', trustOptions())).toBe(false);
    expect(isTrustedRendererUrl('http://[invalid', trustOptions())).toBe(false);
  });
});

describe('apps/flux resolveDevServerOrigin', () => {
  it('returns the exact origin of a loopback dev URL', () => {
    expect(resolveDevServerOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(resolveDevServerOrigin('http://localhost:5173/')).toBe('http://localhost:5173');
    expect(resolveDevServerOrigin('http://localhost:5173/path?q=1')).toBe('http://localhost:5173');
    expect(resolveDevServerOrigin('http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173');
    expect(resolveDevServerOrigin('http://[::1]:5173')).toBe('http://[::1]:5173');
  });

  it('returns null outside dev or for anything untrusted', () => {
    expect(resolveDevServerOrigin(null)).toBeNull();
    expect(resolveDevServerOrigin(undefined)).toBeNull();
    expect(resolveDevServerOrigin('')).toBeNull();
    expect(resolveDevServerOrigin('http://example.com:5173')).toBeNull();
    expect(resolveDevServerOrigin('http://user:pass@localhost:5173')).toBeNull();
    expect(resolveDevServerOrigin('ftp://localhost:5173')).toBeNull();
    expect(resolveDevServerOrigin('file:///etc/passwd')).toBeNull();
    expect(resolveDevServerOrigin('localhost:5173')).toBeNull();
    expect(resolveDevServerOrigin('http://[::1')).toBeNull();
  });
});

describe('apps/flux isApprovedExternalUrl', () => {
  it('denies everything while the external allow-list is empty', () => {
    expect(isApprovedExternalUrl('https://example.com/')).toBe(false);
    expect(isApprovedExternalUrl('https://example.com/some/page')).toBe(false);
    expect(isApprovedExternalUrl('http://example.com/')).toBe(false);
    expect(isApprovedExternalUrl('https://user:pass@example.com/')).toBe(false);
    expect(isApprovedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isApprovedExternalUrl('')).toBe(false);
  });
});

describe('apps/flux describeUrlSchemeForLogging', () => {
  it('reports only the scheme', () => {
    expect(describeUrlSchemeForLogging('file:///etc/passwd')).toBe('file:');
    expect(describeUrlSchemeForLogging('https://example.com/x')).toBe('https:');
    expect(describeUrlSchemeForLogging('javascript:alert(1)')).toBe('javascript:');
    expect(describeUrlSchemeForLogging('not a url')).toBe('unparseable');
    expect(describeUrlSchemeForLogging('')).toBe('unparseable');
  });
});

describe('apps/flux createSecureWebPreferences', () => {
  it('returns a locked-down renderer configuration', () => {
    const prefs = createSecureWebPreferences('/build/apps/flux/out/preload/preload.js');
    expect(prefs.preload).toBe('/build/apps/flux/out/preload/preload.js');
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.nodeIntegrationInWorker).toBe(false);
    expect(prefs.nodeIntegrationInSubFrames).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.allowRunningInsecureContent).toBe(false);
    expect(prefs.experimentalFeatures).toBe(false);
  });
});
