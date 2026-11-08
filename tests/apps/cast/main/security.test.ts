import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const environment = vi.hoisted(() => ({ packaged: false }));

vi.mock('electron', () => ({
  app: { get isPackaged() { return environment.packaged; } },
  BrowserWindow: { fromWebContents: vi.fn() },
  net: { fetch: vi.fn() },
}));

import { BrowserWindow, net, type IpcMainInvokeEvent } from 'electron';
import {
  assertTrustedIpcSender,
  describeUrlSchemeForLogging,
  fetchLocalFileResponse,
  getDevServerUrl,
  isApprovedExternalUrl,
  isTrustedWebContentsUrl,
  resolveTrustedCastMediaRequest,
} from '../../../../apps/cast/main/security';
import { maskManagedMediaSource, revokeAllManagedMedia } from '../../../../apps/cast/main/media-capability';

beforeEach(() => {
  environment.packaged = false;
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173/');
  vi.mocked(BrowserWindow.fromWebContents).mockReset();
  revokeAllManagedMedia();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// The packaged renderer path must come out identical to the one security.ts
// derives for PACKAGED_RENDERER_INDEX_PATH (and that index.ts's
// loadRendererView loads), which security.ts resolves as `../renderer` from
// its own apps/cast/main __dirname. This file lives under tests/, so it walks back
// up to the repo root and down into apps/cast/renderer to land on the same path.
const PACKAGED_RENDERER_URL = pathToFileURL(path.join(__dirname, '../../../../apps/cast/renderer/index.html')).toString();

// A file that shares the "/renderer/index.html" suffix but lives entirely
// outside the app's own build output — the local-file-escape case a naive
// suffix check would wrongly allow.
const ESCAPED_RENDERER_URL = pathToFileURL('/tmp/attacker-controlled/renderer/index.html').toString();

describe('isTrustedWebContentsUrl (will-navigate allow-list)', () => {
  const cases: Array<{ name: string; url: string; expected: boolean }> = [
    { name: 'dev origin: localhost', url: 'http://localhost:5173/', expected: true },
    { name: 'other loopback hostname', url: 'http://127.0.0.1:5173/', expected: false },
    { name: 'other loopback port', url: 'http://localhost:5174/', expected: false },
    { name: 'other scheme on the configured host', url: 'https://localhost:5173/', expected: false },
    { name: 'dev origin host differs only by case', url: 'http://LOCALHOST:5173/', expected: true },
    { name: 'packaged renderer file:// path', url: PACKAGED_RENDERER_URL, expected: true },
    { name: 'packaged projector query', url: `${PACKAGED_RENDERER_URL}?view=projector`, expected: true },
    { name: 'packaged NDI output query', url: `${PACKAGED_RENDERER_URL}?view=ndi-output&output=audience`, expected: true },
    { name: 'dev view query', url: 'http://localhost:5173/?view=ndi-output&output=stage', expected: true },
    { name: 'file:// escape outside the renderer directory', url: ESCAPED_RENDERER_URL, expected: false },
    { name: 'file:// path with no host, not the renderer entry', url: 'file:///etc/passwd', expected: false },
    { name: 'http:// to a non-allowed host', url: 'http://example.com/', expected: false },
    { name: 'https:// to an unapproved host', url: 'https://evil.example.com/', expected: false },
    { name: 'dev host with trailing dot is not the same host', url: 'http://localhost./', expected: false },
    { name: 'javascript: scheme', url: 'javascript:alert(1)', expected: false },
    { name: 'data: scheme', url: 'data:text/html,hi', expected: false },
    { name: 'blob: scheme', url: 'blob:https://example.com/uuid', expected: false },
    { name: 'vbscript: scheme', url: 'vbscript:msgbox(1)', expected: false },
    { name: 'credentials embedded in the URL', url: 'https://user:pass@localhost/', expected: false },
    { name: 'malformed/unparseable URL', url: 'not a url', expected: false },
    { name: 'empty string', url: '', expected: false },
  ];

  for (const { name, url, expected } of cases) {
    it(`${name} -> ${expected ? 'allow' : 'deny'}`, () => {
      expect(isTrustedWebContentsUrl(url)).toBe(expected);
    });
  }
});

describe('isApprovedExternalUrl (window-open shell.openExternal allow-list)', () => {
  const cases: Array<{ name: string; url: string; expected: boolean }> = [
    { name: 'approved external origin (github.com)', url: 'https://github.com', expected: true },
    { name: 'approved origin with a path', url: 'https://github.com/IT-PSAPE/LumaCast', expected: true },
    { name: 'approved origin, host differs only by case', url: 'https://GitHub.COM', expected: true },
    { name: 'approved host over http is still denied', url: 'http://github.com', expected: false },
    { name: 'approved host with trailing dot is a different origin', url: 'https://github.com./', expected: false },
    { name: 'unapproved https host', url: 'https://example.com', expected: false },
    { name: 'credentials embedded in the URL', url: 'https://user:pass@github.com/', expected: false },
    { name: 'javascript: scheme', url: 'javascript:alert(1)', expected: false },
    { name: 'malformed/unparseable URL', url: 'not a url', expected: false },
    { name: 'the app dev origin is not an approved external destination', url: 'http://localhost:5173/', expected: false },
    { name: 'empty string', url: '', expected: false },
  ];

  for (const { name, url, expected } of cases) {
    it(`${name} -> ${expected ? 'allow' : 'deny'}`, () => {
      expect(isApprovedExternalUrl(url)).toBe(expected);
    });
  }
});

describe('describeUrlSchemeForLogging', () => {
  it('reports only the scheme for a file: URL, never the absolute path', () => {
    const secretPath = '/Users/very-secret-name/Documents/LumaCast/lumacast.sqlite';
    const result = describeUrlSchemeForLogging(pathToFileURL(secretPath).toString());

    expect(result).toBe('file:');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('/');
    expect(result).not.toContain('Users');
  });

  it('reports the scheme for an http(s) URL without the host or path', () => {
    const result = describeUrlSchemeForLogging('https://evil.example.com/leak?token=abc');
    expect(result).toBe('https:');
    expect(result).not.toContain('evil');
    expect(result).not.toContain('token');
  });

  it('reports "unparseable" for a malformed URL instead of throwing', () => {
    expect(describeUrlSchemeForLogging('not a url')).toBe('unparseable');
  });

  it('reports "unparseable" for an empty string', () => {
    expect(describeUrlSchemeForLogging('')).toBe('unparseable');
  });
});

describe('fetchLocalFileResponse', () => {
  it('returns validator headers and 304 for a matching If-None-Match request', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 10,
      mtime: new Date('2026-08-22T12:00:00.000Z'),
      mtimeMs: Date.parse('2026-08-22T12:00:00.000Z'),
    } as fs.Stats);

    const response = await fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'GET',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({ 'if-none-match': 'W/"10-1787400000000"' }),
    });

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('W/"10-1787400000000"');
    expect(response.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
    expect(response.headers.get('last-modified')).toBe('Sat, 22 Aug 2026 12:00:00 GMT');
  });

  it('ignores a byte range when If-Range no longer matches and falls back to the full response', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 12,
      mtime: new Date('2026-08-22T12:00:00.000Z'),
      mtimeMs: Date.parse('2026-08-22T12:00:00.000Z'),
    } as fs.Stats);
    vi.mocked(net.fetch).mockResolvedValue(new Response('full-body', {
      status: 200,
      headers: { 'content-length': '12' },
    }));

    const response = await fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'GET',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({
        range: 'bytes=0-3',
        'if-range': 'W/"12-0"',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('full-body');
    expect(response.headers.get('etag')).toBe('W/"12-1787400000000"');
  });

  it('treats weak If-Range validators as mismatches and falls back to the full response', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 12,
      mtime: new Date('2026-08-22T12:00:00.000Z'),
      mtimeMs: Date.parse('2026-08-22T12:00:00.000Z'),
    } as fs.Stats);
    vi.mocked(net.fetch).mockResolvedValue(new Response('full-body', {
      status: 200,
      headers: { 'content-length': '12' },
    }));

    const response = await fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'GET',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({
        range: 'bytes=0-3',
        'if-range': 'W/"12-1787400000000"',
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('full-body');
  });

  it('ignores Range for HEAD requests and returns the normal HEAD response', async () => {
    vi.spyOn(fs.promises, 'stat').mockResolvedValue({
      size: 20,
      mtime: new Date('2026-08-22T12:00:00.000Z'),
      mtimeMs: Date.parse('2026-08-22T12:00:00.000Z'),
    } as fs.Stats);

    const response = await fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'HEAD',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({ range: 'bytes=0-3' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('20');
    expect(response.headers.get('content-range')).toBeNull();
  });

  it('dedupes only concurrent stat calls and re-stats after the previous request settles', async () => {
    let resolveStat!: (stats: fs.Stats) => void;
    const statPromise = new Promise<fs.Stats>((resolve) => {
      resolveStat = resolve;
    });
    const statSpy = vi.spyOn(fs.promises, 'stat')
      .mockReturnValueOnce(statPromise)
      .mockResolvedValueOnce({
        size: 20,
        mtime: new Date('2026-08-22T12:00:01.000Z'),
        mtimeMs: Date.parse('2026-08-22T12:00:01.000Z'),
      } as fs.Stats);
    statSpy.mockClear();

    const first = fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'HEAD',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({ range: 'bytes=0-3' }),
    });
    const second = fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'HEAD',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({ range: 'bytes=4-7' }),
    });

    expect(statSpy).toHaveBeenCalledTimes(1);

    resolveStat({
      size: 20,
      mtime: new Date('2026-08-22T12:00:00.000Z'),
      mtimeMs: Date.parse('2026-08-22T12:00:00.000Z'),
    } as fs.Stats);

    await Promise.all([first, second]);

    await fetchLocalFileResponse('/tmp/video.mp4', {
      method: 'HEAD',
      referrer: '',
      url: 'cast-media://video',
      headers: new Headers({ range: 'bytes=0-3' }),
    });

    expect(statSpy).toHaveBeenCalledTimes(2);
  });
});

