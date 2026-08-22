import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ResolvedMediaState } from '@lumacast/composition';

interface UseKVideoOptions {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
}

type VideoEntryStatus = 'loading' | 'broken' | 'loaded';

interface LayerEntry {
  src: string;
  video: HTMLVideoElement;
  status: VideoEntryStatus;
  refCount: number;
  warmRefCount: number;
  options: UseKVideoOptions;
  cleanup: () => void;
  lastUsedOrder: number;
}

interface WarmClaimEntry {
  claimKey: string;
  src: string;
  video: HTMLVideoElement;
  status: VideoEntryStatus;
  cleanup: () => void;
  consumed: boolean;
  lastUsedOrder: number;
}

interface TrackedVideoState {
  src: string | null;
  media: ResolvedMediaState;
}

const RETIRED_LAYER_LIMIT = 2;
const RETIRED_CLAIM_LIMIT = 2;

const layerRegistry = new Map<string, LayerEntry>();
const retiredLayerRegistry = new Map<string, LayerEntry>();
const pendingWarmClaims = new Map<string, WarmClaimEntry>();
const retiredWarmClaims = new Map<string, WarmClaimEntry>();
const layerListeners = new Set<() => void>();
const instanceRegistry = new Map<number, HTMLVideoElement>();
const instanceStatuses = new Map<number, VideoEntryStatus>();
const detachedInstanceIds = new WeakMap<HTMLVideoElement, number>();
const pendingConsumedClaimCleanup = new Map<HTMLVideoElement, number>();
let nextVideoInstanceId = 0;
let nextVideoAccessOrder = 1;

let warmIssuedCount = 0;
let warmHitCount = 0;
let warmMissCount = 0;
let warmWastedCount = 0;

export interface VideoPoolStats {
  layerVideoCount: number;
  layerLoadedCount: number;
  layerPlayingCount: number;
  detachedVideoCount: number;
  detachedLoadedCount: number;
  detachedPlayingCount: number;
  warmResidentCount: number;
  warmInflightCount: number;
  warmIssuedCount: number;
  warmHitCount: number;
  warmMissCount: number;
  warmWastedCount: number;
}

let currentVideoPoolStats: VideoPoolStats = {
  layerVideoCount: 0,
  layerLoadedCount: 0,
  layerPlayingCount: 0,
  detachedVideoCount: 0,
  detachedLoadedCount: 0,
  detachedPlayingCount: 0,
  warmResidentCount: 0,
  warmInflightCount: 0,
  warmIssuedCount: 0,
  warmHitCount: 0,
  warmMissCount: 0,
  warmWastedCount: 0,
};

function nextAccessOrder() {
  const next = nextVideoAccessOrder;
  nextVideoAccessOrder += 1;
  return next;
}

function isPlaying(video: HTMLVideoElement) {
  return !video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
}

function shallowEqualStats(left: VideoPoolStats, right: VideoPoolStats) {
  return left.layerVideoCount === right.layerVideoCount
    && left.layerLoadedCount === right.layerLoadedCount
    && left.layerPlayingCount === right.layerPlayingCount
    && left.detachedVideoCount === right.detachedVideoCount
    && left.detachedLoadedCount === right.detachedLoadedCount
    && left.detachedPlayingCount === right.detachedPlayingCount
    && left.warmResidentCount === right.warmResidentCount
    && left.warmInflightCount === right.warmInflightCount
    && left.warmIssuedCount === right.warmIssuedCount
    && left.warmHitCount === right.warmHitCount
    && left.warmMissCount === right.warmMissCount
    && left.warmWastedCount === right.warmWastedCount;
}

