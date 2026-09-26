import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from '../../../../apps/chord/main/app-identity';

describe('apps/chord app identity', () => {
  it('pins the product name and bundle id', () => {
    expect(APP_IDENTITY.name).toBe('LumaChord');
    expect(APP_IDENTITY.id).toBe('com.lumacast.chord');
  });

  it('freezes the identity so it cannot be reassigned', () => {
    expect(Object.isFrozen(APP_IDENTITY)).toBe(true);
  });
});
