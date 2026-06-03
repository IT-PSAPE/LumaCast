import { describe, expect, it } from 'vitest';
import type { TextElementPayload } from '../types';
import { richBodyToText } from './serialize';
import { boxStyleFromPayload, coerceWeight, resolveRun, synthesizePlain } from './resolve';
import type { RichBoxStyle } from './resolve';

const BOX: RichBoxStyle = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  weight: 400,
  italic: false,
  underline: false,
  strikethrough: false,
};

function textPayload(overrides: Partial<TextElementPayload> = {}): TextElementPayload {
  return {
    text: 'Hello',
    fontFamily: 'Inter',
    fontSize: 48,
    color: '#ffffff',
    alignment: 'left',
    ...overrides,
  };
}

describe('coerceWeight', () => {
  it('parses the legacy numeric-string weight', () => {
    expect(coerceWeight('400')).toBe(400);
    expect(coerceWeight('700')).toBe(700);
  });

  it('passes through a finite number', () => {
    expect(coerceWeight(500)).toBe(500);
  });

  it('falls back to 400 for missing or unparseable input', () => {
    expect(coerceWeight(undefined)).toBe(400);
    expect(coerceWeight('bold')).toBe(400);
    expect(coerceWeight(Number.NaN)).toBe(400);
  });
});

describe('resolveRun', () => {
  it('inherits every unset attribute from the box', () => {
    expect(resolveRun({ text: 'x' }, BOX)).toEqual(BOX);
  });

  it('overrides only the attributes the run sets', () => {
    const resolved = resolveRun({ text: 'x', weight: 700, color: '#ff0000' }, BOX);
    expect(resolved.weight).toBe(700);
    expect(resolved.color).toBe('#ff0000');
    // Untouched attributes still come from the box.
    expect(resolved.italic).toBe(false);
    expect(resolved.fontFamily).toBe('Inter');
    expect(resolved.fontSize).toBe(48);
  });

  it('never lets a run override family or size', () => {
    const resolved = resolveRun({ text: 'x' }, { ...BOX, fontFamily: 'Georgia', fontSize: 12 });
    expect(resolved.fontFamily).toBe('Georgia');
    expect(resolved.fontSize).toBe(12);
  });

  it('treats explicit false as an override, not inheritance', () => {
    const resolved = resolveRun({ text: 'x', italic: false }, { ...BOX, italic: true });
    expect(resolved.italic).toBe(false);
  });
});

describe('boxStyleFromPayload', () => {
  it('reads the box style through the seam and coerces weight to numeric', () => {
    const box = boxStyleFromPayload(textPayload({ weight: '700', italic: true, color: '#0a0a0a' }));
    expect(box).toEqual({
      fontFamily: 'Inter',
      fontSize: 48,
      color: '#0a0a0a',
      weight: 700,
      italic: true,
      underline: false,
      strikethrough: false,
    });
  });

  it('defaults missing weight to 400 and empty family to sans-serif', () => {
    const box = boxStyleFromPayload(textPayload({ fontFamily: '' }));
    expect(box.weight).toBe(400);
    expect(box.fontFamily).toBe('sans-serif');
  });
});

describe('synthesizePlain', () => {
  it('reads plain text as override-free runs, one block per line', () => {
    const body = synthesizePlain(textPayload({ text: 'a\nb' }));
    expect(body).toEqual([
      { runs: [{ text: 'a' }], indent: 0 },
      { runs: [{ text: 'b' }], indent: 0 },
    ]);
  });

  it('round-trips back to the original text', () => {
    const payload = textPayload({ text: 'line one\nline two' });
    expect(richBodyToText(synthesizePlain(payload))).toBe(payload.text);
  });

  it('tolerates an empty payload text', () => {
    expect(synthesizePlain(textPayload({ text: '' }))).toEqual([{ runs: [{ text: '' }], indent: 0 }]);
  });
});