function computeVideoPoolStats(): VideoPoolStats {
  let layerLoadedCount = 0;
  let layerPlayingCount = 0;
  let nextWarmResidentCount = 0;
  let nextWarmInflightCount = 0;
  for (const entry of layerRegistry.values()) {
    if (entry.status === 'loaded') layerLoadedCount += 1;
    if (isPlaying(entry.video)) layerPlayingCount += 1;
    if (entry.refCount === 0 && entry.warmRefCount > 0) {
      if (entry.status === 'loaded') nextWarmResidentCount += 1;
      else if (entry.status === 'loading') nextWarmInflightCount += 1;
    }
  }
  for (const entry of retiredLayerRegistry.values()) {
    if (entry.status === 'loaded') nextWarmResidentCount += 1;
    else if (entry.status === 'loading') nextWarmInflightCount += 1;
  }

  let detachedLoadedCount = 0;
  let detachedPlayingCount = 0;
  for (const [instanceId, video] of instanceRegistry) {
    if (instanceStatuses.get(instanceId) === 'loaded') detachedLoadedCount += 1;
    if (isPlaying(video)) detachedPlayingCount += 1;
  }
  for (const entry of pendingWarmClaims.values()) {
    if (entry.consumed) continue;
    if (entry.status === 'loaded') nextWarmResidentCount += 1;
    else if (entry.status === 'loading') nextWarmInflightCount += 1;
  }
  for (const entry of retiredWarmClaims.values()) {
    if (entry.consumed) continue;
    if (entry.status === 'loaded') nextWarmResidentCount += 1;
    else if (entry.status === 'loading') nextWarmInflightCount += 1;
  }

  return {
    layerVideoCount: layerRegistry.size,
    layerLoadedCount,
    layerPlayingCount,
    detachedVideoCount: instanceRegistry.size,
    detachedLoadedCount,
    detachedPlayingCount,
    warmResidentCount: nextWarmResidentCount,
    warmInflightCount: nextWarmInflightCount,
    warmIssuedCount,
    warmHitCount,
    warmMissCount,
    warmWastedCount,
  };
}

function notifyLayerListeners() {
  const nextStats = computeVideoPoolStats();
  if (shallowEqualStats(currentVideoPoolStats, nextStats)) return;
  currentVideoPoolStats = nextStats;
  layerListeners.forEach((listener) => { listener(); });
}

function registerDetachedInstance(video: HTMLVideoElement, status: VideoEntryStatus): number {
  const existing = detachedInstanceIds.get(video);
  if (existing != null) {
    instanceStatuses.set(existing, status);
    notifyLayerListeners();
    return existing;
  }
  nextVideoInstanceId += 1;
  const instanceId = nextVideoInstanceId;
  detachedInstanceIds.set(video, instanceId);
  instanceRegistry.set(instanceId, video);
  instanceStatuses.set(instanceId, status);
  notifyLayerListeners();
  return instanceId;
}

function unregisterDetachedInstance(video: HTMLVideoElement) {
  const instanceId = detachedInstanceIds.get(video);
  if (instanceId == null) return;
  detachedInstanceIds.delete(video);
  instanceRegistry.delete(instanceId);
  instanceStatuses.delete(instanceId);
  notifyLayerListeners();
}

function cancelConsumedClaimCleanup(video: HTMLVideoElement) {
  const timerId = pendingConsumedClaimCleanup.get(video);
  if (timerId == null) return;
  pendingConsumedClaimCleanup.delete(video);
  window.clearTimeout(timerId);
}

export function subscribeToVideoPool(listener: () => void): () => void {
  layerListeners.add(listener);
  return () => { layerListeners.delete(listener); };
}

export function getVideoPoolStats(): VideoPoolStats {
  return currentVideoPoolStats;
}

function createVideoElement(src: string, options: UseKVideoOptions, preload: 'metadata' | 'auto'): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.autoplay = options.autoplay;
  video.loop = options.loop;
  video.muted = options.muted;
  video.playbackRate = options.playbackRate;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = preload;
  return video;
}

