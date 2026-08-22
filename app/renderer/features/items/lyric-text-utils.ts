import type { Id } from '@lumacast/kernel';
import type { ElementCreateInput } from '@lumacast/protocol';
import { OUTPUT_FRAME_WIDTH } from '@lumacast/composition';
import { DEFAULT_LYRIC_LAYOUT_CONFIG, type LyricLayoutConfig } from './lyric-layout-config';

// Bottom edge of the lyric text box on the 1920x1080 output frame.
const LYRIC_BOX_BOTTOM_Y = 1030;

export function buildLyricTextElement(
  slideId: Id,
  text: string,
  config: LyricLayoutConfig = DEFAULT_LYRIC_LAYOUT_CONFIG,
): ElementCreateInput {
  return {
    slideId,
    type: 'text',
    x: (OUTPUT_FRAME_WIDTH - config.boxWidth) / 2,
    y: LYRIC_BOX_BOTTOM_Y - config.boxHeight,
    width: config.boxWidth,
    height: config.boxHeight,
    payload: {
      text,
      fontFamily: config.fontFamily,
      fontSize: config.fontSize,
      color: '#FFFFFF',
      alignment: 'center',
      verticalAlign: 'middle',
      lineHeight: config.lineHeight,
      caseTransform: 'none',
      weight: config.fontWeight,
      visible: true,
      locked: false,
      fillEnabled: false,
      fillColor: '#00000000',
      strokeEnabled: false,
      shadowEnabled: false,
    },
  };
}

export function normalizeLyricText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/^[ \t\n]+|[ \t\n]+$/g, '');
}

export function parseLyricImportText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n');

  const hasBlankLineSeparator = /\n[ \t]*\n/.test(normalized);
  const splitter = hasBlankLineSeparator ? /\n[ \t]*\n+/g : /\n+/g;

  return normalized
    .split(splitter)
    .map((block) => normalizeLyricText(block))
    .filter((block) => block.length > 0);
}
