import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { ResizeHandle } from '@lumacast/ui';
import {
  clampBottomPanelHeight, DEFAULT_WORKBENCH_LAYOUT, DOCK_LABELS, DOCK_MIN_WIDTHS, isDefaultWorkbenchLayout,
  parseWorkbenchLayout, reorderDockOnDrop, resetWorkbenchLayout, resizeDockWidths, serializeWorkbenchLayout,
  toggleDockVisibility, visibleDocks, WORKBENCH_LAYOUT_STORAGE_KEY, dockWeightsFromWidths,
  type DockId, type WorkbenchLayout,
} from '../../workbench-layout';

const DOCK_SELECTORS: Record<DockId, string> = {
  scenes: '.scenes-dock',
  sources: '.sources-dock',
  mixer: '.mixer-dock',
  youtube: '.youtube-dock',
  zoom: '.zoom-dock',
  controls: '.controls-dock',
};

export interface UseWorkbenchLayoutResult {
  workbenchRef: RefObject<HTMLElement | null>;
  workbenchLayout: WorkbenchLayout;
  workbenchResizing: 'columns' | 'rows' | null;
  dockDrag: { id: DockId; before: DockId | 'end'; left: number; top: number; height: number } | null;
  visibleDockIds: DockId[];
  toggleDock: (id: DockId) => void;
  resetUi: () => void;
  resizerForDock: (id: DockId) => ReactNode | undefined;
  startPanelResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  moveWorkbenchResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  endWorkbenchResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  resetWorkbenchDimension: (dimension: 'dockWeights' | 'bottomPanelHeight') => void;
  handleWorkbenchTitlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  handleWorkbenchTitlePointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  endDockDrag: () => void;
  dockDragOpacity: (id: DockId) => number | undefined;
}

/**
 * Resizable workbench geometry (dock widths, bottom panel height), dock
 * visibility, and dock-title drag-to-reorder. Thin stateful wrapper around
 * the pure helpers in `renderer/workbench-layout.ts`. Mirrors the former
 * inline App.tsx implementation exactly.
 */
