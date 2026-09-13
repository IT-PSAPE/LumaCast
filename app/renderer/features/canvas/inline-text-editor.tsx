import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SlideElement, TextElementPayload } from '@lumacast/composition';
import {
  type RichBody,
  type RichBlock,
  type RichRun,
  type RichBoxStyle,
  boxStyleFromPayload,
  resolveRun,
  synthesizePlain,
  applyRunStyle,
  resolveRangeStyle,
  setListType,
  isRangeCollapsed,
  type RichPosition,
  type RichRange,
  normalizeFontFamily,
  computeAutoFitRichTextFontSize,
  createCanvasMeasurer,
  runFontString,
} from '@lumacast/composition';
import { Bold, Italic, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { ColorPicker } from '@renderer/components/form/color-picker';
import { FieldInput } from '@renderer/components/form/field';
import { resolveInlineTextAlign, useFontAvailabilityEpoch, textLineBleedPadding } from '@lumacast/canvas';

interface InlineTextEditorProps {
  editingTextId: string;
  effectiveElements: SlideElement[];
  sceneOffsetX: number;
  sceneOffsetY: number;
  sceneScale: number;
  onCommit: (body: RichBody) => void;
  onCancel: () => void;
  onLiveChange?: (body: RichBody) => void;
}

// ── How the editor is laid out ───────────────────────────────
//
// While an element is being edited the canvas stops drawing its text
// (scene-node-text.tsx `hideText`) and this contentEditable renders it
// instead, visibly, with the element's own font, size, color, decorations,
// case, stroke, and shadow. Text, caret, and selection therefore come from
// ONE layout engine (the browser's) and always agree with each other. Nothing
// is measured or cached to position them.
//
// The geometry is declarative: a frame div sits exactly on the element bounds
// (the same box the transformer shows) and is a column flexbox whose
// `justify-content` is the element's vertical alignment. That single rule
// reproduces both of the canvas's vertical placements — content shorter than
// the box is centred/bottom-aligned inside it, and content taller than the
// box overflows equally above and below (middle), upward (bottom), or
// downward (top) — which is exactly what the canvas draws once the edit is
// committed, so nothing shifts on enter or exit.

// ── Model ⇄ contentEditable DOM ──────────────────────────────
// Runs carry their overrides on data-* attributes so the DOM serializes back to
// the model exactly; the visible styling is the resolved inline style. Blocks are
// <div>s; list markers are CSS ::before content (never part of the editable text).

const EDITOR_STYLE_ID = 'rich-text-editor-style';
const SELECTION_HIGHLIGHT = 'rt-editor-selection';
const SELECTION_COLOR = 'rgba(77,163,255,0.35)';

function ensureEditorStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(EDITOR_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = EDITOR_STYLE_ID;
  style.textContent = [
    // A list block reserves the marker column the canvas measures for it
    // (`--rt-marker-w`, in em of the block font, set per block by bodyToHtml)
    // and hangs the marker into it, so the text starts where the canvas
    // starts it and wrapped lines indent by the same amount.
    '.rt-editor [data-marker]{padding-left:var(--rt-marker-w);}',
    '.rt-editor [data-marker]::before{content:attr(data-marker);display:inline-block;width:var(--rt-marker-w);margin-left:calc(-1 * var(--rt-marker-w));white-space:pre;}',
    `.rt-editor::selection{background:${SELECTION_COLOR};}`,
    `.rt-editor ::selection{background:${SELECTION_COLOR};}`,
    // The same colour, painted through the CSS Custom Highlight API over the
    // tracked model range while focus is in a toolbar field (focusing a native
    // <input> discards the document selection). See the highlight effect.
    `.rt-editor::highlight(${SELECTION_HIGHLIGHT}){background:${SELECTION_COLOR};}`,
  ].join('');
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rangesEqual(a: RichRange | null, b: RichRange | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.start.block === b.start.block && a.start.offset === b.start.offset
    && a.end.block === b.end.block && a.end.offset === b.end.offset;
}

function blockLength(block: RichBlock | undefined): number {
  return block ? block.runs.reduce((sum, run) => sum + run.text.length, 0) : 0;
}

// Same marker text (and numbering) the canvas draws — prepareRichLayout resets
// the counter on every non-numbered block.
export function blockMarkers(body: RichBody): (string | undefined)[] {
  let counter = 0;
  return body.map((block) => {
    counter = block.listType === 'number' ? counter + 1 : 0;
    if (block.listType === 'bullet') return '• ';
    if (block.listType === 'number') return `${counter}. `;
    return undefined;
  });
}

function runSpanHtml(run: RichRun, box: RichBoxStyle): string {
  const resolved = resolveRun(run, box);
  // The visible size is an em ratio to the box size, never absolute px: the
  // container carries the (auto-fit) size × scene scale, so an em ratio
  // inherits both. A run with no override emits no font-size (1em).
  const styleParts = [
    `font-weight:${resolved.weight}`,
    `font-style:${resolved.italic ? 'italic' : 'normal'}`,
    `color:${resolved.color}`,
  ];
  const decorations = [resolved.underline ? 'underline' : '', resolved.strikethrough ? 'line-through' : ''].filter(Boolean);
  styleParts.push(`text-decoration:${decorations.length > 0 ? decorations.join(' ') : 'none'}`);
  if (run.fontSize !== undefined) {
    // box.fontSize can be 0 or undefined (the persistence layer permits both),
    // which would make the em ratio Infinity/NaN; fall back to absolute px.
    if (box.fontSize && Number.isFinite(box.fontSize)) {
      const ratio = resolved.fontSize / box.fontSize;
      if (Number.isFinite(ratio)) styleParts.push(`font-size:${ratio}em`);
    } else if (Number.isFinite(resolved.fontSize)) {
      styleParts.push(`font-size:${resolved.fontSize}px`);
    }
  }
  const data: string[] = [];
  if (run.color !== undefined) data.push(`data-c="${escapeHtml(run.color)}"`);
  if (run.weight !== undefined) data.push(`data-w="${run.weight}"`);
  if (run.italic !== undefined) data.push(`data-i="${run.italic ? 1 : 0}"`);
  if (run.underline !== undefined) data.push(`data-u="${run.underline ? 1 : 0}"`);
  if (run.strikethrough !== undefined) data.push(`data-s="${run.strikethrough ? 1 : 0}"`);
  if (run.fontSize !== undefined) data.push(`data-fs="${run.fontSize}"`);
  const attrs = [`style="${styleParts.join(';')}"`, ...data].join(' ');
  return `<span ${attrs}>${escapeHtml(run.text)}</span>`;
}

export interface BodyToHtmlOptions {
  // Width of a list marker in em of the box font. The component measures it
  // with the same canvas measurer the renderer uses; tests may omit it.
  markerWidthEm?: (marker: string) => number;
}

function estimateMarkerWidthEm(marker: string): number {
  return marker.length * 0.55;
}

export function bodyToHtml(body: RichBody, box: RichBoxStyle, options?: BodyToHtmlOptions | null): string {
  const markerWidthEm = options?.markerWidthEm ?? estimateMarkerWidthEm;
  const markers = blockMarkers(body);
  return body
    .map((block, blockIndex) => {
      const classes = ['rt-block'];
      if (block.listType === 'bullet') classes.push('rt-bullet');
      if (block.listType === 'number') classes.push('rt-number');
      const marker = markers[blockIndex];
      const markerAttrs = marker
        ? ` data-marker="${escapeHtml(marker)}" style="--rt-marker-w:${markerWidthEm(marker)}em"`
        : '';
      const inner = block.runs.some((run) => run.text.length > 0)
        ? block.runs.map((run) => runSpanHtml(run, box)).join('')
        : '<br>';
      return `<div class="${classes.join(' ')}" data-block${markerAttrs}>${inner}</div>`;
    })
    .join('');
}

function coalesceSerialized(runs: RichRun[]): RichRun[] {
  if (runs.length === 0) return [{ text: '' }];
  const out: RichRun[] = [{ ...runs[0] }];
  for (let i = 1; i < runs.length; i += 1) {
    const last = out[out.length - 1];
    const next = runs[i];
    const same = last.color === next.color && last.weight === next.weight && last.italic === next.italic
      && last.underline === next.underline && last.strikethrough === next.strikethrough
      && last.fontSize === next.fontSize;
    if (same) last.text += next.text;
    else out.push({ ...next });
  }
  return out;
}

function collectRuns(node: Node, runs: RichRun[]): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) runs.push({ text: child.textContent });
      return;
    }
    if (child.nodeName === 'BR') return;
    const element = child as HTMLElement;
    if (element.tagName === 'SPAN') {
      const run: RichRun = { text: element.textContent ?? '' };
      if (element.dataset.c !== undefined) run.color = element.dataset.c;
      if (element.dataset.w !== undefined) run.weight = Number(element.dataset.w);
      if (element.dataset.i !== undefined) run.italic = element.dataset.i === '1';
      if (element.dataset.u !== undefined) run.underline = element.dataset.u === '1';
      if (element.dataset.s !== undefined) run.strikethrough = element.dataset.s === '1';
      if (element.dataset.fs !== undefined) run.fontSize = Number(element.dataset.fs);
      if (run.text.length > 0) runs.push(run);
      return;
    }
    collectRuns(element, runs);
  });
}

