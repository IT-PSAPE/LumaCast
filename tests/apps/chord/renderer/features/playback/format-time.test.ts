import { describe, expect, it } from 'vitest';
import {
  formatClock,
  formatTimecode,
} from '../../../../../../apps/chord/renderer/features/playback/format-time';

describe('formatTimecode', () => {
  it('formats MM:SS:FF at zero', () => {
    expect(formatTimecode(0, 30)).toBe('00:00:00');
  });

  it('computes the frame within the current second from fps', () => {
    expect(formatTimecode(500, 30)).toBe('00:00:15');
    expect(formatTimecode(500, 24)).toBe('00:00:12');
  });

  it('rolls seconds and minutes over correctly', () => {
    expect(formatTimecode(61_000, 30)).toBe('01:01:00');
    expect(formatTimecode(3_661_000, 30)).toBe('61:01:00');
  });

  it('never returns a frame count that reaches fps', () => {
    // 999ms at 60fps: floor(0.999 * 60) = 59, never 60.
    expect(formatTimecode(999, 60)).toBe('00:00:59');
  });

  it('clamps negative input to zero', () => {
    expect(formatTimecode(-500, 30)).toBe('00:00:00');
  });
});

describe('formatClock', () => {
  it('formats M:SS.t at zero', () => {
    expect(formatClock(0)).toBe('0:00.0');
  });

  it('includes one decimal of a second', () => {
    expect(formatClock(1500)).toBe('0:01.5');
  });

  it('rolls seconds into minutes without padding the minute', () => {
    expect(formatClock(61_000)).toBe('1:01.0');
    expect(formatClock(600_000)).toBe('10:00.0');
  });

  it('clamps negative input to zero', () => {
    expect(formatClock(-1000)).toBe('0:00.0');
  });
});
