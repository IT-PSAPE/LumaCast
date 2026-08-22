// Run-aware width + line-break helpers shared by the renderer AND the editor.
// See docs/superpowers/specs/2026-06-02-rich-text-design.md §4, §6, §11(3).
//
// Both surfaces measure through the same Canvas2D-backed `MeasureText`, which is
// how editor⇄renderer metric parity is achieved (closing the DOM-vs-Canvas2D
// divergence). Measurement is injected so this module is pure and deterministic
// under test.
//
// The wrap mirrors Konva.Text's own `_setTextData` (node_modules/konva Text.js):
// per paragraph, if the whole line fits it is one line; otherwise a binary search
// finds the largest grapheme prefix that fits, backs up to the last space/dash for
// word wrapping (falling back to a mid-word break only when a single word is wider
// than the box), trims, and continues with the remainder. A Block is one paragraph
// (newlines are Block boundaries, never inside a Run), so this wraps one block's
// Runs. For a single-Run block it reproduces Konva's plain-text line breaks
// exactly — which is the move the renderer must keep pixel-identical. Widths are
// summed over maximal same-font segments, so a one-font line is measured as one
// whole string, just as Konva (and the current renderer) do.

import type { ResolvedRunStyle, RichBoxStyle } from './resolve';
import { resolveRun } from './resolve';
import type { RichBody, RichRun } from './types';

export type MeasureText = (text: string, font: string) => number;

export interface RichPiece {
  text: string;
  style: ResolvedRunStyle;
}

export interface LaidOutLine {
  pieces: RichPiece[];
  width: number;
  lastInParagraph: boolean;
}

export interface WrapOptions {
  width: number;
  measure: MeasureText;
}

// Quote multi-word family names exactly as Konva.Text's normalizeFontFamily does,
// so the canvas font string this builds resolves to the identical face (and thus
// identical metrics) as the Konva <Text> render we must stay pixel-identical to.
export function normalizeFontFamily(fontFamily: string): string {
  return fontFamily
    .split(',')
    .map((part) => {
      const family = part.trim();
      const hasSpace = family.indexOf(' ') >= 0;
      const hasQuotes = family.indexOf('"') >= 0 || family.indexOf("'") >= 0;
      return hasSpace && !hasQuotes ? `"${family}"` : family;
    })
    .join(', ');
}

