// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fallbackSourceMoveSteps, reorderSourceSiblingsOnDrop } from '../../../../apps/stream/renderer/source-order';

// Storage order (back-to-front): ['a', 'b', 'c']. Display order (top-to-bottom,
// front-most first), as rendered by sources-dock.tsx, is the reverse: ['c', 'b', 'a'].
const storageIds = ['a', 'b', 'c'];

describe('reorderSourceSiblingsOnDrop', () => {
  it('moves the dragged row to the top of the display order', () => {
    // 'a' is last in display order (bottom); dropping at display index 0 puts
    // it first in display order, i.e. at the end of the storage array.
    expect(reorderSourceSiblingsOnDrop(storageIds, 'a', 0)).toEqual(['b', 'c', 'a']);
  });

  it('moves the dragged row to the bottom of the display order', () => {
    // 'c' is first in display order (top); dropping at display index 3 (length)
    // puts it last in display order, i.e. at the start of the storage array.
    expect(reorderSourceSiblingsOnDrop(storageIds, 'c', 3)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op dropping a row back into its own gap, on either side', () => {
    expect(reorderSourceSiblingsOnDrop(storageIds, 'b', 1)).toEqual(storageIds);
    expect(reorderSourceSiblingsOnDrop(storageIds, 'b', 2)).toEqual(storageIds);
  });

  it('clamps an out-of-range display drop index', () => {
    expect(reorderSourceSiblingsOnDrop(storageIds, 'a', -3)).toEqual(reorderSourceSiblingsOnDrop(storageIds, 'a', 0));
    expect(reorderSourceSiblingsOnDrop(storageIds, 'a', 999)).toEqual(reorderSourceSiblingsOnDrop(storageIds, 'a', 3));
  });

  it('is a no-op for an id that is not in the list', () => {
    expect(reorderSourceSiblingsOnDrop(storageIds, 'z', 0)).toEqual(storageIds);
  });
});

describe('fallbackSourceMoveSteps', () => {
  it('computes an upward (toward the end of storage) step count', () => {
    expect(fallbackSourceMoveSteps(['a', 'b', 'c'], ['b', 'c', 'a'], 'a')).toEqual({ direction: 1, steps: 2 });
  });

  it('computes a downward (toward the start of storage) step count', () => {
    expect(fallbackSourceMoveSteps(['a', 'b', 'c'], ['c', 'a', 'b'], 'c')).toEqual({ direction: -1, steps: 2 });
  });

  it('returns null when the position did not change', () => {
    expect(fallbackSourceMoveSteps(['a', 'b', 'c'], ['a', 'b', 'c'], 'b')).toBeNull();
  });

  it('returns null for an id missing from either list', () => {
    expect(fallbackSourceMoveSteps(['a', 'b', 'c'], ['b', 'c', 'a'], 'z')).toBeNull();
  });
});
