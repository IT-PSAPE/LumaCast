import { describe, expect, it } from 'vitest';
import { sampleWaveform } from '../../../../../app/renderer/features/playback/use-audio-waveform';
describe('sampleWaveform', () => {
  it('normalizes real audio peaks across both channels', () => {
    expect(sampleWaveform([new Float32Array([0, .5, 0, .25]), new Float32Array([0, 0, -1, 0])], 2)).toEqual([.5, 1]);
  });
  it('handles silence and empty audio without invalid SVG coordinates', () => {
    expect(sampleWaveform([], 10)).toEqual([]);
    expect(sampleWaveform([new Float32Array(4)], 2)).toEqual([0, 0]);
    expect(sampleWaveform([new Float32Array([1])], 600)).toEqual([1]);
  });
});
