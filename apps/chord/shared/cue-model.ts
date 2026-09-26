// Pure timeline/cue math: frame quantization, sorting/normalization,
// active-cue lookup, editing primitives (move/trim/split/insert/delete),
// snapping, style resolution, transition easing, and the bridge to
// @lumacast/composition's SlideElement/TextElementPayload and
// @lumacast/markers' TimedCue. No Node builtins, no Electron, no React.
import type { SlideElement, TextElementPayload } from '@lumacast/composition';
import type { Id } from '@lumacast/kernel';
import type { TimedCue } from '@lumacast/markers';
import type { ChordCue, ChordTheme, CueOverride, FrameRate, TextBox, TextStyle, Transition, TransitionKind } from './project';

// ---------------------------------------------------------------------------
// Frame/time math
// ---------------------------------------------------------------------------

export function frameDurationMs(fps: FrameRate): number {
  return 1000 / fps;
}

export function quantizeToFrame(ms: number, fps: FrameRate): number {
  const frame = frameDurationMs(fps);
  return Math.round(ms / frame) * frame;
}

export function clampMs(ms: number, min: number, max: number): number {
  return Math.min(Math.max(ms, min), max);
}

// ---------------------------------------------------------------------------
// Sorting / normalization
// ---------------------------------------------------------------------------

export function sortCues(cues: readonly ChordCue[]): ChordCue[] {
  return [...cues].sort((a, b) => a.startMs - b.startMs);
}

/**
 * Repairs the invariants a `ChordProject.cues` array must hold: sorted by
 * startMs, unique ids (first occurrence in sorted order wins), no negative
 * starts, and no endMs that isn't strictly greater than its (possibly
 * clamped) startMs.
 */
export function normalizeCues(cues: readonly ChordCue[]): ChordCue[] {
  const sorted = sortCues(cues);
  const seen = new Set<string>();
  const deduped: ChordCue[] = [];
  for (const cue of sorted) {
    if (seen.has(cue.id)) continue;
    seen.add(cue.id);
    deduped.push(cue);
  }
  return deduped.map((cue) => {
    const startMs = Math.max(0, cue.startMs);
    const endMs = cue.endMs !== null && cue.endMs > startMs ? cue.endMs : null;
    return startMs === cue.startMs && endMs === cue.endMs ? cue : { ...cue, startMs, endMs };
  });
}

// ---------------------------------------------------------------------------
// Active-cue lookup
// ---------------------------------------------------------------------------

/** A cue's effective end: its explicit endMs, else the next cue's start, else the timeline end. */
export function cueEndMs(cues: readonly ChordCue[], index: number, timelineEndMs: number): number {
  const cue = cues[index];
  if (cue.endMs !== null) return cue.endMs;
  const next = cues[index + 1];
  return next ? next.startMs : timelineEndMs;
}

/** Binary search for the cue active at `timeMs` (inclusive start, exclusive end). Assumes `cues` is sorted. */
export function activeCueIndexAt(cues: readonly ChordCue[], timeMs: number, timelineEndMs: number): number | null {
  if (cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let candidate = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].startMs <= timeMs) {
      candidate = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (candidate === -1) return null;
  const end = cueEndMs(cues, candidate, timelineEndMs);
  return timeMs < end ? candidate : null;
}

export function cueAt(cues: readonly ChordCue[], timeMs: number, timelineEndMs: number): ChordCue | null {
  const index = activeCueIndexAt(cues, timeMs, timelineEndMs);
  return index === null ? null : cues[index];
}

/** The start time of the next cue strictly after `timeMs`, or null. Assumes `cues` is sorted. */
export function nextCueStart(cues: readonly ChordCue[], timeMs: number): number | null {
  for (const cue of cues) {
    if (cue.startMs > timeMs) return cue.startMs;
  }
  return null;
}

/** The start time of the last cue strictly before `timeMs`, or null. Assumes `cues` is sorted. */
export function previousCueStart(cues: readonly ChordCue[], timeMs: number): number | null {
  let result: number | null = null;
  for (const cue of cues) {
    if (cue.startMs >= timeMs) break;
    result = cue.startMs;
  }
  return result;
}

// ---------------------------------------------------------------------------
// TimedCue <-> ChordCue (import/export via @lumacast/markers)
// ---------------------------------------------------------------------------

export function cuesFromTimedCues(timed: readonly TimedCue[], idFactory: () => string): ChordCue[] {
  return [...timed]
    .sort((a, b) => a.order - b.order)
    .map((cue): ChordCue => {
      const startMs = Math.max(0, cue.startMs);
      return {
        id: idFactory(),
        startMs,
        endMs: cue.endMs !== null && cue.endMs > startMs ? cue.endMs : null,
        text: cue.text,
        override: null,
      };
    });
}

