import { useMemo, useState } from 'react';
import { Slider } from '@base-ui/react/slider';
import { Popover } from '@renderer/components/overlays/popover';
import { MarkerRow, type AudioSyncController } from './audio-sync-editor';
import { useAudioWaveform } from './use-audio-waveform';
import { formatPlaybackTime } from './format-playback-time';

interface Props {
  src?: string;
  duration: number;
  currentTime: number;
  disabled: boolean;
  controller: AudioSyncController;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}

export function AudioWaveformTrack({ src, duration, currentTime, disabled, controller, onSeek, onScrubStart, onScrubEnd }: Props) {
  const waveform = useAudioWaveform(src);
  const [selection, setSelection] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const marker = controller.markers.find((entry) => entry.id === selection?.id);
  const progress = duration > 0 ? Math.max(0, Math.min(100, currentTime / duration * 100)) : 0;
  const path = useMemo(() => waveform.peaks.map((peak, index) => {
    const x = (index + 0.5) * 1200 / waveform.peaks.length;
    const height = Math.max(0.6, peak * 17);
    return `M${x.toFixed(1)},${(29 - height).toFixed(1)}V${(29 + height).toFixed(1)}`;
  }).join(' '), [waveform.peaks]);
  return (
    <div className="relative">
      <div className="relative h-16 overflow-hidden rounded border border-brand_solid/30 bg-brand/10" data-ui-region="audio-waveform">
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-brand/10" style={{ width: `${progress}%` }} />
        <svg aria-hidden="true" viewBox="0 0 1200 58" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" style={{ color: 'var(--color-brand)' }}>
          {path ? <path d={path} stroke="currentColor" strokeWidth="1.5" /> : <path d="M0 29H1200" stroke="currentColor" strokeOpacity="0.3" />}
        </svg>
        {waveform.status !== 'ready' && src ? <span className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-tertiary">{waveform.status === 'loading' ? 'Loading waveform…' : 'Waveform unavailable'}</span> : null}
        <Slider.Root
          value={Math.min(currentTime, duration)}
          min={0}
          max={duration > 0 ? duration : 0.01}
          step={0.01}
          disabled={disabled || duration <= 0}
          onValueChange={(next) => onSeek(Array.isArray(next) ? next[0]! : next)}
          className="absolute inset-0 h-full w-full"
        >
          <Slider.Control
            onPointerDown={() => onScrubStart()}
            onPointerUp={onScrubEnd}
            onPointerCancel={onScrubEnd}
            className="absolute inset-0 h-full w-full cursor-crosshair has-[input:focus-visible]:bg-white/20"
          >
            <Slider.Thumb aria-label="Audio scrubber" onBlur={onScrubEnd} className="outline-none" />
          </Slider.Control>
        </Slider.Root>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white" style={{ left: `${progress}%` }} />
        {duration > 0 ? controller.markers.map((entry, index) => {
          const slideIndex = controller.boundSlides.findIndex((slide) => slide.id === entry.slideId);
          const label = `Marker ${index + 1}, ${formatPlaybackTime(entry.timeMs / 1000)}, ${slideIndex >= 0 ? `Slide ${slideIndex + 1}` : 'Unassigned'}`;
          return <button key={entry.id} type="button" aria-label={label} title={label} aria-expanded={selection?.id === entry.id}
            onClick={(event) => { controller.seekToMarker(entry.timeMs); setSelection({ id: entry.id, anchor: event.currentTarget }); }}
            className="absolute top-0 h-full w-5 border-l border-brand_solid text-left focus:outline focus:outline-2 focus:outline-white"
            style={{ left: `clamp(0px, ${Math.min(100, entry.timeMs / 1000 / duration * 100)}%, calc(100% - 20px))` }}>
            <span className="absolute left-0 top-0 rounded-br bg-brand px-1 text-[10px] leading-4 text-white">{slideIndex >= 0 ? slideIndex + 1 : '•'}</span>
          </button>;
        }) : null}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-tertiary"><span>{formatPlaybackTime(currentTime)}</span><span>{formatPlaybackTime(duration)}</span></div>
      <Popover anchor={selection?.anchor ?? null} open={Boolean(marker)} onClose={() => setSelection(null)} placement="top" className="w-80 rounded-md border border-secondary bg-primary p-2 shadow-lg">
        {marker ? <div data-shortcuts-scope="ignore"><MarkerRow marker={marker} index={controller.markers.indexOf(marker)} controller={controller} /></div> : null}
      </Popover>
    </div>
  );
}
