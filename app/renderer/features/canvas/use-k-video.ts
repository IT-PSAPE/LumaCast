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
  consumers: Map<symbol, UseKVideoOptions>;
  cleanup: () => void;
}

const videoPool = new Map<string, VideoPoolEntry>();
const videoPoolListeners = new Set<() => void>();

// Pool identity is `src` alone. All per-surface playback state (autoplay,
// loop, muted, playbackRate) is layered on top via consumer aggregation, so
// toggling any of those does not swap the underlying <video> element and
// never loses currentTime.
function getVideoPoolKey(src: string): string {
  return src;
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

// Looks up the loaded HTMLVideoElement for `src` regardless of playback flags.
export function getLayerVideoElement(src: string | null): HTMLVideoElement | null {
  if (!src) return null;
  const entry = videoPool.get(getVideoPoolKey(src));
  if (!entry || entry.status !== 'loaded') return null;
  return entry.video;
}

export function retainVideoSource(src: string, options: UseKVideoOptions): () => void {
  const consumerId = Symbol(src);
  const entry = acquireVideoEntry(src, options, consumerId);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseVideoEntry(entry, consumerId);
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

function syncVideoEntryState(entry: VideoPoolEntry) {
  const consumers = Array.from(entry.consumers.values());
  const autoplay = consumers.some((consumer) => consumer.autoplay);
  const muted = consumers.every((consumer) => consumer.muted);
  const loop = consumers.some((consumer) => consumer.loop);
  const playbackRate = consumers[0]?.playbackRate ?? 1;

  entry.video.autoplay = autoplay;
  entry.video.loop = loop;
  entry.video.muted = muted;
  entry.video.playbackRate = playbackRate;

  if (entry.status !== 'loaded') return;
  if (autoplay) {
    void entry.video.play().catch(() => undefined);
    return;
  }
  if (!entry.video.paused) {
    entry.video.pause();
  }
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
    key: getVideoPoolKey(src),
    status: 'loading',
    refCount: 0,
    video,
    listeners: new Set(),
    consumers: new Map(),
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

function acquireVideoEntry(src: string, options: UseKVideoOptions, consumerId: symbol): VideoPoolEntry {
  const key = getVideoPoolKey(src);
  let entry = videoPool.get(key);
  const created = !entry;
  if (!entry) {
    entry = createVideoPoolEntry(src, options);
    videoPool.set(key, entry);
  }

  entry.consumers.set(consumerId, options);
  entry.refCount += 1;
  syncVideoEntryState(entry);
  if (created) notifyVideoPoolListeners();
  return entry;
}

function updateVideoEntryConsumer(entry: VideoPoolEntry, consumerId: symbol, options: UseKVideoOptions) {
  if (!entry.consumers.has(consumerId)) return;
  entry.consumers.set(consumerId, options);
  syncVideoEntryState(entry);
}

function releaseVideoEntry(entry: VideoPoolEntry, consumerId: symbol) {
  entry.consumers.delete(consumerId);
  entry.refCount -= 1;
  if (entry.refCount > 0) {
    syncVideoEntryState(entry);
    return;
  }

  videoPool.delete(entry.key);
  entry.cleanup();
  notifyVideoPoolListeners();
}

export function useKVideo(src: string | null, { autoplay, loop, muted, playbackRate }: UseKVideoOptions): ResolvedMediaState {
  const [state, setState] = useState<ResolvedMediaState>({ status: 'empty' });
  const activeEntryRef = useRef<VideoPoolEntry | null>(null);
  const consumerIdRef = useRef(Symbol('use-k-video'));
  const optionsRef = useRef<UseKVideoOptions>({ autoplay, loop, muted, playbackRate });
  optionsRef.current = { autoplay, loop, muted, playbackRate };

  useEffect(() => {
    if (!src) {
      const currentEntry = activeEntryRef.current;
      if (currentEntry) {
        releaseVideoEntry(currentEntry, consumerIdRef.current);
      }
      activeEntryRef.current = null;
      setState({ status: 'empty' });
      return;
    }

    const entry = acquireVideoEntry(src, optionsRef.current, consumerIdRef.current);
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
      releaseVideoEntry(entry, consumerIdRef.current);
    };
  }, [src]);

  useEffect(() => {
    const entry = activeEntryRef.current;
    if (!entry) return;
    updateVideoEntryConsumer(entry, consumerIdRef.current, { autoplay, loop, muted, playbackRate });
  }, [autoplay, loop, muted, playbackRate]);

  useEffect(() => {
    return () => {
      const currentEntry = activeEntryRef.current;
      if (!currentEntry) return;
      releaseVideoEntry(currentEntry, consumerIdRef.current);
      activeEntryRef.current = null;
    };
  }, []);

  return state;
}