function destroyVideoElement(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function applyVideoOptions(video: HTMLVideoElement, options: UseKVideoOptions) {
  video.loop = options.loop;
  if (video.muted !== options.muted) video.muted = options.muted;
  if (video.playbackRate !== options.playbackRate) video.playbackRate = options.playbackRate;
  if (options.autoplay) {
    if (video.paused) void video.play().catch(() => undefined);
    notifyLayerListeners();
    return;
  }
  if (!video.paused) video.pause();
  notifyLayerListeners();
}

function seekVideoToStart(video: HTMLVideoElement) {
  try {
    video.pause();
    if (video.currentTime !== 0) {
      video.currentTime = 0;
    }
  } catch {
    // Ignore seek failures before metadata.
  }
}

function attachEntryListeners<T extends { status: VideoEntryStatus; video: HTMLVideoElement; cleanup: () => void; lastUsedOrder: number }>(
  entry: T,
  onStatusChange: (nextStatus: VideoEntryStatus) => void,
  onPlaybackStateChange?: () => void,
) {
  const handleReady = () => {
    if (entry.status === 'loaded') return;
    entry.status = 'loaded';
    entry.lastUsedOrder = nextAccessOrder();
    onStatusChange('loaded');
  };
  const handleError = () => {
    if (entry.status === 'broken') return;
    entry.status = 'broken';
    entry.lastUsedOrder = nextAccessOrder();
    onStatusChange('broken');
  };
  const handlePlayback = () => {
    entry.lastUsedOrder = nextAccessOrder();
    onPlaybackStateChange?.();
  };

  entry.video.addEventListener('loadeddata', handleReady);
  entry.video.addEventListener('error', handleError);
  entry.video.addEventListener('play', handlePlayback);
  entry.video.addEventListener('pause', handlePlayback);
  entry.video.addEventListener('ended', handlePlayback);
  entry.cleanup = () => {
    entry.video.removeEventListener('loadeddata', handleReady);
    entry.video.removeEventListener('error', handleError);
    entry.video.removeEventListener('play', handlePlayback);
    entry.video.removeEventListener('pause', handlePlayback);
    entry.video.removeEventListener('ended', handlePlayback);
    destroyVideoElement(entry.video);
  };

  if (entry.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    entry.status = 'loaded';
    onStatusChange('loaded');
  } else {
    entry.video.load();
  }
}

function trimRetiredLayerRegistry() {
  while (retiredLayerRegistry.size > RETIRED_LAYER_LIMIT) {
    const oldest = [...retiredLayerRegistry.values()].sort((left, right) => left.lastUsedOrder - right.lastUsedOrder)[0];
    if (!oldest) return;
    retiredLayerRegistry.delete(oldest.src);
    oldest.cleanup();
    warmWastedCount += 1;
    notifyLayerListeners();
  }
}

function trimRetiredClaimRegistry() {
  while (retiredWarmClaims.size > RETIRED_CLAIM_LIMIT) {
    const oldest = [...retiredWarmClaims.values()].sort((left, right) => left.lastUsedOrder - right.lastUsedOrder)[0];
    if (!oldest) return;
    retiredWarmClaims.delete(oldest.claimKey);
    oldest.cleanup();
    warmWastedCount += 1;
  }
  notifyLayerListeners();
}

function trimCombinedWarmClaimBudget() {
  const entries = [
    ...[...pendingWarmClaims.values()].map((entry) => ({ registry: pendingWarmClaims, entry })),
    ...[...retiredWarmClaims.values()].map((entry) => ({ registry: retiredWarmClaims, entry })),
  ]
    .filter(({ entry }) => !entry.consumed)
    .sort((left, right) => left.entry.lastUsedOrder - right.entry.lastUsedOrder);

  while (entries.length > RETIRED_CLAIM_LIMIT) {
    const oldest = entries.shift();
    if (!oldest) break;
    oldest.registry.delete(oldest.entry.claimKey);
    oldest.entry.cleanup();
    warmWastedCount += 1;
  }
  notifyLayerListeners();
}

function makeLayerEntry(src: string, options: UseKVideoOptions, warm: boolean): LayerEntry {
  const entry: LayerEntry = {
    src,
    video: createVideoElement(src, options, warm ? 'auto' : 'metadata'),
    status: 'loading',
    refCount: 0,
    warmRefCount: 0,
    options,
    cleanup: () => undefined,
    lastUsedOrder: nextAccessOrder(),
  };
  attachEntryListeners(entry, (nextStatus) => {
    if (entry.refCount === 0 && entry.warmRefCount > 0 && nextStatus === 'loaded') {
      seekVideoToStart(entry.video);
    }
    notifyLayerListeners();
  }, notifyLayerListeners);
  return entry;
}

function reviveRetiredLayerEntry(src: string): LayerEntry | undefined {
  const retired = retiredLayerRegistry.get(src);
  if (!retired) return undefined;
  retiredLayerRegistry.delete(src);
  retired.lastUsedOrder = nextAccessOrder();
  return retired;
}

function makeWarmClaimEntry(claimKey: string, src: string): WarmClaimEntry {
  const entry: WarmClaimEntry = {
    claimKey,
    src,
    video: createVideoElement(src, { autoplay: false, loop: false, muted: true, playbackRate: 1 }, 'auto'),
    status: 'loading',
    cleanup: () => undefined,
    consumed: false,
    lastUsedOrder: nextAccessOrder(),
  };
  attachEntryListeners(entry, (nextStatus) => {
    if (nextStatus === 'loaded') {
      seekVideoToStart(entry.video);
    }
    notifyLayerListeners();
  });
  return entry;
}

function reviveWarmClaimEntry(claimKey: string, src: string): WarmClaimEntry | undefined {
  const retired = retiredWarmClaims.get(claimKey);
  if (!retired || retired.src !== src) return undefined;
  retiredWarmClaims.delete(claimKey);
  retired.lastUsedOrder = nextAccessOrder();
  return retired;
}

function maybeRetireLayerEntry(entry: LayerEntry) {
  if (entry.refCount > 0 || entry.warmRefCount > 0) return;
  layerRegistry.delete(entry.src);
  if (entry.status === 'loaded') {
    seekVideoToStart(entry.video);
    retiredLayerRegistry.set(entry.src, entry);
    trimRetiredLayerRegistry();
    notifyLayerListeners();
    return;
  }
  entry.cleanup();
  notifyLayerListeners();
}

function maybeRetireWarmClaim(entry: WarmClaimEntry) {
  pendingWarmClaims.delete(entry.claimKey);
  if (entry.consumed) return;
  if (entry.status === 'loaded') {
    seekVideoToStart(entry.video);
    retiredWarmClaims.set(entry.claimKey, entry);
    trimRetiredClaimRegistry();
    return;
  }
  entry.cleanup();
  notifyLayerListeners();
}

export function getLayerVideoElement(src: string | null): HTMLVideoElement | null {
  if (!src) return null;
  const entry = layerRegistry.get(src);
  if (!entry || entry.status !== 'loaded' || entry.refCount === 0) return null;
  return entry.video;
}

function peekLayerEntry(src: string | null): LayerEntry | null {
  if (!src) return null;
  return layerRegistry.get(src) ?? retiredLayerRegistry.get(src) ?? null;
}

function peekWarmClaimEntry(claimKey: string | null | undefined, src: string | null): WarmClaimEntry | null {
  if (!claimKey || !src) return null;
  const pending = pendingWarmClaims.get(claimKey);
  if (pending && pending.src === src && !pending.consumed) return pending;
  const retired = retiredWarmClaims.get(claimKey);
  if (retired && retired.src === src && !retired.consumed) return retired;
  return null;
}

function consumeWarmClaimEntry(claimKey: string, src: string, expected: WarmClaimEntry | null): WarmClaimEntry | null {
  const pending = pendingWarmClaims.get(claimKey);
  if (pending && pending === expected && pending.src === src && !pending.consumed) {
    pending.consumed = true;
    pendingWarmClaims.delete(claimKey);
    warmHitCount += 1;
    seekVideoToStart(pending.video);
    notifyLayerListeners();
    return pending;
  }
  const retired = retiredWarmClaims.get(claimKey);
  if (retired && retired === expected && retired.src === src && !retired.consumed) {
    retired.consumed = true;
    retiredWarmClaims.delete(claimKey);
    warmHitCount += 1;
    seekVideoToStart(retired.video);
    notifyLayerListeners();
    return retired;
  }
  warmMissCount += 1;
  notifyLayerListeners();
  return null;
}

export interface VideoLayerHandle {
  release(): void;
  setOptions(options: UseKVideoOptions): void;
}

export interface WarmVideoHandle {
  mediaKey: string;
  release(): void;
}

export function retainVideoSource(src: string, initialOptions: UseKVideoOptions): VideoLayerHandle {
  let entry = layerRegistry.get(src);
  let reusedWarm = false;
  if (!entry) {
    entry = reviveRetiredLayerEntry(src);
    if (entry) {
      reusedWarm = true;
    }
  }
  if (!entry) {
    entry = makeLayerEntry(src, initialOptions, false);
    warmMissCount += 1;
    layerRegistry.set(src, entry);
  } else {
    if (!layerRegistry.has(src)) layerRegistry.set(src, entry);
    reusedWarm = reusedWarm || entry.warmRefCount > 0;
    seekVideoToStart(entry.video);
  }
  if (reusedWarm) warmHitCount += 1;
  entry.refCount += 1;
  entry.options = initialOptions;
  entry.lastUsedOrder = nextAccessOrder();
  applyVideoOptions(entry.video, initialOptions);
  notifyLayerListeners();

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      entry.refCount -= 1;
      entry.lastUsedOrder = nextAccessOrder();
      if (entry.refCount === 0) {
        seekVideoToStart(entry.video);
      }
      maybeRetireLayerEntry(entry);
      notifyLayerListeners();
    },
    setOptions(next) {
      if (released) return;
      entry.options = next;
      applyVideoOptions(entry.video, next);
    },
  };
}

