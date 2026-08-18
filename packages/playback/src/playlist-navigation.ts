import type { Id } from '@lumacast/kernel';

// Pure "take next/previous" adjacency over an ordered asset list, keyed by
// id. Two variants exist because the audio and video transports in the
// playback provider disagree, by design, on what happens when nothing is
// currently armed:
//  - Audio requires a current selection (no-op with nothing armed).
//  - Video tolerates no current selection (starting from either end,
//    depending on direction), so "next"/"previous" work as a cold start.
// Both are otherwise identical wrap-around index arithmetic.

export function resolveAdjacentAssetRequiringCurrent<T extends { id: Id }>(
  assets: readonly T[],
  currentId: Id | null,
  direction: 1 | -1,
): T | null {
  if (!currentId || assets.length === 0) return null;
  const currentIndex = assets.findIndex((asset) => asset.id === currentId);
  if (currentIndex < 0) return null;
  const nextIndex = (currentIndex + direction + assets.length) % assets.length;
  return assets[nextIndex] ?? null;
}

export function resolveAdjacentAssetAllowingUnset<T extends { id: Id }>(
  assets: readonly T[],
  currentId: Id | null,
  direction: 1 | -1,
): T | null {
  if (assets.length === 0) return null;
  const currentIndex = currentId ? assets.findIndex((asset) => asset.id === currentId) : -1;
  const baseIndex = currentIndex < 0 ? (direction === 1 ? -1 : 0) : currentIndex;
  const nextIndex = (baseIndex + direction + assets.length) % assets.length;
  return assets[nextIndex] ?? null;
}
