import { describe, expect, it } from 'vitest';
import { resolveMediaFit } from '../../../../packages/canvas/src/resolve-media-cover';

describe('resolveMediaFit crop', () => {
  const crop = { x: 0.25, y: 0.2, width: 0.5, height: 0.5 };

  it('uses the selected pixel region for contain', () => {
    expect(resolveMediaFit(1000, 800, 300, 300, 'contain', crop)).toEqual({
      x: 0,
      y: 30,
      width: 300,
      height: 240,
      crop: { x: 250, y: 160, width: 500, height: 400 },
    });
  });

  it('uses the selected region and adds cover offsets to Konva crop coordinates', () => {
    expect(resolveMediaFit(1000, 800, 300, 100, 'cover', crop)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 100,
      crop: { x: 250, y: 276.6666666666667, width: 500, height: 166.66666666666666 },
    });
  });

  it('fills the target from the selected region', () => {
    expect(resolveMediaFit(1000, 800, 300, 100, 'fill', crop)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 100,
      crop: { x: 250, y: 160, width: 500, height: 400 },
    });
  });

  it('keeps legacy behavior when crop is missing or null', () => {
    const baseline = resolveMediaFit(1000, 800, 300, 100, 'cover');
    expect(resolveMediaFit(1000, 800, 300, 100, 'cover', null)).toEqual(baseline);
    expect(resolveMediaFit(1000, 800, 300, 100, 'contain')).toEqual({
      x: 87.5,
      y: 0,
      width: 125,
      height: 100,
    });
  });

  it('places contain-fit content inside an asymmetric normalized destination frame', () => {
    expect(resolveMediaFit(1000, 500, 400, 200, 'contain', null, {
      x: 0.15,
      y: 0.2,
      width: 0.6,
      height: 0.5,
    })).toEqual({ x: 80, y: 40, width: 200, height: 100 });
  });

  it('combines source crop with a destination frame before applying fit', () => {
    expect(resolveMediaFit(1000, 800, 400, 200, 'fill', crop, {
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.5,
    })).toEqual({
      x: 40,
      y: 40,
      width: 200,
      height: 100,
      crop: { x: 250, y: 160, width: 500, height: 400 },
    });
  });
});
