import { ChevronDown } from 'lucide-react';
import { Checkbox } from '@renderer/components/form/checkbox';

export function AdvancedDisclosure({
  open,
  onToggle,
  extras,
  onChange,
}: {
  open: boolean;
  onToggle: () => void;
  extras: { includeAllThemes: boolean; includeOverlays: boolean; includeStages: boolean };
  onChange: (flag: 'includeAllThemes' | 'includeOverlays' | 'includeStages', value: boolean) => void;
}) {
  return (
    <div className="rounded border border-primary bg-tertiary/15">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs uppercase tracking-wide text-tertiary"
      >
        <span>Advanced</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-primary/60 px-3 py-2">
          <p className="text-xs text-tertiary">
            By default, only themes used by selected items are bundled. Toggle on to include unused workspace assets.
          </p>
          <Checkbox.Root checked={extras.includeAllThemes} onCheckedChange={(v) => onChange('includeAllThemes', v)}>
            <Checkbox.Indicator />
            <Checkbox.Label>Include all themes</Checkbox.Label>
          </Checkbox.Root>
          <Checkbox.Root checked={extras.includeOverlays} onCheckedChange={(v) => onChange('includeOverlays', v)}>
            <Checkbox.Indicator />
            <Checkbox.Label>Include overlays</Checkbox.Label>
          </Checkbox.Root>
          <Checkbox.Root checked={extras.includeStages} onCheckedChange={(v) => onChange('includeStages', v)}>
            <Checkbox.Indicator />
            <Checkbox.Label>Include page layouts (stages)</Checkbox.Label>
          </Checkbox.Root>
        </div>
      ) : null}
    </div>
  );
}
