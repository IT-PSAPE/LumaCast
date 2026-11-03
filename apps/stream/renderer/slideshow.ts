import type { SlideshowImage, StreamSource } from '../shared/desktop-api';
import { getSourceRuntimeId } from './source-runtime';

export type SlideNavigationAction = 'previous' | 'next' | 'reset';

interface SlideshowAutoConfig {
  imageCount: number;
  intervalSeconds: number;
  loop: boolean;
}

export type SlidePlaybackConfigPriority = 'program' | 'preview';

interface SlidePlaybackConfig {
  autoConfig: SlideshowAutoConfig | null;
  resetOnEntry: boolean;
}

interface SlidePlayback {
  initialized: boolean;
  programSeeded: boolean;
  runtimeCursorChanged: boolean;
  index: number;
  elapsedMs: number;
  activeSince: number | null;
  active: boolean;
  manualPaused: boolean;
  programConfig: SlidePlaybackConfig | null;
  previewConfig: SlidePlaybackConfig | null;
  resetOnEntry: boolean;
  autoConfig: SlideshowAutoConfig | null;
  revision: number;
  lastNotifiedIndex: number;
  boundaryTimer: ReturnType<typeof setTimeout> | null;
}

const slidePlaybacks = new Map<string, SlidePlayback>();
const slidePlaybackListeners = new Map<string, Set<() => void>>();

function createPlayback(): SlidePlayback {
  return {
    initialized: false,
    programSeeded: false,
    runtimeCursorChanged: false,
    index: -1,
    elapsedMs: 0,
    activeSince: null,
    active: false,
    manualPaused: false,
    programConfig: null,
    previewConfig: null,
    resetOnEntry: false,
    autoConfig: null,
    revision: 0,
    lastNotifiedIndex: -1,
    boundaryTimer: null,
  };
}

export function isSlideSource(source: StreamSource): boolean {
  return source.kind === 'slideshow' || source.kind === 'presentation';
}

export function sourceSlideImages(source: StreamSource): SlideshowImage[] {
  return source.kind === 'slideshow' ? source.slideshowImages ?? []
    : source.kind === 'presentation' ? source.presentationSlides ?? [] : [];
}

function clampSlideIndex(index: number, count: number): number {
  return count < 1 ? -1 : Math.max(0, Math.min(count - 1, Math.trunc(index)));
}

function sourceInitialIndex(source: StreamSource): number {
  return clampSlideIndex(source.slideIndex ?? 0, sourceSlideImages(source).length);
}

/** The runtime resource UUID is shared by matching Preview, Program, and scene snapshots. */
export function slidePlaybackKey(source: StreamSource): string {
  return getSourceRuntimeId(source);
}

function playbackFor(key: string, source?: StreamSource): SlidePlayback {
  let playback = slidePlaybacks.get(key);
  if (!playback) {
    playback = createPlayback();
    slidePlaybacks.set(key, playback);
  }
  if (source && !playback.initialized) {
    playback.index = sourceInitialIndex(source);
    playback.lastNotifiedIndex = playback.index;
    playback.initialized = true;
  }
  return playback;
}

function autoConfigFor(source: StreamSource): SlideshowAutoConfig | null {
  if (source.kind !== 'slideshow' || source.slideshowAutoAdvance !== true) return null;
  return {
    imageCount: sourceSlideImages(source).length,
    intervalSeconds: source.slideshowIntervalSeconds ?? 5,
    loop: source.slideshowLoop ?? true,
  };
}

function effectiveConfig(playback: SlidePlayback): SlidePlaybackConfig | null {
  return playback.programConfig ?? playback.previewConfig;
}

function sameAutoConfig(left: SlideshowAutoConfig | null, right: SlideshowAutoConfig | null): boolean {
  return left === right || Boolean(left && right
    && left.imageCount === right.imageCount
    && left.intervalSeconds === right.intervalSeconds
    && left.loop === right.loop);
}

function applyEffectiveConfig(key: string, playback: SlidePlayback, now: number): void {
  const next = effectiveConfig(playback);
  const nextAutoConfig = next?.autoConfig ?? null;
  const resetChanged = playback.resetOnEntry !== (next?.resetOnEntry ?? false);
  const autoChanged = !sameAutoConfig(playback.autoConfig, nextAutoConfig);
  if (!autoChanged && !resetChanged) return;

  if (autoChanged) {
    const currentIndex = displayedIndex(playback, now);
    const index = nextAutoConfig
      ? clampSlideIndex(currentIndex, nextAutoConfig.imageCount)
      : currentIndex;
    playback.index = index;
    playback.elapsedMs = 0;
    playback.autoConfig = nextAutoConfig;
    playback.activeSince = playback.active && nextAutoConfig && !playback.manualPaused ? now : null;
  }
  playback.resetOnEntry = next?.resetOnEntry ?? false;
  notify(key, playback, now);
}

