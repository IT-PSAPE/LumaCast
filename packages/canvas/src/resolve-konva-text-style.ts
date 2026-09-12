type KonvaFontStyle = 'normal' | 'bold' | 'italic' | 'bold italic';

function isBoldWeight(weight: string | undefined): boolean {
  const numeric = Number.parseInt(weight ?? '400', 10);
  if (Number.isNaN(numeric)) return false;
  return numeric >= 600;
}

export function resolveKonvaTextStyle(weight: string | undefined, italic: boolean | undefined): KonvaFontStyle {
  const bold = isBoldWeight(weight);
  const hasItalic = Boolean(italic);
  if (bold && hasItalic) return 'bold italic';
  if (bold) return 'bold';
  if (hasItalic) return 'italic';
  return 'normal';
}
