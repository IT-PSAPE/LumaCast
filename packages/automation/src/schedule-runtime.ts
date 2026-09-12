// Headless playback-schedule runtime. Drives timed slide advances and
// audio-sync slide markers through injected ports. Never touches window,
// DOM, or React — the provider layer owns wiring.
import type { Id } from '@lumacast/kernel';
import type { ItemRef } from '@lumacast/composition';
import type { PlaybackSchedule } from './playback-schedules';
import { resolveAudioMarker } from './playback-schedules';

// ─── Ports ──────────────────────────────────────────────────────────

export interface ScheduleSlidePort {
  activateSlide(itemRef: ItemRef, slideId: Id): void;
}

export interface ScheduleAudioPort {
  /** Whether the audio transport is currently playing (not paused). */
  isPlaying(): boolean;
  /** Current audio element time in seconds. */
  getCurrentTime(): number;
  /** The id of the currently armed audio asset, or null. */
  armedAudioAssetId(): Id | null;
}

export interface ScheduleSyncPort {
  onSuspend(): void;
  onResume(): void;
}

export interface ScheduleObservabilityPort {
  record(category: string, message: string, details?: Record<string, unknown>): void;
}

export interface ScheduleRuntimePorts {
  slides: ScheduleSlidePort;
  audio: ScheduleAudioPort;
  sync: ScheduleSyncPort;
  observability?: ScheduleObservabilityPort;
}

export interface ScheduleRuntimeCallbacks {
  onSlideTransition(itemRef: ItemRef, slideId: Id): void;
  onSyncSuspended(): void;
  onSyncResumed(): void;
}

// ─── Anchor ─────────────────────────────────────────────────────────

export interface ScheduleAnchor {
  /** The currently live slide, if any. Slide-timing starts its timer here. */
  liveSlideId?: Id | null;
}

// ─── Runtime ────────────────────────────────────────────────────────

export interface ScheduleRuntime {
  /** Fire from a timer loop. Reads clock internally. Bounded work per call. */
  tick(): void;
  /**
   * Called when the user manually activates a slide (not from this schedule).
   * For slide-timing this restarts timing from the actual live slide and never
   * suspends; for audio-sync it suspends until explicit resume.
   */
  onManualSlide(anchor?: ScheduleAnchor): void;
  /**
   * Start driving the given schedule. Stops any previously active schedule.
   * Never activates a slide synchronously: slide-timing anchors its timer on
   * the live slide (or the first step) and audio-sync records the current
   * audio time, so enabling while editing is side-effect free.
   */
  start(schedule: PlaybackSchedule, anchor?: ScheduleAnchor): void;
  /** Stop the active schedule. */
  stop(): void;
  /** Restart the active schedule from the live position, clearing suspend. */
  resume(anchor?: ScheduleAnchor): void;
  /** Replace the active schedule in-place (e.g. on persistence update). */
  setActiveSchedule(schedule: PlaybackSchedule | null, anchor?: ScheduleAnchor): void;
  /** The currently driving schedule, if any. */
  getActiveSchedule(): PlaybackSchedule | null;
  /** Whether sync is currently suspended by a manual action. */
  isSuspended(): boolean;
  /** Whether the given activation originated from this schedule runtime. */
  isScheduleActivation(): boolean;
}

interface ScheduleRuntimeState {
  schedule: PlaybackSchedule | null;
  suspended: boolean;
  /**
   * Step index for slide-timing schedules. -1 means hold (live slide unknown):
   * tick does nothing until a manual action re-anchors onto a known step.
   */
  currentStepIndex: number;
  /** Monotonic timestamp (ms) when the current step started. */
  stepStartedAt: number;
  /** Last-seen audio element time (seconds) for seek detection while paused. */
  prevAudioTime: number;
  /** Last resolved audio marker id (null = before first marker). */
  lastAudioMarkerId: Id | null;
  /** True once the transport has been observed playing since start/resume. */
  hasPlayedAudio: boolean;
  /** True while a schedule-initiated slide transition callback is in flight. */
  _activationFromSchedule: boolean;
}

/**
 * Create an isolated schedule runtime. `getPorts` is read lazily on every
 * operation so the caller can swap port implementations across renders.
 */