function elapsedMs(playback: SlidePlayback, now: number): number {
  return playback.elapsedMs + (playback.activeSince === null ? 0 : Math.max(0, now - playback.activeSince));
}

function displayedIndex(playback: SlidePlayback, now: number): number {
  const config = playback.autoConfig;
  if (!config || playback.activeSince === null || playback.manualPaused) return playback.index;
  return slideshowSlideIndex(
    playback.index * Math.max(1, config.intervalSeconds * 1000) + elapsedMs(playback, now),
    config.imageCount,
    config.intervalSeconds,
    config.loop,
  );
}

function clearBoundaryTimer(playback: SlidePlayback): void {
  if (playback.boundaryTimer !== null) clearTimeout(playback.boundaryTimer);
  playback.boundaryTimer = null;
}

function notify(key: string, playback: SlidePlayback, now = performance.now()): void {
  playback.revision += 1;
  playback.lastNotifiedIndex = displayedIndex(playback, now);
  for (const listener of slidePlaybackListeners.get(key) ?? []) listener();
  scheduleBoundaryNotification(key, playback, now);
}

function scheduleBoundaryNotification(key: string, playback: SlidePlayback, now = performance.now()): void {
  clearBoundaryTimer(playback);
  if ((slidePlaybackListeners.get(key)?.size ?? 0) === 0) return;
  const config = playback.autoConfig;
  if (!config || playback.activeSince === null || playback.manualPaused || config.imageCount < 2) return;

  const currentIndex = displayedIndex(playback, now);
  if (!config.loop && currentIndex >= config.imageCount - 1) return;

  const intervalMs = Math.max(1, config.intervalSeconds * 1000);
  const activeElapsedMs = elapsedMs(playback, now);
  const untilBoundary = Math.max(1, intervalMs - (activeElapsedMs % intervalMs));
  playback.boundaryTimer = setTimeout(() => {
    playback.boundaryTimer = null;
    if (playback.activeSince === null || playback.manualPaused) return;
    const nextIndex = displayedIndex(playback, performance.now());
    if (nextIndex !== playback.lastNotifiedIndex) notify(key, playback);
    else scheduleBoundaryNotification(key, playback);
  }, untilBoundary);
}

/** Legacy saved position seeds a runtime cursor once; later snapshot changes never replace it. */
export function currentSourceSlideIndex(source: StreamSource, now = performance.now()): number {
  if (!isSlideSource(source)) return -1;
  const playback = playbackFor(slidePlaybackKey(source), source);
  return clampSlideIndex(displayedIndex(playback, now), sourceSlideImages(source).length);
}

/** Lets the current Program source seed before canvases read Preview copies. */
export function seedSlidePlaybackFromProgram(source: StreamSource): void {
  if (!isSlideSource(source)) return;
  const key = slidePlaybackKey(source);
  const playback = playbackFor(key, source);
  if (playback.programSeeded) return;
  playback.programSeeded = true;
  if (!playback.runtimeCursorChanged && playback.activeSince === null) {
    const index = sourceInitialIndex(source);
    const changed = index !== playback.index;
    playback.index = index;
    playback.lastNotifiedIndex = index;
    playback.initialized = true;
    if (changed) notify(key, playback);
  }
}

/** Revision snapshots are primitives so useSyncExternalStore can avoid frame-rate React updates. */
export function getSlidePlaybackRevision(source: StreamSource): number {
  if (!isSlideSource(source)) return 0;
  return playbackFor(slidePlaybackKey(source), source).revision;
}

export function subscribeSlidePlayback(source: StreamSource, listener: () => void): () => void {
  if (!isSlideSource(source)) return () => undefined;
  const key = slidePlaybackKey(source);
  const playback = playbackFor(key, source);
  const listeners = slidePlaybackListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  slidePlaybackListeners.set(key, listeners);
  scheduleBoundaryNotification(key, playback);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      slidePlaybackListeners.delete(key);
      clearBoundaryTimer(playback);
    }
  };
}

