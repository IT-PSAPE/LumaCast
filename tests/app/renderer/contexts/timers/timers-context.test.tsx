import { renderHook, act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Timer } from '@lumacast/composition';
import type { SnapshotPatch } from '@lumacast/protocol';
import { TimersProvider, useTimers } from '../../../../../app/renderer/contexts/timers/timers-context';

function makeTimer(overrides: Partial<Timer> = {}): Timer {
  return {
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
    ...overrides,
  };
}

const mocks = vi.hoisted(() => ({
  timers: [] as Timer[],
  mutatePatch: vi.fn(async (action: () => Promise<unknown>) => {
    await action();
    return {};
  }),
}));

vi.mock('../../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({ mutatePatch: mocks.mutatePatch }),
}));

vi.mock('../../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => {
    const timersById = new Map(mocks.timers.map((timer) => [timer.id, timer]));
    return { timers: mocks.timers, timersById };
  },
}));

function renderTimers() {
  return renderHook(() => useTimers(), {
    wrapper: ({ children }) => <TimersProvider>{children}</TimersProvider>,
  });
}

function stubCastApi(overrides: Partial<{
  createTimer: (input: unknown) => Promise<SnapshotPatch>;
  updateTimer: (input: unknown) => Promise<SnapshotPatch>;
  deleteTimer: (id: string) => Promise<SnapshotPatch>;
}> = {}) {
  const emptyPatch: SnapshotPatch = { version: 1, upserts: {}, deletes: {} };
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    createTimer: vi.fn(async () => emptyPatch),
    updateTimer: vi.fn(async () => emptyPatch),
    deleteTimer: vi.fn(async () => emptyPatch),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.timers = [];
  mocks.mutatePatch.mockClear();
  stubCastApi();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TimersProvider run state', () => {
  it('starts, pauses, toggles and resets a timer', () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    const { result } = renderTimers();

    act(() => result.current.start('t1'));
    expect(result.current.runStates.t1.status).toBe('running');

    act(() => result.current.pause('t1'));
    expect(result.current.runStates.t1.status).toBe('paused');

    act(() => result.current.toggle('t1'));
    expect(result.current.runStates.t1.status).toBe('running');

    act(() => result.current.toggle('t1'));
    expect(result.current.runStates.t1.status).toBe('paused');

    act(() => result.current.reset('t1'));
    expect(result.current.runStates.t1).toEqual({ status: 'idle', startedAtMs: null, accumulatedMs: 0 });
  });

  it('starts, pauses and resets every timer via the *All actions', () => {
    mocks.timers = [makeTimer({ id: 't1' }), makeTimer({ id: 't2' })];
    const { result } = renderTimers();

    act(() => result.current.startAll());
    expect(result.current.runStates.t1.status).toBe('running');
    expect(result.current.runStates.t2.status).toBe('running');

    act(() => result.current.pauseAll());
    expect(result.current.runStates.t1.status).toBe('paused');
    expect(result.current.runStates.t2.status).toBe('paused');

    act(() => result.current.resetAll());
    expect(result.current.runStates.t1.status).toBe('idle');
    expect(result.current.runStates.t2.status).toBe('idle');
  });

  it('drops run state for a timer that disappears from the snapshot', () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    const { result, rerender } = renderTimers();

    act(() => result.current.start('t1'));
    expect(result.current.runStates.t1).toBeDefined();

    mocks.timers = [];
    rerender();

    expect(result.current.runStates.t1).toBeUndefined();
  });
});

