import { describe, expect, it } from 'vitest';
import { createVirtualizedGridSortingStrategy } from './virtualized-grid-sorting-strategy';

function rect(left: number, top: number, width = 100, height = 80): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function countingRect(
  left: number,
  top: number,
  counters: { left: number; top: number },
  width = 100,
  height = 80,
): DOMRect {
  return {
    x: left,
    y: top,
    get left() {
      counters.left += 1;
      return left;
    },
    get top() {
      counters.top += 1;
      return top;
    },
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('createVirtualizedGridSortingStrategy', () => {
  it('shifts mounted siblings by logical grid positions even when the drop target is offscreen', () => {
    const strategy = createVirtualizedGridSortingStrategy({ columns: 3 });
    const rects = [
      rect(0, 0),
      rect(110, 0),
      rect(220, 0),
      rect(0, 92),
      rect(110, 92),
      undefined,
    ] as unknown as DOMRect[];

    expect(strategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      overIndex: 5,
      index: 1,
      rects,
    })).toEqual({ x: -110, y: 0, scaleX: 1, scaleY: 1 });

    expect(strategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      overIndex: 5,
      index: 3,
      rects,
    })).toEqual({ x: 220, y: -92, scaleX: 1, scaleY: 1 });
  });

  it('shifts mounted siblings back into place when dragging upward toward an offscreen target', () => {
    const strategy = createVirtualizedGridSortingStrategy({ columns: 3 });
    const rects = [
      undefined,
      rect(110, 0),
      rect(220, 0),
      rect(0, 92),
      rect(110, 92),
      rect(220, 92),
    ] as unknown as DOMRect[];

    expect(strategy({
      activeNodeRect: rect(220, 92),
      activeIndex: 5,
      overIndex: 1,
      index: 3,
      rects,
    })).toEqual({ x: 110, y: 0, scaleX: 1, scaleY: 1 });
  });

  it('derives the horizontal stride from sparse multi-column measurements instead of the first wide gap', () => {
    const strategy = createVirtualizedGridSortingStrategy({ columns: 3 });
    const rects = [
      rect(0, 0),
      undefined,
      rect(220, 0),
      rect(0, 92),
      undefined,
      rect(220, 92),
    ] as unknown as DOMRect[];

    expect(strategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      overIndex: 5,
      index: 3,
      rects,
    })).toEqual({ x: 220, y: -92, scaleX: 1, scaleY: 1 });
  });

  it('derives the vertical stride from sparse multi-row measurements instead of the first tall gap', () => {
    const strategy = createVirtualizedGridSortingStrategy({ columns: 3 });
    const rects = [
      rect(0, 0),
      rect(110, 0),
      undefined,
      undefined,
      undefined,
      undefined,
      rect(0, 184),
      rect(110, 184),
      undefined,
    ] as unknown as DOMRect[];

    expect(strategy({
      activeNodeRect: rects[1],
      activeIndex: 1,
      overIndex: 8,
      index: 6,
      rects,
    })).toEqual({ x: 220, y: -92, scaleX: 1, scaleY: 1 });
  });

  it('caches sparse stride measurements for repeated transforms on the same rect set', () => {
    const strategy = createVirtualizedGridSortingStrategy({ columns: 3 });
    const counters = { left: 0, top: 0 };
    const rects = [
      countingRect(0, 0, counters),
      undefined,
      countingRect(220, 0, counters),
      countingRect(0, 92, counters),
      undefined,
      countingRect(220, 92, counters),
    ] as unknown as DOMRect[];

    strategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      overIndex: 5,
      index: 3,
      rects,
    });

    const afterFirstPass = { ...counters };

    strategy({
      activeNodeRect: rects[0],
      activeIndex: 0,
      overIndex: 5,
      index: 3,
      rects,
    });

    expect(afterFirstPass.left).toBeGreaterThan(0);
    expect(afterFirstPass.top).toBeGreaterThan(0);
    expect(counters).toEqual(afterFirstPass);
  });
});
