// The timeline: transport bar, then a scrollable tracks stack (ruler, audio,
// lyrics, playhead). Owns view measurement (viewport width), wheel-driven
// pan/zoom, auto-follow while playing, and the global keyboard shortcuts.
import { useEffect, useRef } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { useChordStore } from '../../store';
import { timelineEndMs } from '../playback';
import { AUDIO_TRACK_HEIGHT_PX, AudioTrack } from './audio-track';
import { LYRIC_TRACK_HEIGHT_PX, LyricTrack } from './lyric-track';
import { Playhead } from './playhead';
import { RULER_HEIGHT_PX, TimeRuler } from './time-ruler';
import { autoScrollFollow, clampScroll, pxToMs, TRACK_HEADER_WIDTH_PX } from './timeline-math';
import { TransportBar } from './transport-bar';
import { useTimelineShortcuts } from './use-timeline-shortcuts';

const TIMELINE_HEIGHT_PX = 220;
const TRACKS_HEIGHT_PX = RULER_HEIGHT_PX + AUDIO_TRACK_HEIGHT_PX + LYRIC_TRACK_HEIGHT_PX;
const WHEEL_ZOOM_FACTOR = 1.1;

export function Timeline() {
  useTimelineShortcuts();

  const view = useChordStore((state) => state.timeline);
  const playing = useChordStore((state) => state.playback.playing);
  const timeMs = useChordStore((state) => state.playback.timeMs);
  const project = useChordStore((state) => state.document.project);
  const setTimelineView = useChordStore((state) => state.setTimelineView);
  const zoomBy = useChordStore((state) => state.zoomBy);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const durationMs = timelineEndMs(project);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null) setTimelineView({ viewportWidth: Math.max(0, width - TRACK_HEADER_WIDTH_PX) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [setTimelineView]);

  useEffect(() => {
    if (!playing) return;
    const nextScrollMs = clampScroll(autoScrollFollow(timeMs, view), durationMs, view);
    if (nextScrollMs !== view.scrollMs) setTimelineView({ scrollMs: nextScrollMs });
    // Runs once per tick: re-deriving from the latest `view`/`durationMs` on
    // every `timeMs` change (while playing) is the point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeMs]);

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const cursorPx = event.clientX - bounds.left - TRACK_HEADER_WIDTH_PX;
      const anchorMs = view.scrollMs + pxToMs(Math.max(0, cursorPx), view.zoom);
      zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR, anchorMs);
      return;
    }

    const container = event.currentTarget;
    const overflowsVertically = container.scrollHeight > container.clientHeight;
    const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      ? event.deltaX
      : (overflowsVertically ? 0 : event.deltaY);
    if (horizontalDelta === 0) return;
    event.preventDefault();
    setTimelineView({ scrollMs: clampScroll(view.scrollMs + pxToMs(horizontalDelta, view.zoom), durationMs, view) });
  }

  return (
    <div
      className="flex flex-col border-t border-secondary bg-primary"
      style={{ height: TIMELINE_HEIGHT_PX }}
      data-ui-region="timeline"
    >
      <TransportBar />
      <div ref={scrollContainerRef} className="relative flex-1 overflow-y-auto overflow-x-hidden" onWheel={handleWheel}>
        <div className="relative" style={{ height: TRACKS_HEIGHT_PX }} data-ui-region="timeline-tracks">
          <TimeRuler />
          <AudioTrack />
          <LyricTrack />
          <Playhead />
        </div>
      </div>
    </div>
  );
}
