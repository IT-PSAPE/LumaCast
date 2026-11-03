import { describe, expect, it } from 'vitest';
import {
  canTransformSource, fitSourceToCanvas, resizeSourceFromPointer, snapResizePointerDelta, snapSourceTranslation,
  sourceBounds, sourceContainsPoint, sourceCropFromPointer,
} from '../../../../apps/stream/renderer/source-transform';
import { rotatePointAroundSource } from '../../../../apps/stream/renderer/source-transform';

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

describe('aspect-locked resize', () => {
  it('keeps a corner resize ratio and its opposite anchor fixed', () => {
    const transform = { x: 10, y: 20, width: 100, height: 50 };
    const resized = resizeSourceFromPointer(transform, 'se', 50, 20, 16, true);

    expect(resized.width / resized.height).toBeCloseTo(2);
    expect(resized).toMatchObject({ x: 10, y: 20, width: 150, height: 75 });
  });

  it('constrains a side resize while keeping the opposite edge and perpendicular center fixed', () => {
    const transform = { x: 10, y: 20, width: 100, height: 50 };
    const resized = resizeSourceFromPointer(transform, 'e', 20, 0, 16, true);

    expect(resized).toMatchObject({ x: 10, y: 15, width: 120, height: 60 });
    expect(resized.width / resized.height).toBeCloseTo(2);
  });

  it('keeps the opposite scene-space anchor fixed for a rotated aspect-locked resize', () => {
    const transform = { x: 10, y: 20, width: 100, height: 50, rotation: 90 };
    const oldAnchor = rotatePointAroundSource({ x: transform.x, y: transform.y + transform.height / 2 }, transform);
    const resized = resizeSourceFromPointer(transform, 'e', 0, 20, 16, true);
    const newAnchor = rotatePointAroundSource({ x: resized.x, y: resized.y + resized.height / 2 }, resized);

    expect(resized.width / resized.height).toBeCloseTo(2);
    expect(newAnchor.x).toBeCloseTo(oldAnchor.x);
    expect(newAnchor.y).toBeCloseTo(oldAnchor.y);
  });
});

describe('source snapping geometry', () => {
  it('reports rotated axis-aligned source bounds', () => {
    expect(sourceBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 })).toMatchObject({
      left: 25, top: -25, right: 75, bottom: 75,
    });
  });

  it('snaps the moved outer bounds to the nearest target within tolerance', () => {
    expect(snapSourceTranslation(
      { left: 10, top: 10, right: 30, bottom: 30 }, -7, 4,
      { x: [0, 50], y: [0, 50] }, { x: 6, y: 6 },
    )).toEqual({ deltaX: -10, deltaY: 4, guides: [{ axis: 'x', position: 0 }] });
  });

  it('snaps a resize handle while retaining the opposite anchor', () => {
    const transform = { x: 10, y: 10, width: 20, height: 20 };
    const snapped = snapResizePointerDelta(
      transform, 'se', 18, 0, { x: [50], y: [] }, { x: 6, y: 6 },
    );
    const resized = resizeSourceFromPointer(transform, 'se', snapped.deltaX, snapped.deltaY);

    expect(snapped.guides).toEqual([{ axis: 'x', position: 50 }]);
    expect(resized).toMatchObject({ x: 10, y: 10, width: 40, height: 20 });
  });
});

describe('source crop gesture geometry', () => {
  it('crops a source edge while preserving pixel scale and the opposite edge', () => {
    const result = sourceCropFromPointer(
      { x: 10, y: 20, width: 100, height: 50 },
      { top: 0, right: 0, bottom: 0, left: 0 },
      { width: 200, height: 100 }, 'e', -5, 0,
    );

    expect(result.crop).toEqual({ top: 0, right: 10, bottom: 0, left: 0 });
    expect(result.transform.x).toBeCloseTo(10);
    expect(result.transform.width).toBeCloseTo(95);
    expect(result.transform.width / (200 - result.crop.left - result.crop.right)).toBeCloseTo(0.5);
  });

  it('keeps the opposite local edge fixed when cropping a rotated source', () => {
    const transform = { x: 20, y: 30, width: 100, height: 50, rotation: 90 };
    const oldAnchor = rotatePointAroundSource({ x: transform.x, y: transform.y + transform.height / 2 }, transform);
    const result = sourceCropFromPointer(
      transform, { top: 0, right: 0, bottom: 0, left: 0 }, { width: 200, height: 100 }, 'e', 0, -5,
    );
    const newAnchor = rotatePointAroundSource({
      x: result.transform.x,
      y: result.transform.y + result.transform.height / 2,
    }, result.transform);

    expect(result.crop.right).toBe(10);
    expect(result.transform.width).toBeCloseTo(95);
    expect(newAnchor.x).toBeCloseTo(oldAnchor.x);
    expect(newAnchor.y).toBeCloseTo(oldAnchor.y);
  });

  it('does not crop away the final source pixel or exceed persisted crop limits', () => {
    const result = sourceCropFromPointer(
      { x: 0, y: 0, width: 100, height: 50 },
      { top: 0, right: 99, bottom: 0, left: 0 },
      { width: 100, height: 50 }, 'e', -500, 0,
    );

    expect(result.crop.right).toBe(99);
    expect(result.transform.width).toBeCloseTo(100);
  });
});
