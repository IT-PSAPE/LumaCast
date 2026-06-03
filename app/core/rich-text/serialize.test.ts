import { describe, expect, it } from 'vitest';
import { richBodyToText, textToRichBody } from './serialize';
import type { RichBody } from './types';

describe('richBodyToText', () => {
  it('concatenates the runs within a block', () => {
    const body: RichBody = [{ runs: [{ text: 'Hel' }, { text: 'lo', weight: 700 }], indent: 0 }];
    expect(richBodyToText(body)).toBe('Hello');
  });

  it('joins blocks with newlines', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], indent: 0 },
      { runs: [{ text: 'two' }], indent: 0 },
    ];
    expect(richBodyToText(body)).toBe('one\ntwo');
  });

  it('renders an empty body as an empty string', () => {
    expect(richBodyToText([])).toBe('');
  });
});

describe('textToRichBody', () => {
  it('maps each line to a block with one override-free run', () => {
    expect(textToRichBody('a\nb')).toEqual([
      { runs: [{ text: 'a' }], indent: 0 },
      { runs: [{ text: 'b' }], indent: 0 },
    ]);
  });

  it('keeps an empty string as a single empty block', () => {
    expect(textToRichBody('')).toEqual([{ runs: [{ text: '' }], indent: 0 }]);
  });

  it('applies list info to every block, omitting listType when absent', () => {
    expect(textToRichBody('a\nb', { listType: 'bullet' })).toEqual([
      { runs: [{ text: 'a' }], listType: 'bullet', indent: 0 },
      { runs: [{ text: 'b' }], listType: 'bullet', indent: 0 },
    ]);
    // No listType key at all on a plain block (byte-identical to plain).
    expect(textToRichBody('a')[0]).not.toHaveProperty('listType');
  });

  it('round-trips line structure through richBodyToText', () => {
    const text = 'first\nsecond\n\nfourth';
    expect(richBodyToText(textToRichBody(text))).toBe(text);
  });
});
