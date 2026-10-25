import { useCallback, useMemo, useRef, useState } from 'react';
import {
  collapseSplitPane,
  expandSplitPane,
  fitSplitLayoutToContainer,
  normalizeSplitLayout,
  resizeSplitFromDelta,
  type SplitChangeMeta,
  type SplitLayout,
} from '@lumacast/ui';
import { clamp } from '../../../utils/math';
import {
  fromSplitLayout,
  toSplitLayout,
  toSplitPanes,
  type DragSessionState,
  type PaneId,
  type SplitDefinition,
  type SplitId,
  type SplitLayoutState,
  type WorkbenchPanelLayouts,
} from './workbench-panel-layout';

const STORAGE_KEY = 'lumacast.workbench-layout.v1';
const STORAGE_VERSION = 3;

interface PersistedWorkbenchLayouts {
  version: number;
  layouts: WorkbenchPanelLayouts;
}

interface ResizeStartInput {
  definition: SplitDefinition;
  handleIndex: number;
  pointerPosition: number;
  paneSizes: Record<string, number>;
}

interface ResizeMoveInput {
  definition: SplitDefinition;
  pointerPosition: number;
}

interface ResizeEndInput {
  splitId: SplitId;
}

interface ContainerResizeInput {
  definition: SplitDefinition;
  size: number;
}

interface SplitLayoutChangeInput {
  definition: SplitDefinition;
  layout: SplitLayout;
  meta: SplitChangeMeta;
}

interface UseWorkbenchPanelLayoutResult {
  liveLayouts: WorkbenchPanelLayouts;
  committedLayouts: WorkbenchPanelLayouts;
  registerSplit: (definition: SplitDefinition) => void;
  getSplitLayout: (definition: SplitDefinition) => SplitLayoutState;
  startDrag: (input: ResizeStartInput) => void;
  updateDrag: (input: ResizeMoveInput) => void;
  endDrag: (input: ResizeEndInput) => void;
  syncToContainer: (input: ContainerResizeInput) => void;
  applySplitLayout: (input: SplitLayoutChangeInput) => void;
  togglePanel: (splitId: SplitId, paneId: PaneId) => void;
  isPanelVisible: (splitId: SplitId, paneId: PaneId) => boolean;
}