describe('TimersProvider readings', () => {
  it('ticks a running timer at 250ms and keeps the readings object referentially stable between text changes', () => {
    vi.useFakeTimers();
    mocks.timers = [makeTimer({ id: 't1', durationSeconds: 10 })];
    const { result } = renderTimers();

    act(() => result.current.start('t1'));
    expect(result.current.readings.t1.text).toBe('00:10');
    const readingsAfterStart = result.current.readings;

    // Sub-second ticks (250ms) don't change the floored second count yet.
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.readings.t1.text).toBe('00:10');
    expect(result.current.readings).toBe(readingsAfterStart);

    // Crossing the one-second boundary changes the reading (and its object identity).
    act(() => { vi.advanceTimersByTime(750); });
    expect(result.current.readings.t1.text).toBe('00:09');
    expect(result.current.readings).not.toBe(readingsAfterStart);
  });

  it('does not schedule a tick interval while nothing is running and no countdown-to-time timer exists', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.timers = [makeTimer({ id: 't1' })];
    renderTimers();

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it('schedules a tick interval while a timer is running', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.timers = [makeTimer({ id: 't1' })];
    const { result } = renderTimers();

    act(() => result.current.start('t1'));

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 250);
  });

  it('schedules a tick interval whenever any timer is countdown-to-time, even if idle', () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    mocks.timers = [makeTimer({ id: 't1', kind: 'countdown-to-time', targetTime: '23:59:59' })];
    renderTimers();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 250);
  });

  it('recomputes readings immediately on a config change, without waiting for a tick', () => {
    mocks.timers = [makeTimer({ id: 't1', durationSeconds: 10 })];
    const { result, rerender } = renderTimers();
    expect(result.current.readings.t1.text).toBe('00:10');

    mocks.timers = [makeTimer({ id: 't1', durationSeconds: 42 })];
    rerender();

    expect(result.current.readings.t1.text).toBe('00:42');
  });
});

describe('TimersProvider mutations', () => {
  it('creates a timer and returns the created row', async () => {
    const created = makeTimer({ id: 'new-timer', name: 'Sermon' });
    stubCastApi({
      createTimer: vi.fn(async () => ({ version: 1, upserts: { timers: [created] }, deletes: {} })),
    });
    const { result } = renderTimers();

    let returned: Timer | null = null;
    await act(async () => {
      returned = await result.current.createTimer({ name: 'Sermon' });
    });

    expect(vi.mocked(window.castApi.createTimer)).toHaveBeenCalledWith({
      name: 'Sermon', kind: undefined, durationSeconds: undefined, format: undefined,
    });
    expect(returned).toEqual(created);
    expect(mocks.mutatePatch).toHaveBeenCalledTimes(1);
  });

  it('updates a timer by id and patch', async () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    const { result } = renderTimers();

    await act(async () => {
      await result.current.updateTimer('t1', { name: 'Renamed', durationSeconds: 60 });
    });

    expect(vi.mocked(window.castApi.updateTimer)).toHaveBeenCalledWith({ id: 't1', name: 'Renamed', durationSeconds: 60 });
  });

  it('deletes a timer by id', async () => {
    mocks.timers = [makeTimer({ id: 't1' })];
    const { result } = renderTimers();

    await act(async () => {
      await result.current.deleteTimer('t1');
    });

    expect(vi.mocked(window.castApi.deleteTimer)).toHaveBeenCalledWith('t1');
  });

  it('duplicates a timer, copying its full config with a " copy" name suffix', async () => {
    const source = makeTimer({
      id: 't1',
      name: 'Countdown',
      kind: 'elapsed',
      durationSeconds: 120,
      elapsedStartSeconds: 5,
      elapsedEndSeconds: 600,
      allowOverrun: true,
      format: 'hh:mm:ss',
      thresholds: [{ id: 'th1', atSeconds: 30, color: '#ff0000' }],
    });
    mocks.timers = [source];
    const created = makeTimer({ id: 't2', name: 'Countdown copy' });
    stubCastApi({
      createTimer: vi.fn(async () => ({ version: 1, upserts: { timers: [created] }, deletes: {} })),
    });
    const { result } = renderTimers();

    let returned: Timer | null = null;
    await act(async () => {
      returned = await result.current.duplicateTimer('t1');
    });

    expect(vi.mocked(window.castApi.createTimer)).toHaveBeenCalledWith({
      name: 'Countdown copy',
      kind: 'elapsed',
      durationSeconds: 120,
      targetTime: null,
      elapsedStartSeconds: 5,
      elapsedEndSeconds: 600,
      allowOverrun: true,
      format: 'hh:mm:ss',
      thresholds: [{ id: 'th1', atSeconds: 30, color: '#ff0000' }],
    });
    expect(returned).toEqual(created);
  });

  it('resolves null when duplicating a timer that no longer exists', async () => {
    mocks.timers = [];
    const { result } = renderTimers();

    let returned: Timer | null = makeTimer();
    await act(async () => {
      returned = await result.current.duplicateTimer('missing');
    });

    expect(returned).toBeNull();
    expect(vi.mocked(window.castApi.createTimer)).not.toHaveBeenCalled();
  });
});

describe('useTimers', () => {
  it('throws when used outside TimersProvider', () => {
    expect(() => renderHook(() => useTimers())).toThrow('useTimers must be used within TimersProvider');
  });
});
