interface ImageCacheEntry {
  src: string;
  image: HTMLImageElement;
  listeners: Set<(status: 'loaded' | 'error') => void>;
  status: 'loading' | 'loaded' | 'error';
  estimatedBytes: number;
  accessOrder: number;
  // Number of mounted consumers currently holding `image`. Eviction destroys
  // the element in place (`image.src = ''`), and Konva paints that exact
  // object, so evicting a retained entry blanks live thumbnails and canvases.
  // Only entries at zero are eligible.
  refCount: number;
  softPinIds: Set<number>;
  trackedAsEvictable: boolean;
  accounted: boolean;
  detached: boolean;
  evicted: boolean;
  warmRefs: Map<number, WarmImageRef>;
  trackedWarmTier: WarmImageTier | null;
  trackedWarmInFlight: boolean;
  warmEligibleForRetainHit: boolean;
}

export type WarmImageTier = 'T1' | 'T2';
export type WarmImageStatus = 'loading' | 'loaded' | 'broken' | 'evicted';

interface WarmImageRef {
  tier: WarmImageTier;
  graceUntilMs: number | null;
  handleState: WarmImageHandleState;
}

const MAX_ENTRIES = 128;
const MAX_ESTIMATED_BYTES = 96 * 1024 * 1024;

const cache = new Map<string, ImageCacheEntry>();
let entryCount = 0;
let totalEstimatedBytes = 0;
let loadingCount = 0;
let loadedCount = 0;
let errorCount = 0;
let retainedCount = 0;
let evictableEstimatedBytes = 0;
let evictableCount = 0;
let warmTier1Count = 0;
let warmTier2Count = 0;
let warmIssuedCount = 0;
let warmCancelledCount = 0;
let warmWastedCount = 0;
let warmRetainHitCount = 0;
let warmInFlightCount = 0;
const statsListeners = new Set<() => void>();
let nextAccessOrder = 1;
let nextSoftPinId = 1;
let nextWarmRefId = 1;
let nextWarmGraceTimerId: number | null = null;

interface ImageCacheStats {
  entryCount: number;
  totalEstimatedBytes: number;
  loadingCount: number;
  loadedCount: number;
  errorCount: number;
  retainedCount: number;
  evictableCount: number;
  evictableEstimatedBytes: number;
  warmTier1Count: number;
  warmTier2Count: number;
  warmIssuedCount: number;
  warmCancelledCount: number;
  warmWastedCount: number;
  warmRetainHitCount: number;
  warmInFlightCount: number;
}

let cachedStats: ImageCacheStats | null = null;

interface WarmImageHandleState {
  entry: ImageCacheEntry;
  status: WarmImageStatus;
  listeners: Set<() => void>;
}

function invalidateStats() {
  cachedStats = null;
}

function emitStatsChange() {
  invalidateStats();
  for (const listener of statsListeners) {
    listener();
  }
}

function emitWarmHandleState(handleState: WarmImageHandleState, status: WarmImageStatus) {
  if (handleState.status === status) return;
  handleState.status = status;
  for (const listener of handleState.listeners) {
    listener();
  }
}

function touchEntry(entry: ImageCacheEntry) {
  entry.accessOrder = nextAccessOrder++;
}

function promoteEntry(entry: ImageCacheEntry) {
  if (!entry.accounted) return;
  cache.delete(entry.src);
  cache.set(entry.src, entry);
}

function isHardPinned(entry: ImageCacheEntry) {
  return entry.refCount > 0;
}

function isSoftPinned(entry: ImageCacheEntry) {
  return entry.softPinIds.size > 0;
}

function resolveStrongestWarmTier(entry: ImageCacheEntry): WarmImageTier | null {
  let strongest: WarmImageTier | null = null;
  for (const ref of entry.warmRefs.values()) {
    if (ref.tier === 'T1') return 'T1';
    strongest = 'T2';
  }
  return strongest;
}

function resolveWarmGraceUntilMs(entry: ImageCacheEntry): number | null {
  let latestGraceUntilMs: number | null = null;
  for (const ref of entry.warmRefs.values()) {
    if (ref.tier !== 'T1' || ref.graceUntilMs == null) continue;
    if (latestGraceUntilMs == null || ref.graceUntilMs > latestGraceUntilMs) {
      latestGraceUntilMs = ref.graceUntilMs;
    }
  }
  return latestGraceUntilMs;
}

