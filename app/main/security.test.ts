import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// security.ts imports BrowserWindow and net from 'electron' (used by
// assertTrustedIpcSender / fetchLocalFileResponse, which this file does not
// exercise) and resolveLocalMediaSourcePath from '@database/media-source-utils'
// (a plain Node module with no Electron dependency, so it needs no mock).
// Only the electron members actually referenced at module scope need stubs
// so the import doesn't crash — following the pattern in
// app/main/application-menu.test.ts.
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  net: { fetch: vi.fn() },
}));

import {
  describeUrlSchemeForLogging,
  isApprovedExternalUrl,
  isTrustedWebContentsUrl,
} from './security';

// The packaged renderer path is resolved from this test file's own
// __dirname, which sits in app/main alongside security.ts and index.ts —
// exactly mirroring how security.ts resolves PACKAGED_RENDERER_INDEX_PATH
// and how index.ts's loadRendererView resolves the file it loads.
const PACKAGED_RENDERER_URL = pathToFileURL(path.join(__dirname, '../renderer/index.html')).toString();

// A file that shares the "/renderer/index.html" suffix but lives entirely
// outside the app's own build output — the local-file-escape case a naive
// suffix check would wrongly allow.
const ESCAPED_RENDERER_URL = pathToFileURL('/tmp/attacker-controlled/renderer/index.html').toString();

describe('isTrustedWebContentsUrl (will-navigate allow-list)', () => {
  const cases: Array<{ name: string; url: string; expected: boolean }> = [
    { name: 'dev origin: localhost', url: 'http://localhost:5173/', expected: true },
    { name: 'dev origin: 127.0.0.1', url: 'http://127.0.0.1:5173/', expected: true },
    { name: 'dev origin host differs only by case', url: 'http://LOCALHOST:5173/', expected: true },
    { name: 'packaged renderer file:// path', url: PACKAGED_RENDERER_URL, expected: true },
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
    { name: 'approved external origin (openai.com)', url: 'https://openai.com', expected: true },
    { name: 'approved origin with a path', url: 'https://openai.com/some/path', expected: true },
    { name: 'approved origin, host differs only by case', url: 'https://OpenAI.COM', expected: true },
    { name: 'approved host over http is still denied', url: 'http://openai.com', expected: false },
    { name: 'approved host with trailing dot is a different origin', url: 'https://openai.com./', expected: false },
    { name: 'unapproved https host', url: 'https://example.com', expected: false },
    { name: 'credentials embedded in the URL', url: 'https://user:pass@openai.com/', expected: false },
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
