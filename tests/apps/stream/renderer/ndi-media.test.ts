import { describe, expect, it } from 'vitest';
import { ndiAudioChannels, ndiOutputFrameRate, ndiOutputSize, ndiVideoRgba } from '../../../../apps/stream/renderer/ndi-media';

describe('NDI media conversion', () => {
  it('converts BGRA rows to RGBA without treating padded bytes as pixels', () => {
    const frame = { kind: 'video' as const, width: 1, height: 2, stride: 8,
      frameRateN: 30000, frameRateD: 1001,
      data: new Uint8Array([1, 2, 3, 255, 99, 99, 99, 99, 4, 5, 6, 128, 88, 88, 88, 88]) };
    expect([...ndiVideoRgba(frame)]).toEqual([3, 2, 1, 255, 6, 5, 4, 128]);
    expect(frame.data[0]).toBe(1);
    expect(() => ndiVideoRgba({ ...frame, stride: 2 })).toThrow(/Invalid NDI/);
    expect(() => ndiVideoRgba({ ...frame, width: 3840, height: 2161 })).toThrow(/Invalid NDI/);
  });

  it('reads planar channels with stride padding, clamps invalid samples, and keeps mono mono', () => {
    const frame = { kind: 'audio' as const, channels: 2, sampleRate: 48000,
      samplesPerChannel: 2, channelStrideBytes: 12, data: new Float32Array([0.5, NaN, 99, -2, 2, 99]) };
    expect(ndiAudioChannels(frame).map((channel) => [...channel])).toEqual([[0.5, 0], [-1, 1]]);
    expect(ndiAudioChannels({ ...frame, channels: 1 })).toHaveLength(1);
    expect(() => ndiAudioChannels({ ...frame, data: new Float32Array(2) })).toThrow(/Invalid NDI/);
    expect(() => ndiAudioChannels({ ...frame, channelStrideBytes: 3 })).toThrow(/Invalid NDI/);
  });

  it('bounds Program output to even 1080p dimensions while preserving aspect ratio', () => {
    expect(ndiOutputSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(ndiOutputSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(ndiOutputSize(1080, 1920)).toEqual({ width: 606, height: 1080 });
    expect(ndiOutputSize(1280, 720)).toEqual({ width: 1280, height: 720 });
    expect(ndiOutputFrameRate(240)).toBe(60);
    expect(ndiOutputFrameRate(29.97)).toBe(29.97);
  });
});
