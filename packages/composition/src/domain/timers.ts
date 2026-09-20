// Domain primitive: first-class timers (ADR-0042). A timer is a global named
// entity with its own run state and controls; text elements only link to one
// via `TextBinding.timerId` (slide-elements.ts). Modelled on ProPresenter 7's
// timer panel: countdown, countdown-to-a-clock-time, and elapsed/stopwatch
// kinds, each with an optional set of colour thresholds.
import type { Id } from '@lumacast/kernel';

export type TimerKind = 'countdown' | 'countdown-to-time' | 'elapsed';
// Moved here from slide-elements.ts (pre-timer-entity binding shape);
// slide-elements.ts re-exports it so existing imports keep working.
export type TimerFormat = 'mm:ss' | 'hh:mm:ss';

export interface TimerThreshold {
  id: Id;
  /** countdown kinds: fires when remaining <= atSeconds. elapsed: fires when elapsed >= atSeconds. */
  atSeconds: number;
  /** CSS colour applied to linked text while this threshold is active. */
  color: string;
}

export interface Timer {
  id: Id;
  name: string;
  kind: TimerKind;
  /** countdown. */
  durationSeconds: number;
  /** countdown-to-time, local 24h "HH:mm" or "HH:mm:ss". */
  targetTime: string | null;
  /** elapsed (usually 0). */
  elapsedStartSeconds: number;
  /** elapsed; null = run forever. */
  elapsedEndSeconds: number | null;
  /** countdown kinds: keep counting below zero (negative). elapsed: keep counting past end. */
  allowOverrun: boolean;
  format: TimerFormat;
  /** Kept sorted by the store/UI; runtime must not assume order. */
  thresholds: TimerThreshold[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** Volatile run state. Never persisted. */
export interface TimerRunState {
  status: 'idle' | 'running' | 'paused';
  /** Wall clock when the current running segment began. */
  startedAtMs: number | null;
  /** Ms accrued in previous running segments. */
  accumulatedMs: number;
}

export const IDLE_TIMER_RUN_STATE: TimerRunState = { status: 'idle', startedAtMs: null, accumulatedMs: 0 };

/** `finished` = reached end and overrun not allowed; `overrun` = past end and allowed. */
export type TimerPhase = 'idle' | 'running' | 'paused' | 'finished' | 'overrun';

export interface TimerReading {
  /** Signed. countdown kinds: remaining (negative in overrun). elapsed: elapsed value. */
  seconds: number;
  /** Formatted per timer.format; negative renders with a leading "-", e.g. "-00:12". */
  text: string;
  phase: TimerPhase;
  /**
   * Active threshold colour: the threshold with the smallest `atSeconds`
   * that is active for a countdown kind, the largest `atSeconds` that is
   * active for `elapsed`. Persists through overrun.
   */
  color: string | null;
}

export function startTimerRun(state: TimerRunState, nowMs: number): TimerRunState {
  if (state.status === 'running') return state;
  return { status: 'running', startedAtMs: nowMs, accumulatedMs: state.accumulatedMs };
}

export function pauseTimerRun(state: TimerRunState, nowMs: number): TimerRunState {
  if (state.status !== 'running' || state.startedAtMs === null) {
    return { status: 'paused', startedAtMs: null, accumulatedMs: state.accumulatedMs };
  }
  return {
    status: 'paused',
    startedAtMs: null,
    accumulatedMs: state.accumulatedMs + Math.max(0, nowMs - state.startedAtMs),
  };
}

export function resetTimerRun(): TimerRunState {
  return { ...IDLE_TIMER_RUN_STATE };
}

export function timerRunElapsedMs(state: TimerRunState, nowMs: number): number {
  if (state.status === 'running' && state.startedAtMs !== null) {
    return state.accumulatedMs + Math.max(0, nowMs - state.startedAtMs);
  }
  return state.accumulatedMs;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** Replaces canvas's old `formatTimer`; handles negatives, and mm:ss rolls minutes past 59 (e.g. "125:00"). */
export function formatTimerSeconds(seconds: number, format: TimerFormat): string {
  const negative = seconds < 0;
  const safe = Math.floor(Math.abs(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const sign = negative ? '-' : '';

  if (format === 'hh:mm:ss') return `${sign}${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  const totalMinutes = Math.floor(safe / 60);
  return `${sign}${pad(totalMinutes)}:${pad(secs)}`;
}

function pickThresholdColor(
  thresholds: readonly TimerThreshold[],
  value: number,
  mode: 'countdown' | 'elapsed',
): string | null {
  let picked: TimerThreshold | null = null;
  for (const threshold of thresholds) {
    const active = mode === 'countdown' ? value <= threshold.atSeconds : value >= threshold.atSeconds;
    if (!active) continue;
    if (!picked || (mode === 'countdown' ? threshold.atSeconds < picked.atSeconds : threshold.atSeconds > picked.atSeconds)) {
      picked = threshold;
    }
  }
  return picked?.color ?? null;
}

/** Local 24h "HH:mm" or "HH:mm:ss" -> seconds until that time today (may be negative if already passed). */
function secondsUntilTargetTimeToday(targetTime: string, nowMs: number): number {
  const [hoursPart, minutesPart, secondsPart] = targetTime.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  const seconds = secondsPart !== undefined ? Number(secondsPart) : 0;
  const now = new Date(nowMs);
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds, 0);
  return Math.floor((target.getTime() - nowMs) / 1000);
}

export function resolveTimerReading(timer: Timer, state: TimerRunState, nowMs: number): TimerReading {
  if (timer.kind === 'countdown-to-time') {
    if (!timer.targetTime) {
      return { seconds: 0, text: formatTimerSeconds(0, timer.format), phase: 'idle', color: pickThresholdColor(timer.thresholds, 0, 'countdown') };
    }
    const remaining = secondsUntilTargetTimeToday(timer.targetTime, nowMs);
    let phase: TimerPhase;
    let seconds: number;
    if (remaining <= 0) {
      if (timer.allowOverrun) {
        phase = 'overrun';
        seconds = remaining;
      } else {
        phase = 'finished';
        seconds = 0;
      }
    } else {
      seconds = remaining;
      phase = state.status === 'paused' ? 'paused' : 'running';
    }
    return {
      seconds,
      text: formatTimerSeconds(seconds, timer.format),
      phase,
      color: pickThresholdColor(timer.thresholds, seconds, 'countdown'),
    };
  }

  if (timer.kind === 'elapsed') {
    if (state.status === 'idle') {
      const seconds = timer.elapsedStartSeconds;
      return {
        seconds,
        text: formatTimerSeconds(seconds, timer.format),
        phase: 'idle',
        color: pickThresholdColor(timer.thresholds, seconds, 'elapsed'),
      };
    }
    const elapsedMs = timerRunElapsedMs(state, nowMs);
    let seconds = timer.elapsedStartSeconds + Math.floor(elapsedMs / 1000);
    let phase: TimerPhase = 'running';
    if (timer.elapsedEndSeconds !== null && seconds >= timer.elapsedEndSeconds) {
      if (timer.allowOverrun) {
        phase = 'overrun';
      } else {
        seconds = timer.elapsedEndSeconds;
        phase = 'finished';
      }
    }
    if (state.status === 'paused' && phase === 'running') phase = 'paused';
    return {
      seconds,
      text: formatTimerSeconds(seconds, timer.format),
      phase,
      color: pickThresholdColor(timer.thresholds, seconds, 'elapsed'),
    };
  }

  // 'countdown'
  if (state.status === 'idle') {
    const seconds = timer.durationSeconds;
    return {
      seconds,
      text: formatTimerSeconds(seconds, timer.format),
      phase: 'idle',
      color: pickThresholdColor(timer.thresholds, seconds, 'countdown'),
    };
  }
  const elapsedMs = timerRunElapsedMs(state, nowMs);
  const remaining = timer.durationSeconds - Math.floor(elapsedMs / 1000);
  let seconds: number;
  let phase: TimerPhase;
  if (remaining <= 0) {
    if (timer.allowOverrun) {
      phase = 'overrun';
      seconds = remaining;
    } else {
      phase = 'finished';
      seconds = 0;
    }
  } else {
    seconds = remaining;
    phase = 'running';
  }
  if (state.status === 'paused' && phase === 'running') phase = 'paused';
  return {
    seconds,
    text: formatTimerSeconds(seconds, timer.format),
    phase,
    color: pickThresholdColor(timer.thresholds, seconds, 'countdown'),
  };
}

/** countdown 5:00, mm:ss, no overrun. */
export function createDefaultTimer(input: { id: Id; name: string; order: number; now: string }): Timer {
  return {
    id: input.id,
    name: input.name,
    kind: 'countdown',
    durationSeconds: 300,
    targetTime: null,
    elapsedStartSeconds: 0,
    elapsedEndSeconds: null,
    allowOverrun: false,
    format: 'mm:ss',
    thresholds: [],
    order: input.order,
    createdAt: input.now,
    updatedAt: input.now,
  };
}
