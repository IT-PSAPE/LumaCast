import { Slider } from '@base-ui/react/slider';
import { formatPlaybackTime } from './format-playback-time';
import { useVideoFilmstrip } from './use-video-filmstrip';

interface VideoFilmstripTrackProps {
  src?: string;
  duration: number;
  currentTime: number;
  disabled: boolean;
  onSeek: (seconds: number) => void;
  onScrubStart: () => void;
  onScrubEnd: () => void;
}

export function VideoFilmstripTrack({
  src,
  duration,
  currentTime,
  disabled,
  onSeek,
  onScrubStart,
  onScrubEnd,
}: VideoFilmstripTrackProps) {
  const filmstrip = useVideoFilmstrip(src);
  const safeTime = Math.max(0, Math.min(currentTime, duration));
  const progress = duration > 0 ? safeTime / duration * 100 : 0;

  return (
    <div className="relative">
      <div
        data-ui-region="video-filmstrip"
        className="relative h-16 overflow-hidden rounded border border-brand_solid/30 bg-brand/10"
      >
        <div aria-hidden="true" className="absolute inset-0 flex">
          {Array.from({ length: 12 }, (_, index) => {
            const frame = filmstrip.frames[index];
            return frame
              ? (
                <img
                  key={`${src ?? 'video'}:${index}`}
                  src={frame}
                  alt=""
                  className="h-full min-w-0 flex-1 bg-black object-contain"
                  draggable={false}
                />
              )
              : <div key={index} className={index % 2 === 0 ? 'min-w-0 flex-1 bg-tertiary/60' : 'min-w-0 flex-1 bg-secondary/60'} />;
          })}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-brand/15" style={{ width: `${progress}%` }} />
        {src && filmstrip.status !== 'ready' ? (
          <span className="pointer-events-none absolute bottom-1 left-2 rounded bg-primary/80 px-1 text-[10px] text-tertiary">
            {filmstrip.status === 'loading' ? 'Loading preview…' : 'Preview unavailable'}
          </span>
        ) : null}
        <Slider.Root
          value={safeTime}
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
            className="absolute inset-0 h-full w-full cursor-ew-resize has-[input:focus-visible]:bg-white/20"
          >
            <Slider.Thumb aria-label="Video scrubber" onBlur={onScrubEnd} className="outline-none" />
          </Slider.Control>
        </Slider.Root>
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-px bg-white shadow-sm" style={{ left: `${progress}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-tertiary">
        <span>{formatPlaybackTime(safeTime)}</span>
        <span>{formatPlaybackTime(duration)}</span>
      </div>
    </div>
  );
}