export function timedCuesFromCues(cues: readonly ChordCue[], timelineEndMs: number): TimedCue[] {
  const sorted = sortCues(cues);
  return sorted.map((cue, index) => ({
    order: index + 1,
    startMs: cue.startMs,
    endMs: cueEndMs(sorted, index, timelineEndMs),
    text: cue.text,
  }));
}

/** One cue per non-empty line. A blank line is a gap: no cue is created, but `spacingMs` still elapses. */
export function cuesFromPlainLyrics(text: string, idFactory: () => string, spacingMs = 4000): ChordCue[] {
  const lines = text.split(/\r?\n/);
  const cues: ChordCue[] = [];
  let cursor = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      cues.push({ id: idFactory(), startMs: cursor, endMs: null, text: trimmed, override: null });
    }
    cursor += spacingMs;
  }
  return cues;
}

// ---------------------------------------------------------------------------
// Editing primitives
// ---------------------------------------------------------------------------

/** Moves the selected cues by `deltaMs`, preserving their relative offsets; clamps so none starts before `minStart`. */
export function moveCues(cues: readonly ChordCue[], ids: readonly string[], deltaMs: number, minStart = 0): ChordCue[] {
  const idSet = new Set(ids);
  const selected = cues.filter((cue) => idSet.has(cue.id));
  if (selected.length === 0) return [...cues];
  const earliestStart = Math.min(...selected.map((cue) => cue.startMs));
  const effectiveDelta = Math.max(deltaMs, minStart - earliestStart);
  if (effectiveDelta === 0) return [...cues];
  return cues.map((cue) =>
    idSet.has(cue.id)
      ? { ...cue, startMs: cue.startMs + effectiveDelta, endMs: cue.endMs !== null ? cue.endMs + effectiveDelta : null }
      : cue,
  );
}

export type CueEdge = 'start' | 'end';

/**
 * Drags one edge of a cue. The start edge cannot pass the cue's end (explicit
 * endMs, else the next cue's start) minus one frame; the end edge cannot pass
 * the next cue's start. Both snap to the frame grid at `fps`.
 */
export function trimCue(cues: readonly ChordCue[], id: string, edge: CueEdge, timeMs: number, fps: FrameRate): ChordCue[] {
  const index = cues.findIndex((cue) => cue.id === id);
  if (index === -1) return [...cues];
  const cue = cues[index];
  const frame = frameDurationMs(fps);
  const next = cues[index + 1];
  const quantized = quantizeToFrame(timeMs, fps);

  if (edge === 'start') {
    const hardEnd = cue.endMs !== null ? cue.endMs : next ? next.startMs : Infinity;
    const upperBound = Math.max(0, hardEnd - frame);
    const newStart = clampMs(quantized, 0, upperBound);
    return cues.map((c, i) => (i === index ? { ...c, startMs: newStart } : c));
  }

  const upperBound = next ? next.startMs : Infinity;
  const lowerBound = cue.startMs + frame;
  const newEnd = clampMs(quantized, lowerBound, Math.max(lowerBound, upperBound));
  return cues.map((c, i) => (i === index ? { ...c, endMs: newEnd } : c));
}

export interface SplitCueResult {
  cues: ChordCue[];
  newId: string;
}

/** Splits a cue at `timeMs`. Both halves keep the original text; the second half gets `idFactory()` as its id. */
export function splitCue(cues: readonly ChordCue[], id: string, timeMs: number, idFactory: () => string): SplitCueResult {
  const index = cues.findIndex((cue) => cue.id === id);
  if (index === -1) return { cues: [...cues], newId: id };
  const cue = cues[index];
  const next = cues[index + 1];
  const upper = cue.endMs !== null ? cue.endMs : next ? next.startMs : Infinity;
  if (!(timeMs > cue.startMs && timeMs < upper)) {
    return { cues: [...cues], newId: id };
  }
  const newId = idFactory();
  const firstHalf: ChordCue = { ...cue, endMs: timeMs };
  const secondHalf: ChordCue = { ...cue, id: newId, startMs: timeMs };
  const result = [...cues];
  result.splice(index, 1, firstHalf, secondHalf);
  return { cues: result, newId };
}

export function insertCue(cues: readonly ChordCue[], cue: ChordCue): ChordCue[] {
  return sortCues([...cues, cue]);
}

export function deleteCues(cues: readonly ChordCue[], ids: readonly string[]): ChordCue[] {
  const idSet = new Set(ids);
  return cues.filter((cue) => !idSet.has(cue.id));
}

/** Nearest candidate to `timeMs` within `toleranceMs`; the input time unchanged when none qualifies. */
export function snapTimeMs(timeMs: number, candidates: readonly number[], toleranceMs: number): number {
  let closest: number | null = null;
  let closestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - timeMs);
    if (distance <= toleranceMs && distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }
  return closest ?? timeMs;
}

// ---------------------------------------------------------------------------
// Style resolution
// ---------------------------------------------------------------------------

