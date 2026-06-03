// Selection-range editing operations over the Rich Body — the single source of
// the run-formatting behavior, shared by the inline editor, the inline toolbar,
// and the inspector (spec §8 "one behavior, two entry points").
//
// A position is (block, offset) where offset is the character offset within the
// block's concatenated run text. All operations are pure: they take a Rich Body
// and return a new one, setting only the attributes the user changed (overrides),
// stripping any override that equals the Box-level default so "no formatting"
// stays byte-identical to plain, and coalescing adjacent equal-style runs.

import type { RichBody, RichBlock, RichRun } from './types';
import type { ResolvedRunStyle, RichBoxStyle } from './resolve';
import { resolveRun } from './resolve';

export interface RichPosition {
  block: number;
  offset: number;
}

export interface RichRange {
  start: RichPosition;
  end: RichPosition;
}

export type RunAttribute = 'color' | 'weight' | 'italic' | 'underline' | 'strikethrough';
export type RunPatch = Partial<Pick<RichRun, RunAttribute>>;

const RUN_ATTRIBUTES: RunAttribute[] = ['color', 'weight', 'italic', 'underline', 'strikethrough'];

export const BOLD_THRESHOLD = 600;

function blockText(block: RichBlock): string {
  return block.runs.map((run) => run.text).join('');
}

export function isRangeCollapsed(range: RichRange): boolean {
  return range.start.block === range.end.block && range.start.offset === range.end.offset;
}

export function normalizeRange(range: RichRange): RichRange {
  const { start, end } = range;
  const ordered = start.block < end.block || (start.block === end.block && start.offset <= end.offset);
  return ordered ? { start, end } : { start: end, end: start };
}

// Split runs so that no run straddles `offset` (a no-op when a boundary already
// sits there). Used so a style edit lands on exact character boundaries.
function splitAt(runs: RichRun[], offset: number): RichRun[] {
  const out: RichRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const len = run.text.length;
    if (offset > pos && offset < pos + len) {
      out.push({ ...run, text: run.text.slice(0, offset - pos) });
      out.push({ ...run, text: run.text.slice(offset - pos) });
    } else {
      out.push(run);
    }
    pos += len;
  }
  return out;
}

function sameStyle(a: RichRun, b: RichRun): boolean {
  return RUN_ATTRIBUTES.every((key) => a[key] === b[key]);
}

// Drop any override equal to the Box-level default so a fully-default run carries
// no style keys (byte-identical to plain text).
function stripToDefault(run: RichRun, box: RichBoxStyle): RichRun {
  const next: RichRun = { text: run.text };
  if (run.color !== undefined && run.color !== box.color) next.color = run.color;
  if (run.weight !== undefined && run.weight !== box.weight) next.weight = run.weight;
  if (run.italic !== undefined && run.italic !== box.italic) next.italic = run.italic;
  if (run.underline !== undefined && run.underline !== box.underline) next.underline = run.underline;
  if (run.strikethrough !== undefined && run.strikethrough !== box.strikethrough) next.strikethrough = run.strikethrough;
  return next;
}

function coalesceRuns(runs: RichRun[], box: RichBoxStyle): RichRun[] {
  const stripped = runs.filter((run) => run.text.length > 0).map((run) => stripToDefault(run, box));
  if (stripped.length === 0) return [{ text: '' }];
  const out: RichRun[] = [stripped[0]];
  for (let i = 1; i < stripped.length; i += 1) {
    const last = out[out.length - 1];
    if (sameStyle(last, stripped[i])) last.text += stripped[i].text;
    else out.push(stripped[i]);
  }
  return out;
}

function spanForBlock(range: RichRange, blockIndex: number, length: number): [number, number] {
  const from = blockIndex === range.start.block ? range.start.offset : 0;
  const to = blockIndex === range.end.block ? range.end.offset : length;
  return [Math.max(0, Math.min(from, length)), Math.max(0, Math.min(to, length))];
}

