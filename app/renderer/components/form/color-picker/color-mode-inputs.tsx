import type { Hsb, Rgb, Hsl } from '../../../utils/color';
import {
  hexToHsb, hsbToRgb, rgbToHex, rgbToHsb, rgbToHsl, hslToRgb,
} from '../../../utils/color';
import { ChevronDown } from 'lucide-react';
import { Field } from '@base-ui/react/field';
import { NumberField } from '@base-ui/react/number-field';
import { Dropdown } from '../dropdown';
import { MiniHexInput } from './mini-hex-input';
import { SplitInput } from './split-input';
import { SplitInputGroup } from './split-input-group';

type ColorMode = 'hex' | 'rgb' | 'hsb' | 'hsl';

const COLOR_MODE_OPTIONS = [
  { value: 'hex', label: 'Hex' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsb', label: 'HSB' },
  { value: 'hsl', label: 'HSL' },
];

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

interface ColorModeInputsProps {
  hsb: Hsb;
  alpha: number;
  mode: ColorMode;
  showAlpha: boolean;
  onHsbChange: (hsb: Hsb) => void;
  onAlphaChange: (a: number) => void;
  onModeChange: (mode: ColorMode) => void;
}

export function ColorModeInputs({ hsb, alpha, mode, showAlpha, onHsbChange, onAlphaChange, onModeChange }: ColorModeInputsProps) {
  const rgb = hsbToRgb(hsb);
  const hsl = rgbToHsl(rgb);

  function handleModeSelect(value: string) {
    onModeChange(value as ColorMode);
  }

  function handleRgbChange(channel: keyof Rgb, value: number) {
    onHsbChange(rgbToHsb({ ...rgb, [channel]: clampInt(value, 0, 255) }));
  }

  function handleHsbChange(channel: keyof Hsb, value: number) {
    const max = channel === 'h' ? 360 : 100;
    onHsbChange({ ...hsb, [channel]: clampInt(value, 0, max) });
  }

  function handleHslChange(channel: keyof Hsl, value: number) {
    const max = channel === 'h' ? 360 : 100;
    onHsbChange(rgbToHsb(hslToRgb({ ...hsl, [channel]: clampInt(value, 0, max) })));
  }

  function handleHexCommit(value: string) {
    const raw = value.replace(/[^0-9a-fA-F]/g, '');
    if (raw.length >= 6) {
      onHsbChange(hexToHsb(`#${raw.slice(0, 6)}`));
      if (raw.length >= 8) {
        onAlphaChange(Math.round((parseInt(raw.slice(6, 8), 16) / 255) * 100));
      }
    }
  }

  function handleAlphaInput(value: number | null) {
    if (value !== null) onAlphaChange(clampInt(value, 0, 100));
  }

  return (
    <div className="flex items-stretch gap-px">
      <Dropdown className="shrink-0">
        <Dropdown.Trigger className="flex items-center py-1 rounded-sm bg-tertiary text-sm text-primary cursor-pointer">
          <span className="truncate px-1.5">{COLOR_MODE_OPTIONS.find((o) => o.value === mode)?.label}</span>
          <ChevronDown className="shrink-0 size-3.5 mr-1.5 text-tertiary" />
        </Dropdown.Trigger>
        <Dropdown.Panel>
          {COLOR_MODE_OPTIONS.map((opt) => <Dropdown.Item key={opt.value} onClick={() => handleModeSelect(opt.value)}>{opt.label}</Dropdown.Item>)}
        </Dropdown.Panel>
      </Dropdown>

      {mode === 'hex' ? <MiniHexInput value={rgbToHex(rgb)} onCommit={handleHexCommit} /> : null}
      {mode === 'rgb' ? (
        <SplitInputGroup>
          <SplitInput label="Red" value={rgb.r} min={0} max={255} onChange={(v) => handleRgbChange('r', v)} />
          <SplitInput label="Green" value={rgb.g} min={0} max={255} onChange={(v) => handleRgbChange('g', v)} />
          <SplitInput label="Blue" value={rgb.b} min={0} max={255} onChange={(v) => handleRgbChange('b', v)} />
        </SplitInputGroup>
      ) : null}
      {mode === 'hsb' ? (
        <SplitInputGroup>
          <SplitInput label="Hue" value={hsb.h} min={0} max={360} onChange={(v) => handleHsbChange('h', v)} />
          <SplitInput label="Saturation" value={hsb.s} min={0} max={100} onChange={(v) => handleHsbChange('s', v)} />
          <SplitInput label="Brightness" value={hsb.b} min={0} max={100} onChange={(v) => handleHsbChange('b', v)} />
        </SplitInputGroup>
      ) : null}
      {mode === 'hsl' ? (
        <SplitInputGroup>
          <SplitInput label="Hue" value={hsl.h} min={0} max={360} onChange={(v) => handleHslChange('h', v)} />
          <SplitInput label="Saturation" value={hsl.s} min={0} max={100} onChange={(v) => handleHslChange('s', v)} />
          <SplitInput label="Lightness" value={hsl.l} min={0} max={100} onChange={(v) => handleHslChange('l', v)} />
        </SplitInputGroup>
      ) : null}

      {showAlpha ? (
        <Field.Root className="flex shrink-0 items-center rounded-r bg-tertiary">
          <Field.Label className="sr-only">Alpha percent</Field.Label>
          <NumberField.Root value={alpha} min={0} max={100} onValueChange={handleAlphaInput}>
            <NumberField.Input className="w-8 min-w-0 bg-transparent py-1 text-center text-sm text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
          </NumberField.Root>
          <span aria-hidden="true" className="pr-1 text-sm text-tertiary">%</span>
        </Field.Root>
      ) : null}
    </div>
  );
}
