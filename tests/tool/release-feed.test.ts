import { describe, expect, it } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideFeedUpdate,
  feedTagFor,
  isFeedMetadataFile,
  parseUpdateMetadata,
  readFeedVersions,
  rewriteUpdateMetadata,
} from '../../tool/release-feed.mjs';

const CLI = fileURLToPath(new URL('../../tool/release-feed.mjs', import.meta.url));

const DOWNLOAD_BASE = 'https://github.com/IT-PSAPE/LumaCast/releases/download/cast-v1.2.0';

const APPIMAGE_HASH =
  'kM3F9Yx1pQb7Zt0mA5nC8dE2fL4rU6vH9jK1lO3pQ5rS7tU9wX1yZ3aB5cD7eF9gH2iJ4kL6mN8oP0qR2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0eF2g==';
const DEB_HASH =
  'pQ7Zt0mA5nC8dE2fL4rU6vH9jK1lO3pQ5rS7tU9wX1yZ3aB5cD7eF9gH2iJ4kL6mN8oP0qR2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0eF2gH4iJ6kL8m==';
const ZIP_HASH =
  'tU9wX1yZ3aB5cD7eF9gH2iJ4kL6mN8oP0qR2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0eF2gH4iJ6kL8mN0oP2qR4sT6uV8wX0yZ2aB4cD6eF8g==';
const EXE_HASH =
  'vH9jK1lO3pQ5rS7tU9wX1yZ3aB5cD7eF9gH2iJ4kL6mN8oP0qR2sT4uV6wX8yZ0aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8cD0eF2gH4iJ6kL8mN0oP2qR4sT6uV8wX0yZ2aB4cD6eF8gH0i==';

const LINUX_METADATA = `version: 1.2.0
files:
  - url: LumaCast-1.2.0-linux.AppImage
    sha512: ${APPIMAGE_HASH}
    size: 91234567
    blockMapSize: 1024
  - url: LumaCast-1.2.0-linux.deb
    sha512: ${DEB_HASH}
    size: 91230000
path: LumaCast-1.2.0-linux.AppImage
sha512: ${APPIMAGE_HASH}
releaseDate: '2026-09-26T10:11:12.000Z'
`;

const MAC_METADATA = `version: 1.2.0
files:
  - url: LumaCast-1.2.0-mac.zip
    sha512: ${ZIP_HASH}
    size: 91230001
path: LumaCast-1.2.0-mac.zip
sha512: ${ZIP_HASH}
releaseDate: '2026-09-26T10:11:12.000Z'
minimumSystemVersion: '11.0'
`;

const WINDOWS_METADATA = `version: 1.2.0
files:
  - url: LumaCast-1.2.0-win.exe
    sha512: ${EXE_HASH}
    size: 91230002
    blockMapSize: 4096
path: LumaCast-1.2.0-win.exe
sha512: ${EXE_HASH}
releaseDate: '2026-09-26T10:11:12.000Z'
packages:
  x64:
    path: LumaCast-1.2.0-win.exe
    sha512: ${EXE_HASH}
    size: 91230002
    blockMapSize: 4096
  ia32:
    path: LumaCast-1.2.0-win-ia32.exe
    sha512: ${DEB_HASH}
    size: 91230003
`;

const FLUX_DOWNLOAD_BASE =
  'https://github.com/IT-PSAPE/LumaCast/releases/download/flux-v0.11.0%2B1';

const FLUX_LINUX_METADATA = `version: 0.11.0+1
files:
  - url: Lumaflux-0.11.0+1-linux.AppImage
    sha512: ${APPIMAGE_HASH}
    size: 91234567
    blockMapSize: 1024
path: Lumaflux-0.11.0+1-linux.AppImage
sha512: ${APPIMAGE_HASH}
releaseDate: '2026-09-26T10:11:12.000Z'
`;

const FLUX_NEWER_METADATA = FLUX_LINUX_METADATA.replace(
  'version: 0.11.0+1',
  'version: 0.11.0+2',
);

