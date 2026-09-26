// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatTimestamp, parseTimestamp } from '../../../../packages/markers/src/timestamp';

describe('formatTimestamp', () => {
  it('formats hours, minutes, seconds, and milliseconds zero-padded', () => {
    expect(formatTimestamp(0)).toBe('00:00:00.000');
    expect(formatTimestamp(1)).toBe('00:00:00.001');
    expect(formatTimestamp(999)).toBe('00:00:00.999');
    expect(formatTimestamp(1000)).toBe('00:00:01.000');
    expect(formatTimestamp(61_000)).toBe('00:01:01.000');
    expect(formatTimestamp(3_661_500)).toBe('01:01:01.500');
  });

  it('always uses at least two digits for hours', () => {
    expect(formatTimestamp(0)).toMatch(/^\d{2}:/);
    const tenHours = 10 * 3_600_000;
    expect(formatTimestamp(tenHours)).toBe('10:00:00.000');
  });

  it('pads hours beyond two digits without truncating', () => {
    const hundredHours = 100 * 3_600_000;
    expect(formatTimestamp(hundredHours)).toBe('100:00:00.000');
  });

  it('rounds fractional milliseconds to the nearest integer', () => {
    expect(formatTimestamp(999.4)).toBe('00:00:00.999');
    expect(formatTimestamp(999.6)).toBe('00:00:01.000');
  });

  it('clamps a negative value to zero', () => {
    expect(formatTimestamp(-500)).toBe('00:00:00.000');
  });

  it('throws for a non-finite value', () => {
    expect(() => formatTimestamp(Number.NaN)).toThrow();
    expect(() => formatTimestamp(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatTimestamp(Number.NEGATIVE_INFINITY)).toThrow();
  });
});

describe('parseTimestamp', () => {
  it('parses HH:MM:SS.mmm', () => {
    expect(parseTimestamp('01:02:03.456')).toBe(3_723_456);
  });

  it('parses HH:MM:SS,mmm (comma fractional separator)', () => {
    expect(parseTimestamp('01:02:03,456')).toBe(3_723_456);
  });

  it('parses MM:SS.mmm', () => {
    expect(parseTimestamp('02:03.456')).toBe(123_456);
  });

  it('parses SS.mmm', () => {
    expect(parseTimestamp('03.456')).toBe(3_456);
  });

  it('parses compact H:M:S with no fractional part', () => {
    expect(parseTimestamp('1:2:3')).toBe(3_723_000);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseTimestamp('  01:02:03.456  ')).toBe(3_723_456);
  });

  it('parses a bare decimal number as seconds', () => {
    expect(parseTimestamp('90.5')).toBe(90_500);
    expect(parseTimestamp('90')).toBe(90_000);
  });

  it('rounds fractional milliseconds to an integer', () => {
    expect(parseTimestamp('0:00:00.1')).toBe(100);
    expect(parseTimestamp('0.0005')).toBe(1);
  });

  it('returns null for unparseable input', () => {
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('   ')).toBeNull();
    expect(parseTimestamp('not a timestamp')).toBeNull();
    expect(parseTimestamp('1:2:3:4')).toBeNull();
    expect(parseTimestamp('a:02:03.456')).toBeNull();
    expect(parseTimestamp('01:0a:03.456')).toBeNull();
  });

  it('round-trips with formatTimestamp', () => {
    const ms = 3_723_456;
    expect(parseTimestamp(formatTimestamp(ms))).toBe(ms);
  });
});
