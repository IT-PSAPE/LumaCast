import { describe, expect, it } from 'vitest';
import type { RichBody, TextElementPayload } from '@lumacast/composition';
import { fitTextElementToBody } from '../../../../packages/canvas/src/inline-text-editor-utils';

// jsdom has no canvas, so the shared measurer falls back to its deterministic
// estimate (text.length * fontSize * 0.5) and line metrics reduce to
// fontSize * lineHeight per line. A 32px line at line-height 1.25 is 40 units.
function payload(overrides: Partial<TextElementPayload> = {}): TextElementPayload {
  return {
    text: '',
    fontFamily: 'Inter',
    fontSize: 32,
    color: '#ffffff',
    alignment: 'left',
    verticalAlign: 'middle',
    lineHeight: 1.25,
    weight: '400',
    ...overrides,
  };
}

function lines(count: number): RichBody {
  return Array.from({ length: count }, (_, index) => ({ runs: [{ text: `line ${index + 1}` }], indent: 0 }));
}

const ELEMENT = { y: 100, width: 600, height: 120 };

describe('fitTextElementToBody', () => {
  it('returns null when the text already fits the box', () => {
    expect(fitTextElementToBody(ELEMENT, payload(), lines(3))).toBeNull();
  });

  it('never shrinks a box below its authored height', () => {
    expect(fitTextElementToBody(ELEMENT, payload(), lines(1))).toBeNull();
    expect(fitTextElementToBody({ ...ELEMENT, height: 1000 }, payload(), lines(5))).toBeNull();
  });

  it('grows a middle-aligned box equally up and down around the text', () => {
    // 5 lines × 40 = 200 units; delta 80 → y moves up by 40.
    expect(fitTextElementToBody(ELEMENT, payload(), lines(5))).toEqual({ y: 60, height: 200 });
  });

  it('grows a top-aligned box downward, keeping y', () => {
    expect(fitTextElementToBody(ELEMENT, payload({ verticalAlign: 'top' }), lines(5))).toEqual({ y: 100, height: 200 });
  });

  it('grows a bottom-aligned box upward, keeping the bottom edge', () => {
    expect(fitTextElementToBody(ELEMENT, payload({ verticalAlign: 'bottom' }), lines(5))).toEqual({ y: 20, height: 200 });
  });

  it('treats an absent verticalAlign as middle', () => {
    const { verticalAlign: _ignored, ...rest } = payload();
    expect(fitTextElementToBody(ELEMENT, rest as TextElementPayload, lines(5))).toEqual({ y: 60, height: 200 });
  });

  it('counts wrapped lines, not just blocks', () => {
    // 600 units wide at 16 units per character: three 10-character words plus
    // two spaces (512) fit a line, four do not (688). Nine words wrap to three
    // lines (120 fits); ten words need a fourth line.
    const word = 'abcdefghij';
    const three = [{ runs: [{ text: Array(9).fill(word).join(' ') }], indent: 0 }];
    expect(fitTextElementToBody(ELEMENT, payload(), three)).toBeNull();
    const four = [{ runs: [{ text: Array(10).fill(word).join(' ') }], indent: 0 }];
    expect(fitTextElementToBody(ELEMENT, payload(), four)).toEqual({ y: 80, height: 160 });
  });

  it('uses the glyph stack when line-height is below 1, so the bleed stays inside the box', () => {
    // 4 lines at line-height 0.5: layout stack = 4 × 16 = 64, glyph stack =
    // 64 - 16 + 32 = 80 → the box must hold 80, not 64.
    expect(fitTextElementToBody({ ...ELEMENT, height: 70 }, payload({ lineHeight: 0.5 }), lines(4))).toEqual({ y: 95, height: 80 });
  });

  it('follows a per-run size override', () => {
    const body: RichBody = [{ runs: [{ text: 'big', fontSize: 64 }], indent: 0 }, ...lines(2)];
    // 64 × 1.25 = 80 plus two 40-unit lines = 160 > 120.
    expect(fitTextElementToBody(ELEMENT, payload(), body)).toEqual({ y: 80, height: 160 });
  });

  it('leaves auto-fit boxes alone (the font fits the box, not the box the font)', () => {
    expect(fitTextElementToBody(ELEMENT, payload({ autoFit: true }), lines(20))).toBeNull();
  });

  it('rounds the height up to whole units', () => {
    // 3 lines at 41px × 1.25 = 153.75 → 154.
    expect(fitTextElementToBody(ELEMENT, payload({ fontSize: 41 }), lines(3))).toEqual({ y: 100 - 34 / 2, height: 154 });
  });
});
