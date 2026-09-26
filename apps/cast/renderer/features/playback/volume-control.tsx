import { Slider } from '@base-ui/react/slider';

interface Props { kind: 'Audio' | 'Video'; volume: number; disabled: boolean; onChange: (volume: number) => void; }
export function VolumeControl({ kind, volume, disabled, onChange }: Props) {
  const percent = Math.round((volume ?? 1) * 100);
  return (
    <Slider.Root
      value={percent}
      min={0}
      max={100}
      step={1}
      disabled={disabled}
      onValueChange={(next) => onChange((Array.isArray(next) ? next[0]! : next) / 100)}
      className="w-16 shrink-0 data-disabled:opacity-40"
    >
      <Slider.Control className="flex h-5 w-16 touch-none items-center">
        <Slider.Track className="h-1 w-full rounded-full bg-secondary/40">
          <Slider.Indicator className="rounded-full bg-brand" />
          <Slider.Thumb
            aria-label={`${kind} volume`}
            aria-valuetext={`${percent}%`}
            title={`${percent}%`}
            className="size-3 rounded-full bg-brand outline-none"
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
