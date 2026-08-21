import { describe, expect, it } from 'vitest';
import type { LyricLayoutConfig } from './lyric-layout-config';
import { groupBlocksForSlides } from './lyric-slide-grouping';

// Deterministic measure: each line is 100px tall regardless of glyphs, so
// "fits" is purely a function of newline count vs boxHeight.
const measure = (input: { text: string }) => input.text.split('\n').length * 100;

function makeConfig(overrides: Partial<LyricLayoutConfig> = {}): LyricLayoutConfig {
  return {
    boxWidth: 1000,
    boxHeight: 250,
    fontFamily: 'Test Font',
    fontWeight: '400',
    fontSize: 50,
    lineHeight: 1,
    segmentsPerSlide: 2,
    ...overrides,
  };
}

describe('groupBlocksForSlides', () => {
  it('groups consecutive fitting blocks and names each group after its first source block', () => {
    const blocks = [
      { id: 'a', content: 'one' },
      { id: 'b', content: 'two' },
      { id: 'c', content: 'three' },
    ];

    expect(groupBlocksForSlides(blocks, { config: makeConfig(), measure })).toEqual([
      { id: 'a', content: 'one\ntwo' },
      { id: 'c', content: 'three' },
    ]);
  });

  it('passes empty-content blocks through as their own groups', () => {
    const blocks = [
      { id: 'a', content: 'one' },
      { id: 'empty', content: '   ' },
      { id: 'b', content: 'two' },
    ];

    expect(groupBlocksForSlides(blocks, { config: makeConfig({ segmentsPerSlide: 1 }), measure })).toEqual([
      { id: 'a', content: 'one' },
      { id: 'empty', content: '' },
      { id: 'b', content: 'two' },
    ]);
  });

  it('keeps the source id on the first part of an oversized split and mints fresh ids for later parts', () => {
    const minted: string[] = [];
    let counter = 0;
    const newId = () => {
      const id = `fresh-${counter}`;
      counter += 1;
      minted.push(id);
      return id;
    };
    const blocks = [
      { id: 'a', content: 'first' },
      { id: 'b', content: 'second' },
      { id: 'c', content: 'third' },
    ];

    const grouped = groupBlocksForSlides(
      blocks,
      { config: makeConfig({ boxHeight: 100, segmentsPerSlide: 3 }), measure, newId },
    );

    expect(grouped).toHaveLength(3);
    expect(grouped.map((block) => block.content)).toEqual(['first', 'second', 'third']);
    expect(grouped[0].id).toBe('a');
    expect(grouped[1].id).toBe('fresh-0');
    expect(grouped[2].id).toBe('fresh-1');
    expect(new Set(minted).size).toBe(minted.length);
  });

  it('splits a single oversized segment at line boundaries', () => {
    const newId = (() => {
      let counter = 0;
      return () => `fresh-${counter++}`;
    })();
    const blocks = [{ id: 'a', content: 'l1\nl2\nl3' }];

    const grouped = groupBlocksForSlides(
      blocks,
      { config: makeConfig({ boxHeight: 100, segmentsPerSlide: 1 }), measure, newId },
    );

    expect(grouped.map((block) => block.content)).toEqual(['l1', 'l2', 'l3']);
    expect(grouped[0].id).toBe('a');
    expect(grouped.slice(1).map((block) => block.id)).toEqual(['fresh-0', 'fresh-1']);
  });

  it('leaves a single non-fitting line as-is', () => {
    const blocks = [{ id: 'a', content: 'one very long line without breaks' }];

    expect(groupBlocksForSlides(
      blocks,
      { config: makeConfig({ boxHeight: 100, segmentsPerSlide: 1 }), measure },
    )).toEqual([{ id: 'a', content: 'one very long line without breaks' }]);
  });

  it('returns an empty result for empty input', () => {
    expect(groupBlocksForSlides([], { config: makeConfig(), measure })).toEqual([]);
  });
});
