import { describe, expect, it } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { SlideElement } from '@lumacast/composition';
import type { AudioSlideMarker } from '@lumacast/automation';
import { buildTimedCues, slideText } from '../../../../../../apps/cast/renderer/features/playback/audio-sync-export';

const BASE_ELEMENT = {
  id: 'element-1' as Id,
  slideId: 'slide-1' as Id,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  zIndex: 0,
  layer: 'content' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function textElement(text: string, overrides: Record<string, unknown> = {}): SlideElement {
  return {
    ...BASE_ELEMENT,
    type: 'text',
    payload: { text, fontFamily: 'sans', fontSize: 16, color: '#fff', alignment: 'left', ...overrides },
  } as unknown as SlideElement;
}

function richTextElement(lines: string[]): SlideElement {
  return {
    ...BASE_ELEMENT,
    type: 'text',
    payload: {
      text: 'fallback (ignored when rich)',
      fontFamily: 'sans',
      fontSize: 16,
      color: '#fff',
      alignment: 'left',
      format: 'rich',
      richBody: lines.map((line) => ({ runs: [{ text: line }] })),
    },
  } as unknown as SlideElement;
}

function shapeElement(): SlideElement {
  return {
    ...BASE_ELEMENT,
    type: 'shape',
    payload: { fillColor: '#000', borderColor: '#000', borderWidth: 0, borderRadius: 0 },
  } as unknown as SlideElement;
}

function marker(id: string, timeMs: number, slideId: string | null): AudioSlideMarker {
  return { id: id as Id, timeMs, slideId: slideId as Id | null };
}

describe('slideText', () => {
  it('joins every text element in order, skipping blank lines and non-text elements', () => {
    expect(slideText([textElement('Verse one'), shapeElement(), textElement('Verse two')])).toBe('Verse one\nVerse two');
  });

  it('skips text elements whose text is empty or whitespace-only', () => {
    expect(slideText([textElement('  '), textElement('Chorus'), textElement('')])).toBe('Chorus');
  });

  it('returns an empty string for a slide with no text', () => {
    expect(slideText([shapeElement()])).toBe('');
    expect(slideText([])).toBe('');
  });

  it('prefers the rich-text projection over the plain fallback when format is rich', () => {
    expect(slideText([richTextElement(['Line one', 'Line two'])])).toBe('Line one\nLine two');
  });

  it('falls back to the plain text when format is rich but richBody is absent', () => {
    const element = textElement('Plain fallback', { format: 'rich', richBody: undefined });
    expect(slideText([element])).toBe('Plain fallback');
  });
});

describe('buildTimedCues', () => {
  it('sorts markers by time, renumbers order from 1, and never sets an end time', () => {
    const markers = [marker('m2', 3000, null), marker('m1', 1000, null)];
    const cues = buildTimedCues(markers, new Map());
    expect(cues).toEqual([
      { order: 1, startMs: 1000, endMs: null, text: '' },
      { order: 2, startMs: 3000, endMs: null, text: '' },
    ]);
  });

  it('draws each cue\'s text from its bound slide', () => {
    const markers = [marker('m1', 1000, 'slide-1'), marker('m2', 2000, 'slide-2')];
    const slidesById = new Map<Id, { elements: SlideElement[] }>([
      ['slide-1' as Id, { elements: [textElement('Hello')] }],
      ['slide-2' as Id, { elements: [textElement('World')] }],
    ]);
    const cues = buildTimedCues(markers, slidesById);
    expect(cues.map((cue) => cue.text)).toEqual(['Hello', 'World']);
  });

  it('uses an empty string for an unassigned marker or a slide id missing from the lookup', () => {
    const markers = [marker('m1', 1000, null), marker('m2', 2000, 'missing-slide')];
    const cues = buildTimedCues(markers, new Map());
    expect(cues.map((cue) => cue.text)).toEqual(['', '']);
  });

  it('does not mutate the input marker array', () => {
    const markers = [marker('m2', 2000, null), marker('m1', 1000, null)];
    const copy = [...markers];
    buildTimedCues(markers, new Map());
    expect(markers).toEqual(copy);
  });
});
