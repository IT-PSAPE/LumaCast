import { useMemo } from 'react';
import { Rect, Shape } from 'react-konva';
import type { Context } from 'konva/lib/Context';
import type { Shape as KonvaShape } from 'konva/lib/Shape';
import type { TextCaseTransform, TextElementPayload, TextHorizontalAlign } from '@core/types';
import type { RichBody } from '@core/rich-text/types';
import type { RichBoxStyle } from '@core/rich-text/resolve';
import { boxStyleFromPayload, coerceWeight, synthesizePlain } from '@core/rich-text/resolve';
import { textToRichBody } from '@core/rich-text/serialize';
import { createCanvasMeasurer, runFontString, wrapRuns } from '@core/rich-text/measure';
import type { RenderNode } from './scene-types';
import { computeAutoFitFontSize, measureTextBlockHeight, measureTextLayoutHeight, textLineBleedPadding, textOverflowOffset } from './text-layout';
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

function applyCaseToBody(body: RichBody, mode: TextCaseTransform): RichBody {
  if (mode === 'none') return body;
  return body.map((block) => ({
    ...block,
    runs: block.runs.map((run) => ({ ...run, text: transformTextCase(run.text, mode) })),
  }));
}

// ── Run-aware text draw (replaces the Konva <Text> render path) ──────────────
//
// Draws a laid-out RichBody directly into the scene context, mirroring Konva
// Text's own `_sceneFunc` so plain text stays pixel-identical: alphabetic
// baseline with translateY = (ascent - descent)/2 + lineHeightPx/2, vertical
// align over the frame height, per-line horizontal align (incl. justify), and
// underline/line-through drawn at Konva's offsets. All text — plain, bound, and
// rich — flows through here so there is exactly one Konva node per element.

const sharedMeasurer = createCanvasMeasurer();

interface RichStrokeSpec {
  color: string;
  width: number;
  fillAfter: boolean; // outside stroke draws stroke-then-fill; center draws fill-then-stroke
}

interface RichDrawParams {
  body: RichBody;
  box: RichBoxStyle; // box.fontSize is the effective (auto-fit) size every run draws with
  width: number;
  frameHeight: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
  verticalAlign: 'top' | 'middle' | 'bottom';
  fill: boolean;
  stroke?: RichStrokeSpec;
}

interface DrawPiece {
  text: string;
  color: string;
  font: string;
  underline: boolean;
  strike: boolean;
}

interface DrawLine {
  pieces: DrawPiece[];
  width: number;
  indentX: number;
  marker?: string;
  lastInParagraph: boolean;
}

