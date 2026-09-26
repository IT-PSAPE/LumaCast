import type { ResourceDrawerViewMode } from '../../types/ui';
import { useWorkbench } from '../../contexts/workbench-context';

interface ResourceDrawerContextValue {
  drawerTab: ReturnType<typeof useWorkbench>['state']['drawerTab'];
  drawerViewMode: ResourceDrawerViewMode;
  setDrawerTab: (tab: ReturnType<typeof useWorkbench>['state']['drawerTab']) => void;
  setDrawerViewMode: (mode: ResourceDrawerViewMode) => void;
}

export function useResourceDrawer(): ResourceDrawerContextValue {
  const {
    state: { drawerTab, drawerViewModes },
    actions: { setDrawerTab, setDrawerViewMode },
  } = useWorkbench();

  return {
    drawerTab,
    drawerViewMode: drawerViewModes[drawerTab],
    setDrawerTab,
    setDrawerViewMode: (mode) => setDrawerViewMode(drawerTab, mode),
  };
}