export function warmVideoSource(src: string): WarmVideoHandle {
  let entry = layerRegistry.get(src);
  if (!entry) {
    entry = reviveRetiredLayerEntry(src);
  }
  if (!entry) {
    entry = makeLayerEntry(src, { autoplay: false, loop: false, muted: true, playbackRate: 1 }, true);
    layerRegistry.set(src, entry);
  }
  warmIssuedCount += 1;
  entry.warmRefCount += 1;
  entry.lastUsedOrder = nextAccessOrder();
  seekVideoToStart(entry.video);
  notifyLayerListeners();

  let released = false;
  return {
    mediaKey: src,
    release() {
      if (released) return;
      released = true;
      entry.warmRefCount -= 1;
      entry.lastUsedOrder = nextAccessOrder();
      if (entry.warmRefCount === 0 && entry.refCount === 0) {
        maybeRetireLayerEntry(entry);
      } else {
        notifyLayerListeners();
      }
    },
  };
}

export function warmVideoClaim(claimKey: string, src: string): WarmVideoHandle {
  let entry = pendingWarmClaims.get(claimKey);
  if (!entry || entry.src !== src || entry.consumed) {
    entry = reviveWarmClaimEntry(claimKey, src);
  }
  if (!entry || entry.src !== src || entry.consumed) {
    entry = makeWarmClaimEntry(claimKey, src);
  }
  entry.consumed = false;
  entry.lastUsedOrder = nextAccessOrder();
  pendingWarmClaims.set(claimKey, entry);
  warmIssuedCount += 1;
  trimCombinedWarmClaimBudget();
  notifyLayerListeners();

  let released = false;
  return {
    mediaKey: src,
    release() {
      if (released) return;
      released = true;
      if (entry.consumed) return;
      maybeRetireWarmClaim(entry);
    },
  };
}

