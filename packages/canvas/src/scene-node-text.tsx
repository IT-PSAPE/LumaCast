import { useCallback, useMemo } from 'react';
import { Rect, Shape } from 'react-konva';
import type { Context } from 'konva/lib/Context';
import type { Shape as KonvaShape } from 'konva/lib/Shape';
import type { TextCaseTransform, TextElementPayload, TextHorizontalAlign } from '@lumacast/composition';
import {
  type RichBody,
  type RichBoxStyle,
  boxStyleFromPayload,
  textToRichBody,
  createCanvasMeasurer,
  runFontString,
  wrapRuns,
  type RenderNode,
} from '@lumacast/composition';
import { measureTextLineLayoutHeight, measureTextLineStackHeight, textLineBleedPadding, textOverflowOffset } from './text-layout';
import { useResolvedText } from './use-resolved-text';
import { useFontAvailabilityEpoch } from './use-font-availability-epoch';

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
let fontMetricsContext: CanvasRenderingContext2D | null | undefined;

function getFontMetricsContext(): CanvasRenderingContext2D | null {
  if (fontMetricsContext !== undefined) return fontMetricsContext;
  if (typeof document === 'undefined') {
    fontMetricsContext = null;
    return fontMetricsContext;
  }
  fontMetricsContext = document.createElement('canvas').getContext('2d');
  return fontMetricsContext;
}

interface RichStrokeSpec {
  color: string;
  width: number;
  fillAfter: boolean; // outside stroke draws stroke-then-fill; center draws fill-then-stroke
}

interface RichContentParams {
  body: RichBody;
  box: RichBoxStyle; // box.fontSize is the effective (auto-fit) size every run draws with
  width: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right' | 'justify';
}

interface RichPaintParams {
  fill: boolean;
  stroke?: RichStrokeSpec;
}

interface DrawPiece {
  text: string;
  color: string;
  font: string;
  fontSize: number;
  underline: boolean;
  strike: boolean;
}

interface DrawSegment {
  text: string;
  width: number;
  isSpace: boolean;
}

interface PreparedDrawPiece extends DrawPiece {
  width: number;
  spaceCount: number;
  segments: DrawSegment[];
}

interface PreparedDrawLine {
  pieces: PreparedDrawPiece[];
  width: number;
  groupX: number;
  startX: number;
  indentX: number;
  marker?: string;
  markerColor?: string;
  markerFont?: string;
  lastInParagraph: boolean;
  spaceCount: number;
  maxFontSize: number;
  lineHeightPx: number;
  translateY: number;
}

interface PreparedRichLayout {
  width: number;
  align: 'left' | 'center' | 'right' | 'justify';
  contentHeight: number;
  layoutHeight: number;
  maxFontSize: number;
  lines: PreparedDrawLine[];
}

function buildBoxWithFontSize(box: RichBoxStyle, fontSize: number): RichBoxStyle {
  return { ...box, fontSize };
}

function buildBoxWithAutoFit(box: RichBoxStyle, fontSize: number, authoredFontSize: number): RichBoxStyle {
  const scale = authoredFontSize ? fontSize / authoredFontSize : 1;
  return { ...box, fontSize, fontScale: scale };
}

function richBodyHasRenderableText(body: RichBody): boolean {
  return body.some((block) => block.runs.some((run) => run.text.trim().length > 0));
}

interface AutoFitRichTextInput {
  body: RichBody;
  box: RichBoxStyle;
  width: number;
  height: number;
  lineHeight: number;
  maxFontSize: number;
}

function measureFontMetrics(font: string, fontSize: number): { ascent: number; descent: number } {
  const context = getFontMetricsContext();
  const scale = fontSize / 100;
  if (!context) {
    return {
      ascent: 91 * scale,
      descent: 21 * scale,
    };
  }
  context.font = font;
  const metrics = context.measureText('M');
  return {
    ascent: metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent ?? 91 * scale,
    descent: metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent ?? 21 * scale,
  };
}

function prepareDrawPiece(piece: DrawPiece): PreparedDrawPiece {
  const segments: DrawSegment[] = [];
  let spaceCount = 0;

  for (const segmentText of piece.text.split(/( )/)) {
    if (!segmentText) continue;
    const isSpace = segmentText === ' ';
    if (isSpace) spaceCount += 1;
    segments.push({
      text: segmentText,
      width: sharedMeasurer(segmentText, piece.font),
      isSpace,
    });
  }

  return {
    ...piece,
    width: sharedMeasurer(piece.text, piece.font),
    spaceCount,
    segments,
  };
}

