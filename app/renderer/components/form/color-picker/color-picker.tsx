import { useCallback, useEffect, useRef, useState } from 'react';
import { hexAlpha, hexToHsb, hsbToHex, withAlpha, type Hsb } from '../../../utils/color';
import { Popover } from '../../overlays/popover';
import { SaturationBrightnessArea } from './saturation-brightness-area';
import { HueSlider } from './hue-slider';
import { AlphaSlider } from './alpha-slider';
import { ColorModeInputs } from './color-mode-inputs';
import { HexInput } from './hex-input';

type ColorMode = 'hex' | 'rgb' | 'hsb' | 'hsl';

interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  showAlpha?: boolean;
}

export function ColorPicker({ value, onChange, showAlpha = true }: ColorPickerProps) {
  const safeValue = value && value.length >= 4 ? value : '#000000';
  const [hsb, setHsb] = useState<Hsb>(() => hexToHsb(safeValue));
  const [alpha, setAlpha] = useState(() => hexAlpha(safeValue));
  const [mode, setMode] = useState<ColorMode>('hex');
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const incoming = hexToHsb(safeValue);
    const incomingAlpha = hexAlpha(safeValue);
    setHsb((prev) => {
      if (prev.h === incoming.h && prev.s === incoming.s && prev.b === incoming.b) return prev;
      return incoming;
    });
    setAlpha(incomingAlpha);
  }, [safeValue]);

  const emit = useCallback((nextHsb: Hsb, nextAlpha: number) => {
    const hex = hsbToHex(nextHsb);
    onChange(withAlpha(hex, nextAlpha));
  }, [onChange]);

  function handleHsbChange(next: Hsb) {
    setHsb(next);
    emit(next, alpha);
  }

  function handleAlphaChange(next: number) {
    setAlpha(next);
    emit(hsb, next);
  }

  function handleToggle() {
    setIsOpen((prev) => !prev);
  }

  function handleClose() {
    setIsOpen(false);
  }

  const previewHex = hsbToHex(hsb);
  const displayAlpha = showAlpha ? alpha : 100;
  const displayHexValue = withAlpha(previewHex, displayAlpha);

  return (
    <div className="flex min-w-0 w-full items-center gap-1.5 min-h-8 rounded bg-tertiary text-sm text-primary transition-colors focus-within:border-brand">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="ml-1.5 size-5 shrink-0 overflow-hidden rounded border border-primary cursor-pointer"
        style={{
          backgroundImage: 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%)',
          backgroundSize: '8px 8px',
        }}
      >
        <span className="block size-full" style={{ backgroundColor: previewHex, opacity: displayAlpha / 100 }} />
      </button>
      <span className="text-tertiary text-sm select-none">#</span>
      <HexInput value={displayHexValue} onChange={onChange} />

      <Popover anchor={triggerRef.current} open={isOpen} onClose={handleClose} placement="bottom" className="w-56 rounded-lg border border-primary bg-primary p-2.5 shadow-lg">
        <SaturationBrightnessArea hsb={hsb} onChange={handleHsbChange} />
        <HueSlider hue={hsb.h} onChange={(h) => handleHsbChange({ ...hsb, h })} />
        {showAlpha ? <AlphaSlider hsb={hsb} alpha={alpha} onChange={handleAlphaChange} /> : null}
        <ColorModeInputs hsb={hsb} alpha={alpha} mode={mode} showAlpha={showAlpha} onHsbChange={handleHsbChange} onAlphaChange={handleAlphaChange} onModeChange={setMode} />
      </Popover>
    </div>
  );
}
