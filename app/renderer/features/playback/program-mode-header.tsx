import { useWorkbench } from '../../contexts/workbench-context';
import { ReacstButton } from '@renderer/components/controls/button';
import { LumaCastPanel } from '@renderer/components/layout/panel';
import { RectangleHorizontal, LayoutGrid } from 'lucide-react';
import { SingleSurfacePicker } from './single-surface-picker';
import { GridDensityControl } from './grid-density-control';

// Program header that owns the single/all view toggle. The per-mode controls
// are explicit variants so each tree owns its own state shape.
export function ProgramModeHeader() {
  const {
    state: { programMode },
    actions: { setProgramMode },
  } = useWorkbench();

  function handleModeToggle() {
    setProgramMode(programMode === 'single' ? 'all' : 'single');
  }

  return (
    <LumaCastPanel.GroupTitle>
      <ReacstButton.Icon
        variant="ghost"
        label={programMode === 'single' ? 'Switch to all program views' : 'Switch to single program view'}
        onClick={handleModeToggle}
      >
        {programMode === 'single' ? <RectangleHorizontal /> : <LayoutGrid />}
      </ReacstButton.Icon>
      {programMode === 'single' ? <SingleSurfacePicker /> : <GridDensityControl />}
    </LumaCastPanel.GroupTitle>
  );
}
