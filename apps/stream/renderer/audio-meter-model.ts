// Pure math for OBS-style audio meters: linear-to-dB conversion, the meter's
// fixed dB range, its three colour zones, and peak-hold ballistics. No DOM —
// `mixer-dock.tsx` renders this via the shared Meter; tests exercise it directly.

/** Bottom of the meter's displayed dB range. Anything quieter reads as silence. */
export const METER_FLOOR_DB = -60;

/**
 * Converts a linear 0..1 amplitude (as sampled from `AudioMixerEngine.level`)
 * into dB, clamped to `METER_FLOOR_DB`. A level of 0 (or any non-finite/
 * non-positive input) reads as the floor rather than -Infinity.
 */
export function linearToDb(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return METER_FLOOR_DB;
  const db = 20 * Math.log10(level);
  return Number.isFinite(db) ? Math.max(METER_FLOOR_DB, db) : METER_FLOOR_DB;
}

/**
 * Converts a dB value into a 0..1 fraction of the meter's `METER_FLOOR_DB..0`
 * range, clamping out-of-range input first. Used to size meter fills, the
 * peak-hold marker, and tick positions proportionally.
 */
export function dbToFraction(db: number): number {
  const clamped = Math.max(METER_FLOOR_DB, Math.min(0, db));
  return (clamped - METER_FLOOR_DB) / -METER_FLOOR_DB;
}

export interface PeakHoldState {
  /** The currently displayed peak marker position, in dB. */
  peakDb: number;
  /** Timestamp (same clock as `now`) until which the peak stays flat before decaying. */
  heldUntil: number;
}

/**
 * Advances a peak-hold marker by one sample.
 *
 * - A level at or above the current marker immediately latches as the new
 *   peak and resets the hold window.
 * - While `now` is within the hold window, the marker stays flat.
 * - Once the hold window has elapsed, the marker decays linearly at
 *   `decayDbPerSecond` toward the current level, never falling below the
 *   current level or the meter floor.
 *
 * Pure and frame-rate independent: calling this at irregular intervals
 * produces the same result as calling it every frame, because decay is
 * computed from elapsed wall-clock time rather than a fixed per-call step.
 */
export function updatePeakHold(
  state: PeakHoldState | null,
  levelDb: number,
  now: number,
  holdMs = 1500,
  decayDbPerSecond = 20,
): PeakHoldState {
  const level = Math.max(METER_FLOOR_DB, levelDb);

  if (!state || level >= state.peakDb) {
    return { peakDb: level, heldUntil: now + holdMs };
  }

  if (now < state.heldUntil) {
    return state;
  }

  const elapsedSeconds = Math.max(0, now - state.heldUntil) / 1000;
  const decayed = state.peakDb - decayDbPerSecond * elapsedSeconds;
  return { peakDb: Math.max(level, METER_FLOOR_DB, decayed), heldUntil: now };
}

export type MeterZoneTone = 'ok' | 'warn' | 'hot';

export interface MeterZone {
  fromDb: number;
  toDb: number;
  tone: MeterZoneTone;
}

/** OBS-style three-zone meter scale: green up to -20dB, yellow to -9dB, red above. */
export const METER_ZONES: readonly MeterZone[] = [
  { fromDb: -60, toDb: -20, tone: 'ok' },
  { fromDb: -20, toDb: -9, tone: 'warn' },
  { fromDb: -9, toDb: 0, tone: 'hot' },
];
