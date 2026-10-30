import { describe, expect, it, vi } from 'vitest';
import { commitSelectedReorder } from '@lumacast/selection';
import type { SelectedReorderCommit } from '@lumacast/selection';

function makeCommit(
  fromIndex: number,
  toIndex: number,
  previousIds: string[],
  orderedIds: string[],
  movedIds: string[],
): SelectedReorderCommit {
  return {
    fromIndex,
    toIndex,
    previousIds,
    orderedIds,
    movedIds,
  };
}

function makeReorder(initialIds: string[]) {
  const currentIds = initialIds.slice();
  const reorder = vi.fn(async (id: string, toIndex: number) => {
    const fromIndex = currentIds.indexOf(id);
    if (fromIndex < 0) return;
    currentIds.splice(fromIndex, 1);
    currentIds.splice(toIndex, 0, id);
  });
  return { currentIds, reorder };
}

describe('commitSelectedReorder', () => {
  it('persists a selected block moved right in reverse source order', async () => {
    const previousIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { currentIds, reorder } = makeReorder(previousIds);
    const orderedIds = ['a', 'c', 'e', 'f', 'b', 'd'];

    await commitSelectedReorder(makeCommit(1, 5, previousIds, orderedIds, ['b', 'd']), reorder);

    expect(currentIds).toEqual(orderedIds);
    expect(reorder.mock.calls.map(([id]) => id)).toEqual(['d', 'b']);
  });

  it('persists a selected block moved left in visible order', async () => {
    const previousIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { currentIds, reorder } = makeReorder(previousIds);
    const orderedIds = ['d', 'e', 'a', 'b', 'c', 'f'];

    await commitSelectedReorder(makeCommit(3, 0, previousIds, orderedIds, ['d', 'e']), reorder);

    expect(currentIds).toEqual(orderedIds);
    expect(reorder.mock.calls.map(([id]) => id)).toEqual(['d', 'e']);
  });

  it('handles discontiguous selected rows that move in both directions', async () => {
    const previousIds = ['0', '1', '2', '3', '4'];
    const { currentIds, reorder } = makeReorder(previousIds);
    const orderedIds = ['1', '0', '3', '4', '2'];

    await commitSelectedReorder(makeCommit(0, 1, previousIds, orderedIds, ['0', '3', '4']), reorder);

    expect(currentIds).toEqual(orderedIds);
    expect(reorder.mock.calls.map(([id]) => id)).toEqual(['3', '4', '0']);
  });

  it('handles mixed-direction selected rows when the active row moves left', async () => {
    const previousIds = ['0', '1', '2', '3', '4'];
    const { currentIds, reorder } = makeReorder(previousIds);
    const orderedIds = ['2', '0', '1', '4', '3'];

    await commitSelectedReorder(makeCommit(4, 3, previousIds, orderedIds, ['0', '1', '4']), reorder);

    expect(currentIds).toEqual(orderedIds);
    expect(reorder.mock.calls.map(([id]) => id)).toEqual(['4', '1', '0']);
  });
});
