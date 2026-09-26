import type { ClientRect } from '@dnd-kit/core';
import type { Transform } from '@dnd-kit/utilities';
import type { SortingStrategy } from '@dnd-kit/sortable';

const IDENTITY_TRANSFORM: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const gridStrideCache = new WeakMap<Array<ClientRect | undefined>, Map<number, { columnStride: number; rowStride: number }>>();

export interface VirtualizedGridStrategyOptions {
  columns: number;
}

export function createVirtualizedGridSortingStrategy({
  columns,
}: VirtualizedGridStrategyOptions): SortingStrategy {
  return ({ activeNodeRect, activeIndex, overIndex, index, rects }) => {
    if (columns < 1 || activeIndex < 0 || overIndex < 0) return null;

    const currentRect = rects[index];
    if (!currentRect || (!rects[activeIndex] && !activeNodeRect)) return null;

    const nextIndex = getNextIndex(index, activeIndex, overIndex);
    if (nextIndex === index) return IDENTITY_TRANSFORM;

    const gap = measureGridGap(rects, index, columns);
    const width = currentRect.width + gap.x;
    const height = currentRect.height + gap.y;
    const rowDelta = Math.floor(nextIndex / columns) - Math.floor(index / columns);
    const columnDelta = (nextIndex % columns) - (index % columns);

    return {
      x: columnDelta * width,
      y: rowDelta * height,
      scaleX: 1,
      scaleY: 1,
    };
  };
}

function getNextIndex(index: number, activeIndex: number, overIndex: number) {
  if (index === activeIndex) return overIndex;
  if (activeIndex < overIndex && index > activeIndex && index <= overIndex) return index - 1;
  if (activeIndex > overIndex && index < activeIndex && index >= overIndex) return index + 1;
  return index;
}

function measureGridGap(rects: Array<ClientRect | undefined>, index: number, columns: number) {
  const currentRect = rects[index];
  if (!currentRect) return { x: 0, y: 0 };
  const { columnStride, rowStride } = getCachedStrides(rects, columns);

  return {
    x: Math.max(0, columnStride - currentRect.width),
    y: Math.max(0, rowStride - currentRect.height),
  };
}

function getCachedStrides(rects: Array<ClientRect | undefined>, columns: number) {
  const perColumns = gridStrideCache.get(rects) ?? new Map<number, { columnStride: number; rowStride: number }>();
  if (!gridStrideCache.has(rects)) gridStrideCache.set(rects, perColumns);

  const cached = perColumns.get(columns);
  if (cached) return cached;

  const computed = {
    columnStride: findNearestStride(rects, columns, 'column'),
    rowStride: findNearestStride(rects, columns, 'row'),
  };
  perColumns.set(columns, computed);
  return computed;
}

function findNearestStride(
  rects: Array<ClientRect | undefined>,
  columns: number,
  axis: 'column' | 'row',
) {
  let nearestStride = Number.POSITIVE_INFINITY;

  for (let candidateIndex = 0; candidateIndex < rects.length; candidateIndex += 1) {
    const candidate = rects[candidateIndex];
    if (!candidate) continue;

    for (let comparisonIndex = candidateIndex + 1; comparisonIndex < rects.length; comparisonIndex += 1) {
      const comparison = rects[comparisonIndex];
      if (!comparison) continue;

      const candidateRow = Math.floor(candidateIndex / columns);
      const comparisonRow = Math.floor(comparisonIndex / columns);
      const candidateColumn = candidateIndex % columns;
      const comparisonColumn = comparisonIndex % columns;

      if (axis === 'column') {
        const columnDistance = Math.abs(candidateColumn - comparisonColumn);
        if (candidateRow !== comparisonRow || columnDistance === 0) continue;

        nearestStride = Math.min(
          nearestStride,
          Math.abs(candidate.left - comparison.left) / columnDistance,
        );
        continue;
      }

      const rowDistance = Math.abs(candidateRow - comparisonRow);
      if (candidateColumn !== comparisonColumn || rowDistance === 0) continue;

      nearestStride = Math.min(
        nearestStride,
        Math.abs(candidate.top - comparison.top) / rowDistance,
      );
    }
  }

  return Number.isFinite(nearestStride) ? nearestStride : 0;
}
