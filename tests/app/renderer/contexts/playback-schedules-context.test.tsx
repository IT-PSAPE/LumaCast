import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_TRIGGER_EVENT } from '@lumacast/automation';
import {
  PlaybackSchedulesProvider,
  usePlaybackSchedules,
} from '../../../../app/renderer/contexts/playback-schedules-context';

const ITEM_REF = { type: 'presentation', id: 'item1' } as const;

const mocks = vi.hoisted(() => ({
  schedules: [] as any[],
  mutatePatch: vi.fn(async (action: () => Promise<unknown>) => {
    await action();
    return null;
  }),
  savePlaybackSchedule: vi.fn(async () => ({})),
  deletePlaybackSchedule: vi.fn(async () => ({})),
  outputItemRef: null as unknown as { type: string; id: string } | null,
  audioPlaying: true,
  audioTimeSec: 0,
  audioAssetId: 'audio1' as string | null,
  liveSlide: { id: 's1' } as { id: string } | null,
  activateScheduledSlide: vi.fn(),
}));

vi.mock('../../../../app/renderer/contexts/app-context', () => ({
  useCast: () => ({
    snapshot: { playbackSchedules: mocks.schedules },
    mutatePatch: mocks.mutatePatch,
  }),
}));

vi.mock('../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => ({ currentOutputItemRef: mocks.outputItemRef }),
}));

vi.mock('../../../../app/renderer/contexts/playback/playback-context', () => ({
  useAudio: () => ({
    isPlaying: mocks.audioPlaying,
    isPlaybackRunning: () => mocks.audioPlaying,
    getCurrentTime: () => mocks.audioTimeSec,
    currentAudioAssetId: mocks.audioAssetId,
  }),
}));

vi.mock('../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => ({
    liveSlide: mocks.liveSlide,
    activateScheduledSlide: mocks.activateScheduledSlide,
  }),
}));

vi.mock('../../../../app/renderer/contexts/use-project-content', () => ({
  useProjectContent: () => ({
    presentationsById: new Map([['item1', {}]]),
    lyricsById: new Map([['song9', {}]]),
    talksById: new Map(),
    mediaAssetsById: new Map([['audio1', {}]]),
    slidesForItemRef: () => [{ id: 's1' }, { id: 's2' }],
  }),
}));

function makeAudioSchedule(id = 'sched-audio') {
  return {
    id,
    itemRef: { ...ITEM_REF },
    enabled: true,
    kind: 'audio-sync',
    audioAssetId: 'audio1',
    markers: [
      { id: 'm1', timeMs: 0, slideId: 's1' },
      { id: 'm2', timeMs: 3000, slideId: 's2' },
    ],
  };
}

function makeTimingSchedule(id = 'sched-timing') {
  return {
    id,
    itemRef: { ...ITEM_REF },
    enabled: true,
    kind: 'slide-timing',
    steps: [
      { slideId: 's1', durationMs: 2000 },
      { slideId: 's2', durationMs: 2000 },
    ],
  };
}

type SchedulesValue = ReturnType<typeof usePlaybackSchedules>;
let latest: SchedulesValue | null = null;
let nowMs = 0;

function Probe() {
  latest = usePlaybackSchedules();
  return null;
}

function Harness() {
  return (
    <PlaybackSchedulesProvider>
      <Probe />
    </PlaybackSchedulesProvider>
  );
}

function dispatchTrigger(triggerType: 'slide.activate' | 'slide.take', sourceId: string | null) {
  window.dispatchEvent(
    new CustomEvent(AUTOMATION_TRIGGER_EVENT, { detail: { triggerType, sourceId } }),
  );
}

/** Advance the provider's 20ms interval while moving its performance.now clock. */
function advance(ms: number) {
  act(() => {
    nowMs += ms;
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  cleanup();
  latest = null;
  nowMs = 0;
  mocks.schedules = [];
  mocks.mutatePatch.mockReset();
  mocks.mutatePatch.mockImplementation(async (action: () => Promise<unknown>) => {
    await action();
    return null;
  });
  mocks.savePlaybackSchedule.mockReset();
  mocks.savePlaybackSchedule.mockImplementation(async () => ({}));
  mocks.deletePlaybackSchedule.mockReset();
  mocks.deletePlaybackSchedule.mockImplementation(async () => ({}));
  mocks.outputItemRef = null;
  mocks.audioPlaying = true;
  mocks.audioTimeSec = 0;
  mocks.audioAssetId = 'audio1';
  mocks.liveSlide = { id: 's1' };
  // Mirror the real SlideProvider: schedule activations dispatch the trigger
  // event synchronously, so the provider must ignore them via its
  // isScheduleActivation flag while still suspending on genuine manual ones.
  mocks.activateScheduledSlide.mockReset();
  mocks.activateScheduledSlide.mockImplementation((_itemRef: unknown, slideId: string) => {
    dispatchTrigger('slide.activate', slideId);
  });
  (window as any).castApi = {
    savePlaybackSchedule: mocks.savePlaybackSchedule,
    deletePlaybackSchedule: mocks.deletePlaybackSchedule,
  };
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as any).castApi;
});

