import { describe, expect, it } from 'vitest';
import { getPopoverIntrinsicHeight, placePopover } from '../../../../apps/stream/renderer/popover-layout';

describe('placePopover', () => {
  it('keeps a popover below its anchor when it fits', () => {
    expect(placePopover({ top: 100, right: 180, bottom: 130, left: 120 }, 200, 180, 800, 600)).toMatchObject({
      top: 136,
      left: 120,
      side: 'bottom',
      maxHeight: 456,
    });
  });

  it('flips above a low anchor when the menu would be clipped below', () => {
    expect(placePopover({ top: 790, right: 870, bottom: 820, left: 830 }, 202, 320, 1000, 900, 'bottom', 'end')).toMatchObject({
      top: 464,
      left: 668,
      side: 'top',
      maxHeight: 776,
    });
  });

  it('clamps an oversized popover to the viewport and provides a scrollable height', () => {
    expect(placePopover({ top: 20, right: 30, bottom: 40, left: 10 }, 900, 1200, 320, 600)).toMatchObject({
      top: 46,
      left: 8,
      side: 'bottom',
      maxHeight: 546,
      maxWidth: 304,
    });
  });

  it('uses the full content height when a previous placement constrained the visible height', () => {
    const visibleHeight = 176;
    const intrinsicHeight = getPopoverIntrinsicHeight(visibleHeight, 424, 2);

    expect(intrinsicHeight).toBe(426);
    expect(placePopover(
      { top: 770, right: 880, bottom: 798, left: 840 },
      202,
      intrinsicHeight,
      1000,
      980,
    )).toMatchObject({
      side: 'top',
      maxHeight: 756,
      top: 338,
    });
  });
});
