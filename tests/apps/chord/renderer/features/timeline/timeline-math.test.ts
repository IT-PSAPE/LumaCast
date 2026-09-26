import { describe, expect, it } from 'vitest';
import {
  autoScrollFollow,
  clampScroll,
  msToPx,
  pxToMs,
  rulerTicks,
  snapCandidates,
  TRACK_HEADER_WIDTH_PX,
  visibleRange,
  zoomToFitValue,
} from '../../../../../../apps/chord/renderer/features/timeline/timeline-math';
import type { ChordCue } from '../../../../../../apps/chord/shared/project';

function cue(id: string, startMs: number, endMs: number | null): ChordCue {
  return { id, startMs, endMs, text: id, override: null };
}

describe('msToPx / pxToMs', () => {
  it('convert ms<->px at a given zoom (px per second)', () => {
    expect(msToPx(1000, 100)).toBe(100);
    expect(msToPx(500, 200)).toBe(100);
    expect(msToPx(0, 100)).toBe(0);
    expect(pxToMs(100, 100)).toBe(1000);
    expect(pxToMs(100, 200)).toBe(500);
  });

  it('round-trips', () => {
    expect(pxToMs(msToPx(3456, 137), 137)).toBeCloseTo(3456, 6);
  });

  it('pxToMs is 0 when zoom is not positive, instead of dividing by zero', () => {
    expect(pxToMs(100, 0)).toBe(0);
    expect(pxToMs(100, -10)).toBe(0);
  });
});

describe('visibleRange', () => {
  it('spans from scrollMs for one viewport width of time', () => {
    const range = visibleRange({ zoom: 100, scrollMs: 500, viewportWidth: 800 });
    expect(range.startMs).toBe(500);
    expect(range.endMs).toBe(8500);
  });
});

describe('rulerTicks', () => {
  it('chooses a whole-second step once 1px/ms alone would crowd ticks tighter than 80px', () => {
    // zoom 100 px/sec -> 0.1 px/ms; 100/250/500ms steps all fall under 80px,
    // so the first step clearing the threshold is 1000ms (100px apart).
    const { major, minor } = rulerTicks({ zoom: 100, scrollMs: 0, viewportWidth: 800 }, 30);
    const majorMs = major.map((tick) => tick.ms);
    expect(majorMs).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000]);
    expect(minor).toContain(200);
    expect(minor).not.toContain(1000);
    expect(minor).not.toContain(0);
  });

  it('labels sub-second steps with frames and second-or-coarser steps with clock time', () => {
    // zoom 1000 px/sec -> 1 px/ms; the first step clearing 80px is 100ms.
    const { major } = rulerTicks({ zoom: 1000, scrollMs: 0, viewportWidth: 300 }, 30);
    expect(major[0]).toEqual({ ms: 0, label: '00:00:00' });
    expect(major.some((tick) => tick.ms === 100 && tick.label === '00:00:03')).toBe(true);

    const coarse = rulerTicks({ zoom: 100, scrollMs: 0, viewportWidth: 300 }, 30);
    expect(coarse.major[0]).toEqual({ ms: 0, label: '0:00.0' });
  });

  it('never places two major ticks closer than 80px apart, across a range of zoom levels', () => {
    for (const zoom of [2, 10, 40, 100, 400, 1000, 4000]) {
      const { major } = rulerTicks({ zoom, scrollMs: 0, viewportWidth: 1000 }, 30);
      for (let i = 1; i < major.length; i += 1) {
        const gapPx = msToPx(major[i]!.ms - major[i - 1]!.ms, zoom);
        expect(gapPx).toBeGreaterThanOrEqual(80 - 1e-6);
      }
    }
  });

  it('only returns ticks inside the visible range', () => {
    const { major, minor } = rulerTicks({ zoom: 100, scrollMs: 3000, viewportWidth: 800 }, 30);
    for (const tick of major) expect(tick.ms).toBeGreaterThanOrEqual(3000);
    for (const ms of minor) expect(ms).toBeGreaterThanOrEqual(3000);
  });
});

describe('zoomToFitValue', () => {
  it('returns the zoom that fits the whole duration in the viewport', () => {
    expect(zoomToFitValue(10_000, 800)).toBeCloseTo(80, 6);
    expect(zoomToFitValue(1000, 100)).toBeCloseTo(100, 6);
  });

  it('falls back to a default zoom for a degenerate duration or viewport', () => {
    expect(zoomToFitValue(0, 800)).toBeGreaterThan(0);
    expect(zoomToFitValue(10_000, 0)).toBeGreaterThan(0);
  });
});

describe('clampScroll', () => {
  it('never scrolls before zero', () => {
    const view = { zoom: 100, scrollMs: 0, viewportWidth: 800 };
    expect(clampScroll(-500, 10_000, view)).toBe(0);
  });

  it('never scrolls past showing the last of the duration', () => {
    const view = { zoom: 100, scrollMs: 0, viewportWidth: 800 };
    // visible window is 8000ms; duration 10000ms -> max scroll is 2000ms.
    expect(clampScroll(5000, 10_000, view)).toBe(2000);
  });

  it('leaves an in-range scroll position unchanged', () => {
    const view = { zoom: 100, scrollMs: 0, viewportWidth: 800 };
    expect(clampScroll(1000, 10_000, view)).toBe(1000);
  });
});

describe('snapCandidates', () => {
  it('includes zero, the playhead, and every (non-excluded) cue start/end', () => {
    const cues = [cue('a', 1000, 2000), cue('b', 3000, null)];
    // `b` is last with no explicit end, so its effective end is the overall
    // timeline end, which this function does not receive; that candidate is
    // dropped rather than guessed at.
    expect(snapCandidates(cues, 500, [])).toEqual([0, 500, 1000, 2000, 3000]);
  });

  it('excludes both edges of an excluded cue', () => {
    const cues = [cue('a', 1000, 2000), cue('b', 3000, null)];
    expect(snapCandidates(cues, 500, ['a'])).toEqual([0, 500, 3000]);
  });

  it('de-duplicates coincident candidates', () => {
    const cues = [cue('a', 0, 500)];
    expect(snapCandidates(cues, 0, [])).toEqual([0, 500]);
  });
});

describe('autoScrollFollow', () => {
  const view = { zoom: 100, scrollMs: 0, viewportWidth: 800 };

  it('does not scroll while the playhead is inside the left 90% of the window', () => {
    expect(autoScrollFollow(7000, view)).toBe(0);
  });

  it('pages forward once the playhead reaches the right 90%, with a 10% pre-roll', () => {
    expect(autoScrollFollow(7300, view)).toBe(6500);
  });

  it('repositions when the playhead is behind the current scroll (e.g. after a seek back)', () => {
    const scrolled = { zoom: 100, scrollMs: 5000, viewportWidth: 800 };
    expect(autoScrollFollow(4000, scrolled)).toBe(3200);
  });

  it('does not divide by zero for an unmeasured (zero-width) viewport', () => {
    expect(autoScrollFollow(1000, { zoom: 100, scrollMs: 0, viewportWidth: 0 })).toBe(0);
  });
});

describe('TRACK_HEADER_WIDTH_PX', () => {
  it('matches the `w-32` header column every track row reserves', () => {
    expect(TRACK_HEADER_WIDTH_PX).toBe(128);
  });
});