describe('PlaybackSchedulesProvider', () => {
  it('arms an audio-sync schedule from empty output and activates the time-0 marker when playing', () => {
    mocks.schedules = [makeAudioSchedule()];
    render(<Harness />);
    advance(25);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledWith(ITEM_REF, 's1');
    expect(latest?.syncSuspended).toBe(false);
  });

  it('suspends on a manual trigger sourceId while liveSlide ref still reports the old slide; schedule activations do not suspend', () => {
    mocks.schedules = [makeAudioSchedule()];
    render(<Harness />);
    // Schedule-driven activation fires through the mocked slides port (which
    // dispatches the trigger event like the real SlideProvider) and must not
    // count as manual.
    advance(25);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
    expect(latest?.syncSuspended).toBe(false);

    // Operator takes an arbitrary slide while the liveSlide ref still
    // reports the old one: the event sourceId — not the stale ref — marks it
    // manual.
    act(() => { dispatchTrigger('slide.activate', 's9'); });
    expect(latest?.syncSuspended).toBe(true);
  });

  it('resolves a paused seek destination without refiring unchanged markers', () => {
    mocks.schedules = [makeAudioSchedule()];
    render(<Harness />);
    advance(25);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
    mocks.activateScheduledSlide.mockClear();

    mocks.audioPlaying = false;
    mocks.audioTimeSec = 3.5;
    advance(25);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledWith(ITEM_REF, 's2');

    advance(100);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
  });

  it('suspends when output is cleared and restores output on explicit resume', () => {
    mocks.schedules = [makeAudioSchedule()];
    mocks.outputItemRef = { ...ITEM_REF } as any;
    const view = render(<Harness />);
    advance(25);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);

    // Manual clear (output had a value, now empty) suspends sync.
    mocks.outputItemRef = null;
    view.rerender(<Harness />);
    expect(latest?.syncSuspended).toBe(true);

    // While suspended the slides-port guard holds instead of re-arming.
    mocks.activateScheduledSlide.mockClear();
    mocks.audioTimeSec = 3.5;
    advance(25);
    expect(mocks.activateScheduledSlide).not.toHaveBeenCalled();

    // Explicit resume clears suspend; the next playing tick restores output.
    act(() => { latest?.resumeSync(); });
    expect(latest?.syncSuspended).toBe(false);
    advance(25);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
  });

  it('preserves suspension across same-id snapshot edits; switching schedules clears it', () => {
    mocks.schedules = [makeAudioSchedule()];
    const view = render(<Harness />);
    act(() => { dispatchTrigger('slide.take', 's9'); });
    expect(latest?.syncSuspended).toBe(true);

    // Same schedule id with edited content keeps the manual suspend.
    const edited = { ...makeAudioSchedule(), markers: [{ id: 'm1', timeMs: 0, slideId: 's1' }] };
    mocks.schedules = [edited];
    view.rerender(<Harness />);
    expect(latest?.syncSuspended).toBe(true);

    // Switching to a different schedule clears the suspended UI state.
    mocks.outputItemRef = { ...ITEM_REF } as any;
    mocks.schedules = [makeTimingSchedule('other')];
    view.rerender(<Harness />);
    expect(latest?.syncSuspended).toBe(false);
  });

  it('saves and deletes schedules through mutatePatch and castApi', async () => {
    mocks.schedules = [makeAudioSchedule()];
    render(<Harness />);
    const schedule = makeAudioSchedule();
    await act(async () => { await latest?.saveSchedule(schedule as any); });
    expect(mocks.savePlaybackSchedule).toHaveBeenCalledWith(schedule);
    expect(mocks.mutatePatch).toHaveBeenCalledTimes(1);

    await act(async () => { await latest?.deleteSchedule('sched-audio'); });
    expect(mocks.deletePlaybackSchedule).toHaveBeenCalledWith('sched-audio');
    expect(mocks.mutatePatch).toHaveBeenCalledTimes(2);
  });

  it('advances a timed schedule exactly at the elapsed boundary and fires once', () => {
    mocks.schedules = [makeTimingSchedule()];
    mocks.outputItemRef = { ...ITEM_REF } as any;
    mocks.audioAssetId = null;
    render(<Harness />);
    advance(1999);
    expect(mocks.activateScheduledSlide).not.toHaveBeenCalled();
    advance(1);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
    // Final step holds indefinitely (no looping).
    advance(8000);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledTimes(1);
  });

  it('anchors manual timing from the trigger destination before React updates liveSlide', () => {
    mocks.schedules = [makeTimingSchedule()];
    mocks.outputItemRef = { ...ITEM_REF };
    mocks.audioAssetId = null;
    render(<Harness />);
    act(() => { dispatchTrigger('slide.activate', 's2'); });
    advance(10000);
    expect(mocks.activateScheduledSlide).not.toHaveBeenCalled();
    expect(latest?.syncSuspended).toBe(false);
  });

  it('falls back to timing when every audio destination was deleted', () => {
    mocks.schedules = [
      { ...makeAudioSchedule(), markers: [{ id: 'm', timeMs: 0, slideId: 'deleted-slide' }] },
      makeTimingSchedule(),
    ];
    mocks.outputItemRef = { ...ITEM_REF };
    render(<Harness />);
    advance(2000);
    expect(mocks.activateScheduledSlide).toHaveBeenCalledWith(ITEM_REF, 's2');
  });

  it('does not select an audio-sync schedule bound to an unknown item', () => {
    mocks.schedules = [{ ...makeAudioSchedule(), itemRef: { type: 'lyric', id: 'deleted-item' } }];
    render(<Harness />);
    advance(100);
    expect(mocks.activateScheduledSlide).not.toHaveBeenCalled();
  });
});
