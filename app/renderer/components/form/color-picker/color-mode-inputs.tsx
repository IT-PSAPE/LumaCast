import type { Hsb, Rgb, Hsl } from '../../../utils/color';
import {
  hexToHsb, hsbToRgb, rgbToHex, rgbToHsb, rgbToHsl, hslToRgb,
} from '../../../utils/color';
import { ChevronDown } from 'lucide-react';
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

function clampInt(value: string, min: number, max: number): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
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

  function handleRgbChange(channel: keyof Rgb, value: string) {
    const n = clampInt(value, 0, 255);
    onHsbChange(rgbToHsb({ ...rgb, [channel]: n }));
  }

  function handleHsbChange(channel: keyof Hsb, value: string) {
    const max = channel === 'h' ? 360 : 100;
    onHsbChange({ ...hsb, [channel]: clampInt(value, 0, max) });
  }

  function handleHslChange(channel: keyof Hsl, value: string) {
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

  function handleAlphaInput(value: string) {
    onAlphaChange(clampInt(value, 0, 100));
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
          <SplitInput value={rgb.r} onChange={(v) => handleRgbChange('r', v)} />
          <SplitInput value={rgb.g} onChange={(v) => handleRgbChange('g', v)} />
          <SplitInput value={rgb.b} onChange={(v) => handleRgbChange('b', v)} />
        </SplitInputGroup>
      ) : null}
      {mode === 'hsb' ? (
        <SplitInputGroup>
          <SplitInput value={hsb.h} onChange={(v) => handleHsbChange('h', v)} />
          <SplitInput value={hsb.s} onChange={(v) => handleHsbChange('s', v)} />
          <SplitInput value={hsb.b} onChange={(v) => handleHsbChange('b', v)} />
        </SplitInputGroup>
      ) : null}
      {mode === 'hsl' ? (
        <SplitInputGroup>
          <SplitInput value={hsl.h} onChange={(v) => handleHslChange('h', v)} />
          <SplitInput value={hsl.s} onChange={(v) => handleHslChange('s', v)} />
          <SplitInput value={hsl.l} onChange={(v) => handleHslChange('l', v)} />
        </SplitInputGroup>
      ) : null}

      {showAlpha ? (
        <div className="flex shrink-0 items-center rounded-r bg-tertiary">
          <input
            type="number"
            value={alpha}
            onChange={(e) => handleAlphaInput(e.target.value)}
            min={0}
            max={100}
            className="w-8 min-w-0 bg-transparent py-1 text-center text-sm text-primary outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <span className="pr-1 text-sm text-tertiary">%</span>
        </div>
      ) : null}
    </div>
  );
}
