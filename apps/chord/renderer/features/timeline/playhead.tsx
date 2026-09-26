// The playhead: a line + triangle head spanning the tracks stack, draggable
// to scrub. Rendered as a sibling of the ruler/audio/lyric rows inside the
// tracks-stack wrapper, whose bounds (minus the shared header width) it uses
// to convert pointer position to time.
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useChordStore } from '../../store';
import { msToPx, pxToMs, TRACK_HEADER_WIDTH_PX } from './timeline-math';

export function Playhead() {
  const timeMs = useChordStore((state) => state.playback.timeMs);
  const view = useChordStore((state) => state.timeline);
  const seek = useChordStore((state) => state.seek);
  const draggingRef = useRef(false);

  const left = TRACK_HEADER_WIDTH_PX + msToPx(timeMs - view.scrollMs, view.zoom);

  function msAtClientX(clientX: number, target: HTMLElement): number {
    const bounds = target.parentElement?.getBoundingClientRect();
    const originX = (bounds?.left ?? 0) + TRACK_HEADER_WIDTH_PX;
    return Math.max(0, view.scrollMs + pxToMs(clientX - originX, view.zoom));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    seek(msAtClientX(event.clientX, event.currentTarget));
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    seek(msAtClientX(event.clientX, event.currentTarget));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="pointer-events-none absolute top-0 z-20 h-full" style={{ left, width: 0 }} data-ui-region="playhead">
      <div
        className="pointer-events-auto absolute -left-2 top-0 h-3 w-4 cursor-ew-resize"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <svg viewBox="0 0 16 12" className="h-3 w-4 text-brand" fill="currentColor" aria-hidden="true">
          <path d="M0 0H16L8 12Z" />
        </svg>
      </div>
      <div className="absolute left-0 top-3 bg-brand" style={{ width: 1, height: 'calc(100% - 0.75rem)' }} />
    </div>
  );
}
