import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { MediaAsset, SlideBackground, SlideBackgroundFit, SlideGradient } from '@core/types';
import { ColorPicker } from '@renderer/components/form/color-picker';
import { FieldInput, FieldSelect } from '@renderer/components/form/field';
import { ReacstButton } from '@renderer/components/controls/button';
import { MediaPickerDialog, type MediaPickerAssetKind } from '@renderer/components/overlays/media-picker-dialog';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { Label } from '@renderer/components/display/text';
import { parseNumber } from '@renderer/utils/slides';
import { Section } from './inspector-section';

type BackgroundKind = 'none' | 'color' | 'gradient' | 'image' | 'video';

const TYPE_OPTIONS: Array<{ value: BackgroundKind; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'color', label: 'Solid color' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
];

const FIT_OPTIONS: Array<{ value: SlideBackgroundFit; label: string }> = [
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' },
  { value: 'fill', label: 'Fill / Stretch' },
];

const GRADIENT_KIND_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
];

const DEFAULT_GRADIENT: SlideGradient = {
  kind: 'linear',
  angle: 90,
  stops: [
    { color: '#000000FF', position: 0 },
    { color: '#FFFFFFFF', position: 100 },
  ],
};

interface BackgroundControlsProps {
  title: string;
  background: SlideBackground | null;
  onChange: (next: SlideBackground | null) => void;
}

// Shared background editor used by the slide, theme, overlay and stage
// inspectors. The owner decides how `onChange` persists.
export function BackgroundControls({ title, background, onChange }: BackgroundControlsProps) {
  const { mediaAssets } = useProjectContent();
  const { importMedia } = useElements();
  const [pickerKind, setPickerKind] = useState<MediaPickerAssetKind | null>(null);

  const kind: BackgroundKind = background?.type ?? 'none';

  function handleKindChange(value: string) {
    const nextKind = value as BackgroundKind;
    if (nextKind === kind) return;
    if (nextKind === 'none') return onChange(null);
    if (nextKind === 'color') return onChange({ type: 'color', color: background?.type === 'color' ? background.color : '#000000FF' });
    if (nextKind === 'gradient') return onChange({ type: 'gradient', gradient: background?.type === 'gradient' ? background.gradient : DEFAULT_GRADIENT });
    setPickerKind(nextKind === 'image' ? 'image' : 'video');
  }

  function handleMediaConfirm(selected: MediaAsset[]) {
    const asset = selected[0];
    const wantKind = pickerKind;
    setPickerKind(null);
    if (!asset || !wantKind) return;
    const fit: SlideBackgroundFit = (background?.type === 'image' || background?.type === 'video') ? background.fit : 'cover';
    onChange({ type: wantKind, mediaAssetId: asset.id, src: asset.src, fit });
  }

  function updateGradient(patch: Partial<SlideGradient>) {
    if (background?.type !== 'gradient') return;
    onChange({ type: 'gradient', gradient: { ...background.gradient, ...patch } });
  }

  function updateStop(index: number, patch: Partial<SlideGradient['stops'][number]>) {
    if (background?.type !== 'gradient') return;
    updateGradient({ stops: background.gradient.stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)) });
  }

  function addStop() {
    if (background?.type !== 'gradient') return;
    updateGradient({ stops: [...background.gradient.stops, { color: '#FFFFFFFF', position: 50 }] });
  }

  function removeStop(index: number) {
    if (background?.type !== 'gradient' || background.gradient.stops.length <= 2) return;
    updateGradient({ stops: background.gradient.stops.filter((_, i) => i !== index) });
  }

  return (
    <Section.Root>
      <Section.Header>
        <Label.xs>{title}</Label.xs>
      </Section.Header>
      <Section.Body>
        <FieldSelect value={kind} onChange={handleKindChange} options={TYPE_OPTIONS} />

        {background?.type === 'color' ? (
          <ColorPicker value={background.color} onChange={(color) => onChange({ type: 'color', color })} />
        ) : null}

        {background?.type === 'gradient' ? (
          <>
            <Section.Row>
              <FieldSelect
                value={background.gradient.kind}
                onChange={(value) => updateGradient({ kind: value as SlideGradient['kind'] })}
                options={GRADIENT_KIND_OPTIONS}
              />
              {background.gradient.kind === 'linear' ? (
                <FieldInput
                  type="number"
                  value={background.gradient.angle ?? 0}
                  onChange={(value) => updateGradient({ angle: parseNumber(value, background.gradient.angle ?? 0) })}
                />
              ) : null}
            </Section.Row>
            {background.gradient.stops.map((stop, index) => (
              <Section.Row key={index}>
                <ColorPicker value={stop.color} onChange={(color) => updateStop(index, { color })} />
                <FieldInput
                  type="number"
                  value={stop.position}
                  onChange={(value) => updateStop(index, { position: Math.min(100, Math.max(0, parseNumber(value, stop.position))) })}
                />
                <ReacstButton.Icon
                  label="Remove stop"
                  onClick={() => removeStop(index)}
                  disabled={background.gradient.stops.length <= 2}
                >
                  <Trash2 size={14} />
                </ReacstButton.Icon>
              </Section.Row>
            ))}
            <ReacstButton onClick={addStop}>
              <Plus size={14} /> Add stop
            </ReacstButton>
          </>
        ) : null}

        {background?.type === 'image' || background?.type === 'video' ? (
          <>
            <FieldSelect
              value={background.fit}
              onChange={(value) => onChange({ ...background, fit: value as SlideBackgroundFit })}
              options={FIT_OPTIONS}
            />
            <ReacstButton onClick={() => setPickerKind(background.type === 'image' ? 'image' : 'video')}>
              Replace {background.type}…
            </ReacstButton>
          </>
        ) : null}
      </Section.Body>

      {pickerKind ? (
        <MediaPickerDialog
          assets={mediaAssets}
          kind={pickerKind}
          onConfirm={handleMediaConfirm}
          onClose={() => setPickerKind(null)}
          onImportAssets={importMedia}
        />
      ) : null}
    </Section.Root>
  );
}
