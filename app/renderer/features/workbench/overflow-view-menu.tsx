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

export function OverflowViewMenu({ value, onSelect }: { value: WorkbenchMode; onSelect: (mode: WorkbenchMode) => void }) {
  const isActive = value === 'overlay-editor' || value === 'stage-editor' || value === 'macro-editor';

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
        <Dropdown.Item onClick={() => onSelect('overlay-editor')}>Overlay</Dropdown.Item>
        <Dropdown.Item onClick={() => onSelect('stage-editor')}>Stage</Dropdown.Item>
        <Dropdown.Item onClick={() => onSelect('macro-editor')}>Macros</Dropdown.Item>
      </Dropdown.Panel>
    </Dropdown>
  );
}
