import { clamp } from '../../../utils/math';
import type { PaneId, PaneLayoutState, SplitDefinition, SplitLayoutState } from './workbench-panel-layout';

interface WorkingPane {
  id: PaneId;
  minimumSize: number;
  maximumSize: number;
  viewMinimumSize: number;
  viewMaximumSize: number;
  snap: boolean;
  visible: boolean;
  size: number;
  lastVisibleSize: number;
}

interface SnapState {
  index: number;
  limitDelta: number;
  size: number;
}

interface ResizeState {
  items: WorkingPane[];
  sizes: number[];
}

export interface SplitResizeResult {
  layout: SplitLayoutState;
  appliedDelta: number;
}

export function cloneSplitLayout(layout: SplitLayoutState): SplitLayoutState {
  const panes: Record<PaneId, PaneLayoutState> = {};
  const paneIds = Object.keys(layout.panes) as PaneId[];

  for (const paneId of paneIds) {
    const pane = layout.panes[paneId];
    if (!pane) continue;
    panes[paneId] = { ...pane };
  }

  return { panes };
}

export function createDefaultSplitLayout(definition: SplitDefinition): SplitLayoutState {
  const panes: Record<PaneId, PaneLayoutState> = {};

  for (const paneId of definition.paneOrder) {
    const paneDefinition = requirePaneDefinition(definition, paneId);
    panes[paneId] = {
      size: paneDefinition.defaultSize,
      visible: true,
      lastVisibleSize: paneDefinition.defaultSize,
    };
  }

  return { panes };
}

export function coerceSplitLayout(definition: SplitDefinition, input: SplitLayoutState, fallback: SplitLayoutState): SplitLayoutState {
  const panes: Record<PaneId, PaneLayoutState> = {};

  for (const paneId of definition.paneOrder) {
    const fallbackPane = requirePaneState(fallback, paneId);
    const paneDefinition = requirePaneDefinition(definition, paneId);
    const inputPane = input.panes[paneId];

    const visible = paneDefinition.collapsible
      ? typeof inputPane?.visible === 'boolean' ? inputPane.visible : fallbackPane.visible
      : true;

    const persistedSize = typeof inputPane?.size === 'number' ? inputPane.size : fallbackPane.size;
    const persistedLastVisible = typeof inputPane?.lastVisibleSize === 'number'
      ? inputPane.lastVisibleSize
      : fallbackPane.lastVisibleSize;

    const clampedLastVisibleSize = clamp(persistedLastVisible, paneDefinition.minSize, paneDefinition.maxSize);

    panes[paneId] = {
      size: visible ? clamp(persistedSize, paneDefinition.minSize, paneDefinition.maxSize) : 0,
      visible,
      lastVisibleSize: clampedLastVisibleSize,
    };
  }

  return { panes };
}

export function applyMeasuredPaneSizes(definition: SplitDefinition, layout: SplitLayoutState, paneSizes: Partial<Record<PaneId, number>>): SplitLayoutState {
  const nextLayout = cloneSplitLayout(layout);

  for (const paneId of definition.paneOrder) {
    const paneState = requirePaneState(nextLayout, paneId);
    if (!paneState.visible) continue;

    const measuredSize = paneSizes[paneId];
    if (typeof measuredSize !== 'number' || Number.isNaN(measuredSize)) continue;

    const paneDefinition = requirePaneDefinition(definition, paneId);
    const clampedSize = clamp(measuredSize, paneDefinition.minSize, paneDefinition.maxSize);
    paneState.size = clampedSize;
    paneState.lastVisibleSize = clampedSize;
  }

  return nextLayout;
}

export function setPaneVisibility(definition: SplitDefinition, layout: SplitLayoutState, paneId: PaneId, visible: boolean): SplitLayoutState {
  const paneDefinition = requirePaneDefinition(definition, paneId);
  if (!paneDefinition.collapsible) return cloneSplitLayout(layout);

  const nextLayout = cloneSplitLayout(layout);
  const paneState = requirePaneState(nextLayout, paneId);
  if (paneState.visible === visible) return nextLayout;

  if (!visible) {
    paneState.lastVisibleSize = Math.max(paneDefinition.minSize, paneState.size);
    paneState.visible = false;
    paneState.size = 0;
    return nextLayout;
  }

  paneState.visible = true;
  paneState.size = clamp(paneState.lastVisibleSize, paneDefinition.minSize, paneDefinition.maxSize);
  paneState.lastVisibleSize = paneState.size;
  return nextLayout;
}