export function resolveCueStyle(theme: ChordTheme, cue: ChordCue): { text: TextStyle; box: TextBox; transition: Transition } {
  const override = cue.override;
  return {
    text: override?.text ? { ...theme.text, ...override.text } : theme.text,
    box: override?.box ? { ...theme.box, ...override.box } : theme.box,
    transition: override?.transition ? { ...theme.transition, ...override.transition } : theme.transition,
  };
}

/** Strips empty objects from an override; null when nothing remains. */
export function normalizeOverride(override: CueOverride): CueOverride | null {
  const normalized: CueOverride = {};
  if (override.text && Object.keys(override.text).length > 0) normalized.text = override.text;
  if (override.box && Object.keys(override.box).length > 0) normalized.box = override.box;
  if (override.transition && Object.keys(override.transition).length > 0) normalized.transition = override.transition;
  return Object.keys(normalized).length > 0 ? normalized : null;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionState {
  opacity: number;
  offsetX: number;
  offsetY: number;
  scale: number;
}

const STEADY_STATE: TransitionState = { opacity: 1, offsetX: 0, offsetY: 0, scale: 1 };
const SLIDE_OFFSET_PX = 40;
const SCALE_IN_START = 0.92;

function easeOutCubic(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - (1 - clamped) ** 3;
}

function transitionKindState(kind: TransitionKind, progress: number, direction: 'in' | 'out'): TransitionState {
  const eased = easeOutCubic(progress);
  switch (kind) {
    case 'none':
      return STEADY_STATE;
    case 'fade':
      return direction === 'in' ? { ...STEADY_STATE, opacity: eased } : { ...STEADY_STATE, opacity: 1 - eased };
    case 'slide-up':
      return direction === 'in'
        ? { ...STEADY_STATE, offsetY: SLIDE_OFFSET_PX * (1 - eased) }
        : { ...STEADY_STATE, offsetY: -SLIDE_OFFSET_PX * eased };
    case 'slide-down':
      return direction === 'in'
        ? { ...STEADY_STATE, offsetY: -SLIDE_OFFSET_PX * (1 - eased) }
        : { ...STEADY_STATE, offsetY: SLIDE_OFFSET_PX * eased };
    case 'scale':
      return direction === 'in'
        ? { ...STEADY_STATE, scale: SCALE_IN_START + (1 - SCALE_IN_START) * eased }
        : { ...STEADY_STATE, scale: 1 - (1 - SCALE_IN_START) * eased };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * The transition-driven visual offset at `timeMs`, or null outside
 * `[startMs, endMs)`. `transition.durationMs` is clamped to half the cue's
 * length so in/out never overlap.
 */
export function transitionStateAt(startMs: number, endMs: number, timeMs: number, transition: Transition): TransitionState | null {
  if (timeMs < startMs || timeMs >= endMs) return null;
  const halfLength = (endMs - startMs) / 2;
  const duration = Math.max(0, Math.min(transition.durationMs, halfLength));

  if (transition.in !== 'none' && duration > 0 && timeMs < startMs + duration) {
    return transitionKindState(transition.in, (timeMs - startMs) / duration, 'in');
  }
  if (transition.out !== 'none' && duration > 0 && timeMs >= endMs - duration) {
    return transitionKindState(transition.out, (timeMs - (endMs - duration)) / duration, 'out');
  }
  return STEADY_STATE;
}

// ---------------------------------------------------------------------------
// Composition bridge
// ---------------------------------------------------------------------------

/** A full composition text payload for a cue, using composition's own defaults for keys `style` leaves unset. */
export function cueTextPayload(style: TextStyle, cue: ChordCue): TextElementPayload {
  return {
    text: cue.text,
    format: cue.richBody ? 'rich' : 'plain',
    richBody: cue.richBody,
    binding: undefined,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    color: style.color,
    alignment: style.alignment,
    weight: style.weight,
    italic: style.italic,
    underline: style.underline,
    verticalAlign: style.verticalAlign,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing,
    caseTransform: style.caseTransform,
    autoFit: style.autoFit,
    autoFitMaxFontSize: style.autoFitMaxFontSize,
    textStrokeEnabled: style.textStrokeEnabled,
    textStrokeColor: style.textStrokeColor,
    textStrokeWidth: style.textStrokeWidth,
    textShadowEnabled: style.textShadowEnabled,
    textShadowColor: style.textShadowColor,
    textShadowBlur: style.textShadowBlur,
    textShadowOffsetX: style.textShadowOffsetX,
    textShadowOffsetY: style.textShadowOffsetY,
  };
}

/** The SlideElement a cue renders as: a content-layer text element positioned by `box`. */
export function cueSlideElement(cue: ChordCue, style: TextStyle, box: TextBox, slideId: Id, now: string): SlideElement {
  return {
    id: `${cue.id}-text`,
    slideId,
    type: 'text',
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: box.rotation,
    opacity: box.opacity,
    zIndex: 1,
    layer: 'content',
    payload: cueTextPayload(style, cue),
    createdAt: now,
    updatedAt: now,
  };
}
