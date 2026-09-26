import { describe, expect, it } from 'vitest';
import { formatDurationInput, parseDurationSeconds } from '@renderer/features/playback/timer-duration-input';

describe('parseDurationSeconds', () => {
  it('treats a bare number as minutes', () => {
    expect(parseDurationSeconds('5')).toBe(300);
  });

  it('parses M:SS', () => {
    expect(parseDurationSeconds('5:00')).toBe(300);
    expect(parseDurationSeconds('1:30')).toBe(90);
  });

  it('parses H:MM:SS', () => {
    expect(parseDurationSeconds('1:05:00')).toBe(3900);
    expect(parseDurationSeconds('0:00:45')).toBe(45);
  });

  it('agrees between the bare-number and M:SS forms', () => {
    expect(parseDurationSeconds('5')).toBe(parseDurationSeconds('5:00'));
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDurationSeconds('  5:00  ')).toBe(300);
  });

  it('rejects empty input', () => {
    expect(parseDurationSeconds('')).toBeNull();
    expect(parseDurationSeconds('   ')).toBeNull();
  });

  it('rejects non-numeric segments', () => {
    expect(parseDurationSeconds('abc')).toBeNull();
    expect(parseDurationSeconds('5:xx')).toBeNull();
  });

  it('rejects more than three segments', () => {
    expect(parseDurationSeconds('1:02:03:04')).toBeNull();
  });

  it('rejects negative numbers', () => {
    expect(parseDurationSeconds('-5:00')).toBeNull();
  });
});

describe('formatDurationInput', () => {
  it('formats under an hour as M:SS', () => {
    expect(formatDurationInput(300)).toBe('5:00');
    expect(formatDurationInput(90)).toBe('1:30');
    expect(formatDurationInput(5)).toBe('0:05');
  });

  it('formats an hour or more as H:MM:SS', () => {
    expect(formatDurationInput(3900)).toBe('1:05:00');
    expect(formatDurationInput(45)).toBe('0:45');
  });

  it('clamps negative or non-finite input to zero', () => {
    expect(formatDurationInput(-5)).toBe('0:00');
    expect(formatDurationInput(Number.NaN)).toBe('0:00');
  });

  it('round-trips through parseDurationSeconds', () => {
    for (const seconds of [0, 5, 59, 60, 300, 3599, 3600, 3900]) {
      expect(parseDurationSeconds(formatDurationInput(seconds))).toBe(seconds);
    }
  });
});
