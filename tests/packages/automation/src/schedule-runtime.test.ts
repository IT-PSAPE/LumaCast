import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createScheduleRuntime,
  selectActiveSchedule,
  type ScheduleRuntimePorts,
  type ScheduleRuntimeCallbacks,
  type ScheduleSelectionInput,
} from '@lumacast/automation';
import type { PlaybackSchedule } from '@lumacast/automation';
import type { ItemRef } from '@lumacast/composition';

const ITEM_REF: ItemRef = { type: 'presentation', id: 'item1' };
const OTHER_REF: ItemRef = { type: 'lyric', id: 'song9' };

function makeTimingSchedule(
  overrides: Partial<PlaybackSchedule & { kind: 'slide-timing' }> = {},
): PlaybackSchedule & { kind: 'slide-timing' } {
  return {
    id: 'sched1',
    itemRef: ITEM_REF,
    enabled: true,
    kind: 'slide-timing',
    steps: [
      { slideId: 's1', durationMs: 2000 },
      { slideId: 's2', durationMs: 3000 },
      { slideId: 's3', durationMs: 1000 },
    ],
    ...overrides,
  };
}

function makeAudioSchedule(
  overrides: Partial<PlaybackSchedule & { kind: 'audio-sync' }> = {},
): PlaybackSchedule & { kind: 'audio-sync' } {
  return {
    id: 'sched2',
    itemRef: ITEM_REF,
    enabled: true,
    kind: 'audio-sync',
    audioAssetId: 'audio1',
    markers: [
      { id: 'm1', timeMs: 1000, slideId: 's1' },
      { id: 'm2', timeMs: 3000, slideId: 's2' },
      { id: 'm3', timeMs: 5000, slideId: 's3' },
    ],
    ...overrides,
  };
}

interface TestContext {
  clock: { now: () => number; advance: (ms: number) => void };
  ports: ScheduleRuntimePorts;
  callbacks: ScheduleRuntimeCallbacks;
  activateSlide: ReturnType<typeof vi.fn>;
  onSuspend: ReturnType<typeof vi.fn>;
  onResume: ReturnType<typeof vi.fn>;
  onSlideTransition: ReturnType<typeof vi.fn>;
  onSyncSuspended: ReturnType<typeof vi.fn>;
  onSyncResumed: ReturnType<typeof vi.fn>;
  audioPlaying: boolean;
  audioTime: number;
  armedAudioId: string | null;
  createRuntime: () => ReturnType<typeof createScheduleRuntime>;
}

function createTestContext(): TestContext {
  let time = 0;
  const clock = {
    now: () => time,
    advance: (ms: number) => { time += ms; },
  };

  const activateSlide = vi.fn();
  const onSuspend = vi.fn();
  const onResume = vi.fn();
  const onSlideTransition = vi.fn();
  const onSyncSuspended = vi.fn();
  const onSyncResumed = vi.fn();

  const ctx: TestContext = {
    clock,
    ports: null as unknown as ScheduleRuntimePorts,
    callbacks: { onSlideTransition, onSyncSuspended, onSyncResumed },
    activateSlide,
    onSuspend,
    onResume,
    onSlideTransition,
    onSyncSuspended,
    onSyncResumed,
    audioPlaying: false,
    audioTime: 0,
    armedAudioId: null,
    createRuntime: () => createScheduleRuntime(() => ctx.ports, () => ctx.callbacks, clock),
  };

  ctx.ports = {
    slides: { activateSlide },
    sync: { onSuspend, onResume },
    audio: {
      isPlaying: () => ctx.audioPlaying,
      getCurrentTime: () => ctx.audioTime,
      armedAudioAssetId: () => ctx.armedAudioId,
    },
  };

  return ctx;
}