function drawRichBody(ctx: CanvasRenderingContext2D, params: RichDrawParams): void {
  const { body, box, width, frameHeight, lineHeight, align, verticalAlign, fill, stroke } = params;
  const fontSize = box.fontSize;
  const lineHeightPx = fontSize * lineHeight;
  const boxFont = runFontString(box);

  // Konva's non-legacy baseline math: measure the box font's bounding box.
  ctx.save();
  ctx.font = boxFont;
  const metrics = ctx.measureText('M');
  const scale = fontSize / 100;
  const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? 91 * scale;
  const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? 21 * scale;
  ctx.restore();
  const translateY = (ascent - descent) / 2 + lineHeightPx / 2;

  // Lay out every block to lines, reserving a marker column for list blocks.
  const lines: DrawLine[] = [];
  let numberCounter = 0;
  for (const block of body) {
    const isNumber = block.listType === 'number';
    const isBullet = block.listType === 'bullet';
    numberCounter = isNumber ? numberCounter + 1 : 0;
    const marker = isBullet ? '• ' : isNumber ? `${numberCounter}. ` : undefined;
    const markerWidth = marker ? sharedMeasurer(marker, boxFont) : 0;
    const wrapped = wrapRuns(block.runs, box, { width: Math.max(1, width - markerWidth), measure: sharedMeasurer });
    wrapped.forEach((line, index) => {
      lines.push({
        pieces: line.pieces.map((piece) => ({
          text: piece.text,
          color: piece.style.color,
          font: runFontString(piece.style),
          underline: piece.style.underline,
          strike: piece.style.strikethrough,
        })),
        width: line.width,
        indentX: markerWidth,
        marker: index === 0 ? marker : undefined,
        lastInParagraph: line.lastInParagraph,
      });
    });
  }

  const totalLines = lines.length;
  let alignY = 0;
  if (verticalAlign === 'middle') alignY = (frameHeight - totalLines * lineHeightPx) / 2;
  else if (verticalAlign === 'bottom') alignY = frameHeight - totalLines * lineHeightPx;

  ctx.textBaseline = 'alphabetic';
  const decorationThickness = fontSize / 15;
  const decorationOffset = Math.round(fontSize / 4);

  const applyStrokeStyle = (): void => {
    if (!stroke) return;
    ctx.lineWidth = stroke.width;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.color;
  };

  const paint = (text: string, x: number, baselineY: number, color: string): void => {
    if (stroke && stroke.fillAfter) {
      applyStrokeStyle();
      ctx.strokeText(text, x, baselineY);
    }
    if (fill) {
      ctx.fillStyle = color;
      ctx.fillText(text, x, baselineY);
    }
    if (stroke && !stroke.fillAfter) {
      applyStrokeStyle();
      ctx.strokeText(text, x, baselineY);
    }
  };

  const decorate = (from: number, to: number, y: number, color: string): void => {
    if (!fill) return;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = decorationThickness;
    ctx.strokeStyle = color;
    ctx.moveTo(from, y);
    ctx.lineTo(from + Math.round(to - from), y);
    ctx.stroke();
    ctx.restore();
  };

  for (let lineIndex = 0; lineIndex < totalLines; lineIndex += 1) {
    const line = lines[lineIndex];
    const baselineY = alignY + translateY + lineIndex * lineHeightPx;
    const isJustify = align === 'justify' && !line.lastInParagraph;
    const lineText = line.pieces.map((piece) => piece.text).join('');
    const spaces = isJustify ? (lineText.match(/ /g) ?? []).length : 0;
    const extraPerSpace = isJustify && spaces > 0 ? (width - line.indentX - line.width) / spaces : 0;

    // Align the marker + text as one group so a list marker hugs the (possibly
    // centered or right-aligned) text instead of sitting at the box's edge.
    const contentWidth = line.indentX + line.width;
    let groupX = 0;
    if (!isJustify) {
      if (align === 'right') groupX = width - contentWidth;
      else if (align === 'center') groupX = (width - contentWidth) / 2;
    }
    const startX = groupX + line.indentX;

    if (line.marker) {
      ctx.font = boxFont;
      paint(line.marker, groupX, baselineY, box.color);
    }

    let x = startX;
    for (const piece of line.pieces) {
      ctx.font = piece.font;
      const pieceStartX = x;
      if (!isJustify) {
        paint(piece.text, x, baselineY, piece.color);
        x += sharedMeasurer(piece.text, piece.font);
      } else {
        for (const token of piece.text.split(/( )/)) {
          if (token === ' ') {
            paint(' ', x, baselineY, piece.color);
            x += sharedMeasurer(' ', piece.font) + extraPerSpace;
          } else if (token) {
            paint(token, x, baselineY, piece.color);
            x += sharedMeasurer(token, piece.font);
          }
        }
      }
      if (piece.underline) decorate(pieceStartX, x, baselineY + decorationOffset, piece.color);
      if (piece.strike) decorate(pieceStartX, x, baselineY - decorationOffset, piece.color);
    }
  }
}

// ── Component ────────────────────────────────────────────────

interface SceneNodeTextProps {
  node: RenderNode;
}