function isWarmProtected(entry: ImageCacheEntry, nowMs: number = Date.now()) {
  if (resolveStrongestWarmTier(entry) !== 'T1') return false;
  const graceUntilMs = resolveWarmGraceUntilMs(entry);
  return graceUntilMs != null && graceUntilMs > nowMs;
}

function warmEvictionPriority(entry: ImageCacheEntry, nowMs: number): number {
  const strongestTier = resolveStrongestWarmTier(entry);
  if (!strongestTier) return 0;
  if (strongestTier === 'T2') return 1;
  return isWarmProtected(entry, nowMs) ? Number.POSITIVE_INFINITY : 2;
}

function adjustStatusCount(status: ImageCacheEntry['status'], delta: 1 | -1) {
  if (status === 'loading') loadingCount += delta;
  else if (status === 'loaded') loadedCount += delta;
  else errorCount += delta;
}

function addLiveEntry(entry: ImageCacheEntry) {
  if (entry.accounted || entry.evicted) return;

  cache.set(entry.src, entry);
  entry.accounted = true;
  entry.detached = false;
  entryCount += 1;
  totalEstimatedBytes += entry.estimatedBytes;
  adjustStatusCount(entry.status, 1);
  if (entry.refCount > 0) retainedCount += 1;
}

function removeLiveEntry(entry: ImageCacheEntry) {
  if (!entry.accounted) return;

  if (cache.get(entry.src) === entry) {
    cache.delete(entry.src);
  }
  entry.accounted = false;
  entryCount -= 1;
  totalEstimatedBytes -= entry.estimatedBytes;
  adjustStatusCount(entry.status, -1);
  if (entry.refCount > 0) retainedCount -= 1;

  if (entry.trackedAsEvictable) {
    entry.trackedAsEvictable = false;
    evictableCount -= 1;
    evictableEstimatedBytes -= entry.estimatedBytes;
  }
}

function updateEvictableMembership(entry: ImageCacheEntry) {
  const isEvictable = entry.accounted
    && !entry.evicted
    && !isHardPinned(entry)
    && !isSoftPinned(entry)
    && !isWarmProtected(entry);
  if (entry.trackedAsEvictable === isEvictable) return;

  if (isEvictable) {
    entry.trackedAsEvictable = true;
    evictableCount += 1;
    evictableEstimatedBytes += entry.estimatedBytes;
    return;
  }

  entry.trackedAsEvictable = false;
  evictableCount -= 1;
  evictableEstimatedBytes -= entry.estimatedBytes;
}

function reconcileWarmTracking(entry: ImageCacheEntry) {
  const nextWarmTier = resolveStrongestWarmTier(entry);
  if (entry.trackedWarmTier !== nextWarmTier) {
    if (entry.trackedWarmTier === 'T1') warmTier1Count -= 1;
    else if (entry.trackedWarmTier === 'T2') warmTier2Count -= 1;

    if (nextWarmTier === 'T1') warmTier1Count += 1;
    else if (nextWarmTier === 'T2') warmTier2Count += 1;

    entry.trackedWarmTier = nextWarmTier;
  }

  const nextWarmInFlight = nextWarmTier !== null && entry.status === 'loading';
  if (entry.trackedWarmInFlight !== nextWarmInFlight) {
    warmInFlightCount += nextWarmInFlight ? 1 : -1;
    entry.trackedWarmInFlight = nextWarmInFlight;
  }
}

function syncWarmGraceTimer() {
  if (nextWarmGraceTimerId !== null) {
    window.clearTimeout(nextWarmGraceTimerId);
    nextWarmGraceTimerId = null;
  }

  const nowMs = Date.now();
  let nextGraceUntilMs: number | null = null;
  for (const entry of cache.values()) {
    if (resolveStrongestWarmTier(entry) !== 'T1') continue;
    const graceUntilMs = resolveWarmGraceUntilMs(entry);
    if (graceUntilMs == null || graceUntilMs <= nowMs) continue;
    if (nextGraceUntilMs == null || graceUntilMs < nextGraceUntilMs) {
      nextGraceUntilMs = graceUntilMs;
    }
  }

  if (nextGraceUntilMs == null) return;
  nextWarmGraceTimerId = window.setTimeout(() => {
    nextWarmGraceTimerId = null;
    for (const entry of cache.values()) {
      if (resolveStrongestWarmTier(entry) !== 'T1') continue;
      updateEvictableMembership(entry);
    }
    emitStatsChange();
    evictIfNeeded();
    syncWarmGraceTimer();
  }, Math.max(0, nextGraceUntilMs - nowMs));
}