export function createScheduleRuntime(
  getPorts: () => ScheduleRuntimePorts,
  getCallbacks: () => ScheduleRuntimeCallbacks,
  clock: { now(): number },
): ScheduleRuntime {
  const state: ScheduleRuntimeState = {
    schedule: null,
    suspended: false,
    currentStepIndex: 0,
    stepStartedAt: 0,
    prevAudioTime: 0,
    lastAudioMarkerId: null,
    hasPlayedAudio: false,
    _activationFromSchedule: false,
  };

  function tick(): void {
    const { schedule } = state;
    if (!schedule || !schedule.enabled || state.suspended) return;

    if (schedule.kind === 'slide-timing') {
      tickSlideTiming(schedule);
    } else {
      tickAudioSync(schedule);
    }
  }

  function tickSlideTiming(schedule: PlaybackSchedule & { kind: 'slide-timing' }): void {
    const { slides } = getPorts();
    const { steps } = schedule;
    if (steps.length === 0) return;
    // Unknown live slide holds: never pretend the first step.
    if (state.currentStepIndex < 0) return;

    const now = clock.now();
    // Catch up through every expired step so a delayed tick lands on the
    // correct slide, then fire exactly once for the landed step. The final
    // step holds indefinitely (no looping).
    let index = state.currentStepIndex;
    let base = state.stepStartedAt;
    while (index + 1 < steps.length && now - base >= steps[index].durationMs) {
      base += steps[index].durationMs;
      index += 1;
    }
    if (index === state.currentStepIndex) return;

    state.currentStepIndex = index;
    state.stepStartedAt = base;
    fireSlideTransition(slides, schedule.itemRef, steps[index].slideId);
  }

  function tickAudioSync(schedule: PlaybackSchedule & { kind: 'audio-sync' }): void {
    const { audio, slides } = getPorts();
    if (audio.armedAudioAssetId() !== schedule.audioAssetId) return;

    const currentTimeSec = readAudioTime();
    const currentTimeMs = currentTimeSec * 1000;
    const marker = resolveAudioMarker(schedule.markers, currentTimeMs);
    const markerId = marker ? `${schedule.itemRef?.type}:${schedule.itemRef?.id}:${marker.id}:${marker.slideId}` : null;
    let playing = false;
    try {
      playing = audio.isPlaying();
    } catch {
      playing = false;
    }

    if (!playing) {
      // Pause freezes: only a seek after playback began resolves a new
      // destination, even while paused. Unchanged markers never refire.
      const timeChanged = currentTimeSec !== state.prevAudioTime;
      if (state.hasPlayedAudio && timeChanged && markerId !== state.lastAudioMarkerId) {
        state.lastAudioMarkerId = markerId;
        if (marker?.slideId) {
          fireSlideTransition(slides, schedule.itemRef, marker.slideId);
        }
      }
      state.prevAudioTime = currentTimeSec;
      return;
    }

    // Playing: the first playing tick resolves the marker at zero/latest
    // (lastAudioMarkerId starts null). Later ticks fire only when the
    // resolved marker changes — forward seeks land on the destination only,
    // backward seeks and loop wraps restore the latest marker.
    state.hasPlayedAudio = true;
    if (markerId !== state.lastAudioMarkerId) {
      state.lastAudioMarkerId = markerId;
      if (marker?.slideId) {
        fireSlideTransition(slides, schedule.itemRef, marker.slideId);
      }
    }
    state.prevAudioTime = currentTimeSec;
  }

  function fireSlideTransition(
    slidesPort: ScheduleSlidePort,
    itemRef: ItemRef | null,
    slideId: Id,
  ): void {
    if (!itemRef) return;
    state._activationFromSchedule = true;
    try {
      getCallbacks().onSlideTransition(itemRef, slideId);
      slidesPort.activateSlide(itemRef, slideId);
    } finally {
      state._activationFromSchedule = false;
    }
  }

  function onManualSlide(anchor?: ScheduleAnchor): void {
    if (!state.schedule || state._activationFromSchedule) return;
    if (state.schedule.kind === 'slide-timing') {
      // Timed manual changes restart timing from the actual live slide and
      // never suspend or touch the audio-sync suspended UI.
      const { steps } = state.schedule;
      if (steps.length === 0) return;
      const liveId = anchor?.liveSlideId;
      if (liveId != null) {
        const liveIndex = steps.findIndex((step) => step.slideId === liveId);
        state.currentStepIndex = liveIndex >= 0 ? liveIndex : -1;
        state.stepStartedAt = clock.now();
      } else {
        // No live info: restart the timer on the current step (or hold).
        if (state.currentStepIndex >= 0) state.stepStartedAt = clock.now();
      }
      return;
    }
    if (!state.suspended) {
      state.suspended = true;
      getPorts().sync.onSuspend();
      getCallbacks().onSyncSuspended();
      getPorts().observability?.record('playback', 'Schedule sync suspended by manual action');
    }
  }

  function start(schedule: PlaybackSchedule, anchor?: ScheduleAnchor): void {
    if (!schedule.enabled) return;
    state.schedule = schedule;
    state.suspended = false;
    if (schedule.kind === 'slide-timing') {
      // Anchor the timer on the actual live slide so enabling mid-show
      // continues from what the audience sees instead of jumping to step 0.
      // An explicitly unknown live slide holds; an absent anchor starts at
      // the first step (safe to enable while editing).
      if (anchor?.liveSlideId != null) {
        const liveIndex = schedule.steps.findIndex((step) => step.slideId === anchor.liveSlideId);
        state.currentStepIndex = liveIndex >= 0 ? liveIndex : -1;
      } else {
        state.currentStepIndex = anchor ? -1 : 0;
      }
      state.stepStartedAt = clock.now();
    } else {
      // The first playing tick resolves the marker at zero/latest, so start
      // with no resolved marker and no playback history.
      state.prevAudioTime = readAudioTime();
      state.lastAudioMarkerId = null;
      state.hasPlayedAudio = false;
    }
    getPorts().observability?.record('playback', 'Schedule started', {
      scheduleId: schedule.id,
      kind: schedule.kind,
    });
  }

  function readAudioTime(): number {
    try {
      const t = getPorts().audio.getCurrentTime();
      return Number.isFinite(t) && t >= 0 ? t : 0;
    } catch {
      return 0;
    }
  }

  function stop(): void {
    const wasActive = state.schedule !== null;
    state.schedule = null;
    state.suspended = false;
    state.currentStepIndex = 0;
    state.stepStartedAt = 0;
    state.prevAudioTime = 0;
    state.lastAudioMarkerId = null;
    state.hasPlayedAudio = false;
    if (wasActive) {
      getPorts().observability?.record('playback', 'Schedule stopped');
    }
  }

  function resume(anchor?: ScheduleAnchor): void {
    const { schedule } = state;
    if (!schedule || !schedule.enabled) return;
    start(schedule, anchor);
    if (schedule.kind === 'audio-sync') {
      state.hasPlayedAudio = true;
      state.prevAudioTime = -1;
    }
    getPorts().sync.onResume();
    getCallbacks().onSyncResumed();
  }

  function setActiveSchedule(schedule: PlaybackSchedule | null, anchor?: ScheduleAnchor): void {
    if (!schedule?.enabled) { stop(); return; }
    if (state.schedule?.id === schedule.id && state.schedule.kind === schedule.kind) {
      if (schedule.kind === 'slide-timing') {
        const oldSteps = state.schedule.kind === 'slide-timing' ? state.schedule.steps : [];
        state.schedule = schedule;
        if (JSON.stringify(oldSteps) !== JSON.stringify(schedule.steps)) onManualSlide(anchor);
      } else {
        state.schedule = schedule;
      }
      return;
    }
    start(schedule, anchor);
  }

  function getActiveSchedule(): PlaybackSchedule | null {
    return state.schedule;
  }

  function isSuspended(): boolean {
    return state.suspended;
  }

  function isScheduleActivation(): boolean {
    return state._activationFromSchedule;
  }

  return {
    tick,
    onManualSlide,
    start,
    stop,
    resume,
    setActiveSchedule,
    getActiveSchedule,
    isSuspended,
    isScheduleActivation,
  };
}

