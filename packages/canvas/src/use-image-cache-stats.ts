import { useSyncExternalStore } from 'react';
import { getImageCacheStats, subscribeImageCacheStats } from './image-cache';

export function useImageCacheStats() {
  return useSyncExternalStore(
    subscribeImageCacheStats,
    getImageCacheStats,
    getImageCacheStats,
  );
}
