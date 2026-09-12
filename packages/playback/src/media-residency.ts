export type MediaResidencyTier = 'T0' | 'T1' | 'T2' | 'T3';

export interface MediaResidencySlide {
  id: string;
  mediaKeys: readonly string[];
}

export interface MediaResidencyStage {
  id: string;
  mediaKeys: readonly string[];
}

export interface MediaResidencyPredictionInput {
  displayedMediaKeys: readonly string[];
  slides: readonly MediaResidencySlide[];
  liveSlideIndex: number;
  selectedSlideIndex: number;
  nextPlaylistFirstSlide: MediaResidencySlide | null;
  armedStage: MediaResidencyStage | null;
}

export interface MediaResidencyPlanEntry {
  mediaKey: string;
  tier: MediaResidencyTier;
  reasons: string[];
}

export interface MediaResidencyPlan {
  entries: MediaResidencyPlanEntry[];
}

const TIER_PRIORITY: Record<MediaResidencyTier, number> = {
  T0: 0,
  T1: 1,
  T2: 2,
  T3: 3,
};

function addTier(
  byKey: Map<string, MediaResidencyPlanEntry>,
  mediaKeys: readonly string[],
  tier: MediaResidencyTier,
  reason: string,
) {
  for (const mediaKey of mediaKeys) {
    const current = byKey.get(mediaKey);
    if (!current) {
      byKey.set(mediaKey, { mediaKey, tier, reasons: [reason] });
      continue;
    }
    if (TIER_PRIORITY[tier] < TIER_PRIORITY[current.tier]) {
      current.tier = tier;
    }
    if (!current.reasons.includes(reason)) {
      current.reasons.push(reason);
    }
  }
}

export function resolveMediaResidencyPlan(input: MediaResidencyPredictionInput): MediaResidencyPlan {
  const byKey = new Map<string, MediaResidencyPlanEntry>();

  addTier(byKey, input.displayedMediaKeys, 'T0', 'displayed');

  const liveSlide = input.slides[input.liveSlideIndex] ?? null;
  const previousSlide = input.liveSlideIndex > 0 ? input.slides[input.liveSlideIndex - 1] ?? null : null;
  const nextSlide = input.liveSlideIndex >= 0 ? input.slides[input.liveSlideIndex + 1] ?? null : null;
  const secondNextSlide = input.liveSlideIndex >= 0 ? input.slides[input.liveSlideIndex + 2] ?? null : null;
  const selectedSlide = input.slides[input.selectedSlideIndex] ?? null;

  if (liveSlide) addTier(byKey, liveSlide.mediaKeys, 'T0', 'live');
  if (previousSlide) addTier(byKey, previousSlide.mediaKeys, 'T2', 'previous');
  if (nextSlide) addTier(byKey, nextSlide.mediaKeys, 'T1', 'next');
  if (secondNextSlide) addTier(byKey, secondNextSlide.mediaKeys, 'T2', 'second-next');
  if (selectedSlide && input.selectedSlideIndex !== input.liveSlideIndex) {
    addTier(byKey, selectedSlide.mediaKeys, 'T1', 'selected');
  }
  if (input.nextPlaylistFirstSlide) {
    addTier(byKey, input.nextPlaylistFirstSlide.mediaKeys, 'T1', 'cross-item-next');
  }
  if (input.armedStage) {
    addTier(byKey, input.armedStage.mediaKeys, 'T1', 'stage');
  }

  return {
    entries: [...byKey.values()].sort((left, right) => left.mediaKey.localeCompare(right.mediaKey)),
  };
}