function setEntryStatus(entry: ImageCacheEntry, nextStatus: ImageCacheEntry['status']) {
  if (entry.status === nextStatus) return;

  if (entry.accounted) {
    adjustStatusCount(entry.status, -1);
    adjustStatusCount(nextStatus, 1);
  }
  entry.status = nextStatus;
  reconcileWarmTracking(entry);
}

function replaceEntrySize(entry: ImageCacheEntry, nextSize: number) {
  if (entry.evicted) return;

  if (entry.accounted) {
    totalEstimatedBytes += nextSize - entry.estimatedBytes;
    if (entry.trackedAsEvictable) {
      evictableEstimatedBytes += nextSize - entry.estimatedBytes;
    }
  }
  entry.estimatedBytes = nextSize;
  emitStatsChange();
}

function updateRefCount(entry: ImageCacheEntry, delta: number) {
  const wasRetained = entry.refCount > 0;
  entry.refCount += delta;
  const isRetained = entry.refCount > 0;
  if (entry.accounted && wasRetained !== isRetained) {
    retainedCount += isRetained ? 1 : -1;
  }
  updateEvictableMembership(entry);
}

function clearSoftPin(entry: ImageCacheEntry, softPinId: number) {
  if (!entry.softPinIds.delete(softPinId)) return;
  updateEvictableMembership(entry);
  emitStatsChange();
  if (entry.accounted && !entry.evicted && entry.refCount === 0 && entry.softPinIds.size === 0) {
    evictIfNeeded();
  }
}

function addSoftPin(entry: ImageCacheEntry) {
  const softPinId = nextSoftPinId++;
  const hadSoftPin = entry.softPinIds.size > 0;
  entry.softPinIds.add(softPinId);
  if (!hadSoftPin) {
    updateEvictableMembership(entry);
    emitStatsChange();
  }
  return softPinId;
}

function recordWarmOutcome(entry: ImageCacheEntry, outcome: 'cancelled' | 'wasted' | 'cleared') {
  if (!entry.warmEligibleForRetainHit) return;
  if (outcome === 'cancelled') warmCancelledCount += 1;
  else if (outcome === 'wasted') warmWastedCount += 1;
  entry.warmEligibleForRetainHit = false;
}

function clearWarmRefs(entry: ImageCacheEntry, outcome: 'cancelled' | 'wasted' | 'cleared') {
  if (entry.warmRefs.size === 0 && !entry.trackedWarmInFlight && entry.trackedWarmTier === null) {
    recordWarmOutcome(entry, outcome);
    return;
  }
  for (const ref of entry.warmRefs.values()) {
    emitWarmHandleState(ref.handleState, 'evicted');
  }
  entry.warmRefs.clear();
  reconcileWarmTracking(entry);
  updateEvictableMembership(entry);
  recordWarmOutcome(entry, outcome);
  syncWarmGraceTimer();
}

function consumeSoftPin(entry: ImageCacheEntry) {
  const softPinId = entry.softPinIds.values().next().value as number | undefined;
  if (softPinId === undefined) return;
  clearSoftPin(entry, softPinId);
}

function destroyEntry(entry: ImageCacheEntry, warmOutcome: 'cancelled' | 'wasted' | 'cleared' = entry.status === 'loading' ? 'cancelled' : 'cleared') {
  if (entry.evicted) return;

  clearWarmRefs(entry, warmOutcome);
  removeLiveEntry(entry);
  entry.detached = false;
  entry.evicted = true;
  entry.softPinIds.clear();
  entry.listeners.clear();
  entry.image.removeAttribute('src');
  emitStatsChange();
}

function detachLoadedEntry(entry: ImageCacheEntry) {
  if (entry.evicted || !entry.accounted) return;

  clearWarmRefs(entry, 'wasted');
  removeLiveEntry(entry);
  entry.detached = true;
  emitStatsChange();
}

function reviveDetachedEntry(entry: ImageCacheEntry) {
  if (entry.evicted || !entry.detached || cache.has(entry.src)) return false;

  addLiveEntry(entry);
  updateEvictableMembership(entry);
  emitStatsChange();
  return true;
}

