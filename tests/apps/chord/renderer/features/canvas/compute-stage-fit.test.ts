import { describe, expect, it } from 'vitest';
import { computeStageFit } from '../../../../../../apps/chord/renderer/features/canvas/chord-stage';

describe('computeStageFit', () => {
  it('fits a width-constrained composition into a narrower viewport, centering vertically', () => {
    const fit = computeStageFit({ width: 1920, height: 1080 }, { width: 960, height: 1080 });
    expect(fit.scale).toBeCloseTo(0.5, 10);
    expect(fit.offsetX).toBeCloseTo(0, 10);
    expect(fit.offsetY).toBeCloseTo(270, 10);
  });

  it('fits a height-constrained composition into a shorter viewport, centering horizontally', () => {
    const fit = computeStageFit({ width: 1080, height: 1920 }, { width: 1920, height: 960 });
    expect(fit.scale).toBeCloseTo(0.5, 10);
    expect(fit.offsetX).toBeCloseTo(690, 10);
    expect(fit.offsetY).toBeCloseTo(0, 10);
  });

  it('returns scale 1 and no offset when the viewport exactly matches the composition', () => {
    const fit = computeStageFit({ width: 1920, height: 1080 }, { width: 1920, height: 1080 });
    expect(fit).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
  });

  it('guards against a zero-sized composition or viewport instead of dividing by zero', () => {
    const fit = computeStageFit({ width: 0, height: 0 }, { width: 100, height: 100 });
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(Number.isFinite(fit.offsetX)).toBe(true);
    expect(Number.isFinite(fit.offsetY)).toBe(true);
  });
});
