// The audio track row: header (file name, or an import affordance when
// there is none) and a canvas-drawn waveform for the currently visible time
// range only.
import { useEffect, useRef } from 'react';
import { useChordStore } from '../../store';
import { timelineEndMs, useAudioWaveform } from '../playback';
import { msToPx } from './timeline-math';

export const AUDIO_TRACK_HEIGHT_PX = 56;

export function AudioTrack() {
  const audio = useChordStore((state) => state.document.project.audio);
  const audioUrl = useChordStore((state) => state.media.audioUrl);
  const view = useChordStore((state) => state.timeline);
  const project = useChordStore((state) => state.document.project);
  const setAudio = useChordStore((state) => state.setAudio);

  const waveform = useAudioWaveform(audioUrl ?? undefined);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const durationMs = timelineEndMs(project);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(0, view.viewportWidth);
    const height = AUDIO_TRACK_HEIGHT_PX;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const peaks = waveform.peaks;
    if (peaks.length === 0 || durationMs <= 0) return;

    const brandColor = getComputedStyle(document.documentElement).getPropertyValue('--color-brand').trim();
    ctx.fillStyle = brandColor || '#0074cc';
    const midY = height / 2;
    const startMs = view.scrollMs;
    const endMs = view.scrollMs + (width / view.zoom) * 1000;
    const startIndex = Math.max(0, Math.floor((startMs / durationMs) * peaks.length) - 1);
    const endIndex = Math.min(peaks.length, Math.ceil((endMs / durationMs) * peaks.length) + 1);

    for (let index = startIndex; index < endIndex; index += 1) {
      const peakMs = (index / peaks.length) * durationMs;
      const x = msToPx(peakMs - startMs, view.zoom);
      if (x < -1 || x > width + 1) continue;
      const barHeight = Math.max(1, (peaks[index] ?? 0) * (height / 2 - 2));
      ctx.fillRect(x, midY - barHeight, 1, barHeight * 2);
    }
  }, [waveform.peaks, view.scrollMs, view.zoom, view.viewportWidth, durationMs]);

  async function handleImportAudio() {
    const imported = await window.lumachord?.importMedia('audio');
    if (!imported) return;
    setAudio({ path: imported.path, name: imported.name, durationMs: null }, imported.url);
  }

  return (
    <div className="flex border-b border-secondary" style={{ height: AUDIO_TRACK_HEIGHT_PX }} data-ui-region="audio-track">
      <div className="flex w-32 shrink-0 flex-col justify-center gap-0.5 border-r border-secondary bg-primary px-2">
        <span className="label-xs text-secondary">Audio</span>
        {audio ? (
          <span className="truncate paragraph-xs text-tertiary" title={audio.name}>{audio.name}</span>
        ) : (
          <button type="button" onClick={handleImportAudio} className="w-fit label-xs text-brand hover:underline">
            Import audio
          </button>
        )}
      </div>
      <div className="relative flex-1 overflow-hidden bg-secondary">
        {audio ? (
          <canvas ref={canvasRef} className="absolute inset-0" />
        ) : (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center paragraph-xs text-tertiary">
            No audio
          </div>
        )}
      </div>
    </div>
  );
}