function prepareRichLayout(params: RichContentParams): PreparedRichLayout {
  const { body, box, width, lineHeight, align } = params;
  const boxFont = runFontString(box);

  // A line advances by the largest size actually resolved among its pieces; the
  // box size anchors only empty paragraphs and list markers (the marker draws at
  // the box font). Anchoring every line at the box size instead would leave an
  // all-shrunken line spaced as if it were still box-sized. For content with no
  // size override every piece resolves to the box size, so each line's max IS the
  // box size and all the arithmetic below reduces to the uniform form the
  // Konva-parity render has always used.
  const lines: PreparedDrawLine[] = [];
  let maxFontSize = box.fontSize;
  let numberCounter = 0;
  for (const block of body) {
    const isNumber = block.listType === 'number';
    const isBullet = block.listType === 'bullet';
    numberCounter = isNumber ? numberCounter + 1 : 0;
    const marker = isBullet ? '• ' : isNumber ? `${numberCounter}. ` : undefined;
    const markerWidth = marker ? sharedMeasurer(marker, boxFont) : 0;
    const wrapped = wrapRuns(block.runs, box, { width: Math.max(1, width - markerWidth), measure: sharedMeasurer });
    wrapped.forEach((line, index) => {
      const pieces = line.pieces.map((piece) => prepareDrawPiece({
        text: piece.text,
        color: piece.style.color,
        font: runFontString(piece.style),
        fontSize: piece.style.fontSize,
        underline: piece.style.underline,
        strike: piece.style.strikethrough,
      }));
      const contentWidth = markerWidth + line.width;
      let groupX = 0;
      if (align !== 'justify') {
        if (align === 'right') groupX = width - contentWidth;
        else if (align === 'center') groupX = (width - contentWidth) / 2;
      }
      const lineMarker = index === 0 ? marker : undefined;
      const pieceMax = pieces.reduce((largest, piece) => Math.max(largest, piece.fontSize), 0);
      const lineMax = pieces.length === 0 || lineMarker !== undefined
        ? Math.max(pieceMax, box.fontSize)
        : pieceMax;
      const lineHeightPx = measureTextLineLayoutHeight(1, lineMax, lineHeight);
      // Metrics come from the BOX font at the line's max size, not from the
      // largest piece's own font: a line containing a bold run must not start
      // measuring bold ascent/descent, or every render that exists today shifts.
      const { ascent, descent } = measureFontMetrics(runFontString({ ...box, fontSize: lineMax }), lineMax);
      maxFontSize = Math.max(maxFontSize, lineMax);
      lines.push({
        pieces,
        width: line.width,
        groupX,
        startX: groupX + markerWidth,
        indentX: markerWidth,
        marker: lineMarker,
        markerColor: index === 0 ? box.color : undefined,
        markerFont: index === 0 ? boxFont : undefined,
        lastInParagraph: line.lastInParagraph,
        spaceCount: pieces.reduce((total, piece) => total + piece.spaceCount, 0),
        maxFontSize: lineMax,
        lineHeightPx,
        translateY: (ascent - descent) / 2 + lineHeightPx / 2,
      });
    });
  }

  // `layoutHeight` is the full stack of line boxes; `contentHeight` trades the
  // last line's box for its glyph height - the per-line generalizations of the
  // uniform `n * size * lineHeight` and `size + (n - 1) * size * lineHeight`.
  const lastLine = lines[lines.length - 1];
  const layoutHeight = lastLine
    ? lines.reduce((total, line) => total + line.lineHeightPx, 0)
    : measureTextLineLayoutHeight(1, box.fontSize, lineHeight);
  const contentHeight = lastLine
    ? layoutHeight - lastLine.lineHeightPx + lastLine.maxFontSize
    : measureTextLineStackHeight(1, box.fontSize, lineHeight);

  return {
    width,
    align,
    contentHeight,
    layoutHeight,
    maxFontSize,
    lines,
  };
}

function alignRichLayout(layout: PreparedRichLayout, frameHeight: number, verticalAlign: 'top' | 'middle' | 'bottom') {
  let alignY = 0;
  if (verticalAlign === 'middle') alignY = (frameHeight - layout.layoutHeight) / 2;
  else if (verticalAlign === 'bottom') alignY = frameHeight - layout.layoutHeight;
  return { ...layout, alignY };
}

