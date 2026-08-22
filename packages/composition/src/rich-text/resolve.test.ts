import { describe, expect, it } from 'vitest';
import type { TextElementPayload } from '../domain/slide-elements';
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

  it('never lets a run override the family', () => {
    const resolved = resolveRun({ text: 'x' }, { ...BOX, fontFamily: 'Georgia', fontSize: 12 });
    expect(resolved.fontFamily).toBe('Georgia');
    expect(resolved.fontSize).toBe(12);
  });

  it('lets an explicit run size override the box size', () => {
    const resolved = resolveRun({ text: 'x', fontSize: 72 }, BOX);
    expect(resolved.fontSize).toBe(72);
  });

  it('scales an explicit run size by an auto-fit fontScale', () => {
    const box = { ...BOX, fontScale: 0.5 };
    expect(resolveRun({ text: 'x', fontSize: 72 }, box).fontSize).toBe(36);
    // The box size itself is already fitted — it must not be scaled again.
    expect(resolveRun({ text: 'x' }, box).fontSize).toBe(48);
  });

  it('treats an absent fontScale as identity', () => {
    expect(resolveRun({ text: 'x', fontSize: 72 }, BOX).fontSize).toBe(72);
  });

  it('clamps an explicit run size to a sane positive range', () => {
    expect(resolveRun({ text: 'x', fontSize: 0 }, BOX).fontSize).toBe(1);
    expect(resolveRun({ text: 'x', fontSize: -50 }, BOX).fontSize).toBe(1);
    expect(resolveRun({ text: 'x', fontSize: Number.NaN }, BOX).fontSize).toBe(48);
    expect(resolveRun({ text: 'x', fontSize: 10 ** 9 }, BOX).fontSize).toBe(4000);
  });

  it('clamps the scaled size after applying an auto-fit multiplier', () => {
    const box = { ...BOX, fontScale: 100 };
    expect(resolveRun({ text: 'x', fontSize: 72 }, box).fontSize).toBe(4000);
  });

  it('leaves an inherited box size untouched by the clamp', () => {
    expect(resolveRun({ text: 'x' }, { ...BOX, fontSize: 0 }).fontSize).toBe(0);
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
