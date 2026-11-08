import { Slider } from '@base-ui/react/slider';
import { cn, useSliderInteraction } from '@lumacast/ui';
import { hueToHex } from '../../../utils/color';

interface HueSliderProps {
  hue: number;
  onChange: (h: number) => void;
}

export function HueSlider({ hue, onChange }: HueSliderProps) {
  const interaction = useSliderInteraction({ value: hue, min: 0, max: 360, step: 1, onValueChange: onChange, focusRing: 'outside' });

  return (
    <Slider.Root className="mb-2" {...interaction.rootProps}>
      <Slider.Control className="relative flex h-3 w-full cursor-pointer touch-none items-center select-none" {...interaction.controlProps}>
        <Slider.Track
          ref={interaction.measurementRef}
          className="h-3 w-full rounded-full select-none"
          style={{ background: 'linear-gradient(to right, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)' }}
        >
          <Slider.Thumb
            aria-label="Hue"
            getAriaValueText={(_, value) => `Hue ${Math.round(value)} degrees`}
            className={cn('size-3.5 rounded-full border-2 border-white shadow', interaction.focusClassName)}
            style={{ backgroundColor: hueToHex(hue) }}
            {...interaction.thumbProps}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
