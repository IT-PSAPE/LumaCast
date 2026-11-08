import { Slider } from '@base-ui/react/slider';
import { cn, useSliderInteraction } from '@lumacast/ui';
import { hsbToHex, type Hsb } from '../../../utils/color';

interface AlphaSliderProps {
  hsb: Hsb;
  alpha: number;
  onChange: (a: number) => void;
}

export function AlphaSlider({ hsb, alpha, onChange }: AlphaSliderProps) {
  const solidHex = hsbToHex(hsb);

  const interaction = useSliderInteraction({ value: alpha, min: 0, max: 100, step: 1, onValueChange: onChange, focusRing: 'outside' });

  return (
    <Slider.Root className="mb-2" {...interaction.rootProps}>
      <Slider.Control className="relative flex h-3 w-full cursor-pointer touch-none items-center select-none" {...interaction.controlProps}>
        <Slider.Track
          ref={interaction.measurementRef}
          className="h-3 w-full rounded-full select-none"
          style={{
            backgroundImage: `linear-gradient(to right, transparent, ${solidHex}), repeating-conic-gradient(#ccc 0% 25%, white 0% 50%)`,
            backgroundSize: '100% 100%, 8px 8px',
          }}
        >
          <Slider.Thumb
            aria-label="Alpha"
            getAriaValueText={(_, value) => `Alpha ${Math.round(value)} percent`}
            className={cn('size-3.5 rounded-full border-2 border-white shadow', interaction.focusClassName)}
            style={{ backgroundColor: solidHex }}
            {...interaction.thumbProps}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
