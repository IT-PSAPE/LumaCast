import type { Id } from '@lumacast/kernel';
import { createId } from '@lumacast/kernel';
import type { ItemRef } from '@lumacast/composition';

export interface SlideTimingStep { slideId: Id; durationMs: number; }
export interface AudioSlideMarker { id: Id; timeMs: number; slideId: Id | null; }
/** Independent automation records borrow content; content never owns a clock. */
export type PlaybackSchedule = {
  id: Id;
  itemRef: ItemRef | null;
  enabled: boolean;
} & (
  | { kind: 'slide-timing'; steps: SlideTimingStep[] }
  | { kind: 'audio-sync'; audioAssetId: Id; markers: AudioSlideMarker[] }
);

/** Convert the media playhead in seconds to integer milliseconds. */
export function roundToMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

export function createAudioSlideMarker(timeMs: number): AudioSlideMarker {
  return { id: createId(), timeMs, slideId: null };
}

export function createAudioSyncSchedule(audioAssetId: Id): PlaybackSchedule {
  return {
    id: `audio:${audioAssetId}`,
    itemRef: null,
    enabled: false,
    kind: 'audio-sync',
    audioAssetId,
    markers: [],
  };
}

/** Resolve one destination, including after seeks; never replay skipped cues. */
export function resolveAudioMarker(markers: readonly AudioSlideMarker[], timeMs: number): AudioSlideMarker | null {
  if (!Number.isFinite(timeMs) || timeMs < 0) return null;
  let match: AudioSlideMarker | null = null;
  for (const marker of markers) {
    if (marker.timeMs <= timeMs && (!match || marker.timeMs > match.timeMs)) match = marker;
  }
  return match;
}

export function nextTimedSlide(steps: readonly SlideTimingStep[], slideId: Id): SlideTimingStep | null {
  const index = steps.findIndex(step => step.slideId === slideId);
  return index >= 0 ? steps[index + 1] ?? null : null;
}
