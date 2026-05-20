import type { TextCaseTransform, TextElementPayload, TextHorizontalAlign, TextVerticalAlign } from '@core/types';
import { applyTextVisualPayload, readTextFormatting, readTextVisualPayload, type TextFormattingState, type TextVisualState } from '@core/element-payload';
import { parseNumber } from '../../utils/slides';
import { useElements } from '../../contexts/canvas/canvas-context';
import { useSystemFonts } from './use-system-fonts';
import type { CSSProperties } from 'react';

interface FontOption {
  value: string;
  label: string;
  style: CSSProperties;
}

interface TextInspectorState {
  textPayload: TextElementPayload;
  formatting: TextFormattingState;
  textVisual: TextVisualState;
  isBold: boolean;
  activeFormattingStyles: string[];
  fontOptions: FontOption[];
}

interface TextInspectorActions {
  handleTextChange: (value: string) => void;
  handleFontFamilyChange: (value: string) => void;
  handleWeightChange: (value: string) => void;
  handleFontSizeChange: (value: string) => void;
  handleAutoFitToggle: (enabled: boolean) => void;
  handleMaxFontSizeChange: (value: string) => void;
  handleLineHeightChange: (value: string) => void;
  handleTextColorChange: (value: string) => void;
  handleCaseChange: (value: string) => void;
  handleTextStyleToggle: (value: string | string[]) => void;
  handleVerticalAlighmentChange: (value: string | string[]) => void;
  handleHorizontalAlighmentChange: (value: string | string[]) => void;
  updateTextVisual: (patch: Partial<TextVisualState>) => void;
}

export type TextInspectorResult = { state: TextInspectorState; actions: TextInspectorActions } | null;

export function useTextInspector(): TextInspectorResult {
  const { selectedElement, elementPayloadDraft, setElementPayloadDraft } = useElements();
  const activeFont = selectedElement?.type === 'text' && elementPayloadDraft ? (elementPayloadDraft as TextElementPayload).fontFamily : '';
  const fontOptions = useSystemFonts(activeFont);

  if (!selectedElement || !elementPayloadDraft) return null;
  if (selectedElement.type !== 'text') return null;

  const textPayload = elementPayloadDraft as TextElementPayload;
  const formatting = readTextFormatting(textPayload);
  const textVisual = readTextVisualPayload(textPayload);
  const isBold = Number.parseInt(formatting.weight, 10) >= 600;

  function updateText(patch: Partial<TextElementPayload>) { setElementPayloadDraft({ ...textPayload, ...patch }); }
  function updateTextVisual(patch: Partial<TextVisualState>) {
    const nextVisual = { ...readTextVisualPayload(textPayload), ...patch };
    setElementPayloadDraft(applyTextVisualPayload(textPayload, nextVisual));
  }

  function handleTextChange(value: string) { updateText({ text: value }); }
  function handleFontFamilyChange(value: string) { updateText({ fontFamily: value }); }
  function handleWeightChange(value: string) { updateText({ weight: value }); }
  function handleFontSizeChange(value: string) { updateText({ fontSize: Math.max(1, parseNumber(value, formatting.fontSize)) }); }
  function handleAutoFitToggle(enabled: boolean) {
    if (enabled) updateText({ autoFit: true, autoFitMaxFontSize: textPayload.autoFitMaxFontSize ?? formatting.fontSize });
    else updateText({ autoFit: false });
  }
  function handleMaxFontSizeChange(value: string) { updateText({ autoFitMaxFontSize: Math.max(1, parseNumber(value, formatting.autoFitMaxFontSize)) }); }
  function handleLineHeightChange(value: string) { updateText({ lineHeight: Math.max(0.6, parseNumber(value, formatting.lineHeight)) }); }
  function handleTextColorChange(value: string) { updateTextVisual({ color: value }); }
  function handleCaseChange(value: string) { updateText({ caseTransform: value as TextCaseTransform }); }

  function handleBoldToggle() { updateText({ weight: isBold ? '400' : '700' }); }
  function handleItalicToggle() { updateText({ italic: !formatting.italic }); }
  function handleUnderlineToggle() { updateText({ underline: !formatting.underline }); }
  function handleStrikeToggle() { updateText({ strikethrough: !formatting.strikethrough }); }

  function handleVerticalAlighmentChange(value: string | string[]) {
    if (Array.isArray(value)) return;
    updateText({ verticalAlign: value as TextVerticalAlign });
  }

  function handleHorizontalAlighmentChange(value: string | string[]) {
    if (Array.isArray(value)) return;
    updateText({ alignment: value as TextHorizontalAlign });
  }

  const activeFormattingStyles: string[] = [];
  if (isBold) activeFormattingStyles.push('bold');
  if (formatting.italic) activeFormattingStyles.push('italic');
  if (formatting.underline) activeFormattingStyles.push('underline');
  if (formatting.strikethrough) activeFormattingStyles.push('strikethrough');

  function handleTextStyleToggle(value: string | string[]) {
    const next = Array.isArray(value) ? value : [value];
    const wasBold = isBold;
    const nowBold = next.includes('bold');
    if (wasBold !== nowBold) handleBoldToggle();

    const wasItalic = formatting.italic;
    const nowItalic = next.includes('italic');
    if (wasItalic !== nowItalic) handleItalicToggle();

    const wasUnderline = formatting.underline;
    const nowUnderline = next.includes('underline');
    if (wasUnderline !== nowUnderline) handleUnderlineToggle();

    const wasStrike = formatting.strikethrough;
    const nowStrike = next.includes('strikethrough');
    if (wasStrike !== nowStrike) handleStrikeToggle();
  }

  return {
    state: { textPayload, formatting, textVisual, isBold, activeFormattingStyles, fontOptions },
    actions: {
      handleTextChange,
      handleFontFamilyChange,
      handleWeightChange,
      handleFontSizeChange,
      handleAutoFitToggle,
      handleMaxFontSizeChange,
      handleLineHeightChange,
      handleTextColorChange,
      handleCaseChange,
      handleTextStyleToggle,
      handleVerticalAlighmentChange,
      handleHorizontalAlighmentChange,
      updateTextVisual,
    },
  };
}
