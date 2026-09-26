// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatSrt, parseSrt } from '../../../../packages/markers/src/srt';
import type { TimedCue } from '../../../../packages/markers/src/types';

describe('parseSrt', () => {
  it('parses indexed blocks with comma-separated fractional timestamps', () => {
    const text = [
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'Hello world',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,500',
      'Goodbye',
    ].join('\n');
    const { cues, warnings } = parseSrt(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: 4000, text: 'Hello world' },
      { order: 2, startMs: 4000, endMs: 6500, text: 'Goodbye' },
    ]);
  });

  it('tolerates a missing index line', () => {
    const text = '00:00:01,000 --> 00:00:04,000\nHello world';
    const { cues, warnings } = parseSrt(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: 4000, text: 'Hello world' }]);
  });

  it('tolerates "." fractional separators', () => {
    const text = '1\n00:00:01.000 --> 00:00:04.000\nHello world';
    const { cues } = parseSrt(text);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: 4000, text: 'Hello world' }]);
  });

  it('joins multi-line cue text with newlines', () => {
    const text = '1\n00:00:01,000 --> 00:00:04,000\nLine one\nLine two';
    const { cues } = parseSrt(text);
    expect(cues[0].text).toBe('Line one\nLine two');
  });

  it('accepts CRLF line endings', () => {
    const text = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\nWorld';
    const { cues, warnings } = parseSrt(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: 2000, text: 'Hello' },
      { order: 2, startMs: 2000, endMs: 3000, text: 'World' },
    ]);
  });

  it('sorts by startMs and renumbers 1..n', () => {
    const text = [
      '1',
      '00:00:05,000 --> 00:00:06,000',
      'Second in time',
      '',
      '2',
      '00:00:01,000 --> 00:00:02,000',
      'First in time',
    ].join('\n');
    const { cues } = parseSrt(text);
    expect(cues.map((c) => c.text)).toEqual(['First in time', 'Second in time']);
    expect(cues.map((c) => c.order)).toEqual([1, 2]);
  });

  it('skips a block with an unparseable timing line and warns with the block number', () => {
    const text = ['1', 'aa:bb:cc --> dd:ee:ff', 'Bad block', '', '2', '00:00:01,000 --> 00:00:02,000', 'Good block'].join(
      '\n',
    );
    const { cues, warnings } = parseSrt(text);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: 2000, text: 'Good block' }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/block 1/i);
  });

  it('skips a block with no "-->" timing line and warns', () => {
    const text = 'not a timing line at all\nSome text';
    const { cues, warnings } = parseSrt(text);
    expect(cues).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/missing/i);
  });

  it('returns no cues and no warnings for empty input', () => {
    expect(parseSrt('')).toEqual({ cues: [], warnings: [] });
  });
});

describe('formatSrt', () => {
  it('writes index, timing (comma fractional separator), and text', () => {
    const cues: TimedCue[] = [{ order: 1, startMs: 1000, endMs: 4000, text: 'Hello' }];
    expect(formatSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:04,000\nHello');
  });

  it('ends a null-endMs cue at the next cue\'s start', () => {
    const cues: TimedCue[] = [
      { order: 1, startMs: 0, endMs: null, text: 'A' },
      { order: 2, startMs: 2000, endMs: null, text: 'B' },
    ];
    expect(formatSrt(cues)).toBe(
      ['1', '00:00:00,000 --> 00:00:02,000', 'A', '', '2', '00:00:02,000 --> 00:00:06,000', 'B'].join('\n'),
    );
  });

  it('ends the last null-endMs cue at start + the default 4000ms duration', () => {
    const cues: TimedCue[] = [{ order: 1, startMs: 1000, endMs: null, text: 'Only' }];
    expect(formatSrt(cues)).toBe('1\n00:00:01,000 --> 00:00:05,000\nOnly');
  });

  it('honors a custom defaultDurationMs', () => {
    const cues: TimedCue[] = [{ order: 1, startMs: 1000, endMs: null, text: 'Only' }];
    expect(formatSrt(cues, { defaultDurationMs: 2000 })).toBe('1\n00:00:01,000 --> 00:00:03,000\nOnly');
  });
});

describe('formatSrt -> parseSrt round trip', () => {
  it('reproduces the original cues exactly when endMs is always set', () => {
    const original: TimedCue[] = [
      { order: 1, startMs: 0, endMs: 2000, text: 'Hello' },
      { order: 2, startMs: 2000, endMs: 5000, text: 'Multi\nLine' },
    ];
    const { cues, warnings } = parseSrt(formatSrt(original));
    expect(warnings).toEqual([]);
    expect(cues).toEqual(original);
  });
});
