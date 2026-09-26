// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { selectInstallArtifact } from '../../../../packages/suite/src/artifacts';
import { suiteApp } from '../../../../packages/suite/src/registry';
import type {
  AppRelease,
  GitHubReleaseAsset,
  HostArch,
  HostPlatform,
  SuiteAppDescriptor,
  UpdateMetadata,
} from '../../../../packages/suite/src/types';

const cast = suiteApp('cast');
const cloud = suiteApp('cloud');
const flux = suiteApp('flux');

function asset(name: string, size = 1000): GitHubReleaseAsset {
  return { name, browser_download_url: `https://dl.example/${name}`, size };
}

function releaseFor(app: SuiteAppDescriptor, version: string, assetNames: string[]): AppRelease {
  return {
    app: app.id,
    version,
    tag: `${app.releaseTagPrefix}${version}`,
    legacy: false,
    publishedAt: null,
    notesUrl: 'https://example.test/notes',
    assets: assetNames.map((name) => asset(name)),
  };
}

function metadataFor(
  version: string,
  fileNames: string[],
  sizeByName: Record<string, number> = {},
): UpdateMetadata {
  return {
    version,
    files: fileNames.map((name) => ({
      url: name,
      sha512: `${name.replace(/[^A-Za-z0-9]/g, '')}`.padEnd(86, 'A') + '==',
      size: sizeByName[name] ?? 1000,
    })),
    path: fileNames[0],
    sha512: `${fileNames[0].replace(/[^A-Za-z0-9]/g, '')}`.padEnd(86, 'A') + '==',
    releaseDate: null,
  };
}

describe('selectInstallArtifact — Cast legacy artifact names (single mac zip, generic others)', () => {
  const assetNames = [
    'LumaCast-0.1.27-arm64-mac.zip',
    'LumaCast-0.1.27-mac.dmg',
    'LumaCast-0.1.27-win.exe',
    'LumaCast-0.1.27-linux.AppImage',
    'LumaCast-0.1.27-linux.deb',
  ];
  const release = releaseFor(cast, '0.1.27', assetNames);
  const metadata = metadataFor('0.1.27', assetNames);

  function select(platform: HostPlatform, arch: HostArch) {
    return selectInstallArtifact({ app: cast, release, metadata, platform, arch });
  }

  it('picks the arch-specific mac zip on arm64', () => {
    const artifact = select('darwin', 'arm64');
    expect(artifact).toEqual({
      kind: 'mac-zip',
      name: 'LumaCast-0.1.27-arm64-mac.zip',
      url: 'https://dl.example/LumaCast-0.1.27-arm64-mac.zip',
      sha512: expect.any(String),
      size: 1000,
    });
  });

  it('falls back to the generic dmg on x64 (no x64 zip, and the only zip is arm64-specific)', () => {
    const artifact = select('darwin', 'x64');
    expect(artifact.kind).toBe('mac-dmg');
    expect(artifact.name).toBe('LumaCast-0.1.27-mac.dmg');
  });

  it('picks the generic win exe for both arches', () => {
    for (const arch of ['x64', 'arm64'] as const) {
      const artifact = select('win32', arch);
      expect(artifact.kind).toBe('win-nsis');
      expect(artifact.name).toBe('LumaCast-0.1.27-win.exe');
    }
  });

  it('picks the generic AppImage for both arches', () => {
    for (const arch of ['x64', 'arm64'] as const) {
      const artifact = select('linux', arch);
      expect(artifact.kind).toBe('linux-appimage');
      expect(artifact.name).toBe('LumaCast-0.1.27-linux.AppImage');
    }
  });

  it('falls back to deb when no AppImage is present', () => {
    const noAppImage = assetNames.filter((name) => !name.endsWith('.AppImage'));
    const debOnlyRelease = releaseFor(cast, '0.1.27', noAppImage);
    const debOnlyMetadata = metadataFor('0.1.27', noAppImage);
    const artifact = selectInstallArtifact({
      app: cast,
      release: debOnlyRelease,
      metadata: debOnlyMetadata,
      platform: 'linux',
      arch: 'x64',
    });
    expect(artifact.kind).toBe('linux-deb');
    expect(artifact.name).toBe('LumaCast-0.1.27-linux.deb');
  });
});

