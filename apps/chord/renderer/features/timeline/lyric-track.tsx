// The lyric track row: one absolutely-positioned clip per cue, with
// click/shift/cmd selection, double-click to inspect, drag-to-move,
// edge-drag-to-trim, marquee selection over empty space, and snapping (with
// a visible guide line) against cue boundaries and the playhead.
import { useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link2Off } from 'lucide-react';
import { cn } from '@lumacast/ui';
import { activeCueIndexAt, cueEndMs, quantizeToFrame, snapTimeMs } from '../../../shared/cue-model';
import type { ChordCue } from '../../../shared/project';
import type { SelectMode } from '../../store/types';
import { useChordStore } from '../../store';
import { timelineEndMs } from '../playback';
import { msToPx, pxToMs, snapCandidates } from './timeline-math';

export const LYRIC_TRACK_HEIGHT_PX = 56;

const SNAP_TOLERANCE_PX = 8;
const MARQUEE_THRESHOLD_PX = 3;
const EDGE_HANDLE_WIDTH_PX = 6;
const MIN_CLIP_WIDTH_PX = 4;

function selectModeFromEvent(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): SelectMode {
  if (event.shiftKey) return 'add';
  if (event.metaKey || event.ctrlKey) return 'toggle';
  return 'replace';
}

type DragState =
  | { kind: 'move'; pointerId: number; ids: string[]; anchorStartMs: number; pointerStartMs: number; lastDeltaMs: number }
  | { kind: 'trim'; pointerId: number; id: string; edge: 'start' | 'end' }
  | { kind: 'marquee'; pointerId: number; startClientX: number; startMs: number; moved: boolean };