function rewrite(text: string, overrides: { downloadBaseUrl?: string; source?: string; text?: string; app?: string } = {}): { text: string; version: string; artifacts: string[] } {
  return rewriteUpdateMetadata({ text, downloadBaseUrl: DOWNLOAD_BASE, ...overrides });
}

function rewriteFlux(text: string, overrides: { downloadBaseUrl?: string; source?: string } = {}): { text: string; version: string; artifacts: string[] } {
  return rewriteUpdateMetadata({
    text,
    downloadBaseUrl: FLUX_DOWNLOAD_BASE,
    app: 'flux',
    ...overrides,
  });
}

function writeTempFile(name: string, contents: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-'));
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

function runCli(args: string[], env: Record<string, string | undefined>): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function outputOf(result: SpawnSyncReturns<string>): Record<string, string> {
  expect(result.status, result.stderr).toBe(0);
  return Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map((line: string) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function packagePathsOf(text: string): Record<string, string> {
  const packages = parseUpdateMetadata(text).packages ?? {};
  return Object.fromEntries(
    Object.entries(packages).map(([arch, info]) => [arch, info.path]),
  );
}

describe('rewriteUpdateMetadata', () => {
  it('points every file url at the immutable version release', () => {
    const result = rewrite(LINUX_METADATA);
    const parsed = parseUpdateMetadata(result.text);

    expect(parsed.files.map((file) => file.url)).toEqual([
      `${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`,
      `${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.deb`,
    ]);
  });

  it('rewrites the deprecated top-level path to an absolute url', () => {
    expect(parseUpdateMetadata(rewrite(LINUX_METADATA).text).path)
      .toBe(`${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`);
  });

  it('rewrites every per-architecture package path and keeps the architecture keys', () => {
    expect(packagePathsOf(rewrite(WINDOWS_METADATA).text)).toEqual({
      x64: `${DOWNLOAD_BASE}/LumaCast-1.2.0-win.exe`,
      ia32: `${DOWNLOAD_BASE}/LumaCast-1.2.0-win-ia32.exe`,
    });
  });

  it('preserves hashes, sizes, and every non-url field', () => {
    const parsed = parseUpdateMetadata(rewrite(LINUX_METADATA).text);

    expect(parsed.version).toBe('1.2.0');
    expect(parsed.sha512).toBe(APPIMAGE_HASH);
    expect(parsed.releaseDate).toBe('2026-09-26T10:11:12.000Z');
    expect(parsed.files[0]).toEqual({
      url: `${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`,
      sha512: APPIMAGE_HASH,
      size: 91234567,
      blockMapSize: 1024,
    });
    expect(parsed.files[1].sha512).toBe(DEB_HASH);
    expect(parsed.files[1].size).toBe(91230000);
  });

  it('preserves the platform notes the updater needs', () => {
    expect(parseUpdateMetadata(rewrite(MAC_METADATA).text).minimumSystemVersion).toBe('11.0');
  });

  it('keeps checksums on one line so hashes stay intact', () => {
    const result = rewrite(LINUX_METADATA);

    expect(result.text).toContain(APPIMAGE_HASH);
    expect(result.text.split('\n').every((line) => line.length < 200)).toBe(true);
  });

  it('drops a build-relative directory from artifact references', () => {
    const result = rewriteUpdateMetadata({
      text: `version: 1.2.0
files:
  - url: apps/cast/dist/LumaCast-1.2.0-linux.AppImage
    sha512: ${APPIMAGE_HASH}
path: apps/cast/dist/LumaCast-1.2.0-linux.AppImage
`,
      downloadBaseUrl: DOWNLOAD_BASE,
    });

    const parsed = parseUpdateMetadata(result.text);
    expect(parsed.files[0].url).toBe(`${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`);
    expect(parsed.path).toBe(`${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`);
  });

  it('encodes characters that are unsafe in a url path', () => {
    const result = rewriteUpdateMetadata({
      text: `version: 1.2.0
files:
  - url: 'LumaCast Cloud 1.2.0 #1.mac.zip'
    sha512: ${ZIP_HASH}
`,
      downloadBaseUrl: DOWNLOAD_BASE,
    });

    expect(parseUpdateMetadata(result.text).files[0].url)
      .toBe(`${DOWNLOAD_BASE}/LumaCast%20Cloud%201.2.0%20%231.mac.zip`);
  });

  it('leaves metadata without a path or packages entry alone', () => {
    const result = rewriteUpdateMetadata({
      text: `version: 1.2.0
files:
  - url: LumaCast-1.2.0-linux.AppImage
    sha512: ${APPIMAGE_HASH}
`,
      downloadBaseUrl: DOWNLOAD_BASE,
    });

    expect(Object.keys(parseUpdateMetadata(result.text))).toEqual(['version', 'files']);
  });

  it('normalizes an unquoted release date to a stable quoted timestamp', () => {
    const result = rewriteUpdateMetadata({
      text: `version: 1.2.0
files:
  - url: LumaCast-1.2.0-linux.AppImage
    sha512: ${APPIMAGE_HASH}
releaseDate: 2026-09-26T10:11:12.000Z
`,
      downloadBaseUrl: DOWNLOAD_BASE,
    });

    expect(result.text).toContain("releaseDate: '2026-09-26T10:11:12.000Z'");
    expect(parseUpdateMetadata(result.text).releaseDate).toBe('2026-09-26T10:11:12.000Z');
  });

  it('reports the version and the absolute artifact urls it produced', () => {
    const result = rewrite(WINDOWS_METADATA);

    expect(result.version).toBe('1.2.0');
    expect(result.artifacts).toEqual([
      `${DOWNLOAD_BASE}/LumaCast-1.2.0-win.exe`,
      `${DOWNLOAD_BASE}/LumaCast-1.2.0-win.exe`,
      `${DOWNLOAD_BASE}/LumaCast-1.2.0-win.exe`,
      `${DOWNLOAD_BASE}/LumaCast-1.2.0-win-ia32.exe`,
    ]);
  });

  it('tolerates a trailing slash on the download base', () => {
    const result = rewrite(LINUX_METADATA, { downloadBaseUrl: `${DOWNLOAD_BASE}/` });
    expect(parseUpdateMetadata(result.text).files[0].url)
      .toBe(`${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`);
  });

  it.each([
    ['a relative download base', 'releases/download/cast-v1.2.0', 'must be an absolute URL'],
    ['a non-http download base', 'ftp://example.com/cast-v1.2.0', 'must use http or https'],
    ['an empty download base', '', 'download base URL is required'],
  ])('rejects %s', (_label, downloadBaseUrl, message) => {
    expect(() => rewrite(LINUX_METADATA, { downloadBaseUrl })).toThrow(message);
  });

  it.each([
    ['metadata that is not a mapping', '- 1.2.0\n', 'must be a YAML mapping'],
    ['invalid yaml', 'version: 1.2.0\nfiles: [\n', 'is not valid YAML'],
    ['metadata without a version', 'files:\n  - url: a.AppImage\n', 'declares no version'],
    ['metadata without files', 'version: 1.2.0\n', 'declares no files'],
    ['metadata with an empty files list', 'version: 1.2.0\nfiles: []\n', 'declares no files'],
    [
      'metadata with an unstable version',
      'version: 1.2.0-rc.1\nfiles:\n  - url: a.AppImage\n',
      'stable semantic version',
    ],
    [
      'metadata with an empty artifact reference',
      'version: 1.2.0\nfiles:\n  - url: ""\n    sha512: a\n',
      'empty files[0].url artifact reference',
    ],
    [
      'metadata with an unusable artifact reference',
      'version: 1.2.0\nfiles:\n  - url: ".."\n    sha512: a\n',
      'unusable files[0].url artifact reference',
    ],
    [
      'metadata with a non-mapping file entry',
      'version: 1.2.0\nfiles:\n  - a.AppImage\n',
      'files[0] must be a mapping',
    ],
  ])('rejects %s', (_label, text, message) => {
    expect(() => rewrite(text)).toThrow(message);
  });

  it('names the source file in metadata errors', () => {
    expect(() => rewrite('version: 1.2.0\n', { source: 'update metadata latest-mac.yml' }))
      .toThrow('update metadata latest-mac.yml declares no files');
  });
  it('rewrites a Flux revisioned release without stripping its revision', () => {
    const result = rewriteFlux(FLUX_LINUX_METADATA);

    expect(result.version).toBe('0.11.0+1');
    // The revision names the immutable release the feed points at, so it stays
    // in the artifact name and is percent-encoded in the url.
    expect(parseUpdateMetadata(result.text, 'update metadata', 'flux').files[0].url)
      .toBe(`${FLUX_DOWNLOAD_BASE}/Lumaflux-0.11.0%2B1-linux.AppImage`);
  });

  it('refuses revisioned metadata for a strict app or an app-unaware caller', () => {
    expect(() => rewrite(FLUX_LINUX_METADATA)).toThrow('stable semantic version');
    expect(() => rewriteUpdateMetadata({
      text: FLUX_LINUX_METADATA,
      downloadBaseUrl: FLUX_DOWNLOAD_BASE,
      app: 'cast',
    })).toThrow('stable semantic version');
  });

  it.each([
    ['a prerelease', '0.11.0-rc.1'],
    ['non-numeric build metadata', '0.11.0+build.1'],
    ['a leading zero revision', '0.11.0+01'],
    ['a revision beyond exact comparison', `0.11.0+${Number.MAX_SAFE_INTEGER + 10}`],
  ])('refuses Flux feed metadata carrying %s', (_label, version) => {
    const text = FLUX_LINUX_METADATA.replace('version: 0.11.0+1', `version: ${version}`);

    expect(() => rewriteFlux(text)).toThrow(/stable semantic version|exactly comparable range/);
  });

  it('accepts Flux feed metadata at the 65535 Windows build boundary', () => {
    const text = FLUX_LINUX_METADATA.replace('version: 0.11.0+1', 'version: 65535.65535.65535+65535');

    expect(rewriteFlux(text).version).toBe('65535.65535.65535+65535');
  });

  it.each([
    ['major', '65536.0.0+1'],
    ['minor', '0.65536.0+1'],
    ['patch', '0.11.65536+1'],
    ['revision', '0.11.0+65536'],
  ])('refuses Flux feed metadata whose %s exceeds the Windows build boundary', (_label, version) => {
    // The feed names the immutable release the updater downloads, so it must
    // not point at a version the Windows build could never have produced.
    const text = FLUX_LINUX_METADATA.replace('version: 0.11.0+1', `version: ${version}`);

    expect(() => rewriteFlux(text)).toThrow('between 0 and 65535');
  });
});

describe('feed tags', () => {
  it('derives one permanent feed tag per app', () => {
    expect(feedTagFor('cast')).toBe('cast-feed');
    expect(feedTagFor('cloud')).toBe('cloud-feed');
    expect(feedTagFor('flux')).toBe('flux-feed');
  });

  it('rejects an app outside the released set', () => {
    expect(() => feedTagFor('studio')).toThrow('Unknown release app');
  });

  it('recognises only electron-builder channel metadata', () => {
    expect(isFeedMetadataFile('latest.yml')).toBe(true);
    expect(isFeedMetadataFile('latest-linux.yml')).toBe(true);
    expect(isFeedMetadataFile('latest-mac.yml')).toBe(true);
    expect(isFeedMetadataFile('beta.yml')).toBe(false);
    expect(isFeedMetadataFile('LumaCast-1.2.0-linux.AppImage')).toBe(false);
  });
});

describe('decideFeedUpdate', () => {
  it('publishes the first feed', () => {
    expect(decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0',
      currentFeedVersion: undefined,
      releasePublished: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-empty',
      feedTag: 'cast-feed',
      incomingVersion: '1.2.0',
      feedVersion: '',
    });
  });

  it('heals a draft feed left by a failed first upload as an empty feed', () => {
    // The workflow never downloads a draft or absent feed release: both map
    // to an empty baseline here so the rerun republishes instead of erroring
    // on unavailable metadata. Only a published feed download may fail.
    expect(decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0',
      currentFeedVersion: undefined,
      releasePublished: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-empty',
      feedTag: 'cast-feed',
      incomingVersion: '1.2.0',
      feedVersion: '',
    });
  });

  it('publishes a higher version', () => {
    expect(decideFeedUpdate({
      app: 'cloud',
      incomingVersion: '1.3.0',
      currentFeedVersion: '1.2.0',
      releasePublished: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-version-increased',
      feedTag: 'cloud-feed',
      incomingVersion: '1.3.0',
      feedVersion: '1.2.0',
    });
  });

  it('repairs a split feed by republishing the same version', () => {
    // A partial upload can leave channel files on two versions. Rerunning the
    // known version release heals the split without downgrading.
    expect(decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0',
      currentFeedVersion: '1.2.0',
      releasePublished: true,
      feedInconsistent: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-repair',
      feedTag: 'cast-feed',
      incomingVersion: '1.2.0',
      feedVersion: '1.2.0',
    });
  });

  it('advances a split feed to a higher version', () => {
    expect(decideFeedUpdate({
      app: 'cloud',
      incomingVersion: '1.3.0',
      currentFeedVersion: '1.2.0',
      releasePublished: true,
      feedInconsistent: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-version-increased',
      feedTag: 'cloud-feed',
      incomingVersion: '1.3.0',
      feedVersion: '1.2.0',
    });
  });
  it('is a no-op when the feed already serves the version', () => {
    expect(decideFeedUpdate({
      app: 'flux',
      incomingVersion: '1.2.0',
      currentFeedVersion: '1.2.0',
      releasePublished: true,
    })).toEqual({
      shouldUpdate: false,
      reason: 'feed-already-current',
      feedTag: 'flux-feed',
      incomingVersion: '1.2.0',
      feedVersion: '1.2.0',
    });
  });

  it('never rewrites the feed from a version release that is not published', () => {
    expect(decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0',
      currentFeedVersion: '1.1.0',
      releasePublished: false,
    })).toEqual({
      shouldUpdate: false,
      reason: 'release-not-published',
      feedTag: 'cast-feed',
      incomingVersion: '1.2.0',
      feedVersion: '1.1.0',
    });
  });

  it('refuses to roll the feed back', () => {
    expect(() => decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.1.0',
      currentFeedVersion: '1.2.0',
      releasePublished: true,
    })).toThrow('refusing to roll it back');
  });

  it('refuses a feed that serves an unstable version', () => {
    expect(() => decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0',
      currentFeedVersion: '1.2.0-rc.1',
      releasePublished: true,
    })).toThrow('stable semantic version');
  });

  it('refuses an unstable incoming version even when the release is unpublished', () => {
    expect(() => decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0-rc.1',
      currentFeedVersion: undefined,
      releasePublished: false,
    })).toThrow('stable semantic version');
  });

  it('advances a Flux feed to a higher build revision', () => {
    expect(decideFeedUpdate({
      app: 'flux',
      incomingVersion: '0.11.0+2',
      currentFeedVersion: '0.11.0+1',
      releasePublished: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-version-increased',
      feedTag: 'flux-feed',
      incomingVersion: '0.11.0+2',
      feedVersion: '0.11.0+1',
    });
  });

  it('advances a Flux feed past a revision to the next feature version', () => {
    expect(decideFeedUpdate({
      app: 'flux',
      incomingVersion: '0.11.1',
      currentFeedVersion: '0.11.0+9',
      releasePublished: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-version-increased',
      feedTag: 'flux-feed',
      incomingVersion: '0.11.1',
      feedVersion: '0.11.0+9',
    });
  });

  it('heals a Flux feed split across a revision and its base version', () => {
    // A partial upload can leave channel files on 0.11.0 and 0.11.0+1; the
    // incoming revision is the highest of the three, so it repairs the feed.
    expect(decideFeedUpdate({
      app: 'flux',
      incomingVersion: '0.11.0+1',
      currentFeedVersion: '0.11.0+1',
      releasePublished: true,
      feedInconsistent: true,
    })).toEqual({
      shouldUpdate: true,
      reason: 'feed-repair',
      feedTag: 'flux-feed',
      incomingVersion: '0.11.0+1',
      feedVersion: '0.11.0+1',
    });
  });

  it('refuses to roll a Flux feed back to an earlier revision', () => {
    expect(() => decideFeedUpdate({
      app: 'flux',
      incomingVersion: '0.11.0+1',
      currentFeedVersion: '0.11.0+2',
      releasePublished: true,
    })).toThrow('refusing to roll it back');
  });

  it('refuses a revisioned feed version for a strict app', () => {
    expect(() => decideFeedUpdate({
      app: 'cast',
      incomingVersion: '1.2.0',
      currentFeedVersion: '1.2.0+1',
      releasePublished: true,
    })).toThrow('stable semantic version');
  });

  it('refuses a Flux feed version whose component exceeds the Windows build boundary', () => {
    expect(() => decideFeedUpdate({
      app: 'flux',
      incomingVersion: '0.11.0+65536',
      currentFeedVersion: '0.11.0',
      releasePublished: true,
    })).toThrow('between 0 and 65535');
  });

  it('heals a Flux feed already at the Windows build boundary', () => {
    expect(decideFeedUpdate({
      app: 'flux',
      incomingVersion: '65535.65535.65535+65535',
      currentFeedVersion: '65535.65535.65535+65535',
      releasePublished: true,
    })).toEqual({
      shouldUpdate: false,
      reason: 'feed-already-current',
      feedTag: 'flux-feed',
      incomingVersion: '65535.65535.65535+65535',
      feedVersion: '65535.65535.65535+65535',
    });
  });
});

