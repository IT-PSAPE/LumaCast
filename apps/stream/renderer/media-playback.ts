import { friendlyError } from './features/shared/friendly-error';

const elementActivity = new WeakMap<object, boolean>();

export type MediaPlaybackCommand = 'toggle' | 'restart' | 'stop';

export async function runMediaPlaybackCommand(
  element: HTMLMediaElement,
  command: MediaPlaybackCommand,
  onError: (message: string) => void,
): Promise<void> {
  try {
    if (command === 'stop') {
      element.pause();
      element.currentTime = 0;
    } else if (command === 'toggle' && !element.paused) {
      element.pause();
    } else {
      if (command === 'restart') element.currentTime = 0;
      await element.play();
    }
  } catch (error) {
    const operation = command === 'toggle' ? 'play' : command;
    onError(`Media could not ${operation}: ${friendlyError(error)}`);
  }
}

export interface MediaPlaybackSnapshot {
  currentTime: number;
  paused: boolean;
  ended: boolean;
}

export type MediaPlaybackPositionCache = Map<string, MediaPlaybackSnapshot>;

export interface MediaPlaybackPositionRestore {
  ready: Promise<void>;
  cancel: () => void;
  snapshot?: MediaPlaybackSnapshot;
}

export function rememberMediaPlaybackPosition(
  cache: MediaPlaybackPositionCache,
  sourceId: string,
  element: Pick<HTMLMediaElement, 'currentTime' | 'paused' | 'ended'>,
  preservePlaybackState: boolean,
  ended = element.ended,
): void {
  const position = element.currentTime;
  if (Number.isFinite(position) && position >= 0) {
    cache.set(sourceId, {
      currentTime: position,
      paused: preservePlaybackState && element.paused,
      ended,
    });
  }
}

/** Restores a cached position once metadata exists, before the caller resumes playback. */
export function restoreMediaPlaybackPosition(
  cache: MediaPlaybackPositionCache,
  sourceId: string,
  element: Pick<HTMLMediaElement, 'currentTime' | 'duration' | 'readyState' | 'addEventListener' | 'removeEventListener'>,
  enabled: boolean,
): MediaPlaybackPositionRestore {
  const snapshot = cache.get(sourceId);
  cache.delete(sourceId);
  if (!enabled || snapshot === undefined) return { ready: Promise.resolve(), cancel: () => undefined };

  let resolveReady!: () => void;
  let settled = false;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const finish = (restore: boolean, preserveForRetry = false) => {
    if (settled) return;
    settled = true;
    element.removeEventListener('loadedmetadata', onMetadata);
    element.removeEventListener('error', onUnavailable);
    if (preserveForRetry) cache.set(sourceId, snapshot);
    else if (restore) {
      try {
        const duration = element.duration;
        element.currentTime = Number.isFinite(duration) && duration > 0
          ? Math.min(snapshot.currentTime, duration)
          : snapshot.currentTime;
      } catch { /* Metadata may report an unseekable or invalid media range. */ }
    }
    resolveReady();
  };
  const onMetadata = () => finish(true);
  const onUnavailable = () => finish(false);

  if (element.readyState >= 1) {
    finish(true);
    return { ready, cancel: () => undefined, snapshot };
  }
  element.addEventListener('loadedmetadata', onMetadata, { once: true });
  element.addEventListener('error', onUnavailable, { once: true });
  return { ready, cancel: () => finish(false, true), snapshot };
}

export function pruneMediaPlaybackPositions(
  cache: MediaPlaybackPositionCache,
  referencedSourceIds: ReadonlySet<string>,
): void {
  for (const sourceId of cache.keys()) {
    if (!referencedSourceIds.has(sourceId)) cache.delete(sourceId);
  }
}

export function setMediaPlaybackActive(
  element: Pick<HTMLMediaElement, 'currentTime' | 'ended' | 'play' | 'pause'>,
  active: boolean,
  restartPlaybackWhenActive = false,
  resumePlayback = true,
): void {
  if (!active) {
    elementActivity.set(element, false);
    element.pause();
    return;
  }

  // Effects can run again when a scene config or callback changes even though
  // the same runtime source stayed in Program. Restart only on the inactive ->
  // active edge so source identity, rather than the owning scene, controls the
  // media timeline.
  if (elementActivity.get(element) === true) return;
  elementActivity.set(element, true);
  if (restartPlaybackWhenActive) element.currentTime = 0;
  else if (!resumePlayback || element.ended) return;
  try {
    void Promise.resolve(element.play()).catch(() => elementActivity.set(element, false));
  } catch {
    elementActivity.set(element, false);
  }
}

export function shouldShowMediaFrame(ended: boolean, showNothingWhenPlaybackEnds: boolean): boolean {
  return !ended || !showNothingWhenPlaybackEnds;
}
