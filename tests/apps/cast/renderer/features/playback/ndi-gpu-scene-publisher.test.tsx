import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { BindingValue, RenderScene } from '@lumacast/composition';
import { useNdiGpuScenePublisher } from '../../../../../../apps/cast/renderer/features/playback/ndi-gpu-scene-publisher';

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), consume: vi.fn(), hasPending: vi.fn(() => false), video: vi.fn(() => null), source: vi.fn<() => string | null>(() => null),
}));
vi.mock('@lumacast/canvas', () => ({ getLayerVideoElement: mocks.video }));
vi.mock('@lumacast/protocol', () => ({ sceneVideoSource: mocks.source }));
vi.mock('../../../../../../apps/cast/renderer/utils/ndi-take-correlation', () => ({
  claimNdiTakeCorrelation: mocks.claim,
  consumeNdiTakeCorrelation: mocks.consume,
  hasPendingNdiTakeCorrelation: mocks.hasPending,
  doesTakeCorrelationMatch: (claim: { slideId: string; outputScopeKey: string }, slideId: string, scope: string) => claim.slideId === slideId && claim.outputScopeKey === scope,
}));
const scene = { slide: { id: 'slide-1' }, nodes: [], width: 1920, height: 1080 } as unknown as RenderScene;
const binding = { currentSlideText: null, nextSlideText: null, slideNotes: null, timerReadings: {} } as BindingValue;
let release: (result: { name: string; accepted: boolean; attemptId?: string }) => void;
const publish = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); mocks.claim.mockReturnValue(null); mocks.hasPending.mockReturnValue(false); mocks.source.mockReturnValue(null);
  Object.defineProperty(window, 'castApi', { configurable: true, value: {
    publishNdiGpuScene: publish,
    onNdiFrameReleased(callback: typeof release) { release = callback; return vi.fn(); },
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useNdiGpuScenePublisher', () => {
  it('announces layer video before the source player has loaded', () => {
    mocks.source.mockReturnValue('/clip.mp4');
    renderHook(() => useNdiGpuScenePublisher('audience', true, scene, binding, null));
    expect(publish.mock.lastCall![0].layerVideo).toEqual(expect.objectContaining({ src: '/clip.mp4', currentTime: 0, playing: false }));
  });

  it('reuses the scene revision for pending take retries and consumes only accepted matching releases', () => {
    const claim = { sequenceId: 9, slideId: 'slide-1', outputScopeKey: 'entry:1', sessionId: 'session', kind: 'manual', takeIssuedAtMs: Date.now() };
    mocks.claim.mockReturnValue(claim);
    mocks.hasPending.mockReturnValue(true);
    renderHook(() => useNdiGpuScenePublisher('audience', true, scene, binding, 'entry:1'));
    const initial = publish.mock.lastCall![0];
    act(() => vi.advanceTimersByTime(200));
    expect(publish.mock.calls.map(([value]) => value.revisionId)).toEqual([initial.revisionId, initial.revisionId, initial.revisionId]);
    act(() => release({ name: 'audience', accepted: false, attemptId: `${initial.revisionId}:1` }));
    expect(mocks.consume).not.toHaveBeenCalled();
    act(() => release({ name: 'audience', accepted: true, attemptId: 'other:1' }));
    expect(mocks.consume).not.toHaveBeenCalled();
    act(() => release({ name: 'audience', accepted: true, attemptId: `${initial.revisionId}:2` }));
    expect(mocks.consume).toHaveBeenCalledWith('audience', 9);
  });

  it('does not consume a stale take after its output scope changes', () => {
    mocks.claim.mockReturnValue({ sequenceId: 3, slideId: 'slide-1', outputScopeKey: 'entry:old', sessionId: 'session', kind: 'manual', takeIssuedAtMs: Date.now() });
    const hook = renderHook(({ scope }) => useNdiGpuScenePublisher('audience', true, scene, binding, scope), { initialProps: { scope: 'entry:old' } });
    const revisionId = publish.mock.lastCall![0].revisionId;
    hook.rerender({ scope: 'entry:new' });
    act(() => release({ name: 'audience', accepted: true, attemptId: `${revisionId}:1` }));
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
