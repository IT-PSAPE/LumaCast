import type { SlideshowImage } from '../shared/desktop-api';

interface SlideshowClock {
  elapsedMs: number;
  activeSince: number | null;
}

const slideshowClocks = new Map<string, SlideshowClock>();

export function slideshowSlideIndex(elapsedMs: number, imageCount: number, intervalSeconds: number, loop: boolean): number {
  if (imageCount < 1) return -1;
  const intervalMs = Math.max(1, intervalSeconds * 1000);
  const step = Math.max(0, Math.floor(Math.max(0, elapsedMs) / intervalMs));
  return loop ? step % imageCount : Math.min(step, imageCount - 1);
}

export function slideshowImageElementKey(sourceId: string, images: SlideshowImage[], slideIndex: number): string {
  const slide = slideIndex >= 0 ? images[slideIndex] : undefined;
  return slide ? `${sourceId}:${slide.assetId}` : sourceId;
}

export function currentSlideshowSlideIndex(
  sourceId: string,
  imageCount: number,
  intervalSeconds: number,
  loop: boolean,
  now = performance.now(),
): number {
  return slideshowSlideIndex(currentSlideshowElapsedMs(sourceId, now), imageCount, intervalSeconds, loop);
}

/** Adds time only while this source is active in Program. Rendering a canvas never starts a clock. */
export function setSlideshowActive(sourceId: string, active: boolean, now = performance.now()): void {
  const existing = slideshowClocks.get(sourceId);
  if (!existing) {
    if (active) slideshowClocks.set(sourceId, { elapsedMs: 0, activeSince: now });
    return;
  }
  if (active === (existing.activeSince !== null)) return;
  if (active) existing.activeSince = now;
  else {
    existing.elapsedMs += Math.max(0, now - existing.activeSince!);
    existing.activeSince = null;
  }
}

export function currentSlideshowElapsedMs(sourceId: string, now = performance.now()): number {
  const clock = slideshowClocks.get(sourceId);
  if (!clock) return 0;
  return clock.elapsedMs + (clock.activeSince === null ? 0 : Math.max(0, now - clock.activeSince));
}

export function forgetSlideshow(sourceId: string): void {
  slideshowClocks.delete(sourceId);
}
