interface Props { kind: 'Audio' | 'Video'; volume: number; disabled: boolean; onChange: (volume: number) => void; }
export function VolumeControl({ kind, volume, disabled, onChange }: Props) {
  const percent = Math.round((volume ?? 1) * 100);
  return <input type="range" min={0} max={100} step={1} value={percent} disabled={disabled}
    aria-label={`${kind} volume`} aria-valuetext={`${percent}%`} title={`${percent}%`}
    onChange={(event) => onChange(Number(event.target.value) / 100)}
    className="h-5 w-16 shrink-0 accent-brand_solid disabled:opacity-40" />;
}
