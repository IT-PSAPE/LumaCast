import type { SplitLayout, SplitPaneConfig } from '@lumacast/ui';

export type SplitId = string;
export type PaneId = string;
export type PanelToggleId = 'left' | 'right' | 'bottom';

export interface PaneLayoutState {
  size: number;
  visible: boolean;
  lastVisibleSize: number;
}

export interface SplitLayoutState {
  panes: Record<PaneId, PaneLayoutState>;
}

export type WorkbenchPanelLayouts = Record<SplitId, SplitLayoutState>;

export interface SplitPaneDefinition {
  id: PaneId;
  defaultSize: number;
  minSize: number;
  maxSize: number;
  collapsible: boolean;
  snap: boolean;
}

export interface SplitDefinition {
  id: SplitId;
  orientation: 'horizontal' | 'vertical';
  paneOrder: PaneId[];
  fillPaneId: PaneId;
  panes: Record<PaneId, SplitPaneDefinition>;
}

export interface DragSessionState {
  splitId: SplitId;
  handleIndex: number;
  startPointer: number;
  rawDelta: number;
  baseLayouts: WorkbenchPanelLayouts;
}

// Adapter between the persisted cast shape ({ size, visible, lastVisibleSize })
// and the @lumacast/ui Split shape ({ size, collapsed, restoreSize }).
// Storage keeps the cast shape; conversion happens in memory only.

export function toSplitPanes(definition: SplitDefinition): SplitPaneConfig[] {
  return definition.paneOrder.map((paneId) => {
    const pane = definition.panes[paneId];
    return {
      id: paneId,
      defaultSize: pane.defaultSize,
      minSize: pane.minSize,
      maxSize: pane.maxSize,
      collapsible: pane.collapsible,
      snap: pane.snap,
      unmountWhenCollapsed: true,
      fill: paneId === definition.fillPaneId,
    };
  });
}

export function toSplitLayout(state: SplitLayoutState): SplitLayout {
  const layout: SplitLayout = {};
  for (const [paneId, pane] of Object.entries(state.panes)) {
    layout[paneId] = { size: pane.size, collapsed: !pane.visible, restoreSize: pane.lastVisibleSize };
  }
  return layout;
}

export function fromSplitLayout(layout: SplitLayout, definition: SplitDefinition): SplitLayoutState {
  const panes: Record<PaneId, PaneLayoutState> = {};
  for (const paneId of definition.paneOrder) {
    const pane = layout[paneId];
    if (pane) panes[paneId] = { size: pane.size, visible: !pane.collapsed, lastVisibleSize: pane.restoreSize };
  }
  return { panes };
}
