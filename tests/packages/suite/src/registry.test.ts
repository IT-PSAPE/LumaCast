// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isManagedIdentity,
  isSuiteAppId,
  LEGACY_MANAGED_IDENTITIES,
  suiteApp,
  SUITE_APP_IDS,
  SUITE_APPS,
  SUITE_ORGANIZATION,
} from '../../../../packages/suite/src/registry';

describe('SUITE_ORGANIZATION', () => {
  it('is the com.lumacast prefix', () => {
    expect(SUITE_ORGANIZATION).toBe('com.lumacast');
  });
});

describe('LEGACY_MANAGED_IDENTITIES', () => {
  it('carries Flux pre-monorepo bundle id and nothing else', () => {
    expect(LEGACY_MANAGED_IDENTITIES.has('app.lumaflux.desktop')).toBe(true);
    expect(LEGACY_MANAGED_IDENTITIES.size).toBe(1);
  });
});

describe('SUITE_APPS', () => {
  it('lists cast, flux, cloud in that order', () => {
    expect(SUITE_APPS.map((app) => app.id)).toEqual(['cast', 'flux', 'chord', 'cloud']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(SUITE_APPS)).toBe(true);
  });

  it('every bundle id is a managed identity', () => {
    for (const app of SUITE_APPS) {
      expect(isManagedIdentity(app.bundleId)).toBe(true);
    }
  });

  it('bundle ids are unique', () => {
    const bundleIds = SUITE_APPS.map((app) => app.bundleId);
    expect(new Set(bundleIds).size).toBe(bundleIds.length);
  });

  it('product names are unique', () => {
    const productNames = SUITE_APPS.map((app) => app.productName);
    expect(new Set(productNames).size).toBe(productNames.length);
  });

  it('release tag prefixes are unique and distinct from the feed tags', () => {
    const prefixes = SUITE_APPS.map((app) => app.releaseTagPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const app of SUITE_APPS) {
      expect(app.feedTag.startsWith(app.releaseTagPrefix)).toBe(false);
    }
  });

  it('describes cast exactly', () => {
    const cast = suiteApp('cast');
    expect(cast).toMatchObject({
      id: 'cast',
      productName: 'LumaCast',
      bundleId: 'com.lumacast.app',
      summary: 'Presentation and NDI output',
      versionScheme: 'semver',
      releaseTagPrefix: 'cast-v',
      legacyTagPrefix: 'v',
      feedTag: 'cast-feed',
      mac: { bundleName: 'LumaCast.app' },
      win: { executableName: 'LumaCast.exe', displayName: 'LumaCast' },
      linux: { executableName: 'lumacast', debPackageName: 'lumacast' },
    });
  });

  it('describes flux exactly', () => {
    const flux = suiteApp('flux');
    expect(flux).toMatchObject({
      id: 'flux',
      productName: 'Lumaflux',
      bundleId: 'app.lumaflux.desktop',
      summary: 'Photo editing with agent automation',
      versionScheme: 'semver-revision',
      releaseTagPrefix: 'flux-v',
      legacyTagPrefix: null,
      feedTag: 'flux-feed',
      mac: { bundleName: 'Lumaflux.app' },
      win: { executableName: 'Lumaflux.exe', displayName: 'Lumaflux' },
      linux: { executableName: 'lumaflux', debPackageName: 'lumaflux' },
    });
  });

  it('describes cloud exactly', () => {
    const cloud = suiteApp('cloud');
    expect(cloud).toMatchObject({
      id: 'cloud',
      productName: 'LumaCloud',
      bundleId: 'com.lumacast.cloud',
      summary: 'Installs and updates the suite',
      versionScheme: 'semver',
      releaseTagPrefix: 'cloud-v',
      legacyTagPrefix: null,
      feedTag: 'cloud-feed',
      mac: { bundleName: 'LumaCloud.app' },
      win: { executableName: 'LumaCloud.exe', displayName: 'LumaCloud' },
      linux: { executableName: 'lumacloud', debPackageName: 'lumacloud' },
    });
  });
});

describe('SUITE_APP_IDS', () => {
  it('matches SUITE_APPS order', () => {
    expect(SUITE_APP_IDS).toEqual(SUITE_APPS.map((app) => app.id));
  });
});

describe('suiteApp', () => {
  it('throws on an unknown id', () => {
    expect(() => suiteApp('bogus' as never)).toThrow(/Unknown suite app/);
  });
});

describe('isSuiteAppId', () => {
  it('accepts every known id', () => {
    for (const id of SUITE_APP_IDS) {
      expect(isSuiteAppId(id)).toBe(true);
    }
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isSuiteAppId('bogus')).toBe(false);
    expect(isSuiteAppId('')).toBe(false);
    expect(isSuiteAppId(undefined)).toBe(false);
    expect(isSuiteAppId(null)).toBe(false);
    expect(isSuiteAppId(42)).toBe(false);
    expect(isSuiteAppId({})).toBe(false);
  });
});

describe('isManagedIdentity', () => {
  it('accepts com.lumacast.<segment>', () => {
    expect(isManagedIdentity('com.lumacast.app')).toBe(true);
    expect(isManagedIdentity('com.lumacast.cloud')).toBe(true);
    expect(isManagedIdentity('com.lumacast.anything.nested')).toBe(true);
  });

  it('accepts the legacy Flux identity', () => {
    expect(isManagedIdentity('app.lumaflux.desktop')).toBe(true);
  });

  it('rejects the bare organization id', () => {
    expect(isManagedIdentity('com.lumacast')).toBe(false);
  });

  it('rejects a lookalike organization prefix', () => {
    expect(isManagedIdentity('com.lumacastX.foo')).toBe(false);
    expect(isManagedIdentity('com.lumacasts.foo')).toBe(false);
  });

  it('rejects unrelated bundle ids', () => {
    expect(isManagedIdentity('com.apple.finder')).toBe(false);
    expect(isManagedIdentity('')).toBe(false);
  });
});
