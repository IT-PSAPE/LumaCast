import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from '../../../../apps/flux/main/app-identity';

describe('apps/flux app identity', () => {
  it('pins the product name and bundle id', () => {
    expect(APP_IDENTITY.name).toBe('Lumaflux');
    expect(APP_IDENTITY.id).toBe('app.lumaflux.desktop');
  });

  it('freezes the identity so it cannot be reassigned', () => {
    expect(Object.isFrozen(APP_IDENTITY)).toBe(true);
  });

  it('claims a different bundle id than the other apps, so installs never collide', () => {
    expect(APP_IDENTITY.id).not.toBe('com.lumacast.app');
    expect(APP_IDENTITY.id).not.toBe('com.lumacast.cloud');
  });
});
