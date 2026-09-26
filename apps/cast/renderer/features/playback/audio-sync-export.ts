import type { Id } from '@lumacast/kernel';
import type { SlideElement, TextElementPayload } from '@lumacast/composition';
import { richBodyToText } from '@lumacast/composition';
import type { AudioSlideMarker } from '@lumacast/automation';
import type { TimedCue } from '@lumacast/markers';

// Pure mapping from recorded audio-sync markers to the `TimedCue[]` sequence
// `@lumacast/markers`' `formatCues` turns into CSV/LRC/SRT for "Export
// lyrics…" — the interchange format LumaChord imports. Kept isolated from
// `audio-sync-editor.tsx`'s React/IPC wiring so the mapping itself (marker
// order, slide-text extraction) is directly testable.

/** The slice of a bound slide's row this module actually needs. */
export interface SlideElementsLookup {
  elements: readonly SlideElement[];
}

function textElementContent(element: SlideElement): string {
  if (element.type !== 'text') return '';
  const payload = element.payload as TextElementPayload;
  if (payload.format === 'rich' && payload.richBody) return richBodyToText(payload.richBody);
  return payload.text ?? '';
}

/**
 * Joins every text element on a slide into one lyric line block, in the
 * slide's own (already-sorted) element order — mirrors
 * `use-stage-scene.ts`'s `extractSlideText`, preferring the rich-text
 * projection over the plain-text fallback when an element authors both.
 */
export function slideText(elements: readonly SlideElement[]): string {
  const lines: string[] = [];
  for (const element of elements) {
    const text = textElementContent(element);
    if (text.trim().length > 0) lines.push(text);
  }
  return lines.join('\n');
}

/**
 * Builds the ordered `TimedCue[]` LumaChord imports: markers sorted by time,
 * 1-based `order`, each cue's text drawn from its bound slide (or `''` when
 * the marker has no slide, or the slide isn't in `slidesById`). `endMs` stays
 * null — CSV/LRC/SRT infer a cue's duration from the next cue's start, and an
 * audio-sync marker never carries an explicit end.
 */
export function buildTimedCues(
  markers: readonly AudioSlideMarker[],
  slidesById: ReadonlyMap<Id, SlideElementsLookup>,
): TimedCue[] {
  return [...markers]
    .sort((left, right) => left.timeMs - right.timeMs)
    .map((marker, index) => {
      const slide = marker.slideId !== null ? slidesById.get(marker.slideId) : undefined;
      return {
        order: index + 1,
        startMs: marker.timeMs,
        endMs: null,
        text: slide ? slideText(slide.elements) : '',
      };
    });
}
