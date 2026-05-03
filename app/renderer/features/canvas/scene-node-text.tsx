import { useMemo } from 'react';
import { Rect, Text, Shape } from 'react-konva';
import type { Context } from 'konva/lib/Context';
import type { Shape as KonvaShape } from 'konva/lib/Shape';
import type { TextBinding, StrokePosition, TextCaseTransform, TextHorizontalAlign } from '@core/types';
import type { RenderNode } from './scene-types';
import { resolveKonvaTextStyle } from './resolve-konva-text-style';
import { measureTextBlockHeight, measureTextLayoutHeight, measureTextLineStackHeight, textLineBleedPadding, textOverflowOffset } from './text-layout';
import { useResolvedText } from './use-resolved-text';

function transformTextCase(text: string, mode: TextCaseTransform): string {
  if (mode === 'uppercase') return text.toUpperCase();
  if (mode === 'sentence') return text.replace(/(^\s*\w|[.!?]\s+\w)/g, (match) => match.toUpperCase());
  return text;
}

function textAlign(alignment: TextHorizontalAlign): 'left' | 'center' | 'right' | 'justify' {
  if (alignment === 'center') return 'center';
  if (alignment === 'right' || alignment === 'end') return 'right';
  if (alignment === 'justify') return 'justify';
  return 'left';
}

// ── Offscreen text layout for inside stroke ──────────────────

interface TextLayoutParams {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontStyle: string;
  lineHeight: number;
  width: number;
  height: number;
  align: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
}

interface WrappedLine {
  text: string;
  width: number;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): WrappedLine[] {
  const paragraphs = text.split('\n');
  const lines: WrappedLine[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push({ text: '', width: 0 });
      continue;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      const measured = ctx.measureText(candidate).width;
      if (!currentLine || measured <= maxWidth) {
        currentLine = candidate;
        continue;
      }
      const lineWidth = ctx.measureText(currentLine).width;
      lines.push({ text: currentLine, width: lineWidth });
      currentLine = word;
    }

    if (currentLine) {
      const lineWidth = ctx.measureText(currentLine).width;
      lines.push({ text: currentLine, width: lineWidth });
    }
  }

  return lines.length > 0 ? lines : [{ text: '', width: 0 }];
}

