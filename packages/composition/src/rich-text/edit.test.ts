import { describe, expect, it } from 'vitest';
import type { RichBoxStyle } from './resolve';
import { applyRunStyle, isRichBody, resolveRangeStyle, setListType, toggleList } from './edit';
import type { RichBody } from './types';

const BOX: RichBoxStyle = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  weight: 400,
  italic: false,
  underline: false,
  strikethrough: false,
};

const range = (sb: number, so: number, eb: number, eo: number) => ({ start: { block: sb, offset: so }, end: { block: eb, offset: eo } });

describe('applyRunStyle', () => {
  it('splits a run and sets only the patched attribute on the covered span', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello world' }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 5), { weight: 700 }, BOX);
    expect(next).toEqual([{ runs: [{ text: 'Hello', weight: 700 }, { text: ' world' }], indent: 0 }]);
  });

  it('strips an override back to plain when it equals the box default (un-bold)', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', weight: 700 }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 2), { weight: 400 }, BOX);
    expect(next).toEqual([{ runs: [{ text: 'Hi' }], indent: 0 }]);
  });

  it('coalesces adjacent runs that end up with identical style', () => {
    const body: RichBody = [{ runs: [{ text: 'ab' }, { text: 'cd' }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 4), { italic: true }, BOX);
    expect(next).toEqual([{ runs: [{ text: 'abcd', italic: true }], indent: 0 }]);
  });

  it('applies a size to a substring, splitting and changing only that run', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello world' }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 5), { fontSize: 72 }, BOX);
    expect(next).toEqual([{ runs: [{ text: 'Hello', fontSize: 72 }, { text: ' world' }], indent: 0 }]);
  });

  it('coalesces two adjacent runs that end up the same size', () => {
    const body: RichBody = [{ runs: [{ text: 'a', weight: 700 }, { text: 'b', italic: true }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 2), { fontSize: 64, weight: 400, italic: false }, BOX);
    expect(next).toEqual([{ runs: [{ text: 'ab', fontSize: 64 }], indent: 0 }]);
  });

  it('strips a size that equals the box default back to a plain run', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', fontSize: 96 }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 2), { fontSize: 48 }, BOX);
    expect(next).toEqual([{ runs: [{ text: 'Hi' }], indent: 0 }]);
  });

  it('compares a size against the authored box size when the box carries a fit multiplier', () => {
    // Render-shaped box: fontSize is the fitted size (24), authored default was 48.
    const fittedBox = { ...BOX, fontSize: 24, fontScale: 0.5 };
    const body: RichBody = [{ runs: [{ text: 'Hi', fontSize: 48 }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 2), { italic: true }, fittedBox);
    expect(next).toEqual([{ runs: [{ text: 'Hi', italic: true }], indent: 0 }]);
  });

  it('keeps a size that differs from the authored box size under a fit multiplier', () => {
    const fittedBox = { ...BOX, fontSize: 24, fontScale: 0.5 };
    const body: RichBody = [{ runs: [{ text: 'Hi', fontSize: 72 }], indent: 0 }];
    const next = applyRunStyle(body, range(0, 0, 0, 2), { italic: true }, fittedBox);
    expect(next).toEqual([{ runs: [{ text: 'Hi', fontSize: 72, italic: true }], indent: 0 }]);
  });

  it('falls back to comparing the box size itself for a degenerate fit multiplier', () => {
    const degenerateBox = { ...BOX, fontSize: 24, fontScale: 0 };
    const matching: RichBody = [{ runs: [{ text: 'Hi', fontSize: 24 }], indent: 0 }];
    expect(applyRunStyle(matching, range(0, 0, 0, 2), { italic: true }, degenerateBox)).toEqual([
      { runs: [{ text: 'Hi', italic: true }], indent: 0 },
    ]);
    const differing: RichBody = [{ runs: [{ text: 'Hi', fontSize: 48 }], indent: 0 }];
    expect(applyRunStyle(differing, range(0, 0, 0, 2), { italic: true }, degenerateBox)).toEqual([
      { runs: [{ text: 'Hi', fontSize: 48, italic: true }], indent: 0 },
    ]);
  });

  it('applies across multiple blocks', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], indent: 0 },
      { runs: [{ text: 'two' }], indent: 0 },
    ];
    const next = applyRunStyle(body, range(0, 1, 1, 2), { underline: true }, BOX);
    expect(next).toEqual([
      { runs: [{ text: 'o' }, { text: 'ne', underline: true }], indent: 0 },
      { runs: [{ text: 'tw', underline: true }, { text: 'o' }], indent: 0 },
    ]);
  });
});