describe('configured development renderer trust', () => {
  it.each([
    'http://127.0.0.1:5199/renderer?view=app',
    'https://localhost:8443/renderer?view=app',
    'http://[::1]:5173/',
  ])('trusts only the configured development origin: %s', (configured) => {
    vi.stubEnv('ELECTRON_RENDERER_URL', configured);
    const expected = new URL(configured);
    expect(getDevServerUrl()).toBe(expected.toString());
    expected.searchParams.set('view', 'projector');
    expect(isTrustedWebContentsUrl(expected.toString())).toBe(true);
    expected.port = '5999';
    expect(isTrustedWebContentsUrl(expected.toString())).toBe(false);
  });

  it.each([
    undefined,
    '',
    'not a url',
    'https://example.com/',
    'http://localhost.evil.example/',
    'http://user:secret@localhost:5173/',
    'file:///tmp/renderer/index.html',
    'javascript:alert(1)',
  ])('falls back to file-only trust for invalid or missing config: %s', (configured) => {
    vi.stubEnv('ELECTRON_RENDERER_URL', configured);
    expect(getDevServerUrl()).toBeNull();
    expect(isTrustedWebContentsUrl('http://localhost:5173/')).toBe(false);
    expect(isTrustedWebContentsUrl(PACKAGED_RENDERER_URL)).toBe(true);
  });

  it('ignores a development URL in packaged builds', () => {
    environment.packaged = true;
    expect(getDevServerUrl()).toBeNull();
    expect(isTrustedWebContentsUrl('http://localhost:5173/')).toBe(false);
    expect(isTrustedWebContentsUrl('https://localhost:5173/')).toBe(false);
    expect(isTrustedWebContentsUrl(`${PACKAGED_RENDERER_URL}?view=ndi-output&output=stage`)).toBe(true);
  });
});

