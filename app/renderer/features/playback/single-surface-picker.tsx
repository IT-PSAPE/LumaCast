import { useWorkbench } from '../../contexts/workbench-context';
import { Dropdown } from '../../components/form/dropdown';
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
    <Dropdown className="ml-auto">
      <Dropdown.Trigger className="flex min-w-0 items-center gap-1 rounded-sm bg-tertiary px-2 py-1 text-sm text-primary transition-colors hover:bg-quaternary">
        <span className="truncate">{SURFACE_LABELS[programSingleSurface]}</span>
        <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
      </Dropdown.Trigger>
      <Dropdown.Panel placement="bottom-end">
        {SURFACE_ORDER.map((kind) => (
          <Dropdown.Item key={kind} onClick={() => handleSurfacePick(kind)}>
            {SURFACE_LABELS[kind]}
          </Dropdown.Item>
        ))}
      </Dropdown.Panel>
    </Dropdown>
  );
}
