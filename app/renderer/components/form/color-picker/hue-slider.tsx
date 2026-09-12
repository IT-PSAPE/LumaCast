import { Slider } from '@base-ui/react/slider';
import { hueToHex } from '../../../utils/color';

interface HueSliderProps {
  hue: number;
  onChange: (h: number) => void;
}

export function HueSlider({ hue, onChange }: HueSliderProps) {
  function handleValueChange(value: number | number[]) {
    onChange(typeof value === 'number' ? value : value[0]);
  }

  return (
    <Slider.Root value={hue} min={0} max={360} step={1} onValueChange={handleValueChange} className="mb-2">
      <Slider.Control className="relative flex h-3 w-full cursor-pointer touch-none items-center select-none">
        <Slider.Track
          className="h-3 w-full rounded-full select-none"
          style={{ background: 'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)' }}
        >
          <Slider.Thumb
            aria-label="Hue"
            getAriaValueText={(_, value) => `Hue ${Math.round(value)} degrees`}
            className="size-3.5 rounded-full border-2 border-white shadow has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand"
            style={{ backgroundColor: hueToHex(hue) }}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
