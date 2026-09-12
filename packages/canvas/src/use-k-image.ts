import { useEffect, useLayoutEffect, useState } from 'react';
import type { ResolvedMediaState } from '@lumacast/composition';
import { peekImageEntry, reserveImageEntry, retainImage } from './image-cache';
import type { ImageCacheEntry } from './image-cache';

interface TrackedImageState {
  src: string | null;
  media: ResolvedMediaState;
}

function resolveFromEntry(entry: ImageCacheEntry | null): ResolvedMediaState {
  if (!entry || entry.status === 'loading') return { status: 'loading' };
  if (entry.status === 'error') return { status: 'broken' };
  return { status: 'loaded', resource: entry.image };
}

function isSameMedia(left: ResolvedMediaState, right: ResolvedMediaState): boolean {
  if (left.status !== right.status) return false;
  if (left.status === 'loaded' && right.status === 'loaded') return left.resource === right.resource;
  return true;
}

export function useKImage(src: string | null): ResolvedMediaState {
  const renderEntry = src ? peekImageEntry(src) : null;
  const renderMedia = src ? resolveFromEntry(renderEntry) : { status: 'empty' } satisfies ResolvedMediaState;
  const [tracked, setTracked] = useState<TrackedImageState>(() => ({ src, media: renderMedia }));

  useLayoutEffect(() => {
    if (!src || !renderEntry || renderEntry.status !== 'loaded') return;

    const reservation = reserveImageEntry(renderEntry);
    return () => {
      reservation?.release();
    };
  }, [src, renderEntry]);

  useEffect(() => {
    if (!src) {
      setTracked({ src, media: { status: 'empty' } });
      return;
    }

    // Retain for the whole mounted lifetime, not only while the load is in
    // flight. The cache hands out one shared HTMLImageElement per src and
    // evicts by clearing that element in place, so an unpinned-but-displayed
    // image goes blank the moment anything pushes the cache over budget.
    const handle = retainImage(src);
    const { entry } = handle;

    function commit(media: ResolvedMediaState) {
      setTracked((current) => (
        current.src === src && isSameMedia(current.media, media) ? current : { src, media }
      ));
    }

    function handleStatusChange(status: 'loaded' | 'error') {
      commit(status === 'loaded' ? { status: 'loaded', resource: entry.image } : { status: 'broken' });
    }

    entry.listeners.add(handleStatusChange);
    commit(
      entry.status === 'loaded'
        ? { status: 'loaded', resource: entry.image }
        : entry.status === 'error'
          ? { status: 'broken' }
          : { status: 'loading' },
    );

    return () => {
      entry.listeners.delete(handleStatusChange);
      handle.release();
    };
  }, [src]);

  // Never report state belonging to a previous `src`. The effect that updates
  // `tracked` runs a render behind, and SceneNodeMedia would otherwise tag the
  // outgoing element with the incoming request key — painting one slide's
  // media on another.
  return tracked.src === src ? tracked.media : renderMedia;
}
