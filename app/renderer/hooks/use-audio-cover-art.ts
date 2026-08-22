import { useEffect, useRef, useState } from 'react';

const COVER_ART_CACHE_LIMIT = 64;

const coverArtCache = new Map<string, string | null>();
const pendingCoverArtLoads = new Map<string, Promise<string | null>>();

function evictOldestCoverArt() {
  while (coverArtCache.size > COVER_ART_CACHE_LIMIT) {
    const oldestKey = coverArtCache.keys().next().value;
    if (typeof oldestKey !== 'string') return;
    coverArtCache.delete(oldestKey);
  }
}

function peekCachedCoverArt(src: string): string | null | undefined {
  return coverArtCache.get(src);
}

function touchCachedCoverArt(src: string): string | null | undefined {
  const cached = coverArtCache.get(src);
  if (cached === undefined) return undefined;
  coverArtCache.delete(src);
  coverArtCache.set(src, cached);
  return cached;
}

function cacheCoverArt(src: string, coverArt: string | null) {
  coverArtCache.delete(src);
  coverArtCache.set(src, coverArt);
  evictOldestCoverArt();
}

function loadCoverArt(src: string): Promise<string | null> {
  const pending = pendingCoverArtLoads.get(src);
  if (pending) return pending;

  const request = window.castApi.getAudioCoverArt(src).finally(() => {
    pendingCoverArtLoads.delete(src);
  });
  pendingCoverArtLoads.set(src, request);
  return request;
}

export function useAudioCoverArt(src: string, enabled = true): string | null {
  const cached = peekCachedCoverArt(src);
  const [coverArt, setCoverArt] = useState<string | null>(() => cached ?? null);
  const srcRef = useRef(src);
  srcRef.current = src;

  useEffect(() => {
    const cachedCoverArt = touchCachedCoverArt(src);
    if (cachedCoverArt !== undefined) {
      setCoverArt(cachedCoverArt);
      return;
    }

    if (!enabled) {
      setCoverArt(null);
      return;
    }

    let cancelled = false;

    loadCoverArt(src).then((result) => {
      cacheCoverArt(src, result);
      if (!cancelled && srcRef.current === src) setCoverArt(result);
    }).catch(() => {
      if (!cancelled && srcRef.current === src) setCoverArt(null);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, src]);

  return coverArt;
}
