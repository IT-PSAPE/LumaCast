import { Slider } from '@base-ui/react/slider';
import { hsbToHex, type Hsb } from '../../../utils/color';

interface AlphaSliderProps {
  hsb: Hsb;
  alpha: number;
  onChange: (a: number) => void;
}

export function AlphaSlider({ hsb, alpha, onChange }: AlphaSliderProps) {
  const solidHex = hsbToHex(hsb);

  function handleValueChange(value: number | number[]) {
    onChange(typeof value === 'number' ? value : value[0]);
  }

  return (
    <Slider.Root value={alpha} min={0} max={100} step={1} onValueChange={handleValueChange} className="mb-2">
      <Slider.Control className="relative flex h-3 w-full cursor-pointer touch-none items-center select-none">
        <Slider.Track
          className="h-3 w-full rounded-full select-none"
          style={{
            backgroundImage: `linear-gradient(to right, transparent, ${solidHex}), repeating-conic-gradient(#ccc 0% 25%, white 0% 50%)`,
            backgroundSize: '100% 100%, 8px 8px',
          }}
        >
          <Slider.Thumb
            aria-label="Alpha"
            getAriaValueText={(_, value) => `Alpha ${Math.round(value)} percent`}
            className="size-3.5 rounded-full border-2 border-white shadow has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand"
            style={{ backgroundColor: solidHex }}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
