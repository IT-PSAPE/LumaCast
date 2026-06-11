import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SlideElement, TextElementPayload } from '@core/types';
import type { RichBody, RichBlock, RichRun } from '@core/rich-text/types';
import type { RichBoxStyle } from '@core/rich-text/resolve';
import { boxStyleFromPayload, coerceWeight, resolveRun, synthesizePlain } from '@core/rich-text/resolve';
import { richBodyToText } from '@core/rich-text/serialize';
import { applyRunStyle, resolveRangeStyle, setListType } from '@core/rich-text/edit';
import type { RichPosition, RichRange } from '@core/rich-text/edit';
import { Bold, Italic, List, ListOrdered, Strikethrough, Underline } from 'lucide-react';
import { SegmentedControl } from '@renderer/components/controls/segmented-control';
import { ColorPicker } from '@renderer/components/form/color-picker';
import { resolveInlineTextAlign } from './inline-text-editor-utils';
import { computeAutoFitFontSize } from './text-layout';

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

// ── Model ⇄ contentEditable DOM ──────────────────────────────
// Runs carry their overrides on data-* attributes so the DOM serializes back to
// the model exactly; the visible styling is the resolved inline style. Blocks are
// <div>s; list markers are CSS ::before content (never part of the editable text).

const LIST_STYLE_ID = 'rich-text-editor-list-style';

function ensureListStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(LIST_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LIST_STYLE_ID;
  style.textContent = [
    '.rt-block{min-height:1em;}',
    '.rt-bullet{padding-left:1.2em;}',
    '.rt-bullet::before{content:"• ";margin-left:-1.2em;display:inline-block;width:1.2em;}',
    '.rt-number{padding-left:1.6em;counter-increment:rt-counter;}',
    '.rt-number::before{content:counter(rt-counter) ". ";margin-left:-1.6em;display:inline-block;width:1.6em;}',
    // The editor's text is transparent (the canvas is the single render path), so a
    // solid native selection band would hide the canvas text it sits over. A
    // translucent highlight lets the real text show through, giving a natural
    // drag-to-select look across one or many blocks.
    '.rt-editor::selection{background:rgba(77,163,255,0.35);}',
    '.rt-editor ::selection{background:rgba(77,163,255,0.35);}',
  ].join('');
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function runSpanHtml(run: RichRun, box: RichBoxStyle): string {
  const resolved = resolveRun(run, box);
  // Only weight/style affect layout (and thus caret/selection geometry). Color and
  // decorations are intentionally omitted: the canvas draws the visible text, and
  // the editor's own text is transparent — this is the single render path.
  const style = [
    `font-weight:${resolved.weight}`,
    `font-style:${resolved.italic ? 'italic' : 'normal'}`,
  ].join(';');
  const data: string[] = [];
  if (run.color !== undefined) data.push(`data-c="${escapeHtml(run.color)}"`);
  if (run.weight !== undefined) data.push(`data-w="${run.weight}"`);
  if (run.italic !== undefined) data.push(`data-i="${run.italic ? 1 : 0}"`);
  if (run.underline !== undefined) data.push(`data-u="${run.underline ? 1 : 0}"`);
  if (run.strikethrough !== undefined) data.push(`data-s="${run.strikethrough ? 1 : 0}"`);
  return `<span style="${style}" ${data.join(' ')}>${escapeHtml(run.text)}</span>`;
}

export function bodyToHtml(body: RichBody, box: RichBoxStyle): string {
  return body
    .map((block) => {
      const classes = ['rt-block'];
      if (block.listType === 'bullet') classes.push('rt-bullet');
      if (block.listType === 'number') classes.push('rt-number');
      const inner = block.runs.some((run) => run.text.length > 0)
        ? block.runs.map((run) => runSpanHtml(run, box)).join('')
        : '<br>';
      return `<div class="${classes.join(' ')}" data-block>${inner}</div>`;
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
      && last.underline === next.underline && last.strikethrough === next.strikethrough;
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

// Caret (block, offset) ⇄ DOM, using Range.toString() length so ::before markers
// and element/text containers are all handled by the browser's own counting.
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

function readRange(root: HTMLElement): RichRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const domRange = selection.getRangeAt(0);
  if (!root.contains(domRange.startContainer) || !root.contains(domRange.endContainer)) return null;
  return {
    start: positionOf(root, domRange.startContainer, domRange.startOffset),
    end: positionOf(root, domRange.endContainer, domRange.endOffset),
  };
}

function placeCaret(root: HTMLElement, position: RichPosition): void {
  const blockEl = root.children[position.block] as HTMLElement | undefined;
  if (!blockEl) return;
  const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
  let remaining = position.offset;
  let lastText: Text | null = null;
  let node = walker.nextNode() as Text | null;
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  while (node) {
    lastText = node;
    const length = node.textContent?.length ?? 0;
    if (remaining <= length) {
      range.setStart(node, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    remaining -= length;
    node = walker.nextNode() as Text | null;
  }
  if (lastText) range.setStart(lastText, lastText.textContent?.length ?? 0);
  else range.setStart(blockEl, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function placeRange(root: HTMLElement, richRange: RichRange): void {
  const selection = window.getSelection();
  if (!selection) return;
  placeCaret(root, richRange.start);
  const startRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  placeCaret(root, richRange.end);
  const endRange = selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  if (startRange && endRange) {
    const range = document.createRange();
    range.setStart(startRange.startContainer, startRange.startOffset);
    range.setEnd(endRange.startContainer, endRange.startOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  }
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

export function InlineTextEditor({ editingTextId, effectiveElements, sceneOffsetX, sceneOffsetY, sceneScale, onCommit, onCancel, onLiveChange }: InlineTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<RichBody>([]);
  const composingRef = useRef(false);
  const committedRef = useRef(false);
  const [range, setRange] = useState<RichRange | null>(null);
  const [version, setVersion] = useState(0);

  const element = effectiveElements.find((el) => el.id === editingTextId);
  const payload = element?.type === 'text' ? (element.payload as unknown as TextElementPayload) : null;
  const isBound = Boolean(payload?.binding);

  const box = useMemo<RichBoxStyle>(() => (payload ? boxStyleFromPayload(payload) : ({} as RichBoxStyle)), [payload]);

  const setBody = useCallback((next: RichBody) => {
    bodyRef.current = next;
  }, []);

  // Re-render the DOM from the model and restore the caret. Used for structural
  // edits (style apply, list toggle, Enter) — NOT for plain typing.
  const renderBody = useCallback((next: RichBody, caret: RichRange | null) => {
    const root = editorRef.current;
    if (!root) return;
    setBody(next);
    root.innerHTML = bodyToHtml(next, box);
    if (caret) placeRange(root, caret);
    onLiveChange?.(next);
    setVersion((value) => value + 1);
  }, [box, setBody, onLiveChange]);

  // Mount: seed the draft from the model and focus.
  useEffect(() => {
    const root = editorRef.current;
    if (!root || !payload) return;
    ensureListStyle();
    const initial = payload.format === 'rich' && payload.richBody && payload.richBody.length > 0
      ? payload.richBody
      : synthesizePlain(payload);
    setBody(initial);
    committedRef.current = false;
    root.innerHTML = bodyToHtml(initial, box);
    requestAnimationFrame(() => {
      root.focus();
      const selection = window.getSelection();
      if (selection) selection.selectAllChildren(root);
      setRange(readRange(root));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextId]);

  const syncRange = useCallback(() => {
    const root = editorRef.current;
    if (root) setRange(readRange(root));
  }, []);

  const handleInput = useCallback(() => {
    if (composingRef.current) return;
    const root = editorRef.current;
    if (!root) return;
    const next = domToBody(root);
    setBody(next);
    onLiveChange?.(next);
    syncRange();
  }, [setBody, onLiveChange, syncRange]);

  const commit = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(bodyRef.current);
  }, [onCommit]);

  // A blur caused by interacting with the toolbar or its (portaled) ColorPicker
  // popover must not commit/close the editor. The container's onMouseDown
  // preventDefault covers in-toolbar buttons, but the popover panel is rendered
  // in a portal outside it, so detect that case here and keep the editor open.
  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (next && (toolbarRef.current?.contains(next) || next.closest('[data-popover-content]'))) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (toolbarRef.current?.contains(active) || active.closest('[data-popover-content]'))) return;
    commit();
  }, [commit]);

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

  const rangeStyle = useMemo(() => {
    if (!range) return null;
    return resolveRangeStyle(bodyRef.current, range, box);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, box, version]);

  if (!element || !payload) return null;

  const lineHeight = payload.lineHeight ?? 1.25;
  const baseFontSize = payload.autoFit
    ? computeAutoFitFontSize({
        text: richBodyToText(bodyRef.current),
        width: element.width,
        height: element.height,
        fontFamily: payload.fontFamily || 'sans-serif',
        fontStyle: `${payload.italic ? 'italic ' : ''}${coerceWeight(payload.weight)}`,
        lineHeight,
        maxFontSize: payload.autoFitMaxFontSize ?? payload.fontSize,
      })
    : payload.fontSize;
  const fontSize = baseFontSize * sceneScale;
  // The input overlay sits exactly on the element bounds (the same box the
  // transformer shows), so the box never grows-then-snaps between edit and view.
  // The canvas renders the (possibly overflowing) text; the overlay only captures input.
  const left = sceneOffsetX + element.x * sceneScale;
  const top = sceneOffsetY + element.y * sceneScale;
  const width = element.width * sceneScale;
  const height = element.height * sceneScale;
  const textAlign = resolveInlineTextAlign(payload.alignment);
  const verticalAlign = payload.verticalAlign ?? 'middle';

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
          style={{ left, top: Math.max(0, top - 46) }}
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
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        onInput={handleInput}
        onKeyUp={syncRange}
        onMouseUp={syncRange}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; handleInput(); }}
        onBlur={handleBlur}
        className="rt-editor absolute z-10 overflow-visible border-2 border-[#4DA3FF] bg-transparent outline-none"
        style={{
          left,
          top,
          width,
          height,
          boxSizing: 'border-box',
          fontSize,
          lineHeight,
          fontFamily: payload.fontFamily || 'sans-serif',
          // The editor's own text is transparent — the canvas is the single render
          // path. Only the caret is visible (caretColor), and weight/style are kept
          // so the transparent text lays out where the canvas draws it. Bound text is
          // the exception: the canvas shows the resolved binding (not the editable
          // fallback), so keep that text visible to edit.
          color: isBound ? payload.color : 'transparent',
          caretColor: payload.color,
          fontWeight: box.weight,
          fontStyle: box.italic ? 'italic' : 'normal',
          textAlign,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          counterReset: 'rt-counter',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: verticalAlign === 'top' ? 'flex-start' : verticalAlign === 'bottom' ? 'flex-end' : 'center',
          transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
          transformOrigin: 'top left',
          margin: 0,
          padding: 0,
        }}
      />
    </>
  );
}
