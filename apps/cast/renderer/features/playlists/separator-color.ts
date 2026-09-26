import { getLabelColors, LABEL_COLOR_OPTIONS } from '../../utils/label-colors';

export const SEPARATOR_COLOR_OPTIONS = LABEL_COLOR_OPTIONS;

export interface SeparatorColors {
  backgroundColor: string;
  textColor: string;
}

const DEFAULT_SEPARATOR_COLORS = SEPARATOR_COLOR_OPTIONS.slice(0, 8);

function hashSeparatorId(separatorId: string): number {
  let hash = 0;
  for (let index = 0; index < separatorId.length; index += 1) {
    hash = (hash * 31 + separatorId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function getSeparatorColors(separatorId: string, colorKey: string | null): SeparatorColors {
  const fallbackIndex = hashSeparatorId(separatorId) % DEFAULT_SEPARATOR_COLORS.length;
  const fallbackOption = DEFAULT_SEPARATOR_COLORS[fallbackIndex];
  const colors = getLabelColors(colorKey ?? fallbackOption.key);
  if (colors) {
    return {
      backgroundColor: colors.backgroundColor,
      textColor: colors.color,
    };
  }
  return {
    backgroundColor: 'transparent',
    textColor: 'var(--text-color-primary)',
  };
}
