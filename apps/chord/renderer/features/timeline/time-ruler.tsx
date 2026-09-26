// The time ruler: tick marks/labels above the tracks, and the primary way to
// scrub by clicking or dragging anywhere along it.
import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useChordStore } from '../../store';
import { msToPx, pxToMs, rulerTicks } from './timeline-math';

export const RULER_HEIGHT_PX = 28;

export function TimeRuler() {
  const view = useChordStore((state) => state.timeline);
  const fps = useChordStore((state) => state.document.project.composition.fps);
  const playing = useChordStore((state) => state.playback.playing);
  const seek = useChordStore((state) => state.seek);
  const play = useChordStore((state) => state.play);
  const pause = useChordStore((state) => state.pause);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const wasPlayingRef = useRef(false);
  const [scrubbing, setScrubbing] = useState(false);

  const { major, minor } = rulerTicks(view, fps);

  function msAtClientX(clientX: number): number {
    const bounds = contentRef.current?.getBoundingClientRect();
    const offsetX = bounds ? clientX - bounds.left : 0;
    return Math.max(0, view.scrollMs + pxToMs(offsetX, view.zoom));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    wasPlayingRef.current = playing;
    if (playing) pause();
    setScrubbing(true);
    seek(msAtClientX(event.clientX));
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbing) return;
    seek(msAtClientX(event.clientX));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setScrubbing(false);
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false;
      play();
    }
  }

  return (
    <div className="flex border-b border-secondary bg-primary" style={{ height: RULER_HEIGHT_PX }} data-ui-region="time-ruler">
      <div className="w-32 shrink-0 border-r border-secondary" />
      <div
        ref={contentRef}
        className="relative flex-1 cursor-pointer select-none overflow-hidden bg-secondary"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {minor.map((ms) => (
          <div
            key={`minor-${ms}`}
            className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-tertiary"
            style={{ left: msToPx(ms - view.scrollMs, view.zoom) }}
          />
        ))}
        {major.map((tick) => (
          <div
            key={`major-${tick.ms}`}
            className="pointer-events-none absolute bottom-0 h-full w-px bg-tertiary"
            style={{ left: msToPx(tick.ms - view.scrollMs, view.zoom) }}
          >
            <span className="absolute bottom-1.5 left-1 whitespace-nowrap label-xs text-tertiary">{tick.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
