// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseReleaseCatalog, parseUpdateMetadata, updateMetadataFileNameFor } from '../../../../packages/suite/src/catalog';
import { suiteApp } from '../../../../packages/suite/src/registry';
import { compareVersions } from '../../../../packages/suite/src/version';
import type { GitHubRelease, GitHubReleaseAsset } from '../../../../packages/suite/src/types';

const cast = suiteApp('cast');

function asset(name: string, size = 1000): GitHubReleaseAsset {
  return { name, browser_download_url: `https://github.com/IT-PSAPE/LumaCast/releases/download/x/${name}`, size };
}

function release(overrides: Partial<GitHubRelease> & { tag_name: string }): GitHubRelease {
  return {
    draft: false,
    prerelease: false,
    published_at: '2026-09-20T07:16:55.381Z',
    html_url: `https://github.com/IT-PSAPE/LumaCast/releases/tag/${overrides.tag_name}`,
    assets: [],
    ...overrides,
  };
}

function installableAssets(productName: string, version: string): GitHubReleaseAsset[] {
  return [
    asset(`${productName}-${version}-arm64-mac.zip`),
    asset(`${productName}-${version}-mac.dmg`),
    asset(`${productName}-${version}-win.exe`),
    asset(`${productName}-${version}-linux.AppImage`),
    asset(`${productName}-${version}-linux.deb`),
    asset('latest.yml'),
    asset('latest-mac.yml'),
    asset('latest-linux.yml'),
  ];
}

function fullCastAssets(version: string): GitHubReleaseAsset[] {
  return installableAssets('LumaCast', version);
}

