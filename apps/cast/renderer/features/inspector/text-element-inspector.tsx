import type { StrokePosition, TextCaseTransform } from '@lumacast/composition';
import { cn, Checkbox, SegmentedControl, EmptyState, Label, Select, TextField } from '@lumacast/ui';
import { ColorPicker } from '../../components/form/color-picker';
import { FieldIcon, FieldInput } from '../../components/form/field';
import { useTextInspector } from './use-text-inspector';

import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight,
  AlignHorizontalSpaceBetween,
  AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, AlignVerticalJustifyStart,
  Baseline, Bold, Italic,
  MoveHorizontal,
  MoveVertical,
  Maximize2,
  RulerDimensionLine,
  Strikethrough, Sun, Type, Underline,
} from 'lucide-react';
import { Section } from './inspector-section';
import { parseNumber } from '@renderer/utils/slides';

export function TextElementInspector() {
  const result = useTextInspector();

  if (!result) {
    return <EmptyState.Root><EmptyState.Title>Select an object to edit text properties.</EmptyState.Title></EmptyState.Root>;
  }

  const { state, actions } = result;
  const { textPayload, formatting, textVisual, activeFormattingStyles, fontOptions } = state;
  const {
    handleTextChange, handleFontFamilyChange, handleWeightChange,
    handleFontSizeChange, handleAutoFitToggle, handleMaxFontSizeChange,
    handleLineHeightChange, handleLetterSpacingChange, handleTextColorChange,
    handleCaseChange, handleTextStyleToggle, handleVerticalAlighmentChange,
    handleHorizontalAlighmentChange, updateTextVisual,
  } = actions;

  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', textPayload.locked && 'opacity-50')} disabled={textPayload.locked}>
      <Section.Root>
        <Section.Header>
          <Label.xs>Content</Label.xs>
        </Section.Header>
        <Section.Body>
          <TextField value={textPayload.text} onValueChange={handleTextChange} className="w-full" />
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Typography</Label.xs>
          <div className="ml-auto flex items-center gap-1.5">
            <Label.xs>Auto-fit</Label.xs>
            <Checkbox checked={formatting.autoFit} onCheckedChange={handleAutoFitToggle} />
          </div>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <Select value={formatting.fontFamily} onValueChange={handleFontFamilyChange} options={fontOptions} className="w-full" />
            <TextField value={formatting.weight} onValueChange={handleWeightChange} className="w-full" />
          </Section.Row>
          <Section.Row>
            {formatting.autoFit ? (
              <FieldInput type="number" value={formatting.autoFitMaxFontSize} onChange={handleMaxFontSizeChange}>
                <FieldIcon><Maximize2 className="size-4" /></FieldIcon>
              </FieldInput>
            ) : (
              <FieldInput type="number" value={formatting.fontSize} onChange={handleFontSizeChange}>
                <FieldIcon><Type className="size-4" /></FieldIcon>
              </FieldInput>
            )}
            <FieldInput type="number" value={formatting.lineHeight} onChange={handleLineHeightChange}>
              <FieldIcon><Baseline className="size-4" /></FieldIcon>
            </FieldInput>
          </Section.Row>
          <Section.Row>
            <FieldInput type="number" value={formatting.letterSpacing} onChange={handleLetterSpacingChange} step={0.5} ariaLabel="Letter spacing">
              <FieldIcon><AlignHorizontalSpaceBetween className="size-4" /></FieldIcon>
            </FieldInput>
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Formatting</Label.xs>
        </Section.Header>
        <Section.Body>
          <SegmentedControl label="Text formatting" selectionMode="multiple" value={activeFormattingStyles} onValueChange={handleTextStyleToggle} className="w-full [&>button]:flex-1">
            <SegmentedControl.Icon value="bold" title="Bold" fill>
              <Bold className="size-4" />
            </SegmentedControl.Icon>
            <SegmentedControl.Icon value="italic" title="Italic" fill>
              <Italic className="size-4" />
            </SegmentedControl.Icon>
            <SegmentedControl.Icon value="underline" title="Underline" fill>
              <Underline className="size-4" />
            </SegmentedControl.Icon>
            <SegmentedControl.Icon value="strikethrough" title="Strikethrough" fill>
              <Strikethrough className="size-4" />
            </SegmentedControl.Icon>
          </SegmentedControl>
          <Section.Row>
            <Select value={formatting.caseTransform} onValueChange={handleCaseChange} options={[{ value: 'none' satisfies TextCaseTransform, label: 'None' }, { value: 'uppercase' satisfies TextCaseTransform, label: 'Uppercase' }, { value: 'sentence' satisfies TextCaseTransform, label: 'Sentence' }]} className="w-full" />
            <ColorPicker value={textVisual.color} onChange={handleTextColorChange} />
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Alignment</Label.xs>
        </Section.Header>
        <Section.Body>
          <div className="flex gap-2">
            <SegmentedControl fill className="w-full" value={formatting.alignment} onValueChange={handleHorizontalAlighmentChange} aria-label="Horizontal text alignment">
              <SegmentedControl.Icon fill value="left" title="Align left" aria-label="Align left">
                <AlignLeft className="size-4" />
              </SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="center" title="Align center" aria-label="Align center">
                <AlignCenter className="size-4" />
              </SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="right" title="Align right" aria-label="Align right">
                <AlignRight className="size-4" />
              </SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="justify" title="Justify text" aria-label="Justify text">
                <AlignJustify className="size-4" />
              </SegmentedControl.Icon>
            </SegmentedControl>

            <SegmentedControl fill className="w-full" value={formatting.verticalAlign} onValueChange={handleVerticalAlighmentChange} aria-label="Vertical text alignment">
              <SegmentedControl.Icon fill value="top" title="Align top" aria-label="Align top">
                <AlignVerticalJustifyStart className="size-4" />
              </SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="middle" title="Align middle" aria-label="Align middle">
                <AlignVerticalJustifyCenter className="size-4" />
              </SegmentedControl.Icon>
              <SegmentedControl.Icon fill value="bottom" title="Align bottom" aria-label="Align bottom">
                <AlignVerticalJustifyEnd className="size-4" />
              </SegmentedControl.Icon>
            </SegmentedControl>
          </div>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Text Stroke</Label.xs>
          <Checkbox className='ml-auto' checked={textVisual.strokeEnabled} onCheckedChange={(enabled) => updateTextVisual({ strokeEnabled: enabled })} />
        </Section.Header>
        {textVisual.strokeEnabled ? (
          <Section.Body>
            <Section.Row>
              <ColorPicker value={textVisual.strokeColor} onChange={(value: string) => { updateTextVisual({ strokeColor: value }); }} />
            </Section.Row>
            <Section.Row>
              <Select value={textVisual.strokePosition} onValueChange={(value: string) => { updateTextVisual({ strokePosition: value as StrokePosition }); }} options={[{ value: 'inside' satisfies StrokePosition, label: 'Inside' }, { value: 'center' satisfies StrokePosition, label: 'Center' }, { value: 'outside' satisfies StrokePosition, label: 'Outside' }]} className="w-full" />
              <FieldInput type="number" value={textVisual.strokeWidth} onChange={(value: string) => { updateTextVisual({ strokeWidth: Math.max(0, parseNumber(value, textVisual.strokeWidth)) }); }}>
                <FieldIcon><RulerDimensionLine size={14} /></FieldIcon>
              </FieldInput>
            </Section.Row>
          </Section.Body>
        ) : null}
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Text Shadow</Label.xs>
          <Checkbox className='ml-auto' checked={textVisual.shadowEnabled} onCheckedChange={(enabled) => updateTextVisual({ shadowEnabled: enabled })} />
        </Section.Header>
        {textVisual.shadowEnabled ? (
          <Section.Body>
            <Section.Row>
              <FieldInput type="number" value={textVisual.shadowOffsetX} onChange={(value: string) => { updateTextVisual({ shadowOffsetX: parseNumber(value, textVisual.shadowOffsetX) }); }}>
                <FieldIcon><MoveHorizontal size={14} /></FieldIcon>
              </FieldInput>
              <FieldInput type="number" value={textVisual.shadowOffsetY} onChange={(value: string) => { updateTextVisual({ shadowOffsetY: parseNumber(value, textVisual.shadowOffsetY) }); }}>
                <FieldIcon><MoveVertical size={14} /></FieldIcon>
              </FieldInput>
            </Section.Row>
            <Section.Row>
              <FieldInput type="number" value={textVisual.shadowBlur} onChange={(value: string) => { updateTextVisual({ shadowBlur: Math.max(0, parseNumber(value, textVisual.shadowBlur)) }); }}>
                <FieldIcon><Sun size={14} /></FieldIcon>
              </FieldInput>
            </Section.Row>
            <Section.Row>
              <ColorPicker value={textVisual.shadowColor} onChange={(value: string) => { updateTextVisual({ shadowColor: value }); }} />
            </Section.Row>
          </Section.Body>
        ) : null}
      </Section.Root>
    </fieldset>
  );
}
