// Best-effort playhead sync for a video background shown by ChordStage's
// SceneSlideBackground fallback path (used in live preview, when no
// `backgroundFrame` prop is supplied). ChordStage resolves that background
// through @lumacast/canvas's *claim*-based video pool (`useKVideo` with
// `layerOwned: false`, inside `SceneSlideBackgroundMedia`), which is private
// to that component tree — this hook has no direct handle on the exact
// `<video>` element Konva paints from there.
//
// The only element this hook CAN reliably reach is one the pool has made
// available as a *layer* (`getLayerVideoElement`), which requires something
// elsewhere in the app to have retained that same source with
// `retainVideoSource` (the pattern LumaCast's own live/NDI output pipeline
// uses — see apps/cast/renderer/contexts/playback/playback-context.tsx).
// LumaChord's editor-preview path never does that retain today, so this hook
// is very often a no-op there: the background video then free-runs on its
// own internal autoplay/loop rather than tracking the playhead exactly. If a
// layer element ever IS available (e.g. a future capture/output surface
// retains it), this hook drives it precisely: play/pause mirrors `playing`,
// and while paused it seeks to `timeMs mod duration` when `loop` is set (a
// non-looping background has no well-defined seek point once it ends, and is
// left alone).
import { useEffect, useRef } from 'react';
import { getLayerVideoElement } from '@lumacast/canvas';

export interface UseBackgroundVideoSyncOptions {
  /** The background video's resolved URL; null for a non-video background. */
  src: string | null;
  playing: boolean;
  timeMs: number;
  loop: boolean;
}

const SEEK_EPSILON_S = 0.05;

export function useBackgroundVideoSync({ src, playing, timeMs, loop }: UseBackgroundVideoSyncOptions): void {
  const lastSeekSRef = useRef<number | null>(null);

  useEffect(() => {
    const video = getLayerVideoElement(src);
    if (!video) return;

    if (playing) {
      lastSeekSRef.current = null;
      if (video.paused) void video.play().catch(() => undefined);
      return;
    }

    if (!video.paused) video.pause();
    if (!loop || !Number.isFinite(video.duration) || video.duration <= 0) return;

    const targetS = (((timeMs / 1000) % video.duration) + video.duration) % video.duration;
    if (lastSeekSRef.current !== null && Math.abs(lastSeekSRef.current - targetS) < SEEK_EPSILON_S) return;
    lastSeekSRef.current = targetS;
    try {
      video.currentTime = targetS;
    } catch {
      // Ignore seeks attempted before metadata is ready.
    }
  }, [src, playing, timeMs, loop]);
}