function resolveFromLayerEntry(src: string | null, entry: LayerEntry | null): ResolvedMediaState {
  if (!src) return { status: 'empty' };
  if (!entry) return { status: 'loading' };
  if (entry.refCount === 0) return { status: 'loading' };
  if (entry.status === 'loaded') return { status: 'loaded', resource: entry.video };
  return { status: entry.status === 'broken' ? 'broken' : 'loading' };
}

function resolveFromWarmClaim(src: string | null, entry: WarmClaimEntry | null): ResolvedMediaState {
  if (!src) return { status: 'empty' };
  if (!entry) return { status: 'loading' };
  if (entry.status === 'loaded') return { status: 'loaded', resource: entry.video };
  return { status: entry.status === 'broken' ? 'broken' : 'loading' };
}

function isSameMedia(left: ResolvedMediaState, right: ResolvedMediaState): boolean {
  if (left.status !== right.status) return false;
  if (left.status === 'loaded' && right.status === 'loaded') return left.resource === right.resource;
  return true;
}

function makeLocalTrackedState(src: string | null, media: ResolvedMediaState): TrackedVideoState {
  return { src, media };
}

function commitTrackedState(
  setTracked: React.Dispatch<React.SetStateAction<TrackedVideoState>>,
  src: string | null,
  media: ResolvedMediaState,
) {
  setTracked((current) => (
    current.src === src && isSameMedia(current.media, media) ? current : makeLocalTrackedState(src, media)
  ));
}