function createEntry(src: string): ImageCacheEntry {
  const image = new Image();
  image.crossOrigin = 'anonymous';

  const entry: ImageCacheEntry = {
    src,
    image,
    listeners: new Set(),
    status: 'loading',
    estimatedBytes: 0,
    accessOrder: 0,
    refCount: 0,
    softPinIds: new Set(),
    trackedAsEvictable: false,
    accounted: false,
    detached: false,
    evicted: false,
    warmRefs: new Map(),
    trackedWarmTier: null,
    trackedWarmInFlight: false,
    warmEligibleForRetainHit: false,
  };
  touchEntry(entry);

  function notify(status: 'loaded' | 'error') {
    if (entry.evicted) return;
    setEntryStatus(entry, status);
    touchEntry(entry);
    if (entry.accounted) promoteEntry(entry);
    emitStatsChange();
    const warmStatus: WarmImageStatus = status === 'loaded' ? 'loaded' : 'broken';
    for (const ref of entry.warmRefs.values()) {
      emitWarmHandleState(ref.handleState, warmStatus);
    }
    for (const listener of entry.listeners) {
      listener(status);
    }
  }

  image.addEventListener('error', () => {
    replaceEntrySize(entry, 0);
    notify('error');
  });
  image.src = src;

  image.decode().then(() => {
    replaceEntrySize(entry, Math.max(0, image.naturalWidth * image.naturalHeight * 4));
    notify('loaded');
    evictIfNeeded();
  }).catch(() => {
    replaceEntrySize(entry, 0);
    notify('error');
  });

  if (image.complete) {
    setEntryStatus(entry, image.naturalWidth > 0 ? 'loaded' : 'error');
    entry.estimatedBytes = entry.status === 'loaded'
      ? Math.max(0, image.naturalWidth * image.naturalHeight * 4)
      : 0;
  }

  return entry;
}

function evictIfNeeded() {
  for (const entry of cache.values()) {
    if (entry.trackedWarmTier === 'T1') {
      updateEvictableMembership(entry);
    }
  }
  if (evictableCount <= MAX_ENTRIES && evictableEstimatedBytes <= MAX_ESTIMATED_BYTES) return;
  if (evictableCount === 0) return;

  const nowMs = Date.now();
  const candidates = [...cache.entries()]
    .filter(([_key, entry]) => entry.accounted && !entry.evicted && entry.refCount === 0 && !isSoftPinned(entry) && !isWarmProtected(entry, nowMs))
    .sort((left, right) => {
      const [, leftEntry] = left;
      const [, rightEntry] = right;
      const leftWarmPriority = warmEvictionPriority(leftEntry, nowMs);
      const rightWarmPriority = warmEvictionPriority(rightEntry, nowMs);
      if (leftWarmPriority !== rightWarmPriority) {
        return leftWarmPriority - rightWarmPriority;
      }
      if (leftEntry.accessOrder !== rightEntry.accessOrder) {
        return leftEntry.accessOrder - rightEntry.accessOrder;
      }
      if (leftEntry.status !== rightEntry.status) {
        const leftPriority = leftEntry.status === 'error' ? 0 : leftEntry.status === 'loaded' ? 1 : 2;
        const rightPriority = rightEntry.status === 'error' ? 0 : rightEntry.status === 'loaded' ? 1 : 2;
        return leftPriority - rightPriority;
      }
      return 0;
    });

  for (const [, entry] of candidates) {
    if (evictableCount <= MAX_ENTRIES && evictableEstimatedBytes <= MAX_ESTIMATED_BYTES) break;
    if (entry.status === 'loaded') {
      if (entry.trackedWarmTier !== null || entry.warmRefs.size > 0) {
        destroyEntry(entry, 'wasted');
      } else {
        detachLoadedEntry(entry);
      }
      continue;
    }
    destroyEntry(entry);
  }
}

function acquireEntry(src: string): ImageCacheEntry {
  const existing = cache.get(src);
  if (existing) {
    touchEntry(existing);
    promoteEntry(existing);
    return existing;
  }

  const next = createEntry(src);
  addLiveEntry(next);
  updateEvictableMembership(next);
  promoteEntry(next);
  emitStatsChange();
  return next;
}

export interface ImageHandle {
  entry: ImageCacheEntry;
  release(): void;
}

export interface ImageReservationHandle {
  entry: ImageCacheEntry;
  release(): void;
}

export interface WarmImageHandle {
  entry: ImageCacheEntry;
  getStatus(): WarmImageStatus;
  subscribe(listener: () => void): () => void;
  setOptions(options: WarmImageOptions): void;
  release(): void;
}

export interface WarmImageOptions {
  tier: WarmImageTier;
  graceMs?: number;
}

