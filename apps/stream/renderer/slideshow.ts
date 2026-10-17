import type { SlideshowImage } from '../shared/desktop-api';

const slideshowStartedAt = new Map<string, number>();

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
  const startedAt = slideshowStartedAt.get(sourceId) ?? now;
  slideshowStartedAt.set(sourceId, startedAt);
  return slideshowSlideIndex(now - startedAt, imageCount, intervalSeconds, loop);
}

export function forgetSlideshow(sourceId: string): void {
  slideshowStartedAt.delete(sourceId);
}
