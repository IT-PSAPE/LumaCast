// First-class timers (ADR-0042) — renderer runtime.
//
// Timers are a global named entity: their persisted config lives in the
// project snapshot (via `useProjectContent`) and flows through the same
// `castApi` + `mutatePatch` path every other snapshot-table mutation uses
// (see `slide-tag-manager.tsx` for the pattern this mirrors). Run state
// (start/pause/reset) is volatile — never persisted — because this is a
// single-BrowserWindow app: it lives here as plain React state, not IPC.
//
// This provider is the sole place that ticks: it recomputes `readings` on a
// 250ms interval only while something is actually moving (a timer running,
// or a countdown-to-time timer, which is always wall-clock-live regardless
// of its run state), and otherwise only recomputes on input change. Every
// `BindingProvider` value in the app reads `timerReadings` from here so the
// live show, NDI outputs, and editor previews all agree on one clock.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import {
  IDLE_TIMER_RUN_STATE,
  pauseTimerRun,
  resetTimerRun,
  resolveTimerReading,
  startTimerRun,
  type Timer,
  type TimerReading,
  type TimerRunState,
} from '@lumacast/composition';
import type { TimerCreateInput } from '@lumacast/protocol';
import { useCast } from '../app-context';
import { useProjectContent } from '../use-project-content';

const READING_TICK_MS = 250;

export interface TimersContextValue {
  /** Snapshot timers sorted by persisted `order`. */
  timers: Timer[];
  timersById: ReadonlyMap<Id, Timer>;
  runStates: Readonly<Record<Id, TimerRunState>>;
  /** Live reading per timer id — recomputed on the rule described above. */
  readings: Readonly<Record<Id, TimerReading>>;
  createTimer(input?: Partial<Pick<Timer, 'name' | 'kind' | 'durationSeconds' | 'format'>>): Promise<Timer | null>;
  updateTimer(id: Id, patch: Partial<Omit<Timer, 'id' | 'createdAt' | 'updatedAt'>>): Promise<void>;
  deleteTimer(id: Id): Promise<void>;
  duplicateTimer(id: Id): Promise<Timer | null>;
  start(id: Id): void;
  pause(id: Id): void;
  toggle(id: Id): void;
  reset(id: Id): void;
  startAll(): void;
  pauseAll(): void;
  resetAll(): void;
}

const TimersContext = createContext<TimersContextValue | null>(null);

/** Whether a timer's reading can still change without any run-state action. */
function tickingTimer(timer: Timer, runStates: Readonly<Record<Id, TimerRunState>>): boolean {
  if (timer.kind === 'countdown-to-time') return true;
  return (runStates[timer.id] ?? IDLE_TIMER_RUN_STATE).status === 'running';
}

/**
 * Recomputes every timer's reading, preserving both the outer object and each
 * unchanged `TimerReading` by reference when nothing text/phase/color-visible
 * changed — readers keyed off a single reading (a timers-panel row, a bound
 * text element) skip re-rendering when their own timer didn't move.
 */
function computeReadings(
  timers: readonly Timer[],
  runStates: Readonly<Record<Id, TimerRunState>>,
  nowMs: number,
  prev: Readonly<Record<Id, TimerReading>>,
): Readonly<Record<Id, TimerReading>> {
  let changed = Object.keys(prev).length !== timers.length;
  const next: Record<Id, TimerReading> = {};
  for (const timer of timers) {
    const state = runStates[timer.id] ?? IDLE_TIMER_RUN_STATE;
    const reading = resolveTimerReading(timer, state, nowMs);
    const prevReading = prev[timer.id];
    if (prevReading && prevReading.text === reading.text && prevReading.phase === reading.phase && prevReading.color === reading.color) {
      next[timer.id] = prevReading;
    } else {
      next[timer.id] = reading;
      changed = true;
    }
  }
  return changed ? next : prev;
}