describe('parseReleaseCatalog', () => {
  const releases: GitHubRelease[] = [
    // Legacy prerelease: excluded.
    release({ tag_name: 'v0.1.18-beta.1', prerelease: true, assets: fullCastAssets('0.1.18-beta.1') }),
    // Legacy stable release: installable.
    release({ tag_name: 'v0.1.26', assets: fullCastAssets('0.1.26') }),
    // Same version published both as a legacy tag and the per-app tag: the
    // per-app tag wins.
    release({ tag_name: 'v0.1.27', assets: fullCastAssets('0.1.27') }),
    release({ tag_name: 'cast-v0.1.27', assets: fullCastAssets('0.1.27') }),
    // The permanent feed tag: metadata only, never installable.
    release({ tag_name: 'cast-feed', assets: fullCastAssets('0.1.27') }),
    // A draft: excluded regardless of assets.
    release({ tag_name: 'cast-v0.1.28', draft: true, assets: fullCastAssets('0.1.28') }),
    // Zero assets: excluded.
    release({ tag_name: 'cast-v0.1.29', assets: [] }),
    // Assets but no latest*.yml: not installable, excluded.
    release({
      tag_name: 'cast-v0.1.30',
      assets: [asset('LumaCast-0.1.30-arm64-mac.zip'), asset('LumaCast-0.1.30-win.exe')],
    }),
    // Neither tag prefix: excluded.
    release({ tag_name: 'unrelated-tag', assets: fullCastAssets('9.9.9') }),
    // Fails parseVersion for the scheme (prerelease-shaped tag under the
    // per-app prefix): excluded.
    release({ tag_name: 'cast-v1.0.0-rc.1', assets: fullCastAssets('1.0.0-rc.1') }),
    // Newest installable release.
    release({ tag_name: 'cast-v0.2.0', assets: fullCastAssets('0.2.0') }),
  ];

  const catalog = parseReleaseCatalog(releases, cast);

  it('keeps only installable releases', () => {
    expect(catalog.map((entry) => entry.version)).toEqual(['0.2.0', '0.1.27', '0.1.26']);
  });

  it('orders newest first', () => {
    for (let index = 1; index < catalog.length; index += 1) {
      expect(compareVersions(catalog[index - 1].version, catalog[index].version, cast.versionScheme)).toBeGreaterThan(0);
    }
    expect(catalog[0].version).toBe('0.2.0');
    expect(catalog[catalog.length - 1].version).toBe('0.1.26');
  });

  it('prefers the per-app tag over a legacy tag for the same version', () => {
    const v0127 = catalog.find((entry) => entry.version === '0.1.27');
    expect(v0127?.tag).toBe('cast-v0.1.27');
    expect(v0127?.legacy).toBe(false);
  });

  it('marks a legacy-tag release as legacy', () => {
    const v0126 = catalog.find((entry) => entry.version === '0.1.26');
    expect(v0126?.legacy).toBe(true);
    expect(v0126?.tag).toBe('v0.1.26');
  });

  it('carries notesUrl, tag, and copied asset fields', () => {
    const entry = catalog[0];
    expect(entry.app).toBe('cast');
    expect(entry.tag).toBe('cast-v0.2.0');
    expect(entry.notesUrl).toBe('https://github.com/IT-PSAPE/LumaCast/releases/tag/cast-v0.2.0');
    expect(entry.assets.length).toBeGreaterThan(0);
    for (const a of entry.assets) {
      expect(Object.keys(a).sort()).toEqual(['browser_download_url', 'name', 'size'].sort());
    }
  });

  it('returns an empty catalog when nothing is installable', () => {
    expect(parseReleaseCatalog([], cast)).toEqual([]);
    expect(
      parseReleaseCatalog(
        [release({ tag_name: 'cast-feed', assets: fullCastAssets('0.1.0') })],
        cast,
      ),
    ).toEqual([]);
  });

  it('has no legacy tag prefix for flux, so a v-tagged release never matches', () => {
    const flux = suiteApp('flux');
    const fluxReleases: GitHubRelease[] = [
      release({ tag_name: 'v0.11.0', assets: installableAssets('Lumaflux', '0.11.0') }),
      release({ tag_name: 'flux-v0.11.0', assets: installableAssets('Lumaflux', '0.11.0') }),
    ];
    const fluxCatalog = parseReleaseCatalog(fluxReleases, flux);
    expect(fluxCatalog.map((entry) => entry.tag)).toEqual(['flux-v0.11.0']);
  });

  it('accepts a Flux build revision version', () => {
    const flux = suiteApp('flux');
    const fluxCatalog = parseReleaseCatalog(
      [release({ tag_name: 'flux-v0.11.0+1', assets: installableAssets('Lumaflux', '0.11.0+1') })],
      flux,
    );
    expect(fluxCatalog[0].version).toBe('0.11.0+1');
  });
});

describe('updateMetadataFileNameFor', () => {
  it('maps each host platform to its metadata file name', () => {
    expect(updateMetadataFileNameFor('darwin')).toBe('latest-mac.yml');
    expect(updateMetadataFileNameFor('linux')).toBe('latest-linux.yml');
    expect(updateMetadataFileNameFor('win32')).toBe('latest.yml');
  });
});

