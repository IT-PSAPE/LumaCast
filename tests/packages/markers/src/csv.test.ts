// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCsv, parseCsv } from '../../../../packages/markers/src/csv';
import type { TimedCue } from '../../../../packages/markers/src/types';

describe('parseCsv', () => {
  it('parses rows with no header when the first cell is numeric', () => {
    const text = '1,00:00:01.000,"Hello"\n2,00:00:02.000,"World"\n3,00:00:03.000,"Foo"';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: null, text: 'Hello' },
      { order: 2, startMs: 2000, endMs: null, text: 'World' },
      { order: 3, startMs: 3000, endMs: null, text: 'Foo' },
    ]);
  });

  it('detects and skips a header row', () => {
    const text = 'order,timestamp,text\n1,00:00:01.000,"Hello"\n2,00:00:02.000,"World"';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toHaveLength(2);
    expect(cues[0]).toEqual({ order: 1, startMs: 1000, endMs: null, text: 'Hello' });
  });

  it('does not treat a blank/non-numeric order cell as a header when the timestamp parses', () => {
    const text = ',00:00:01.000,"First"\n,00:00:02.000,"Second"';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  it('handles quoted fields containing commas and escaped quotes', () => {
    const text = '1,00:00:01.000,"Hello, ""world"""';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: null, text: 'Hello, "world"' }]);
  });

  it('handles quoted fields containing embedded newlines', () => {
    const text = 'order,timestamp,text\n1,00:00:01.000,"Line one\nLine two"\n2,00:00:02.000,"Solo"';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: null, text: 'Line one\nLine two' },
      { order: 2, startMs: 2000, endMs: null, text: 'Solo' },
    ]);
  });

  it('strips a UTF-8 BOM before parsing', () => {
    const text = '﻿order,timestamp,text\n1,00:00:01.000,"A"';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: null, text: 'A' }]);
  });

  it('accepts CRLF line endings', () => {
    const text = 'order,timestamp,text\r\n1,00:00:01.000,"A"\r\n2,00:00:02.000,"B"';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: null, text: 'A' },
      { order: 2, startMs: 2000, endMs: null, text: 'B' },
    ]);
  });

  it('skips a row with an unparseable timestamp and warns with the row number', () => {
    const text = 'order,timestamp,text\n1,00:00:01.000,"A"\n2,not-a-time,"B"\n3,00:00:03.000,"C"';
    const { cues, warnings } = parseCsv(text);
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: null, text: 'A' },
      { order: 2, startMs: 3000, endMs: null, text: 'C' },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/row 3/i);
  });

  it('warns once about extra columns and ignores them', () => {
    const text = 'order,timestamp,text,extra\n1,00:00:01.000,"A","x"\n2,00:00:02.000,"B","y"';
    const { cues, warnings } = parseCsv(text);
    expect(cues.map((c) => c.text)).toEqual(['A', 'B']);
    expect(warnings.filter((w) => /extra column/i.test(w))).toHaveLength(1);
  });

  it('allows an empty text field', () => {
    const text = '1,00:00:01.000,""';
    const { cues, warnings } = parseCsv(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: null, text: '' }]);
  });

  it('sorts by startMs regardless of file order or the order column values', () => {
    const text = '3,00:00:05.000,"C"\n1,00:00:01.000,"A"\n2,00:00:03.000,"B"';
    const { cues } = parseCsv(text);
    expect(cues.map((c) => c.text)).toEqual(['A', 'B', 'C']);
    expect(cues.map((c) => c.order)).toEqual([1, 2, 3]);
  });

  it('breaks a startMs tie using a numeric order column', () => {
    const text = '2,00:00:01.000,"Second"\n1,00:00:01.000,"First"';
    const { cues } = parseCsv(text);
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  it('breaks a startMs tie using file order when the order column is not numeric', () => {
    const text = ',00:00:01.000,"First"\n,00:00:01.000,"Second"';
    const { cues } = parseCsv(text);
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
  });

  it('returns no cues and no warnings for empty input', () => {
    expect(parseCsv('')).toEqual({ cues: [], warnings: [] });
  });
});

describe('formatCsv', () => {
  it('writes the header, quotes every text field, and renumbers from 1', () => {
    const cues: TimedCue[] = [
      { order: 5, startMs: 0, endMs: null, text: 'A' },
      { order: 9, startMs: 1000, endMs: null, text: 'B' },
    ];
    const text = formatCsv(cues);
    expect(text).toBe('order,timestamp,text\n1,00:00:00.000,"A"\n2,00:00:01.000,"B"');
  });

  it('escapes embedded quotes', () => {
    const cues: TimedCue[] = [{ order: 1, startMs: 0, endMs: null, text: 'Say "hi"' }];
    expect(formatCsv(cues)).toBe('order,timestamp,text\n1,00:00:00.000,"Say ""hi"""');
  });
});

describe('formatCsv -> parseCsv round trip', () => {
  it('reproduces the original cues exactly', () => {
    const original: TimedCue[] = [
      { order: 1, startMs: 0, endMs: null, text: 'Hello, "world"' },
      { order: 2, startMs: 1500, endMs: null, text: 'Line one\nLine two' },
      { order: 3, startMs: 3000, endMs: null, text: '' },
    ];
    const { cues, warnings } = parseCsv(formatCsv(original));
    expect(warnings).toEqual([]);
    expect(cues).toEqual(original);
  });
});
