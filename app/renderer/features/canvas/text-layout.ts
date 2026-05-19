interface MeasureTextBlockInput {
  text: string;
  width: number;
  fontFamily: string;
  fontSize: number;
  fontStyle: string;
  lineHeight: number;
}

type TextVerticalAlign = 'top' | 'middle' | 'bottom';

let measurementContext: CanvasRenderingContext2D | null = null;

export function measureTextLineStackHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  return fontSize + Math.max(0, lineCount - 1) * fontSize * lineHeight;
}

export function measureTextLineLayoutHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  return Math.max(1, lineCount) * fontSize * lineHeight;
}

export function textLineBleedPadding(fontSize: number, lineHeight: number): number {
  return Math.max(0, (fontSize - fontSize * lineHeight) / 2);
}

export function textOverflowOffset(verticalAlign: TextVerticalAlign, containerHeight: number, textHeight: number): number {
  if (verticalAlign === 'bottom') return Math.min(0, containerHeight - textHeight);
  if (verticalAlign === 'middle') return Math.min(0, (containerHeight - textHeight) / 2);
  return 0;
}

function getMeasurementContext(): CanvasRenderingContext2D | null {
  if (measurementContext) return measurementContext;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  measurementContext = canvas.getContext('2d');
  return measurementContext;
}

function buildFontDeclaration(fontStyle: string, fontSize: number, fontFamily: string): string {
  return `${fontStyle} ${fontSize}px ${fontFamily}`;
}

interface WrapMetrics {
  lineCount: number;
  maxLineWidth: number;
}

function measureWrappedText(text: string, width: number, context: CanvasRenderingContext2D): WrapMetrics {
  const paragraphs = text.split('\n');
  let lineCount = 0;
  let maxLineWidth = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lineCount += 1;
      continue;
    }

    const words = paragraph.trim().split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (!currentLine || context.measureText(candidate).width <= width) {
        currentLine = candidate;
        continue;
      }

      lineCount += 1;
      maxLineWidth = Math.max(maxLineWidth, context.measureText(currentLine).width);
      currentLine = word;
    }

    if (currentLine) {
      lineCount += 1;
      maxLineWidth = Math.max(maxLineWidth, context.measureText(currentLine).width);
    }
  }

  return { lineCount: Math.max(1, lineCount), maxLineWidth };
}

function countWrappedLines(text: string, width: number, context: CanvasRenderingContext2D): number {
  return measureWrappedText(text, width, context).lineCount;
}

interface AutoFitInput {
  text: string;
  width: number;
  height: number;
  fontFamily: string;
  fontStyle: string;
  lineHeight: number;
  maxFontSize: number;
}

// Largest font size (capped at maxFontSize) at which the wrapped text fits
// entirely within the box's width and height. Short text stays at the cap;
// long text shrinks until every line fits.
export function computeAutoFitFontSize({ text, width, height, fontFamily, fontStyle, lineHeight, maxFontSize }: AutoFitInput): number {
  const cap = Math.max(1, maxFontSize);
  const context = getMeasurementContext();
  if (!context || width <= 0 || height <= 0 || !text.trim()) return cap;

  const fits = (fontSize: number): boolean => {
    context.font = buildFontDeclaration(fontStyle, fontSize, fontFamily);
    const { lineCount, maxLineWidth } = measureWrappedText(text, Math.max(1, width), context);
    if (maxLineWidth > width) return false;
    return measureTextLineLayoutHeight(lineCount, fontSize, lineHeight) <= height;
  };

  if (fits(cap)) return cap;

  let lo = 1;
  let hi = cap;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(1, Math.floor(lo * 100) / 100);
}

export function measureTextBlockHeight({ text, width, fontFamily, fontSize, fontStyle, lineHeight }: MeasureTextBlockInput): number {
  const context = getMeasurementContext();
  if (!context) return fontSize;

  context.font = buildFontDeclaration(fontStyle, fontSize, fontFamily);
  const lineCount = countWrappedLines(text, Math.max(1, width), context);
  return measureTextLineStackHeight(lineCount, fontSize, lineHeight);
}

export function measureTextLayoutHeight({ text, width, fontFamily, fontSize, fontStyle, lineHeight }: MeasureTextBlockInput): number {
  const context = getMeasurementContext();
  if (!context) return fontSize * lineHeight;

  context.font = buildFontDeclaration(fontStyle, fontSize, fontFamily);
  const lineCount = countWrappedLines(text, Math.max(1, width), context);
  return measureTextLineLayoutHeight(lineCount, fontSize, lineHeight);
}

export function verticalTextOffset(verticalAlign: TextVerticalAlign, containerHeight: number, textHeight: number): number {
  if (verticalAlign === 'bottom') return Math.max(0, containerHeight - textHeight);
  if (verticalAlign === 'middle') return Math.max(0, (containerHeight - textHeight) / 2);
  return 0;
}