export function peekImageEntry(src: string): ImageCacheEntry | null {
  return cache.get(src) ?? null;
}

export function reserveImageEntry(entry: ImageCacheEntry): ImageReservationHandle | null {
  if (entry.evicted) return null;

  const liveEntry = cache.get(entry.src);
  if (liveEntry && liveEntry !== entry) return null;
  if (!entry.accounted && !reviveDetachedEntry(entry)) return null;

  touchEntry(entry);
  promoteEntry(entry);
  const softPinId = addSoftPin(entry);
  let released = false;
  return {
    entry,
    release() {
      if (released) return;
      released = true;
      clearSoftPin(entry, softPinId);
    },
  };
}

export function warmImage(src: string, options: WarmImageOptions): WarmImageHandle {
  const entry = acquireEntry(src);
  const warmRefId = nextWarmRefId++;
  const handleState: WarmImageHandleState = {
    entry,
    status: entry.status === 'loaded' ? 'loaded' : entry.status === 'error' ? 'broken' : 'loading',
    listeners: new Set(),
  };
  const resolveGraceUntilMs = (nextOptions: WarmImageOptions) => {
    const graceMs = nextOptions.tier === 'T1' ? Math.max(0, nextOptions.graceMs ?? 0) : 0;
    return nextOptions.tier === 'T1' ? Date.now() + graceMs : null;
  };
  warmIssuedCount += 1;
  entry.warmRefs.set(warmRefId, {
    tier: options.tier,
    graceUntilMs: resolveGraceUntilMs(options),
    handleState,
  });
  if (entry.refCount === 0) {
    entry.warmEligibleForRetainHit = true;
  }
  reconcileWarmTracking(entry);
  updateEvictableMembership(entry);
  touchEntry(entry);
  promoteEntry(entry);
  syncWarmGraceTimer();
  emitStatsChange();
  evictIfNeeded();

  let released = false;
  return {
    entry,
    getStatus() {
      return handleState.status;
    },
    subscribe(listener: () => void) {
      handleState.listeners.add(listener);
      return () => {
        handleState.listeners.delete(listener);
      };
    },
    setOptions(nextOptions: WarmImageOptions) {
      if (released) return;
      const ref = entry.warmRefs.get(warmRefId);
      if (!ref) return;
      ref.tier = nextOptions.tier;
      ref.graceUntilMs = resolveGraceUntilMs(nextOptions);
      reconcileWarmTracking(entry);
      updateEvictableMembership(entry);
      syncWarmGraceTimer();
      emitStatsChange();
      evictIfNeeded();
    },
    release() {
      if (released) return;
      released = true;
      if (!entry.warmRefs.delete(warmRefId)) return;
      reconcileWarmTracking(entry);
      updateEvictableMembership(entry);
      syncWarmGraceTimer();
      emitStatsChange();
      if (entry.evicted) return;
      if (entry.refCount === 0 && entry.softPinIds.size === 0 && entry.warmRefs.size === 0) {
        destroyEntry(entry, entry.status === 'loading' ? 'cancelled' : 'cleared');
        return;
      }
      if (entry.accounted && entry.refCount === 0 && entry.softPinIds.size === 0) {
        evictIfNeeded();
      }
    },
  };
}

export function retainImage(src: string): ImageHandle {
  const entry = acquireEntry(src);
  if (entry.refCount === 0 && entry.warmEligibleForRetainHit) {
    warmRetainHitCount += 1;
    entry.warmEligibleForRetainHit = false;
  }
  updateRefCount(entry, 1);
  consumeSoftPin(entry);
  emitStatsChange();
  evictIfNeeded();

  let released = false;
  return {
    entry,
    release() {
      if (released) return;
      released = true;
      updateRefCount(entry, -1);
      touchEntry(entry);
      promoteEntry(entry);
      emitStatsChange();
      if (entry.refCount === 0) evictIfNeeded();
    },
  };
}

export function getImageCacheStats(): ImageCacheStats {
  if (cachedStats) return cachedStats;

  cachedStats = {
    entryCount,
    totalEstimatedBytes,
    loadingCount,
    loadedCount,
    errorCount,
    retainedCount,
    evictableCount,
    evictableEstimatedBytes,
    warmTier1Count,
    warmTier2Count,
    warmIssuedCount,
    warmCancelledCount,
    warmWastedCount,
    warmRetainHitCount,
    warmInFlightCount,
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