function buildDetachedVideo(src: string, options: UseKVideoOptions): WarmClaimEntry {
  const entry: WarmClaimEntry = {
    claimKey: `detached:${src}:${nextAccessOrder()}`,
    src,
    video: createVideoElement(src, options, 'metadata'),
    status: 'loading',
    cleanup: () => undefined,
    consumed: true,
    lastUsedOrder: nextAccessOrder(),
  };
  attachEntryListeners(entry, () => undefined);
  return entry;
}

export function useKVideo(
  src: string | null,
  { autoplay, loop, muted, playbackRate }: UseKVideoOptions,
  layerOwned: boolean = false,
  claimKey: string | null = null,
): ResolvedMediaState {
  const renderLayerEntry = layerOwned ? peekLayerEntry(src) : null;
  const renderWarmClaim = !layerOwned ? peekWarmClaimEntry(claimKey, src) : null;
  const renderMedia = layerOwned
    ? resolveFromLayerEntry(src, renderLayerEntry)
    : resolveFromWarmClaim(src, renderWarmClaim);
  const [tracked, setTracked] = useState<TrackedVideoState>(() => makeLocalTrackedState(src, src ? renderMedia : { status: 'empty' }));
  const adoptedClaimRef = useRef<WarmClaimEntry | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const committedOptionsRef = useRef<UseKVideoOptions>({ autoplay, loop, muted, playbackRate });

  useLayoutEffect(() => {
    committedOptionsRef.current = { autoplay, loop, muted, playbackRate };
  }, [autoplay, loop, muted, playbackRate]);

  useLayoutEffect(() => {
    if (!src || layerOwned || !claimKey || !renderWarmClaim) return;
    cancelConsumedClaimCleanup(renderWarmClaim.video);
    const adopted = consumeWarmClaimEntry(claimKey, src, renderWarmClaim);
    if (!adopted) return;
    adoptedClaimRef.current = adopted;
    if (adopted.status === 'loaded') {
      commitTrackedState(setTracked, src, { status: 'loaded', resource: adopted.video });
      applyVideoOptions(adopted.video, committedOptionsRef.current);
      return;
    }
    commitTrackedState(setTracked, src, adopted.status === 'broken' ? { status: 'broken' } : { status: 'loading' });
  }, [claimKey, layerOwned, renderWarmClaim, src]);

  useEffect(() => {
    if (!src) {
      videoRef.current = null;
      commitTrackedState(setTracked, src, { status: 'empty' });
      return;
    }

    if (layerOwned) {
      const refresh = () => {
        commitTrackedState(setTracked, src, resolveFromLayerEntry(src, peekLayerEntry(src)));
      };
      refresh();
      layerListeners.add(refresh);
      return () => {
        layerListeners.delete(refresh);
      };
    }

    const adoptedEntry = adoptedClaimRef.current?.src === src ? adoptedClaimRef.current : null;
    const entry = adoptedEntry ?? buildDetachedVideo(src, committedOptionsRef.current);
    cancelConsumedClaimCleanup(entry.video);
    const instanceId = registerDetachedInstance(entry.video, entry.status);
    videoRef.current = entry.video;
    commitTrackedState(setTracked, src, entry.status === 'loaded'
      ? { status: 'loaded', resource: entry.video }
      : entry.status === 'broken'
        ? { status: 'broken' }
        : { status: 'loading' });

    const handleReady = () => {
      entry.status = 'loaded';
      instanceStatuses.set(instanceId, 'loaded');
      notifyLayerListeners();
      commitTrackedState(setTracked, src, { status: 'loaded', resource: entry.video });
      applyVideoOptions(entry.video, committedOptionsRef.current);
    };
    const handleError = () => {
      entry.status = 'broken';
      instanceStatuses.set(instanceId, 'broken');
      notifyLayerListeners();
      commitTrackedState(setTracked, src, { status: 'broken' });
    };
    const handlePlaybackStateChange = () => {
      notifyLayerListeners();
    };

    entry.video.addEventListener('loadeddata', handleReady);
    entry.video.addEventListener('error', handleError);
    entry.video.addEventListener('play', handlePlaybackStateChange);
    entry.video.addEventListener('pause', handlePlaybackStateChange);
    entry.video.addEventListener('ended', handlePlaybackStateChange);
    if (entry.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      handleReady();
    } else if (adoptedClaimRef.current == null) {
      entry.video.load();
    }

    return () => {
      entry.video.removeEventListener('loadeddata', handleReady);
      entry.video.removeEventListener('error', handleError);
      entry.video.removeEventListener('play', handlePlaybackStateChange);
      entry.video.removeEventListener('pause', handlePlaybackStateChange);
      entry.video.removeEventListener('ended', handlePlaybackStateChange);
      if (adoptedEntry === entry) {
        cancelConsumedClaimCleanup(entry.video);
        const timerId = window.setTimeout(() => {
          pendingConsumedClaimCleanup.delete(entry.video);
          if (adoptedClaimRef.current === entry) {
            adoptedClaimRef.current = null;
          }
          unregisterDetachedInstance(entry.video);
          entry.cleanup();
        }, 0);
        pendingConsumedClaimCleanup.set(entry.video, timerId);
      } else {
        unregisterDetachedInstance(entry.video);
        destroyVideoElement(entry.video);
        notifyLayerListeners();
      }
      videoRef.current = null;
    };
  }, [claimKey, layerOwned, src]);

  useEffect(() => {
    if (layerOwned) return;
    const video = videoRef.current;
    if (!video) return;
    applyVideoOptions(video, { autoplay, loop, muted, playbackRate });
  }, [autoplay, layerOwned, loop, muted, playbackRate]);

  return tracked.src === src ? tracked.media : renderMedia;
}

export function __resetVideoPoolForTests() {
  for (const entry of layerRegistry.values()) {
    entry.cleanup();
  }
  for (const entry of retiredLayerRegistry.values()) {
    entry.cleanup();
  }
  for (const entry of pendingWarmClaims.values()) {
    entry.cleanup();
  }
  for (const entry of retiredWarmClaims.values()) {
    entry.cleanup();
  }
  layerRegistry.clear();
  retiredLayerRegistry.clear();
  pendingWarmClaims.clear();
  retiredWarmClaims.clear();
  layerListeners.clear();
  instanceRegistry.clear();
  instanceStatuses.clear();
  pendingConsumedClaimCleanup.forEach((timerId) => window.clearTimeout(timerId));
  pendingConsumedClaimCleanup.clear();
  nextVideoInstanceId = 0;
  nextVideoAccessOrder = 1;
  warmIssuedCount = 0;
  warmHitCount = 0;
  warmMissCount = 0;
  warmWastedCount = 0;
  currentVideoPoolStats = computeVideoPoolStats();
}
