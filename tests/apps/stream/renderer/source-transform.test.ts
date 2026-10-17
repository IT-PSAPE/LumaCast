import { describe, expect, it } from 'vitest';
import { canTransformSource, fitSourceToCanvas, resizeSourceFromPointer, sourceContainsPoint } from '../../../../apps/stream/renderer/source-transform';

describe('fitSourceToCanvas', () => {
  it('contains a wide source and centers it without changing its aspect ratio', () => {
    expect(fitSourceToCanvas({ width: 2560, height: 1080 }, { width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 135,
      width: 1920,
      height: 810,
    });
  });

  it('contains portrait sources within the canvas', () => {
    expect(fitSourceToCanvas({ width: 1080, height: 1920 }, { width: 1920, height: 1080 })).toEqual({
      x: 656,
      y: 0,
      width: 608,
      height: 1080,
    });
  });
});

describe('source transform lock', () => {
  it('allows movement by default and blocks it for locked sources', () => {
    expect(canTransformSource(undefined)).toBe(true);
    expect(canTransformSource(false)).toBe(true);
    expect(canTransformSource(true)).toBe(false);
  });
});

describe('rotated source geometry', () => {
  it('tests points against the rotated rectangle instead of its axis-aligned box', () => {
    const transform = { x: 0, y: 0, width: 100, height: 50, rotation: 90 };

    expect(sourceContainsPoint(transform, 30, 0)).toBe(true);
    expect(sourceContainsPoint(transform, 10, 0)).toBe(false);
  });

  it('resizes along the rotated local axes and holds the opposite edge in place', () => {
    const transform = { x: 0, y: 0, width: 100, height: 50, rotation: 90 };
    const resized = resizeSourceFromPointer(transform, 'e', 0, 20);

    expect(resized).toEqual({ x: -10, y: 10, width: 120, height: 50, rotation: 90 });
  });

  it('clamps pointer resizing to the minimum size without dropping the angle', () => {
    expect(resizeSourceFromPointer({ x: 4, y: 6, width: 20, height: 20, rotation: 35 }, 'w', 500, 0))
      .toMatchObject({ width: 16, height: 20, rotation: 35 });
  });
});
