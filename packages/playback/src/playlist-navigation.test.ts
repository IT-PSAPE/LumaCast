import { describe, expect, it } from 'vitest';
import { resolveAdjacentAssetAllowingUnset, resolveAdjacentAssetRequiringCurrent } from './playlist-navigation';

interface FakeAsset {
  id: string;
  name: string;
}

const assets: FakeAsset[] = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Bravo' },
  { id: 'c', name: 'Charlie' },
];

describe('resolveAdjacentAssetRequiringCurrent', () => {
  it('advances to the next asset, wrapping around the end', () => {
    expect(resolveAdjacentAssetRequiringCurrent(assets, 'a', 1)).toEqual(assets[1]);
    expect(resolveAdjacentAssetRequiringCurrent(assets, 'c', 1)).toEqual(assets[0]);
  });

  it('steps back to the previous asset, wrapping around the start', () => {
    expect(resolveAdjacentAssetRequiringCurrent(assets, 'b', -1)).toEqual(assets[0]);
    expect(resolveAdjacentAssetRequiringCurrent(assets, 'a', -1)).toEqual(assets[2]);
  });

  it('is a no-op when nothing is currently selected', () => {
    expect(resolveAdjacentAssetRequiringCurrent(assets, null, 1)).toBeNull();
  });

  it('is a no-op when the current id is not in the list or the list is empty', () => {
    expect(resolveAdjacentAssetRequiringCurrent(assets, 'missing', 1)).toBeNull();
    expect(resolveAdjacentAssetRequiringCurrent([], 'a', 1)).toBeNull();
  });
});

describe('resolveAdjacentAssetAllowingUnset', () => {
  it('advances to the next asset, wrapping around the end', () => {
    expect(resolveAdjacentAssetAllowingUnset(assets, 'a', 1)).toEqual(assets[1]);
    expect(resolveAdjacentAssetAllowingUnset(assets, 'c', 1)).toEqual(assets[0]);
  });

  it('steps back to the previous asset, wrapping around the start', () => {
    expect(resolveAdjacentAssetAllowingUnset(assets, 'b', -1)).toEqual(assets[0]);
  });

  it('starts from the first asset when moving forward with nothing selected', () => {
    expect(resolveAdjacentAssetAllowingUnset(assets, null, 1)).toEqual(assets[0]);
  });

  it('starts from the last asset when moving backward with nothing selected', () => {
    expect(resolveAdjacentAssetAllowingUnset(assets, null, -1)).toEqual(assets[2]);
  });

  it('returns null when the list is empty', () => {
    expect(resolveAdjacentAssetAllowingUnset([], null, 1)).toBeNull();
  });
});
