import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUITE_APPS } from '@lumacast/suite';
import {
  UPDATER_CACHE_DIR_NAMES,
  updaterCacheDir,
  userDataDirCandidates,
} from '../../../../../apps/cloud/main/platform/user-data-names';
import { CAST_APP as CAST, CLOUD_APP as CLOUD, FLUX_APP as FLUX } from './fixtures';

describe('apps/cloud platform user-data names', () => {
  // This used to hard-code the four names and only claim they matched the
  // ymls. Nothing checked it, so the map could drift — and did: stream and
  // soundboard shipped with no `updaterCacheDirName` at all. Read the files.
  it('names one updater cache directory per app, matching each electron-builder.yml', () => {
    const repoRoot = path.resolve(__dirname, '../../../../..');
    const fromYml = Object.fromEntries(
      SUITE_APPS.map((app) => {
        const yml = readFileSync(path.join(repoRoot, 'apps', app.id, 'electron-builder.yml'), 'utf8');
        const match = /^\s*updaterCacheDirName:\s*(\S+)\s*$/m.exec(yml);
        return [app.id, match?.[1]];
      }),
    );
    expect(UPDATER_CACHE_DIR_NAMES).toEqual(fromYml);
  });

  it('uses the product name as the user-data directory on every platform', () => {
    expect(userDataDirCandidates(CAST, 'darwin')).toEqual(['LumaCast']);
    expect(userDataDirCandidates(FLUX, 'win32')).toEqual(['Lumaflux']);
    expect(userDataDirCandidates(CLOUD, 'linux')).toEqual(['LumaCloud']);
  });

  it('resolves the updater cache where electron-updater keeps it', () => {
    expect(updaterCacheDir(CAST, 'darwin', { homeDir: '/Users/test' })).toEqual({
      root: '/Users/test/Library/Caches',
      dir: '/Users/test/Library/Caches/lumacast-updater',
    });
    expect(updaterCacheDir(FLUX, 'linux', { homeDir: '/home/test' })).toEqual({
      root: '/home/test/.cache',
      dir: '/home/test/.cache/lumaflux-updater',
    });
  });
});
