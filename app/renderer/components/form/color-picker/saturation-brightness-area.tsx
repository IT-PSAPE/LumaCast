import { clamp } from '../../../utils/math';
import { hsbToHex, hueToHex, type Hsb } from '../../../utils/color';
import { usePointerCapture } from './use-pointer-capture';

interface SaturationBrightnessAreaProps {
  hsb: Hsb;
  onChange: (hsb: Hsb) => void;
}

const ARROW_STEP = 1;
const LARGE_STEP = 10;

export function SaturationBrightnessArea({ hsb, onChange }: SaturationBrightnessAreaProps) {
  const { ref, handlePointerDown, handlePointerMove, handlePointerUp } = usePointerCapture((event) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    onChange({ h: hsb.h, s: Math.round(x * 100), b: Math.round((1 - y) * 100) });
  });

  // No Base UI equivalent exists for a 2D pointer area, so this stays a plain
  // div driven by use-pointer-capture — but it still needs to be usable from
  // a keyboard: arrow keys nudge one axis each, Home/End and PageUp/PageDown
  // jump saturation/brightness to their extremes, matching the single-axis
  // conventions of Slider (which this composes alongside for hue/alpha).
  function handleKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? LARGE_STEP : ARROW_STEP;
    let { s, b } = hsb;
    switch (event.key) {
      case 'ArrowLeft': s = clamp(s - step, 0, 100); break;
      case 'ArrowRight': s = clamp(s + step, 0, 100); break;
      case 'ArrowUp': b = clamp(b + step, 0, 100); break;
      case 'ArrowDown': b = clamp(b - step, 0, 100); break;
      case 'Home': s = 0; break;
      case 'End': s = 100; break;
      case 'PageUp': b = 100; break;
      case 'PageDown': b = 0; break;
      default: return;
    }
    event.preventDefault();
    onChange({ h: hsb.h, s, b });
  }

  const hueColor = hueToHex(hsb.h);
  const thumbX = `${hsb.s}%`;
  const thumbY = `${100 - hsb.b}%`;

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Color saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={hsb.s}
      aria-valuetext={`Saturation ${hsb.s}%, brightness ${hsb.b}%`}
      className="relative mb-2 h-36 w-full cursor-crosshair rounded select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-brand"
      style={{ backgroundColor: hueColor }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
    >
      <div className="pointer-events-none absolute inset-0 rounded" style={{ background: 'linear-gradient(to right, white, transparent)' }} />
      <div className="pointer-events-none absolute inset-0 rounded" style={{ background: 'linear-gradient(to bottom, transparent, black)' }} />
      <div
        className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
        style={{ left: thumbX, top: thumbY, backgroundColor: hsbToHex(hsb) }}
      />
    </div>
  );
}
