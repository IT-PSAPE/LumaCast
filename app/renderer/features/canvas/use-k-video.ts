import { useEffect, useRef, useState } from 'react';
import type { ResolvedMediaState } from './scene-types';

interface UseKVideoOptions {
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  playbackRate: number;
}

// Video transport is split in two:
//
//  1. The dedicated video layer — exactly one HTMLVideoElement per `src`,
//     owned by `retainVideoSource` and looked up via `getLayerVideoElement`.
//     The playback context drives this element (play/pause/seek/mute via the
//     transport UI) and keeps it alive across surface unmounts so audio does
//     not stop when leaving Show.
//
//  2. Every other rendered video — slides, overlays, stages, editor canvases,
//     bin thumbnails — gets its own per-instance HTMLVideoElement via
//     `useKVideo`. No state is shared across instances, so a muted slide can
//     never have its audio leaked by another consumer of the same `src`, and
//     a preview never inherits transport state from the live layer.

interface LayerEntry {
  src: string;
  video: HTMLVideoElement;
  status: 'loading' | 'broken' | 'loaded';
  refCount: number;
  options: UseKVideoOptions;
  cleanup: () => void;
}

const layerRegistry = new Map<string, LayerEntry>();
const layerListeners = new Set<() => void>();

function notifyLayerListeners() {
  layerListeners.forEach((listener) => { listener(); });
}

// Notifies when a layer-registry entry is created, loaded, broken, or
// destroyed. Used by the playback context to (re-)resolve the layer element
// via `getLayerVideoElement`.
export function subscribeToVideoPool(listener: () => void): () => void {
  layerListeners.add(listener);
  return () => { layerListeners.delete(listener); };
}

export function getLayerVideoElement(src: string | null): HTMLVideoElement | null {
  if (!src) return null;
  const entry = layerRegistry.get(src);
  if (!entry || entry.status !== 'loaded') return null;
  return entry.video;
}

function createVideoElement(src: string, options: UseKVideoOptions): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = src;
  video.autoplay = options.autoplay;
  video.loop = options.loop;
  video.muted = options.muted;
  video.playbackRate = options.playbackRate;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.preload = 'metadata';
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
    return;
  }
  if (!video.paused) video.pause();
}

export interface VideoLayerHandle {
  release(): void;
  setOptions(options: UseKVideoOptions): void;
}

function makeLayerEntry(src: string, options: UseKVideoOptions): LayerEntry {
  const video = createVideoElement(src, options);
  const entry: LayerEntry = {
    src,
    video,
    status: 'loading',
    refCount: 0,
    options,
    cleanup: () => undefined,
  };

  const handleReady = () => {
    if (entry.status === 'loaded') return;
    entry.status = 'loaded';
    notifyLayerListeners();
    if (entry.options.autoplay) {
      void video.play().catch(() => undefined);
    }
  };
  const handleError = () => {
    if (entry.status === 'loaded') return;
    entry.status = 'broken';
    notifyLayerListeners();
  };

  video.addEventListener('loadeddata', handleReady);
  video.addEventListener('error', handleError);
  entry.cleanup = () => {
    video.removeEventListener('loadeddata', handleReady);
    video.removeEventListener('error', handleError);
    destroyVideoElement(video);
  };

  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    entry.status = 'loaded';
  } else {
    video.load();
  }
  return entry;
}

export function retainVideoSource(src: string, initialOptions: UseKVideoOptions): VideoLayerHandle {
  let entry = layerRegistry.get(src);
  const created = !entry;
  if (!entry) {
    entry = makeLayerEntry(src, initialOptions);
    layerRegistry.set(src, entry);
  }
  const e = entry;
  e.refCount += 1;
  e.options = initialOptions;
  applyVideoOptions(e.video, initialOptions);
  if (created) notifyLayerListeners();

  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      e.refCount -= 1;
      if (e.refCount > 0) return;
      layerRegistry.delete(e.src);
      e.cleanup();
      notifyLayerListeners();
    },
    setOptions(next: UseKVideoOptions) {
      if (released) return;
      e.options = next;
      applyVideoOptions(e.video, next);
    },
  };
}

// `layerOwned` opts the hook into reading the dedicated layer element from
// the registry instead of creating its own. SceneNodeMedia sets this when the
// node is the sentinel layer-video node so all live surfaces (show, NDI,
// stage) render frames from the same playback-transport-owned element.
export function useKVideo(
  src: string | null,
  { autoplay, loop, muted, playbackRate }: UseKVideoOptions,
  layerOwned: boolean = false,
): ResolvedMediaState {
  const [state, setState] = useState<ResolvedMediaState>({ status: 'empty' });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const optionsRef = useRef<UseKVideoOptions>({ autoplay, loop, muted, playbackRate });
  optionsRef.current = { autoplay, loop, muted, playbackRate };

  useEffect(() => {
    if (!src) {
      videoRef.current = null;
      setState({ status: 'empty' });
      return;
    }

    if (layerOwned) {
      const refresh = () => {
        const entry = layerRegistry.get(src);
        if (!entry) {
          setState({ status: 'loading' });
          return;
        }
        if (entry.status === 'loaded') {
          setState({ status: 'loaded', resource: entry.video });
          return;
        }
        setState({ status: entry.status });
      };
      refresh();
      layerListeners.add(refresh);
      return () => { layerListeners.delete(refresh); };
    }

    const video = createVideoElement(src, optionsRef.current);
    videoRef.current = video;
    setState({ status: 'loading' });

    const handleReady = () => {
      setState({ status: 'loaded', resource: video });
      applyVideoOptions(video, optionsRef.current);
    };
    const handleError = () => {
      setState({ status: 'broken' });
    };

    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('error', handleError);
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      handleReady();
    } else {
      video.load();
    }

    return () => {
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('error', handleError);
      destroyVideoElement(video);
      videoRef.current = null;
    };
  }, [src, layerOwned]);

  useEffect(() => {
    if (layerOwned) return;
    const video = videoRef.current;
    if (!video) return;
    applyVideoOptions(video, { autoplay, loop, muted, playbackRate });
  }, [layerOwned, autoplay, loop, muted, playbackRate]);

  return state;
}
