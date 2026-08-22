import { useEffect, useRef, useState } from 'react';

type PosterStatus = 'loading' | 'ready' | 'error';

interface PosterResult {
  posterSrc: string | null;
  status: PosterStatus;
}

interface PosterTask {
  controller: AbortController;
  consumers: number;
  promise: Promise<string>;
  reject: (reason?: unknown) => void;
  resolve: (value: string) => void;
  settled: boolean;
  started: boolean;
  src: string;
}

const POSTER_CACHE_LIMIT = 64;
const POSTER_CONCURRENCY_LIMIT = 2;
const POSTER_MAX_WIDTH = 480;
const POSTER_MAX_HEIGHT = 270;
const POSTER_TIMEOUT_MS = 4_000;
const POSTER_MAX_ATTEMPTS = 2;

const posterCache = new Map<string, string>();
const pendingPosterTasks = new Map<string, PosterTask>();
const queuedPosterTasks: PosterTask[] = [];
let activePosterTasks = 0;

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function cleanupVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function scaleDimensions(width: number, height: number): { width: number; height: number } {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const scale = Math.min(1, POSTER_MAX_WIDTH / safeWidth, POSTER_MAX_HEIGHT / safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function evictOldestPoster() {
  while (posterCache.size > POSTER_CACHE_LIMIT) {
    const oldestKey = posterCache.keys().next().value;
    if (typeof oldestKey !== 'string') return;
    posterCache.delete(oldestKey);
  }
}

function peekCachedPoster(src: string): string | undefined {
  return posterCache.get(src);
}

function touchCachedPoster(src: string): string | undefined {
  const cached = posterCache.get(src);
  if (typeof cached !== 'string') return undefined;
  posterCache.delete(src);
  posterCache.set(src, cached);
  return cached;
}

function cachePoster(src: string, posterSrc: string) {
  posterCache.delete(src);
  posterCache.set(src, posterSrc);
  evictOldestPoster();
}

function settleTask(task: PosterTask, action: () => void) {
  if (task.settled) return;
  task.settled = true;
  if (pendingPosterTasks.get(task.src) === task) {
    pendingPosterTasks.delete(task.src);
  }
  action();
}

function dequeueTask(task: PosterTask) {
  const index = queuedPosterTasks.indexOf(task);
  if (index >= 0) queuedPosterTasks.splice(index, 1);
}

function pumpPosterQueue() {
  while (activePosterTasks < POSTER_CONCURRENCY_LIMIT) {
    const nextTask = queuedPosterTasks.shift();
    if (!nextTask) return;
    if (nextTask.settled) continue;
    nextTask.started = true;
    activePosterTasks += 1;
    void runPosterTask(nextTask);
  }
}

async function extractPosterOnce(src: string, signal: AbortSignal): Promise<string> {
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.crossOrigin = 'anonymous';

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error(`Timed out extracting video poster for ${src}`)));
    }, POSTER_TIMEOUT_MS);

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
      cleanupVideo(video);
      action();
    };

    const handleAbort = () => {
      finish(() => reject(createAbortError(`Aborted video poster extraction for ${src}`)));
    };

    const handleError = () => {
      finish(() => reject(new Error(`Failed to load video poster for ${src}`)));
    };

    const handleLoadedData = () => {
      try {
        const dimensions = scaleDimensions(video.videoWidth, video.videoHeight);
        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error(`Failed to create video poster canvas for ${src}`);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(() => resolve(canvas.toDataURL('image/jpeg', 0.85)));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    };

    if (signal.aborted) {
      handleAbort();
      return;
    }

    signal.addEventListener('abort', handleAbort, { once: true });
    video.addEventListener('loadeddata', handleLoadedData, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.load();
  });
}

async function runPosterTask(task: PosterTask) {
  try {
    for (let attempt = 1; attempt <= POSTER_MAX_ATTEMPTS; attempt += 1) {
      try {
        const posterSrc = await extractPosterOnce(task.src, task.controller.signal);
        cachePoster(task.src, posterSrc);
        settleTask(task, () => task.resolve(posterSrc));
        return;
      } catch (error) {
        if (task.controller.signal.aborted) {
          settleTask(task, () => task.reject(error));
          return;
        }
        if (attempt === POSTER_MAX_ATTEMPTS) {
          settleTask(task, () => task.reject(error));
          return;
        }
      }
    }
  } finally {
    activePosterTasks = Math.max(0, activePosterTasks - 1);
    pumpPosterQueue();
  }
}

function acquirePosterTask(src: string): { promise: Promise<string>; release: () => void } {
  let task = pendingPosterTasks.get(src);
  if (task && (task.settled || task.controller.signal.aborted)) {
    if (pendingPosterTasks.get(src) === task) {
      pendingPosterTasks.delete(src);
    }
    task = undefined;
  }
  if (!task) {
    let resolveTask!: (value: string) => void;
    let rejectTask!: (reason?: unknown) => void;
    const promise = new Promise<string>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    task = {
      controller: new AbortController(),
      consumers: 0,
      promise,
      reject: rejectTask,
      resolve: resolveTask,
      settled: false,
      started: false,
      src,
    };
    pendingPosterTasks.set(src, task);
    queuedPosterTasks.push(task);
    pumpPosterQueue();
  }

  task.consumers += 1;

  let released = false;
  return {
    promise: task.promise,
    release: () => {
      if (released) return;
      released = true;
      task!.consumers = Math.max(0, task!.consumers - 1);
      if (task!.consumers > 0 || task!.settled) return;
      if (task!.started) {
        if (pendingPosterTasks.get(src) === task) {
          pendingPosterTasks.delete(src);
        }
        task!.controller.abort();
        return;
      }
      dequeueTask(task!);
      settleTask(task!, () => task!.reject(createAbortError(`Cancelled queued video poster extraction for ${src}`)));
    },
  };
}

export function useVideoPoster(src: string | null, enabled = true): PosterResult {
  const cached = src ? peekCachedPoster(src) : undefined;
  const [posterSrc, setPosterSrc] = useState<string | null>(() => cached ?? null);
  const [status, setStatus] = useState<PosterStatus>(() => {
    if (!src) return 'error';
    if (typeof cached === 'string') return 'ready';
    return 'loading';
  });
  const srcRef = useRef(src);
  srcRef.current = src;

  useEffect(() => {
    if (!src) {
      setPosterSrc(null);
      setStatus('error');
      return;
    }

    const cachedPoster = touchCachedPoster(src);
    if (typeof cachedPoster === 'string') {
      setPosterSrc(cachedPoster);
      setStatus('ready');
      return;
    }

    if (!enabled) {
      setPosterSrc(null);
      setStatus('loading');
      return;
    }

    let cancelled = false;
    const task = acquirePosterTask(src);
    setPosterSrc(null);
    setStatus('loading');

    task.promise.then((nextPoster) => {
      if (cancelled || srcRef.current !== src) return;
      setPosterSrc(nextPoster);
      setStatus('ready');
    }).catch((error) => {
      if (cancelled || srcRef.current !== src) return;
      if (error instanceof Error && error.name === 'AbortError') return;
      setPosterSrc(null);
      setStatus('error');
    });

    return () => {
      cancelled = true;
      task.release();
    };
  }, [enabled, src]);

  return { posterSrc, status };
}