describe('parseUpdateMetadata', () => {
  const realExample = `version: 0.1.27
files:
  - url: LumaCast-0.1.27-arm64-mac.zip
    sha512: ${'i2DTYj'.padEnd(86, 'A')}==
    size: 133019240
  - url: LumaCast-0.1.27-mac.dmg
    sha512: ${'F45HsU'.padEnd(86, 'B')}==
    size: 139323893
path: LumaCast-0.1.27-arm64-mac.zip
sha512: ${'i2DTYj'.padEnd(86, 'A')}==
releaseDate: '2026-09-20T07:16:55.381Z'
`;

  it('parses the real electron-builder example', () => {
    const metadata = parseUpdateMetadata(realExample);
    expect(metadata.version).toBe('0.1.27');
    expect(metadata.files).toHaveLength(2);
    expect(metadata.files[0]).toEqual({
      url: 'LumaCast-0.1.27-arm64-mac.zip',
      sha512: `${'i2DTYj'.padEnd(86, 'A')}==`,
      size: 133019240,
    });
    expect(metadata.path).toBe('LumaCast-0.1.27-arm64-mac.zip');
    expect(metadata.sha512).toBe(`${'i2DTYj'.padEnd(86, 'A')}==`);
    expect(metadata.releaseDate).toBe('2026-09-20T07:16:55.381Z');
  });

  it('ignores blockMapSize and comments and blank lines', () => {
    const sha = `${'X'.repeat(86)}==`;
    const text = `# a comment
version: 0.11.0

files:
  - url: Lumaflux-0.11.0-x64-linux.AppImage
    sha512: ${sha}
    size: 55000000
    blockMapSize: 158986
  # another comment
path: Lumaflux-0.11.0-x64-linux.AppImage
sha512: ${sha}
`;
    const metadata = parseUpdateMetadata(text);
    expect(metadata.version).toBe('0.11.0');
    expect(metadata.files).toEqual([
      { url: 'Lumaflux-0.11.0-x64-linux.AppImage', sha512: sha, size: 55000000 },
    ]);
    expect(metadata.releaseDate).toBeNull();
  });

  it('parses a double-quoted releaseDate the same as single-quoted', () => {
    const sha = `${'Y'.repeat(86)}==`;
    const text = `version: 1.0.0
files:
  - url: LumaCast-1.0.0-win.exe
    sha512: ${sha}
    size: 42
path: LumaCast-1.0.0-win.exe
sha512: ${sha}
releaseDate: "2026-01-01T00:00:00.000Z"
`;
    expect(parseUpdateMetadata(text).releaseDate).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throws when version is missing', () => {
    const sha = `${'Z'.repeat(86)}==`;
    const text = `files:
  - url: a.zip
    sha512: ${sha}
    size: 1
path: a.zip
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(text)).toThrow(/missing "version"/);
  });

  it('throws when files is empty', () => {
    const sha = `${'Z'.repeat(86)}==`;
    const text = `version: 1.0.0
files:
path: a.zip
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(text)).toThrow(/"files" must contain at least one entry/);
  });

  it('throws when a file entry is missing url, sha512, or size', () => {
    const sha = `${'Z'.repeat(86)}==`;
    const missingUrl = `version: 1.0.0
files:
  - sha512: ${sha}
    size: 1
path: a.zip
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(missingUrl)).toThrow(/missing "url"/);

    const missingSha = `version: 1.0.0
files:
  - url: a.zip
    size: 1
path: a.zip
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(missingSha)).toThrow(/missing "sha512"/);

    const missingSize = `version: 1.0.0
files:
  - url: a.zip
    sha512: ${sha}
path: a.zip
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(missingSize)).toThrow(/missing "size"/);
  });

  it('throws when size is not numeric', () => {
    const sha = `${'Z'.repeat(86)}==`;
    const text = `version: 1.0.0
files:
  - url: a.zip
    sha512: ${sha}
    size: not-a-number
path: a.zip
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(text)).toThrow(/size is not numeric/);
  });

  it('throws when sha512 is not a 64-byte base64 hash', () => {
    const text = `version: 1.0.0
files:
  - url: a.zip
    sha512: too-short==
    size: 1
path: a.zip
sha512: too-short==
`;
    expect(() => parseUpdateMetadata(text)).toThrow(/not a base64-encoded SHA-512 hash/);
  });

  it('throws when path or top-level sha512 is missing', () => {
    const sha = `${'Z'.repeat(86)}==`;
    const missingPath = `version: 1.0.0
files:
  - url: a.zip
    sha512: ${sha}
    size: 1
sha512: ${sha}
`;
    expect(() => parseUpdateMetadata(missingPath)).toThrow(/missing "path"/);

    const missingSha512 = `version: 1.0.0
files:
  - url: a.zip
    sha512: ${sha}
    size: 1
path: a.zip
`;
    expect(() => parseUpdateMetadata(missingSha512)).toThrow(/missing "sha512"/);
  });
});
