// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { slideshowImageElementKey, slideshowSlideIndex } from '../../../../apps/stream/renderer/slideshow';

describe('Stream image slideshow timing', () => {
  it('advances after each configured interval and loops to the first image', () => {
    expect(slideshowSlideIndex(0, 3, 5, true)).toBe(0);
    expect(slideshowSlideIndex(4_999, 3, 5, true)).toBe(0);
    expect(slideshowSlideIndex(5_000, 3, 5, true)).toBe(1);
    expect(slideshowSlideIndex(15_000, 3, 5, true)).toBe(0);
  });

  it('holds the last image when looping is disabled and handles empty input', () => {
    expect(slideshowSlideIndex(20_000, 3, 5, false)).toBe(2);
    expect(slideshowSlideIndex(0, 0, 5, true)).toBe(-1);
  });

  it('resolves the active image element key for the selected slideshow slide', () => {
    const slides = [
      { assetId: 'first', assetExtension: 'png', name: 'First' },
      { assetId: 'second', assetExtension: 'jpg', name: 'Second' },
    ];

    expect(slideshowImageElementKey('slideshow', slides, 1)).toBe('slideshow:second');
    expect(slideshowImageElementKey('slideshow', slides, -1)).toBe('slideshow');
  });
});
