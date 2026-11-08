// The lyric track row: one absolutely-positioned clip per cue, with
// click/shift/cmd selection, double-click to inspect, drag-to-move,
// edge-drag-to-trim, marquee selection over empty space, and snapping (with
// a visible guide line) against cue boundaries and the playhead.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { Link2Off } from 'lucide-react';
import { cn } from '@lumacast/ui';
import { activeCueIndexAt, cueEndMs, quantizeToFrame, snapTimeMs } from '../../../shared/cue-model';
import type { ChordCue } from '../../../shared/project';
import type { SelectMode } from '../../store/types';
import { useChordStore } from '../../store';
import { timelineEndMs } from '../../utils/timeline-end';
import { formatTimecode } from '../../utils/format-time';
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
  const selectFromInteraction = useChordStore((state) => state.selectFromInteraction);
  const clearSelection = useChordStore((state) => state.clearSelection);
  const seek = useChordStore((state) => state.seek);
  const moveCues = useChordStore((state) => state.moveCues);
  const trimCue = useChordStore((state) => state.trimCue);
  const setInspectorTab = useChordStore((state) => state.setInspectorTab);
  const setTimelineView = useChordStore((state) => state.setTimelineView);

  const fps = project.composition.fps;
  const endOfTimelineMs = timelineEndMs(project);

  const contentRef = useRef<HTMLDivElement | null>(null);
  const clipRefs = useRef(new Map<string, HTMLDivElement>());
  const lastFocusedClip = useRef<HTMLDivElement | null>(null);
  const ownsFocus = useRef(false);
  const pointerFocus = useRef(false);
  const focusIntent = useRef(0);
  const [focusedCueId, setFocusedCueId] = useState<string | null>(null);
  const [editFocus, setEditFocus] = useState<{ id: string; session: number; intent: number } | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marqueeRange, setMarqueeRange] = useState<{ startMs: number; endMs: number } | null>(null);
  const [snapGuideMs, setSnapGuideMs] = useState<number | null>(null);

  const activeIndex = useMemo(() => activeCueIndexAt(cues, timeMs, endOfTimelineMs), [cues, timeMs, endOfTimelineMs]);
  const cueIds = useMemo(() => cues.map((cue) => cue.id), [cues]);
  const cueIdSet = useMemo(() => new Set(cueIds), [cueIds]);
  const tabStopId = focusedCueId && cueIdSet.has(focusedCueId)
    ? focusedCueId
    : [...selection].reverse().find((id) => cueIdSet.has(id)) ?? cueIds[0] ?? null;

  function cancelEditFocus() {
    focusIntent.current += 1;
    setEditFocus(null);
  }

  function revealCue(cue: ChordCue) {
    const viewportPx = contentRef.current?.getBoundingClientRect().width || view.viewportWidth;
    if (viewportPx <= 0 || view.zoom <= 0) return;
    const index = cues.findIndex((entry) => entry.id === cue.id);
    const clipWidth = clipRefs.current.get(cue.id)?.getBoundingClientRect().width
      || Math.max(MIN_CLIP_WIDTH_PX, msToPx(cueEndMs(cues, index, endOfTimelineMs) - cue.startMs, view.zoom));
    const visibleMs = pxToMs(viewportPx, view.zoom);
    // Include actual padding/borders: a sub-frame cue can render wider than
    // its declared minimum, and its whole focus mark must remain visible.
    const visualEndMs = cue.startMs + pxToMs(clipWidth, view.zoom);
    let scrollMs = view.scrollMs;
    if (clipWidth >= viewportPx || cue.startMs < scrollMs) scrollMs = cue.startMs;
    else if (visualEndMs > scrollMs + visibleMs) scrollMs = visualEndMs - visibleMs;
    setTimelineView({ scrollMs: Math.max(0, scrollMs) });
  }

  function focusCue(id: string) {
    cancelEditFocus();
    pointerFocus.current = false;
    const clip = clipRefs.current.get(id);
    const alreadyFocused = clip === document.activeElement;
    clip?.focus({ preventScroll: true });
    // Home/End and boundary arrows may target the same node after a pan;
    // no focus event fires in that case, but it still needs revealing.
    if (alreadyFocused) {
      const cue = cues.find((entry) => entry.id === id);
      if (cue) revealCue(cue);
    }
  }

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // View movement belongs to timeline.scrollMs, never the hidden element's
    // native scroll position (including scrolling caused by native Tab focus).
    content.scrollLeft = 0;
    if (editFocus) {
      const state = useChordStore.getState();
      const target = document.querySelector<HTMLElement>('[data-ui-focus="cue-text"]');
      if (editFocus.intent === focusIntent.current
        && editFocus.session === state.getDocumentSession()
        && state.selection.length === 1 && state.selection[0] === editFocus.id
        && ownsFocus.current && content.contains(document.activeElement)
        && target?.dataset.cueId === editFocus.id) {
        target.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      }
      setEditFocus(null);
      return;
    }
    // Removing/importing cues can remove the focused DOM node without a blur.
    // Restore only focus this track owned; never steal it from an editor.
    const lostClip = lastFocusedClip.current && !lastFocusedClip.current.isConnected;
    if (ownsFocus.current && ((document.activeElement === content && tabStopId)
      || (lostClip && document.activeElement === document.body))) {
      if (tabStopId) focusCue(tabStopId);
      else if (document.activeElement !== content) content.focus({ preventScroll: true });
    }
  }, [cues, selection, view, tabStopId, editFocus]);

  function handleClipKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, cue: ChordCue) {
    const index = cueIds.indexOf(cue.id);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft': nextIndex = Math.max(0, index - 1); break;
      case 'ArrowRight': nextIndex = Math.min(cues.length - 1, index + 1); break;
      case 'Home': nextIndex = 0; break;
      case 'End': nextIndex = cues.length - 1; break;
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        cancelEditFocus();
        selectFromInteraction(cueIds, cue.id, { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
        return;
      case 'Enter': {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const intent = ++focusIntent.current;
        selectFromInteraction(cueIds, cue.id);
        setInspectorTab('cue');
        setEditFocus({ id: cue.id, session: useChordStore.getState().getDocumentSession(), intent });
        return;
      }
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
    const nextId = cueIds[nextIndex];
    if (nextId) focusCue(nextId);
  }

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
    cancelEditFocus();
    pointerFocus.current = true;
    event.currentTarget.focus({ preventScroll: true });
    const alreadySelected = selection.includes(cue.id);
    const hasModifier = event.shiftKey || event.metaKey || event.ctrlKey;

    // A drag always carries the resulting selection: the clicked cue plus
    // whatever else was already selected, so dragging one clip in a
    // multi-selection moves the whole group.
    const ids = !hasModifier && alreadySelected
      ? selection.filter((id) => cues.some((entry) => entry.id === id))
      : selectFromInteraction(cues.map((entry) => entry.id), cue.id, {
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
      });
    // A modifier-click that removes this cue changes selection only; dragging
    // the now-deselected cue must not move it or the remaining selection.
    const dragIds = ids.includes(cue.id) ? ids : [];

    event.currentTarget.setPointerCapture(event.pointerId);
    // One undo step per drag, however many pointer moves it takes.
    if (dragIds.length > 0) {
      useChordStore.getState().beginTransaction(dragIds.length > 1 ? `Move ${dragIds.length} cues` : 'Move cue');
    }
    dragRef.current = {
      kind: 'move',
      pointerId: event.pointerId,
      ids: dragIds,
      anchorStartMs: cue.startMs,
      pointerStartMs: msAtClientX(event.clientX),
      lastDeltaMs: 0,
    };
  }

  function handleClipDoubleClick(cue: ChordCue) {
    selectFromInteraction(cues.map((entry) => entry.id), cue.id);
    setInspectorTab('cue');
  }

  function handleHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>, cue: ChordCue, edge: 'start' | 'end') {
    event.stopPropagation();
    cancelEditFocus();
    pointerFocus.current = true;
    clipRefs.current.get(cue.id)?.focus({ preventScroll: true });
    selectFromInteraction(cues.map((entry) => entry.id), cue.id);
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
      if (drag.ids.length === 0) return;
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

    if ((drag.kind === 'move' && drag.ids.length > 0) || drag.kind === 'trim') {
      useChordStore.getState().endTransaction();
    }

    dragRef.current = null;
    pointerFocus.current = false;
    setMarqueeRange(null);
    setSnapGuideMs(null);
  }

  return (
    <div className="flex border-b border-secondary" style={{ height: LYRIC_TRACK_HEIGHT_PX }} data-ui-region="lyric-track">
      <div className="flex w-32 shrink-0 flex-col justify-center gap-0.5 border-r border-secondary bg-primary px-2">
        <span className="label-xs text-secondary">Lyrics</span>
      </div>
      <div
        ref={contentRef}
        className="relative flex-1 overflow-hidden bg-secondary"
        role="listbox"
        aria-label="Lyric cues"
        aria-orientation="horizontal"
        aria-multiselectable="true"
        tabIndex={cues.length === 0 ? 0 : -1}
        onFocusCapture={() => { ownsFocus.current = true; }}
        onBlurCapture={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          ownsFocus.current = false;
          pointerFocus.current = false;
          cancelEditFocus();
        }}
        onScroll={(event) => { if (event.currentTarget.scrollLeft !== 0) event.currentTarget.scrollLeft = 0; }}
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {cues.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center paragraph-xs text-tertiary">
            Drop a lyric file, or add a cue
          </div>
        ) : null}
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
              ref={(node) => { if (node) clipRefs.current.set(cue.id, node); else clipRefs.current.delete(cue.id); }}
              role="option"
              aria-selected={selected}
              aria-label={`Cue ${index + 1}, ${formatTimecode(cue.startMs, fps)}: ${cue.text || 'Empty cue'}`}
              tabIndex={cue.id === tabStopId ? 0 : -1}
              className={cn(
                'absolute top-1 bottom-1 flex cursor-grab items-center overflow-hidden rounded-control border px-1.5 label-xs text-primary focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:-outline-offset-2',
                selected
                  ? 'border-brand bg-brand/25 forced-colors:forced-color-adjust-none forced-colors:border-[Highlight] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:ring-0 forced-colors:outline-[Highlight] forced-colors:focus-visible:outline-[HighlightText]!'
                  : 'border-secondary bg-tertiary',
                active ? 'ring-1 ring-brand' : null,
                tapTarget ? 'outline outline-2 outline-offset-1 outline-warning' : null,
              )}
              style={{ left, width }}
              onFocus={(event) => {
                cancelEditFocus();
                setFocusedCueId(cue.id);
                lastFocusedClip.current = event.currentTarget;
                if (!pointerFocus.current) revealCue(cue);
              }}
              onKeyDown={(event) => handleClipKeyDown(event, cue)}
              onPointerDown={(event) => handleClipPointerDown(event, cue)}
              onDoubleClick={() => handleClipDoubleClick(cue)}
            >
              <span className="min-w-0 flex-1 truncate">{cue.text || 'Empty cue'}</span>
              {cue.override !== null ? (
                <Link2Off className="ml-1 size-3 shrink-0 text-tertiary forced-colors:text-current" aria-label="Detached from theme" />
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
      </div>
    </div>
  );
}
