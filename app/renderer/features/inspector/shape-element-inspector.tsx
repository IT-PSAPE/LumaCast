import { cn } from '@renderer/utils/cn';
import { ColorPicker } from '../../components/form/color-picker';
import { FieldIcon, FieldInput, FieldSelect } from '../../components/form/field';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal,
  AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  CornerUpRight, Eye, FlipHorizontal2, MoveHorizontal, MoveVertical,
  RotateCcw, RulerDimensionLine, Square,
  Sun,
} from 'lucide-react';
import { IconGroup } from '@renderer/components/icon-group';
import { useShapeInspector } from './use-shape-inspector';
import { Section } from './inspector-section';
import { EmptyState } from '../../components/display/empty-state';
import type { StrokePosition } from '@lumacast/composition';
import { parseNumber } from '@renderer/utils/slides';
import { Label } from '@renderer/components/display/text';

const STROKE_POSITION_OPTIONS = [
  { value: 'inside', label: 'Inside' },
  { value: 'center', label: 'Center' },
  { value: 'outside', label: 'Outside' },
];

export function ShapeElementInspector() {
  const result = useShapeInspector();

  if (!result) {
    return <EmptyState.Root><EmptyState.Title>Select an object to edit shape properties.</EmptyState.Title></EmptyState.Root>;
  }

  const { state, actions } = result;
  const { elementDraft, visual, styleLabelPrefix, locked } = state;
  const {
    handleXChange, handleYChange, handleWChange, handleHChange,
    handleRotationChange, handleOpacityChange,
    handleAlignLeft, handleAlignCenter, handleAlignRight,
    handleAlignTop, handleAlignMiddle, handleAlignBottom,
    handleFlipX, handleFlipY, handleFillToggle, handleFillColorChange,
    updateVisual,
  } = actions;

  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', locked && 'opacity-50')} disabled={locked}>
      <Section.Root>
        <Section.Header>
          <Label.xs>Position</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <IconGroup.Root fill>
              <IconGroup.Item onClick={handleAlignLeft} title="Align left" aria-label="Align left">
                <AlignStartVertical className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item onClick={handleAlignCenter} title="Align center" aria-label="Align center">
                <AlignCenterVertical className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item onClick={handleAlignRight} title="Align right" aria-label="Align right">
                <AlignEndVertical className="size-4" />
              </IconGroup.Item>
            </IconGroup.Root>
            <IconGroup.Root fill>
              <IconGroup.Item onClick={handleAlignTop} title="Align top" aria-label="Align top">
                <AlignStartHorizontal className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item onClick={handleAlignMiddle} title="Align middle" aria-label="Align middle">
                <AlignCenterHorizontal className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item onClick={handleAlignBottom} title="Align bottom" aria-label="Align bottom">
                <AlignEndHorizontal className="size-4" />
              </IconGroup.Item>
            </IconGroup.Root>
          </Section.Row>
          <Section.Row>
            <FieldInput type="number" value={Math.round(elementDraft.x)} onChange={handleXChange}>
              <FieldIcon><MoveHorizontal size={14} /></FieldIcon>
            </FieldInput>
            <FieldInput type="number" value={Math.round(elementDraft.y)} onChange={handleYChange}>
              <FieldIcon><MoveVertical size={14} /></FieldIcon>
            </FieldInput>
          </Section.Row>
          <Section.Row>
            <FieldInput type="number" value={Math.round(elementDraft.rotation)} onChange={handleRotationChange}>
              <FieldIcon><RotateCcw size={14} /></FieldIcon>
            </FieldInput>
            <IconGroup.Root fill>
              <IconGroup.Item>
                <CornerUpRight className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item onClick={handleFlipX}>
                <FlipHorizontal2 className="size-4" />
              </IconGroup.Item>
              <IconGroup.Item onClick={handleFlipY}>
                <FlipHorizontal2 className="size-4 rotate-90" />
              </IconGroup.Item>
            </IconGroup.Root>
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Layout</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <FieldInput type="number" value={Math.round(elementDraft.width)} onChange={handleWChange}>
              <FieldIcon><MoveHorizontal size={14} /></FieldIcon>
            </FieldInput>
            <FieldInput type="number" value={Math.round(elementDraft.height)} onChange={handleHChange}>
              <FieldIcon><MoveVertical size={14} /></FieldIcon>
            </FieldInput>
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Appearance</Label.xs>
        </Section.Header>
        <Section.Body>
          <Section.Row>
            <FieldInput type="number" value={Math.round(elementDraft.opacity * 100)} onChange={handleOpacityChange} min={0} max={100} step={1}>
              <FieldIcon><Eye size={14} /></FieldIcon>
            </FieldInput>
            <FieldInput
              type="number"
              value={Math.round(visual.borderRadius)}
              onChange={(value: string) => { updateVisual({ borderRadius: Math.max(0, parseNumber(value, visual.borderRadius)) }); }}
              min={0}
              step={1}
            >
              <FieldIcon><Square size={14} /></FieldIcon>
            </FieldInput>
          </Section.Row>
        </Section.Body>
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>{`${styleLabelPrefix}Fill`}</Label.xs>
          <Section.Checkbox className='ml-auto' checked={visual.fillEnabled} onChange={handleFillToggle} />
        </Section.Header>
        {visual.fillEnabled ? (
          <Section.Body>
            <Section.Row>
              <ColorPicker value={visual.fillColor} onChange={handleFillColorChange} />
            </Section.Row>
          </Section.Body>
        ) : null}
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Text Stroke</Label.xs>
          <Section.Checkbox className='ml-auto' checked={visual.strokeEnabled} onChange={(enabled) => updateVisual({ strokeEnabled: enabled })} />
        </Section.Header>
        {visual.strokeEnabled ? (
          <Section.Body>
            <Section.Row>
              <ColorPicker value={visual.strokeColor} onChange={(value: string) => { updateVisual({ strokeColor: value }); }} />
            </Section.Row>
            <Section.Row>
              <FieldSelect value={visual.strokePosition} onChange={(value: string) => { updateVisual({ strokePosition: value as StrokePosition }); }} options={STROKE_POSITION_OPTIONS} />
              <FieldInput type="number" value={visual.strokeWidth} onChange={(value: string) => { updateVisual({ strokeWidth: Math.max(0, parseNumber(value, visual.strokeWidth)) }); }}>
                <FieldIcon><RulerDimensionLine size={14} /></FieldIcon>
              </FieldInput>
            </Section.Row>
          </Section.Body>
        ) : null}
      </Section.Root>

      <Section.Root>
        <Section.Header>
          <Label.xs>Text Shadow</Label.xs>
          <Section.Checkbox className='ml-auto' checked={visual.shadowEnabled} onChange={(enabled) => updateVisual({ shadowEnabled: enabled })} />
        </Section.Header>
        {visual.shadowEnabled ? (
          <Section.Body>
            <Section.Row>
              <FieldInput type="number" value={visual.shadowOffsetX} onChange={(value: string) => { updateVisual({ shadowOffsetX: parseNumber(value, visual.shadowOffsetX) }); }}>
                <FieldIcon><MoveHorizontal size={14} /></FieldIcon>
              </FieldInput>
              <FieldInput type="number" value={visual.shadowOffsetY} onChange={(value: string) => { updateVisual({ shadowOffsetX: parseNumber(value, visual.shadowOffsetY) }); }}>
                <FieldIcon><MoveVertical size={14} /></FieldIcon>
              </FieldInput>
            </Section.Row>
            <Section.Row>
              <FieldInput type="number" value={visual.shadowBlur} onChange={(value: string) => { updateVisual({ shadowBlur: Math.max(0, parseNumber(value, visual.shadowBlur)) }); }}>
                <FieldIcon><Sun size={14} /></FieldIcon>
              </FieldInput>
            </Section.Row>
            <Section.Row>
              <ColorPicker value={visual.shadowColor} onChange={(value: string) => { updateVisual({ shadowColor: value }); }} />
            </Section.Row>
          </Section.Body>
        ) : null}
      </Section.Root>
    </fieldset>
  );
}
