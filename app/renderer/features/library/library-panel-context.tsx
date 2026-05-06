import { useWorkbench } from '../../contexts/workbench-context';

interface LibraryPanelContextValue {
  expandedGroupIds: string[];
  libraryPanelView: ReturnType<typeof useWorkbench>['state']['libraryPanelView'];
  setExpandedGroupIds: (groupIds: string[]) => void;
  setLibraryPanelView: (view: ReturnType<typeof useWorkbench>['state']['libraryPanelView']) => void;
}

export function useLibraryPanelState(): LibraryPanelContextValue {
  const {
    state: {
      expandedGroupIds,
      libraryPanelView,
    },
    actions: {
      setExpandedGroupIds,
      setLibraryPanelView,
    },
  } = useWorkbench();

  return {
    expandedGroupIds,
    libraryPanelView,
    setExpandedGroupIds,
    setLibraryPanelView,
  };
}
