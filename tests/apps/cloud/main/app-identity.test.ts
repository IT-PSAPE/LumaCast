import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from '../../../../apps/cloud/main/app-identity';

describe('apps/cloud app identity', () => {
  it('pins the product name and bundle id', () => {
    expect(APP_IDENTITY.name).toBe('LumaCloud');
    expect(APP_IDENTITY.id).toBe('com.lumacast.cloud');
  });

  it('freezes the identity so it cannot be reassigned', () => {
    expect(Object.isFrozen(APP_IDENTITY)).toBe(true);
  });
});