describe('schedule-runtime', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
  });

  describe('slide-timing', () => {
    it('transitions to the next slide when the current step expires', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    });

    it('does not transition before the step duration elapses', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(1999);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('transitions through all steps sequentially', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');

      ctx.clock.advance(3000);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's3');
    });

    it('holds on the last step without looping', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.tick();
      ctx.clock.advance(3000);
      rt.tick();
      ctx.clock.advance(1000);
      rt.tick();
      ctx.clock.advance(5000);
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).not.toHaveBeenCalledWith(ITEM_REF, 's1');
    });

    it('restarts the duration after a manual timed-slide action', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.onManualSlide();
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('never activates synchronously on start (safe to enable while editing)', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('anchors the timer on the actual live slide instead of step zero', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule(), { liveSlideId: 's2' });

      ctx.clock.advance(2999);
      rt.tick();
      expect(ctx.activateSlide).not.toHaveBeenCalled();

      ctx.clock.advance(1);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's3');
    });

    it('holds when the live slide is unknown instead of pretending the first step', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule(), { liveSlideId: 'deleted-slide' });

      ctx.clock.advance(10000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('timed manual slide change restarts timing from the actual live slide without suspending', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(1000);
      rt.onManualSlide({ liveSlideId: 's2' });
      expect(rt.isSuspended()).toBe(false);
      expect(ctx.onSuspend).not.toHaveBeenCalled();

      ctx.clock.advance(2999);
      rt.tick();
      expect(ctx.activateSlide).not.toHaveBeenCalled();

      ctx.clock.advance(1);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's3');
    });

    it('timed manual change to an unknown slide holds', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      rt.onManualSlide({ liveSlideId: 'deleted-slide' });
      ctx.clock.advance(10000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
      expect(rt.isSuspended()).toBe(false);
    });

    it('catches up through multiple expired steps and fires once for the landed slide', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      // 2000 (s1) + 3000 (s2) = 5000 elapsed; lands on s3 in a single tick.
      ctx.clock.advance(6000);
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's3');
    });

    it('does nothing for an empty step list', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule({ steps: [] }));

      ctx.clock.advance(10000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });
  });

  describe('audio-sync', () => {
    it('transitions when audio crosses a marker boundary', () => {
      const rt = ctx.createRuntime();
      const schedule = makeAudioSchedule();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(schedule);

      ctx.audioTime = 0.5;
      rt.tick();

      ctx.audioTime = 1.5;
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's1');
    });

    it('does not transition when audio is paused', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = false;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('fires only the latest marker after a forward seek (skipped markers never fire)', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 0.5;
      rt.tick();

      ctx.audioTime = 4.0;
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    });

    it('re-fires the latest marker after a backward seek', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 3.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');

      ctx.audioTime = 1.2;
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).toHaveBeenLastCalledWith(ITEM_REF, 's1');
    });

    it('re-fires from the top after an audio loop wrap', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 5.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's3');

      // Loop wrap: transport jumps back near zero.
      ctx.audioTime = 0.2;
      rt.tick();

      ctx.audioTime = 1.2;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).toHaveBeenLastCalledWith(ITEM_REF, 's1');
    });

    it('first playing tick resolves the latest marker at/below the transport position', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      ctx.audioTime = 4.0;
      rt.start(makeAudioSchedule());

      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');

      ctx.audioTime = 5.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).toHaveBeenLastCalledWith(ITEM_REF, 's3');
    });

    it('first playing tick resolves a marker at zero', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      ctx.audioTime = 0.05;
      rt.start(makeAudioSchedule({
        markers: [
          { id: 'm0', timeMs: 0, slideId: 's1' },
          { id: 'm1', timeMs: 3000, slideId: 's2' },
        ],
      }));

      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's1');
    });

    it('does not refire the unchanged marker on every tick', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();
      ctx.audioTime = 1.6;
      rt.tick();
      ctx.audioTime = 1.7;
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
    });

    it('seek after playback began resolves the new destination even while paused', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's1');

      ctx.audioPlaying = false;
      ctx.audioTime = 4.0;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).toHaveBeenLastCalledWith(ITEM_REF, 's2');
    });

    it('paused seek within the same marker region does not refire', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);

      ctx.audioPlaying = false;
      ctx.audioTime = 1.8;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
    });

    it('seek before playback began does not fire while paused', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = false;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 4.0;
      rt.tick();
      expect(ctx.activateSlide).not.toHaveBeenCalled();

      ctx.audioPlaying = true;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    });

    it('backward seek while paused restores the latest marker', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 3.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');

      ctx.audioPlaying = false;
      ctx.audioTime = 1.2;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).toHaveBeenLastCalledWith(ITEM_REF, 's1');
    });

    it('manual slide suspends audio even while paused until explicit resume', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = false;
      rt.start(makeAudioSchedule());

      rt.onManualSlide();
      expect(rt.isSuspended()).toBe(true);

      ctx.audioPlaying = true;
      ctx.audioTime = 1.5;
      rt.tick();
      expect(ctx.activateSlide).not.toHaveBeenCalled();

      rt.resume();
      ctx.audioTime = 1.6;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
    });

    it('audio triggers still fire exactly once per marker', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();
      ctx.audioTime = 1.6;
      rt.tick();
      ctx.audioTime = 3.5;
      rt.tick();
      ctx.audioTime = 3.6;
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
      expect(ctx.activateSlide).toHaveBeenNthCalledWith(1, ITEM_REF, 's1');
      expect(ctx.activateSlide).toHaveBeenNthCalledWith(2, ITEM_REF, 's2');
      expect(ctx.onSlideTransition).toHaveBeenCalledTimes(2);
    });

    it('freezes while paused and continues without spurious fires on resume', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's1');

      ctx.audioPlaying = false;
      ctx.audioTime = 2.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);

      ctx.audioPlaying = true;
      rt.tick();
      // Still inside marker m1's region: no refire.
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);

      ctx.audioTime = 3.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    });

    it('does not transition for the wrong audio asset', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'other-audio';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('ignores markers with no slide and keeps tracking', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule({
        markers: [
          { id: 'm1', timeMs: 1000, slideId: null },
          { id: 'm2', timeMs: 3000, slideId: 's2' },
        ],
      }));

      ctx.audioTime = 1.5;
      rt.tick();
      expect(ctx.activateSlide).not.toHaveBeenCalled();

      ctx.audioTime = 3.5;
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    });
  });

  describe('manual interruption', () => {
    it('suspends sync on manual slide activation', () => {
      const rt = ctx.createRuntime();
      rt.start(makeAudioSchedule());

      rt.onManualSlide();

      expect(ctx.onSuspend).toHaveBeenCalled();
      expect(ctx.onSyncSuspended).toHaveBeenCalled();
      expect(rt.isSuspended()).toBe(true);
    });

    it('does not suspend if already suspended', () => {
      const rt = ctx.createRuntime();
      rt.start(makeAudioSchedule());

      rt.onManualSlide();
      ctx.onSuspend.mockClear();
      ctx.onSyncSuspended.mockClear();

      rt.onManualSlide();

      expect(ctx.onSuspend).not.toHaveBeenCalled();
    });

    it('does not suspend for schedule-initiated activations', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      ctx.callbacks.onSlideTransition = () => {
        // Mirrors the provider guard: events fired while the runtime's own
        // activation flag is set are never treated as manual.
        if (!rt.isScheduleActivation()) rt.onManualSlide();
      };
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();

      expect(ctx.onSuspend).not.toHaveBeenCalled();
      expect(rt.isSuspended()).toBe(false);
    });

    it('resume explicitly re-anchors the timer', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      rt.onManualSlide();
      expect(rt.isSuspended()).toBe(false);

      rt.resume({ liveSlideId: 's1' });
      expect(rt.isSuspended()).toBe(false);
      expect(ctx.onResume).toHaveBeenCalled();
      expect(ctx.onSyncResumed).toHaveBeenCalled();

      ctx.clock.advance(2000);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    });

    it('resume is a no-op without an active schedule', () => {
      const rt = ctx.createRuntime();

      rt.resume();

      expect(ctx.onResume).not.toHaveBeenCalled();
      expect(ctx.onSyncResumed).not.toHaveBeenCalled();
    });
  });

  describe('deletion / stop', () => {
    it('stops transitions after stop is called', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);

      rt.stop();
      expect(rt.getActiveSchedule()).toBeNull();
      ctx.clock.advance(3000);
      rt.tick();
      expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
    });

    it('does nothing when no schedule is active', () => {
      const rt = ctx.createRuntime();

      ctx.clock.advance(5000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('does not start a disabled schedule', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule({ enabled: false }));

      expect(rt.getActiveSchedule()).toBeNull();
      ctx.clock.advance(5000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('exposes the active schedule', () => {
      const rt = ctx.createRuntime();
      const schedule = makeTimingSchedule();
      rt.start(schedule);

      expect(rt.getActiveSchedule()).toBe(schedule);
    });
  });

  describe('isScheduleActivation', () => {
    it('returns true during a schedule-initiated callback', () => {
      let capturedIsSchedule = false;
      const rt = ctx.createRuntime();
      ctx.callbacks.onSlideTransition = () => {
        capturedIsSchedule = rt.isScheduleActivation();
      };

      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();

      expect(capturedIsSchedule).toBe(true);
    });

    it('returns false outside of a callback', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      expect(rt.isScheduleActivation()).toBe(false);
    });
  });

  describe('setActiveSchedule', () => {
    it('starts a new enabled schedule', () => {
      const rt = ctx.createRuntime();
      rt.setActiveSchedule(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalled();
    });

    it('stops when given null', () => {
      const rt = ctx.createRuntime();
      rt.setActiveSchedule(makeTimingSchedule());
      rt.setActiveSchedule(null);

      ctx.clock.advance(5000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('stops when given a disabled schedule', () => {
      const rt = ctx.createRuntime();
      rt.setActiveSchedule(makeTimingSchedule());
      rt.setActiveSchedule(makeTimingSchedule({ enabled: false }));

      ctx.clock.advance(5000);
      rt.tick();

      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });

    it('replaces the running schedule (track/item change stops the old one)', () => {
      const rt = ctx.createRuntime();
      rt.setActiveSchedule(makeTimingSchedule());

      rt.setActiveSchedule(makeAudioSchedule());
      expect(rt.getActiveSchedule()?.id).toBe('sched2');

      // The old slide-timing timer is gone: advancing the clock fires nothing
      // until the audio transport drives.
      ctx.clock.advance(10000);
      rt.tick();
      expect(ctx.activateSlide).not.toHaveBeenCalled();
    });
  });

  describe('selectActiveSchedule', () => {
    function baseInput(overrides: Partial<ScheduleSelectionInput> = {}): ScheduleSelectionInput {
      return {
        schedules: [],
        outputItemRef: ITEM_REF,
        armedAudioAssetId: null,
        itemExists: () => true,
        audioAssetExists: () => true,
        ...overrides,
      };
    }

    it('selects the slide-timing schedule matching the output item', () => {
      const timing = makeTimingSchedule();
      const selected = selectActiveSchedule(baseInput({ schedules: [timing] }));

      expect(selected).toBe(timing);
    });

    it('ignores slide-timing schedules for other items', () => {
      const timing = makeTimingSchedule({ itemRef: OTHER_REF });
      const selected = selectActiveSchedule(baseInput({ schedules: [timing] }));

      expect(selected).toBeNull();
    });

    it('ignores disabled schedules', () => {
      const timing = makeTimingSchedule({ enabled: false });
      const selected = selectActiveSchedule(baseInput({ schedules: [timing] }));

      expect(selected).toBeNull();
    });

    it('ignores slide-timing schedules with no steps', () => {
      const timing = makeTimingSchedule({ steps: [] });
      const selected = selectActiveSchedule(baseInput({ schedules: [timing] }));

      expect(selected).toBeNull();
    });

    it('ignores schedules whose item was deleted', () => {
      const timing = makeTimingSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [timing],
        itemExists: () => false,
      }));

      expect(selected).toBeNull();
    });

    it('prefers audio-sync matching the armed asset over slide-timing', () => {
      const timing = makeTimingSchedule();
      const audioSync = makeAudioSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [timing, audioSync],
        armedAudioAssetId: 'audio1',
      }));

      expect(selected).toBe(audioSync);
    });

    it('keeps audio-sync selected even while paused (armed asset still matches)', () => {
      // Selection is transport-state agnostic: pausing never swaps the track.
      const timing = makeTimingSchedule();
      const audioSync = makeAudioSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [timing, audioSync],
        armedAudioAssetId: 'audio1',
      }));

      expect(selected).toBe(audioSync);
    });

    it('falls back to slide-timing when the armed asset does not match', () => {
      const timing = makeTimingSchedule();
      const audioSync = makeAudioSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [timing, audioSync],
        armedAudioAssetId: 'other-audio',
      }));

      expect(selected).toBe(timing);
    });

    it('ignores audio-sync schedules whose asset was deleted', () => {
      const timing = makeTimingSchedule();
      const audioSync = makeAudioSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [timing, audioSync],
        armedAudioAssetId: 'audio1',
        audioAssetExists: () => false,
      }));

      expect(selected).toBe(timing);
    });

    it('selects armed audio independently of the current output item', () => {
      const audioSync = makeAudioSchedule({ itemRef: OTHER_REF });
      const selected = selectActiveSchedule(baseInput({
        schedules: [audioSync],
        outputItemRef: ITEM_REF,
        armedAudioAssetId: 'audio1',
      }));

      expect(selected).toBe(audioSync);
    });

    it('selects armed audio with initial empty output', () => {
      const audioSync = makeAudioSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [audioSync],
        outputItemRef: null,
        armedAudioAssetId: 'audio1',
      }));

      expect(selected).toBe(audioSync);
    });

    it('returns null with no output and no armed audio', () => {
      const timing = makeTimingSchedule();
      const selected = selectActiveSchedule(baseInput({
        schedules: [timing],
        outputItemRef: null,
      }));

      expect(selected).toBeNull();
    });

    it('returns null for an empty schedule list', () => {
      expect(selectActiveSchedule(baseInput())).toBeNull();
    });
  });

  describe('final hold', () => {
    it('last timed step holds indefinitely without looping', () => {
      const rt = ctx.createRuntime();
      rt.start(makeTimingSchedule());

      ctx.clock.advance(2000);
      rt.tick();
      ctx.clock.advance(3000);
      rt.tick();
      ctx.clock.advance(1000);
      rt.tick();

      const callCount = ctx.activateSlide.mock.calls.length;

      ctx.clock.advance(100000);
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(callCount);
    });

    it('last audio marker holds: no transition after the final marker time', () => {
      const rt = ctx.createRuntime();
      ctx.armedAudioId = 'audio1';
      ctx.audioPlaying = true;
      rt.start(makeAudioSchedule());

      ctx.audioTime = 1.5;
      rt.tick();
      ctx.audioTime = 3.5;
      rt.tick();
      ctx.audioTime = 5.5;
      rt.tick();

      const callCount = ctx.activateSlide.mock.calls.length;

      ctx.audioTime = 6.0;
      rt.tick();
      ctx.audioTime = 7.0;
      rt.tick();

      expect(ctx.activateSlide).toHaveBeenCalledTimes(callCount);
    });
  });
});


