import { describe, expect, it } from 'vitest';
import type { TextElementPayload } from '@lumacast/composition';
import { buildLyricTextElement, normalizeLyricText, parseLyricImportText } from './lyric-text-utils';
import { DEFAULT_LYRIC_LAYOUT_CONFIG, type LyricLayoutConfig } from './lyric-layout-config';

describe('parseLyricImportText', () => {
  it('splits on CRLF and lone CR', () => {
    expect(parseLyricImportText('a\r\nb')).toEqual(['a', 'b']);
    expect(parseLyricImportText('a\rb')).toEqual(['a', 'b']);
  });

  it('splits on line and paragraph separators', () => {
    expect(parseLyricImportText('a\u2028b\u2029c')).toEqual(['a', 'b', 'c']);
  });

  it('splits on single newlines when no blank lines exist', () => {
    expect(parseLyricImportText('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('prefers blank-line separators when any blank line exists', () => {
    expect(parseLyricImportText('x\ny\n\nz')).toEqual(['x\ny', 'z']);
    expect(parseLyricImportText('x\ny\n \n\t\nz')).toEqual(['x\ny', 'z']);
  });

  it('trims surrounding whitespace including carriage returns and drops empty blocks', () => {
    expect(parseLyricImportText('\r\n  a  \r\r\n\r\nb\t\n')).toEqual(['a', 'b']);
    expect(parseLyricImportText('\n\n \n\r\n')).toEqual([]);
  });
});

describe('normalizeLyricText', () => {
  it('normalizes CR forms and trims edges but keeps internal newlines', () => {
    expect(normalizeLyricText('\r\n a\r\nb \r')).toBe('a\nb');
  });
});

describe('buildLyricTextElement', () => {
  it('derives geometry and typography from the layout config', () => {
    const config: LyricLayoutConfig = {
      boxWidth: 1000,
      boxHeight: 280,
      fontFamily: 'Test Font',
      fontWeight: '300',
      fontSize: 64,
      lineHeight: 1.5,
      segmentsPerSlide: 2,
    };

    const input = buildLyricTextElement('slide-1', 'hello', config);
    const payload = input.payload as TextElementPayload;
    expect(input.slideId).toBe('slide-1');
    expect(input.type).toBe('text');
    expect(input.x).toBe(460);
    expect(input.y).toBe(750);
    expect(input.width).toBe(1000);
    expect(input.height).toBe(280);
    expect(payload.fontFamily).toBe('Test Font');
    expect(payload.fontSize).toBe(64);
    expect(payload.lineHeight).toBe(1.5);
    expect(payload.weight).toBe('300');
    expect(payload.text).toBe('hello');
  });

  it('centers the box horizontally and anchors its bottom edge at y=1030 with defaults', () => {
    const input = buildLyricTextElement('slide-1', 'hello');
    expect(input.x).toBe(76.5);
    expect(input.x + input.width / 2).toBe(960);
    expect(input.y + input.height).toBe(1030);
    expect(input.width).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.boxWidth);
    expect(input.height).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.boxHeight);
    expect((input.payload as TextElementPayload).fontFamily).toBe(DEFAULT_LYRIC_LAYOUT_CONFIG.fontFamily);
  });
});
