// The one hidden <audio> element the app ever creates. Mounted once by the
// composing screen, it owns the DOM media element the clock drives and
// reports the probed duration back into the project the first time it is
// unknown (a freshly imported file has `durationMs: null` until then).
import { useEffect, useState } from 'react';
import { useChordStore } from '../../store';
import { usePlaybackClock } from './use-playback-clock';

export function useAudioDuration(audioElement: HTMLAudioElement | null): void {
  useEffect(() => {
    if (!audioElement) return;
    function handleLoadedMetadata() {
      const state = useChordStore.getState();
      const currentAudio = state.document.project.audio;
      if (!currentAudio || currentAudio.durationMs != null) return;
      const durationMs = Math.round((audioElement!.duration || 0) * 1000);
      if (!Number.isFinite(durationMs) || durationMs <= 0) return;
      state.setAudio({ ...currentAudio, durationMs }, state.media.audioUrl);
    }
    audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => audioElement.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, [audioElement]);
}

export function AudioElement() {
  const audioUrl = useChordStore((state) => state.media.audioUrl);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  usePlaybackClock(audioElement);
  useAudioDuration(audioElement);

  return (
    <audio
      ref={setAudioElement}
      src={audioUrl ?? undefined}
      preload="auto"
      className="hidden"
      aria-hidden="true"
      data-ui-region="audio-element"
    />
  );
}