describe('readFeedVersions', () => {
  it('reads the version of every channel file in the feed directory', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-dir-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), LINUX_METADATA);
    fs.writeFileSync(path.join(directory, 'latest.yml'), WINDOWS_METADATA);
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignored');

    expect(readFeedVersions(directory)).toEqual(['1.2.0', '1.2.0']);
  });

  it('returns nothing for a feed that does not exist yet', () => {
    expect(readFeedVersions(path.join(os.tmpdir(), 'release-feed-absent'))).toEqual([]);
    expect(readFeedVersions('')).toEqual([]);
  });

  it('reads a Flux revisioned feed for the app that publishes revisions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-revision-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), FLUX_LINUX_METADATA);

    expect(readFeedVersions(directory, 'flux')).toEqual(['0.11.0+1']);
    expect(() => readFeedVersions(directory, 'cast')).toThrow('stable semantic version');
    expect(() => readFeedVersions(directory)).toThrow('stable semantic version');
  });
});

describe('release-feed rewrite command', () => {
  it('writes the rewritten metadata under the requested output path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-cli-'));
    const outputFile = path.join(directory, 'feed', 'latest-linux.yml');
    const result = runCli(['rewrite'], {
      RELEASE_APP: 'cast',
      METADATA_FILE: writeTempFile('latest-linux.yml', LINUX_METADATA),
      OUTPUT_FILE: outputFile,
      DOWNLOAD_BASE_URL: DOWNLOAD_BASE,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(path.basename(outputFile)).toBe('latest-linux.yml');
    expect(parseUpdateMetadata(fs.readFileSync(outputFile, 'utf8')).files[0].url)
      .toBe(`${DOWNLOAD_BASE}/LumaCast-1.2.0-linux.AppImage`);
  });

  it('prints the rewritten metadata when no output file is given', () => {
    const result = runCli(['rewrite'], {
      RELEASE_APP: 'flux',
      METADATA_FILE: writeTempFile('latest.yml', WINDOWS_METADATA),
      OUTPUT_FILE: '',
      DOWNLOAD_BASE_URL: DOWNLOAD_BASE,
    });

    expect(packagePathsOf(result.stdout)).toEqual({
      x64: `${DOWNLOAD_BASE}/LumaCast-1.2.0-win.exe`,
      ia32: `${DOWNLOAD_BASE}/LumaCast-1.2.0-win-ia32.exe`,
    });
  });

  it('rewrites a revisioned Flux release from the command line', () => {
    const outputFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-flux-cli-')),
      'latest-linux.yml',
    );
    const result = runCli(['rewrite'], {
      RELEASE_APP: 'flux',
      METADATA_FILE: writeTempFile('latest-linux.yml', FLUX_LINUX_METADATA),
      OUTPUT_FILE: outputFile,
      DOWNLOAD_BASE_URL: FLUX_DOWNLOAD_BASE,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(parseUpdateMetadata(fs.readFileSync(outputFile, 'utf8'), 'update metadata', 'flux'))
      .toMatchObject({ version: '0.11.0+1' });
  });

  it('fails on a relative download base', () => {
    const result = runCli(['rewrite'], {
      RELEASE_APP: 'cast',
      METADATA_FILE: writeTempFile('latest-linux.yml', LINUX_METADATA),
      OUTPUT_FILE: '',
      DOWNLOAD_BASE_URL: 'releases/download/cast-v1.2.0',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('must be an absolute URL');
  });

  it('fails without a metadata file', () => {
    const result = runCli(['rewrite'], {
      RELEASE_APP: 'cast',
      METADATA_FILE: '',
      DOWNLOAD_BASE_URL: DOWNLOAD_BASE,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('METADATA_FILE');
  });

  it('fails for an unknown app', () => {
    const result = runCli(['rewrite'], {
      RELEASE_APP: 'studio',
      METADATA_FILE: writeTempFile('latest-linux.yml', LINUX_METADATA),
      DOWNLOAD_BASE_URL: DOWNLOAD_BASE,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown release app');
  });

  it('fails on an unknown command', () => {
    const result = runCli(['publish'], { RELEASE_APP: 'cast' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown command');
  });
});

describe('release-feed guard command', () => {
  it('reports the first feed publication', () => {
    const output = outputOf(runCli(['guard'], {
      RELEASE_APP: 'cast',
      INCOMING_VERSION: '1.2.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: path.join(os.tmpdir(), 'release-feed-absent'),
    }));

    expect(output).toEqual({
      should_update: 'true',
      reason: 'feed-empty',
      feed_tag: 'cast-feed',
      feed_version: '',
      incoming_version: '1.2.0',
    });
  });

  it('reports an already current feed', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-current-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), LINUX_METADATA);

    const output = outputOf(runCli(['guard'], {
      RELEASE_APP: 'cloud',
      INCOMING_VERSION: '1.2.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    }));

    expect(output).toEqual({
      should_update: 'false',
      reason: 'feed-already-current',
      feed_tag: 'cloud-feed',
      feed_version: '1.2.0',
      incoming_version: '1.2.0',
    });
  });

  it('repairs a Flux feed split across a base version and its revision', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-flux-split-'));
    fs.writeFileSync(
      path.join(directory, 'latest-linux.yml'),
      FLUX_LINUX_METADATA.replace('version: 0.11.0+1', 'version: 0.11.0'),
    );
    fs.writeFileSync(path.join(directory, 'latest-mac.yml'), FLUX_LINUX_METADATA);

    const output = outputOf(runCli(['guard'], {
      RELEASE_APP: 'flux',
      INCOMING_VERSION: '0.11.0+1',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    }));

    expect(output).toEqual({
      should_update: 'true',
      reason: 'feed-repair',
      feed_tag: 'flux-feed',
      feed_version: '0.11.0+1',
      incoming_version: '0.11.0+1',
    });
  });

  it('refuses to heal a split Flux feed with an older revision', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-flux-old-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), FLUX_LINUX_METADATA);
    fs.writeFileSync(path.join(directory, 'latest-mac.yml'), FLUX_NEWER_METADATA);

    const result = runCli(['guard'], {
      RELEASE_APP: 'flux',
      INCOMING_VERSION: '0.11.0+1',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to roll the feed back');
  });

  it('refuses a revisioned incoming version for a strict app', () => {
    const result = runCli(['guard'], {
      RELEASE_APP: 'cloud',
      INCOMING_VERSION: '0.11.0+1',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: path.join(os.tmpdir(), 'release-feed-absent'),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stable semantic version');
  });

  it('does not read the feed when the version release is unpublished', () => {
    const output = outputOf(runCli(['guard'], {
      RELEASE_APP: 'cast',
      INCOMING_VERSION: '1.2.0',
      RELEASE_PUBLISHED: 'false',
      FEED_METADATA_DIR: path.join(os.tmpdir(), 'release-feed-absent'),
    }));

    expect(output.reason).toBe('release-not-published');
    expect(output.should_update).toBe('false');
  });

  it('refuses a rollback from the metadata already in the feed', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-newer-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), LINUX_METADATA);

    const result = runCli(['guard'], {
      RELEASE_APP: 'cast',
      INCOMING_VERSION: '1.1.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to roll it back');
  });

  it('heals a split feed by republishing the known version', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-mixed-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), LINUX_METADATA);
    fs.writeFileSync(
      path.join(directory, 'latest.yml'),
      WINDOWS_METADATA.replace('version: 1.2.0', 'version: 1.1.0'),
    );

    const output = outputOf(runCli(['guard'], {
      RELEASE_APP: 'cast',
      INCOMING_VERSION: '1.2.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    }));

    expect(output).toEqual({
      should_update: 'true',
      reason: 'feed-repair',
      feed_tag: 'cast-feed',
      feed_version: '1.2.0',
      incoming_version: '1.2.0',
    });
  });

  it('advances a split feed to a higher version', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-mixed-ahead-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), LINUX_METADATA);
    fs.writeFileSync(
      path.join(directory, 'latest.yml'),
      WINDOWS_METADATA.replace('version: 1.2.0', 'version: 1.1.0'),
    );

    const output = outputOf(runCli(['guard'], {
      RELEASE_APP: 'cloud',
      INCOMING_VERSION: '1.3.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    }));

    expect(output.should_update).toBe('true');
    expect(output.reason).toBe('feed-version-increased');
    expect(output.feed_version).toBe('1.2.0');
  });

  it('refuses to heal a split feed with an older version', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-mixed-old-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), LINUX_METADATA);
    fs.writeFileSync(
      path.join(directory, 'latest.yml'),
      WINDOWS_METADATA.replace('version: 1.2.0', 'version: 1.1.0'),
    );

    const result = runCli(['guard'], {
      RELEASE_APP: 'cast',
      INCOMING_VERSION: '1.0.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('refusing to roll the feed back');
  });

  it('fails on a corrupt feed file instead of resetting the feed', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'release-feed-corrupt-'));
    fs.writeFileSync(path.join(directory, 'latest-linux.yml'), 'version: 1.2.0\nfiles: [\n');

    const result = runCli(['guard'], {
      RELEASE_APP: 'cast',
      INCOMING_VERSION: '1.2.0',
      RELEASE_PUBLISHED: 'true',
      FEED_METADATA_DIR: directory,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not valid YAML');
  });

  it('fails for an unknown app', () => {
    const result = runCli(['guard'], {
      RELEASE_APP: 'studio',
      INCOMING_VERSION: '1.2.0',
      RELEASE_PUBLISHED: 'true',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown release app');
  });
});
