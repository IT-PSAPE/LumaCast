import { describe, expect, it } from 'vitest';
import type { RichBoxStyle } from '@core/rich-text/resolve';
import type { RichBody } from '@core/rich-text/types';
import { bodyToHtml, domToBody } from './inline-text-editor';

const BOX: RichBoxStyle = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  weight: 400,
  italic: false,
  underline: false,
  strikethrough: false,
};

function roundTrip(body: RichBody): RichBody {
  const root = document.createElement('div');
  root.innerHTML = bodyToHtml(body, BOX);
  return domToBody(root);
}

describe('RichTextEditor DOM ⇄ model serialization', () => {
  it('round-trips mixed runs, lists, and an empty block', () => {
    const body: RichBody = [
      { runs: [{ text: 'He' }, { text: 'llo', weight: 700 }], indent: 0 },
      { runs: [{ text: 'item' }], listType: 'bullet', indent: 0 },
      { runs: [{ text: '' }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves every run-level override on a span', () => {
    const body: RichBody = [
      { runs: [{ text: 'x', color: '#ff0000', weight: 700, italic: true, underline: true, strikethrough: true }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('round-trips a numbered list', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], listType: 'number', indent: 0 },
      { runs: [{ text: 'two' }], listType: 'number', indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('coalesces adjacent runs that serialize to the same style', () => {
    const body: RichBody = [{ runs: [{ text: 'a' }, { text: 'b' }], indent: 0 }];
    // Two plain runs collapse to one on the round-trip (both inherit the box).
    expect(roundTrip(body)).toEqual([{ runs: [{ text: 'ab' }], indent: 0 }]);
  });

  it('escapes HTML metacharacters in run text', () => {
    const body: RichBody = [{ runs: [{ text: '<b>&"' }], indent: 0 }];
    expect(roundTrip(body)).toEqual(body);
  });
});