export function TimersProvider({ children }: { children: ReactNode }) {
  const { mutatePatch } = useCast();
  const { timers, timersById } = useProjectContent();
  const [runStates, setRunStates] = useState<Readonly<Record<Id, TimerRunState>>>({});
  const [readings, setReadings] = useState<Readonly<Record<Id, TimerReading>>>({});

  // Deleting a timer (or it disappearing from the snapshot for any reason)
  // drops its run state — nothing else references it by then.
  useEffect(() => {
    setRunStates((prev) => {
      const staleIds = Object.keys(prev).filter((id) => !timersById.has(id as Id));
      if (staleIds.length === 0) return prev;
      const next = { ...prev };
      for (const id of staleIds) delete next[id];
      return next;
    });
  }, [timersById]);

  const shouldTick = useMemo(
    () => timers.some((timer) => tickingTimer(timer, runStates)),
    [timers, runStates],
  );

  useEffect(() => {
    // One immediate recompute whenever the inputs change (config edits while
    // running must apply right away), plus a 250ms tick while anything is
    // still moving. A single `nowMs` per tick keeps every timer's reading
    // computed against the same instant.
    setReadings((prev) => computeReadings(timers, runStates, Date.now(), prev));
    if (!shouldTick) return undefined;
    const intervalId = window.setInterval(() => {
      setReadings((prev) => computeReadings(timers, runStates, Date.now(), prev));
    }, READING_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [timers, runStates, shouldTick]);

  const createTimerRow = useCallback(async (input: TimerCreateInput): Promise<Timer | null> => {
    let created: Timer | null = null;
    await mutatePatch(async () => {
      const patch = await window.castApi.createTimer(input);
      created = patch.upserts.timers?.[0] ?? null;
      return patch;
    });
    return created;
  }, [mutatePatch]);

  const createTimer = useCallback((input?: Partial<Pick<Timer, 'name' | 'kind' | 'durationSeconds' | 'format'>>) => (
    createTimerRow({
      name: input?.name,
      kind: input?.kind,
      durationSeconds: input?.durationSeconds,
      format: input?.format,
    })
  ), [createTimerRow]);

  const updateTimer = useCallback(async (id: Id, patch: Partial<Omit<Timer, 'id' | 'createdAt' | 'updatedAt'>>) => {
    await mutatePatch(() => window.castApi.updateTimer({ id, ...patch }));
  }, [mutatePatch]);

  const deleteTimer = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deleteTimer(id));
  }, [mutatePatch]);

  const duplicateTimer = useCallback(async (id: Id) => {
    const source = timersById.get(id);
    if (!source) return null;
    return createTimerRow({
      name: `${source.name} copy`,
      kind: source.kind,
      durationSeconds: source.durationSeconds,
      targetTime: source.targetTime,
      elapsedStartSeconds: source.elapsedStartSeconds,
      elapsedEndSeconds: source.elapsedEndSeconds,
      allowOverrun: source.allowOverrun,
      format: source.format,
      thresholds: source.thresholds,
    });
  }, [createTimerRow, timersById]);

  const start = useCallback((id: Id) => {
    setRunStates((prev) => ({ ...prev, [id]: startTimerRun(prev[id] ?? IDLE_TIMER_RUN_STATE, Date.now()) }));
  }, []);

  const pause = useCallback((id: Id) => {
    setRunStates((prev) => ({ ...prev, [id]: pauseTimerRun(prev[id] ?? IDLE_TIMER_RUN_STATE, Date.now()) }));
  }, []);

  const toggle = useCallback((id: Id) => {
    const now = Date.now();
    setRunStates((prev) => {
      const state = prev[id] ?? IDLE_TIMER_RUN_STATE;
      const next = state.status === 'running' ? pauseTimerRun(state, now) : startTimerRun(state, now);
      return { ...prev, [id]: next };
    });
  }, []);

  const reset = useCallback((id: Id) => {
    setRunStates((prev) => ({ ...prev, [id]: resetTimerRun() }));
  }, []);

  const startAll = useCallback(() => {
    const now = Date.now();
    setRunStates((prev) => {
      const next = { ...prev };
      for (const timer of timers) next[timer.id] = startTimerRun(prev[timer.id] ?? IDLE_TIMER_RUN_STATE, now);
      return next;
    });
  }, [timers]);

  const pauseAll = useCallback(() => {
    const now = Date.now();
    setRunStates((prev) => {
      const next = { ...prev };
      for (const timer of timers) next[timer.id] = pauseTimerRun(prev[timer.id] ?? IDLE_TIMER_RUN_STATE, now);
      return next;
    });
  }, [timers]);

  const resetAll = useCallback(() => {
    setRunStates((prev) => {
      const next = { ...prev };
      for (const timer of timers) next[timer.id] = resetTimerRun();
      return next;
    });
  }, [timers]);

  const value = useMemo<TimersContextValue>(() => ({
    timers,
    timersById,
    runStates,
    readings,
    createTimer,
    updateTimer,
    deleteTimer,
    duplicateTimer,
    start,
    pause,
    toggle,
    reset,
    startAll,
    pauseAll,
    resetAll,
  }), [
    timers, timersById, runStates, readings, createTimer, updateTimer, deleteTimer,
    duplicateTimer, start, pause, toggle, reset, startAll, pauseAll, resetAll,
  ]);

  return <TimersContext.Provider value={value}>{children}</TimersContext.Provider>;
}

export function useTimers(): TimersContextValue {
  const ctx = useContext(TimersContext);
  if (!ctx) throw new Error('useTimers must be used within TimersProvider');
  return ctx;
}
