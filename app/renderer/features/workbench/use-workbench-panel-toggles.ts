import { useMemo } from 'react';
import type { PaneId, SplitId } from '@renderer/components/layout/panel-split/workbench-panel-layout';
import { usePanelRoute } from '@renderer/components/layout/panel-split/split-panel';
import { type PanelToggleButton } from './app-toolbar';
import { useWorkbench } from '../../contexts/workbench-context';
import type { WorkbenchMode } from '../../types/ui';

interface PanelToggleConfig {
  id: PanelToggleButton['id'];
  label: string;
  paneId: PaneId;
  splitId: SplitId;
}

const PANEL_TOGGLE_CONFIGS: Record<WorkbenchMode, PanelToggleConfig[]> = {
  show: [
    { id: 'left', label: 'Left', splitId: 'show-main', paneId: 'show-left' },
    { id: 'bottom', label: 'Bottom', splitId: 'show-center', paneId: 'show-bottom' },
    { id: 'right', label: 'Right', splitId: 'show-main', paneId: 'show-right' },
  ],
  'deck-editor': [
    { id: 'left', label: 'Left', splitId: 'edit-main', paneId: 'edit-left' },
    { id: 'bottom', label: 'Bottom', splitId: 'edit-center', paneId: 'edit-bottom' },
    { id: 'right', label: 'Right', splitId: 'edit-main', paneId: 'edit-right' },
  ],
  'overlay-editor': [
    { id: 'left', label: 'Left', splitId: 'editor-main', paneId: 'editor-left' },
    { id: 'right', label: 'Right', splitId: 'editor-main', paneId: 'editor-right' },
  ],
  'theme-editor': [
    { id: 'left', label: 'Left', splitId: 'editor-main', paneId: 'editor-left' },
    { id: 'right', label: 'Right', splitId: 'editor-main', paneId: 'editor-right' },
  ],
  'stage-editor': [
    { id: 'left', label: 'Left', splitId: 'editor-main', paneId: 'editor-left' },
    { id: 'right', label: 'Right', splitId: 'editor-main', paneId: 'editor-right' },
  ],
  settings: [],
};

export function useWorkbenchPanelToggles(): PanelToggleButton[] {
  const {
    state: { workbenchMode },
  } = useWorkbench();
  const panelRoute = usePanelRoute();

  return useMemo(() => {
    return PANEL_TOGGLE_CONFIGS[workbenchMode].map((toggle) => ({
      id: toggle.id,
      label: toggle.label,
      active: panelRoute.meta.isPanelVisible(toggle.splitId, toggle.paneId),
      onToggle: () => {
        panelRoute.actions.togglePanel(toggle.splitId, toggle.paneId);
      },
    }));
  }, [panelRoute.actions, panelRoute.meta, workbenchMode]);
}
