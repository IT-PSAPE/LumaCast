import { useEffect, useState } from 'react';

type FilmstripStatus = 'loading' | 'ready' | 'unavailable';

interface FilmstripState {
  src?: string;
  frames: string[];
  status: FilmstripStatus;
}

const FRAME_COUNT = 12;
const FRAME_WIDTH = 160;
const FRAME_HEIGHT = 90;
const FRAME_TIMEOUT_MS = 4_000;
const CACHE_LIMIT = 4;
const cache = new Map<string, string[]>();

export function getFilmstripFrameSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } | null {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) return null;
  const scale = Math.min(1, FRAME_WIDTH / sourceWidth, FRAME_HEIGHT / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function getFilmstripSampleTimes(duration: number, count = FRAME_COUNT): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || count <= 0) return [];
  if (count === 1) return [duration / 2];
  const lastFrameTime = Math.max(0, duration - Math.min(0.05, duration / 100));
  return Array.from({ length: count }, (_, index) => lastFrameTime * index / (count - 1));
}

function createAbortError(): Error {
  const error = new Error('Video filmstrip extraction aborted');
  error.name = 'AbortError';
  return error;
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadeddata' | 'seeked', signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(() => reject(new Error(`Timed out waiting for video ${eventName}`))), FRAME_TIMEOUT_MS);

    function finish(action: () => void) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      signal.removeEventListener('abort', handleAbort);
      video.removeEventListener(eventName, handleSuccess);
      video.removeEventListener('error', handleError);
      action();
    }

    function handleAbort() { finish(() => reject(createAbortError())); }
    function handleSuccess() { finish(resolve); }
    function handleError() { finish(() => reject(new Error('Video preview could not be decoded'))); }

    if (signal.aborted) {
      handleAbort();
      return;
    }
    signal.addEventListener('abort', handleAbort, { once: true });
    video.addEventListener(eventName, handleSuccess, { once: true });
    video.addEventListener('error', handleError, { once: true });
  });
}

function cleanupVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

async function extractFilmstrip(
  src: string,
  signal: AbortSignal,
  onProgress: (frames: string[]) => void,
): Promise<string[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = src;

  try {
    const loaded = waitForVideoEvent(video, 'loadeddata', signal);
    video.load();
    await loaded;
    const times = getFilmstripSampleTimes(video.duration);
    if (times.length === 0 || video.videoWidth <= 0 || video.videoHeight <= 0) {
      throw new Error('Video preview has no decodable frames');
    }

    const frameSize = getFilmstripFrameSize(video.videoWidth, video.videoHeight);
    if (!frameSize) throw new Error('Video preview has invalid dimensions');
    const canvas = document.createElement('canvas');
    canvas.width = frameSize.width;
    canvas.height = frameSize.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Video preview canvas is unavailable');

    const frames: string[] = [];
    for (const time of times) {
      if (signal.aborted) throw createAbortError();
      if (Math.abs(video.currentTime - time) > 0.01) {
        const seeked = waitForVideoEvent(video, 'seeked', signal);
        video.currentTime = time;
        await seeked;
      }
      context.drawImage(video, 0, 0, frameSize.width, frameSize.height);
      frames.push(canvas.toDataURL('image/jpeg', 0.72));
      onProgress([...frames]);
    }
    return frames;
  } finally {
    cleanupVideo(video);
  }
}

function readCachedFrames(src: string): string[] | undefined {
  const frames = cache.get(src);
  if (!frames) return undefined;
  cache.delete(src);
  cache.set(src, frames);
  return frames;
}

function writeCachedFrames(src: string, frames: string[]) {
  cache.delete(src);
  cache.set(src, frames);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== 'string') break;
    cache.delete(oldest);
  }
}

export function useVideoFilmstrip(src: string | undefined): FilmstripState {
  const [state, setState] = useState<FilmstripState>({ frames: [], status: 'loading' });

  useEffect(() => {
    if (!src) {
      setState({ frames: [], status: 'unavailable' });
      return;
    }
    const cached = readCachedFrames(src);
    if (cached) {
      setState({ src, frames: cached, status: 'ready' });
      return;
    }

    let active = true;
    const controller = new AbortController();
    setState({ src, frames: [], status: 'loading' });
    void extractFilmstrip(src, controller.signal, (frames) => {
      if (active) setState({ src, frames, status: 'loading' });
    }).then((frames) => {
      if (!active) return;
      writeCachedFrames(src, frames);
      setState({ src, frames, status: 'ready' });
    }).catch(() => {
      if (active) setState((current) => ({ src, frames: current.src === src ? current.frames : [], status: 'unavailable' }));
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [src]);

  return state.src === src ? state : { src, frames: [], status: src ? 'loading' : 'unavailable' };
}
