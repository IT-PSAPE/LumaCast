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
import type { RichRun } from './types';

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
function normalizeFontFamily(fontFamily: string): string {
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