export function isSourceSlideAutoAdvancing(source: StreamSource): boolean {
  if (source.kind !== 'slideshow') return false;
  const playback = playbackFor(slidePlaybackKey(source), source);
  const config = effectiveConfig(playback);
  const enabled = config ? config.autoConfig !== null : source.slideshowAutoAdvance === true;
  return enabled && !playback.manualPaused;
}

export function isSlidePlaybackManuallyPaused(source: StreamSource): boolean {
  return isSlideSource(source) && playbackFor(slidePlaybackKey(source), source).manualPaused;
}

/** Stores one view's property config; Program always wins over Preview for matching resources. */
export function syncSlidePlaybackConfig(
  source: StreamSource,
  priority: SlidePlaybackConfigPriority,
  now = performance.now(),
): void {
  if (!isSlideSource(source)) return;
  const key = slidePlaybackKey(source);
  const playback = playbackFor(key, source);
  const next: SlidePlaybackConfig = {
    autoConfig: autoConfigFor(source),
    resetOnEntry: source.restartPlaybackWhenActive === true,
  };
  if (priority === 'program') playback.programConfig = next;
  else playback.previewConfig = next;
  applyEffectiveConfig(key, playback, now);
}

/** Releases one view's property config and falls back from Program to Preview when available. */
export function releaseSlidePlaybackConfig(
  sourceOrKey: StreamSource | string,
  priority: SlidePlaybackConfigPriority,
  now = performance.now(),
): void {
  const key = typeof sourceOrKey === 'string' ? sourceOrKey : slidePlaybackKey(sourceOrKey);
  const playback = slidePlaybacks.get(key);
  if (!playback) return;
  if (priority === 'program') playback.programConfig = null;
  else playback.previewConfig = null;
  applyEffectiveConfig(key, playback, now);
}

/** Shared manual navigation changes only runtime state and pauses automatic playback for this session. */
export function navigateSlidePlayback(source: StreamSource, action: SlideNavigationAction, now = performance.now()): void {
  if (!isSlideSource(source)) return;
  const images = sourceSlideImages(source);
  if (images.length === 0) return;

  const key = slidePlaybackKey(source);
  const playback = playbackFor(key, source);
  if (!playback.autoConfig && playback.active) playback.autoConfig = autoConfigFor(source);
  const currentIndex = clampSlideIndex(displayedIndex(playback, now), images.length);
  const nextIndex = action === 'reset'
    ? 0
    : clampSlideIndex(currentIndex + (action === 'next' ? 1 : -1), images.length);
  playback.index = nextIndex;
  playback.elapsedMs = 0;
  playback.activeSince = null;
  playback.manualPaused = true;
  playback.runtimeCursorChanged = true;
  notify(key, playback, now);
}

/** Program playback owns active time; leaving Program freezes the displayed cursor. */
export function setSlidePlaybackActive(
  source: StreamSource,
  active: boolean,
  resetOnEntry?: boolean,
  now = performance.now(),
): void {
  if (!isSlideSource(source)) return;
  const key = slidePlaybackKey(source);
  const playback = playbackFor(key, source);

  if (active) {
    syncSlidePlaybackConfig(source, 'program', now);
    if (playback.active) return;
    playback.active = true;
    if (resetOnEntry ?? playback.resetOnEntry) {
      playback.index = sourceSlideImages(source).length > 0 ? 0 : -1;
      playback.elapsedMs = 0;
      playback.manualPaused = false;
      playback.runtimeCursorChanged = true;
    }
    playback.autoConfig = autoConfigFor(source);
    playback.activeSince = playback.autoConfig && !playback.manualPaused ? now : null;
    playback.elapsedMs = 0;
    notify(key, playback, now);
    return;
  }

  if (!playback.active) {
    releaseSlidePlaybackConfig(key, 'program', now);
    return;
  }
  const nextIndex = clampSlideIndex(displayedIndex(playback, now), sourceSlideImages(source).length);
  playback.index = nextIndex;
  playback.lastNotifiedIndex = nextIndex;
  playback.elapsedMs = 0;
  playback.activeSince = null;
  playback.active = false;
  notify(key, playback, now);
  releaseSlidePlaybackConfig(key, 'program', now);
}

