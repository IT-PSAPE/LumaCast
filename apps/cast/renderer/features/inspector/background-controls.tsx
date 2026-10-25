import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { MediaAsset, SlideBackground, SlideBackgroundFit, SlideGradient } from '@lumacast/composition';
import { ColorPicker } from '@renderer/components/form/color-picker';
import { FieldInput } from '@renderer/components/form/field';
import { ReacstButton, Label, Select } from '@lumacast/ui';
import { MediaPickerDialog, type MediaPickerAssetKind } from '@renderer/components/overlays/media-picker-dialog';
import { useElements } from '@renderer/contexts/canvas/canvas-context';
import { useProjectContent } from '@renderer/contexts/use-project-content';
import { parseNumber } from '@renderer/utils/slides';
import { Section } from './inspector-section';

type BackgroundKind = 'none' | 'color' | 'gradient' | 'image' | 'video';

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
    const fit: SlideBackgroundFit = wantKind === 'video'
      ? 'contain'
      : background?.type === 'image'
        ? background.fit
        : 'cover';
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
        <Select value={kind} onValueChange={handleKindChange} options={[{ value: 'none' satisfies BackgroundKind, label: 'None' }, { value: 'color' satisfies BackgroundKind, label: 'Solid color' }, { value: 'gradient' satisfies BackgroundKind, label: 'Gradient' }, { value: 'image' satisfies BackgroundKind, label: 'Image' }, { value: 'video' satisfies BackgroundKind, label: 'Video' }]} className="w-full" />

        {background?.type === 'color' ? (
          <ColorPicker value={background.color} onChange={(color) => onChange({ type: 'color', color })} />
        ) : null}

        {background?.type === 'gradient' ? (
          <>
            <Section.Row>
              <Select value={background.gradient.kind} onValueChange={(value) => updateGradient({ kind: value as SlideGradient['kind'] })} options={[{ value: 'linear' satisfies SlideGradient['kind'], label: 'Linear' }, { value: 'radial' satisfies SlideGradient['kind'], label: 'Radial' }]} className="w-full" />
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
            <Select value={background.fit} onValueChange={(value) => onChange({ ...background, fit: value as SlideBackgroundFit })} options={[{ value: 'cover' satisfies SlideBackgroundFit, label: 'Cover' }, { value: 'contain' satisfies SlideBackgroundFit, label: 'Contain' }, { value: 'fill' satisfies SlideBackgroundFit, label: 'Fill / Stretch' }]} className="w-full" />
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
