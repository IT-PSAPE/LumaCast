import { describe, expect, it } from 'vitest';
import { computeMultiviewLayout, hitTestMultiview, type MultiviewTile } from '../../../../apps/stream/renderer/multiview-layout';

const WIDTH = 1280;
const HEIGHT = 720;

function sceneIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `scene-${index}`);
}

function expectWithinBounds(tile: MultiviewTile, width = WIDTH, height = HEIGHT) {
  expect(tile.x).toBeGreaterThanOrEqual(0);
  expect(tile.y).toBeGreaterThanOrEqual(0);
  expect(tile.x + tile.width).toBeLessThanOrEqual(width);
  expect(tile.y + tile.height).toBeLessThanOrEqual(height);
}

function expectNoOverlap(tiles: MultiviewTile[]) {
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) {
      const a = tiles[i];
      const b = tiles[j];
      const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlapsX && overlapsY).toBe(false);
    }
  }
}

function expect16x9(tile: MultiviewTile) {
  expect(tile.width).toBeGreaterThan(0);
  expect(tile.height).toBeGreaterThan(0);
  const ratio = tile.width / tile.height;
  expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.05);
}

describe('computeMultiviewLayout', () => {
  it('lays out a Preview/Program strip plus the scene grid for 2 scenes', () => {
    const ids = sceneIds(2);
    const tiles = computeMultiviewLayout(WIDTH, HEIGHT, ids);

    expect(tiles).toHaveLength(4);
    expect(tiles[0].kind).toBe('preview');
    expect(tiles[1].kind).toBe('program');
    expect(tiles.slice(2).map((tile) => tile.kind)).toEqual(['scene', 'scene']);
    expect(tiles.slice(2).map((tile) => tile.sceneId)).toEqual(ids);
    tiles.forEach((tile) => expectWithinBounds(tile));
    tiles.forEach(expect16x9);
    expectNoOverlap(tiles);

    // Preview sits left of Program in the top half.
    expect(tiles[0].x).toBeLessThan(tiles[1].x);
    expect(tiles[0].y).toBe(tiles[1].y);
    // The top strip sits above the scene grid.
    expect(tiles[0].y + tiles[0].height).toBeLessThanOrEqual(tiles[2].y);
  });

  it('fills a 4x2 grid for 8 scenes and drops extras beyond capacity', () => {
    const ids = sceneIds(8);
    const tiles = computeMultiviewLayout(WIDTH, HEIGHT, ids);
    const sceneTiles = tiles.filter((tile) => tile.kind === 'scene');

    expect(tiles).toHaveLength(10);
    expect(sceneTiles).toHaveLength(8);
    expect(sceneTiles.map((tile) => tile.sceneId)).toEqual(ids);
    tiles.forEach((tile) => expectWithinBounds(tile));
    tiles.forEach(expect16x9);
    expectNoOverlap(tiles);

    // Row 2 (index 4) starts a new row directly below column 0 of row 1.
    expect(sceneTiles[4].x).toBe(sceneTiles[0].x);
    expect(sceneTiles[4].y).toBeGreaterThan(sceneTiles[0].y);

    const overflow = computeMultiviewLayout(WIDTH, HEIGHT, sceneIds(12));
    expect(overflow.filter((tile) => tile.kind === 'scene')).toHaveLength(8);
  });

  it('switches to a 6x3 grid for 18 scenes', () => {
    const ids = sceneIds(18);
    const tiles = computeMultiviewLayout(WIDTH, HEIGHT, ids, { maxScenes: 18 });
    const sceneTiles = tiles.filter((tile) => tile.kind === 'scene');

    expect(sceneTiles).toHaveLength(18);
    tiles.forEach((tile) => expectWithinBounds(tile));
    tiles.forEach(expect16x9);
    expectNoOverlap(tiles);

    // 6 columns: tile index 6 starts row 2, directly below tile index 0.
    expect(sceneTiles[6].x).toBe(sceneTiles[0].x);
    expect(sceneTiles[6].y).toBeGreaterThan(sceneTiles[0].y);
  });

  it('switches to a 6x4 grid for 24 scenes', () => {
    const ids = sceneIds(24);
    const tiles = computeMultiviewLayout(WIDTH, HEIGHT, ids, { maxScenes: 24 });
    const sceneTiles = tiles.filter((tile) => tile.kind === 'scene');

    expect(sceneTiles).toHaveLength(24);
    tiles.forEach((tile) => expectWithinBounds(tile));
    tiles.forEach(expect16x9);
    expectNoOverlap(tiles);
  });

  it('is deterministic for identical inputs', () => {
    const a = computeMultiviewLayout(WIDTH, HEIGHT, sceneIds(5));
    const b = computeMultiviewLayout(WIDTH, HEIGHT, sceneIds(5));
    expect(a).toEqual(b);
  });

  it('always returns integer-rounded rects, even for odd dimensions', () => {
    const tiles = computeMultiviewLayout(1281, 721, sceneIds(3));
    for (const tile of tiles) {
      for (const value of [tile.x, tile.y, tile.width, tile.height]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
    tiles.forEach((tile) => expectWithinBounds(tile, 1281, 721));
  });

  it('handles no scenes by returning only the Preview and Program tiles', () => {
    const tiles = computeMultiviewLayout(WIDTH, HEIGHT, []);
    expect(tiles).toHaveLength(2);
    expect(tiles.map((tile) => tile.kind)).toEqual(['preview', 'program']);
  });
});

describe('hitTestMultiview', () => {
  const tiles = computeMultiviewLayout(WIDTH, HEIGHT, sceneIds(2));

  it('finds the preview tile at its center', () => {
    const preview = tiles[0];
    const x = preview.x + Math.floor(preview.width / 2);
    const y = preview.y + Math.floor(preview.height / 2);
    expect(hitTestMultiview(tiles, x, y)).toBe(preview);
  });

  it('finds a scene tile at its center', () => {
    const scene = tiles[2];
    const x = scene.x + Math.floor(scene.width / 2);
    const y = scene.y + Math.floor(scene.height / 2);
    expect(hitTestMultiview(tiles, x, y)).toBe(scene);
  });

  it('returns null in the gutter between Preview and Program', () => {
    const preview = tiles[0];
    const program = tiles[1];
    const gutterX = Math.floor((preview.x + preview.width + program.x) / 2);
    const y = preview.y + Math.floor(preview.height / 2);
    expect(hitTestMultiview(tiles, gutterX, y)).toBeNull();
  });

  it('returns null outside every tile', () => {
    expect(hitTestMultiview(tiles, -5, -5)).toBeNull();
    expect(hitTestMultiview(tiles, WIDTH + 100, HEIGHT + 100)).toBeNull();
  });
});
