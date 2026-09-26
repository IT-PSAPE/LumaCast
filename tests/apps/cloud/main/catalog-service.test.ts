import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitHubRelease } from '@lumacast/suite';
import { CatalogService } from '../../../../apps/cloud/main/suite/catalog-service';

const PAGE_1_URL = 'https://api.github.com/repos/IT-PSAPE/LumaCast/releases?per_page=100';
const PAGE_2_URL = 'https://api.github.com/repos/IT-PSAPE/LumaCast/releases?per_page=100&page=2';

const RELEASE_1_2_0: GitHubRelease = {
  tag_name: 'cast-v1.2.0',
  draft: false,
  prerelease: false,
  published_at: '2026-02-01T00:00:00.000Z',
  html_url: 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.2.0',
  assets: [
    { name: 'latest-mac.yml', browser_download_url: 'https://example.com/latest-mac.yml', size: 300 },
    { name: 'LumaCast-1.2.0-arm64-mac.zip', browser_download_url: 'https://example.com/1.2.0.zip', size: 1000 },
  ],
};

const RELEASE_1_1_0: GitHubRelease = {
  tag_name: 'cast-v1.1.0',
  draft: false,
  prerelease: false,
  published_at: '2026-01-01T00:00:00.000Z',
  html_url: 'https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v1.1.0',
  assets: [
    { name: 'latest-mac.yml', browser_download_url: 'https://example.com/1.1.0/latest-mac.yml', size: 300 },
    { name: 'LumaCast-1.1.0-arm64-mac.zip', browser_download_url: 'https://example.com/1.1.0.zip', size: 900 },
  ],
};

function jsonResponse(body: unknown, link?: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: (name: string) => (name.toLowerCase() === 'link' ? (link ?? null) : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function textResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => JSON.parse(body),
    text: async () => body,
  } as unknown as Response;
}

function pagedFetch(): typeof globalThis.fetch {
  return (async (input: unknown) => {
    const url = String(input);
    if (url === PAGE_1_URL) {
      return jsonResponse([RELEASE_1_2_0], `<${PAGE_2_URL}>; rel="next"`);
    }
    if (url === PAGE_2_URL) {
      return jsonResponse([RELEASE_1_1_0]);
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof globalThis.fetch;
}

let dir: string;
let cachePath: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'lumacloud-catalog-'));
  cachePath = path.join(dir, 'catalog-cache.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('apps/cloud CatalogService', () => {
  it('is idle with no data before anything loads', () => {
    const catalog = new CatalogService({ cachePath, userAgent: 'LumaCloud/test' });
    expect(catalog.status).toBe('idle');
    expect(catalog.releasesFor('cast')).toBeNull();
  });

  it('follows Link: rel="next" pagination and merges every page', async () => {
    const catalog = new CatalogService({ cachePath, userAgent: 'LumaCloud/test', fetch: pagedFetch() });
    await catalog.refresh();

    expect(catalog.status).toBe('ready');
    expect(catalog.error).toBeNull();
    expect(catalog.fetchedAt).not.toBeNull();

    const releases = catalog.releasesFor('cast');
    expect(releases).not.toBeNull();
    expect(releases!.map((release) => release.version)).toEqual(['1.2.0', '1.1.0']);
  });

  it('writes the merged catalog to the cache file', async () => {
    const catalog = new CatalogService({ cachePath, userAgent: 'LumaCloud/test', fetch: pagedFetch() });
    await catalog.refresh();

    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    expect(cached.fetchedAt).toBe(catalog.fetchedAt);
    expect(cached.releases).toHaveLength(2);
    expect(cached.releases.map((r: GitHubRelease) => r.tag_name).sort()).toEqual(['cast-v1.1.0', 'cast-v1.2.0']);
  });

  it('loads a previously written cache without any fetch', async () => {
    const first = new CatalogService({ cachePath, userAgent: 'LumaCloud/test', fetch: pagedFetch() });
    await first.refresh();

    const second = new CatalogService({
      cachePath,
      userAgent: 'LumaCloud/test',
      fetch: (() => {
        throw new Error('load() must not fetch');
      }) as unknown as typeof globalThis.fetch,
    });
    await second.load();

    expect(second.status).toBe('ready');
    expect(second.releasesFor('cast')?.map((r) => r.version)).toEqual(['1.2.0', '1.1.0']);
  });

  it('keeps the existing catalog and reports the error when a refresh fails', async () => {
    const catalog = new CatalogService({ cachePath, userAgent: 'LumaCloud/test', fetch: pagedFetch() });
    await catalog.refresh();
    const fetchedAtBeforeFailure = catalog.fetchedAt;

    const failing = new CatalogService({
      cachePath,
      userAgent: 'LumaCloud/test',
      fetch: (async () => {
        throw new Error('network down');
      }) as unknown as typeof globalThis.fetch,
    });
    await failing.load();
    await failing.refresh();

    expect(failing.status).toBe('error');
    expect(failing.error).toContain('network down');
    // The cache loaded before the failed refresh is untouched.
    expect(failing.fetchedAt).toBe(fetchedAtBeforeFailure);
    expect(failing.releasesFor('cast')?.map((r) => r.version)).toEqual(['1.2.0', '1.1.0']);
  });

  it('metadataFor downloads and parses the release update-metadata asset', async () => {
    const yaml = [
      'version: 1.2.0',
      'files:',
      '  - url: LumaCast-1.2.0-arm64-mac.zip',
      '    sha512: ' + 'A'.repeat(84) + '==',
      '    size: 1000',
      'path: LumaCast-1.2.0-arm64-mac.zip',
      'sha512: ' + 'A'.repeat(84) + '==',
      "releaseDate: '2026-02-01T00:00:00.000Z'",
      '',
    ].join('\n');

    const catalog = new CatalogService({
      cachePath,
      userAgent: 'LumaCloud/test',
      fetch: (async (input: unknown) => {
        expect(String(input)).toBe('https://example.com/latest-mac.yml');
        return textResponse(yaml);
      }) as typeof globalThis.fetch,
    });

    const release = {
      app: 'cast' as const,
      version: '1.2.0',
      tag: 'cast-v1.2.0',
      legacy: false,
      publishedAt: RELEASE_1_2_0.published_at,
      notesUrl: RELEASE_1_2_0.html_url,
      assets: RELEASE_1_2_0.assets,
    };

    const metadata = await catalog.metadataFor(release, 'darwin');
    expect(metadata.version).toBe('1.2.0');
    expect(metadata.files).toEqual([
      { url: 'LumaCast-1.2.0-arm64-mac.zip', sha512: 'A'.repeat(84) + '==', size: 1000 },
    ]);
    expect(metadata.sha512).toBe('A'.repeat(84) + '==');
  });
});