function setExplicitAutoAdvance(source: StreamSource, enabled: boolean, now: number): void {
  if (source.kind !== 'slideshow') return;
  if (!enabled) return;
  const key = slidePlaybackKey(source);
  const playback = playbackFor(key, source);
  playback.manualPaused = false;
  playback.elapsedMs = 0;
  playback.activeSince = playback.active && playback.autoConfig ? now : null;
  notify(key, playback, now);
}

/** Keeps legacy callers source-based while ensuring the slide cursor stays out of staged properties. */
export function navigateSourceSlide(source: StreamSource, action: SlideNavigationAction, now = performance.now()): StreamSource {
  const images = sourceSlideImages(source);
  if (images.length === 0) return source;
  const currentIndex = currentSourceSlideIndex(source, now);
  const slideIndex = action === 'reset' ? 0 : clampSlideIndex(currentIndex + (action === 'next' ? 1 : -1), images.length);
  return { ...source, slideIndex, ...(source.kind === 'slideshow' ? { slideshowAutoAdvance: false } : {}) };
}

/** Explicit opt-in starts a fresh interval from the runtime cursor when this source is active. */
export function setSourceSlideshowAutoAdvance(source: StreamSource, enabled: boolean, now = performance.now()): StreamSource {
  if (source.kind !== 'slideshow') return source;
  setExplicitAutoAdvance(source, enabled, now);
  if (enabled === (source.slideshowAutoAdvance === true)) return source;
  return {
    ...source,
    slideshowAutoAdvance: enabled,
    ...(enabled ? { slideshowPlaybackId: crypto.randomUUID() } : {}),
  };
}

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

/** Compatibility clock key; playback generations no longer own the shared cursor. */
export function sourceSlideshowClockKey(source: StreamSource): string {
  syncSlidePlaybackConfig(source, 'program');
  return slidePlaybackKey(source);
}

export function currentSlideshowSlideIndex(
  sourceId: string,
  imageCount: number,
  intervalSeconds: number,
  loop: boolean,
  now = performance.now(),
): number {
  const playback = playbackFor(sourceId);
  const config = playback.autoConfig ?? { imageCount, intervalSeconds, loop };
  return slideshowSlideIndex(
    Math.max(0, playback.index) * Math.max(1, config.intervalSeconds * 1000) + elapsedMs(playback, now),
    config.imageCount,
    config.intervalSeconds,
    config.loop,
  );
}

/** Compatibility active-time API used by the renderer clock owner during migration. */
export function setSlideshowActive(sourceId: string, active: boolean, now = performance.now()): void {
  const playback = playbackFor(sourceId);
  if (!playback.initialized) {
    playback.index = 0;
    playback.lastNotifiedIndex = 0;
    playback.initialized = true;
  }
  if (active === (playback.activeSince !== null)) return;
  if (active) playback.activeSince = now;
  else {
    if (playback.autoConfig && !playback.manualPaused) {
      playback.index = displayedIndex(playback, now);
      playback.elapsedMs = 0;
    }
    else playback.elapsedMs += Math.max(0, now - playback.activeSince!);
    playback.activeSince = null;
  }
  scheduleBoundaryNotification(sourceId, playback, now);
}

export function currentSlideshowElapsedMs(sourceId: string, now = performance.now()): number {
  const playback = slidePlaybacks.get(sourceId);
  return playback ? elapsedMs(playback, now) : 0;
}

export function forgetSlideshow(sourceId: string): void {
  const playback = slidePlaybacks.get(sourceId);
  if (playback) clearBoundaryTimer(playback);
  slidePlaybacks.delete(sourceId);
}

export function forgetSourceSlideshows(runtimeSourceId: string): void {
  for (const key of slidePlaybacks.keys()) {
    if (key === runtimeSourceId || key.startsWith(`${runtimeSourceId}:`)) forgetSlideshow(key);
  }
}

/** Evicts cursors only after the caller has confirmed that no project/session view references them. */
export function forgetUnusedSlidePlaybacks(referencedKeys: ReadonlySet<string>): void {
  for (const [key, playback] of slidePlaybacks) {
    if (referencedKeys.has(key) || playback.active || (slidePlaybackListeners.get(key)?.size ?? 0) > 0) continue;
    clearBoundaryTimer(playback);
    slidePlaybacks.delete(key);
  }
}

/** Clears volatile playback across workspace changes; source properties remain the next seed. */
export function resetSlidePlaybackStore(): void {
  for (const playback of slidePlaybacks.values()) clearBoundaryTimer(playback);
  slidePlaybacks.clear();
}
