import { useWorkbench } from '../../contexts/workbench-context';
import { DropdownMenu } from '@lumacast/ui';
import { ChevronDown } from 'lucide-react';
import type { ProgramSurfaceKind } from '../../types/ui';
import { SURFACE_LABELS, SURFACE_ORDER } from './surface-constants';

// Surface picker shown in the program header when in single-view mode. It names
// the one surface the rest of the panel drives.
export function SingleSurfacePicker() {
  const {
    state: { programSingleSurface },
    actions: { setProgramSingleSurface },
  } = useWorkbench();

  function handleSurfacePick(surface: ProgramSurfaceKind) {
    setProgramSingleSurface(surface);
  }

  return (
    <DropdownMenu
      align="end"
      trigger={(
        <button type="button" className="ml-auto flex min-w-0 items-center gap-1 rounded-control bg-tertiary px-2 py-1 text-sm text-primary transition-colors hover:bg-tertiary">
          <span className="truncate">{SURFACE_LABELS[programSingleSurface]}</span>
          <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
        </button>
      )}
      entries={SURFACE_ORDER.map((kind) => ({ id: kind, label: SURFACE_LABELS[kind], onSelect: () => handleSurfacePick(kind) }))}
    />
  );
}
