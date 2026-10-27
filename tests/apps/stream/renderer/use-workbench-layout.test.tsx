import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchLayout, type UseWorkbenchLayoutResult } from '../../../../apps/stream/renderer/features/workbench/use-workbench-layout';
import {
  BOTTOM_PANEL_MIN_HEIGHT, DEFAULT_WORKBENCH_LAYOUT, DOCK_MIN_WIDTHS, DOCK_ORDER,
  serializeWorkbenchLayout, WORKBENCH_LAYOUT_STORAGE_KEY,
} from '../../../../apps/stream/renderer/workbench-layout';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.localStorage.clear();
});

function setup(initialBottomPanelHeight: number | null = null) {
  window.localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, serializeWorkbenchLayout({
    ...DEFAULT_WORKBENCH_LAYOUT,
    bottomPanelHeight: initialBottomPanelHeight,
  }));
  const { result, unmount } = renderHook(() => useWorkbenchLayout());
  const workbench = document.createElement('div');
  const scenesDock = document.createElement('section');
  scenesDock.className = 'scenes-dock';
  workbench.append(scenesDock);
  document.body.append(workbench);
  result.current.workbenchRef.current = workbench;

  vi.spyOn(workbench, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON: () => ({}),
  });
  const dockHeight = initialBottomPanelHeight ?? 210;
  vi.spyOn(scenesDock, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 700 - dockHeight, left: 0, top: 700 - dockHeight, right: 1000, bottom: 700, width: 1000, height: dockHeight, toJSON: () => ({}),
  });

  const capturedPointers = new Set<number>();
  const resizer = document.createElement('div');
  resizer.setPointerCapture = vi.fn((pointerId: number) => { capturedPointers.add(pointerId); });
  resizer.hasPointerCapture = vi.fn((pointerId: number) => capturedPointers.has(pointerId));
  resizer.releasePointerCapture = vi.fn((pointerId: number) => { capturedPointers.delete(pointerId); });

  const pointer = (clientY: number, button = 0, pointerId = 7) => ({
    button,
    clientY,
    pointerId,
    currentTarget: resizer,
    preventDefault: vi.fn(),
  }) as unknown as Parameters<UseWorkbenchLayoutResult['startPanelResize']>[0];

  return { result, resizer, pointer, unmount };
}

