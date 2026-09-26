import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from '../../../../apps/flux/main/app-identity';

describe('apps/flux app identity', () => {
  it('pins the product name and bundle id', () => {
    expect(APP_IDENTITY.name).toBe('LumaFlux');
    expect(APP_IDENTITY.id).toBe('com.lumacast.flux');
  });

  it('freezes the identity so it cannot be reassigned', () => {
    expect(Object.isFrozen(APP_IDENTITY)).toBe(true);
  });
});