describe('schedule updates and explicit resume', () => {
  it('preserves suspension and playhead history when an audio schedule is edited', () => {
    const ctx = createTestContext();
    const runtime = ctx.createRuntime();
    const schedule = makeAudioSchedule();
    ctx.audioPlaying = true;
    ctx.audioTime = 1.5;
    runtime.start(schedule);
    runtime.tick();
    runtime.onManualSlide();
    runtime.setActiveSchedule({ ...schedule, markers: [...schedule.markers] });
    ctx.audioTime = 3.5;
    runtime.tick();
    expect(runtime.isSuspended()).toBe(true);
    expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
  });
  it('explicit resume resolves the destination even while paused', () => {
    const ctx = createTestContext();
    const runtime = ctx.createRuntime();
    ctx.audioTime = 3.5;
    ctx.audioPlaying = false;
    runtime.start(makeAudioSchedule());
    runtime.onManualSlide();
    runtime.resume();
    runtime.tick();
    expect(ctx.activateSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    runtime.tick();
    expect(ctx.activateSlide).toHaveBeenCalledTimes(1);
  });
  it('holds timing when the provider explicitly has no live slide', () => {
    const ctx = createTestContext();
    const runtime = ctx.createRuntime();
    runtime.start(makeTimingSchedule(), { liveSlideId: null });
    ctx.clock.advance(10000);
    runtime.tick();
    expect(ctx.activateSlide).not.toHaveBeenCalled();
  });
});


it('re-resolves the current marker after rebinding without clearing manual suspension', () => {
  const ctx = createTestContext();
  const runtime = ctx.createRuntime();
  ctx.audioPlaying = true;
  ctx.audioTime = 1.5;
  const schedule = makeAudioSchedule();
  runtime.start(schedule);
  runtime.tick();
  runtime.setActiveSchedule({ ...schedule, itemRef: OTHER_REF, markers: [{ id: 'm1', timeMs: 1000, slideId: 'other-slide' }] });
  runtime.tick();
  expect(ctx.activateSlide).toHaveBeenLastCalledWith(OTHER_REF, 'other-slide');
  runtime.onManualSlide();
  runtime.setActiveSchedule(schedule);
  runtime.tick();
  expect(ctx.activateSlide).toHaveBeenCalledTimes(2);
});
