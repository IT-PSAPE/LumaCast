import { describe, expect, it } from 'vitest';
import { fullCrop, resizeCrop } from '../../../../apps/flux/renderer/crop';

// Crop geometry is renderer code: it is owned by the app's own crop helper and
// covered beside it, not from the headless imaging package.
describe('crop handle geometry', () => {
  it('all crop handles preserve locked ratio and stay inside bounds', () => {
    const box = { x: 0.1, y: 0.2, width: 0.7, height: 0.5 };
    for (const handle of ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'])
      for (const dx of [-2, -0.1, 0.1, 2])
        for (const dy of [-2, -0.1, 0.1, 2]) {
          const b = resizeCrop(box, handle, dx, dy, 1.4);
          expect(
            b.x >= -1e-12 &&
              b.y >= -1e-12 &&
              b.x + b.width <= 1 + 1e-12 &&
              b.y + b.height <= 1 + 1e-12,
          ).toBe(true);
          expect(b.width > 0 && b.height > 0).toBe(true);
          expect(Math.abs(b.width / b.height - 1.4) < 1e-10).toBe(true);
        }
  });

  it('clamps a move inside the frame without changing the size', () => {
    const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.3 };
    const moved = resizeCrop(box, 'move', 5, 5);

    expect(moved).toEqual({ x: 0.7, y: 0.7, width: 0.3, height: 0.3 });
    expect(resizeCrop(box, 'move', -5, -5)).toEqual({
      x: 0,
      y: 0,
      width: 0.3,
      height: 0.3,
    });
  });

  it('keeps a full-frame crop full while a ratio is locked', () => {
    const b = resizeCrop(fullCrop, 'se', 2, 2, 1);

    expect(b.width).toBeCloseTo(1, 10);
    expect(b.height).toBeCloseTo(1, 10);
  });
});
