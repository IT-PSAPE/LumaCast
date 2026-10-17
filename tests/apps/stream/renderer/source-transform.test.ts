import { describe, expect, it } from 'vitest';
import { canTransformSource, fitSourceToCanvas } from '../../../../apps/stream/renderer/source-transform';

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
