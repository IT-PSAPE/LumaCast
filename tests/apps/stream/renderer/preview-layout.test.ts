import { describe, expect, it } from 'vitest';
import { fitPreviewSize } from '../../../../apps/stream/renderer/preview-layout';

describe('fitPreviewSize', () => {
  it('fits a 16:9 output to the available height when the work area is wide', () => {
    const fitted = fitPreviewSize(1200, 400, 1920, 1080);
    expect(fitted.width).toBeCloseTo(711.111, 3);
    expect(fitted.height).toBeCloseTo(400, 5);
    expect(fitted.width / fitted.height).toBeCloseTo(16 / 9, 5);
  });

  it('fits a 16:9 output to the available width when the work area is tall', () => {
    const fitted = fitPreviewSize(800, 700, 1920, 1080);
    expect(fitted.width).toBe(800);
    expect(fitted.height).toBeCloseTo(450, 5);
  });

  it('returns an empty size when any dimension is not positive and finite', () => {
    expect(fitPreviewSize(0, 400, 1920, 1080)).toEqual({ width: 0, height: 0 });
    expect(fitPreviewSize(Number.POSITIVE_INFINITY, 400, 1920, 1080)).toEqual({ width: 0, height: 0 });
  });
});