export function resizeSplitFromDelta(definition: SplitDefinition, layout: SplitLayoutState, handleIndex: number, rawDelta: number): SplitResizeResult {
  const state = createResizeState(definition, layout);
  const snapBeforeIndex = findFirstSnapIndex(state.items, buildUpIndexes(handleIndex));
  const snapAfterIndex = findFirstSnapIndex(state.items, buildDownIndexes(handleIndex, state.items.length));
  const snapBefore = buildSnapState(state, handleIndex, snapBeforeIndex, 'before');
  const snapAfter = buildSnapState(state, handleIndex, snapAfterIndex, 'after');

  const appliedDelta = resize(
    state,
    handleIndex,
    rawDelta,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    snapBefore,
    snapAfter,
  );

  return {
    layout: toSplitLayout(definition, state.items),
    appliedDelta,
  };
}

function createResizeState(definition: SplitDefinition, layout: SplitLayoutState): ResizeState {
  const items = definition.paneOrder.map((paneId) => {
    const paneDefinition = requirePaneDefinition(definition, paneId);
    const paneState = requirePaneState(layout, paneId);

    return {
      id: paneId,
      minimumSize: paneState.visible ? paneDefinition.minSize : 0,
      maximumSize: paneState.visible ? paneDefinition.maxSize : 0,
      viewMinimumSize: paneDefinition.minSize,
      viewMaximumSize: paneDefinition.maxSize,
      snap: paneDefinition.snap,
      visible: paneState.visible,
      size: paneState.visible ? paneState.size : 0,
      lastVisibleSize: paneState.lastVisibleSize,
    } satisfies WorkingPane;
  });

  return {
    sizes: items.map((item) => item.size),
    items,
  };
}

function resize(
  state: ResizeState,
  handleIndex: number,
  rawDelta: number,
  overloadMinDelta: number,
  overloadMaxDelta: number,
  snapBefore: SnapState | undefined,
  snapAfter: SnapState | undefined,
): number {
  if (handleIndex < 0 || handleIndex >= state.items.length - 1) {
    return 0;
  }

  const upIndexes = buildUpIndexes(handleIndex);
  const downIndexes = buildDownIndexes(handleIndex, state.items.length);

  const minDeltaUp = upIndexes.reduce((sum, index) => sum + (state.items[index].minimumSize - state.sizes[index]), 0);
  const maxDeltaUp = upIndexes.reduce((sum, index) => sum + (state.items[index].maximumSize - state.sizes[index]), 0);
  const maxDeltaDown = downIndexes.length === 0
    ? Number.POSITIVE_INFINITY
    : downIndexes.reduce((sum, index) => sum + (state.sizes[index] - state.items[index].minimumSize), 0);
  const minDeltaDown = downIndexes.length === 0
    ? Number.NEGATIVE_INFINITY
    : downIndexes.reduce((sum, index) => sum + (state.sizes[index] - state.items[index].maximumSize), 0);

  const minDelta = Math.max(minDeltaUp, minDeltaDown, overloadMinDelta);
  const maxDelta = Math.min(maxDeltaDown, maxDeltaUp, overloadMaxDelta);

  let snapped = false;

  if (snapBefore) {
    const target = state.items[snapBefore.index];
    const shouldBeVisible = rawDelta >= snapBefore.limitDelta;
    snapped = shouldBeVisible !== target.visible;
    setVisible(target, shouldBeVisible, snapBefore.size);
  }

  if (!snapped && snapAfter) {
    const target = state.items[snapAfter.index];
    const shouldBeVisible = rawDelta < snapAfter.limitDelta;
    snapped = shouldBeVisible !== target.visible;
    setVisible(target, shouldBeVisible, snapAfter.size);
  }

  if (snapped) {
    synchronizeDynamicBounds(state.items);
    return resize(state, handleIndex, rawDelta, overloadMinDelta, overloadMaxDelta, snapBefore, snapAfter);
  }

  const delta = clamp(rawDelta, minDelta, maxDelta);

  let upDelta = delta;
  for (const index of upIndexes) {
    const item = state.items[index];
    const targetSize = clamp(state.sizes[index] + upDelta, item.minimumSize, item.maximumSize);
    const viewDelta = targetSize - state.sizes[index];
    item.size = targetSize;
    upDelta -= viewDelta;
  }

  let downDelta = delta;
  for (const index of downIndexes) {
    const item = state.items[index];
    const targetSize = clamp(state.sizes[index] - downDelta, item.minimumSize, item.maximumSize);
    const viewDelta = targetSize - state.sizes[index];
    item.size = targetSize;
    downDelta += viewDelta;
  }

  return delta;
}