export function domToBody(root: HTMLElement): RichBody {
  const blockEls = Array.from(root.children).filter((el) => el.tagName === 'DIV') as HTMLElement[];
  const sources: HTMLElement[] = blockEls.length > 0 ? blockEls : [root];
  const blocks: RichBlock[] = sources.map((blockEl) => {
    const runs: RichRun[] = [];
    collectRuns(blockEl, runs);
    const block: RichBlock = { runs: runs.length > 0 ? coalesceSerialized(runs) : [{ text: '' }], indent: 0 };
    if (blockEl.classList?.contains('rt-bullet')) block.listType = 'bullet';
    else if (blockEl.classList?.contains('rt-number')) block.listType = 'number';
    return block;
  });
  return blocks.length > 0 ? blocks : [{ runs: [{ text: '' }], indent: 0 }];
}

// The browser merges/removes blocks on Backspace, Delete, cut, and typing over
// a multi-block selection. Those need a structural re-render (markers
// renumber, the DOM is normalized); plain typing must not touch the DOM.
export function blockStructureChanged(previous: RichBody, next: RichBody): boolean {
  if (previous.length !== next.length) return true;
  return previous.some((block, index) => block.listType !== next[index].listType || block.indent !== next[index].indent);
}

// ── Caret (block, offset) ⇄ DOM ──────────────────────────────
// Uses Range.toString() length so ::before markers and element/text containers
// are all handled by the browser's own counting.

