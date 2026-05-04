import { useEffect, useRef, useState } from 'react';

type PosterStatus = 'loading' | 'ready' | 'error';

interface PosterResult {
  posterSrc: string | null;
  status: PosterStatus;
}

const posterCache = new Map<string, string | null>();
const pendingPosterLoads = new Map<string, Promise<string | null>>();

function cleanupVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

function extractPoster(src: string): Promise<string | null> {
  const pending = pendingPosterLoads.get(src);
  if (pending) return pending;

  const promise = new Promise<string | null>((resolve, reject) => {
    const video = document.createElement('video');
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const finalize = (value: string | null, error?: Error) => {
      video.removeEventListener('loadeddata', handleLoadedData);
      video.removeEventListener('error', handleError);
      cleanupVideo(video);
      pendingPosterLoads.delete(src);
      if (error) reject(error);
      else resolve(value);
    };

    const handleLoadedData = () => {
      try {
        const width = Math.max(video.videoWidth, 1);
        const height = Math.max(video.videoHeight, 1);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          finalize(null);
          return;
        }
        context.drawImage(video, 0, 0, width, height);
        finalize(canvas.toDataURL('image/png'));
      } catch (error) {
        finalize(null, error instanceof Error ? error : new Error(String(error)));
      }
    };

    const handleError = () => {
      finalize(null, new Error(`Failed to load video poster for ${src}`));
    };

    video.addEventListener('loadeddata', handleLoadedData, { once: true });
    video.addEventListener('error', handleError, { once: true });
    video.load();
  });

  pendingPosterLoads.set(src, promise);
  return promise;
}

export function useVideoPoster(src: string | null): PosterResult {
  const cached = src ? posterCache.get(src) : undefined;
  const [posterSrc, setPosterSrc] = useState<string | null>(() => cached ?? null);
  const [status, setStatus] = useState<PosterStatus>(() => {
    if (!src) return 'error';
    if (cached === null && posterCache.has(src)) return 'error';
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
    if (posterCache.has(src)) {
      const nextPoster = posterCache.get(src) ?? null;
      setPosterSrc(nextPoster);
      setStatus(nextPoster ? 'ready' : 'error');
      return;
    }

    let cancelled = false;
    setPosterSrc(null);
    setStatus('loading');

    extractPoster(src).then((nextPoster) => {
      posterCache.set(src, nextPoster);
      if (cancelled || srcRef.current !== src) return;
      setPosterSrc(nextPoster);
      setStatus(nextPoster ? 'ready' : 'error');
    }).catch(() => {
      posterCache.set(src, null);
      if (cancelled || srcRef.current !== src) return;
      setPosterSrc(null);
      setStatus('error');
    });

    return () => { cancelled = true; };
  }, [src]);

  return { posterSrc, status };
}
