import { describe, expect, it } from 'vitest';
import { assetCacheKey } from '../../../../apps/flux/main/asset-cache-key';

describe('asset cache key', () => {
  it('changes when the source file changes without a recipe revision change', () => {
    const photo = { id: 'photo-1', revision: 4, path: 'C:\\photos\\one.jpg' };
    const before = { size: 1000, mtimeMs: 10, ctimeMs: 11 };

    expect(assetCacheKey(photo, before)).not.toBe(
      assetCacheKey(photo, { ...before, size: 1001 }),
    );
    expect(assetCacheKey(photo, before)).not.toBe(
      assetCacheKey(photo, { ...before, mtimeMs: 12 }),
    );
    expect(assetCacheKey(photo, before)).not.toBe(
      assetCacheKey(photo, { ...before, ctimeMs: 13 }),
    );
  });
});
