import { describe, expect, it } from 'vitest';
import {
  UPDATER_CACHE_DIR_NAMES,
  updaterCacheDir,
  userDataDirCandidates,
} from '../../../../../apps/cloud/main/platform/user-data-names';
import { CAST_APP as CAST, CLOUD_APP as CLOUD, FLUX_APP as FLUX } from './fixtures';

describe('apps/cloud platform user-data names', () => {
  it('names one updater cache directory per app, matching each electron-builder.yml', () => {
    expect(UPDATER_CACHE_DIR_NAMES).toEqual({
      cast: 'lumacast-updater',
      flux: 'lumaflux-updater',
      chord: 'lumachord-updater',
      cloud: 'lumacloud-updater',
    });
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
