/**
 * OBS-style "Horizontal, Top" multiview layout: a Preview/Program strip across
 * the top half, and a grid of scene thumbnails across the bottom half. All
 * geometry is computed deterministically with integer-snapped rects so the
 * same (width, height, sceneIds) always produces the same tiles.
 */

export interface MultiviewTile {
  kind: 'preview' | 'program' | 'scene';
  sceneId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MultiviewLayoutOptions {
  maxScenes?: 8 | 18 | 24;
}

const GUTTER_PX = 8;
const TARGET_ASPECT = 16 / 9;

interface Rect { x: number; y: number; width: number; height: number }

/** Splits `total` into `parts` contiguous, non-overlapping integer spans that sum to exactly `total`. */
function splitRange(total: number, parts: number): number[] {
  const boundaries: number[] = [];
  for (let index = 0; index <= parts; index += 1) boundaries.push(Math.round((total * index) / parts));
  return boundaries;
}

function gridDimensions(maxScenes: 8 | 18 | 24): { columns: number; rows: number } {
  if (maxScenes === 18) return { columns: 6, rows: 3 };
  if (maxScenes === 24) return { columns: 6, rows: 4 };
  return { columns: 4, rows: 2 };
}

/** Fits a 16:9 rect inside `slot`, inset by a small gutter on every side, centered in the remaining space. */
function letterbox(slot: Rect, gutter: number): Rect {
  const innerX = slot.x + gutter;
  const innerY = slot.y + gutter;
  const innerWidth = Math.max(0, slot.width - gutter * 2);
  const innerHeight = Math.max(0, slot.height - gutter * 2);
  if (innerWidth <= 0 || innerHeight <= 0) return { x: innerX, y: innerY, width: 0, height: 0 };

  let tileWidth: number;
  let tileHeight: number;
  if (innerWidth / innerHeight > TARGET_ASPECT) {
    tileHeight = innerHeight;
    tileWidth = Math.round(tileHeight * TARGET_ASPECT);
  } else {
    tileWidth = innerWidth;
    tileHeight = Math.round(tileWidth / TARGET_ASPECT);
  }
  const x = innerX + Math.round((innerWidth - tileWidth) / 2);
  const y = innerY + Math.round((innerHeight - tileHeight) / 2);
  return { x, y, width: tileWidth, height: tileHeight };
}

export function computeMultiviewLayout(
  width: number,
  height: number,
  sceneIds: readonly string[],
  options?: MultiviewLayoutOptions,
): MultiviewTile[] {
  const maxScenes = options?.maxScenes ?? 8;
  const totalWidth = Math.max(0, Math.round(width));
  const totalHeight = Math.max(0, Math.round(height));
  const tiles: MultiviewTile[] = [];

  const rowSplit = splitRange(totalHeight, 2);
  const topHeight = rowSplit[1] - rowSplit[0];
  const bottomY = rowSplit[1];
  const bottomHeight = totalHeight - bottomY;

  const topColumnSplit = splitRange(totalWidth, 2);
  const previewSlot: Rect = { x: topColumnSplit[0], y: 0, width: topColumnSplit[1] - topColumnSplit[0], height: topHeight };
  const programSlot: Rect = { x: topColumnSplit[1], y: 0, width: topColumnSplit[2] - topColumnSplit[1], height: topHeight };
  const previewTile = letterbox(previewSlot, GUTTER_PX);
  const programTile = letterbox(programSlot, GUTTER_PX);
  tiles.push({ kind: 'preview', x: previewTile.x, y: previewTile.y, width: previewTile.width, height: previewTile.height });
  tiles.push({ kind: 'program', x: programTile.x, y: programTile.y, width: programTile.width, height: programTile.height });

  const { columns, rows } = gridDimensions(maxScenes);
  const columnSplit = splitRange(totalWidth, columns);
  const rowSplitBottom = splitRange(bottomHeight, rows);
  const capacity = columns * rows;
  const shown = sceneIds.slice(0, Math.min(maxScenes, capacity));

  shown.forEach((sceneId, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const slot: Rect = {
      x: columnSplit[column],
      y: bottomY + rowSplitBottom[row],
      width: columnSplit[column + 1] - columnSplit[column],
      height: rowSplitBottom[row + 1] - rowSplitBottom[row],
    };
    const tile = letterbox(slot, GUTTER_PX);
    tiles.push({ kind: 'scene', sceneId, x: tile.x, y: tile.y, width: tile.width, height: tile.height });
  });

  return tiles;
}

export function hitTestMultiview(tiles: readonly MultiviewTile[], x: number, y: number): MultiviewTile | null {
  for (const tile of tiles) {
    if (x >= tile.x && x < tile.x + tile.width && y >= tile.y && y < tile.y + tile.height) return tile;
  }
  return null;
}
