// Fetches and caches the LumaCast suite's GitHub release catalog. The catalog
// is one repository-wide release list shared by every managed app (each
// release's tag prefix says which app it belongs to; @lumacast/suite's
// `parseReleaseCatalog` does that split), so one CatalogService instance
// serves the whole suite. The raw list is cached to disk so the UI has
// something to render before the first fetch completes, and keeps showing it
// if a later fetch fails (offline, rate-limited, GitHub down).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  parseReleaseCatalog,
  parseUpdateMetadata,
  suiteApp,
  updateMetadataFileNameFor,
  type AppRelease,
  type GitHubRelease,
  type HostPlatform,
  type SuiteAppId,
  type UpdateMetadata,
} from '@lumacast/suite';
import type { CatalogStatus } from '../../shared/desktop-api';

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/IT-PSAPE/LumaCast/releases?per_page=100';
// A generous but finite bound: at 100 releases/page this covers 1000
// releases, and it keeps a misbehaving or malicious Link header from causing
// an unbounded fetch loop.
const MAX_PAGES = 10;

// Structural validation of the parts of the GitHub REST release shape Cloud
// reads; everything else GitHub returns is stripped. This is deliberately
// looser than a full schema of the API response — Cloud only ever reads
// these fields.
const githubAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  size: z.number(),
});

const githubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
  html_url: z.string(),
  assets: z.array(githubAssetSchema),
});

const githubReleaseListSchema = z.array(githubReleaseSchema);

const cacheFileSchema = z.object({
  fetchedAt: z.string(),
  releases: githubReleaseListSchema,
});

export interface CatalogServiceOptions {
  /** Where the raw release list is cached, e.g. `<userData>/catalog-cache.json`. */
  cachePath: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Sent as the `User-Agent` header, e.g. `LumaCloud/0.1.0`. */
  userAgent: string;
}

function githubAuthToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.LUMACLOUD_GITHUB_TOKEN || undefined;
}

function requestHeaders(userAgent: string, accept: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, 'User-Agent': userAgent };
  const token = githubAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Extracts the `rel="next"` URL from a GitHub `Link` response header, if any. */
function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match && match[2] === 'next') return match[1];
  }
  return null;
}

export class CatalogService {
  status: CatalogStatus = 'idle';
  fetchedAt: string | null = null;
  error: string | null = null;

  private releases: GitHubRelease[] = [];
  // Distinguishes "no data has ever loaded" (releasesFor -> null) from "the
  // catalog is genuinely empty" (releasesFor -> []); `releases.length === 0`
  // cannot tell those apart.
  private hasData = false;

  private readonly cachePath: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly userAgent: string;

  constructor(opts: CatalogServiceOptions) {
    this.cachePath = opts.cachePath;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.userAgent = opts.userAgent;
  }

  /** Loads the on-disk cache, if any. Never throws; a bad cache is ignored. */
  async load(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.cachePath, 'utf8');
    } catch {
      return;
    }

    try {
      const cached = cacheFileSchema.parse(JSON.parse(text));
      this.releases = cached.releases;
      this.fetchedAt = cached.fetchedAt;
      this.hasData = true;
      this.status = 'ready';
    } catch (error) {
      console.error('[catalog-service] invalid catalog cache, ignoring', error);
    }
  }

  /**
   * Fetches the full release list from GitHub, following `Link: rel="next"`
   * pagination. On success, replaces the in-memory catalog and cache. On
   * failure, leaves both untouched and reports `error` — the UI keeps
   * whatever it had (including a cache loaded from a previous run).
   */
  async refresh(): Promise<void> {
    this.status = 'loading';
    try {
      const releases = await this.fetchAllReleases();
      this.releases = releases;
      this.fetchedAt = new Date().toISOString();
      this.hasData = true;
      this.error = null;
      this.status = 'ready';
      await this.persistCache();
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  private async fetchAllReleases(): Promise<GitHubRelease[]> {
    const collected: unknown[] = [];
    let url: string | null = GITHUB_RELEASES_URL;
    let page = 0;

    while (url && page < MAX_PAGES) {
      page += 1;
      const response = await this.fetchFn(url, {
        headers: requestHeaders(this.userAgent, 'application/vnd.github+json'),
      });
      if (!response.ok) {
        throw new Error(`GitHub releases request failed: ${response.status} ${response.statusText}`);
      }
      const body: unknown = await response.json();
      if (!Array.isArray(body)) {
        throw new Error('GitHub releases response was not an array');
      }
      collected.push(...body);
      url = nextPageUrl(response.headers.get('link'));
    }

    return githubReleaseListSchema.parse(collected);
  }

  private async persistCache(): Promise<void> {
    await mkdir(path.dirname(this.cachePath), { recursive: true });
    const tmp = `${this.cachePath}.tmp`;
    await writeFile(tmp, JSON.stringify({ fetchedAt: this.fetchedAt, releases: this.releases }));
    await rename(tmp, this.cachePath);
  }

  /** Every installable release for `app`, newest first; null before any data has loaded. */
  releasesFor(app: SuiteAppId): AppRelease[] | null {
    if (!this.hasData) return null;
    return parseReleaseCatalog(this.releases, suiteApp(app));
  }

  /** Downloads and parses a release's updater metadata file for `platform`. */
  async metadataFor(release: AppRelease, platform: HostPlatform): Promise<UpdateMetadata> {
    const fileName = updateMetadataFileNameFor(platform);
    const asset = release.assets.find((candidate) => candidate.name === fileName);
    if (!asset) {
      throw new Error(`Release ${release.tag} has no ${fileName} asset for ${platform}`);
    }

    const response = await this.fetchFn(asset.browser_download_url, {
      headers: requestHeaders(this.userAgent, 'application/octet-stream'),
    });
    if (!response.ok) {
      throw new Error(`Failed to download ${fileName}: ${response.status} ${response.statusText}`);
    }
    return parseUpdateMetadata(await response.text());
  }
}
