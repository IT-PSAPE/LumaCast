// The single clock driving `playback.timeMs`. One instance is mounted
// (inside `AudioElement`) for the whole app; every other control (transport
// buttons, the ruler, the lyric track) only ever reads `playback` state or
// calls `seek`/`play`/`pause`/`stepFrames` — never touches `audio.currentTime`
// or `requestAnimationFrame` directly.
import { useEffect, useRef } from 'react';
import { frameDurationMs } from '../../../shared/cue-model';
import { useChordStore } from '../../store';
import { timelineEndMs } from './timeline-end';

export function usePlaybackClock(audioElement: HTMLAudioElement | null): void {
  const playing = useChordStore((state) => state.playback.playing);
  const timeMs = useChordStore((state) => state.playback.timeMs);

  // performance.now()-based clock, used only when there is no audio element.
  const clockOffsetMsRef = useRef(0);
  const clockStartRef = useRef(0);
  // The last timeMs this hook itself wrote via `tick`, so an external seek
  // (the ruler, a keyboard shortcut, tap-to-mark, ...) can be told apart from
  // our own per-frame progress and force a resync instead of being ignored.
  const lastTickMsRef = useRef(timeMs);
  const frameIdRef = useRef<number | null>(null);

  // Drive `audio.play()` / `audio.pause()` from `playback.playing`.
  useEffect(() => {
    if (!audioElement) return;
    if (playing) {
      void audioElement.play().catch(() => {
        // Autoplay can be rejected before the first user gesture; the user
        // pressing play again after interacting with the page will retry.
      });
    } else {
      audioElement.pause();
    }
  }, [playing, audioElement]);

  // Resync on an external seek: `timeMs` moved by more than one frame since
  // the last value this hook itself produced.
  useEffect(() => {
    const state = useChordStore.getState();
    const frameMs = frameDurationMs(state.document.project.composition.fps);
    const isExternalSeek = Math.abs(timeMs - lastTickMsRef.current) > frameMs;
    if (isExternalSeek) {
      if (audioElement && Math.abs(audioElement.currentTime * 1000 - timeMs) > frameMs) {
        audioElement.currentTime = timeMs / 1000;
      }
      clockOffsetMsRef.current = timeMs;
      clockStartRef.current = performance.now();
    }
    lastTickMsRef.current = timeMs;
  }, [timeMs, audioElement]);

  // The per-frame loop, only while playing.
  useEffect(() => {
    if (!playing) return;

    if (!audioElement) {
      clockOffsetMsRef.current = useChordStore.getState().playback.timeMs;
      clockStartRef.current = performance.now();
    }

    function step() {
      const state = useChordStore.getState();
      const endMs = timelineEndMs(state.document.project);
      const rawMs = audioElement
        ? audioElement.currentTime * 1000
        : clockOffsetMsRef.current + (performance.now() - clockStartRef.current);

      if (rawMs >= endMs) {
        if (state.playback.loop) {
          if (audioElement) audioElement.currentTime = 0;
          clockOffsetMsRef.current = 0;
          clockStartRef.current = performance.now();
          lastTickMsRef.current = 0;
          state.tick(0);
          frameIdRef.current = requestAnimationFrame(step);
          return;
        }
        lastTickMsRef.current = endMs;
        state.tick(endMs);
        state.pause();
        frameIdRef.current = null;
        return;
      }

      lastTickMsRef.current = rawMs;
      state.tick(rawMs);
      frameIdRef.current = requestAnimationFrame(step);
    }

    frameIdRef.current = requestAnimationFrame(step);
    return () => {
      if (frameIdRef.current != null) cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    };
  }, [playing, audioElement]);
}