function ipcSender(url = PACKAGED_RENDERER_URL) {
  const mainFrame = { url };
  const sender = { mainFrame, getURL: vi.fn(() => url), isDestroyed: vi.fn(() => false) };
  const window = { webContents: sender, isDestroyed: vi.fn(() => false) };
  vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as BrowserWindow);
  const event = { sender, senderFrame: mainFrame } as unknown as IpcMainInvokeEvent;
  return { event, sender, window, mainFrame };
}

describe('assertTrustedIpcSender', () => {
  it.each([
    PACKAGED_RENDERER_URL,
    `${PACKAGED_RENDERER_URL}?view=projector`,
    `${PACKAGED_RENDERER_URL}?view=ndi-output&output=audience`,
  ])('accepts the packaged main frame and query views at %s', (url) => {
    environment.packaged = true;
    expect(() => assertTrustedIpcSender(ipcSender(url).event)).not.toThrow();
  });

  it.each([
    PACKAGED_RENDERER_URL,
    `${PACKAGED_RENDERER_URL}?view=projector`,
    `${PACKAGED_RENDERER_URL}?view=ndi-output&output=audience`,
    'http://localhost:5173/',
    'http://localhost:5173/?view=ndi-output&output=stage',
  ])('accepts a live owned main frame at %s', (url) => {
    const { event } = ipcSender(url);
    expect(() => assertTrustedIpcSender(event)).not.toThrow();
  });

  it.each([null, undefined])('rejects an absent sender frame (%s)', (senderFrame) => {
    const { event } = ipcSender();
    expect(() => assertTrustedIpcSender({ ...event, senderFrame } as IpcMainInvokeEvent)).toThrow(/main frame/);
  });

  it('rejects a same-URL child frame', () => {
    const { event, mainFrame } = ipcSender();
    const childEvent = { ...event, senderFrame: { ...mainFrame } } as unknown as IpcMainInvokeEvent;
    expect(() => assertTrustedIpcSender(childEvent)).toThrow(/main frame/);
  });

  it('rejects a sender with no owning BrowserWindow', () => {
    const { event } = ipcSender();
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
    expect(() => assertTrustedIpcSender(event)).toThrow(/application window/);
  });

  it('rejects a sender merely attached to another window', () => {
    const { event, window } = ipcSender();
    window.webContents = ipcSender().sender;
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(window as unknown as BrowserWindow);
    expect(() => assertTrustedIpcSender(event)).toThrow(/application window/);
  });

  it.each(['window', 'sender'] as const)('rejects a destroyed %s', (target) => {
    const fixture = ipcSender();
    fixture[target].isDestroyed.mockReturnValue(true);
    expect(() => assertTrustedIpcSender(fixture.event)).toThrow(/application window/);
  });

  it.each([
    'http://localhost:5174/',
    'https://localhost:5173/',
    'http://127.0.0.1:5173/',
    'http://user:password@localhost:5173/',
    ESCAPED_RENDERER_URL,
  ])('rejects an untrusted main frame at %s', (url) => {
    expect(() => assertTrustedIpcSender(ipcSender(url).event)).toThrow(/Untrusted IPC/);
  });

  it('rejects packaged loopback IPC even with a configured development URL', () => {
    environment.packaged = true;
    expect(() => assertTrustedIpcSender(ipcSender('http://localhost:5173/').event)).toThrow(/Untrusted IPC/);
  });

  it('checks both the current contents URL and frame URL without disclosing either', () => {
    const contents = ipcSender();
    contents.sender.getURL.mockReturnValue(ESCAPED_RENDERER_URL);
    expect(() => assertTrustedIpcSender(contents.event)).toThrow(/^Untrusted IPC sender URL$/);
    const frame = ipcSender();
    frame.mainFrame.url = ESCAPED_RENDERER_URL;
    expect(() => assertTrustedIpcSender(frame.event)).toThrow(/^Untrusted IPC frame URL$/);
  });
});

