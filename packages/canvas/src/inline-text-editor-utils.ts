import type { RichBody, SlideElement, TextElementPayload } from '@lumacast/composition';
import { boxStyleFromPayload, normalizeFontFamily, prepareRichLayout } from '@lumacast/composition';

interface MeasureInlineTextHeightInput {
  text: string;
  width: number;
  fontSize: number;
  lineHeight: number;
  fontWeight: string;
  fontStyle: string;
  fontFamily: string;
}

export function resolveInlineTextAlign(alignment: TextElementPayload['alignment']): 'left' | 'center' | 'right' | 'justify' {
  if (alignment === 'center') return 'center';
  if (alignment === 'right' || alignment === 'end') return 'right';
  if (alignment === 'justify') return 'justify';
  return 'left';
}

export function measureInlineTextHeight({ text, width, fontSize, lineHeight, fontWeight, fontStyle, fontFamily }: MeasureInlineTextHeightInput): number {
  if (typeof document === 'undefined') {
    return fontSize * lineHeight;
  }

  const measureNode = document.createElement('div');
  measureNode.style.position = 'absolute';
  measureNode.style.visibility = 'hidden';
  measureNode.style.pointerEvents = 'none';
  measureNode.style.left = '-99999px';
  measureNode.style.top = '0';
  measureNode.style.width = `${Math.max(width, fontSize)}px`;
  measureNode.style.whiteSpace = 'pre-wrap';
  measureNode.style.wordBreak = 'break-word';
  measureNode.style.overflowWrap = 'anywhere';
  measureNode.style.fontSize = `${fontSize}px`;
  measureNode.style.lineHeight = String(lineHeight);
  measureNode.style.fontWeight = fontWeight;
  measureNode.style.fontStyle = fontStyle;
  measureNode.style.fontFamily = fontFamily;
  measureNode.textContent = text.length > 0 ? text : ' ';
  document.body.appendChild(measureNode);
  const height = measureNode.getBoundingClientRect().height;
  document.body.removeChild(measureNode);
  return Math.max(height, fontSize * lineHeight);
}

export interface TextElementFit {
  y: number;
  height: number;
}

// The smallest box that holds `body` at the element's own font, placed so the
// text stays exactly where the canvas already draws it while it overflows: a
// middle-aligned box grows equally up and down, a bottom-aligned box grows
// upward, a top-aligned box grows downward. Returns null when the text already
// fits (a box never shrinks below its authored height) and when auto-fit is on
// (auto-fit shrinks the font to the box, so the box must not chase the text).
export function fitTextElementToBody(
  element: Pick<SlideElement, 'y' | 'width' | 'height'>,
  payload: TextElementPayload,
  body: RichBody,
): TextElementFit | null {
  if (payload.autoFit) return null;
  const base = boxStyleFromPayload(payload);
  const box = { ...base, fontFamily: normalizeFontFamily(base.fontFamily || 'sans-serif') };
  const lineHeight = payload.lineHeight ?? 1.25;
  const layout = prepareRichLayout({ body, box, width: element.width, lineHeight, align: resolveInlineTextAlign(payload.alignment) });
  // Same frame the canvas reserves for overflowing text (scene-node-text.tsx):
  // the taller of the line stack and the glyph stack, so a line-height below 1
  // still keeps its bleed inside the box.
  const contentHeight = Math.ceil(Math.max(layout.layoutHeight, layout.contentHeight));
  if (contentHeight <= element.height) return null;
  const delta = contentHeight - element.height;
  const verticalAlign = payload.verticalAlign ?? 'middle';
  const y = verticalAlign === 'top' ? element.y : verticalAlign === 'bottom' ? element.y - delta : element.y - delta / 2;
  return { y, height: contentHeight };
}
