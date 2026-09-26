// Pure timeline geometry: px<->ms conversion, the visible window, ruler tick
// placement, zoom-to-fit, scroll clamping, snap candidates, and auto-follow
// scrolling. No React, no store — every function here takes exactly the
// values it needs and is unit-tested directly.
import { cueEndMs } from '../../../shared/cue-model';
import type { ChordCue } from '../../../shared/project';
import type { TimelineView } from '../../store/types';
import { formatClock, formatTimecode } from '../playback';

/** Width, in px, reserved for each track's header column (matches the `w-32` header in every track row). */
export const TRACK_HEADER_WIDTH_PX = 128;

export function msToPx(ms: number, zoom: number): number {
  return (ms / 1000) * zoom;
}

export function pxToMs(px: number, zoom: number): number {
  if (zoom <= 0) return 0;
  return (px / zoom) * 1000;
}

export function visibleRange(view: TimelineView): { startMs: number; endMs: number } {
  return { startMs: view.scrollMs, endMs: view.scrollMs + pxToMs(view.viewportWidth, view.zoom) };
}

const TICK_STEPS_MS = [100, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000] as const;
const MIN_MAJOR_TICK_PX = 80;
const MINOR_TICKS_PER_MAJOR = 5;

function chooseTickStepMs(zoom: number): number {
  const pxPerMs = zoom > 0 ? zoom / 1000 : 0;
  for (const step of TICK_STEPS_MS) {
    if (step * pxPerMs >= MIN_MAJOR_TICK_PX) return step;
  }
  let step: number = TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
  if (pxPerMs <= 0) return step;
  while (step * pxPerMs < MIN_MAJOR_TICK_PX) step *= 2;
  return step;
}

export interface RulerTickSet {
  major: Array<{ ms: number; label: string }>;
  minor: number[];
}

/**
 * Major ticks at least `MIN_MAJOR_TICK_PX` apart (labelled with frames below
 * one second, clock time at or above it), plus evenly-spaced minor ticks
 * between them. Only ticks inside the view's visible range are returned.
 */
export function rulerTicks(view: TimelineView, fps: number): RulerTickSet {
  const step = chooseTickStepMs(view.zoom);
  const minorStep = step / MINOR_TICKS_PER_MAJOR;
  const { startMs, endMs } = visibleRange(view);

  const major: Array<{ ms: number; label: string }> = [];
  for (let ms = Math.floor(startMs / step) * step; ms <= endMs; ms += step) {
    if (ms < 0 || ms < startMs) continue;
    major.push({ ms, label: step < 1000 ? formatTimecode(ms, fps) : formatClock(ms) });
  }

  const minor: number[] = [];
  for (let ms = Math.floor(startMs / minorStep) * minorStep; ms <= endMs; ms += minorStep) {
    if (ms < 0 || ms < startMs) continue;
    const remainder = ms % step;
    const onMajor = remainder < 1e-6 || step - remainder < 1e-6;
    if (!onMajor) minor.push(ms);
  }

  return { major, minor };
}

const DEFAULT_ZOOM_PX_PER_SEC = 100;

/** The zoom (px/sec) that fits `durationMs` exactly inside `viewportWidth`. */
export function zoomToFitValue(durationMs: number, viewportWidth: number): number {
  if (durationMs <= 0 || viewportWidth <= 0) return DEFAULT_ZOOM_PX_PER_SEC;
  return (viewportWidth / durationMs) * 1000;
}

/** Keeps the visible window inside `[0, durationMs]`, never scrolling past what there is to show. */
export function clampScroll(scrollMs: number, durationMs: number, view: TimelineView): number {
  const visibleMs = pxToMs(view.viewportWidth, view.zoom);
  const maxScrollMs = Math.max(0, durationMs - visibleMs);
  return Math.min(Math.max(0, scrollMs), maxScrollMs);
}

/**
 * Candidate snap times for a drag: every cue's start and effective end
 * (excluding cues in `excludeIds`, so a clip never snaps to itself), the
 * playhead, and zero.
 */
export function snapCandidates(
  cues: readonly ChordCue[],
  playheadMs: number,
  excludeIds: readonly string[] = [],
): number[] {
  const excluded = new Set(excludeIds);
  const candidates = new Set<number>([0, playheadMs]);
  cues.forEach((cue, index) => {
    if (excluded.has(cue.id)) return;
    candidates.add(cue.startMs);
    const end = cueEndMs(cues, index, Number.POSITIVE_INFINITY);
    if (Number.isFinite(end)) candidates.add(end);
  });
  return Array.from(candidates).sort((a, b) => a - b);
}

const AUTO_SCROLL_TRIGGER_FRACTION = 0.9;
const AUTO_SCROLL_PREROLL_FRACTION = 0.1;

/**
 * While playing, keeps the playhead visible: does nothing until it reaches
 * the right 90% of the visible window, then pages so it sits just inside the
 * left edge of the new window.
 */
export function autoScrollFollow(playheadMs: number, view: TimelineView): number {
  const visibleMs = pxToMs(view.viewportWidth, view.zoom);
  if (visibleMs <= 0) return view.scrollMs;
  const rightEdgeMs = view.scrollMs + visibleMs * AUTO_SCROLL_TRIGGER_FRACTION;
  if (playheadMs >= view.scrollMs && playheadMs < rightEdgeMs) return view.scrollMs;
  return Math.max(0, playheadMs - visibleMs * AUTO_SCROLL_PREROLL_FRACTION);
}
