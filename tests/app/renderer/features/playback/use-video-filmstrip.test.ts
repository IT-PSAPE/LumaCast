import { describe, expect, it } from 'vitest';
import { getFilmstripFrameSize, getFilmstripSampleTimes } from '../../../../../app/renderer/features/playback/use-video-filmstrip';

describe('getFilmstripSampleTimes', () => {
  it('spans the video without seeking to the exact end frame', () => {
    const times = getFilmstripSampleTimes(10, 5);
    expect(times).toHaveLength(5);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBeGreaterThan(9.9);
    expect(times.at(-1)).toBeLessThan(10);
    expect(times).toEqual([...times].sort((left, right) => left - right));
  });

  it('handles invalid durations and a single thumbnail', () => {
    expect(getFilmstripSampleTimes(0)).toEqual([]);
    expect(getFilmstripSampleTimes(Number.NaN)).toEqual([]);
    expect(getFilmstripSampleTimes(8, 0)).toEqual([]);
    expect(getFilmstripSampleTimes(8, 1)).toEqual([4]);
  });
});

describe('getFilmstripFrameSize', () => {
  it('preserves landscape and portrait aspect ratios inside the frame bounds', () => {
    expect(getFilmstripFrameSize(1920, 1080)).toEqual({ width: 160, height: 90 });
    expect(getFilmstripFrameSize(1080, 1920)).toEqual({ width: 51, height: 90 });
  });

  it('rejects invalid source dimensions', () => {
    expect(getFilmstripFrameSize(0, 1080)).toBeNull();
    expect(getFilmstripFrameSize(1080, Number.NaN)).toBeNull();
  });
});