function buildSnapState(
  state: ResizeState,
  handleIndex: number,
  snapIndex: number | undefined,
  direction: 'before' | 'after',
): SnapState | undefined {
  if (typeof snapIndex !== 'number') return undefined;

  const upIndexes = buildUpIndexes(handleIndex);
  const downIndexes = buildDownIndexes(handleIndex, state.items.length);

  const item = state.items[snapIndex];
  const halfSize = Math.floor(item.viewMinimumSize / 2);

  // Use the snap pane's own side-specific bound so that a constraint on the
  // opposite side (e.g. a maxSize blocking growth) does not trigger this
  // pane to collapse/expand prematurely.
  if (direction === 'before') {
    const minDeltaUp = upIndexes.reduce((sum, index) => sum + (state.items[index].minimumSize - state.sizes[index]), 0);
    return {
      index: snapIndex,
      limitDelta: item.visible ? minDeltaUp - halfSize : minDeltaUp + halfSize,
      size: state.sizes[snapIndex],
    };
  }

  const maxDeltaDown = downIndexes.length === 0
    ? Number.POSITIVE_INFINITY
    : downIndexes.reduce((sum, index) => sum + (state.sizes[index] - state.items[index].minimumSize), 0);
  return {
    index: snapIndex,
    limitDelta: item.visible ? maxDeltaDown + halfSize : maxDeltaDown - halfSize,
    size: state.sizes[snapIndex],
  };
}

function findFirstSnapIndex(items: WorkingPane[], indexes: number[]): number | undefined {
  for (const index of indexes) {
    if (items[index].visible && items[index].snap) return index;
  }

  for (const index of indexes) {
    if (items[index].visible && items[index].viewMaximumSize - items[index].viewMinimumSize > 0) return undefined;
    if (!items[index].visible && items[index].snap) return index;
  }

  return undefined;
}

function setVisible(item: WorkingPane, visible: boolean, size: number): void {
  if (visible === item.visible) return;

  if (visible) {
    const restoredSize = clamp(item.lastVisibleSize, item.viewMinimumSize, item.viewMaximumSize);
    item.size = restoredSize;
    item.lastVisibleSize = restoredSize;
    item.visible = true;
    item.minimumSize = item.viewMinimumSize;
    item.maximumSize = item.viewMaximumSize;
    return;
  }

  item.lastVisibleSize = typeof size === 'number' && size > 0 ? size : item.size;
  item.size = 0;
  item.visible = false;
  item.minimumSize = 0;
  item.maximumSize = 0;
}

function synchronizeDynamicBounds(items: WorkingPane[]): void {
  for (const item of items) {
    if (item.visible) {
      item.minimumSize = item.viewMinimumSize;
      item.maximumSize = item.viewMaximumSize;
      continue;
    }

    item.minimumSize = 0;
    item.maximumSize = 0;
    item.size = 0;
  }
}

function toSplitLayout(definition: SplitDefinition, items: WorkingPane[]): SplitLayoutState {
  const panes: Record<PaneId, PaneLayoutState> = {};

  for (let index = 0; index < definition.paneOrder.length; index++) {
    const paneId = definition.paneOrder[index];
    const item = items[index];
    panes[paneId] = {
      size: item.visible ? item.size : 0,
      visible: item.visible,
      lastVisibleSize: item.visible ? item.size : item.lastVisibleSize,
    };
  }

  return { panes };
}

function buildUpIndexes(handleIndex: number): number[] {
  const indexes: number[] = [];
  for (let index = handleIndex; index >= 0; index--) {
    indexes.push(index);
  }
  return indexes;
}

function buildDownIndexes(handleIndex: number, length: number): number[] {
  const indexes: number[] = [];
  for (let index = handleIndex + 1; index < length; index++) {
    indexes.push(index);
  }
  return indexes;
}

function requirePaneDefinition(definition: SplitDefinition, paneId: PaneId) {
  const pane = definition.panes[paneId];
  if (!pane) {
    throw new Error(`Missing split definition for pane: ${paneId}`);
  }
  return pane;
}

export function requirePaneState(layout: SplitLayoutState, paneId: PaneId): PaneLayoutState {
  const pane = layout.panes[paneId];
  if (!pane) {
    throw new Error(`Missing split state for pane: ${paneId}`);
  }
  return pane;
}
