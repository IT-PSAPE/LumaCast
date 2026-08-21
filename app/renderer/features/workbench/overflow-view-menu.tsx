import { Ellipsis } from 'lucide-react';
import type { WorkbenchMode } from '../../types/ui';
import { Dropdown } from '@renderer/components/form/dropdown';
import { cv } from '@renderer/utils/cv';

// Matches the SegmentedControl label-segment treatment so the overflow trigger
// is indistinguishable from a real segment.
const overflowTriggerStyles = cv({
  base: 'inline-flex items-center justify-center rounded-sm transition-colors px-3 py-1 label-xs',
  variants: {
    active: {
      true: 'bg-primary text-primary',
      false: 'text-tertiary hover:text-secondary',
    },
  },
  defaultVariants: { active: false },
});

const OVERFLOW_SCREENS: ReadonlyArray<{ label: string; mode: WorkbenchMode }> = [
  { label: 'Overlay', mode: 'overlay-editor' },
  { label: 'Stage', mode: 'stage-editor' },
  { label: 'Macros', mode: 'macro-editor' },
];

export function OverflowViewMenu({ value, onSelect }: { value: WorkbenchMode; onSelect: (mode: WorkbenchMode) => void }) {
  const isActive = OVERFLOW_SCREENS.some((screen) => screen.mode === value);

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="More views"
        aria-pressed={isActive}
        className={overflowTriggerStyles({ active: isActive })}
      >
        <Ellipsis className="size-3.5" aria-hidden="true" />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end">
        {OVERFLOW_SCREENS.map((screen) => (
          <Dropdown.Item key={screen.mode} onClick={() => onSelect(screen.mode)}>
            {screen.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Panel>
    </Dropdown>
  );
}
