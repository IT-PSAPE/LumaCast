import { describe, it, expect } from 'vitest';
import { resolveAudioMarker, nextTimedSlide } from '@lumacast/automation';
const markers = [{ id: 'b', timeMs: 2000, slideId: 's2' }, { id: 'a', timeMs: 1000, slideId: 's1' }];
describe('audio destinations', () => {
  it('uses the latest reached marker at exact boundaries and after seeking', () => {
    expect(resolveAudioMarker(markers, 2000)?.slideId).toBe('s2');
    expect(resolveAudioMarker(markers, 1500)?.slideId).toBe('s1');
    expect(resolveAudioMarker(markers, 10000)?.slideId).toBe('s2');
  });
  it('does not activate before the first marker or for invalid clocks', () => {
    for (const time of [0, -1, NaN, Infinity]) expect(resolveAudioMarker(markers, time)).toBeNull();
  });
  it('stops at the last timed slide and respects schedule order', () => {
    const steps = [{ slideId: 's2', durationMs: 1000 }, { slideId: 's1', durationMs: 3000 }];
    expect(nextTimedSlide(steps, 's2')?.slideId).toBe('s1');
    expect(nextTimedSlide(steps, 's1')).toBeNull();
    expect(nextTimedSlide(steps, 'deleted')).toBeNull();
  });
});


it('creates a stable audio schedule identity', async () => {
  const { createAudioSyncSchedule } = await import('@lumacast/automation');
  expect(createAudioSyncSchedule('track')).toMatchObject({ id: 'audio:track', audioAssetId: 'track', enabled: false });
});
