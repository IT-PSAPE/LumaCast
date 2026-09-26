import { describe, expect, it } from 'vitest';
import {
  activeCueIndexAt,
  clampMs,
  cueAt,
  cueEndMs,
  cueSlideElement,
  cueTextPayload,
  cuesFromPlainLyrics,
  cuesFromTimedCues,
  deleteCues,
  frameDurationMs,
  insertCue,
  moveCues,
  nextCueStart,
  normalizeCues,
  normalizeOverride,
  previousCueStart,
  quantizeToFrame,
  resolveCueStyle,
  snapTimeMs,
  sortCues,
  splitCue,
  timedCuesFromCues,
  transitionStateAt,
  trimCue,
} from '../../../../apps/chord/shared/cue-model';
import type { ChordCue, ChordTheme, Transition } from '../../../../apps/chord/shared/project';
import type { TimedCue } from '@lumacast/markers';

function cue(id: string, startMs: number, endMs: number | null = null, overrides: Partial<ChordCue> = {}): ChordCue {
  return { id, startMs, endMs, text: `text-${id}`, override: null, ...overrides };
}

function idSeq(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

const THEME: ChordTheme = {
  presetId: 'classic',
  text: { fontFamily: 'Avenir Next', fontSize: 72, color: '#FFFFFF', alignment: 'center' },
  box: { x: 180, y: 860, width: 1560, height: 170, rotation: 0, opacity: 1 },
  transition: { in: 'fade', out: 'fade', durationMs: 400 },
};

describe('frame/time math', () => {
  it('frameDurationMs is 1000/fps', () => {
    expect(frameDurationMs(30)).toBeCloseTo(33.333, 2);
    expect(frameDurationMs(24)).toBeCloseTo(41.667, 2);
    expect(frameDurationMs(60)).toBeCloseTo(16.667, 2);
  });

  it('quantizeToFrame snaps to the nearest frame boundary', () => {
    expect(quantizeToFrame(0, 30)).toBe(0);
    const frame = frameDurationMs(30);
    expect(quantizeToFrame(frame * 3 + 1, 30)).toBeCloseTo(frame * 3, 5);
    expect(quantizeToFrame(frame * 3.6, 30)).toBeCloseTo(frame * 4, 5);
  });

  it('clampMs clamps into [min, max]', () => {
    expect(clampMs(5, 0, 10)).toBe(5);
    expect(clampMs(-5, 0, 10)).toBe(0);
    expect(clampMs(50, 0, 10)).toBe(10);
  });
});

describe('sortCues / normalizeCues', () => {
  it('sortCues sorts ascending by startMs without mutating the input', () => {
    const input = [cue('b', 200), cue('a', 100)];
    const sorted = sortCues(input);
    expect(sorted.map((c) => c.id)).toEqual(['a', 'b']);
    expect(input.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('normalizeCues sorts, dedupes (keeping the first in sorted order), clamps negative starts, and clears bad endMs', () => {
    const result = normalizeCues([
      cue('dup', 500, 1500),
      cue('a', -100, 50), // negative start; endMs still valid after clamp (50 > 0)
      cue('dup', 0, 1000), // earlier in sorted order, wins over the later 'dup'
      cue('bad-end', 300, 100), // endMs <= startMs
      cue('null-end', 200, null),
    ]);
    expect(result.map((c) => c.id)).toEqual(['a', 'dup', 'null-end', 'bad-end']);
    expect(result.find((c) => c.id === 'a')).toMatchObject({ startMs: 0, endMs: 50 });
    expect(result.find((c) => c.id === 'dup')).toMatchObject({ startMs: 0, endMs: 1000 });
    expect(result.find((c) => c.id === 'bad-end')?.endMs).toBeNull();
    expect(result).toHaveLength(4);
  });

  it('is a no-op for an already-sorted, valid, unique array (returns equal cues)', () => {
    const input = [cue('a', 0, 1000), cue('b', 1000, 2000)];
    expect(normalizeCues(input)).toEqual(input);
  });
});

describe('cueEndMs', () => {
  const cues = [cue('a', 0, 1000), cue('b', 1000, null), cue('c', 3000, null)];

  it('uses the explicit endMs when set', () => {
    expect(cueEndMs(cues, 0, 10000)).toBe(1000);
  });

  it('falls back to the next cue start when endMs is null', () => {
    expect(cueEndMs(cues, 1, 10000)).toBe(3000);
  });

  it('falls back to the timeline end for the last cue with a null endMs', () => {
    expect(cueEndMs(cues, 2, 10000)).toBe(10000);
  });
});

describe('activeCueIndexAt / cueAt', () => {
  const cues = [cue('a', 0, 1000), cue('b', 1000, 2000), cue('c', 2000, null)];
  const timelineEnd = 5000;

  it('is active exactly at its startMs (inclusive)', () => {
    expect(activeCueIndexAt(cues, 1000, timelineEnd)).toBe(1);
  });

  it('is not active exactly at its endMs (exclusive)', () => {
    // At 2000, cue 'b' has ended and cue 'c' starts: 'c' is active, not 'b'.
    expect(activeCueIndexAt(cues, 2000, timelineEnd)).toBe(2);
  });

  it('mid-cue returns the containing cue', () => {
    expect(activeCueIndexAt(cues, 500, timelineEnd)).toBe(0);
    expect(activeCueIndexAt(cues, 1500, timelineEnd)).toBe(1);
  });

  it('the open-ended last cue is active up to the timeline end (exclusive)', () => {
    expect(activeCueIndexAt(cues, 4999, timelineEnd)).toBe(2);
    expect(activeCueIndexAt(cues, 5000, timelineEnd)).toBeNull();
  });

  it('before the first cue and with no cues returns null', () => {
    expect(activeCueIndexAt(cues, -1, timelineEnd)).toBeNull();
    expect(activeCueIndexAt([], 0, timelineEnd)).toBeNull();
  });

  it('a gap between an explicit-end cue and the next cue returns null', () => {
    const gapped = [cue('a', 0, 500), cue('b', 1000, 1500)];
    expect(activeCueIndexAt(gapped, 750, 5000)).toBeNull();
  });

  it('cueAt returns the cue object (or null) matching activeCueIndexAt', () => {
    expect(cueAt(cues, 1500, timelineEnd)?.id).toBe('b');
    expect(cueAt(cues, 5000, timelineEnd)).toBeNull();
  });

  it('binary search finds the right cue across many cues, including exact boundaries', () => {
    const many: ChordCue[] = [];
    for (let i = 0; i < 500; i++) {
      many.push(cue(`c${i}`, i * 100, i * 100 + 80)); // 80ms on, 20ms gap
    }
    // Exact starts are active.
    for (let i = 0; i < 500; i += 37) {
      expect(activeCueIndexAt(many, i * 100, 60000)).toBe(i);
    }
    // Exact ends are not active (still in the 20ms gap).
    for (let i = 0; i < 500; i += 41) {
      expect(activeCueIndexAt(many, i * 100 + 80, 60000)).toBeNull();
    }
    // Mid-cue and mid-gap spot checks.
    expect(activeCueIndexAt(many, 250 * 100 + 40, 60000)).toBe(250);
    expect(activeCueIndexAt(many, 250 * 100 + 90, 60000)).toBeNull();
  });
});

describe('nextCueStart / previousCueStart', () => {
  const cues = [cue('a', 0), cue('b', 1000), cue('c', 2000)];

  it('nextCueStart finds the next strictly-later start', () => {
    expect(nextCueStart(cues, 500)).toBe(1000);
    expect(nextCueStart(cues, 1000)).toBe(2000);
    expect(nextCueStart(cues, 2000)).toBeNull();
  });

  it('previousCueStart finds the previous strictly-earlier start', () => {
    expect(previousCueStart(cues, 1500)).toBe(1000);
    expect(previousCueStart(cues, 1000)).toBe(0);
    expect(previousCueStart(cues, 0)).toBeNull();
  });
});

describe('TimedCue <-> ChordCue', () => {
  it('cuesFromTimedCues sorts by order and assigns fresh ids', () => {
    const timed: TimedCue[] = [
      { order: 2, startMs: 1000, endMs: 2000, text: 'second' },
      { order: 1, startMs: 0, endMs: 1000, text: 'first' },
    ];
    const cues = cuesFromTimedCues(timed, idSeq());
    expect(cues.map((c) => c.text)).toEqual(['first', 'second']);
    expect(cues.map((c) => c.id)).toEqual(['id-0', 'id-1']);
    expect(cues[0].override).toBeNull();
  });

  it('cuesFromTimedCues clears an endMs that is not greater than startMs and clamps negative starts', () => {
    const timed: TimedCue[] = [{ order: 1, startMs: -50, endMs: -50, text: 'x' }];
    const cues = cuesFromTimedCues(timed, idSeq());
    expect(cues[0].startMs).toBe(0);
    expect(cues[0].endMs).toBeNull();
  });

  it('timedCuesFromCues numbers cues 1..n and resolves endMs via cueEndMs', () => {
    const cues = [cue('a', 0, 1000), cue('b', 1000, null)];
    const timed = timedCuesFromCues(cues, 5000);
    expect(timed).toEqual([
      { order: 1, startMs: 0, endMs: 1000, text: 'text-a' },
      { order: 2, startMs: 1000, endMs: 5000, text: 'text-b' },
    ]);
  });

  it('round-trips through TimedCue and back to equivalent timing', () => {
    const original = [cue('a', 0, 1000, { text: 'one' }), cue('b', 1000, 3000, { text: 'two' })];
    const timed = timedCuesFromCues(original, 5000);
    const rebuilt = cuesFromTimedCues(timed, idSeq());
    expect(rebuilt.map((c) => [c.startMs, c.endMs, c.text])).toEqual([
      [0, 1000, 'one'],
      [1000, 3000, 'two'],
    ]);
  });
});

describe('cuesFromPlainLyrics', () => {
  it('creates one cue per non-empty line with sequential starts', () => {
    const cues = cuesFromPlainLyrics('Line one\nLine two\nLine three', idSeq(), 4000);
    expect(cues.map((c) => c.text)).toEqual(['Line one', 'Line two', 'Line three']);
    expect(cues.map((c) => c.startMs)).toEqual([0, 4000, 8000]);
    expect(cues.every((c) => c.endMs === null)).toBe(true);
  });

  it('a blank line creates a gap: no cue, and the next cue starts one extra spacing later', () => {
    const cues = cuesFromPlainLyrics('First\n\nSecond', idSeq(), 4000);
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
    // Without the blank line, 'Second' would start at 4000; the gap pushes it to 8000.
    expect(cues.map((c) => c.startMs)).toEqual([0, 8000]);
  });

  it('ignores whitespace-only lines and leading/trailing blank lines', () => {
    const cues = cuesFromPlainLyrics('\n  \nOnly line\n\n', idSeq(), 1000);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ text: 'Only line', startMs: 2000 });
  });

  it('returns no cues for empty or all-blank input', () => {
    expect(cuesFromPlainLyrics('', idSeq())).toEqual([]);
    expect(cuesFromPlainLyrics('\n\n\n', idSeq())).toEqual([]);
  });
});

describe('moveCues', () => {
  it('shifts selected cues by deltaMs, preserving relative offsets, and moves an explicit endMs along', () => {
    const cues = [cue('a', 0, 1000), cue('b', 1000, 2000), cue('c', 5000, null)];
    const moved = moveCues(cues, ['a', 'b'], 500);
    expect(moved.find((c) => c.id === 'a')).toMatchObject({ startMs: 500, endMs: 1500 });
    expect(moved.find((c) => c.id === 'b')).toMatchObject({ startMs: 1500, endMs: 2500 });
    expect(moved.find((c) => c.id === 'c')).toMatchObject({ startMs: 5000 }); // untouched
  });

  it('clamps the whole selection so the earliest selected cue does not pass minStart', () => {
    const cues = [cue('a', 100), cue('b', 300)];
    const moved = moveCues(cues, ['a', 'b'], -500, 0);
    // Without clamping, 'a' would go to -400; the delta is reduced to -100 so 'a' lands at 0.
    expect(moved.find((c) => c.id === 'a')?.startMs).toBe(0);
    expect(moved.find((c) => c.id === 'b')?.startMs).toBe(200);
  });

  it('leaves unselected cues untouched and is a no-op for an empty selection', () => {
    const cues = [cue('a', 0), cue('b', 1000)];
    expect(moveCues(cues, [], 500)).toEqual(cues);
    expect(moveCues(cues, ['zzz'], 500)).toEqual(cues);
  });
});

describe('trimCue', () => {
  it('start cannot pass end minus one frame', () => {
    const cues = [cue('a', 0, 1000)];
    const trimmed = trimCue(cues, 'a', 'start', 999999, 30);
    const frame = frameDurationMs(30);
    expect(trimmed[0].startMs).toBeCloseTo(1000 - frame, 5);
  });

  it('start cannot pass the next cue start minus one frame when endMs is null', () => {
    const cues = [cue('a', 0, null), cue('b', 1000, null)];
    const trimmed = trimCue(cues, 'a', 'start', 999999, 30);
    const frame = frameDurationMs(30);
    expect(trimmed[0].startMs).toBeCloseTo(1000 - frame, 5);
  });

  it('start clamps at 0 and quantizes to the frame grid', () => {
    const cues = [cue('a', 500, 2000)];
    const trimmed = trimCue(cues, 'a', 'start', -100, 30);
    expect(trimmed[0].startMs).toBe(0);
  });

  it('end cannot pass the next cue start', () => {
    const cues = [cue('a', 0, 1000), cue('b', 2000, 3000)];
    const trimmed = trimCue(cues, 'a', 'end', 5000, 30);
    expect(trimmed[0].endMs).toBe(2000);
  });

  it('end cannot go below startMs plus one frame', () => {
    const cues = [cue('a', 1000, 2000)];
    const trimmed = trimCue(cues, 'a', 'end', 0, 30);
    const frame = frameDurationMs(30);
    expect(trimmed[0].endMs).toBeCloseTo(1000 + frame, 5);
  });

  it('an unknown id is a no-op', () => {
    const cues = [cue('a', 0, 1000)];
    expect(trimCue(cues, 'missing', 'start', 500, 30)).toEqual(cues);
  });
});

describe('splitCue', () => {
  it('splits at timeMs; both halves keep the original text; the second half gets a new id', () => {
    const cues = [cue('a', 0, 2000, { text: 'Same words' })];
    const { cues: result, newId } = splitCue(cues, 'a', 800, idSeq('new'));
    expect(result).toHaveLength(1 + 1); // replaced the original with two
    expect(result[0]).toMatchObject({ id: 'a', startMs: 0, endMs: 800, text: 'Same words' });
    expect(result[1]).toMatchObject({ id: newId, startMs: 800, endMs: 2000, text: 'Same words' });
    expect(newId).not.toBe('a');
  });

  it('is a no-op when timeMs is outside the cue window (open-ended cue, no next cue)', () => {
    const cues = [cue('a', 0, null)];
    const before = idSeq('unused');
    expect(splitCue(cues, 'a', -1, before).cues).toEqual(cues);
  });

  it('respects the next cue start as the upper bound for an open-ended cue', () => {
    const cues = [cue('a', 0, null), cue('b', 1000, null)];
    const { cues: result } = splitCue(cues, 'a', 1000, idSeq('new'));
    expect(result).toEqual(cues); // 1000 is not < upper (1000), so no split
  });

  it('an unknown id is a no-op and returns the original id', () => {
    const cues = [cue('a', 0, 1000)];
    const { cues: result, newId } = splitCue(cues, 'missing', 500, idSeq('new'));
    expect(result).toEqual(cues);
    expect(newId).toBe('missing');
  });
});

describe('insertCue / deleteCues', () => {
  it('insertCue inserts in sorted position', () => {
    const cues = [cue('a', 0), cue('c', 2000)];
    const result = insertCue(cues, cue('b', 1000));
    expect(result.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('deleteCues removes the given ids and keeps the rest in order', () => {
    const cues = [cue('a', 0), cue('b', 1000), cue('c', 2000)];
    expect(deleteCues(cues, ['b']).map((c) => c.id)).toEqual(['a', 'c']);
    expect(deleteCues(cues, ['a', 'c']).map((c) => c.id)).toEqual(['b']);
  });
});

describe('snapTimeMs', () => {
  it('snaps to the nearest candidate within tolerance', () => {
    expect(snapTimeMs(1010, [0, 1000, 2000], 50)).toBe(1000);
  });

  it('prefers the closest candidate when multiple are within tolerance', () => {
    expect(snapTimeMs(1040, [1000, 1080], 100)).toBe(1000);
  });

  it('returns the input time unchanged when nothing is within tolerance', () => {
    expect(snapTimeMs(1500, [0, 1000], 50)).toBe(1500);
  });

  it('returns the input time unchanged for an empty candidate list', () => {
    expect(snapTimeMs(1500, [], 100)).toBe(1500);
  });
});

describe('resolveCueStyle', () => {
  it('returns the theme unchanged when the cue has no override', () => {
    const style = resolveCueStyle(THEME, cue('a', 0));
    expect(style.text).toEqual(THEME.text);
    expect(style.box).toEqual(THEME.box);
    expect(style.transition).toEqual(THEME.transition);
  });

  it('merges an override over the theme, keying by present fields only', () => {
    const overridden = cue('a', 0, null, {
      override: { text: { color: '#FF0000' }, box: { x: 0 } },
    });
    const style = resolveCueStyle(THEME, overridden);
    expect(style.text).toEqual({ ...THEME.text, color: '#FF0000' });
    expect(style.box).toEqual({ ...THEME.box, x: 0 });
    expect(style.transition).toEqual(THEME.transition);
  });
});

describe('normalizeOverride', () => {
  it('strips empty sub-objects and returns null when nothing remains', () => {
    expect(normalizeOverride({})).toBeNull();
    expect(normalizeOverride({ text: {}, box: {}, transition: {} })).toBeNull();
  });

  it('keeps only non-empty sub-objects', () => {
    expect(normalizeOverride({ text: { color: '#FFFFFF' }, box: {} })).toEqual({ text: { color: '#FFFFFF' } });
  });
});

describe('transitionStateAt', () => {
  const transition: Transition = { in: 'fade', out: 'fade', durationMs: 200 };

  it('is null before startMs and at/after endMs', () => {
    expect(transitionStateAt(1000, 2000, 999, transition)).toBeNull();
    expect(transitionStateAt(1000, 2000, 2000, transition)).toBeNull();
  });

  it('is the start of the in-phase exactly at startMs', () => {
    const state = transitionStateAt(1000, 2000, 1000, transition);
    expect(state?.opacity).toBeCloseTo(0, 5);
  });

  it('reaches full opacity by the end of the in-phase', () => {
    const state = transitionStateAt(1000, 2000, 1200, transition);
    expect(state?.opacity).toBeCloseTo(1, 5);
  });

  it('is steady state in the middle of a long cue', () => {
    const state = transitionStateAt(0, 10000, 5000, transition);
    expect(state).toEqual({ opacity: 1, offsetX: 0, offsetY: 0, scale: 1 });
  });

  it('fades out approaching endMs, ending near opacity 0 just before endMs', () => {
    const state = transitionStateAt(1000, 2000, 1999, transition);
    expect(state).not.toBeNull();
    expect(state!.opacity).toBeLessThan(0.2);
  });

  it('clamps durationMs to half the cue length for a short cue', () => {
    const shortTransition: Transition = { in: 'fade', out: 'fade', durationMs: 1000 };
    // Cue is 200ms long; half-length is 100ms, so in-phase ends at 100 and out-phase starts at 100.
    const midpoint = transitionStateAt(0, 200, 100, shortTransition);
    expect(midpoint).not.toBeNull();
  });

  it('slide-up offsets +40 -> 0 on the way in and 0 -> -40 on the way out', () => {
    const slide: Transition = { in: 'slide-up', out: 'slide-up', durationMs: 200 };
    expect(transitionStateAt(1000, 2000, 1000, slide)?.offsetY).toBeCloseTo(40, 5);
    expect(transitionStateAt(1000, 2000, 1200, slide)?.offsetY).toBeCloseTo(0, 5);
    expect(transitionStateAt(1000, 2000, 1999, slide)?.offsetY).toBeLessThan(0);
  });

  it('scale kind moves between 0.92 and 1', () => {
    const scale: Transition = { in: 'scale', out: 'none', durationMs: 200 };
    expect(transitionStateAt(1000, 2000, 1000, scale)?.scale).toBeCloseTo(0.92, 5);
    expect(transitionStateAt(1000, 2000, 1200, scale)?.scale).toBeCloseTo(1, 5);
  });

  it('kind "none" never animates', () => {
    const none: Transition = { in: 'none', out: 'none', durationMs: 200 };
    expect(transitionStateAt(1000, 2000, 1000, none)).toEqual({ opacity: 1, offsetX: 0, offsetY: 0, scale: 1 });
    expect(transitionStateAt(1000, 2000, 1999, none)).toEqual({ opacity: 1, offsetX: 0, offsetY: 0, scale: 1 });
  });
});

describe('cueTextPayload / cueSlideElement', () => {
  it('cueTextPayload builds a plain-format payload with box-level style and no binding', () => {
    const payload = cueTextPayload(THEME.text, cue('a', 0, null, { text: 'Hello there' }));
    expect(payload).toMatchObject({
      text: 'Hello there',
      format: 'plain',
      binding: undefined,
      fontFamily: THEME.text.fontFamily,
      fontSize: THEME.text.fontSize,
      color: THEME.text.color,
      alignment: THEME.text.alignment,
    });
    expect(payload.richBody).toBeUndefined();
  });

  it('cueTextPayload builds a rich-format payload when the cue has richBody', () => {
    const richBody = [{ runs: [{ text: 'Styled' }], indent: 0 }];
    const payload = cueTextPayload(THEME.text, cue('a', 0, null, { text: 'Styled', richBody }));
    expect(payload.format).toBe('rich');
    expect(payload.richBody).toBe(richBody);
  });

  it('cueTextPayload leaves unset optional style keys unset rather than inventing values', () => {
    const payload = cueTextPayload(THEME.text, cue('a', 0));
    expect(payload.weight).toBeUndefined();
    expect(payload.italic).toBeUndefined();
    expect(payload.textStrokeEnabled).toBeUndefined();
  });

  it('cueSlideElement positions from the box and stamps content-layer defaults', () => {
    const box = THEME.box;
    const now = '2026-01-01T00:00:00.000Z';
    const element = cueSlideElement(cue('cue-1', 0, 4000, { text: 'Hi' }), THEME.text, box, 'slide-1', now);
    expect(element).toMatchObject({
      slideId: 'slide-1',
      type: 'text',
      layer: 'content',
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: box.rotation,
      opacity: box.opacity,
      zIndex: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(element.payload).toMatchObject({ text: 'Hi', format: 'plain' });
  });
});
