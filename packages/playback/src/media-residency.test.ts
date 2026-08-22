import { describe, expect, it } from 'vitest';
import {
  resolveMediaResidencyPlan,
  type MediaResidencyPredictionInput,
  type MediaResidencySlide,
} from './media-residency';

function slide(id: string, mediaKeys: string[]): MediaResidencySlide {
  return { id, mediaKeys };
}

function tiers(input: MediaResidencyPredictionInput): Record<string, string> {
  return Object.fromEntries(resolveMediaResidencyPlan(input).entries.map((entry) => [entry.mediaKey, entry.tier]));
}

describe('resolveMediaResidencyPlan', () => {
  it('predicts the sequential preload window around the current live slide', () => {
    const result = tiers({
      displayedMediaKeys: ['live-image'],
      slides: [
        slide('s1', ['prev-image']),
        slide('s2', ['live-image']),
        slide('s3', ['next-image']),
        slide('s4', ['second-next-image']),
      ],
      liveSlideIndex: 1,
      selectedSlideIndex: 1,
      nextPlaylistFirstSlide: null,
      armedStage: null,
    });

    expect(result).toEqual({
      'live-image': 'T0',
      'next-image': 'T1',
      'prev-image': 'T2',
      'second-next-image': 'T2',
    });
  });

  it('treats a selected-but-not-live arbitrary jump as the arm signal', () => {
    const result = tiers({
      displayedMediaKeys: ['live-image'],
      slides: [
        slide('s1', ['live-image']),
        slide('s2', ['jump-image']),
      ],
      liveSlideIndex: 0,
      selectedSlideIndex: 1,
      nextPlaylistFirstSlide: null,
      armedStage: null,
    });

    expect(result['jump-image']).toBe('T1');
    expect(result['live-image']).toBe('T0');
  });

  it('warms the next playlist item first slide at T1 across item boundaries', () => {
    const result = tiers({
      displayedMediaKeys: ['live-image'],
      slides: [slide('s1', ['live-image'])],
      liveSlideIndex: 0,
      selectedSlideIndex: 0,
      nextPlaylistFirstSlide: slide('next-item-first', ['cross-item-image']),
      armedStage: null,
    });

    expect(result['cross-item-image']).toBe('T1');
  });

  it('lets the strongest tier win when one asset is referenced by multiple roles', () => {
    const plan = resolveMediaResidencyPlan({
      displayedMediaKeys: ['shared-image'],
      slides: [
        slide('s1', ['shared-image']),
        slide('s2', ['shared-image', 'adjacent-only']),
      ],
      liveSlideIndex: 0,
      selectedSlideIndex: 1,
      nextPlaylistFirstSlide: null,
      armedStage: { id: 'stage-1', mediaKeys: ['shared-image'] },
    });

    const shared = plan.entries.find((entry) => entry.mediaKey === 'shared-image');
    expect(shared).toMatchObject({ tier: 'T0' });
    expect(shared?.reasons).toEqual(expect.arrayContaining(['displayed', 'selected', 'stage']));
    expect(plan.entries.find((entry) => entry.mediaKey === 'adjacent-only')).toMatchObject({ tier: 'T1' });
  });
});
