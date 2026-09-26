import { describe, expect, it } from 'vitest';
import { assertGranted, assertManaged, PermissionError } from '../../../../apps/cloud/main/suite/permissions';
import type { CloudSettings } from '../../../../apps/cloud/shared/desktop-api';

function settingsWith(grants: CloudSettings['grants']): CloudSettings {
  return { installScope: 'user', checkOnLaunch: true, grants };
}

describe('apps/cloud assertManaged', () => {
  it('throws for Cloud itself', () => {
    expect(() => assertManaged('cloud')).toThrow(PermissionError);
  });

  it('does not throw for a real suite app', () => {
    expect(() => assertManaged('cast')).not.toThrow();
    expect(() => assertManaged('flux')).not.toThrow();
  });
});

describe('apps/cloud assertGranted', () => {
  it('throws for Cloud itself even with a (nonsensical) grant present', () => {
    const settings = settingsWith([{ app: 'cloud', bundleId: 'com.lumacast.cloud', grantedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(() => assertGranted(settings, 'cloud')).toThrow(PermissionError);
  });

  it('throws when the app has no grant', () => {
    const settings = settingsWith([]);
    expect(() => assertGranted(settings, 'cast')).toThrow(PermissionError);
  });

  it('throws with a message naming the product, not the internal id', () => {
    const settings = settingsWith([]);
    try {
      assertGranted(settings, 'cast');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionError);
      expect((error as PermissionError).message).toBe('LumaCast is not authorised in LumaCloud');
      expect((error as PermissionError).app).toBe('cast');
    }
  });

  it('does not throw once the app is granted', () => {
    const settings = settingsWith([{ app: 'cast', bundleId: 'com.lumacast.app', grantedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(() => assertGranted(settings, 'cast')).not.toThrow();
  });

  it('a grant for one app does not authorise another', () => {
    const settings = settingsWith([{ app: 'flux', bundleId: 'app.lumaflux.desktop', grantedAt: '2026-01-01T00:00:00.000Z' }]);
    expect(() => assertGranted(settings, 'cast')).toThrow(PermissionError);
  });
});
