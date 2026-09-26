import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { ItemRef } from '@lumacast/composition';
import {
  AUTOMATION_TRIGGER_EVENT,
  createScheduleRuntime,
  selectActiveSchedule,
  type AutomationTriggerEventDetail,
  type PlaybackSchedule,
  type ScheduleRuntime,
} from '@lumacast/automation';
import { useCast } from './app-context';
import { useNavigation } from './navigation-context';
import { useAudio } from './playback/playback-context';
import { useSlides } from './slide-context';
import { useProjectContent } from './use-project-content';

// ─── Types ──────────────────────────────────────────────────────────

interface PlaybackSchedulesContextValue {
  schedules: PlaybackSchedule[];
  saveSchedule(schedule: PlaybackSchedule): Promise<void>;
  deleteSchedule(id: Id): Promise<void>;
  syncSuspended: boolean;
  resumeSync(): void;
}

// ─── Context ────────────────────────────────────────────────────────

const PlaybackSchedulesContext = createContext<PlaybackSchedulesContextValue | null>(null);

// Single tick cadence for both schedule kinds. The runtime does bounded work
// per tick (a step-pointer advance or one marker lookup) and never sets React
// state except on suspend/resume transitions, so this never rerenders at
// frame rate. Monotonic clock with a 20ms bounded tick.
const TICK_INTERVAL_MS = 20;

// ─── Provider ───────────────────────────────────────────────────────

