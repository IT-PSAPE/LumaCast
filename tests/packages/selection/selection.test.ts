import { describe, expect, it, vi } from 'vitest';
import { filterSelectionIds, moveSelectedIds, moveSelectionToGap, resolveActionIds, resolveSelection, runSelectionActions, toggleSelectionId } from '@lumacast/selection';

describe('ordered selection helpers', () => {
  it('filters by allowed IDs and lets callers keep a newly selected primary ID first', () => {
    expect(filterSelectionIds(['a', 'stale', 'b'], new Set(['a', 'b']))).toEqual(['a', 'b']);
    expect(toggleSelectionId(['a', 'b'], 'c', 'front')).toEqual(['c', 'a', 'b']);
    expect(toggleSelectionId(['a', 'b'], 'a', 'front')).toEqual(['b']);
  });
});

describe('resolveSelection', () => {
  it('replaces plain selection, toggles modifiers, and preserves a shift anchor', () => {
    const plain = resolveSelection(['a', 'b', 'c', 'd'], ['a', 'c'], 'a', 'b');
    expect(plain).toEqual({ selectedIds: ['b'], anchorId: 'b' });

    const range = resolveSelection(['a', 'b', 'c', 'd'], ['b'], 'b', 'd', { shiftKey: true });
    expect(range).toEqual({ selectedIds: ['b', 'c', 'd'], anchorId: 'b' });

    const additiveRange = resolveSelection(['a', 'b', 'c', 'd'], ['a'], 'b', 'd', { shiftKey: true, ctrlKey: true });
    expect(additiveRange).toEqual({ selectedIds: ['a', 'b', 'c', 'd'], anchorId: 'b' });

    const toggled = resolveSelection(['a', 'b', 'c', 'd'], ['a', 'c'], 'a', 'c', { metaKey: true });
    expect(toggled).toEqual({ selectedIds: ['a'], anchorId: 'c' });
  });

  it('prunes stale IDs in visible order and repairs a missing range anchor', () => {
    expect(resolveSelection(['c', 'a', 'd'], ['d', 'missing', 'c'], 'missing', 'a', { shiftKey: true }))
      .toEqual({ selectedIds: ['a'], anchorId: 'a' });
    expect(resolveSelection(['c', 'a', 'd'], ['d', 'missing', 'c'], 'd', 'missing'))
      .toEqual({ selectedIds: ['c', 'd'], anchorId: 'd' });
  });

  it('preserves hidden selected IDs while resolving visible ranges and action targets', () => {
    expect(resolveSelection(
      ['a', 'c', 'd'], ['hidden', 'a'], 'a', 'd', { shiftKey: true, ctrlKey: true }, ['a', 'b', 'c', 'd', 'hidden'],
    )).toEqual({ selectedIds: ['a', 'c', 'd', 'hidden'], anchorId: 'a' });
    expect(resolveActionIds(['a', 'c', 'd'], ['hidden', 'd', 'a'], 'a', ['a', 'b', 'c', 'd', 'hidden']))
      .toEqual(['a', 'd', 'hidden']);
    expect(resolveActionIds(['a', 'c', 'd'], ['hidden', 'a'], 'c', ['a', 'b', 'c', 'd', 'hidden']))
      .toEqual(['c']);
  });
});

describe('moveSelectedIds', () => {
  it('moves blocks into list gaps and leaves a drop at their existing gap unchanged', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(moveSelectionToGap(ids, new Set(['b', 'c']), 3)).toBe(ids);
    expect(moveSelectionToGap(ids, new Set(['b', 'c']), 4)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveSelectionToGap(ids, new Set(['b', 'c']), 0)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveSelectionToGap(ids, new Set(['a', 'c']), 3)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('moves discontiguous members as a stable block in either direction', () => {
    expect(moveSelectedIds(['0', '1', '2', '3', '4'], '0', 1, new Set(['0', '3', '4'])))
      .toEqual(['1', '0', '3', '4', '2']);
    expect(moveSelectedIds(['0', '1', '2', '3', '4'], '4', 3, new Set(['0', '1', '4'])))
      .toEqual(['2', '0', '1', '4', '3']);
  });
});

describe('runSelectionActions', () => {
  it('runs in visible order and stops after the first failure', async () => {
    const failure = new Error('failed');
    const action = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined);

    await expect(runSelectionActions(['a', 'b', 'c'], action)).resolves.toEqual({
      ok: false,
      failedId: 'b',
      remainingIds: ['b', 'c'],
      error: failure,
    });

    expect(action.mock.calls).toEqual([['a'], ['b']]);
  });
});
