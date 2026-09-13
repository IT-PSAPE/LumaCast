import { describe, expect, it } from 'vitest';
import { buildRichBodyFromRuns, richBodyFromPlainText } from '../../../../../packages/composition/src/rich-text/agent-runs';
import type { RichRunSpec } from '../../../../../packages/composition/src/rich-text/agent-runs';

describe('buildRichBodyFromRuns', () => {
  it('puts every run into a single paragraph block, in order', () => {
    const runs: RichRunSpec[] = [{ text: 'Hello, ' }, { text: 'world', weight: 700, italic: true }];
    expect(buildRichBodyFromRuns(runs)).toEqual([
      { runs: [{ text: 'Hello, ' }, { text: 'world', weight: 700, italic: true }], indent: 0 },
    ]);
  });

  it('preserves every optional style field the schema declares', () => {
    const run: RichRunSpec = {
      text: 'styled',
      color: '#ff0000',
      weight: 700,
      italic: true,
      underline: true,
      strikethrough: true,
      fontSize: 32,
    };
    expect(buildRichBodyFromRuns([run])).toEqual([{ runs: [run], indent: 0 }]);
  });

  it('does not mutate the input runs', () => {
    const runs: RichRunSpec[] = [{ text: 'a' }];
    const body = buildRichBodyFromRuns(runs);
    body[0]!.runs[0]!.text = 'mutated';
    expect(runs[0]!.text).toBe('a');
  });

  it('falls back to a single empty run for an empty runs array', () => {
    expect(buildRichBodyFromRuns([])).toEqual([{ runs: [{ text: '' }], indent: 0 }]);
  });
});

describe('richBodyFromPlainText', () => {
  it('splits hard line breaks into separate blocks', () => {
    expect(richBodyFromPlainText('one\ntwo')).toEqual([
      { runs: [{ text: 'one' }], indent: 0 },
      { runs: [{ text: 'two' }], indent: 0 },
    ]);
  });

  it('keeps a single-line string as one block', () => {
    expect(richBodyFromPlainText('hello')).toEqual([{ runs: [{ text: 'hello' }], indent: 0 }]);
  });

  it('keeps an empty string as a single empty block', () => {
    expect(richBodyFromPlainText('')).toEqual([{ runs: [{ text: '' }], indent: 0 }]);
  });
});
