import { describe, expect, it } from 'vitest';
import { isAudioElementRunning } from '../../../../../app/renderer/contexts/playback/audio-element-clock';
const playing = { paused: false, ended: false, readyState: 4, dataset: { assetId: 'audio' } };
describe('actual audio clock readiness', () => {
  it('requires actual playback of the expected asset', () => {
    expect(isAudioElementRunning(playing, 'audio', true)).toBe(true);
    expect(isAudioElementRunning(playing, 'different-track', true)).toBe(false);
    expect(isAudioElementRunning(playing, 'audio', false)).toBe(false);
    expect(isAudioElementRunning(null, 'audio', true)).toBe(false);
  });
  it('holds markers during load, failed play, pause, or end', () => {
    expect(isAudioElementRunning({ ...playing, readyState: 1 }, 'audio', true)).toBe(false);
    expect(isAudioElementRunning({ ...playing, paused: true }, 'audio', true)).toBe(false);
    expect(isAudioElementRunning({ ...playing, ended: true }, 'audio', true)).toBe(false);
  });
});