function blockIndexOf(root: HTMLElement, container: Node): number {
  let el: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
  while (el && el.parentNode !== root) el = el.parentNode;
  if (!el) return 0;
  return Math.max(0, Array.prototype.indexOf.call(root.children, el));
}

function positionOf(root: HTMLElement, container: Node, offset: number): RichPosition {
  const blockIndex = blockIndexOf(root, container);
  const blockEl = root.children[blockIndex] ?? root;
  const range = document.createRange();
  range.selectNodeContents(blockEl);
  try {
    range.setEnd(container, offset);
  } catch {
    return { block: blockIndex, offset: 0 };
  }
  return { block: blockIndex, offset: range.toString().length };
}

export function richRangeFromDom(root: HTMLElement, domRange: Range): RichRange | null {
  if (!root.contains(domRange.startContainer) || !root.contains(domRange.endContainer)) return null;
  return {
    start: positionOf(root, domRange.startContainer, domRange.startOffset),
    end: positionOf(root, domRange.endContainer, domRange.endOffset),
  };
}

function readRange(root: HTMLElement): RichRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  return richRangeFromDom(root, selection.getRangeAt(0));
}

interface DomPoint {
  node: Node;
  offset: number;
}

function domPointOf(root: HTMLElement, position: RichPosition): DomPoint | null {
  const blockEl = root.children[position.block] as HTMLElement | undefined;
  if (!blockEl) return null;
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let remaining = position.offset;
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  while (node) {
    lastText = node;
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode() as Text | null;
  }
  if (lastText) return { node: lastText, offset: lastText.textContent?.length ?? 0 };
  return { node: blockEl, offset: 0 };
}

export function domRangeFromRich(root: HTMLElement, richRange: RichRange): Range | null {
  const start = domPointOf(root, richRange.start);
  const end = domPointOf(root, richRange.end);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (range.collapsed && !(richRange.start.block === richRange.end.block && richRange.start.offset === richRange.end.offset)) {
    // start came after end in DOM order: setEnd collapsed the range. Rebuild reversed.
    range.setStart(end.node, end.offset);
    range.setEnd(start.node, start.offset);
  }
  return range;
}

