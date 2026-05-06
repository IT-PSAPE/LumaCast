interface ImageCacheEntry {
  image: HTMLImageElement;
  listeners: Set<(status: 'loaded' | 'error') => void>;
  status: 'loading' | 'loaded' | 'error';
  estimatedBytes: number;
  lastAccessedAt: number;
}

const MAX_ENTRIES = 128;
const MAX_ESTIMATED_BYTES = 96 * 1024 * 1024;

const cache = new Map<string, ImageCacheEntry>();
let totalEstimatedBytes = 0;
const statsListeners = new Set<() => void>();

interface ImageCacheStats {
  entryCount: number;
  totalEstimatedBytes: number;
  loadingCount: number;
  loadedCount: number;
  errorCount: number;
}

// Cache the latest snapshot so `getImageCacheStats` returns a stable reference
// when nothing has changed. `useSyncExternalStore` compares snapshots by
// Object.is, so allocating a fresh object on every call would re-render
// indefinitely. We invalidate the cache whenever any state-affecting mutation
// fires.
let cachedStats: ImageCacheStats | null = null;

function invalidateStats() {
  cachedStats = null;
}

function emitStatsChange() {
  invalidateStats();
  for (const listener of statsListeners) {
    listener();
  }
}

function touchEntry(entry: ImageCacheEntry) {
  entry.lastAccessedAt = Date.now();
}

function replaceEntrySize(entry: ImageCacheEntry, nextSize: number) {
  totalEstimatedBytes += nextSize - entry.estimatedBytes;
  entry.estimatedBytes = nextSize;
  emitStatsChange();
}

function createEntry(src: string): ImageCacheEntry {
  const image = new Image();
  image.crossOrigin = 'anonymous';

  const entry: ImageCacheEntry = {
    image,
    listeners: new Set(),
    status: 'loading',
    estimatedBytes: 0,
    lastAccessedAt: Date.now(),
  };

  function notify(status: 'loaded' | 'error') {
    entry.status = status;
    touchEntry(entry);
    emitStatsChange();
    for (const listener of entry.listeners) {
      listener(status);
    }
  }

  image.addEventListener('error', () => {
    replaceEntrySize(entry, 0);
    notify('error');
  });
  image.src = src;

  // image.decode() performs the decode off the main thread and resolves once
  // the bitmap is ready to paint without further work. This avoids the
  // synchronous decode pause that the 'load' event historically triggers.
  image.decode().then(() => {
    replaceEntrySize(entry, Math.max(0, image.naturalWidth * image.naturalHeight * 4));
    notify('loaded');
    evictIfNeeded();
  }).catch(() => {
    replaceEntrySize(entry, 0);
    notify('error');
  });

  if (image.complete) {
    entry.status = image.naturalWidth > 0 ? 'loaded' : 'error';
    replaceEntrySize(entry, entry.status === 'loaded' ? Math.max(0, image.naturalWidth * image.naturalHeight * 4) : 0);
  }

  return entry;
}

function evictIfNeeded() {
  if (cache.size <= MAX_ENTRIES && totalEstimatedBytes <= MAX_ESTIMATED_BYTES) return;

  const candidates = [...cache.entries()]
    .filter(([_key, entry]) => entry.listeners.size === 0)
    .sort((left, right) => {
      const [, leftEntry] = left;
      const [, rightEntry] = right;
      if (leftEntry.status !== rightEntry.status) {
        const leftPriority = leftEntry.status === 'error' ? 0 : leftEntry.status === 'loading' ? 1 : 2;
        const rightPriority = rightEntry.status === 'error' ? 0 : rightEntry.status === 'loading' ? 1 : 2;
        return leftPriority - rightPriority;
      }
      return leftEntry.lastAccessedAt - rightEntry.lastAccessedAt;
    });

  for (const [key, entry] of candidates) {
    if (cache.size <= MAX_ENTRIES && totalEstimatedBytes <= MAX_ESTIMATED_BYTES) break;
    totalEstimatedBytes -= entry.estimatedBytes;
    entry.image.src = '';
    cache.delete(key);
    emitStatsChange();
  }
}

export function getImageCacheEntry(src: string): ImageCacheEntry {
  const existing = cache.get(src);
  if (existing) {
    touchEntry(existing);
    cache.delete(src);
    cache.set(src, existing);
    return existing;
  }

  const next = createEntry(src);
  cache.set(src, next);
  emitStatsChange();
  evictIfNeeded();
  return next;
}

export function getImageCacheStats(): ImageCacheStats {
  if (cachedStats) return cachedStats;

  let loadingCount = 0;
  let loadedCount = 0;
  let errorCount = 0;

  for (const entry of cache.values()) {
    if (entry.status === 'loading') loadingCount += 1;
    else if (entry.status === 'loaded') loadedCount += 1;
    else errorCount += 1;
  }

  cachedStats = {
    entryCount: cache.size,
    totalEstimatedBytes,
    loadingCount,
    loadedCount,
    errorCount,
  };
  return cachedStats;
}

export function subscribeImageCacheStats(listener: () => void): () => void {
  statsListeners.add(listener);
  return () => {
    statsListeners.delete(listener);
  };
}

export type { ImageCacheEntry };
