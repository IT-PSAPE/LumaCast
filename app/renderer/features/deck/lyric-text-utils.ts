import type { ElementCreateInput, Id } from '@core/types';

export function buildLyricTextElement(slideId: Id, text: string): ElementCreateInput {
  return {
    slideId,
    type: 'text',
    x: 180,
    y: 860,
    width: 1560,
    height: 170,
    payload: {
      text,
      fontFamily: 'Avenir Next',
      fontSize: 72,
      color: '#FFFFFF',
      alignment: 'center',
      verticalAlign: 'middle',
      lineHeight: 1.2,
      caseTransform: 'none',
      weight: '700',
      visible: true,
      locked: false,
      fillEnabled: false,
      fillColor: '#00000000',
      strokeEnabled: false,
      shadowEnabled: false,
    },
  };
}

export function parseLyricImportText(text: string): string[] {
  const normalized = text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');

  const hasBlankLineSeparator = /\n[ \t]*\n/.test(normalized);
  const splitter = hasBlankLineSeparator ? /\n[ \t]*\n+/g : /\n+/g;

  return normalized
    .split(splitter)
    .map((block) => block.replace(/^[ \t\n]+|[ \t\n]+$/g, ''))
    .filter((block) => block.length > 0);
}