// ─── Schedule selection ─────────────────────────────────────────────
// Pure helper the provider uses to pick which persisted schedule (if any)
// drives the output. Audio-sync matching the armed asset wins over
// slide-timing — independently of the current output item (initial empty or
// different output is valid) and even while paused or suspended, so pausing
// never swaps the track out from under the operator. Missing or deleted
// references (unknown item, unknown audio asset, empty steps) never select.

export interface ScheduleSelectionInput {
  schedules: readonly PlaybackSchedule[];
  outputItemRef: ItemRef | null;
  armedAudioAssetId: Id | null;
  itemExists(ref: ItemRef): boolean;
  audioAssetExists(id: Id): boolean;
}

function itemRefsEqual(left: ItemRef | null, right: ItemRef | null): boolean {
  if (!left || !right) return false;
  return left.type === right.type && left.id === right.id;
}

export function selectActiveSchedule(input: ScheduleSelectionInput): PlaybackSchedule | null {
  const { schedules, outputItemRef, armedAudioAssetId, itemExists, audioAssetExists } = input;

  if (armedAudioAssetId && audioAssetExists(armedAudioAssetId)) {
    const audio = schedules.find((schedule) =>
      schedule.enabled
      && schedule.kind === 'audio-sync'
      && schedule.audioAssetId === armedAudioAssetId
      && schedule.markers.some((marker) => marker.slideId !== null)
      && schedule.itemRef !== null
      && itemExists(schedule.itemRef),
    );
    if (audio) return audio;
  }

  if (outputItemRef && itemExists(outputItemRef)) {
    const timing = schedules.find((schedule) =>
      schedule.enabled
      && schedule.kind === 'slide-timing'
      && schedule.itemRef !== null
      && itemRefsEqual(schedule.itemRef, outputItemRef)
      && schedule.steps.length > 0,
    );
    if (timing) return timing;
  }

  return null;
}
