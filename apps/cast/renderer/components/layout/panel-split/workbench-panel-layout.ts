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