export function useWorkbenchLayout(): UseWorkbenchLayoutResult {
  const workbenchRef = useRef<HTMLElement>(null);
  const [workbenchLayout, setWorkbenchLayout] = useState<WorkbenchLayout>(() => {
    try { return parseWorkbenchLayout(window.localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY)); } catch { return { ...DEFAULT_WORKBENCH_LAYOUT }; }
  });
  const [workbenchResizing, setWorkbenchResizing] = useState<'columns' | 'rows' | null>(null);
  const workbenchDragRef = useRef<{ startY: number; height: number; workbenchHeight: number } | null>(null);
  // Dock widths measured when a column gesture starts; every move recomputes from this snapshot.
  const columnDragRef = useRef<{ boundary: number; widths: number[] } | null>(null);
  // Two quick drags that end near the same spot also fire dblclick; only a click pair without movement resets a dimension.
  const workbenchDragMovedRef = useRef(false);
  // Dragging a dock's title row to reorder it. `before` is authoritative (read on pointerup/Escape);
  // `dockDrag` state mirrors it purely to drive the drop indicator and dimmed-dock rendering.
  const dockDragRef = useRef<{ id: DockId; startX: number; pointerId: number; active: boolean; titleElement: HTMLElement; before: DockId | 'end' } | null>(null);
  const [dockDrag, setDockDrag] = useState<{ id: DockId; before: DockId | 'end'; left: number; top: number; height: number } | null>(null);

  useEffect(() => {
    try {
      if (isDefaultWorkbenchLayout(workbenchLayout)) {
        window.localStorage.removeItem(WORKBENCH_LAYOUT_STORAGE_KEY);
      } else {
        window.localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, serializeWorkbenchLayout(workbenchLayout));
      }
    } catch { /* Layout persistence is a convenience; the session still works without storage. */ }
  }, [workbenchLayout]);

  // Escape cancels an in-progress dock-title drag without reordering.
  useEffect(() => {
    if (!dockDrag) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      const drag = dockDragRef.current;
      if (drag?.titleElement.hasPointerCapture(drag.pointerId)) drag.titleElement.releasePointerCapture(drag.pointerId);
      dockDragRef.current = null;
      setDockDrag(null);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dockDrag]);

  const measureDockWidths = () => visibleDocks(workbenchLayout)
    .map((id) => workbenchRef.current?.querySelector<HTMLElement>(DOCK_SELECTORS[id])?.getBoundingClientRect().width ?? 0);

  const startDockResize = (boundary: number) => {
    columnDragRef.current = { boundary, widths: measureDockWidths() };
    workbenchDragMovedRef.current = false;
    setWorkbenchResizing('columns');
  };

  const moveDockResize = (delta: number) => {
    const drag = columnDragRef.current;
    if (!drag) return;
    if (Math.abs(delta) > 3) workbenchDragMovedRef.current = true;
    const ids = visibleDocks(workbenchLayout);
    const widths = resizeDockWidths(drag.widths, drag.boundary, delta, ids.map((id) => DOCK_MIN_WIDTHS[id]));
    setWorkbenchLayout((current) => ({ ...current, dockWeights: dockWeightsFromWidths(ids, widths, current.dockWeights) }));
  };

  const endDockResize = () => {
    columnDragRef.current = null;
    setWorkbenchResizing(null);
  };

  const startPanelResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const workbenchHeight = workbenchRef.current?.getBoundingClientRect().height ?? 0;
    const firstVisibleDock = visibleDocks(workbenchLayout)[0];
    const height = firstVisibleDock ? (workbenchRef.current?.querySelector<HTMLElement>(DOCK_SELECTORS[firstVisibleDock])?.getBoundingClientRect().height ?? 0) : 0;
    workbenchDragRef.current = { startY: event.clientY, height, workbenchHeight };
    workbenchDragMovedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    setWorkbenchResizing('rows');
  };

  const moveWorkbenchResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = workbenchDragRef.current;
    if (!drag || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (Math.abs(event.clientY - drag.startY) > 3) workbenchDragMovedRef.current = true;
    const bottomPanelHeight = clampBottomPanelHeight(drag.height - (event.clientY - drag.startY), drag.workbenchHeight);
    setWorkbenchLayout((current) => ({ ...current, bottomPanelHeight }));
  };

  const endWorkbenchResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    workbenchDragRef.current = null;
    setWorkbenchResizing(null);
  };

  const resetWorkbenchDimension = (dimension: 'dockWeights' | 'bottomPanelHeight') => {
    if (workbenchDragMovedRef.current) return;
    setWorkbenchLayout((current) => ({ ...current, [dimension]: null }));
  };

  const dockResizer = (boundary: number, label: string): ReactNode => <ResizeHandle
    orientation="horizontal"
    variant="bar"
    label={`Resize ${label}`}
    title="Drag to resize · double-click to reset"
    className="absolute right-0.5 top-0 h-full"
    onResizeStart={() => startDockResize(boundary)}
    onResizeMove={moveDockResize}
    onResizeEnd={endDockResize}
    onReset={() => resetWorkbenchDimension('dockWeights')}
  />;

  const toggleDock = (id: DockId) => setWorkbenchLayout((current) => toggleDockVisibility(current, id));
  const resetUi = () => setWorkbenchLayout(resetWorkbenchLayout());

  const resizerForDock = (id: DockId): ReactNode | undefined => {
    const visible = visibleDocks(workbenchLayout);
    const index = visible.indexOf(id);
    if (index === -1 || index === visible.length - 1) return undefined;
    return dockResizer(index, `${DOCK_LABELS[id]} dock`);
  };

  // Resolves the pointer x position to a drop target among the visible docks:
  // the first dock whose horizontal midpoint sits past `clientX` ("before" it),
  // or 'end' when the pointer is past every midpoint (after the last dock).
  // Also reports the boundary's on-screen position so the drop-indicator line
  // can be rendered without a second DOM pass.
  const computeDockDropTarget = (clientX: number): { before: DockId | 'end'; left: number; top: number; height: number } => {
    const workbenchRect = workbenchRef.current?.getBoundingClientRect();
    const dockViewportRect = workbenchRef.current?.querySelector<HTMLElement>('.workbench-docks')?.getBoundingClientRect();
    const targetX = dockViewportRect
      ? Math.min(Math.max(clientX, dockViewportRect.left), dockViewportRect.right)
      : clientX;
    let before: DockId | 'end' = 'end';
    let edgeX = dockViewportRect?.right ?? workbenchRect?.right ?? 0;
    let rowTop = workbenchRect?.top ?? 0;
    let rowHeight = 0;
    for (const id of visibleDocks(workbenchLayout)) {
      const rect = workbenchRef.current?.querySelector<HTMLElement>(DOCK_SELECTORS[id])?.getBoundingClientRect();
      if (!rect) continue;
      rowTop = rect.top;
      rowHeight = rect.height;
      if (targetX < rect.left + rect.width / 2) { before = id; edgeX = rect.left; break; }
      edgeX = rect.right;
    }
    if (dockViewportRect) edgeX = Math.min(Math.max(edgeX, dockViewportRect.left), dockViewportRect.right);
    return { before, left: edgeX - (workbenchRect?.left ?? 0), top: rowTop - (workbenchRect?.top ?? 0), height: rowHeight };
  };

  // Delegated on the workbench container (rather than on each dock's title row)
  // so no dock component needs to know about reordering: the dock id comes
  // from matching the ancestor `.dock` element against DOCK_SELECTORS.
  const handleWorkbenchTitlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, select, a')) return;
    const titleElement = target.closest<HTMLElement>('[data-dock-handle]');
    if (!titleElement) return;
    const dockElement = titleElement.closest<HTMLElement>('.dock');
    const id = dockElement && (Object.keys(DOCK_SELECTORS) as DockId[]).find((candidate) => dockElement.matches(DOCK_SELECTORS[candidate]));
    if (!id) return;
    event.preventDefault();
    dockDragRef.current = { id, startX: event.clientX, pointerId: event.pointerId, active: false, titleElement, before: 'end' };
  };

  const handleWorkbenchTitlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dockDragRef.current;
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(event.clientX - drag.startX) < 5) return;
      drag.active = true;
      drag.titleElement.setPointerCapture(drag.pointerId);
    }
    const target = computeDockDropTarget(event.clientX);
    drag.before = target.before;
    setDockDrag({ id: drag.id, ...target });
  };

  const endDockDrag = () => {
    const drag = dockDragRef.current;
    if (drag?.active) {
      if (drag.titleElement.hasPointerCapture(drag.pointerId)) drag.titleElement.releasePointerCapture(drag.pointerId);
      const beforeId = drag.before === 'end' ? null : drag.before;
      setWorkbenchLayout((current) => reorderDockOnDrop(current, drag.id, beforeId));
    }
    dockDragRef.current = null;
    setDockDrag(null);
  };

  const dockDragOpacity = (id: DockId): number | undefined => (dockDrag?.id === id ? 0.6 : undefined);

  return {
    workbenchRef, workbenchLayout, workbenchResizing, dockDrag, visibleDockIds: visibleDocks(workbenchLayout),
    toggleDock, resetUi, resizerForDock,
    startPanelResize, moveWorkbenchResize, endWorkbenchResize, resetWorkbenchDimension,
    handleWorkbenchTitlePointerDown, handleWorkbenchTitlePointerMove, endDockDrag, dockDragOpacity,
  };
}
