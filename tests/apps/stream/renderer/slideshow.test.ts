// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  currentSlideshowElapsedMs, currentSlideshowSlideIndex, currentSourceSlideIndex, forgetSlideshow,
  forgetSourceSlideshows, forgetUnusedSlidePlaybacks, getSlidePlaybackRevision,
  isSourceSlideAutoAdvancing, navigateSlidePlayback, navigateSourceSlide, releaseSlidePlaybackConfig,
  seedSlidePlaybackFromProgram, setSlideshowActive, setSlidePlaybackActive, setSourceSlideshowAutoAdvance,
  slideshowImageElementKey, slideshowSlideIndex, sourceSlideImages, slidePlaybackKey,
  subscribeSlidePlayback, syncSlidePlaybackConfig,
} from '../../../../apps/stream/renderer/slideshow';
import { getSourceRuntimeId } from '../../../../apps/stream/renderer/source-runtime';
import type { StreamSource } from '../../../../apps/stream/shared/desktop-api';

const createdSources: StreamSource[] = [];

function slideSource(overrides: Partial<StreamSource> = {}): StreamSource {
  const source: StreamSource = {
    id: crypto.randomUUID(), name: 'Slides', kind: 'slideshow', visible: true, muted: false, volume: 1,
    transform: { x: 0, y: 0, width: 1920, height: 1080 }, slideshowIntervalSeconds: 1,
    slideshowImages: ['first', 'second', 'third'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    ...overrides,
  };
  createdSources.push(source);
  return source;
}

afterEach(() => {
  for (const source of createdSources) forgetSourceSlideshows(getSourceRuntimeId(source));
  createdSources.length = 0;
  forgetSlideshow('program-slideshow-clock-test');
  forgetSlideshow('shared-runtime-slideshow-clock-test');
});

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
  });
});

