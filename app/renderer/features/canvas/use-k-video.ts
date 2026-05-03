import { useEffect, useRef, useState } from 'react';
import type { ResolvedMediaState } from './scene-types';

interface UseKVideoOptions {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
}

interface VideoPoolEntry {
  key: string;
  status: 'loading' | 'broken' | 'loaded';
  refCount: number;
  video: HTMLVideoElement;
  listeners: Set<() => void>;
  cleanup: () => void;
}

const videoPool = new Map<string, VideoPoolEntry>();
const videoPoolListeners = new Set<() => void>();

// Pool identity must stay stable across transient transport state like
// play/pause. If autoplay participates in the key, toggling playback swaps the
// underlying <video> element and loses currentTime.
function getVideoPoolKey(src: string, { loop, muted, playbackRate }: UseKVideoOptions): string {
  return [src, loop ? '1' : '0', muted ? '1' : '0', String(playbackRate)].join('|');
}

function notifyVideoPoolListeners() {
  videoPoolListeners.forEach((listener) => listener());
}

// Subscribes to pool membership changes (entries added/removed/loaded). Lets
// outside controllers watch for the layer-video element to come online.
export function subscribeToVideoPool(listener: () => void): () => void {
  videoPoolListeners.add(listener);
  return () => { videoPoolListeners.delete(listener); };
}

// Looks up the loaded HTMLVideoElement for the layer-video src using the same
// stable rendering options that were used to acquire/retain it.
export function getLayerVideoElement(src: string | null, options: UseKVideoOptions): HTMLVideoElement | null {
  if (!src) return null;
  const key = getVideoPoolKey(src, options);
  const entry = videoPool.get(key);
  if (!entry || entry.status !== 'loaded') return null;
  return entry.video;
}

export function retainVideoSource(src: string, options: UseKVideoOptions): () => void {
  const entry = acquireVideoEntry(src, options);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseVideoEntry(entry);
  };
}

function toResolvedMediaState(entry: VideoPoolEntry): ResolvedMediaState {
  if (entry.status === 'loaded') {
    return { status: 'loaded', resource: entry.video };
  }

  return { status: entry.status };
}

function notifyListeners(entry: VideoPoolEntry) {
  entry.listeners.forEach((listener) => {
    listener();
  });
}

function createVideoPoolEntry(src: string, { autoplay, loop, muted, playbackRate }: UseKVideoOptions): VideoPoolEntry {
  const video = document.createElement('video');
  video.src = src;
  video.autoplay = autoplay;
  video.loop = loop;
  video.muted = muted;
  video.playbackRate = playbackRate;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';

  const entry: VideoPoolEntry = {
    key: getVideoPoolKey(src, { autoplay, loop, muted, playbackRate }),
    status: 'loading',
    refCount: 0,
    video,
    listeners: new Set(),
    cleanup: () => undefined,
  };

  const handleReady = () => {
    entry.status = 'loaded';
    notifyListeners(entry);
    notifyVideoPoolListeners();
    if (autoplay) {
      void video.play().catch(() => undefined);
    }
  };

  const handleError = () => {
    if (entry.status === 'loaded') return;
    entry.status = 'broken';
    notifyListeners(entry);
    notifyVideoPoolListeners();
  };

  video.addEventListener('loadeddata', handleReady);
  video.addEventListener('error', handleError);
  entry.cleanup = () => {
    video.removeEventListener('loadeddata', handleReady);
    video.removeEventListener('error', handleError);
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    handleReady();
  } else {
    video.load();
  }

  return entry;
}

function acquireVideoEntry(src: string, options: UseKVideoOptions): VideoPoolEntry {
  const key = getVideoPoolKey(src, options);
  let entry = videoPool.get(key);
  const created = !entry;
  if (!entry) {
    entry = createVideoPoolEntry(src, options);
    videoPool.set(key, entry);
  }

  entry.refCount += 1;
  if (entry.status === 'loaded' && options.autoplay) {
    void entry.video.play().catch(() => undefined);
  }
  if (created) notifyVideoPoolListeners();
  return entry;
}

function releaseVideoEntry(entry: VideoPoolEntry) {
  entry.refCount -= 1;
  if (entry.refCount > 0) return;

  videoPool.delete(entry.key);
  entry.cleanup();
  notifyVideoPoolListeners();
}

export function useKVideo(src: string | null, { autoplay, loop, muted, playbackRate }: UseKVideoOptions): ResolvedMediaState {
  const [state, setState] = useState<ResolvedMediaState>({ status: 'empty' });
  const activeEntryRef = useRef<VideoPoolEntry | null>(null);

  useEffect(() => {
    if (!src) {
      const currentEntry = activeEntryRef.current;
      if (currentEntry) {
        releaseVideoEntry(currentEntry);
      }
      activeEntryRef.current = null;
      setState({ status: 'empty' });
      return;
    }

    const entry = acquireVideoEntry(src, { autoplay, loop, muted, playbackRate });
    activeEntryRef.current = entry;
    setState(toResolvedMediaState(entry));

    const handleChange = () => {
      setState(toResolvedMediaState(entry));
    };

    entry.listeners.add(handleChange);

    return () => {
      entry.listeners.delete(handleChange);
      if (activeEntryRef.current === entry) {
        activeEntryRef.current = null;
      }
      releaseVideoEntry(entry);
    };
  }, [loop, muted, playbackRate, src]);

  useEffect(() => {
    const entry = activeEntryRef.current;
    if (!entry) return;
    entry.video.autoplay = autoplay;
    if (entry.status === 'loaded' && autoplay) {
      void entry.video.play().catch(() => undefined);
    }
  }, [autoplay]);

  useEffect(() => {
    return () => {
      const currentEntry = activeEntryRef.current;
      if (!currentEntry) return;
      releaseVideoEntry(currentEntry);
      activeEntryRef.current = null;
    };
  }, []);

  return state;
}
