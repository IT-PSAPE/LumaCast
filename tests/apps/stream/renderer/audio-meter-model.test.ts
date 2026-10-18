import { describe, expect, it } from 'vitest';
import {
  METER_FLOOR_DB,
  METER_ZONES,
  dbToFraction,
  linearToDb,
  updatePeakHold,
} from '../../../../apps/stream/renderer/audio-meter-model';

describe('linearToDb', () => {
  it('maps a level of 0 to the meter floor', () => {
    expect(linearToDb(0)).toBe(METER_FLOOR_DB);
  });

  it('maps full scale (1) to 0dB', () => {
    expect(linearToDb(1)).toBeCloseTo(0, 5);
  });

  it('clamps very quiet levels to the floor rather than -Infinity', () => {
    // 20*log10(0.0000001) is far below -60dB.
    expect(linearToDb(0.0000001)).toBe(METER_FLOOR_DB);
  });

  it('treats negative or non-finite input as silence', () => {
    expect(linearToDb(-0.5)).toBe(METER_FLOOR_DB);
    expect(linearToDb(NaN)).toBe(METER_FLOOR_DB);
    expect(linearToDb(Infinity)).toBe(METER_FLOOR_DB);
  });

  it('matches the standard 20*log10 formula within range', () => {
    expect(linearToDb(0.5)).toBeCloseTo(20 * Math.log10(0.5), 5);
  });
});

describe('dbToFraction', () => {
  it('maps the floor to 0', () => {
    expect(dbToFraction(METER_FLOOR_DB)).toBe(0);
  });

  it('maps 0dB to 1', () => {
    expect(dbToFraction(0)).toBe(1);
  });

  it('maps the midpoint to 0.5', () => {
    expect(dbToFraction(-30)).toBeCloseTo(0.5, 5);
  });

  it('clamps values below the floor to 0', () => {
    expect(dbToFraction(-120)).toBe(0);
  });

  it('clamps values above 0dB to 1', () => {
    expect(dbToFraction(12)).toBe(1);
  });
});

describe('METER_ZONES', () => {
  it('covers the full -60..0 range with no gaps, in ascending order', () => {
    expect(METER_ZONES[0]).toEqual({ fromDb: -60, toDb: -20, tone: 'ok' });
    expect(METER_ZONES[1]).toEqual({ fromDb: -20, toDb: -9, tone: 'warn' });
    expect(METER_ZONES[2]).toEqual({ fromDb: -9, toDb: 0, tone: 'hot' });
  });
});

describe('updatePeakHold', () => {
  it('latches a brand new peak from a null state', () => {
    const state = updatePeakHold(null, -10, 1000);
    expect(state).toEqual({ peakDb: -10, heldUntil: 1000 + 1500 });
  });

  it('latches a louder level and restarts the hold window', () => {
    const first = updatePeakHold(null, -20, 0);
    const louder = updatePeakHold(first, -5, 100, 1500, 20);
    expect(louder).toEqual({ peakDb: -5, heldUntil: 100 + 1500 });
  });

  it('holds the peak flat while quieter levels arrive within the hold window', () => {
    const first = updatePeakHold(null, -5, 0, 1500, 20);
    const held = updatePeakHold(first, -40, 1000, 1500, 20);
    expect(held).toEqual(first);
  });

  it('keeps holding right up to (but not past) the hold deadline', () => {
    const first = updatePeakHold(null, -5, 0, 1500, 20);
    const stillHeld = updatePeakHold(first, -40, 1500, 1500, 20);
    expect(stillHeld).toEqual(first);
  });

  it('decays linearly at decayDbPerSecond once the hold window has elapsed', () => {
    const first = updatePeakHold(null, -5, 0, 1500, 20);
    // 1 full second past the hold deadline (which itself is at t=1500).
    const decayed = updatePeakHold(first, -40, 1500 + 1000, 1500, 20);
    expect(decayed.peakDb).toBeCloseTo(-25, 5); // -5 - 20*1 = -25
    expect(decayed.heldUntil).toBe(1500 + 1000);
  });

  it('never decays below the current level', () => {
    const first = updatePeakHold(null, -5, 0, 1500, 20);
    // A long time later: decay would mathematically go to -205dB, but the
    // current level (-18) should act as a floor for the marker.
    const decayed = updatePeakHold(first, -18, 1500 + 10_000, 1500, 20);
    expect(decayed.peakDb).toBe(-18);
  });

  it('never decays below the meter floor even with a silent current level', () => {
    const first = updatePeakHold(null, 0, 0, 1500, 20);
    const decayed = updatePeakHold(first, METER_FLOOR_DB, 1500 + 10_000, 1500, 20);
    expect(decayed.peakDb).toBe(METER_FLOOR_DB);
  });

  it('re-latches once a rising level overtakes an already-decaying marker', () => {
    const first = updatePeakHold(null, -5, 0, 1500, 20);
    // Decay a bit (hold window is [0,1500]; this call is 500ms past it).
    const decaying = updatePeakHold(first, -40, 2000, 1500, 20);
    expect(decaying.peakDb).toBeCloseTo(-15, 5); // -5 - 20*0.5

    // A level that now exceeds the decaying marker re-latches and restarts the hold.
    const relatched = updatePeakHold(decaying, -10, 2100, 1500, 20);
    expect(relatched).toEqual({ peakDb: -10, heldUntil: 2100 + 1500 });
  });
});