describe('selectInstallArtifact — Cloud/Flux arch-suffixed artifact names', () => {
  const assetNames = [
    'LumaCloud-0.1.0-arm64-mac.zip',
    'LumaCloud-0.1.0-x64-mac.zip',
    'LumaCloud-0.1.0-arm64-win.exe',
    'LumaCloud-0.1.0-x64-win.exe',
    'LumaCloud-0.1.0-arm64-linux.AppImage',
    'LumaCloud-0.1.0-x64-linux.AppImage',
    'LumaCloud-0.1.0-arm64-linux.deb',
    'LumaCloud-0.1.0-x64-linux.deb',
  ];
  const release = releaseFor(cloud, '0.1.0', assetNames);
  const metadata = metadataFor('0.1.0', assetNames);

  function select(platform: HostPlatform, arch: HostArch) {
    return selectInstallArtifact({ app: cloud, release, metadata, platform, arch });
  }

  it('picks the exact arch match for every platform/arch pair', () => {
    expect(select('darwin', 'arm64').name).toBe('LumaCloud-0.1.0-arm64-mac.zip');
    expect(select('darwin', 'x64').name).toBe('LumaCloud-0.1.0-x64-mac.zip');
    expect(select('win32', 'arm64').name).toBe('LumaCloud-0.1.0-arm64-win.exe');
    expect(select('win32', 'x64').name).toBe('LumaCloud-0.1.0-x64-win.exe');
    expect(select('linux', 'arm64').name).toBe('LumaCloud-0.1.0-arm64-linux.AppImage');
    expect(select('linux', 'x64').name).toBe('LumaCloud-0.1.0-x64-linux.AppImage');
  });

  it('never mixes up arch by substring (arm64 request does not fall back to the x64 asset)', () => {
    const artifact = select('win32', 'arm64');
    expect(artifact.name).not.toContain('x64');
  });

  it('example Flux revisioned version selects the arch-suffixed win exe', () => {
    const fluxAssetNames = ['Lumaflux-0.11.0+1-x64-win.exe', 'Lumaflux-0.11.0+1-arm64-win.exe'];
    const fluxRelease = releaseFor(flux, '0.11.0+1', fluxAssetNames);
    const fluxMetadata = metadataFor('0.11.0+1', fluxAssetNames);
    const artifact = selectInstallArtifact({
      app: flux,
      release: fluxRelease,
      metadata: fluxMetadata,
      platform: 'win32',
      arch: 'x64',
    });
    expect(artifact.name).toBe('Lumaflux-0.11.0+1-x64-win.exe');
    expect(artifact.kind).toBe('win-nsis');
  });
});

describe('selectInstallArtifact — errors and edge cases', () => {
  it('throws "No macOS installer" when nothing matches', () => {
    const assetNames = ['LumaCast-0.1.27-win.exe'];
    const release = releaseFor(cast, '0.1.27', assetNames);
    const metadata = metadataFor('0.1.27', assetNames);
    expect(() => selectInstallArtifact({ app: cast, release, metadata, platform: 'darwin', arch: 'arm64' })).toThrow(
      'No macOS installer for arm64',
    );
  });

  it('throws "No Windows installer" when nothing matches', () => {
    const assetNames = ['LumaCast-0.1.27-linux.AppImage'];
    const release = releaseFor(cast, '0.1.27', assetNames);
    const metadata = metadataFor('0.1.27', assetNames);
    expect(() => selectInstallArtifact({ app: cast, release, metadata, platform: 'win32', arch: 'x64' })).toThrow(
      'No Windows installer for x64',
    );
  });

  it('throws "No Linux installer" when nothing matches', () => {
    const assetNames = ['LumaCast-0.1.27-mac.dmg'];
    const release = releaseFor(cast, '0.1.27', assetNames);
    const metadata = metadataFor('0.1.27', assetNames);
    expect(() => selectInstallArtifact({ app: cast, release, metadata, platform: 'linux', arch: 'arm64' })).toThrow(
      'No Linux installer for arm64',
    );
  });

  it('never selects a .blockmap file even if metadata referenced one', () => {
    const assetNames = ['LumaCast-0.1.27-arm64-mac.zip', 'LumaCast-0.1.27-arm64-mac.zip.blockmap'];
    const release = releaseFor(cast, '0.1.27', assetNames);
    // Simulate a hypothetical metadata that (incorrectly) lists the blockmap
    // as an installable file: it must never be selected.
    const metadata: UpdateMetadata = {
      version: '0.1.27',
      files: [
        { url: 'LumaCast-0.1.27-arm64-mac.zip.blockmap', sha512: 'B'.repeat(86) + '==', size: 1000 },
        { url: 'LumaCast-0.1.27-arm64-mac.zip', sha512: 'A'.repeat(86) + '==', size: 1000 },
      ],
      path: 'LumaCast-0.1.27-arm64-mac.zip',
      sha512: 'A'.repeat(86) + '==',
      releaseDate: null,
    };
    const artifact = selectInstallArtifact({ app: cast, release, metadata, platform: 'darwin', arch: 'arm64' });
    expect(artifact.name).toBe('LumaCast-0.1.27-arm64-mac.zip');
    expect(artifact.name.endsWith('.blockmap')).toBe(false);
  });

  it('skips a metadata file entry that names an asset the release does not attach', () => {
    const assetNames = ['LumaCast-0.1.27-arm64-mac.zip'];
    const release = releaseFor(cast, '0.1.27', assetNames);
    const metadata = metadataFor('0.1.27', ['LumaCast-0.1.27-mac.dmg', 'LumaCast-0.1.27-arm64-mac.zip']);
    const artifact = selectInstallArtifact({ app: cast, release, metadata, platform: 'darwin', arch: 'arm64' });
    expect(artifact.name).toBe('LumaCast-0.1.27-arm64-mac.zip');
  });

  it('throws when metadata size disagrees with the asset size', () => {
    const assetNames = ['LumaCast-0.1.27-arm64-mac.zip'];
    const release = releaseFor(cast, '0.1.27', assetNames);
    const metadata = metadataFor('0.1.27', assetNames, { 'LumaCast-0.1.27-arm64-mac.zip': 999 });
    expect(() => selectInstallArtifact({ app: cast, release, metadata, platform: 'darwin', arch: 'arm64' })).toThrow(
      /size mismatch/,
    );
  });
});
