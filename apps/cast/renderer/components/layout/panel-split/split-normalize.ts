import { clamp } from '../../../utils/math';
import type { PaneId, SplitDefinition, SplitLayoutState } from './workbench-panel-layout';
import { cloneSplitLayout, requirePaneState } from './split-resize';

export function fitSplitLayoutToContainer(definition: SplitDefinition, layout: SplitLayoutState, containerSize: number): SplitLayoutState {
  if (!Number.isFinite(containerSize) || containerSize <= 0) {
    return cloneSplitLayout(layout);
  }

  const nextLayout = cloneSplitLayout(layout);
  const visiblePaneIds = definition.paneOrder.filter((paneId) => requirePaneState(nextLayout, paneId).visible);
  if (visiblePaneIds.length === 0) return nextLayout;

  for (const paneId of visiblePaneIds) {
    const paneDefinition = definition.panes[paneId];
    const paneState = requirePaneState(nextLayout, paneId);
    const clampedSize = clamp(paneState.size, paneDefinition.minSize, paneDefinition.maxSize);
    paneState.size = clampedSize;
    paneState.lastVisibleSize = clampedSize;
  }

  const totalSize = visiblePaneIds.reduce((sum, paneId) => sum + requirePaneState(nextLayout, paneId).size, 0);
  const delta = Math.round(containerSize - totalSize);
  if (delta === 0) return nextLayout;

  if (delta > 0) {
    applyGrow(definition, nextLayout, delta);
    return nextLayout;
  }

  applyShrink(definition, nextLayout, Math.abs(delta));
  return nextLayout;
}

function applyGrow(definition: SplitDefinition, layout: SplitLayoutState, extraSpace: number) {
  let remaining = extraSpace;
  const growOrder = buildPaneResizeOrder(definition);

  for (const paneId of growOrder) {
    const paneState = requirePaneState(layout, paneId);
    if (!paneState.visible) continue;

    const paneDefinition = definition.panes[paneId];
    const capacity = paneDefinition.maxSize - paneState.size;
    if (capacity <= 0) continue;

    const applied = Math.min(remaining, capacity);
    paneState.size += applied;
    paneState.lastVisibleSize = paneState.size;
    remaining -= applied;
    if (remaining <= 0) return;
  }
}

function applyShrink(definition: SplitDefinition, layout: SplitLayoutState, deficit: number) {
  let remaining = deficit;
  const shrinkOrder = buildPaneResizeOrder(definition);

  for (const paneId of shrinkOrder) {
    const paneState = requirePaneState(layout, paneId);
    if (!paneState.visible) continue;

    const paneDefinition = definition.panes[paneId];
    const capacity = paneState.size - paneDefinition.minSize;
    if (capacity <= 0) continue;

    const applied = Math.min(remaining, capacity);
    paneState.size -= applied;
    paneState.lastVisibleSize = paneState.size;
    remaining -= applied;
    if (remaining <= 0) return;
  }
}

function buildPaneResizeOrder(definition: SplitDefinition): PaneId[] {
  const fillIndex = definition.paneOrder.findIndex((paneId) => paneId === definition.fillPaneId);
  if (fillIndex === -1) return definition.paneOrder;

  const beforeFill = definition.paneOrder.slice(0, fillIndex);
  const afterFill = definition.paneOrder.slice(fillIndex + 1);
  return [definition.fillPaneId, ...beforeFill, ...afterFill];
}