export function PlaybackSchedulesProvider({ children }: { children: ReactNode }) {
  const { snapshot, mutatePatch } = useCast();
  const { currentOutputItemRef } = useNavigation();
  const audio = useAudio();
  const slides = useSlides();
  const { presentationsById, lyricsById, mediaAssetsById, slidesForItemRef } = useProjectContent();

  // ── Schedules live in the snapshot; persistence goes through the storage
  // worker via snapshot patches. No volatile copy is kept here.

  const schedules = useMemo(() => snapshot?.playbackSchedules ?? [], [snapshot]);

  const [syncSuspended, setSyncSuspended] = useState(false);

  // ── Stable refs for runtime wiring (avoid stale closures) ──

  const slidesRef = useRef(slides);
  slidesRef.current = slides;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const currentOutputItemRefRef = useRef(currentOutputItemRef);
  currentOutputItemRefRef.current = currentOutputItemRef;
  const liveSlideRef = useRef(slides.liveSlide);
  liveSlideRef.current = slides.liveSlide;

  // ── Headless runtime ──

  const runtimeRef = useRef<ScheduleRuntime | null>(null);

  if (!runtimeRef.current) {
    runtimeRef.current = createScheduleRuntime(
      () => ({
        slides: {
          activateSlide(itemRef: ItemRef, slideId: Id) {
            // Empty output holds while suspended (manual clear) instead of
            // re-arming anything; after explicit resume (or initial empty
            // output, which is not a manual clear) activation restores output.
            if (!currentOutputItemRefRef.current && runtimeRef.current?.isSuspended()) {
              return;
            }
            slidesRef.current.activateScheduledSlide(itemRef, slideId);
          },
        },
        audio: {
          isPlaying: () => audioRef.current.isPlaybackRunning(),
          getCurrentTime: () => audioRef.current.getCurrentTime(),
          armedAudioAssetId: () => audioRef.current.currentAudioAssetId,
        },
        sync: {
          onSuspend() {
            setSyncSuspended(true);
          },
          onResume() {
            setSyncSuspended(false);
          },
        },
      }),
      () => ({
        onSlideTransition(_itemRef, _slideId) {
          // Slide transition is handled via slides.activateScheduledSlide
          // called inside the runtime's fireSlideTransition.
        },
        onSyncSuspended() {
          setSyncSuspended(true);
        },
        onSyncResumed() {
          setSyncSuspended(false);
        },
      }),
      { now: () => performance.now() },
    );
  }
  const runtime = runtimeRef.current;

  // ── Persistence (storage worker owns the tables) ──

  const saveSchedule = useCallback(async (schedule: PlaybackSchedule) => {
    await mutatePatch(() => window.castApi.savePlaybackSchedule(schedule));
  }, [mutatePatch]);

  const deleteSchedule = useCallback(async (id: Id) => {
    await mutatePatch(() => window.castApi.deletePlaybackSchedule(id));
  }, [mutatePatch]);

  // ── Active schedule selection ──

  const selectedSchedule = useMemo(() => selectActiveSchedule({
    schedules: schedules.map((schedule) => {
      const validIds = new Set(schedule.itemRef ? slidesForItemRef(schedule.itemRef).map((slide) => slide.id) : []);
      return schedule.kind === 'slide-timing'
        ? { ...schedule, steps: schedule.steps.filter((step) => validIds.has(step.slideId)) }
        : { ...schedule, markers: schedule.markers.map((marker) => marker.slideId && !validIds.has(marker.slideId) ? { ...marker, slideId: null } : marker) };
    }),
    outputItemRef: currentOutputItemRef,
    armedAudioAssetId: audio.currentAudioAssetId,
    itemExists: (ref) => {
      if (ref.type === 'presentation') return presentationsById.has(ref.id);
      return lyricsById.has(ref.id);
    },
    audioAssetExists: (id) => mediaAssetsById.has(id),
  }), [
    schedules,
    currentOutputItemRef,
    audio.currentAudioAssetId,
    presentationsById,
    lyricsById,
    mediaAssetsById,
    slidesForItemRef,
  ]);
  const selectedScheduleRef = useRef(selectedSchedule);
  selectedScheduleRef.current = selectedSchedule;

  // Start/stop only when the selected schedule's identity or content
  // changes. Snapshot churn produces new array identities every patch, so a
  // signature comparison keeps unrelated patches from restarting the timer
  // (and from clearing a manual suspend). Same-schedule content edits
  // preserve audio suspension; switching schedules (or clearing selection)
  // clears the suspended UI state.
  const lastSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const signature = selectedSchedule ? JSON.stringify(selectedSchedule) : null;
    if (signature === lastSignatureRef.current) return;
    lastSignatureRef.current = signature;
    runtime.setActiveSchedule(selectedSchedule, { liveSlideId: liveSlideRef.current?.id ?? null });
    setSyncSuspended(runtime.isSuspended());
  }, [selectedSchedule, runtime]);

  // ── Manual activation detection ──
  //
  // Synchronous AUTOMATION_TRIGGER_EVENT subscription. Schedule-initiated
  // transitions dispatch the same event from inside
  // activateScheduledSlide, but they run while the runtime's own-activation
  // flag is set, so they never count as manual. Everything else — operator
  // activate/take/arm — suspends sync until resume.

  useEffect(() => {
    function handleTrigger(event: Event) {
      const detail = (event as CustomEvent<AutomationTriggerEventDetail>).detail;
      if (!detail) return;
      if (detail.triggerType !== 'slide.activate' && detail.triggerType !== 'slide.take') return;
      if (runtimeRef.current?.isScheduleActivation()) return;
      runtimeRef.current?.onManualSlide({ liveSlideId: detail.sourceId });
    }

    window.addEventListener(AUTOMATION_TRIGGER_EVENT, handleTrigger);
    return () => { window.removeEventListener(AUTOMATION_TRIGGER_EVENT, handleTrigger); };
  }, []);

  // A manually cleared output suspends audio sync (initial empty output is
  // not a manual clear); the slides-port guard above keeps the runtime from
  // re-arming anything while suspended. Explicit resume may restore output.
  const prevOutputItemRef = useRef<ItemRef | null>(null);
  const didMountOutputRef = useRef(false);
  useEffect(() => {
    const prev = prevOutputItemRef.current;
    prevOutputItemRef.current = currentOutputItemRef;
    if (!didMountOutputRef.current) {
      didMountOutputRef.current = true;
      return;
    }
    if (prev && !currentOutputItemRef) {
      runtimeRef.current?.onManualSlide({ liveSlideId: liveSlideRef.current?.id ?? null });
    }
  }, [currentOutputItemRef]);

  // ── Clock tick (bounded work, no rerenders) ──

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      runtime.tick();
    }, TICK_INTERVAL_MS);
    return () => { window.clearInterval(intervalId); };
  }, [runtime]);

  // ── Resume sync ──

  const resumeSync = useCallback(() => {
    const selected = selectedScheduleRef.current;
    if (!selected) {
      runtime.stop();
      setSyncSuspended(false);
      return;
    }
    // Explicit resume clears suspend and may restore cleared output on the
    // next runtime tick (audio re-resolves the current marker).
    runtime.resume({ liveSlideId: liveSlideRef.current?.id ?? null });
  }, [runtime]);

  // ── Cleanup on unmount ──

  useEffect(() => {
    return () => { runtime.stop(); };
  }, [runtime]);

  // ── Context value ──

  const value = useMemo<PlaybackSchedulesContextValue>(() => ({
    schedules,
    saveSchedule,
    deleteSchedule,
    syncSuspended,
    resumeSync,
  }), [schedules, saveSchedule, deleteSchedule, syncSuspended, resumeSync]);

  return (
    <PlaybackSchedulesContext.Provider value={value}>
      {children}
    </PlaybackSchedulesContext.Provider>
  );
}

// ─── Hook ──────────────────────────────────────────────────────────

export function usePlaybackSchedules(): PlaybackSchedulesContextValue {
  const ctx = useContext(PlaybackSchedulesContext);
  if (!ctx) throw new Error('usePlaybackSchedules must be used within PlaybackSchedulesProvider');
  return ctx;
}
