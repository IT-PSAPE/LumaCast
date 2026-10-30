// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { moveSceneBy, moveSceneTo, reorderOnDrop, reorderSelectionOnDrop } from '../../../../apps/stream/renderer/scene-order';

const ids = ['a', 'b', 'c', 'd'];

describe('moveSceneBy', () => {
  it('moves a scene up or down by one', () => {
    expect(moveSceneBy(ids, 'b', -1)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveSceneBy(ids, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('clamps at the top and bottom bounds instead of wrapping', () => {
    expect(moveSceneBy(ids, 'a', -1)).toEqual(ids);
    expect(moveSceneBy(ids, 'd', 1)).toEqual(ids);
  });

  it('is a no-op for an id that is not in the list', () => {
    expect(moveSceneBy(ids, 'z', -1)).toEqual(ids);
  });
});

describe('moveSceneTo', () => {
  it('moves a scene to an arbitrary index', () => {
    expect(moveSceneTo(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveSceneTo(ids, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('clamps an out-of-range index to the nearest end', () => {
    expect(moveSceneTo(ids, 'a', -5)).toEqual(ids);
    expect(moveSceneTo(ids, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('is a no-op when the target index matches the current position', () => {
    expect(moveSceneTo(ids, 'b', 1)).toEqual(ids);
  });

  it('is a no-op for an id that is not in the list', () => {
    expect(moveSceneTo(ids, 'z', 0)).toEqual(ids);
  });
});

describe('reorderOnDrop', () => {
  it('drops before the hovered row, shifting the dragged scene into place', () => {
    expect(reorderOnDrop(ids, 'a', 2)).toEqual(['b', 'a', 'c', 'd']);
    expect(reorderOnDrop(ids, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('drops at the end of the list when the target index equals the list length', () => {
    expect(reorderOnDrop(ids, 'a', 4)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('is a no-op dropping a row back into its own gap, on either side', () => {
    expect(reorderOnDrop(ids, 'b', 1)).toEqual(ids);
    expect(reorderOnDrop(ids, 'b', 2)).toEqual(ids);
  });

  it('clamps an out-of-range target index', () => {
    expect(reorderOnDrop(ids, 'a', -3)).toEqual(ids);
    expect(reorderOnDrop(ids, 'a', 999)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('is a no-op for an id that is not in the list', () => {
    expect(reorderOnDrop(ids, 'z', 2)).toEqual(ids);
  });
});

describe('reorderSelectionOnDrop', () => {
  it('moves a selected group as one stable block to the requested drop gap', () => {
    expect(reorderSelectionOnDrop(['a', 'b', 'c', 'd', 'e'], 'b', 5, new Set(['b', 'd'])))
      .toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('keeps the order unchanged when dropped within the selected block', () => {
    expect(reorderSelectionOnDrop(['a', 'b', 'c', 'd'], 'b', 2, new Set(['b', 'c'])))
      .toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves only the dragged row when it is outside the selected set', () => {
    expect(reorderSelectionOnDrop(['a', 'b', 'c', 'd'], 'a', 4, new Set(['b', 'c'])))
      .toEqual(['b', 'c', 'd', 'a']);
  });

  it('leaves the order unchanged when the dragged id is not present', () => {
    expect(reorderSelectionOnDrop(ids, 'missing', 2, new Set(['b', 'c']))).toEqual(ids);
  });
});
