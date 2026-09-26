import { describe, expect, it } from 'vitest';
import {
  audioCodecsForContainer,
  estimateAudioBitrate,
  estimateEta,
  pickAudioCodec,
  pickVideoCodec,
  planFrames,
  videoCodecsForContainer,
} from '../../../../../../apps/chord/renderer/features/export/export-plan';

describe('planFrames', () => {
  it('computes frame count and per-frame duration for whole seconds', () => {
    expect(planFrames(2000, 30)).toEqual({ count: 60, frameDurationS: 1 / 30 });
  });

  it('rounds up a fractional final frame', () => {
    expect(planFrames(1001, 30)).toEqual({ count: 31, frameDurationS: 1 / 30 });
  });

  it('never returns zero frames for a zero-length clip', () => {
    expect(planFrames(0, 30).count).toBe(1);
  });

  it('clamps a negative duration to a single frame', () => {
    expect(planFrames(-500, 30).count).toBe(1);
  });
});

describe('videoCodecsForContainer / audioCodecsForContainer', () => {
  it('matches the mp4 container entry', () => {
    expect(videoCodecsForContainer('mp4')).toEqual(['avc', 'hevc', 'av1']);
    expect(audioCodecsForContainer('mp4')).toEqual(['aac', 'opus']);
  });

  it('matches the webm container entry (no aac, no avc/hevc)', () => {
    expect(videoCodecsForContainer('webm')).toEqual(['vp9', 'av1']);
    expect(audioCodecsForContainer('webm')).toEqual(['opus']);
  });
});

describe('pickVideoCodec', () => {
  it('keeps the requested codec when the container allows it and the browser can encode it', () => {
    expect(pickVideoCodec('mp4', 'hevc', ['avc', 'hevc'])).toBe('hevc');
  });

  it('falls back to the first container-allowed codec the browser can encode', () => {
    expect(pickVideoCodec('mp4', 'hevc', ['avc'])).toBe('avc');
  });

  it('rejects a codec the container does not support even if the browser can encode it', () => {
    // mov only lists avc/hevc; av1 is browser-encodable but not container-legal.
    expect(pickVideoCodec('mov', 'av1', ['av1', 'avc'])).toBe('avc');
  });

  it('returns null when nothing in the container is encodable', () => {
    expect(pickVideoCodec('webm', 'vp9', ['avc'])).toBeNull();
  });
});

describe('pickAudioCodec', () => {
  it('keeps the requested codec when it fits', () => {
    expect(pickAudioCodec('mp4', 'aac', ['aac', 'opus'])).toBe('aac');
  });

  it('falls back from aac to opus when aac cannot be encoded', () => {
    expect(pickAudioCodec('mp4', 'aac', ['opus'])).toBe('opus');
  });

  it('falls back from opus to aac when opus cannot be encoded', () => {
    expect(pickAudioCodec('mkv', 'opus', ['aac'])).toBe('aac');
  });

  it('returns null when neither codec fits the container', () => {
    // mov only lists aac; opus is requested and not container-legal, and its
    // aac fallback isn't in the encodable set either.
    expect(pickAudioCodec('mov', 'opus', ['opus'])).toBeNull();
  });
});

describe('estimateAudioBitrate', () => {
  it('increases with quality', () => {
    expect(estimateAudioBitrate('low')).toBeLessThan(estimateAudioBitrate('medium'));
    expect(estimateAudioBitrate('medium')).toBeLessThan(estimateAudioBitrate('high'));
    expect(estimateAudioBitrate('high')).toBeLessThan(estimateAudioBitrate('very-high'));
  });
});

describe('estimateEta', () => {
  it('returns null with fewer than two samples', () => {
    expect(estimateEta([])).toBeNull();
    expect(estimateEta([{ framesDone: 1, totalFrames: 10, atMs: 0 }])).toBeNull();
  });

  it('extrapolates remaining time from the observed rate', () => {
    const samples = [
      { framesDone: 0, totalFrames: 100, atMs: 0 },
      { framesDone: 10, totalFrames: 100, atMs: 1000 },
    ];
    // 10 frames in 1000ms -> 100ms/frame; 90 remaining -> 9000ms.
    expect(estimateEta(samples)).toBe(9000);
  });

  it('returns null when no time has elapsed or no progress was made', () => {
    expect(estimateEta([{ framesDone: 5, totalFrames: 10, atMs: 100 }, { framesDone: 5, totalFrames: 10, atMs: 200 }])).toBeNull();
    expect(estimateEta([{ framesDone: 5, totalFrames: 10, atMs: 100 }, { framesDone: 6, totalFrames: 10, atMs: 100 }])).toBeNull();
  });
});
