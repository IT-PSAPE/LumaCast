import { measureInlineTextHeight } from '../canvas/inline-text-editor-utils';
import type { LyricLayoutConfig } from './lyric-layout-config';

const SEGMENT_JOIN = '\n';

export function joinSegments(segments: string[]): string {
  return segments.join(SEGMENT_JOIN);
}

function fitsInBox(text: string, config: LyricLayoutConfig): boolean {
  const measured = measureInlineTextHeight({
    text,
    width: config.boxWidth,
    fontSize: config.fontSize,
    lineHeight: config.lineHeight,
    fontWeight: config.fontWeight,
    fontStyle: 'normal',
    fontFamily: config.fontFamily,
  });
  return measured <= config.boxHeight + 0.5;
}

function splitGroup(segments: string[], config: LyricLayoutConfig): string[][] {
  if (segments.length <= 1) return [segments];
  if (fitsInBox(joinSegments(segments), config)) return [segments];

  const half = Math.ceil(segments.length / 2);
  const left = segments.slice(0, half);
  const right = segments.slice(half);
  return [...splitGroup(left, config), ...splitGroup(right, config)];
}

export function groupSegmentsForSlides(segments: string[], config: LyricLayoutConfig): string[][] {
  if (segments.length === 0) return [];
  const target = Math.max(1, Math.floor(config.segmentsPerSlide));
  const slides: string[][] = [];

  for (let i = 0; i < segments.length; i += target) {
    const chunk = segments.slice(i, i + target);
    if (chunk.length === 1) {
      slides.push(chunk);
      continue;
    }
    for (const group of splitGroup(chunk, config)) {
      slides.push(group);
    }
  }

  return slides;
}