export function useWorkbenchPanelLayout(): UseWorkbenchPanelLayoutResult {
  const initialLayouts = useMemo(() => hydratePersistedLayouts(), []);

  const [committedLayouts, setCommittedLayouts] = useState<WorkbenchPanelLayouts>(initialLayouts);
  const [liveLayouts, setLiveLayouts] = useState<WorkbenchPanelLayouts>(initialLayouts);

  const committedLayoutsRef = useRef(committedLayouts);
  const liveLayoutsRef = useRef(liveLayouts);
  const dragSessionRef = useRef<DragSessionState | null>(null);
  const definitionsRef = useRef<Record<SplitId, SplitDefinition>>({});

  const persistLayouts = useCallback((layouts: WorkbenchPanelLayouts) => {
    if (typeof window === 'undefined') return;

    const payload: PersistedWorkbenchLayouts = {
      version: STORAGE_VERSION,
      layouts,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, []);

  const replaceBothLayouts = useCallback((layouts: WorkbenchPanelLayouts, persist: boolean) => {
    committedLayoutsRef.current = layouts;
    liveLayoutsRef.current = layouts;

    setCommittedLayouts(layouts);
    setLiveLayouts(layouts);

    if (persist) {
      persistLayouts(layouts);
    }
  }, [persistLayouts]);

  const registerSplit = useCallback((definition: SplitDefinition) => {
    definitionsRef.current[definition.id] = definition;
  }, []);

  const getSplitLayout = useCallback((definition: SplitDefinition) => {
    return resolveSplitLayout(liveLayoutsRef.current, definition);
  }, []);

  const startDrag = useCallback((input: ResizeStartInput) => {
    registerSplit(input.definition);

    const baseSplit = resolveSplitLayout(liveLayoutsRef.current, input.definition);
    const measuredSplit = applyMeasuredPaneSizes(
      input.definition,
      baseSplit,
      input.paneSizes as Partial<Record<PaneId, number>>,
    );

    const measuredLiveLayouts = setSplitLayout(liveLayoutsRef.current, input.definition.id, measuredSplit);
    liveLayoutsRef.current = measuredLiveLayouts;
    setLiveLayouts(measuredLiveLayouts);

    dragSessionRef.current = {
      splitId: input.definition.id,
      handleIndex: input.handleIndex,
      startPointer: input.pointerPosition,
      rawDelta: 0,
      baseLayouts: measuredLiveLayouts,
    };
  }, [registerSplit]);

  const updateDrag = useCallback((input: ResizeMoveInput) => {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.splitId !== input.definition.id) return;

    const rawDelta = input.pointerPosition - session.startPointer;
    const baseSplit = resolveSplitLayout(session.baseLayouts, input.definition);
    const resized = resizeSplitFromDelta(toSplitPanes(input.definition), toSplitLayout(baseSplit), session.handleIndex, rawDelta);
    const nextLayouts = setSplitLayout(liveLayoutsRef.current, input.definition.id, fromSplitLayout(resized.layout, input.definition));

    liveLayoutsRef.current = nextLayouts;
    setLiveLayouts(nextLayouts);
    session.rawDelta = rawDelta;
  }, []);

  const endDrag = useCallback((input: ResizeEndInput) => {
    const session = dragSessionRef.current;
    if (!session) return;
    if (session.splitId !== input.splitId) return;

    dragSessionRef.current = null;

    const currentDefinition = definitionsRef.current[input.splitId];
    if (!currentDefinition) return;

    const committedNext = setSplitLayout(
      committedLayoutsRef.current,
      input.splitId,
      resolveSplitLayout(liveLayoutsRef.current, currentDefinition),
    );

    replaceBothLayouts(committedNext, true);
  }, [replaceBothLayouts]);

  const syncToContainer = useCallback((input: ContainerResizeInput) => {
    registerSplit(input.definition);

    const currentSplit = resolveSplitLayout(committedLayoutsRef.current, input.definition);
    const fittedSplit = fromSplitLayout(
      normalizeSplitLayout(toSplitPanes(input.definition), fitSplitLayoutToContainer(toSplitPanes(input.definition), toSplitLayout(currentSplit), input.size)),
      input.definition,
    );
    if (areSplitLayoutsEqual(currentSplit, fittedSplit, input.definition)) return;

    replaceBothLayouts(setSplitLayout(committedLayoutsRef.current, input.definition.id, fittedSplit), true);
  }, [registerSplit, replaceBothLayouts]);

  const togglePanel = useCallback((splitId: SplitId, paneId: PaneId) => {
    dragSessionRef.current = null;

    const definition = definitionsRef.current[splitId];
    if (!definition) return;

    const paneDefinition = definition.panes[paneId];
    if (!paneDefinition) return;

    const baseSplit = resolveSplitLayout(committedLayoutsRef.current, definition);
    const panes = toSplitPanes(definition);
    const split = toSplitLayout(baseSplit);
    const toggled = baseSplit.panes[paneId].visible ? collapseSplitPane(panes, split, paneId) : expandSplitPane(panes, split, paneId);
    const nextSplit = fromSplitLayout(toggled, definition);

    replaceBothLayouts(setSplitLayout(committedLayoutsRef.current, splitId, nextSplit), true);
  }, [replaceBothLayouts]);

  // Split's onLayoutChange: live updates stay in memory; commits persist.
  const applySplitLayout = useCallback((input: SplitLayoutChangeInput) => {
    registerSplit(input.definition);

    const nextSplit = fromSplitLayout(input.layout, input.definition);
    if (input.meta.phase === 'live') {
      const nextLive = setSplitLayout(liveLayoutsRef.current, input.definition.id, nextSplit);
      liveLayoutsRef.current = nextLive;
      setLiveLayouts(nextLive);
      return;
    }

    dragSessionRef.current = null;
    replaceBothLayouts(setSplitLayout(committedLayoutsRef.current, input.definition.id, nextSplit), true);
  }, [registerSplit, replaceBothLayouts]);

  const isPanelVisible = useCallback((splitId: SplitId, paneId: PaneId) => {
    const visible = liveLayoutsRef.current[splitId]?.panes[paneId]?.visible;
    return typeof visible === 'boolean' ? visible : true;
  }, []);

  return {
    liveLayouts,
    committedLayouts,
    registerSplit,
    getSplitLayout,
    startDrag,
    updateDrag,
    endDrag,
    syncToContainer,
    applySplitLayout,
    togglePanel,
    isPanelVisible,
  };
}

function hydratePersistedLayouts(): WorkbenchPanelLayouts {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    const parsed = JSON.parse(raw) as PersistedWorkbenchLayouts;
    if (parsed.version !== STORAGE_VERSION) return {};
    if (!isLayoutsRecord(parsed.layouts)) return {};

    return parsed.layouts;
  } catch {
    return {};
  }
}

