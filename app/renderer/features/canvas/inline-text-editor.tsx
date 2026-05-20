import { useCallback, useEffect, useRef, useState } from 'react';
import type { SlideElement, TextElementPayload } from '@core/types';
import { measureInlineTextHeight, resolveInlineTextAlign } from './inline-text-editor-utils';
import { resolveKonvaTextStyle } from './resolve-konva-text-style';
import { computeAutoFitFontSize, textLineBleedPadding, textOverflowOffset } from './text-layout';

interface InlineTextEditorProps {
  editingTextId: string;
  effectiveElements: SlideElement[];
  sceneOffsetX: number;
  sceneOffsetY: number;
  sceneScale: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

export function InlineTextEditor({ editingTextId, effectiveElements, sceneOffsetX, sceneOffsetY, sceneScale, onCommit, onCancel }: InlineTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState('');

  const element = effectiveElements.find((el) => el.id === editingTextId);
  const payload = element?.type === 'text' ? (element.payload as unknown as TextElementPayload) : null;

  useEffect(() => {
    if (!payload) return;
    const text = payload.text ?? '';
    setDraft(text);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.select();
    });
  }, [editingTextId]);

  const handleBlur = useCallback(() => {
    onCommit(draft);
  }, [draft, onCommit]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      onCommit(draft);
    }
  }, [draft, onCommit, onCancel]);

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setDraft(event.target.value);
  }

  if (!element || !payload) return null;

  const lineHeight = payload.lineHeight ?? 1.25;
  const baseFontSize = payload.autoFit
    ? computeAutoFitFontSize({
        text: draft,
        width: element.width,
        height: element.height,
        fontFamily: payload.fontFamily || 'sans-serif',
        fontStyle: resolveKonvaTextStyle(payload.weight, payload.italic),
        lineHeight,
        maxFontSize: payload.autoFitMaxFontSize ?? payload.fontSize,
      })
    : payload.fontSize;
  const fontSize = baseFontSize * sceneScale;
  const bleedPadding = textLineBleedPadding(fontSize, lineHeight);
  const elementHeight = element.height * sceneScale;
  const left = sceneOffsetX + element.x * sceneScale;
  const width = element.width * sceneScale;
  const fontWeight = payload.weight ?? '400';
  const fontStyle = payload.italic ? 'italic' : 'normal';
  const textAlign = resolveInlineTextAlign(payload.alignment);
  const verticalAlign = payload.verticalAlign ?? 'middle';
  const contentHeight = measureInlineTextHeight({
    text: draft,
    width: Math.max(width - 4, 1),
    fontSize,
    lineHeight,
    fontWeight,
    fontStyle,
    fontFamily: payload.fontFamily || 'sans-serif',
  });
  // When autoFit is on, the font is sized to fit within elementHeight, so the
  // frame must stay locked to elementHeight. Otherwise transient measurement
  // overshoot (e.g. crossing a wrap boundary) would let the frame grow and
  // then snap back as the font recomputes — visible as a typing-time jitter.
  const frameContentHeight = payload.autoFit ? elementHeight : Math.max(elementHeight, contentHeight);
  const top = sceneOffsetY + element.y * sceneScale + textOverflowOffset(verticalAlign, elementHeight, frameContentHeight) - bleedPadding;
  const height = frameContentHeight + bleedPadding * 2;
  const innerHeight = Math.max(height - 4, 0);
  const remainingVerticalSpace = Math.max(0, innerHeight - contentHeight);
  const paddingTop = verticalAlign === 'top'
    ? 0
    : verticalAlign === 'bottom'
      ? remainingVerticalSpace
      : remainingVerticalSpace / 2;

  return (
    <textarea
      ref={textareaRef}
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="absolute z-10 resize-none overflow-hidden border-2 border-[#4DA3FF] bg-transparent outline-none"
      style={{
        left,
        top,
        width,
        height,
        boxSizing: 'border-box',
        fontSize,
        lineHeight,
        fontWeight,
        fontStyle,
        fontFamily: payload.fontFamily || 'sans-serif',
        color: payload.color,
        textAlign,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: 'top left',
        paddingTop,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        margin: 0,
      }}
    />
  );
}