describe('managed media renderer referrers', () => {
  function request(referrer: string, headers: Headers | Record<string, string> = {}) {
    return {
      method: 'GET',
      referrer,
      headers,
      url: maskManagedMediaSource(`cast-media://${encodeURIComponent('/tmp/security-media.mp4')}`, 'video'),
    };
  }

  it.each([
    '',
    PACKAGED_RENDERER_URL,
    `${PACKAGED_RENDERER_URL}?view=ndi-output&output=audience`,
    'http://localhost:5173/?view=projector',
  ])('preserves an absent or trusted referrer: %s', (referrer) => {
    expect(resolveTrustedCastMediaRequest(request(referrer))).toEqual({ ok: true, filePath: '/tmp/security-media.mp4' });
  });

  it.each([
    'http://localhost:5174/',
    'https://localhost:5173/',
    'http://user:password@localhost:5173/',
    ESCAPED_RENDERER_URL,
  ])('rejects an untrusted referrer: %s', (referrer) => {
    expect(resolveTrustedCastMediaRequest(request(referrer))).toEqual({ ok: false, reason: 'untrusted-referrer' });
  });

  it('keeps absent packaged referrers working but denies a packaged loopback referrer', () => {
    environment.packaged = true;
    expect(resolveTrustedCastMediaRequest(request(''))).toEqual({ ok: true, filePath: '/tmp/security-media.mp4' });
    expect(resolveTrustedCastMediaRequest(request('http://localhost:5173/'))).toEqual({ ok: false, reason: 'untrusted-referrer' });
  });

  it('uses the HTTP Referer header when present, including Headers and plain record shapes', () => {
    expect(resolveTrustedCastMediaRequest(request(PACKAGED_RENDERER_URL, new Headers({ referer: 'http://localhost:5174/' })))).toEqual({ ok: false, reason: 'untrusted-referrer' });
    expect(resolveTrustedCastMediaRequest(request('http://localhost:5174/', { Referer: PACKAGED_RENDERER_URL }))).toEqual({ ok: true, filePath: '/tmp/security-media.mp4' });
  });
});