export function SceneNodeText({ node }: SceneNodeTextProps) {
  const element = node.element;
  const payload = element.payload as TextElementPayload;

  const resolvedText = useResolvedText({ text: payload.text, binding: payload.binding }, node.bindingOverride);
  const caseMode = payload.caseTransform ?? 'none';
  // Measurement font string carries the true numeric weight (retiring the ≥600
  // collapse) so auto-fit and frame-height measure the same font the draw uses.
  const numericWeight = coerceWeight(payload.weight);
  const fontStyleMeasure = `${payload.italic ? 'italic ' : ''}${numericWeight}`;
  const lineHeight = payload.lineHeight ?? 1.25;
  const verticalAlign = payload.verticalAlign ?? 'middle';
  const text = transformTextCase(resolvedText, caseMode);
  const fontFamily = payload.fontFamily || 'sans-serif';
  const autoFitEnabled = payload.autoFit ?? false;
  const autoFitMaxFontSize = payload.autoFitMaxFontSize ?? payload.fontSize;
  const fontSize = useMemo(
    () => (autoFitEnabled
      ? computeAutoFitFontSize({
          text,
          width: element.width,
          height: element.height,
          fontFamily,
          fontStyle: fontStyleMeasure,
          lineHeight,
          maxFontSize: autoFitMaxFontSize,
        })
      : payload.fontSize),
    [autoFitEnabled, autoFitMaxFontSize, text, element.width, element.height, fontFamily, fontStyleMeasure, lineHeight, payload.fontSize],
  );

  const box = useMemo<RichBoxStyle>(() => {
    const resolved = boxStyleFromPayload(payload);
    resolved.fontFamily = fontFamily;
    resolved.fontSize = fontSize;
    return resolved;
  }, [payload, fontFamily, fontSize]);

  const body = useMemo<RichBody>(() => {
    const base = payload.binding
      ? textToRichBody(resolvedText)
      : payload.format === 'rich' && payload.richBody && payload.richBody.length > 0
        ? payload.richBody
        : synthesizePlain({ ...payload, text: resolvedText });
    return applyCaseToBody(base, caseMode);
  }, [payload, resolvedText, caseMode]);

  const textBleedPadding = textLineBleedPadding(fontSize, lineHeight);
  const textContentHeight = measureTextBlockHeight({
    text,
    width: element.width,
    fontFamily,
    fontSize,
    fontStyle: fontStyleMeasure,
    lineHeight,
  });
  const textLayoutHeight = measureTextLayoutHeight({
    text,
    width: element.width,
    fontFamily,
    fontSize,
    fontStyle: fontStyleMeasure,
    lineHeight,
  });
  // autoFit shrinks the font to fit within element.height; lock the frame to
  // the element bounds so measurement overshoot at wrap boundaries doesn't
  // briefly expand and snap back while typing.
  const textFrameContentHeight = autoFitEnabled
    ? element.height
    : Math.max(element.height, textContentHeight, textLayoutHeight);
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

  const align = textAlign(payload.alignment ?? 'left');

  const insideStrokeCanvas = useMemo(() => {
    if (!useInsideStroke) return null;

    const width = Math.max(1, Math.ceil(element.width));
    const height = Math.max(1, Math.ceil(textFrameHeight));
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return null;

    const common = { body, box, width: element.width, frameHeight: textFrameHeight, lineHeight, align, verticalAlign };
    drawRichBody(offCtx, { ...common, fill: true });
    offCtx.globalCompositeOperation = 'source-atop';
    drawRichBody(offCtx, {
      ...common,
      fill: false,
      stroke: { color: payload.textStrokeColor ?? '#111111', width: textStrokeWidth * 2, fillAfter: false },
    });
    offCtx.globalCompositeOperation = 'source-over';
    return offscreen;
  }, [useInsideStroke, element.width, textFrameHeight, body, box, lineHeight, align, verticalAlign, payload.textStrokeColor, textStrokeWidth]);

  // Match Konva Text's _hitFunc: the whole frame is the hit region, so clicking
  // anywhere on the text box (not just on a glyph) selects it.
  function richTextHitFunc(ctx: Context, shape: KonvaShape) {
    ctx.beginPath();
    ctx.rect(0, 0, element.width, textFrameHeight);
    ctx.closePath();
    ctx.fillStrokeShape(shape);
  }

  function richTextSceneFunc(ctx: Context, shape: KonvaShape) {
    const target = ctx._context;
    if (useInsideStroke) {
      if (insideStrokeCanvas) target.drawImage(insideStrokeCanvas, 0, 0);
    } else {
      drawRichBody(target, {
        body,
        box,
        width: element.width,
        frameHeight: textFrameHeight,
        lineHeight,
        align,
        verticalAlign,
        fill: true,
        stroke: textStrokeEnabled
          ? { color: payload.textStrokeColor ?? '#111111', width: resolvedStrokeWidth, fillAfter: fillAfterStrokeEnabled }
          : undefined,
      });
    }
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
      <Shape
        x={0}
        y={textFrameY}
        width={element.width}
        height={textFrameHeight}
        sceneFunc={richTextSceneFunc}
        hitFunc={richTextHitFunc}
        shadowEnabled={payload.textShadowEnabled}
        shadowColor={payload.textShadowColor}
        shadowBlur={payload.textShadowBlur}
        shadowOffsetX={payload.textShadowOffsetX}
        shadowOffsetY={payload.textShadowOffsetY}
      />
    </>
  );
}
