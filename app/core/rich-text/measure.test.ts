import { describe, expect, it } from 'vitest';
import { resolveRun } from './resolve';
import type { RichBoxStyle } from './resolve';
import { measurePieces, runFontString, stringToGraphemes, wrapRuns } from './measure';
import type { LaidOutLine, MeasureText, RichPiece } from './measure';

// Deterministic, additive stand-in for Canvas2D: every character is half the
// font's px size wide, so line capacity is easy to reason about by char count.
const measure: MeasureText = (text, font) => {
  const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
  return text.length * size * 0.5;
};

function box(fontSize: number, overrides: Partial<RichBoxStyle> = {}): RichBoxStyle {
  return {
    fontFamily: 'Inter',
    fontSize,
    color: '#ffffff',
    weight: 400,
    italic: false,
    underline: false,
    strikethrough: false,
    ...overrides,
  };
}

const lineText = (line: LaidOutLine): string => line.pieces.map((piece) => piece.text).join('');

describe('runFontString', () => {
  it('emits a true numeric weight, size, and family', () => {
    expect(runFontString(resolveRun({ text: '' }, box(48)))).toBe('400 48px Inter');
  });

  it('prefixes italic and honors an overridden weight', () => {
    expect(runFontString(resolveRun({ text: '', weight: 700, italic: true }, box(48)))).toBe('italic 700 48px Inter');
  });

  it('falls back to sans-serif when the family is empty', () => {
    expect(runFontString(resolveRun({ text: '' }, box(48, { fontFamily: '' })))).toBe('400 48px sans-serif');
  });

  it('quotes a multi-word family name (Konva parity)', () => {
    expect(runFontString(resolveRun({ text: '' }, box(48, { fontFamily: 'Avenir Next' })))).toBe('400 48px "Avenir Next"');
  });
});

describe('stringToGraphemes', () => {
  it('splits ASCII into single characters', () => {
    expect(stringToGraphemes('abc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps an emoji as one grapheme', () => {
    expect(stringToGraphemes('a😀b')).toEqual(['a', '😀', 'b']);
  });
});

describe('measurePieces', () => {
  it('measures each maximal same-font segment whole and sums', () => {
    const a = resolveRun({ text: '' }, box(10));
    const b = resolveRun({ text: '' }, box(20));
    const pieces: RichPiece[] = [
      { text: 'aa', style: a },
      { text: 'bb', style: b },
      { text: 'cc', style: a },
    ];
    // a:'aa'=10, b:'bb'=20, a:'cc'=10 (non-consecutive a-segments are NOT merged)
    expect(measurePieces(pieces, measure)).toBe(40);
  });
});

describe('wrapRuns (Konva-faithful)', () => {
  it('keeps a line that fits as a single line with lastInParagraph set', () => {
    const lines = wrapRuns([{ text: 'aa aa' }], box(10), { width: 100, measure });
    expect(lines).toHaveLength(1);
    expect(lineText(lines[0])).toBe('aa aa');
    expect(lines[0].lastInParagraph).toBe(true);
  });

  it('wraps at the last word boundary that fits and trims the break', () => {
    // width 25 fits 'aa aa' (=25) but not 'aa aa aa' (=40); breaks at the space.
    const lines = wrapRuns([{ text: 'aa aa aa' }], box(10), { width: 25, measure });
    expect(lines.map(lineText)).toEqual(['aa aa', 'aa']);
    expect(lines.map((line) => line.lastInParagraph)).toEqual([false, true]);
  });

  it('breaks an over-wide single word mid-word (no space to back up to)', () => {
    // 'wwwwww' = 30 > width 20; binary search keeps the largest prefix (4 chars = 20).
    const lines = wrapRuns([{ text: 'wwwwww' }], box(10), { width: 20, measure });
    expect(lines.map(lineText)).toEqual(['wwww', 'ww']);
  });

  it('breaks after a dash as a word boundary', () => {
    // 'ab-cd ef' wrapped at width 25: 'ab-cd' (=25) fits, breaks after the dash region.
    const lines = wrapRuns([{ text: 'aa-bb cc' }], box(10), { width: 25, measure });
    expect(lines.map(lineText)).toEqual(['aa-bb', 'cc']);
  });

  it('keeps an all-whitespace block as one whitespace line (Konva-faithful)', () => {
    const lines = wrapRuns([{ text: '   ' }], box(10), { width: 100, measure });
    expect(lines).toHaveLength(1);
    expect(lineText(lines[0])).toBe('   ');
    expect(lines[0].width).toBe(15);
  });

  it('lays out a truly empty block as a single empty line', () => {
    expect(wrapRuns([{ text: '' }], box(10), { width: 100, measure })).toEqual([
      { pieces: [], width: 0, lastInParagraph: true },
    ]);
  });

  it('keeps per-run pieces and measures a word that spans styles per segment', () => {
    const lines = wrapRuns([{ text: 'He' }, { text: 'llo', weight: 700 }], box(10), { width: 1000, measure });
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line.pieces).toHaveLength(2);
    expect(line.pieces[0]).toMatchObject({ text: 'He', style: { weight: 400 } });
    expect(line.pieces[1]).toMatchObject({ text: 'llo', style: { weight: 700 } });
    expect(line.width).toBe(25); // 'He'(10) + 'llo'(15)
  });

  it('coalesces adjacent runs of identical style into one piece', () => {
    const lines = wrapRuns([{ text: 'ab' }, { text: 'cd' }], box(10), { width: 1000, measure });
    expect(lines[0].pieces).toHaveLength(1);
    expect(lineText(lines[0])).toBe('abcd');
  });
});