export function LyricTrack() {
  const cues = useChordStore((state) => state.document.project.cues);
  const project = useChordStore((state) => state.document.project);
  const selection = useChordStore((state) => state.selection);
  const timeMs = useChordStore((state) => state.playback.timeMs);
  const view = useChordStore((state) => state.timeline);
  const tool = useChordStore((state) => state.tool);
  const tapIndex = useChordStore((state) => state.tapIndex);
  const tapOrder = useChordStore((state) => state.tapOrder);
  const select = useChordStore((state) => state.select);
  const clearSelection = useChordStore((state) => state.clearSelection);
  const seek = useChordStore((state) => state.seek);
  const moveCues = useChordStore((state) => state.moveCues);
  const trimCue = useChordStore((state) => state.trimCue);
  const setInspectorTab = useChordStore((state) => state.setInspectorTab);

  const fps = project.composition.fps;
  const endOfTimelineMs = timelineEndMs(project);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marqueeRange, setMarqueeRange] = useState<{ startMs: number; endMs: number } | null>(null);
  const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null);

  const activeIndex = useMemo(() => activeCueIndexAt(cues, timeMs, endOfTimelineMs), [cues, timeMs, endOfTimelineMs]);

  function msAtClientX(clientX: number): number {
    const bounds = contentRef.current?.getBoundingClientRect();
    const offsetX = bounds ? clientX - bounds.left : 0;
    return view.scrollMs + pxToMs(offsetX, view.zoom);
  }

  function toleranceMs(): number {
    return pxToMs(SNAP_TOLERANCE_PX, view.zoom);
  }

  function handleClipPointerDown(event: ReactPointerEvent<HTMLDivElement>, cue: ChordCue) {
    event.stopPropagation();
    const mode = selectModeFromEvent(event);
    const alreadySelected = selection.includes(cue.id);
    if (mode !== 'replace' || !alreadySelected) select([cue.id], mode);

    // A drag always carries the resulting selection: the clicked cue plus
    // whatever else was already selected, so dragging one clip in a
    // multi-selection moves the whole group.
    const ids = mode === 'replace'
      ? (alreadySelected ? selection : [cue.id])
      : (selection.includes(cue.id) ? selection : [...selection, cue.id]);

    event.currentTarget.setPointerCapture(event.pointerId);
    // One undo step per drag, however many pointer moves it takes.
    useChordStore.getState().beginTransaction(ids.length > 1 ? `Move ${ids.length} cues` : 'Move cue');
    dragRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      ids,
      anchorStartMs: cue.startMs,
      pointerStartMs: msAtClientX(event.clientX),
      lastDeltaMs: 0,
    };
  }

  function handleClipDoubleClick(cue: ChordCue) {
    select([cue.id], 'replace');
    setInspectorTab('cue');
  }

  function handleHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>, cue: ChordCue, edge: 'start' | 'end') {
    event.stopPropagation();
    select([cue.id], 'replace');
    event.currentTarget.setPointerCapture(event.pointerId);
    useChordStore.getState().beginTransaction('Trim cue');
    dragRef.current = { kind: 'trim', pointerId: event.pointerId, id: cue.id, edge };
  }

  function handleTrackPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'marquee',
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startMs: msAtClientX(event.clientX),
      moved: false,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.kind === 'move') {
      const currentMs = msAtClientX(event.clientX);
      const rawCandidate = drag.anchorStartMs + (currentMs - drag.pointerStartMs);
      let candidate = rawCandidate;
      let snappedTo: number | null = null;
      if (!event.altKey) {
        const snapped = snapTimeMs(rawCandidate, snapCandidates(cues, timeMs, drag.ids), toleranceMs());
        if (snapped !== rawCandidate) snappedTo = snapped;
        candidate = snapped;
      }
      candidate = quantizeToFrame(candidate, fps);
      const deltaMs = candidate - drag.anchorStartMs;
      const incrementalMs = deltaMs - drag.lastDeltaMs;
      if (incrementalMs !== 0) {
        moveCues(drag.ids, incrementalMs);
        drag.lastDeltaMs = deltaMs;
      }
      setSnapGuideMs(snappedTo);
      return;
    }

    if (drag.kind === 'trim') {
      const rawCandidate = msAtClientX(event.clientX);
      let candidate = rawCandidate;
      let snappedTo: number | null = null;
      if (!event.altKey) {
        const snapped = snapTimeMs(rawCandidate, snapCandidates(cues, timeMs, [drag.id]), toleranceMs());
        if (snapped !== rawCandidate) snappedTo = snapped;
        candidate = snapped;
      }
      trimCue(drag.id, drag.edge, Math.max(0, candidate));
      setSnapGuideMs(snappedTo);
      return;
    }

    const currentMs = msAtClientX(event.clientX);
    const moved = drag.moved || Math.abs(event.clientX - drag.startClientX) > MARQUEE_THRESHOLD_PX;
    dragRef.current = { ...drag, moved };
    setMarqueeRange({ startMs: Math.min(drag.startMs, currentMs), endMs: Math.max(drag.startMs, currentMs) });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.kind === 'marquee') {
      if (!drag.moved) {
        clearSelection();
        seek(Math.max(0, drag.startMs));
      } else {
        const range = marqueeRange ?? { startMs: drag.startMs, endMs: drag.startMs };
        const ids = cues
          .filter((cue, index) => cue.startMs < range.endMs && cueEndMs(cues, index, endOfTimelineMs) > range.startMs)
          .map((cue) => cue.id);
        select(ids, selectModeFromEvent(event));
      }
    }

    if (drag.kind === 'move' || drag.kind === 'trim') {
      useChordStore.getState().endTransaction();
    }

    dragRef.current = null;
    setMarqueeRange(null);
    setSnapGuideMs(null);
  }

  return (
    <div className="flex border-b border-secondary" style={{ height: LYRIC_TRACK_HEIGHT_PX }} data-ui-region="lyric-track">
      <div className="flex w-32 shrink-0 flex-col justify-center gap-0.5 border-r border-secondary bg-primary px-2">
        <span className="label-xs text-secondary">Lyrics</span>
        <span className="paragraph-xs text-tertiary">{cues.length} {cues.length === 1 ? 'cue' : 'cues'}</span>
      </div>
      <div
        ref={contentRef}
        className="relative flex-1 overflow-hidden bg-secondary"
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {cues.map((cue, index) => {
          const endMs = cueEndMs(cues, index, endOfTimelineMs);
          const left = msToPx(cue.startMs - view.scrollMs, view.zoom);
          const width = Math.max(MIN_CLIP_WIDTH_PX, msToPx(endMs - cue.startMs, view.zoom));
          const selected = selection.includes(cue.id);
          const active = index === activeIndex;
          // `cues` is sorted by `startMs` (which tapping just re-times), so
          // the "next cue to tap" is looked up by id via `tapOrder`, not by
          // its live array position — see the field doc in `store/types.ts`.
          const tapTarget = tool === 'tap' && tapIndex !== null && tapOrder?.[tapIndex] === cue.id;
          return (
            <div
              key={cue.id}
              className={cn(
                'absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-sm border px-1.5 label-xs text-primary',
                selected ? 'border-brand bg-brand/25' : 'border-secondary bg-tertiary',
                active ? 'ring-1 ring-brand' : null,
                tapTarget ? 'outline outline-2 outline-offset-1 outline-warning' : null,
              )}
              style={{ left, width }}
              onPointerDown={(event) => handleClipPointerDown(event, cue)}
              onDoubleClick={() => handleClipDoubleClick(cue)}
            >
              <span className="min-w-0 flex-1 truncate">{cue.text || 'Empty cue'}</span>
              {cue.override !== null ? (
                <Link2Off className="ml-1 size-3 shrink-0 text-tertiary" aria-label="Detached from theme" />
              ) : null}
              <div
                className="absolute left-0 top-0 h-full cursor-ew-resize"
                style={{ width: EDGE_HANDLE_WIDTH_PX }}
                onPointerDown={(event) => handleHandlePointerDown(event, cue, 'start')}
              />
              <div
                className="absolute right-0 top-0 h-full cursor-ew-resize"
                style={{ width: EDGE_HANDLE_WIDTH_PX }}
                onPointerDown={(event) => handleHandlePointerDown(event, cue, 'end')}
              />
            </div>
          );
        })}
        {marqueeRange ? (
          <div
            className="pointer-events-none absolute top-0 h-full border border-brand bg-brand/10"
            style={{
              left: msToPx(marqueeRange.startMs - view.scrollMs, view.zoom),
              width: msToPx(marqueeRange.endMs - marqueeRange.startMs, view.zoom),
            }}
          />
        ) : null}
        {snapGuideMs !== null ? (
          <div
            className="pointer-events-none absolute top-0 h-full w-px bg-warning"
            style={{ left: msToPx(snapGuideMs - view.scrollMs, view.zoom) }}
          />
        ) : null}
        {cues.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center paragraph-xs text-tertiary">
            No cues yet
          </div>
        ) : null}
      </div>
    </div>
  );
}