function computeAutoFitRichTextFontSize({ body, box, width, height, lineHeight, maxFontSize }: AutoFitRichTextInput): number {
  const cap = Math.max(1, maxFontSize);
  if (width <= 0 || height <= 0 || !richBodyHasRenderableText(body)) return cap;
  const authoredFontSize = box.fontSize;

  const fits = (fontSize: number): boolean => {
    const layout = prepareRichLayout({
      body,
      box: buildBoxWithAutoFit(box, fontSize, authoredFontSize),
      width: Math.max(1, width),
      lineHeight,
      align: 'left',
    });
    return layout.layoutHeight <= height;
  };

  if (fits(cap)) return cap;

  let lo = 1;
  let hi = cap;
  for (let i = 0; i < 20; i += 1) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.max(1, Math.floor(lo * 100) / 100);
}

function drawRichBody(ctx: CanvasRenderingContext2D, layout: PreparedRichLayout & { alignY: number }, paintParams: RichPaintParams): void {
  const { width, align, alignY, lines } = layout;
  const { fill, stroke } = paintParams;
  const totalLines = lines.length;

  ctx.textBaseline = 'alphabetic';

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

  const decorate = (from: number, to: number, y: number, color: string, thickness: number): void => {
    if (!fill) return;
    ctx.save();
    ctx.beginPath();
    ctx.lineWidth = thickness;
    ctx.strokeStyle = color;
    ctx.moveTo(from, y);
    ctx.lineTo(from + Math.round(to - from), y);
    ctx.stroke();
    ctx.restore();
  };

  let yOffset = 0;
  for (let lineIndex = 0; lineIndex < totalLines; lineIndex += 1) {
    const line = lines[lineIndex];
    const baselineY = alignY + yOffset + line.translateY;
    const isJustify = align === 'justify' && !line.lastInParagraph;
    const extraPerSpace = isJustify && line.spaceCount > 0 ? (width - line.indentX - line.width) / line.spaceCount : 0;
    const startX = isJustify ? line.indentX : line.startX;

    if (line.marker) {
      if (line.markerFont) ctx.font = line.markerFont;
      paint(line.marker, isJustify ? 0 : line.groupX, baselineY, line.markerColor ?? '#000000');
    }

    let x = startX;
    for (const piece of line.pieces) {
      ctx.font = piece.font;
      const pieceStartX = x;
      if (!isJustify) {
        paint(piece.text, x, baselineY, piece.color);
        x += piece.width;
      } else {
        for (const segment of piece.segments) {
          paint(segment.text, x, baselineY, piece.color);
          x += segment.width + (segment.isSpace ? extraPerSpace : 0);
        }
      }
      const thickness = piece.fontSize / 15;
      const offset = Math.round(piece.fontSize / 4);
      if (piece.underline) decorate(pieceStartX, x, baselineY + offset, piece.color, thickness);
      if (piece.strike) decorate(pieceStartX, x, baselineY - offset, piece.color, thickness);
    }
    yOffset += line.lineHeightPx;
  }
}

// ── Component ────────────────────────────────────────────────

interface SceneNodeTextProps {
  node: RenderNode;
}