describe('Stream runtime slide cursor', () => {
  it('seeds once from a saved index and shares the authoritative Program seed across matching copies', () => {
    const preview = slideSource({ id: 'matching-slides', slideIndex: 0 });
    const program = { ...preview, slideIndex: 2 };
    expect(slidePlaybackKey(preview)).toBe(slidePlaybackKey(program));
    expect(currentSourceSlideIndex(preview)).toBe(0);

    seedSlidePlaybackFromProgram(program);
    expect(currentSourceSlideIndex(preview)).toBe(2);
    expect(currentSourceSlideIndex(program)).toBe(2);

    const laterProgramSnapshot = { ...program, slideIndex: 1 };
    seedSlidePlaybackFromProgram(laterProgramSnapshot);
    expect(currentSourceSlideIndex(preview)).toBe(2);
  });

  it('keeps navigation in runtime state across snapshot changes without mutating sources', () => {
    const preview = slideSource({ id: 'cross-scene-slides', slideIndex: 0 });
    const program = { ...preview, slideIndex: 2 };
    seedSlidePlaybackFromProgram(program);
    const beforePreview = structuredClone(preview);
    const beforeProgram = structuredClone(program);

    navigateSlidePlayback(program, 'previous', 10_000);
    expect(currentSourceSlideIndex(preview, 10_000)).toBe(1);
    expect(currentSourceSlideIndex(program, 10_000)).toBe(1);
    expect(currentSourceSlideIndex({ ...program, slideIndex: 0 }, 11_000)).toBe(1);
    expect(currentSourceSlideIndex({ ...preview, slideIndex: 2 }, 12_000)).toBe(1);
    expect(preview).toEqual(beforePreview);
    expect(program).toEqual(beforeProgram);
  });

  it('isolates different resource variants', () => {
    const source = slideSource({ id: 'resource-variants', slideIndex: 0 });
    const variant = { ...source, slideshowImages: [...source.slideshowImages!, { assetId: 'fourth', assetExtension: 'png', name: 'fourth' }] };
    expect(slidePlaybackKey(source)).not.toBe(slidePlaybackKey(variant));

    navigateSlidePlayback(source, 'next');
    expect(currentSourceSlideIndex(source)).toBe(1);
    expect(currentSourceSlideIndex(variant)).toBe(0);
  });

  it('uses Program config ahead of Preview and falls back when the Program owner releases it', () => {
    const preview = slideSource({ id: 'priority-slides', slideshowAutoAdvance: true, slideshowIntervalSeconds: 1 });
    const program = { ...preview, slideshowAutoAdvance: false, slideshowIntervalSeconds: 10 };
    syncSlidePlaybackConfig(preview, 'preview', 500);
    syncSlidePlaybackConfig(program, 'program', 500);
    setSlidePlaybackActive(program, true, false, 1_000);

    expect(isSourceSlideAutoAdvancing(program)).toBe(false);
    expect(currentSourceSlideIndex(program, 5_000)).toBe(0);

    releaseSlidePlaybackConfig(program, 'program', 5_000);
    expect(isSourceSlideAutoAdvancing(preview)).toBe(true);
    expect(currentSourceSlideIndex(program, 5_999)).toBe(0);
    expect(currentSourceSlideIndex(program, 6_000)).toBe(1);
  });

  it('pauses automatic playback on manual navigation and resumes only after explicit opt-in', () => {
    const source = slideSource({ slideIndex: 1, slideshowAutoAdvance: true });
    setSlidePlaybackActive(source, true, false, 1_000);
    expect(currentSourceSlideIndex(source, 2_000)).toBe(2);

    navigateSlidePlayback(source, 'next', 2_100);
    expect(currentSourceSlideIndex(source, 20_000)).toBe(2);
    expect(isSourceSlideAutoAdvancing(source)).toBe(false);
    expect(source.slideshowAutoAdvance).toBe(true);

    const resumed = setSourceSlideshowAutoAdvance(source, true, 21_000);
    expect(resumed).toBe(source);
    expect(isSourceSlideAutoAdvancing(resumed)).toBe(true);
    expect(currentSourceSlideIndex(resumed, 21_999)).toBe(2);
    expect(currentSourceSlideIndex(resumed, 22_000)).toBe(0);
  });

  it('defaults to manual and keeps presentation sources manual', () => {
    const source = slideSource();
    expect(currentSourceSlideIndex(source, 50_000)).toBe(0);
    expect(isSourceSlideAutoAdvancing(source)).toBe(false);
    expect(setSourceSlideshowAutoAdvance(source, false)).toBe(source);

    const presentation = { ...source, kind: 'presentation' as const, presentationSlides: source.slideshowImages };
    expect(sourceSlideImages(presentation)).toBe(presentation.presentationSlides);
    expect(setSourceSlideshowAutoAdvance(presentation, true)).toBe(presentation);
    navigateSlidePlayback(presentation, 'next');
    expect(currentSourceSlideIndex(presentation)).toBe(1);
    expect(presentation.slideshowAutoAdvance).toBeUndefined();
  });

  it('resets only on an opted-in inactive to active transition', () => {
    const source = slideSource({ slideIndex: 1, slideshowAutoAdvance: false });
    setSlidePlaybackActive(source, true, false, 1_000);
    navigateSlidePlayback(source, 'next', 1_100);
    expect(currentSourceSlideIndex(source, 1_200)).toBe(2);

    setSlidePlaybackActive(source, false, true, 2_000);
    setSlidePlaybackActive(source, true, false, 3_000);
    expect(currentSourceSlideIndex(source, 3_000)).toBe(2);
    setSlidePlaybackActive(source, true, true, 4_000);
    expect(currentSourceSlideIndex(source, 4_000)).toBe(2);

    setSlidePlaybackActive(source, false, true, 5_000);
    setSlidePlaybackActive(source, true, true, 6_000);
    expect(currentSourceSlideIndex(source, 6_000)).toBe(0);

    const defaultRetain = slideSource({
      slideIndex: 2, restartPlaybackWhenActive: undefined,
      slideshowImages: ['retain-a', 'retain-b', 'retain-c'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    });
    setSlidePlaybackActive(defaultRetain, true, undefined, 7_000);
    expect(currentSourceSlideIndex(defaultRetain, 7_000)).toBe(2);
    const explicitReset = slideSource({
      slideIndex: 2, restartPlaybackWhenActive: true,
      slideshowImages: ['reset-a', 'reset-b', 'reset-c'].map((assetId) => ({ assetId, assetExtension: 'png', name: assetId })),
    });
    setSlidePlaybackActive(explicitReset, true, undefined, 8_000);
    expect(currentSourceSlideIndex(explicitReset, 8_000)).toBe(0);
  });

  it('notifies subscribers on manual changes while preserving runtime identity across playback generations', () => {
    const source = slideSource({ id: 'subscribed-slides' });
    const matching = { ...source, slideshowPlaybackId: 'next-generation' };
    const listener = vi.fn();
    const unsubscribe = subscribeSlidePlayback(source, listener);
    const initialRevision = getSlidePlaybackRevision(matching);

    navigateSlidePlayback(source, 'next');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSlidePlaybackRevision(matching)).toBe(initialRevision + 1);
    unsubscribe();
  });

  it('retains the source-based helper for property editors without changing its input', () => {
    const source = slideSource({ slideIndex: 1, slideshowAutoAdvance: true });
    const before = structuredClone(source);
    const manual = navigateSourceSlide(source, 'next');
    expect(manual.slideIndex).toBe(2);
    expect(manual.slideshowAutoAdvance).toBe(false);
    expect(source).toEqual(before);
  });

  it('evicts an inactive cursor only when no view references it', () => {
    const source = slideSource({ id: 'evicted-slides' });
    const key = slidePlaybackKey(source);
    navigateSlidePlayback(source, 'next');
    expect(currentSourceSlideIndex(source)).toBe(1);

    forgetUnusedSlidePlaybacks(new Set());

    expect(currentSourceSlideIndex(source)).toBe(0);
    expect(key).toBe(getSourceRuntimeId(source));
  });
});