function resolveSplitLayout(layouts: WorkbenchPanelLayouts, definition: SplitDefinition): SplitLayoutState {
  const input = layouts[definition.id];
  return fromSplitLayout(normalizeSplitLayout(toSplitPanes(definition), input ? toSplitLayout(input) : undefined), definition);
}

function applyMeasuredPaneSizes(definition: SplitDefinition, layout: SplitLayoutState, paneSizes: Partial<Record<PaneId, number>>): SplitLayoutState {
  const panes = { ...layout.panes };
  for (const paneId of definition.paneOrder) {
    const pane = panes[paneId];
    const measured = paneSizes[paneId];
    if (!pane?.visible || typeof measured !== 'number' || Number.isNaN(measured)) continue;
    const { minSize, maxSize } = definition.panes[paneId];
    const size = clamp(measured, minSize, maxSize);
    panes[paneId] = { ...pane, size, lastVisibleSize: size };
  }
  return { panes };
}

function setSplitLayout(layouts: WorkbenchPanelLayouts, splitId: SplitId, splitLayout: SplitLayoutState): WorkbenchPanelLayouts {
  return {
    ...layouts,
    [splitId]: { panes: Object.fromEntries(Object.entries(splitLayout.panes).map(([id, pane]) => [id, { ...pane }])) },
  };
}

function isLayoutsRecord(value: unknown): value is WorkbenchPanelLayouts {
  if (!value || typeof value !== 'object') return false;

  const layouts = value as Record<string, unknown>;
  return Object.values(layouts).every(isSplitLayoutState);
}

function isSplitLayoutState(value: unknown): value is SplitLayoutState {
  if (!value || typeof value !== 'object') return false;

  const panes = (value as SplitLayoutState).panes;
  if (!panes || typeof panes !== 'object') return false;

  return Object.values(panes).every((pane) => {
    if (!pane || typeof pane !== 'object') return false;

    const candidate = pane as { size?: unknown; visible?: unknown; lastVisibleSize?: unknown };
    return typeof candidate.size === 'number'
      && typeof candidate.visible === 'boolean'
      && typeof candidate.lastVisibleSize === 'number';
  });
}

function areSplitLayoutsEqual(left: SplitLayoutState, right: SplitLayoutState, definition: SplitDefinition): boolean {
  return definition.paneOrder.every((paneId) => {
    const leftPane = left.panes[paneId];
    const rightPane = right.panes[paneId];
    return leftPane.size === rightPane.size
      && leftPane.visible === rightPane.visible
      && leftPane.lastVisibleSize === rightPane.lastVisibleSize;
  });
}

export type {
  ContainerResizeInput,
  SplitLayoutChangeInput,
  ResizeStartInput,
  ResizeMoveInput,
  ResizeEndInput,
  UseWorkbenchPanelLayoutResult,
};
