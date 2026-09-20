import { describe, expect, it } from 'vitest';
import {
  createDefaultTimer,
  formatTimerSeconds,
  IDLE_TIMER_RUN_STATE,
  pauseTimerRun,
  resetTimerRun,
  resolveTimerReading,
  startTimerRun,
  timerRunElapsedMs,
  type Timer,
  type TimerRunState,
  type TimerThreshold,
} from '../../../../../packages/composition/src/domain/timers';

const THRESHOLDS: TimerThreshold[] = [
  { id: 'th-amber', atSeconds: 60, color: 'amber' },
  { id: 'th-red', atSeconds: 10, color: 'red' },
];

function baseTimer(overrides: Partial<Timer> = {}): Timer {
  return {
    id: 'timer-1',
    name: 'Timer',
    kind: 'countdown',
    durationSeconds: 300,
    targetTime: null,
    elapsedStartSeconds: 0,
    elapsedEndSeconds: null,
    allowOverrun: false,
    format: 'mm:ss',
    thresholds: [],
    order: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Local "HH:mm:ss" for `date`, matching `secondsUntilTargetTimeToday`'s own local-field extraction. */
function localTimeString(date: Date): string {
  const pad = (value: number) => (value < 10 ? `0${value}` : `${value}`);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

describe('formatTimerSeconds', () => {
  it('formats mm:ss', () => {
    expect(formatTimerSeconds(300, 'mm:ss')).toBe('05:00');
    expect(formatTimerSeconds(65, 'mm:ss')).toBe('01:05');
    expect(formatTimerSeconds(0, 'mm:ss')).toBe('00:00');
  });

  it('rolls minutes past 59 in mm:ss instead of wrapping to hours', () => {
    expect(formatTimerSeconds(7500, 'mm:ss')).toBe('125:00');
  });

  it('formats hh:mm:ss', () => {
    expect(formatTimerSeconds(3661, 'hh:mm:ss')).toBe('01:01:01');
    expect(formatTimerSeconds(59, 'hh:mm:ss')).toBe('00:00:59');
  });

  it('renders negative values with a leading "-"', () => {
    expect(formatTimerSeconds(-12, 'mm:ss')).toBe('-00:12');
    expect(formatTimerSeconds(-3661, 'hh:mm:ss')).toBe('-01:01:01');
  });

  it('floors fractional seconds', () => {
    expect(formatTimerSeconds(65.9, 'mm:ss')).toBe('01:05');
  });
});

describe('timer run state', () => {
  it('starts from idle, accumulates while running, and freezes while paused', () => {
    let state = startTimerRun(IDLE_TIMER_RUN_STATE, 1_000);
    expect(state).toEqual({ status: 'running', startedAtMs: 1_000, accumulatedMs: 0 });
    expect(timerRunElapsedMs(state, 6_000)).toBe(5_000);

    state = pauseTimerRun(state, 6_000);
    expect(state).toEqual({ status: 'paused', startedAtMs: null, accumulatedMs: 5_000 });
    // Elapsed stays frozen no matter how much wall-clock time passes while paused.
    expect(timerRunElapsedMs(state, 999_999)).toBe(5_000);

    state = startTimerRun(state, 10_000);
    expect(state).toEqual({ status: 'running', startedAtMs: 10_000, accumulatedMs: 5_000 });
    expect(timerRunElapsedMs(state, 12_000)).toBe(7_000);

    expect(resetTimerRun()).toEqual(IDLE_TIMER_RUN_STATE);
  });

  it('starting an already-running state is a no-op', () => {
    const state = startTimerRun(IDLE_TIMER_RUN_STATE, 1_000);
    expect(startTimerRun(state, 5_000)).toBe(state);
  });

  it('pausing an already-idle/paused state keeps its accumulated time', () => {
    expect(pauseTimerRun(IDLE_TIMER_RUN_STATE, 5_000)).toEqual({ status: 'paused', startedAtMs: null, accumulatedMs: 0 });
    const paused = { status: 'paused', startedAtMs: null, accumulatedMs: 4_000 } as TimerRunState;
    expect(pauseTimerRun(paused, 9_000)).toEqual(paused);
  });
});

describe('resolveTimerReading — countdown', () => {
  it('idle reports the full duration', () => {
    const timer = baseTimer({ thresholds: THRESHOLDS });
    expect(resolveTimerReading(timer, IDLE_TIMER_RUN_STATE, 0)).toEqual({
      seconds: 300,
      text: '05:00',
      phase: 'idle',
      color: null,
    });
  });

  it('counts down while running and selects the smallest active threshold', () => {
    const timer = baseTimer({ thresholds: THRESHOLDS });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);

    // 240s elapsed -> 60s remaining: only the 60s (amber) threshold is active.
    expect(resolveTimerReading(timer, running, 240_000)).toMatchObject({ seconds: 60, phase: 'running', color: 'amber' });
    // 295s elapsed -> 5s remaining: both thresholds active; smallest (10s, red) wins.
    expect(resolveTimerReading(timer, running, 295_000)).toMatchObject({ seconds: 5, phase: 'running', color: 'red' });
  });

  it('clamps to zero and reports finished when overrun is not allowed', () => {
    const timer = baseTimer({ thresholds: THRESHOLDS, allowOverrun: false });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    const reading = resolveTimerReading(timer, running, 305_000);
    // The active-threshold colour persists at the finished boundary.
    expect(reading).toEqual({ seconds: 0, text: '00:00', phase: 'finished', color: 'red' });
  });

  it('goes negative and reports overrun when allowed, keeping the threshold colour', () => {
    const timer = baseTimer({ thresholds: THRESHOLDS, allowOverrun: true });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    const reading = resolveTimerReading(timer, running, 305_000);
    expect(reading).toEqual({ seconds: -5, text: '-00:05', phase: 'overrun', color: 'red' });
  });

  it('reports paused while running-range and not yet finished', () => {
    const timer = baseTimer({ thresholds: THRESHOLDS });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    const paused = pauseTimerRun(running, 250_000);
    // Reading stays pinned to the accumulated 250s regardless of `nowMs`.
    expect(resolveTimerReading(timer, paused, 999_999_999)).toEqual({
      seconds: 50,
      text: '00:50',
      phase: 'paused',
      color: 'amber',
    });
  });

  it('finished/overrun take precedence over paused', () => {
    const timer = baseTimer({ allowOverrun: false });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    const paused = pauseTimerRun(running, 300_000);
    expect(resolveTimerReading(timer, paused, 0).phase).toBe('finished');

    const overrunTimer = baseTimer({ allowOverrun: true });
    const pausedAfterOverrun = pauseTimerRun(startTimerRun(IDLE_TIMER_RUN_STATE, 0), 305_000);
    expect(resolveTimerReading(overrunTimer, pausedAfterOverrun, 0).phase).toBe('overrun');
  });
});

describe('resolveTimerReading — elapsed', () => {
  const elapsedThresholds: TimerThreshold[] = [
    { id: 'half', atSeconds: 30, color: 'amber' },
    { id: 'full', atSeconds: 50, color: 'red' },
  ];

  it('idle reports the configured start value', () => {
    const timer = baseTimer({ kind: 'elapsed', elapsedStartSeconds: 5, elapsedEndSeconds: 60, thresholds: elapsedThresholds });
    expect(resolveTimerReading(timer, IDLE_TIMER_RUN_STATE, 0)).toEqual({
      seconds: 5,
      text: '00:05',
      phase: 'idle',
      color: null,
    });
  });

  it('counts up and selects the largest active threshold', () => {
    const timer = baseTimer({ kind: 'elapsed', elapsedEndSeconds: 60, thresholds: elapsedThresholds });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    expect(resolveTimerReading(timer, running, 40_000)).toMatchObject({ seconds: 40, phase: 'running', color: 'amber' });
    // Both thresholds active by 55s (still short of the 60s end); the larger
    // (50s, red) wins. `allowOverrun` has no effect yet since 55 < 60 —
    // overrun only starts once elapsed seconds reach `elapsedEndSeconds`.
    const overrunTimer = { ...timer, allowOverrun: true };
    expect(resolveTimerReading(overrunTimer, running, 55_000)).toMatchObject({ seconds: 55, phase: 'running', color: 'red' });
  });

  it('clamps to the end and reports finished when overrun is not allowed', () => {
    const timer = baseTimer({ kind: 'elapsed', elapsedEndSeconds: 60, allowOverrun: false, thresholds: elapsedThresholds });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    expect(resolveTimerReading(timer, running, 65_000)).toEqual({ seconds: 60, text: '01:00', phase: 'finished', color: 'red' });
  });

  it('runs forever when elapsedEndSeconds is null', () => {
    const timer = baseTimer({ kind: 'elapsed', elapsedEndSeconds: null });
    const running = startTimerRun(IDLE_TIMER_RUN_STATE, 0);
    expect(resolveTimerReading(timer, running, 1_000_000).phase).toBe('running');
  });
});

describe('resolveTimerReading — countdown-to-time', () => {
  it('is idle with zero seconds when no target time is set', () => {
    const timer = baseTimer({ kind: 'countdown-to-time', targetTime: null });
    expect(resolveTimerReading(timer, IDLE_TIMER_RUN_STATE, 0)).toEqual({
      seconds: 0,
      text: '00:00',
      phase: 'idle',
      color: null,
    });
  });

  it('counts down to today\'s target time regardless of run state', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0, 0);
    const target = new Date(now.getTime() + 5_000);
    const timer = baseTimer({ kind: 'countdown-to-time', targetTime: localTimeString(target) });
    const reading = resolveTimerReading(timer, IDLE_TIMER_RUN_STATE, now.getTime());
    expect(reading.phase).toBe('running');
    expect(reading.seconds).toBeGreaterThan(0);
    expect(reading.seconds).toBeLessThanOrEqual(5);
  });

  it('reports paused (value still live) when the run state is paused but not finished', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0, 0);
    const target = new Date(now.getTime() + 5_000);
    const timer = baseTimer({ kind: 'countdown-to-time', targetTime: localTimeString(target) });
    const paused = pauseTimerRun(startTimerRun(IDLE_TIMER_RUN_STATE, 0), 0);
    expect(resolveTimerReading(timer, paused, now.getTime()).phase).toBe('paused');
  });

  it('reports finished once passed today when overrun is not allowed', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0, 0);
    const target = new Date(now.getTime() - 5_000);
    const timer = baseTimer({ kind: 'countdown-to-time', targetTime: localTimeString(target), allowOverrun: false });
    expect(resolveTimerReading(timer, IDLE_TIMER_RUN_STATE, now.getTime())).toMatchObject({ seconds: 0, phase: 'finished' });
  });

  it('goes negative and reports overrun once passed today when allowed', () => {
    const now = new Date(2026, 0, 1, 12, 0, 0, 0);
    const target = new Date(now.getTime() - 5_000);
    const timer = baseTimer({ kind: 'countdown-to-time', targetTime: localTimeString(target), allowOverrun: true });
    const reading = resolveTimerReading(timer, IDLE_TIMER_RUN_STATE, now.getTime());
    expect(reading.phase).toBe('overrun');
    expect(reading.seconds).toBeLessThan(0);
  });
});

describe('createDefaultTimer', () => {
  it('creates a 5-minute countdown timer with no overrun', () => {
    expect(createDefaultTimer({ id: 'timer-1', name: 'Timer 1', order: 0, now: '2026-01-01T00:00:00.000Z' })).toEqual({
      id: 'timer-1',
      name: 'Timer 1',
      kind: 'countdown',
      durationSeconds: 300,
      targetTime: null,
      elapsedStartSeconds: 0,
      elapsedEndSeconds: null,
      allowOverrun: false,
      format: 'mm:ss',
      thresholds: [],
      order: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