// Apply a run-level patch to the covered span, setting only the patched attributes
// and re-normalizing to overrides-only. Box style is needed to strip-to-default.
export function applyRunStyle(body: RichBody, range: RichRange, patch: RunPatch, box: RichBoxStyle): RichBody {
  const norm = normalizeRange(range);
  return body.map((block, index) => {
    if (index < norm.start.block || index > norm.end.block) return block;
    const length = blockText(block).length;
    const [from, to] = spanForBlock(norm, index, length);
    if (from >= to) return block;
    let runs = splitAt(block.runs, from);
    runs = splitAt(runs, to);
    let pos = 0;
    runs = runs.map((run) => {
      const start = pos;
      pos += run.text.length;
      if (start >= from && start < to) {
        const next: RichRun = { ...run };
        for (const key of RUN_ATTRIBUTES) {
          if (key in patch && patch[key] !== undefined) {
            (next as Record<RunAttribute, RichRun[RunAttribute]>)[key] = patch[key];
          }
        }
        return next;
      }
      return run;
    });
    return { ...block, runs: coalesceRuns(runs, box) };
  });
}

// Set (or clear, with null) the list type on every covered block directly. Used
// when the caller already knows the target state — e.g. a segmented control that
// manages its own selection — so there is no toggle ambiguity.
export function setListType(body: RichBody, range: RichRange, listType: 'bullet' | 'number' | null): RichBody {
  const norm = normalizeRange(range);
  return body.map((block, index) => {
    if (index < norm.start.block || index > norm.end.block) return block;
    if (listType === null) {
      const { listType: _removed, ...rest } = block;
      return rest;
    }
    return { ...block, listType };
  });
}

// Toggle a list type over the covered blocks: turn the list off when every
// covered block already has that type, otherwise set it on all of them.
export function toggleList(body: RichBody, range: RichRange, kind: 'bullet' | 'number'): RichBody {
  const norm = normalizeRange(range);
  const allKind = body
    .slice(norm.start.block, norm.end.block + 1)
    .every((block) => block.listType === kind);
  return body.map((block, index) => {
    if (index < norm.start.block || index > norm.end.block) return block;
    if (allKind) {
      const { listType: _removed, ...rest } = block;
      return rest;
    }
    return { ...block, listType: kind };
  });
}

export interface AttrState<T> {
  value: T;
  mixed: boolean;
}

export interface RangeStyle {
  bold: AttrState<boolean>;
  italic: AttrState<boolean>;
  underline: AttrState<boolean>;
  strikethrough: AttrState<boolean>;
  color: AttrState<string>;
  listType: AttrState<'bullet' | 'number' | undefined>;
}

// The runs whose text intersects the span; for a collapsed caret, the run on the
// left of the caret (or the first run) so the toolbar reflects the typing style.
function coveredRuns(block: RichBlock, from: number, to: number): RichRun[] {
  const collapsed = from === to;
  const result: RichRun[] = [];
  let pos = 0;
  let caretRun: RichRun | null = null;
  for (const run of block.runs) {
    const start = pos;
    const end = pos + run.text.length;
    pos = end;
    if (!collapsed && Math.max(start, from) < Math.min(end, to)) result.push(run);
    if (collapsed && start < from && from <= end) caretRun = run;
    if (collapsed && caretRun === null && from <= start) caretRun = run;
  }
  if (collapsed) return caretRun ? [caretRun] : block.runs.length ? [block.runs[0]] : [];
  return result;
}

function attr<T>(values: T[], fallback: T): AttrState<T> {
  if (values.length === 0) return { value: fallback, mixed: false };
  const first = values[0];
  const mixed = values.some((value) => value !== first);
  return { value: first, mixed };
}

// Resolve the effective style across a range, flagging each attribute as mixed
// when the covered runs disagree. Drives the inspector/toolbar indeterminate UI.
export function resolveRangeStyle(body: RichBody, range: RichRange, box: RichBoxStyle): RangeStyle {
  const norm = normalizeRange(range);
  const resolved: ResolvedRunStyle[] = [];
  const lists: ('bullet' | 'number' | undefined)[] = [];
  for (let index = norm.start.block; index <= norm.end.block; index += 1) {
    const block = body[index];
    if (!block) continue;
    lists.push(block.listType);
    const length = blockText(block).length;
    const [from, to] = spanForBlock(norm, index, length);
    for (const run of coveredRuns(block, from, to)) resolved.push(resolveRun(run, box));
  }
  return {
    bold: attr(resolved.map((style) => style.weight >= BOLD_THRESHOLD), box.weight >= BOLD_THRESHOLD),
    italic: attr(resolved.map((style) => style.italic), box.italic),
    underline: attr(resolved.map((style) => style.underline), box.underline),
    strikethrough: attr(resolved.map((style) => style.strikethrough), box.strikethrough),
    color: attr(resolved.map((style) => style.color), box.color),
    listType: attr(lists, undefined),
  };
}
