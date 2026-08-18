import { describe, expect, it } from 'vitest';
import type { RichBoxStyle } from './resolve';
import { applyRunStyle, resolveRangeStyle, setListType, toggleList } from './edit';
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
});