function placeRange(root: HTMLElement, richRange: RichRange): void {
  const selection = window.getSelection();
  const range = domRangeFromRich(root, richRange);
  if (!selection || !range) return;
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeCaret(root: HTMLElement, position: RichPosition): void {
  placeRange(root, { start: position, end: position });
}

// Split the caret's block into two blocks for Enter.
function splitBlockAt(body: RichBody, position: RichPosition): RichBody {
  const result: RichBody = [];
  body.forEach((block, index) => {
    if (index !== position.block) {
      result.push(block);
      return;
    }
    const before: RichRun[] = [];
    const after: RichRun[] = [];
    let pos = 0;
    for (const run of block.runs) {
      const start = pos;
      const end = pos + run.text.length;
      pos = end;
      if (end <= position.offset) before.push(run);
      else if (start >= position.offset) after.push(run);
      else {
        before.push({ ...run, text: run.text.slice(0, position.offset - start) });
        after.push({ ...run, text: run.text.slice(position.offset - start) });
      }
    }
    const carryList = block.listType ? { listType: block.listType } : {};
    result.push({ runs: before.length ? before : [{ text: '' }], indent: 0, ...carryList });
    result.push({ runs: after.length ? after : [{ text: '' }], indent: 0, ...carryList });
  });
  return result;
}

// ── Element → DOM styling ────────────────────────────────────

const markerMeasurer = createCanvasMeasurer();

function initialBodyFor(payload: TextElementPayload | null): RichBody {
  if (!payload) return [{ runs: [{ text: '' }], indent: 0 }];
  return payload.format === 'rich' && payload.richBody && payload.richBody.length > 0
    ? payload.richBody
    : synthesizePlain(payload);
}

// Largest size any run resolves to, in em of the box size. Only used for the
// line-height < 1 bleed below, where the canvas nudges top/bottom-aligned text
// outward by half the glyph overshoot so it stays inside the element bounds.
function bodyMaxFontSizeEm(body: RichBody, box: RichBoxStyle): number {
  let max = 1;
  if (!box.fontSize || !Number.isFinite(box.fontSize)) return max;
  for (const block of body) {
    for (const run of block.runs) {
      if (run.fontSize !== undefined && Number.isFinite(run.fontSize)) max = Math.max(max, run.fontSize / box.fontSize);
    }
  }
  return max;
}

function textStrokeStyle(payload: TextElementPayload, scale: number): React.CSSProperties {
  const width = payload.textStrokeWidth ?? 0;
  if (!payload.textStrokeEnabled || width <= 0) return {};
  const color = payload.textStrokeColor ?? '#111111';
  const position = payload.textStrokePosition ?? 'outside';
  // The canvas draws an outside stroke at twice the width underneath the fill;
  // paint-order reproduces that. Center and inside strokes both draw over the
  // fill at the authored width (CSS cannot clip a stroke to the glyph interior;
  // an inside stroke therefore reads a hair thinner while editing).
  return position === 'outside'
    ? { WebkitTextStroke: `${width * 2 * scale}px ${color}`, paintOrder: 'stroke fill' }
    : { WebkitTextStroke: `${width * scale}px ${color}` };
}

function textShadowStyle(payload: TextElementPayload, scale: number): React.CSSProperties {
  if (!payload.textShadowEnabled) return {};
  const x = (payload.textShadowOffsetX ?? 0) * scale;
  const y = (payload.textShadowOffsetY ?? 0) * scale;
  const blur = (payload.textShadowBlur ?? 0) * scale;
  return { textShadow: `${x}px ${y}px ${blur}px ${payload.textShadowColor ?? '#000000'}` };
}

// Same transform order as the Konva Group (scene-node.tsx / sceneNodeFrame):
// offset for a flip, then scale, then rotate, all about the element origin.
function frameTransform(element: SlideElement, payload: TextElementPayload, width: number, height: number): string | undefined {
  const parts: string[] = [];
  if (element.rotation) parts.push(`rotate(${element.rotation}deg)`);
  const flipX = payload.flipX ? -1 : 1;
  const flipY = payload.flipY ? -1 : 1;
  if (flipX < 0 || flipY < 0) {
    parts.push(`scale(${flipX}, ${flipY})`);
    parts.push(`translate(${flipX < 0 ? -width : 0}px, ${flipY < 0 ? -height : 0}px)`);
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

const JUSTIFY_FOR_VERTICAL_ALIGN = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const;

function highlightRegistry(): HighlightRegistry | null {
  if (typeof CSS === 'undefined' || typeof Highlight === 'undefined') return null;
  return CSS.highlights ?? null;
}

export function InlineTextEditor({ editingTextId, effectiveElements, sceneOffsetX, sceneOffsetY, sceneScale, onCommit, onCancel, onLiveChange }: InlineTextEditorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const committedRef = useRef(false);
  const [range, setRange] = useState<RichRange | null>(null);
  const fontEpoch = useFontAvailabilityEpoch();
  // Whether the contentEditable host itself currently has DOM focus — drives
  // the highlight painted while a toolbar field holds focus. Independent of
  // the blur-guard/commit logic in handleBlur (which decides whether the
  // editor stays open).
  const [editorHasFocus, setEditorHasFocus] = useState(false);
  // How far the rendered text starts above the frame's top edge (negative
  // while content overflows upward), read from the DOM so the toolbar can sit
  // above the text rather than over its first line. Not part of the text
  // geometry itself — that is pure CSS (see the frame's flex rule).
  const [textOverflowTop, setTextOverflowTop] = useState(0);
  // Draft text for the font-size field. `null` means "not editing" — the field
  // shows the resolved selection value. While focused it holds the raw text the
  // user is typing, and is only committed on Enter/blur when it changed.
  const [fontSizeDraft, setFontSizeDraft] = useState<string | null>(null);
  const fontSizeStartRef = useRef<string>('');
  // Synchronous mirror of the draft so the Enter/blur handlers never commit
  // twice (React state is stale inside the same tick) and so a stale draft can
  // be abandoned when the selection it was editing is no longer the selection.
  const fontSizePendingRef = useRef<string | null>(null);
  const fontSizeRangeRef = useRef<RichRange | null>(null);

  const element = effectiveElements.find((el) => el.id === editingTextId);
  const payload = element?.type === 'text' ? (element.payload as unknown as TextElementPayload) : null;
  const isBound = Boolean(payload?.binding);

  // The body lives in state (render-time derivations: auto-fit size, toolbar
  // state) and in a ref (synchronous reads inside event handlers). Both are
  // always written together, through setBody/renderBody only.
  const [body, setBodyState] = useState<RichBody>(() => initialBodyFor(payload));
  const bodyRef = useRef<RichBody>(body);
  const setBody = useCallback((next: RichBody) => {
    bodyRef.current = next;
    setBodyState(next);
  }, []);

  const box = useMemo<RichBoxStyle>(() => {
    const base = payload ? boxStyleFromPayload(payload) : ({} as RichBoxStyle);
    return { ...base, fontFamily: normalizeFontFamily(base.fontFamily || 'sans-serif') };
  }, [payload]);

  // Marker widths in em of the box font, from the same canvas measurer the
  // renderer wraps with, so a list block's text starts where the canvas starts it.
  const markerWidthEm = useCallback((marker: string) => {
    if (!box.fontSize || !Number.isFinite(box.fontSize)) return estimateMarkerWidthEm(marker);
    const width = markerMeasurer(marker, runFontString(box)) / box.fontSize;
    return Number.isFinite(width) && width > 0 ? width : estimateMarkerWidthEm(marker);
  }, [box]);

  // Re-render the DOM from the model and restore the caret. Used for structural
  // edits (style apply, list toggle, Enter, block merges) — NOT for plain typing.
  const renderBody = useCallback((next: RichBody, caret: RichRange | null) => {
    const root = editorRef.current;
    if (!root) return;
    setBody(next);
    root.innerHTML = bodyToHtml(next, box, { markerWidthEm });
    // Only restore the DOM selection when the editor itself holds DOM focus:
    // `Selection.addRange` into a contentEditable moves focus there, which
    // would yank focus off a toolbar field driving this edit and defeat
    // click-outside-to-commit. When the editor isn't focused the caret lives
    // in the `range` state and the highlight effect paints it.
    if (caret && document.activeElement === root) placeRange(root, caret);
    onLiveChange?.(next);
  }, [box, markerWidthEm, setBody, onLiveChange]);

  const syncRange = useCallback(() => {
    const root = editorRef.current;
    if (!root) return;
    // The DOM selection is elsewhere (a toolbar field) rather than stale when
    // this returns null; keep the last tracked range so a second toolbar-driven
    // edit still has its target.
    const next = readRange(root);
    if (next) setRange((current) => (rangesEqual(current, next) ? current : next));
  }, []);

  // Mount: paint the model into the DOM, focus, select all.
  useEffect(() => {
    const root = editorRef.current;
    if (!root || !payload) return;
    ensureEditorStyle();
    committedRef.current = false;
    root.innerHTML = bodyToHtml(bodyRef.current, box, { markerWidthEm });
    const focusAndSelect = () => {
      root.focus();
      const selection = window.getSelection();
      if (selection) selection.selectAllChildren(root);
      syncRange();
    };
    if (typeof requestAnimationFrame !== 'function') {
      focusAndSelect();
      return;
    }
    const frame = requestAnimationFrame(focusAndSelect);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextId]);

  // The document's own selection event covers keyboard, mouse (including drags
  // that end outside the editor), and programmatic changes alike.
  useEffect(() => {
    document.addEventListener('selectionchange', syncRange);
    return () => document.removeEventListener('selectionchange', syncRange);
  }, [syncRange]);

  const handleFocus = useCallback(() => setEditorHasFocus(true), []);

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root) return;
    const measure = () => setTextOverflowTop(Math.min(0, root.offsetTop));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [element?.height, sceneScale]);

  // While a toolbar field holds focus the document selection is gone, so paint
  // the tracked range through the CSS Custom Highlight API: the browser draws
  // it at the true glyph positions and no DOM node is touched. Cleared as soon
  // as the editor is focused again (the native selection takes over).
  useEffect(() => {
    const root = editorRef.current;
    const registry = highlightRegistry();
    if (!root || !registry) return;
    if (editorHasFocus || !range || isRangeCollapsed(range)) {
      registry.delete(SELECTION_HIGHLIGHT);
      return;
    }
    const domRange = domRangeFromRich(root, range);
    if (!domRange) return;
    registry.set(SELECTION_HIGHLIGHT, new Highlight(domRange));
    return () => { registry.delete(SELECTION_HIGHLIGHT); };
  }, [editorHasFocus, range, body]);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const root = editorRef.current;
    if (!root) return;
    const next = domToBody(root);
    if (blockStructureChanged(bodyRef.current, next)) {
      renderBody(next, readRange(root));
    } else {
      setBody(next);
      onLiveChange?.(next);
    }
    syncRange();
  }, [renderBody, setBody, onLiveChange, syncRange]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(bodyRef.current);
  }, [onCommit]);

  // A blur caused by interacting with the toolbar or its (portaled) ColorPicker
  // popover must not commit/close the editor. The toolbar's onMouseDown
  // preventDefault covers its buttons, but the popover panel is rendered in a
  // portal outside it, so detect that case here and keep the editor open.
  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    setEditorHasFocus(false);
    const next = event.relatedTarget as HTMLElement | null;
    if (next && (toolbarRef.current?.contains(next) || next.closest('[data-popover-content]'))) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (toolbarRef.current?.contains(active) || active.closest('[data-popover-content]'))) return;
    commit();
  }, [commit]);

  // A click on the frame beside the text (above or below it when the text is
  // shorter than the box) is a click in the box, not outside it: keep focus in
  // the editor and put the caret at the nearest end, as a document margin does.
  const handleFrameMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const root = editorRef.current;
    if (!root || event.target !== event.currentTarget) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    const atStart = event.clientY < rect.top;
    root.focus();
    const current = bodyRef.current;
    const lastIndex = current.length - 1;
    placeCaret(root, atStart ? { block: 0, offset: 0 } : { block: lastIndex, offset: blockLength(current[lastIndex]) });
    syncRange();
  }, [syncRange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      committedRef.current = true;
      onCancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      // Commit-and-close on Cmd/Ctrl+Enter; plain Enter inserts a new block.
      if (event.metaKey || event.ctrlKey) {
        event.preventDefault();
        commit();
        return;
      }
      event.preventDefault();
      const root = editorRef.current;
      if (!root) return;
      const current = readRange(root) ?? range;
      if (!current) return;
      const caret = current.start;
      const next = splitBlockAt(bodyRef.current, caret);
      renderBody(next, { start: { block: caret.block + 1, offset: 0 }, end: { block: caret.block + 1, offset: 0 } });
      syncRange();
    }
  }, [commit, onCancel, range, renderBody, syncRange]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    // Insert sanitized plain text using the browser, then re-serialize: foreign
    // styling is dropped, line breaks become blocks on the next serialize.
    const lines = text.split(/\r?\n/);
    document.execCommand('insertText', false, lines.join('\n'));
    handleInput();
  }, [handleInput]);

  const applyToggle = useCallback((patch: Parameters<typeof applyRunStyle>[2]) => {
    const root = editorRef.current;
    if (!root || isBound) return;
    const current = readRange(root) ?? range;
    if (!current) return;
    const next = applyRunStyle(bodyRef.current, current, patch, box);
    renderBody(next, current);
    syncRange();
  }, [box, isBound, range, renderBody, syncRange]);

  const applyListSet = useCallback((kind: 'bullet' | 'number' | null) => {
    const root = editorRef.current;
    if (!root || isBound) return;
    const current = readRange(root) ?? range;
    if (!current) return;
    const next = setListType(bodyRef.current, current, kind);
    renderBody(next, current);
    syncRange();
  }, [isBound, range, renderBody, syncRange]);

  // Apply a typed/stepped font size with the existing clamp and non-finite guard.
  // Kept separate so the field can defer to it only on a real commit, never per
  // keystroke.
  const applyFontSize = useCallback((raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') return;
    const next = Number(trimmed);
    if (!Number.isFinite(next)) return;
    applyToggle({ fontSize: Math.max(1, Math.round(next)) });
  }, [applyToggle]);

  // Commit the size field's draft — the single path shared by Enter and blur, so
  // Enter's own blur cannot apply twice. A draft is written only when it changed
  // from the value it started at (so focus-then-blur writes nothing) and only
  // while it still targets the selection it was started on.
  const commitFontSizeDraft = useCallback(() => {
    const pending = fontSizePendingRef.current;
    fontSizePendingRef.current = null;
    setFontSizeDraft(null);
    if (pending === null || pending === fontSizeStartRef.current) return;
    if (!rangesEqual(range, fontSizeRangeRef.current)) return;
    applyFontSize(pending);
  }, [applyFontSize, range]);

  // Click-outside-to-commit. `handleBlur` only fires when DOM focus actually
  // moves to another focusable element, so a genuine outside click needs its
  // own detector. `pointerdown` fires BEFORE the focus change that blurs the
  // size field, so the field's pending draft is flushed into the body first,
  // then the body is committed. The "inside" set mirrors `handleBlur`'s: the
  // frame (which contains the editor), the toolbar, any portaled popover.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (frameRef.current?.contains(target)) return;
      if (toolbarRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest('[data-popover-content]')) return;
      commitFontSizeDraft();
      commit();
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [commit, commitFontSizeDraft]);

  const rangeStyle = useMemo(() => (range ? resolveRangeStyle(body, range, box) : null), [range, body, box]);

  // The display value is rounded (a size is an integer px on the canvas); a
  // fractional box size therefore shows a rounded number. We only compare the
  // committed draft against the value it STARTED at, so merely focusing and
  // blurring never writes the rounded display back onto the selection.
  const resolvedSize = rangeStyle?.fontSize.value ?? box.fontSize;
  const fontSizeDisplay = rangeStyle?.fontSize.mixed || !Number.isFinite(resolvedSize)
    ? ''
    : String(Math.round(resolvedSize));

  // Everything below is null-safe because every hook must run on every render:
  // `element`/`payload` can be absent on the render where the editing target
  // has just disappeared, and the component returns null right after.
  const lineHeight = payload?.lineHeight ?? 1.25;
  // UNSCALED element units (matching scene-node-text.tsx's own `fontSize`).
  // With auto-fit this is the size the canvas will draw the committed text at,
  // recomputed from the live body on every change.
  const baseFontSize = useMemo(() => {
    if (!element || !payload) return 0;
    return payload.autoFit
      ? computeAutoFitRichTextFontSize({
          body,
          box,
          width: element.width,
          height: element.height,
          lineHeight,
          maxFontSize: payload.autoFitMaxFontSize ?? payload.fontSize,
        })
      : payload.fontSize;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload?.autoFit, payload?.autoFitMaxFontSize, payload?.fontSize, lineHeight, body, box, element?.width, element?.height, fontEpoch]);
  const maxFontSizeEm = useMemo(() => bodyMaxFontSizeEm(body, box), [body, box]);

  if (!element || !payload) return null;

  const left = sceneOffsetX + element.x * sceneScale;
  const top = sceneOffsetY + element.y * sceneScale;
  const width = element.width * sceneScale;
  const height = element.height * sceneScale;
  const fontSize = baseFontSize * sceneScale;
  const verticalAlign = payload.verticalAlign ?? 'middle';
  const textAlign = resolveInlineTextAlign(payload.alignment);
  // With line-height < 1 the glyphs overshoot their line boxes; the canvas
  // shifts top-aligned text up and bottom-aligned text down by that overshoot
  // (its frame "bleed"), and middle stays put. Mirror it as a negative margin.
  const bleed = textLineBleedPadding(fontSize * maxFontSizeEm, lineHeight);
  // Letter spacing is authored in px at the authored font size; scale it the
  // same way the canvas does (`buildBoxWithAutoFit`) so auto-fit shrinking and
  // the editor's own zoom (`sceneScale`) match the render exactly.
  const autoFitScale = payload.autoFit && payload.fontSize ? baseFontSize / payload.fontSize : 1;
  const letterSpacing = (box.letterSpacing ?? 0) * autoFitScale * sceneScale;

  const activeFormatting: string[] = [];
  if (rangeStyle?.bold.value && !rangeStyle.bold.mixed) activeFormatting.push('bold');
  if (rangeStyle?.italic.value && !rangeStyle.italic.mixed) activeFormatting.push('italic');
  if (rangeStyle?.underline.value && !rangeStyle.underline.mixed) activeFormatting.push('underline');
  if (rangeStyle?.strikethrough.value && !rangeStyle.strikethrough.mixed) activeFormatting.push('strikethrough');

  const handleFormattingToggle = (value: string | string[]) => {
    const next = Array.isArray(value) ? value : [value];
    if (next.includes('bold') !== activeFormatting.includes('bold')) applyToggle({ weight: rangeStyle?.bold.value ? 400 : 700 });
    else if (next.includes('italic') !== activeFormatting.includes('italic')) applyToggle({ italic: !rangeStyle?.italic.value });
    else if (next.includes('underline') !== activeFormatting.includes('underline')) applyToggle({ underline: !rangeStyle?.underline.value });
    else if (next.includes('strikethrough') !== activeFormatting.includes('strikethrough')) applyToggle({ strikethrough: !rangeStyle?.strikethrough.value });
  };

  const activeList = rangeStyle?.listType.value ?? '';

  return (
    <>
      {!isBound ? (
        <div
          ref={toolbarRef}
          className="absolute z-20 flex items-center gap-1.5 rounded-md border border-primary bg-primary px-1.5 py-1 shadow-lg"
          style={{ left, top: Math.max(0, top + textOverflowTop - 46) }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <SegmentedControl label="Text formatting" selectionMode="multiple" value={activeFormatting} onValueChange={handleFormattingToggle}>
            <SegmentedControl.Icon value="bold" title="Bold"><Bold className="size-4" /></SegmentedControl.Icon>
            <SegmentedControl.Icon value="italic" title="Italic"><Italic className="size-4" /></SegmentedControl.Icon>
            <SegmentedControl.Icon value="underline" title="Underline"><Underline className="size-4" /></SegmentedControl.Icon>
            <SegmentedControl.Icon value="strikethrough" title="Strikethrough"><Strikethrough className="size-4" /></SegmentedControl.Icon>
          </SegmentedControl>
          <SegmentedControl
            label="List type"
            value={activeList}
            onValueChange={(value) => {
              const next = Array.isArray(value) ? value[0] ?? '' : value;
              applyListSet(next === 'bullet' ? 'bullet' : next === 'number' ? 'number' : null);
            }}
          >
            <SegmentedControl.Icon value="bullet" title="Bullet list"><List className="size-4" /></SegmentedControl.Icon>
            <SegmentedControl.Icon value="number" title="Numbered list"><ListOrdered className="size-4" /></SegmentedControl.Icon>
          </SegmentedControl>
          {/* The wrapper stops the toolbar's `onMouseDown preventDefault` (which
              protects the editor selection for the buttons) from firing on the
              field itself, so the input can still receive focus. */}
          <div onMouseDown={(event) => event.stopPropagation()}>
            <FieldInput
              type="number"
              min={1}
              ariaLabel="Font size"
              placeholder="Size"
              value={fontSizeDraft ?? fontSizeDisplay}
              wrapperClassName="w-14"
              onChange={(raw) => {
                if (fontSizePendingRef.current === null) {
                  fontSizeStartRef.current = fontSizeDisplay;
                  fontSizeRangeRef.current = range;
                }
                fontSizePendingRef.current = raw;
                setFontSizeDraft(raw);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  // Abandon the field draft without writing it, then cancel the
                  // editor exactly as Escape on the editor body does — never
                  // leave the user stuck inside the field.
                  event.preventDefault();
                  fontSizePendingRef.current = null;
                  setFontSizeDraft(null);
                  committedRef.current = true;
                  onCancel();
                  return;
                }
                if (event.key === 'Enter') {
                  // Commit before blurring: commitFontSizeDraft clears the
                  // pending ref, so the blur it triggers is a no-op rather than
                  // a second apply.
                  event.preventDefault();
                  commitFontSizeDraft();
                  (event.target as HTMLInputElement).blur();
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  // A step is a complete edit: apply immediately. Suppress the
                  // native number-input step/change so only this one mechanism
                  // handles the keypress.
                  event.preventDefault();
                  const base = Number(fontSizePendingRef.current ?? fontSizeDisplay);
                  if (Number.isFinite(base)) {
                    const stepped = Math.max(1, Math.round(base) + (event.key === 'ArrowUp' ? 1 : -1));
                    applyFontSize(String(stepped));
                    fontSizePendingRef.current = String(stepped);
                    fontSizeStartRef.current = String(stepped);
                    fontSizeRangeRef.current = range;
                    setFontSizeDraft(String(stepped));
                  }
                }
              }}
              onBlur={commitFontSizeDraft}
            />
          </div>
          <div className="w-28">
            <ColorPicker
              showAlpha={false}
              value={rangeStyle?.color.mixed ? (box.color ?? '#ffffff') : rangeStyle?.color.value ?? box.color ?? '#ffffff'}
              onChange={(color) => applyToggle({ color })}
            />
          </div>
        </div>
      ) : null}
      <div
        ref={frameRef}
        data-testid="inline-text-editor-frame"
        className="absolute z-10 flex flex-col"
        onMouseDown={handleFrameMouseDown}
        style={{
          left,
          top,
          width,
          height,
          justifyContent: JUSTIFY_FOR_VERTICAL_ALIGN[verticalAlign],
          overflow: 'visible',
          opacity: element.opacity,
          // `outline` never participates in the box model, so the selection
          // indicator cannot shift the text; -2px keeps it inside the frame edge.
          outline: '2px solid #4DA3FF',
          outlineOffset: '-2px',
          transform: frameTransform(element, payload, width, height),
          transformOrigin: 'top left',
        }}
      >
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-multiline="true"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; handleInput(); }}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className="rt-editor bg-transparent outline-none"
          style={{
            flex: 'none',
            width: '100%',
            boxSizing: 'border-box',
            margin: 0,
            padding: 0,
            marginTop: verticalAlign === 'top' && bleed > 0 ? -bleed : undefined,
            marginBottom: verticalAlign === 'bottom' && bleed > 0 ? -bleed : undefined,
            fontSize,
            lineHeight,
            letterSpacing: letterSpacing !== 0 ? `${letterSpacing}px` : undefined,
            fontFamily: box.fontFamily,
            fontWeight: box.weight,
            fontStyle: box.italic ? 'italic' : 'normal',
            color: box.color,
            textAlign,
            textTransform: payload.caseTransform === 'uppercase' ? 'uppercase' : 'none',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
            ...textStrokeStyle(payload, sceneScale),
            ...textShadowStyle(payload, sceneScale),
          }}
        />
      </div>
    </>
  );
}
