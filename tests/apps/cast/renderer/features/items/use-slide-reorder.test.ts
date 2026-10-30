import { describe, expect, it, vi } from 'vitest';
import { moveSlideIdsAsBlock, persistSlideReorder } from '../../../../../../apps/cast/renderer/features/items/use-slide-reorder';

describe('slide reorder helpers', () => {
  it('moves a discontiguous group one slot as a block while preserving member order', () => {
    expect(moveSlideIdsAsBlock(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 'up'))
      .toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(moveSlideIdsAsBlock(['a', 'b', 'c', 'd', 'e'], ['b', 'd'], 'down'))
      .toEqual(['a', 'c', 'b', 'd', 'e']);
  });

  it('persists moved slides in reverse target order when moving down and restores the current slide index', async () => {
    const reorderSlide = vi.fn().mockResolvedValue(undefined);
    const setCurrentSlideIndex = vi.fn();

    await persistSlideReorder(
      { orderedIds: ['a', 'd', 'b', 'c'], movedIds: ['b', 'c'] },
      ['a', 'b', 'c', 'd'],
      reorderSlide,
      'd',
      setCurrentSlideIndex,
    );

    expect(reorderSlide.mock.calls).toEqual([['c', 3], ['b', 2]]);
    expect(setCurrentSlideIndex).toHaveBeenCalledWith(1);
  });

  it('handles a selected block whose members shift in mixed directions', async () => {
    const reorderSlide = vi.fn().mockResolvedValue(undefined);

    await persistSlideReorder(
      {
        orderedIds: ['b', 'a', 'd', 'e', 'c'],
        movedIds: ['a', 'd', 'e'],
        previousIds: ['a', 'b', 'c', 'd', 'e'],
      },
      ['stale-source-order'],
      reorderSlide,
      null,
      vi.fn(),
    );

    expect(reorderSlide.mock.calls).toEqual([['d', 2], ['e', 3], ['a', 1]]);
  });

  it('omits moved members that remain at the same index', async () => {
    const reorderSlide = vi.fn().mockResolvedValue(undefined);

    await persistSlideReorder(
      { orderedIds: ['a', 'c', 'b', 'd'], movedIds: ['b', 'd'] },
      ['a', 'b', 'c', 'd'],
      reorderSlide,
      null,
      vi.fn(),
    );

    expect(reorderSlide.mock.calls).toEqual([['b', 2]]);
  });
});
