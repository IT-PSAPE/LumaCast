import { describe, expect, it } from 'vitest';
import { computeMediaCropGesture, type CropTransformHandle } from '../../../../packages/canvas/src/media-crop-transform';

const frame = { x: 40, y: 40, width: 100, height: 100 };
const sourceDrawRect = { x: 0, y: 0, width: 200, height: 200 };

describe('media crop gesture transform', () => {
  it('resizes from each of the eight anchors in local coordinates', () => {
    const cases: Array<{ handle: CropTransformHandle; deltaX: number; deltaY: number; expected: typeof frame }> = [
      { handle: 'nw', deltaX: -10, deltaY: -10, expected: { x: 30, y: 30, width: 110, height: 110 } },
      { handle: 'n', deltaX: 0, deltaY: -10, expected: { x: 40, y: 30, width: 100, height: 110 } },
      { handle: 'ne', deltaX: 10, deltaY: -10, expected: { x: 40, y: 30, width: 110, height: 110 } },
      { handle: 'e', deltaX: 10, deltaY: 0, expected: { x: 40, y: 40, width: 110, height: 100 } },
      { handle: 'se', deltaX: 10, deltaY: 10, expected: { x: 40, y: 40, width: 110, height: 110 } },
      { handle: 's', deltaX: 0, deltaY: 10, expected: { x: 40, y: 40, width: 100, height: 110 } },
      { handle: 'sw', deltaX: -10, deltaY: 10, expected: { x: 30, y: 40, width: 110, height: 110 } },
      { handle: 'w', deltaX: -10, deltaY: 0, expected: { x: 30, y: 40, width: 110, height: 100 } },
    ];

    for (const testCase of cases) {
      const result = computeMediaCropGesture({
        frame,
        sourceDrawRect,
        handle: testCase.handle,
        deltaX: testCase.deltaX,
        deltaY: testCase.deltaY,
      });
      expectRectClose(result?.frame, testCase.expected, testCase.handle);
      expectRectClose(result?.cropFrame, { x: 0, y: 0, width: 1, height: 1 }, testCase.handle);

      if (testCase.handle.includes('w')) {
        expect(result!.frame.x + result!.frame.width).toBeCloseTo(frame.x + frame.width);
      } else if (testCase.handle.includes('e')) {
        expect(result!.frame.x).toBeCloseTo(frame.x);
      } else {
        expect(result!.frame.x).toBeCloseTo(frame.x);
        expect(result!.frame.width).toBeCloseTo(frame.width);
      }
      if (testCase.handle.includes('n')) {
        expect(result!.frame.y + result!.frame.height).toBeCloseTo(frame.y + frame.height);
      } else if (testCase.handle.includes('s')) {
        expect(result!.frame.y).toBeCloseTo(frame.y);
      } else {
        expect(result!.frame.y).toBeCloseTo(frame.y);
        expect(result!.frame.height).toBeCloseTo(frame.height);
      }
    }
  });

  it('locks corner resizing to the initial frame aspect and holds the opposite corner', () => {
    const initial = { x: 20, y: 30, width: 120, height: 60 };
    const result = computeMediaCropGesture({
      frame: initial,
      sourceDrawRect: { x: -100, y: -100, width: 500, height: 500 },
      handle: 'se',
      deltaX: 30,
      deltaY: 10,
    });

    expect(result?.frame).toEqual({ x: 20, y: 30, width: 150, height: 75 });
    expect(result!.frame.width / result!.frame.height).toBeCloseTo(2);
    expectRectClose(result?.crop, { x: 0.24, y: 0.26, width: 0.3, height: 0.15 }, 'corner source crop');
  });

  it('moves only the selected axis for side handles', () => {
    const result = computeMediaCropGesture({
      frame,
      sourceDrawRect,
      handle: 'e',
      deltaX: 20,
      deltaY: 40,
    });
    expect(result?.frame).toEqual({ x: 40, y: 40, width: 120, height: 100 });
  });

  it('preserves letterbox margins in cropFrame for contain-style source placement', () => {
    const result = computeMediaCropGesture({
      frame: { x: 0, y: 0, width: 200, height: 120 },
      sourceDrawRect: { x: 0, y: 10, width: 200, height: 100 },
      handle: 'e',
      deltaX: -40,
      deltaY: 0,
    });
    expect(result?.frame).toEqual({ x: 0, y: 0, width: 160, height: 120 });
    expect(result?.crop).toEqual({ x: 0, y: 0, width: 0.8, height: 1 });
    expectRectClose(result?.cropFrame, { x: 0, y: 10 / 120, width: 1, height: 100 / 120 }, 'letterbox crop frame');
  });

  it('reveals previously clipped source when the frame expands, including an existing crop', () => {
    const result = computeMediaCropGesture({
      frame: { x: 0, y: 0, width: 100, height: 100 },
      sourceDrawRect: { x: -100, y: 0, width: 300, height: 100 },
      handle: 'w',
      deltaX: -50,
      deltaY: 0,
    });
    expect(result?.frame).toEqual({ x: -50, y: 0, width: 150, height: 100 });
    expect(result?.crop).toEqual({ x: 1 / 6, y: 0, width: 1 / 2, height: 1 });
    expect(result?.cropFrame).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('keeps normalized source bounds within one at fractional source edges', () => {
    const result = computeMediaCropGesture({
      frame: { x: 0.03, y: 0, width: 0.4, height: 1 },
      sourceDrawRect: { x: 0, y: 0, width: 0.29, height: 1 },
      handle: 'e',
      deltaX: 0,
      deltaY: 0,
    });

    expect(result?.crop).toEqual({
      x: 0.03 / 0.29,
      y: 0,
      width: 1 - 0.03 / 0.29,
      height: 1,
    });
    expect(result!.crop.x + result!.crop.width).toBeLessThanOrEqual(1);
    expect(result!.crop.y + result!.crop.height).toBeLessThanOrEqual(1);
  });

  it('keeps the original source-pixel scale while changing the visible crop', () => {
    const sourceWidth = 1600;
    const sourceHeight = 900;
    const result = computeMediaCropGesture({
      frame: { x: 100, y: 50, width: 400, height: 225 },
      sourceDrawRect: { x: 0, y: 0, width: 800, height: 450 },
      handle: 'e',
      deltaX: -80,
      deltaY: 0,
    });

    const pixelsPerFrameUnitX = result!.crop.width * sourceWidth / (result!.cropFrame.width * result!.frame.width);
    const pixelsPerFrameUnitY = result!.crop.height * sourceHeight / (result!.cropFrame.height * result!.frame.height);
    expect(pixelsPerFrameUnitX).toBeCloseTo(sourceWidth / 800);
    expect(pixelsPerFrameUnitY).toBeCloseTo(sourceHeight / 450);
  });

  it('clamps each edge to source availability and keeps a 16-unit minimum', () => {
    const bounded = computeMediaCropGesture({
      frame: { x: 20, y: 20, width: 40, height: 40 },
      sourceDrawRect: { x: 0, y: 0, width: 100, height: 100 },
      handle: 'se',
      deltaX: 200,
      deltaY: 200,
    });
    expect(bounded?.frame).toEqual({ x: 20, y: 20, width: 80, height: 80 });

    const minimum = computeMediaCropGesture({
      frame: { x: 20, y: 20, width: 40, height: 40 },
      sourceDrawRect,
      handle: 'nw',
      deltaX: 100,
      deltaY: 100,
    });
    expect(minimum?.frame).toEqual({ x: 44, y: 44, width: 16, height: 16 });
  });

  it('does not enlarge a minimum frame that starts below the default minimum', () => {
    const result = computeMediaCropGesture({
      frame: { x: 10, y: 12, width: 8, height: 12 },
      sourceDrawRect: { x: 0, y: 0, width: 40, height: 40 },
      handle: 'nw',
      deltaX: 100,
      deltaY: 100,
    });

    expect(result?.frame).toEqual({ x: 10, y: 12, width: 8, height: 12 });
  });

  it('honors local-coordinate signs for flipped media without changing crop math', () => {
    const ordinary = computeMediaCropGesture({
      frame: { x: 0, y: 0, width: 100, height: 100 },
      sourceDrawRect: { x: -50, y: 0, width: 200, height: 100 },
      handle: 'w',
      deltaX: 20,
      deltaY: 0,
    });
    const flippedPointerDelta = computeMediaCropGesture({
      frame: { x: 0, y: 0, width: 100, height: 100 },
      sourceDrawRect: { x: -50, y: 0, width: 200, height: 100 },
      handle: 'w',
      deltaX: -20,
      deltaY: 0,
    });

    expect(ordinary?.frame.width).toBe(80);
    expect(flippedPointerDelta?.frame.width).toBe(120);
    expect(ordinary?.crop.x).toBeGreaterThan(flippedPointerDelta!.crop.x);
  });

  it('returns null for malformed geometry, invalid deltas, or an empty source intersection', () => {
    expect(computeMediaCropGesture({ frame, sourceDrawRect, handle: 'e', deltaX: Number.NaN, deltaY: 0 })).toBeNull();
    expect(computeMediaCropGesture({ frame, sourceDrawRect: { ...sourceDrawRect, width: 0 }, handle: 'e', deltaX: 1, deltaY: 0 })).toBeNull();
    expect(computeMediaCropGesture({
      frame: { x: 0, y: 0, width: 100, height: 100 },
      sourceDrawRect: { x: 0, y: 120, width: 100, height: 100 },
      handle: 's',
      deltaX: 0,
      deltaY: 20,
    })).toBeNull();
  });
});

function expectRectClose(
  actual: { x: number; y: number; width: number; height: number } | undefined,
  expected: { x: number; y: number; width: number; height: number },
  message: string,
) {
  expect(actual, message).toBeDefined();
  expect(actual!.x, `${message} x`).toBeCloseTo(expected.x);
  expect(actual!.y, `${message} y`).toBeCloseTo(expected.y);
  expect(actual!.width, `${message} width`).toBeCloseTo(expected.width);
  expect(actual!.height, `${message} height`).toBeCloseTo(expected.height);
}
