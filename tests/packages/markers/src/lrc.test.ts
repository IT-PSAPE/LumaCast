// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatLrc, parseLrc } from '../../../../packages/markers/src/lrc';
import type { TimedCue } from '../../../../packages/markers/src/types';

describe('parseLrc', () => {
  it('parses a single [mm:ss.xx] timestamp tag', () => {
    const { cues, warnings } = parseLrc('[00:12.34]Hello world');
    expect(warnings).toEqual([]);
    expect(cues).toEqual([{ order: 1, startMs: 12_340, endMs: null, text: 'Hello world' }]);
  });

  it('parses a [mm:ss.xxx] (millisecond) timestamp tag', () => {
    const { cues } = parseLrc('[00:12.340]Hello world');
    expect(cues).toEqual([{ order: 1, startMs: 12_340, endMs: null, text: 'Hello world' }]);
  });

  it('produces one cue per timestamp on a multi-timestamp line, sharing the text', () => {
    const { cues, warnings } = parseLrc('[00:12.00][00:45.30]Chorus text');
    expect(warnings).toEqual([]);
    expect(cues).toEqual([
      { order: 1, startMs: 12_000, endMs: null, text: 'Chorus text' },
      { order: 2, startMs: 45_300, endMs: null, text: 'Chorus text' },
    ]);
  });

  it('parses and ignores ID tags such as [ti:] and [ar:]', () => {
    const text = '[ti:Song Title]\n[ar:Artist Name]\n[00:01.00]Line one';
    const { cues, warnings } = parseLrc(text);
    expect(warnings).toEqual([]);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: null, text: 'Line one' }]);
  });

  it('applies a positive [offset:] tag to every timestamp', () => {
    const text = '[offset:+500]\n[00:01.00]Line one';
    const { cues } = parseLrc(text);
    expect(cues).toEqual([{ order: 1, startMs: 1500, endMs: null, text: 'Line one' }]);
  });

  it('applies a negative [offset:] tag to every timestamp', () => {
    const text = '[offset:-500]\n[00:01.00]Line one';
    const { cues } = parseLrc(text);
    expect(cues).toEqual([{ order: 1, startMs: 500, endMs: null, text: 'Line one' }]);
  });

  it('clamps an offset that would push a timestamp negative to zero', () => {
    const text = '[offset:-2000]\n[00:01.00]Line one';
    const { cues } = parseLrc(text);
    expect(cues).toEqual([{ order: 1, startMs: 0, endMs: null, text: 'Line one' }]);
  });

  it('applies the offset regardless of where the tag appears in the file', () => {
    const text = '[00:01.00]Line one\n[offset:+500]';
    const { cues } = parseLrc(text);
    expect(cues).toEqual([{ order: 1, startMs: 1500, endMs: null, text: 'Line one' }]);
  });

  it('sorts by startMs and renumbers 1..n', () => {
    const text = '[00:45.00]Second\n[00:01.00]First';
    const { cues } = parseLrc(text);
    expect(cues.map((c) => c.text)).toEqual(['First', 'Second']);
    expect(cues.map((c) => c.order)).toEqual([1, 2]);
  });

  it('ignores lines with no timestamp tag and no ID tag', () => {
    const text = 'not a tag at all\n[00:01.00]Line one';
    const { cues } = parseLrc(text);
    expect(cues).toEqual([{ order: 1, startMs: 1000, endMs: null, text: 'Line one' }]);
  });
});

describe('formatLrc', () => {
  it('writes [mm:ss.xx]text per cue, in the given order', () => {
    const cues: TimedCue[] = [
      { order: 1, startMs: 0, endMs: null, text: 'Line one' },
      { order: 2, startMs: 12_340, endMs: null, text: 'Line two' },
    ];
    expect(formatLrc(cues)).toBe('[00:00.00]Line one\n[00:12.34]Line two');
  });

  it('still writes a timestamp line for blank text', () => {
    const cues: TimedCue[] = [{ order: 1, startMs: 1000, endMs: null, text: '' }];
    expect(formatLrc(cues)).toBe('[00:01.00]');
  });
});

describe('formatLrc -> parseLrc round trip', () => {
  it('reproduces the original cues exactly at centisecond precision', () => {
    const original: TimedCue[] = [
      { order: 1, startMs: 0, endMs: null, text: 'Line one' },
      { order: 2, startMs: 12_340, endMs: null, text: 'Line two' },
      { order: 3, startMs: 45_300, endMs: null, text: '' },
    ];
    const { cues, warnings } = parseLrc(formatLrc(original));
    expect(warnings).toEqual([]);
    expect(cues).toEqual(original);
  });
});
