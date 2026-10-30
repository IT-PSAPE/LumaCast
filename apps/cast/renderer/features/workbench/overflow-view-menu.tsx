import { Ellipsis } from 'lucide-react';
import type { WorkbenchMode } from '../../types/ui';
import { cv, DropdownMenu } from '@lumacast/ui';

// Matches the SegmentedControl label-segment treatment so the overflow trigger
// is indistinguishable from a real segment.
const overflowTriggerStyles = cv({
  base: 'inline-flex items-center justify-center rounded-control transition-colors px-3 py-1 label-xs',
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
    <DropdownMenu
      align="end"
      trigger={(
        <button
          type="button"
          aria-label="More views"
          aria-pressed={isActive}
          className={overflowTriggerStyles({ active: isActive })}
        >
          <Ellipsis className="size-3.5" aria-hidden="true" />
        </button>
      )}
      entries={[
        { id: 'overlay-editor', label: 'Overlay', onSelect: () => onSelect('overlay-editor') },
        { id: 'stage-editor', label: 'Stage', onSelect: () => onSelect('stage-editor') },
        { id: 'macro-editor', label: 'Macros', onSelect: () => onSelect('macro-editor') },
      ]}
    />
  );
}