describe('useWorkbenchLayout bottom panel resizing', () => {
  it('captures the pointer, clamps the resized height, and releases on end', () => {
    const { result, resizer, pointer } = setup();
    const start = pointer(100);

    act(() => result.current.startPanelResize(start));

    expect(start.preventDefault).toHaveBeenCalledOnce();
    expect(resizer.setPointerCapture).toHaveBeenCalledWith(7);
    expect(result.current.workbenchResizing).toBe('rows');

    act(() => result.current.moveWorkbenchResize(pointer(1100)));

    expect(result.current.workbenchLayout.bottomPanelHeight).toBe(BOTTOM_PANEL_MIN_HEIGHT);

    act(() => result.current.endWorkbenchResize(pointer(1100)));

    expect(resizer.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(result.current.workbenchResizing).toBeNull();
  });

  it('resets after an unmoved gesture but preserves the height after a moved gesture', () => {
    const idleGesture = setup(300);
    act(() => {
      idleGesture.result.current.startPanelResize(idleGesture.pointer(500));
      idleGesture.result.current.endWorkbenchResize(idleGesture.pointer(500));
      idleGesture.result.current.resetWorkbenchDimension('bottomPanelHeight');
    });
    expect(idleGesture.result.current.workbenchLayout.bottomPanelHeight).toBeNull();
    idleGesture.unmount();

    const movedGesture = setup(300);
    act(() => {
      movedGesture.result.current.startPanelResize(movedGesture.pointer(500));
      movedGesture.result.current.moveWorkbenchResize(movedGesture.pointer(510));
      movedGesture.result.current.endWorkbenchResize(movedGesture.pointer(510));
      movedGesture.result.current.resetWorkbenchDimension('bottomPanelHeight');
    });

    expect(movedGesture.result.current.workbenchLayout.bottomPanelHeight).toBe(290);
  });
});

describe('useWorkbenchLayout dock reordering in a scrolled dock row', () => {
  it('targets the visible boundary and clamps an offscreen end indicator to the viewport', () => {
    window.localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, serializeWorkbenchLayout({
      ...DEFAULT_WORKBENCH_LAYOUT,
      hiddenDocks: [],
    }));
    const { result, unmount } = renderHook(() => useWorkbenchLayout());
    const workbench = document.createElement('section');
    const viewport = document.createElement('div');
    viewport.className = 'workbench-docks';
    const grid = document.createElement('div');
    grid.className = 'workbench-docks-grid';
    viewport.append(grid);
    workbench.append(viewport);
    document.body.append(workbench);
    result.current.workbenchRef.current = workbench;

    vi.spyOn(workbench, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 1100, bottom: 700, width: 1100, height: 700, toJSON: () => ({}),
    });
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 490, left: 0, top: 490, right: 1100, bottom: 700, width: 1100, height: 210, toJSON: () => ({}),
    });

    const initialScroll = DOCK_ORDER.slice(0, -1).reduce((width, id) => width + DOCK_MIN_WIDTHS[id], 0) - 985;
    viewport.scrollLeft = initialScroll;
    let left = -initialScroll;
    const setDockRect = new Map<(typeof DOCK_ORDER)[number], { left: number; update: (nextLeft: number) => void }>();
    for (const id of DOCK_ORDER) {
      const dock = document.createElement('section');
      dock.className = `dock ${id}-dock`;
      const title = document.createElement('div');
      title.setAttribute('data-dock-handle', '');
      const target = document.createElement('span');
      title.append(target);
      dock.append(title);
      grid.append(dock);
      const width = DOCK_MIN_WIDTHS[id];
      const rectSpy = vi.spyOn(dock, 'getBoundingClientRect');
      const update = (nextLeft: number) => rectSpy.mockReturnValue({
        x: nextLeft, y: 490, left: nextLeft, top: 490, right: nextLeft + width, bottom: 700, width, height: 210, toJSON: () => ({}),
      });
      update(left);
      setDockRect.set(id, { left, update });
      if (id === 'scenes') {
        const captured = new Set<number>();
        title.setPointerCapture = vi.fn((pointerId: number) => { captured.add(pointerId); });
        title.hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
        title.releasePointerCapture = vi.fn((pointerId: number) => { captured.delete(pointerId); });
      }
      left += width;
    }

    const scenesTitle = workbench.querySelector<HTMLElement>('.scenes-dock [data-dock-handle]')!;
    const target = scenesTitle.querySelector('span')!;
    act(() => result.current.handleWorkbenchTitlePointerDown({
      button: 0, clientX: 10, pointerId: 11, target, preventDefault: vi.fn(),
    } as unknown as Parameters<UseWorkbenchLayoutResult['handleWorkbenchTitlePointerDown']>[0]));
    act(() => result.current.handleWorkbenchTitlePointerMove({
      clientX: 1150,
    } as unknown as Parameters<UseWorkbenchLayoutResult['handleWorkbenchTitlePointerMove']>[0]));

    // At this scroll position Zoom spans 985–1225, so its left divider is visible.
    expect(result.current.dockDrag).toMatchObject({ before: 'zoom', left: 985, top: 490, height: 210 });

    // Scroll farther so the pointer is past Zoom's midpoint while its right
    // edge remains outside the viewport. The end target stays correct and the
    // indicator is clamped to the visible right edge.
    viewport.scrollLeft = initialScroll + 25;
    for (const { left: dockLeft, update } of setDockRect.values()) update(dockLeft - 25);
    act(() => result.current.handleWorkbenchTitlePointerMove({
      clientX: 1150,
    } as unknown as Parameters<UseWorkbenchLayoutResult['handleWorkbenchTitlePointerMove']>[0]));
    expect(result.current.dockDrag).toMatchObject({ before: 'end', left: 1100, top: 490, height: 210 });

    act(() => result.current.endDockDrag());
    expect(result.current.workbenchLayout.dockOrder).toEqual(['sources', 'mixer', 'youtube', 'controls', 'zoom', 'scenes']);
    unmount();
  });
});
