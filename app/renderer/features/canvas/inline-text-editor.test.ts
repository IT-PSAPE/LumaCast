import { describe, expect, it } from 'vitest';
import type { RichBoxStyle, RichBody, RichRange } from '@lumacast/composition';
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

  it('preserves a per-run font size override on a span', () => {
    const body: RichBody = [
      { runs: [{ text: 'sized', fontSize: 72 }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('preserves a sized run alongside the other overrides on one span', () => {
    const body: RichBody = [
      { runs: [{ text: 'x', color: '#ff0000', weight: 700, italic: true, underline: true, strikethrough: true, fontSize: 72 }], indent: 0 },
    ];
    expect(roundTrip(body)).toEqual(body);
  });

  it('does not coalesce adjacent runs of different sizes', () => {
    const body: RichBody = [
      { runs: [{ text: 'a', fontSize: 24 }, { text: 'b', fontSize: 96 }], indent: 0 },
    ];
    // Two differently-sized runs must survive the round-trip as separate runs.
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

// The toolbar's font-size field is a native <input>: focusing it discards the
// browser's document Selection outright, so the editor paints the tracked
// model range as a background nested inside the run markup instead. These
// tests cover the safety property (the nested highlight span must not perturb
// the model round-trip) and the offset math across run and block boundaries.
describe('RichTextEditor synthetic highlight markup', () => {
  it('round-trips a highlighted range crossing a run boundary back to the identical model', () => {
    const body: RichBody = [
      { runs: [{ text: 'Hello ' }, { text: 'World', weight: 700 }], indent: 0 },
    ];
    const range: RichRange = { start: { block: 0, offset: 2 }, end: { block: 0, offset: 9 } };
    const root = document.createElement('div');
    root.innerHTML = bodyToHtml(body, BOX, range);
    expect(domToBody(root)).toEqual(body);
  });

  it('wraps only the highlighted slice when a highlight starts and ends mid-run', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello World' }], indent: 0 }];
    const range: RichRange = { start: { block: 0, offset: 2 }, end: { block: 0, offset: 7 } };
    const root = document.createElement('div');
    root.innerHTML = bodyToHtml(body, BOX, range);
    const highlighted = root.querySelectorAll('.rt-highlight');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].textContent).toBe('llo W');
    // Nested inside the run's own span (load-bearing: collectRuns must see one
    // SPAN per run, not two), and that span's full text is unaffected.
    expect(highlighted[0].parentElement?.tagName).toBe('SPAN');
    expect(highlighted[0].parentElement?.textContent).toBe('Hello World');
    expect(domToBody(root)).toEqual(body);
  });

  it('wraps the highlighted slice in each run when a highlight crosses a run boundary within one block', () => {
    const body: RichBody = [
      { runs: [{ text: 'Hello ' }, { text: 'World', weight: 700 }], indent: 0 },
    ];
    // Starts mid-way through the first run, ends mid-way through the second.
    const range: RichRange = { start: { block: 0, offset: 3 }, end: { block: 0, offset: 8 } };
    const root = document.createElement('div');
    root.innerHTML = bodyToHtml(body, BOX, range);
    const highlighted = Array.from(root.querySelectorAll('.rt-highlight'));
    expect(highlighted.map((el) => el.textContent)).toEqual(['lo ', 'Wo']);
    expect(domToBody(root)).toEqual(body);
  });

  it('highlights from the start offset to the end offset across multiple blocks', () => {
    const body: RichBody = [
      { runs: [{ text: 'one' }], indent: 0 },
      { runs: [{ text: 'two' }], indent: 0 },
      { runs: [{ text: 'three' }], indent: 0 },
    ];
    const range: RichRange = { start: { block: 0, offset: 1 }, end: { block: 2, offset: 3 } };
    const root = document.createElement('div');
    root.innerHTML = bodyToHtml(body, BOX, range);
    const blocks = Array.from(root.children) as HTMLElement[];
    // First block: from the start offset to the end of the block.
    expect(blocks[0].querySelector('.rt-highlight')?.textContent).toBe('ne');
    // Middle block: fully between the start and end blocks, highlighted whole.
    expect(blocks[1].querySelector('.rt-highlight')?.textContent).toBe('two');
    // Last block: from the start of the block to the end offset.
    expect(blocks[2].querySelector('.rt-highlight')?.textContent).toBe('thr');
    expect(domToBody(root)).toEqual(body);
  });

  it('emits no highlight markup when no range is passed', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello World' }], indent: 0 }];
    expect(bodyToHtml(body, BOX)).not.toContain('rt-highlight');
    expect(bodyToHtml(body, BOX, null)).not.toContain('rt-highlight');
  });

  it('emits no highlight markup for a collapsed range', () => {
    const body: RichBody = [{ runs: [{ text: 'Hello World' }], indent: 0 }];
    const range: RichRange = { start: { block: 0, offset: 4 }, end: { block: 0, offset: 4 } };
    expect(bodyToHtml(body, BOX, range)).not.toContain('rt-highlight');
  });
});