describe('toggleList', () => {
  it('sets a list type on all covered blocks, then removes it on re-toggle', () => {
    const body: RichBody = [
      { runs: [{ text: 'a' }], indent: 0 },
      { runs: [{ text: 'b' }], indent: 0 },
    ];
    const on = toggleList(body, range(0, 0, 1, 1), 'bullet');
    expect(on.every((block) => block.listType === 'bullet')).toBe(true);
    const off = toggleList(on, range(0, 0, 1, 1), 'bullet');
    expect(off.some((block) => 'listType' in block)).toBe(false);
  });
});

describe('setListType', () => {
  const body: RichBody = [
    { runs: [{ text: 'a' }], indent: 0 },
    { runs: [{ text: 'b' }], indent: 0 },
  ];

  it('sets the list type directly on covered blocks', () => {
    const next = setListType(body, range(0, 0, 1, 1), 'number');
    expect(next.every((block) => block.listType === 'number')).toBe(true);
  });

  it('switches an existing list type without ambiguity', () => {
    const numbered = setListType(body, range(0, 0, 1, 1), 'number');
    const bulleted = setListType(numbered, range(0, 0, 1, 1), 'bullet');
    expect(bulleted.every((block) => block.listType === 'bullet')).toBe(true);
  });

  it('clears the list type with null (removing the key entirely)', () => {
    const numbered = setListType(body, range(0, 0, 1, 1), 'number');
    const cleared = setListType(numbered, range(0, 0, 1, 1), null);
    expect(cleared.some((block) => 'listType' in block)).toBe(false);
  });
});

describe('resolveRangeStyle', () => {
  it('reports a uniform style without mixing', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', weight: 700 }], indent: 0 }];
    const style = resolveRangeStyle(body, range(0, 0, 0, 2), BOX);
    expect(style.bold).toEqual({ value: true, mixed: false });
    expect(style.italic).toEqual({ value: false, mixed: false });
  });

  it('flags an attribute as mixed when covered runs disagree', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', weight: 700 }, { text: 'yo' }], indent: 0 }];
    const style = resolveRangeStyle(body, range(0, 0, 0, 4), BOX);
    expect(style.bold.mixed).toBe(true);
  });

  it('reports a uniform explicit size, then mixed across differing sizes', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', fontSize: 72 }, { text: 'yo', fontSize: 24 }], indent: 0 }];
    expect(resolveRangeStyle(body, range(0, 0, 0, 2), BOX).fontSize).toEqual({ value: 72, mixed: false });
    expect(resolveRangeStyle(body, range(0, 0, 0, 4), BOX).fontSize).toEqual({ value: 72, mixed: true });
  });

  it('falls back to the box size when no run overrides size', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi' }], indent: 0 }];
    expect(resolveRangeStyle(body, range(0, 0, 0, 2), BOX).fontSize).toEqual({ value: 48, mixed: false });
  });
});

describe('isRichBody', () => {
  it('is rich when a run overrides only fontSize (regression: resize-then-revert)', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', fontSize: 96 }], indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is rich when a run overrides color', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', color: '#ff0000' }], indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is rich when a run overrides weight', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', weight: 700 }], indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is rich when a run overrides italic', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', italic: true }], indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is rich when a run overrides underline', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', underline: true }], indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is rich when a run overrides strikethrough', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi', strikethrough: true }], indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is rich when a block carries a list type, even with no run overrides', () => {
    const body: RichBody = [{ runs: [{ text: 'Hi' }], listType: 'bullet', indent: 0 }];
    expect(isRichBody(body)).toBe(true);
  });

  it('is not rich for a plain single-block body with no overrides', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello world' }], indent: 0 }];
    expect(isRichBody(body)).toBe(false);
  });

  it('is not rich for multiple plain blocks (hard line breaks round-trip through text)', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], indent: 0 },
      { runs: [{ text: 'two' }], indent: 0 },
    ];
    expect(isRichBody(body)).toBe(false);
  });
});
