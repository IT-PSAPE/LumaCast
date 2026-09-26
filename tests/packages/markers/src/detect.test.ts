// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectCueFormat, formatCues, parseCues } from '../../../../packages/markers/src/detect';
import { formatCsv, parseCsv } from '../../../../packages/markers/src/csv';
import { formatLrc, parseLrc } from '../../../../packages/markers/src/lrc';
import { formatSrt, parseSrt } from '../../../../packages/markers/src/srt';
import type { TimedCue } from '../../../../packages/markers/src/types';

describe('detectCueFormat', () => {
  it('detects by extension first, even with unrelated content', () => {
    expect(detectCueFormat('anything at all', 'lyrics.csv')).toBe('csv');
    expect(detectCueFormat('anything at all', 'lyrics.lrc')).toBe('lrc');
    expect(detectCueFormat('anything at all', 'captions.srt')).toBe('srt');
  });

  it('is case-insensitive about the extension', () => {
    expect(detectCueFormat('anything', 'LYRICS.CSV')).toBe('csv');
  });

  it('falls through to content sniffing for .txt', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nHi';
    expect(detectCueFormat(text, 'captions.txt')).toBe('srt');
  });

  it('falls through to content sniffing for an unrecognized or missing extension', () => {
    const text = '[00:01.00]Hello';
    expect(detectCueFormat(text, 'lyrics.xyz')).toBe('lrc');
    expect(detectCueFormat(text)).toBe('lrc');
  });

  it('sniffs SRT by the "-->" arrow', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nHello';
    expect(detectCueFormat(text)).toBe('srt');
  });

  it('sniffs LRC by a leading [mm:ss line', () => {
    expect(detectCueFormat('[00:12.34]Hello world')).toBe('lrc');
  });

  it('sniffs CSV by a parsable timestamp in the second column', () => {
    const text = 'order,timestamp,text\n1,00:00:01.000,"Hi"';
    expect(detectCueFormat(text)).toBe('csv');
  });

  it('sniffs CSV with no header too', () => {
    expect(detectCueFormat('1,00:00:01.000,"Hi"')).toBe('csv');
  });

  it('returns null when nothing matches', () => {
    expect(detectCueFormat('just some plain prose\nwith no structure at all')).toBeNull();
  });
});

describe('parseCues / formatCues dispatch', () => {
  it('dispatches parseCues to the matching parser', () => {
    const csvText = '1,00:00:01.000,"Hi"';
    expect(parseCues(csvText, 'csv')).toEqual(parseCsv(csvText));

    const lrcText = '[00:01.00]Hi';
    expect(parseCues(lrcText, 'lrc')).toEqual(parseLrc(lrcText));

    const srtText = '1\n00:00:01,000 --> 00:00:02,000\nHi';
    expect(parseCues(srtText, 'srt')).toEqual(parseSrt(srtText));
  });

  it('dispatches formatCues to the matching formatter', () => {
    const cues: TimedCue[] = [{ order: 1, startMs: 1000, endMs: 2000, text: 'Hi' }];
    expect(formatCues(cues, 'csv')).toBe(formatCsv(cues));
    expect(formatCues(cues, 'lrc')).toBe(formatLrc(cues));
    expect(formatCues(cues, 'srt')).toBe(formatSrt(cues));
  });
});