function drawTextOnCanvas(
  ctx: CanvasRenderingContext2D,
  params: TextLayoutParams,
  mode: 'fill' | 'stroke',
  strokeWidth: number,
  strokeColor: string,
  fillColor: string,
) {
  const { text, fontFamily, fontSize, fontStyle, lineHeight, width, height, align, verticalAlign } = params;
  const lineHeightPx = fontSize * lineHeight;

  ctx.font = `${fontStyle} ${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';

  const lines = wrapText(ctx, text, width);
  const totalTextHeight = measureTextLineStackHeight(lines.length, fontSize, lineHeight);

  let startY = 0;
  if (verticalAlign === 'middle') startY = Math.max(0, (height - totalTextHeight) / 2);
  else if (verticalAlign === 'bottom') startY = Math.max(0, height - totalTextHeight);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let x = 0;
    if (align === 'center') x = (width - line.width) / 2;
    else if (align === 'right') x = width - line.width;

    const y = startY + i * lineHeightPx;

    if (mode === 'fill') {
      ctx.fillStyle = fillColor;
      ctx.fillText(line.text, x, y);
    } else {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineJoin = 'round';
      ctx.strokeText(line.text, x, y);
    }
  }
}

// ── Component ────────────────────────────────────────────────

interface SceneNodeTextProps {
  node: RenderNode;
}

export function SceneNodeText({ node }: SceneNodeTextProps) {
  const element = node.element;
  const payload = element.payload as {
    text: string;
    fontFamily: string;
    fontSize: number;
    color: string;
    alignment: TextHorizontalAlign;
    verticalAlign?: 'top' | 'middle' | 'bottom';
    caseTransform?: TextCaseTransform;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    lineHeight?: number;
    weight?: string;
    textStrokeEnabled?: boolean;
    textStrokeColor?: string;
    textStrokeWidth?: number;
    textStrokePosition?: StrokePosition;
    textShadowEnabled?: boolean;
    textShadowColor?: string;
    textShadowBlur?: number;
    textShadowOffsetX?: number;
    textShadowOffsetY?: number;
    binding?: TextBinding;
  };

  const resolvedText = useResolvedText({ text: payload.text, binding: payload.binding }, node.bindingOverride);
  const fontStyle = resolveKonvaTextStyle(payload.weight, payload.italic);
  const lineHeight = payload.lineHeight ?? 1.25;
  const verticalAlign = payload.verticalAlign ?? 'middle';
  const text = transformTextCase(resolvedText, payload.caseTransform ?? 'none');
  const textBleedPadding = textLineBleedPadding(payload.fontSize, lineHeight);
  const textContentHeight = measureTextBlockHeight({
    text,
    width: element.width,
    fontFamily: payload.fontFamily || 'sans-serif',
    fontSize: payload.fontSize,
    fontStyle,
    lineHeight,
  });
  const textLayoutHeight = measureTextLayoutHeight({
    text,
    width: element.width,
    fontFamily: payload.fontFamily || 'sans-serif',
    fontSize: payload.fontSize,
    fontStyle,
    lineHeight,
  });
  const textFrameContentHeight = Math.max(element.height, textContentHeight, textLayoutHeight);
  const textFrameY = textOverflowOffset(verticalAlign, element.height, textFrameContentHeight) - textBleedPadding;
  const textFrameHeight = textFrameContentHeight + textBleedPadding * 2;
  const textStrokeWidth = payload.textStrokeWidth ?? 0;
  const textStrokePosition = payload.textStrokePosition ?? 'outside';
  const textStrokeEnabled = Boolean(payload.textStrokeEnabled) && textStrokeWidth > 0;

  const resolvedStrokeWidth = textStrokeEnabled
    ? textStrokePosition === 'center'
      ? textStrokeWidth
      : textStrokeWidth * 2
    : 0;

  const fillAfterStrokeEnabled = textStrokeEnabled && textStrokePosition === 'outside';
  const useInsideStroke = textStrokeEnabled && textStrokePosition === 'inside';

  const insideStrokeCanvas = useMemo(() => {
    if (!useInsideStroke) return null;

    const width = Math.max(1, Math.ceil(element.width));
    const height = Math.max(1, Math.ceil(textFrameHeight));
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return null;

    const layoutParams: TextLayoutParams = {
      text,
      fontFamily: payload.fontFamily || 'sans-serif',
      fontSize: payload.fontSize,
      fontStyle,
      lineHeight,
      width: element.width,
      height: textFrameHeight,
      align: textAlign(payload.alignment ?? 'left'),
      verticalAlign,
    };

    drawTextOnCanvas(offCtx, layoutParams, 'fill', 0, '', payload.color);
    offCtx.globalCompositeOperation = 'source-atop';
    drawTextOnCanvas(
      offCtx,
      layoutParams,
      'stroke',
      textStrokeWidth * 2,
      payload.textStrokeColor ?? '#111111',
      '',
    );
    offCtx.globalCompositeOperation = 'source-over';
    return offscreen;
  }, [
    element.width,
    fontStyle,
    lineHeight,
    payload.alignment,
    payload.color,
    payload.fontFamily,
    payload.fontSize,
    payload.textStrokeColor,
    text,
    textFrameHeight,
    textStrokeWidth,
    useInsideStroke,
    verticalAlign,
  ]);

  function insideStrokeSceneFunc(ctx: Context, shape: KonvaShape) {
    if (!insideStrokeCanvas) return;
    ctx._context.drawImage(insideStrokeCanvas, 0, 0);
    ctx.fillStrokeShape(shape);
  }

  return (
    <>
      <Rect
        name="element-bounds"
        x={0}
        y={0}
        width={element.width}
        height={element.height}
        fill={node.visual.fillEnabled ? node.visual.fillColor : 'transparent'}
        stroke={node.visual.strokeEnabled ? node.visual.strokeColor : undefined}
        strokeWidth={node.visual.strokeEnabled ? node.visual.strokeWidth : 0}
        cornerRadius={Math.max(0, node.visual.borderRadius)}
        shadowEnabled={node.visual.shadowEnabled}
        shadowColor={node.visual.shadowColor}
        shadowBlur={node.visual.shadowBlur}
        shadowOffsetX={node.visual.shadowOffsetX}
        shadowOffsetY={node.visual.shadowOffsetY}
        listening={false}
      />
      {useInsideStroke ? (
        <Shape
          x={0}
          y={textFrameY}
          width={element.width}
          height={textFrameHeight}
          sceneFunc={insideStrokeSceneFunc}
          shadowEnabled={payload.textShadowEnabled}
          shadowColor={payload.textShadowColor}
          shadowBlur={payload.textShadowBlur}
          shadowOffsetX={payload.textShadowOffsetX}
          shadowOffsetY={payload.textShadowOffsetY}
          listening={false}
        />
      ) : (
        <Text
          x={0}
          y={textFrameY}
          width={element.width}
          height={textFrameHeight}
          verticalAlign={verticalAlign}
          text={text}
          fontFamily={payload.fontFamily || 'sans-serif'}
          fontSize={payload.fontSize}
          fontStyle={fontStyle}
          align={textAlign(payload.alignment ?? 'left')}
          lineHeight={lineHeight}
          fill={payload.color}
          textDecoration={`${payload.underline ? 'underline' : ''} ${payload.strikethrough ? 'line-through' : ''}`.trim()}
          stroke={textStrokeEnabled ? payload.textStrokeColor : undefined}
          strokeWidth={textStrokeEnabled ? resolvedStrokeWidth : 0}
          fillAfterStrokeEnabled={fillAfterStrokeEnabled}
          shadowEnabled={payload.textShadowEnabled}
          shadowColor={payload.textShadowColor}
          shadowBlur={payload.textShadowBlur}
          shadowOffsetX={payload.textShadowOffsetX}
          shadowOffsetY={payload.textShadowOffsetY}
        />
      )}
    </>
  );
}