export function SceneNodeText({ node }: SceneNodeTextProps) {
  const element = node.element;
  const payload = element.payload as TextElementPayload;
  const fontEpoch = useFontAvailabilityEpoch();

  const resolvedText = useResolvedText({ text: payload.text, binding: payload.binding }, node.bindingOverride);
  const caseMode = payload.caseTransform ?? 'none';
  const lineHeight = payload.lineHeight ?? 1.25;
  const verticalAlign = payload.verticalAlign ?? 'middle';
  const hasBinding = Boolean(payload.binding);
  const fontFamily = payload.fontFamily || 'sans-serif';
  const baseBox = useMemo<RichBoxStyle>(() => {
    const resolved = boxStyleFromPayload(payload);
    resolved.fontFamily = fontFamily;
    return resolved;
  }, [payload.color, payload.fontSize, payload.italic, payload.strikethrough, payload.underline, payload.weight, fontFamily]);

  const body = useMemo<RichBody>(() => {
    const base = hasBinding
      ? textToRichBody(resolvedText)
      : payload.format === 'rich' && payload.richBody && payload.richBody.length > 0
        ? payload.richBody
        : textToRichBody(resolvedText);
    return applyCaseToBody(base, caseMode);
  }, [caseMode, hasBinding, payload.format, payload.richBody, resolvedText]);

  const autoFitEnabled = payload.autoFit ?? false;
  const autoFitMaxFontSize = payload.autoFitMaxFontSize ?? payload.fontSize;
  const fontSize = useMemo(
    () => (autoFitEnabled
      ? computeAutoFitRichTextFontSize({
          body,
          box: baseBox,
          width: element.width,
          height: element.height,
          lineHeight,
          maxFontSize: autoFitMaxFontSize,
        })
      : payload.fontSize),
    [autoFitEnabled, autoFitMaxFontSize, body, baseBox, element.width, element.height, lineHeight, payload.fontSize, fontEpoch],
  );

  const box = useMemo<RichBoxStyle>(() => {
    if (autoFitEnabled) return buildBoxWithAutoFit(baseBox, fontSize, baseBox.fontSize);
    return buildBoxWithFontSize(baseBox, fontSize);
  }, [autoFitEnabled, baseBox, fontSize]);

  const align = textAlign(payload.alignment ?? 'left');
  const preparedRichContent = useMemo(
    () => prepareRichLayout({ body, box, width: element.width, lineHeight, align }),
    [body, box, element.width, lineHeight, align, fontEpoch],
  );
  const textBleedPadding = textLineBleedPadding(preparedRichContent.maxFontSize, lineHeight);
  // autoFit shrinks the font to fit within element.height; lock the frame to
  // the element bounds so measurement overshoot at wrap boundaries doesn't
  // briefly expand and snap back while typing.
  const textFrameContentHeight = autoFitEnabled
    ? element.height
    : Math.max(element.height, preparedRichContent.contentHeight, preparedRichContent.layoutHeight);
  const textFrameY = textOverflowOffset(verticalAlign, element.height, textFrameContentHeight) - textBleedPadding;
  const textFrameHeight = textFrameContentHeight + textBleedPadding * 2;
  const textStrokeWidth = payload.textStrokeWidth ?? 0;
  const textStrokePosition = payload.textStrokePosition ?? 'outside';
  const textStrokeEnabled = Boolean(payload.textStrokeEnabled) && textStrokeWidth > 0;
  const textStrokeColor = payload.textStrokeColor ?? '#111111';

  const resolvedStrokeWidth = textStrokeEnabled
    ? textStrokePosition === 'center'
      ? textStrokeWidth
      : textStrokeWidth * 2
    : 0;

  const fillAfterStrokeEnabled = textStrokeEnabled && textStrokePosition === 'outside';
  const useInsideStroke = textStrokeEnabled && textStrokePosition === 'inside';

  const richTextLayout = useMemo(
    () => alignRichLayout(preparedRichContent, textFrameHeight, verticalAlign),
    [preparedRichContent, textFrameHeight, verticalAlign],
  );
  const sceneStroke = useMemo(
    () => (textStrokeEnabled
      ? { color: textStrokeColor, width: resolvedStrokeWidth, fillAfter: fillAfterStrokeEnabled }
      : undefined),
    [textStrokeEnabled, textStrokeColor, resolvedStrokeWidth, fillAfterStrokeEnabled],
  );

  const insideStrokeCanvas = useMemo(() => {
    if (!useInsideStroke) return null;

    const width = Math.max(1, Math.ceil(element.width));
    const height = Math.max(1, Math.ceil(textFrameHeight));
    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return null;

    drawRichBody(offCtx, richTextLayout, { fill: true });
    offCtx.globalCompositeOperation = 'source-atop';
    drawRichBody(offCtx, richTextLayout, {
      fill: false,
      stroke: { color: textStrokeColor, width: textStrokeWidth * 2, fillAfter: false },
    });
    offCtx.globalCompositeOperation = 'source-over';
    return offscreen;
  }, [useInsideStroke, element.width, textFrameHeight, richTextLayout, textStrokeColor, textStrokeWidth]);

  // Match Konva Text's _hitFunc: the whole frame is the hit region, so clicking
  // anywhere on the text box (not just on a glyph) selects it.
  const richTextHitFunc = useCallback((ctx: Context, shape: KonvaShape) => {
    ctx.beginPath();
    ctx.rect(0, 0, element.width, textFrameHeight);
    ctx.closePath();
    ctx.fillStrokeShape(shape);
  }, [element.width, textFrameHeight]);

  const richTextSceneFunc = useCallback((ctx: Context, shape: KonvaShape) => {
    const target = ctx._context;
    if (useInsideStroke) {
      if (insideStrokeCanvas) target.drawImage(insideStrokeCanvas, 0, 0);
    } else {
      drawRichBody(target, richTextLayout, { fill: true, stroke: sceneStroke });
    }
    ctx.fillStrokeShape(shape);
  }, [useInsideStroke, insideStrokeCanvas, richTextLayout, sceneStroke]);

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