// The canonical canvas font string for a resolved Run: italic flag, true numeric
// weight, size, family. This is the single source both renderer and editor use.
export function runFontString(style: ResolvedRunStyle): string {
  const family = normalizeFontFamily(style.fontFamily || 'sans-serif');
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${style.weight} ${style.fontSize}px ${family}`;
}

// Run width depends only on the font (family/size/weight/italic) — color and the
// decorations do not change advance width.
function styleFont(style: ResolvedRunStyle): string {
  return runFontString(style);
}

function sameResolved(a: ResolvedRunStyle, b: ResolvedRunStyle): boolean {
  return (
    a.fontFamily === b.fontFamily &&
    a.fontSize === b.fontSize &&
    a.weight === b.weight &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.underline === b.underline &&
    a.strikethrough === b.strikethrough
  );
}

// Width of a piece sequence: measure each maximal same-font run as one whole
// string (preserving intra-font kerning) and sum. One-font input ⇒ one measure().
export function measurePieces(pieces: RichPiece[], measure: MeasureText): number {
  let total = 0;
  let i = 0;
  while (i < pieces.length) {
    const font = styleFont(pieces[i].style);
    let text = pieces[i].text;
    let j = i + 1;
    while (j < pieces.length && styleFont(pieces[j].style) === font) {
      text += pieces[j].text;
      j += 1;
    }
    total += measure(text, font);
    i = j;
  }
  return total;
}

// Grapheme splitter mirroring Konva.Text's `stringToArray` so our line-breaking
// indexes by the same units Konva does (emoji, ZWJ sequences, regional-indicator
// flag pairs, and combining marks each count as one grapheme).
export function stringToGraphemes(str: string): string[] {
  const array = [...str];
  return array.reduce<string[]>((acc, char, index) => {
    if (/\p{Emoji}/u.test(char)) {
      const nextChar = array[index + 1];
      if (nextChar && /\p{Emoji_Modifier}|‍/u.test(nextChar)) {
        acc.push(char + nextChar);
        array[index + 1] = '';
      } else {
        acc.push(char);
      }
    } else if (/\p{Regional_Indicator}{2}/u.test(char + (array[index + 1] || ''))) {
      acc.push(char + array[index + 1]);
      array[index + 1] = '';
    } else if (index > 0 && /\p{Mn}|\p{Me}|\p{Mc}/u.test(char)) {
      acc[acc.length - 1] += char;
    } else if (char) {
      acc.push(char);
    }
    return acc;
  }, []);
}

interface StyledGrapheme {
  g: string;
  style: ResolvedRunStyle;
}

function resolveGraphemes(runs: RichRun[], box: RichBoxStyle): StyledGrapheme[] {
  const out: StyledGrapheme[] = [];
  for (const run of runs) {
    const style = resolveRun(run, box);
    for (const g of stringToGraphemes(run.text)) out.push({ g, style });
  }
  return out;
}

function measureGraphemes(slice: StyledGrapheme[], measure: MeasureText): number {
  let total = 0;
  let i = 0;
  while (i < slice.length) {
    const font = styleFont(slice[i].style);
    let text = slice[i].g;
    let j = i + 1;
    while (j < slice.length && styleFont(slice[j].style) === font) {
      text += slice[j].g;
      j += 1;
    }
    total += measure(text, font);
    i = j;
  }
  return total;
}

function isSpace(g: string): boolean {
  return g === ' ';
}

function trimRightGraphemes(slice: StyledGrapheme[]): StyledGrapheme[] {
  let end = slice.length;
  while (end > 0 && isSpace(slice[end - 1].g)) end -= 1;
  return slice.slice(0, end);
}

function trimLeftGraphemes(slice: StyledGrapheme[]): StyledGrapheme[] {
  let start = 0;
  while (start < slice.length && isSpace(slice[start].g)) start += 1;
  return slice.slice(start);
}

function lastBoundaryIndex(slice: StyledGrapheme[], end: number): number {
  // Largest index in [0, end) whose grapheme is a space or dash (the wrap point).
  for (let i = end - 1; i >= 0; i -= 1) {
    if (slice[i].g === ' ' || slice[i].g === '-') return i;
  }
  return -1;
}

function coalesce(slice: StyledGrapheme[]): RichPiece[] {
  const out: RichPiece[] = [];
  for (const c of slice) {
    const last = out[out.length - 1];
    if (last && sameResolved(last.style, c.style)) last.text += c.g;
    else out.push({ text: c.g, style: c.style });
  }
  return out;
}

function toLine(slice: StyledGrapheme[], measure: MeasureText, lastInParagraph: boolean): LaidOutLine {
  const pieces = coalesce(slice);
  return { pieces, width: measureGraphemes(slice, measure), lastInParagraph };
}

// Konva-faithful word wrap of one Block's Runs into `width`. An all-whitespace or
// empty block lays out as one empty line; a single word wider than the box is
// broken mid-word (matching Konva), everything else breaks at spaces/dashes.
export function wrapRuns(runs: RichRun[], box: RichBoxStyle, { width, measure }: WrapOptions): LaidOutLine[] {
  const maxWidth = width;
  let line = resolveGraphemes(runs, box);
  const lines: StyledGrapheme[][] = [];

  if (!(maxWidth > 0) || measureGraphemes(line, measure) <= maxWidth) {
    lines.push(line);
  } else {
    while (line.length > 0) {
      // Binary search the largest grapheme prefix that fits the box width.
      let low = 0;
      let high = line.length;
      let matchCount = 0;
      let matchWidth = 0;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const substrWidth = measureGraphemes(line.slice(0, mid + 1), measure);
        if (substrWidth <= maxWidth) {
          low = mid + 1;
          matchCount = mid + 1;
          matchWidth = substrWidth;
        } else {
          high = mid;
        }
      }
      if (matchCount <= 0) break;

      // Back up to the last word boundary unless the next grapheme already is one.
      const nextGrapheme = line[matchCount]?.g;
      const nextIsBoundary = nextGrapheme === ' ' || nextGrapheme === '-';
      let count = matchCount;
      if (!(nextIsBoundary && matchWidth <= maxWidth)) {
        const boundary = lastBoundaryIndex(line, matchCount);
        if (boundary + 1 > 0) count = boundary + 1;
      }

      lines.push(trimRightGraphemes(line.slice(0, count)));
      line = trimLeftGraphemes(line.slice(count));
      if (line.length > 0 && measureGraphemes(line, measure) <= maxWidth) {
        lines.push(line);
        break;
      }
    }
  }

  if (lines.length === 0) lines.push([]);
  return lines.map((slice, index) => toLine(slice, measure, index === lines.length - 1));
}

// A Canvas2D-backed measurer, shared so the renderer and editor lay out
// identically. Falls back to a coarse estimate only when no canvas exists (e.g.
// the main process); the renderer and editor always have one, and tests inject
// their own deterministic measurer.
export function createCanvasMeasurer(): MeasureText {
  let context: CanvasRenderingContext2D | null = null;
  let resolved = false;
  const getContext = (): CanvasRenderingContext2D | null => {
    if (resolved) return context;
    resolved = true;
    if (typeof document === 'undefined') return (context = null);
    context = document.createElement('canvas').getContext('2d');
    return context;
  };
  return (text, font) => {
    const ctx = getContext();
    if (!ctx) return estimateWidth(text, font);
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

// Degenerate width estimate for the no-canvas case only (never the render path).
function estimateWidth(text: string, font: string): number {
  const match = /(\d+(?:\.\d+)?)px/.exec(font);
  const size = match ? Number.parseFloat(match[1]) : 16;
  return text.length * size * 0.5;
}

// Line height helpers (mirrors canvas/text-layout.ts)
export function measureTextLineLayoutHeight(lineCount: number, fontSize: number, lineHeight: number): number {
  return Math.max(1, lineCount) * fontSize * lineHeight;
}

function buildBoxWithAutoFit(box: RichBoxStyle, fontSize: number, authoredFontSize: number): RichBoxStyle {
  const scale = authoredFontSize ? fontSize / authoredFontSize : 1;
  return { ...box, fontSize, fontScale: scale };
}

function richBodyHasRenderableText(body: RichBody): boolean {
  return body.some((block) => block.runs.some((run) => run.text.trim().length > 0));
}

// Layout preparation for editor⇄renderer parity — exported so the inline editor
// can generate DOM that matches the canvas line breaks exactly.
export interface PreparedDrawSegment {
  text: string;
  width: number;
  isSpace: boolean;
}

export interface PreparedDrawPiece {
  text: string;
  color: string;
  font: string;
  fontSize: number;
  underline: boolean;
  strike: boolean;
  width: number;
  spaceCount: number;
  segments: PreparedDrawSegment[];
}

export interface PreparedDrawLine {
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

export interface PreparedRichLayout {
  width: number;
  align: 'left' | 'center' | 'right' | 'justify';
  contentHeight: number;
  layoutHeight: number;
  maxFontSize: number;
  lines: PreparedDrawLine[];
}

export function prepareRichLayout(params: { body: RichBody; box: RichBoxStyle; width: number; lineHeight: number; align: 'left' | 'center' | 'right' | 'justify' }): PreparedRichLayout {
  const { body, box, width, lineHeight, align } = params;
  const boxFont = runFontString(box);
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
      const pieces = line.pieces.map((piece) => {
        const prepared: PreparedDrawPiece = {
          text: piece.text,
          color: piece.style.color,
          font: runFontString(piece.style),
          fontSize: piece.style.fontSize,
          underline: piece.style.underline,
          strike: piece.style.strikethrough,
          width: sharedMeasurer(piece.text, runFontString(piece.style)),
          spaceCount: 0,
          segments: [],
        };
        // Split into segments for justification
        for (const segmentText of piece.text.split(/( )/)) {
          if (!segmentText) continue;
          const isSpace = segmentText === ' ';
          if (isSpace) prepared.spaceCount += 1;
          prepared.segments.push({
            text: segmentText,
            width: sharedMeasurer(segmentText, runFontString(piece.style)),
            isSpace,
          });
        }
        return prepared;
      });
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

  const lastLine = lines[lines.length - 1];
  const layoutHeight = lastLine
    ? lines.reduce((total, line) => total + line.lineHeightPx, 0)
    : measureTextLineLayoutHeight(1, box.fontSize, lineHeight);
  const contentHeight = lastLine
    ? layoutHeight - lastLine.lineHeightPx + lastLine.maxFontSize
    : measureTextLineLayoutHeight(1, box.fontSize, lineHeight);

  return {
    width,
    align,
    contentHeight,
    layoutHeight,
    maxFontSize,
    lines,
  };
}

// Shared measurer for layout preparation (uses the same canvas measurer)
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

export interface AutoFitRichTextInput {
  body: RichBody;
  box: RichBoxStyle;
  width: number;
  height: number;
  lineHeight: number;
  maxFontSize: number;
}

// Largest font size (capped at maxFontSize) at which the wrapped rich text fits
// entirely within the box's width and height.
export function computeAutoFitRichTextFontSize({ body, box, width, height, lineHeight, maxFontSize }: AutoFitRichTextInput): number {
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
