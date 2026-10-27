// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { currentSlideshowElapsedMs, currentSlideshowSlideIndex, forgetSlideshow, setSlideshowActive, slideshowImageElementKey, slideshowSlideIndex } from '../../../../apps/stream/renderer/slideshow';

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

  it('does not advance from render reads and pauses its clock outside Program', () => {
    const sourceId = 'program-slideshow-clock-test';
    forgetSlideshow(sourceId);

    expect(currentSlideshowSlideIndex(sourceId, 4, 1, true, 4_000)).toBe(0);
    setSlideshowActive(sourceId, false, 4_000);
    expect(currentSlideshowElapsedMs(sourceId, 8_000)).toBe(0);

    setSlideshowActive(sourceId, true, 8_000);
    expect(currentSlideshowSlideIndex(sourceId, 4, 1, true, 9_500)).toBe(1);
    setSlideshowActive(sourceId, false, 10_500);
    expect(currentSlideshowElapsedMs(sourceId, 30_000)).toBe(2_500);
    expect(currentSlideshowSlideIndex(sourceId, 4, 1, true, 30_000)).toBe(2);

    setSlideshowActive(sourceId, true, 50_000);
    expect(currentSlideshowElapsedMs(sourceId, 50_500)).toBe(3_000);
    forgetSlideshow(sourceId);
  });

  it('keeps one active clock through repeated Program updates for the same runtime source', () => {
    const sourceId = 'shared-runtime-slideshow-clock-test';
    forgetSlideshow(sourceId);

    setSlideshowActive(sourceId, true, 1_000);
    setSlideshowActive(sourceId, true, 1_500);
    expect(currentSlideshowElapsedMs(sourceId, 2_000)).toBe(1_000);

    setSlideshowActive(sourceId, false, 2_000);
    setSlideshowActive(sourceId, false, 2_500);
    expect(currentSlideshowElapsedMs(sourceId, 9_000)).toBe(1_000);
    forgetSlideshow(sourceId);
  });
});
