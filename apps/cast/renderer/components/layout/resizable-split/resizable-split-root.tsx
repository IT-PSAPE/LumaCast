import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@lumacast/ui';
import { ResizableSplitHandle } from './resizable-split-handle';
import { ResizableSplitPane, type ResizableSplitPaneProps } from './resizable-split-pane';

interface ResizableSplitResizeStartEvent {
  handleIndex: number;
  pointerPosition: number;
  paneSizes: Record<string, number>;
}

interface ResizableSplitResizeMoveEvent {
  handleIndex: number;
  pointerPosition: number;
}

interface ResizableSplitResizeEndEvent {
  handleIndex: number;
}

interface HandleDescriptor {
  index: number;
  position: number;
}

interface RootSlotProps {
  className?: string;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

interface ResizableSplitRootProps {
  children: ReactNode;
  onContainerResize?: (size: number) => void;
  onResize: (event: ResizableSplitResizeMoveEvent) => void;
  onResizeEnd: (event: ResizableSplitResizeEndEvent) => void;
  onResizeStart: (event: ResizableSplitResizeStartEvent) => void;
  orientation: 'horizontal' | 'vertical';
}

export function ResizableSplitRoot({ children, onContainerResize, onResize, onResizeEnd, onResizeStart, orientation }: ResizableSplitRootProps) {
  const wrapper = Children.only(children);
  if (!isValidElement<RootSlotProps>(wrapper)) {
    throw new Error('ResizableSplitRoot expects a single element child');
  }
  const wrapperChildren = wrapper.props.children;
  const paneElements = collectPaneElements(wrapperChildren);
  const externalRef = (wrapper as ReactElement<RootSlotProps> & { ref?: Ref<HTMLElement> }).ref;

  const containerRef = useRef<HTMLElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeHandleIndexRef = useRef<number | null>(null);
  const [handleDescriptors, setHandleDescriptors] = useState<HandleDescriptor[]>([]);
  const [activeHandleIndex, setActiveHandleIndex] = useState<number | null>(null);
  const [hoveredHandleIndex, setHoveredHandleIndex] = useState<number | null>(null);

  const setContainerRef = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
    if (typeof externalRef === 'function') {
      externalRef(node);
    } else if (externalRef && typeof externalRef === 'object') {
      (externalRef as { current: HTMLElement | null }).current = node;
    }
  }, [externalRef]);

  const measurePaneSizes = useCallback((): Record<string, number> => {
    const sizes: Record<string, number> = {};
    const container = containerRef.current;
    if (!container) return sizes;

    for (const pane of paneElements) {
      const paneElement = findPaneElement(container, pane.props.paneId);
      if (!paneElement) continue;
      sizes[pane.props.paneId] = orientation === 'horizontal' ? paneElement.offsetWidth : paneElement.offsetHeight;
    }

    return sizes;
  }, [orientation, paneElements]);

  const recalculateHandles = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const nextHandles: HandleDescriptor[] = [];

    for (let index = 0; index < paneElements.length - 1; index++) {
      const leftPane = paneElements[index].props;
      const rightPane = paneElements[index + 1].props;
      const isActiveBoundary = activeHandleIndexRef.current === index;
      const shouldRender = (leftPane.visible && rightPane.visible) || isActiveBoundary;
      if (!shouldRender) continue;

      const boundary = findBoundaryPosition(container, orientation, leftPane.paneId, rightPane.paneId);
      if (typeof boundary !== 'number') continue;
      nextHandles.push({ index, position: boundary });
    }

    setHandleDescriptors((current) => (areHandleDescriptorsEqual(current, nextHandles) ? current : nextHandles));
  }, [orientation, paneElements]);

  useLayoutEffect(() => {
    recalculateHandles();
    const container = containerRef.current;
    if (!container) return;
    onContainerResize?.(orientation === 'horizontal' ? container.clientWidth : container.clientHeight);
  }, [onContainerResize, orientation, recalculateHandles]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      recalculateHandles();
      onContainerResize?.(orientation === 'horizontal' ? container.clientWidth : container.clientHeight);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [onContainerResize, orientation, recalculateHandles]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const handleIndex = readHandleIndex(event.currentTarget);
    if (handleIndex === null) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

    activePointerIdRef.current = event.pointerId;
    activeHandleIndexRef.current = handleIndex;
    setActiveHandleIndex(handleIndex);
    setHoveredHandleIndex(handleIndex);

    onResizeStart({
      handleIndex,
      pointerPosition: extractPointerPosition(orientation, event.clientX, event.clientY),
      paneSizes: measurePaneSizes(),
    });
    recalculateHandles();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const handleIndex = readHandleIndex(event.currentTarget);
    if (handleIndex === null || activePointerIdRef.current !== event.pointerId || activeHandleIndexRef.current !== handleIndex) return;
    event.preventDefault();
    onResize({ handleIndex, pointerPosition: extractPointerPosition(orientation, event.clientX, event.clientY) });
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    completePointerSession(event.currentTarget, event.pointerId);
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    completePointerSession(event.currentTarget, event.pointerId);
  }

  function handlePointerEnter(event: ReactPointerEvent<HTMLDivElement>) {
    const handleIndex = readHandleIndex(event.currentTarget);
    if (handleIndex === null) return;
    if (activeHandleIndexRef.current !== null && activeHandleIndexRef.current !== handleIndex) return;
    setHoveredHandleIndex(handleIndex);
  }

  function handlePointerLeave(event: ReactPointerEvent<HTMLDivElement>) {
    const handleIndex = readHandleIndex(event.currentTarget);
    if (handleIndex === null || activeHandleIndexRef.current === handleIndex) return;
    setHoveredHandleIndex((current) => (current === handleIndex ? null : current));
  }

  function completePointerSession(target: HTMLDivElement, pointerId: number) {
    const handleIndex = readHandleIndex(target);
    if (handleIndex === null || activePointerIdRef.current !== pointerId) return;

    if (typeof target.hasPointerCapture === 'function' && target.hasPointerCapture(pointerId) && typeof target.releasePointerCapture === 'function') {
      target.releasePointerCapture(pointerId);
    }

    activePointerIdRef.current = null;
    activeHandleIndexRef.current = null;
    setActiveHandleIndex(null);
    setHoveredHandleIndex(null);

    onResizeEnd({ handleIndex });
    recalculateHandles();
  }

  return cloneElement(wrapper, {
    ref: setContainerRef,
    className: cn(
      'w-full relative flex min-h-0 min-w-0 overflow-hidden',
      orientation === 'horizontal' ? 'flex-row' : 'flex-col',
      wrapper.props.className,
    ),
    children: (
      <>
        {wrapperChildren}
        {handleDescriptors.map((handle) => (
          <ResizableSplitHandle
            key={handle.index}
            orientation={orientation}
            handleIndex={handle.index}
            position={handle.position}
            active={activeHandleIndex === handle.index}
            hovered={hoveredHandleIndex === handle.index}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onPointerEnter={handlePointerEnter}
            onPointerLeave={handlePointerLeave}
          />
        ))}
      </>
    ),
  });
}

function collectPaneElements(children: ReactNode): ReactElement<ResizableSplitPaneProps>[] {
  return Children.toArray(children).filter((child): child is ReactElement<ResizableSplitPaneProps> => (
    isValidElement<ResizableSplitPaneProps>(child) && child.type === ResizableSplitPane
  ));
}

function extractPointerPosition(orientation: 'horizontal' | 'vertical', x: number, y: number): number {
  return orientation === 'horizontal' ? x : y;
}

function readHandleIndex(target: HTMLDivElement): number | null {
  const rawIndex = target.dataset.handleIndex;
  if (!rawIndex) return null;
  const parsedIndex = Number(rawIndex);
  return Number.isNaN(parsedIndex) ? null : parsedIndex;
}

function areHandleDescriptorsEqual(current: HandleDescriptor[], next: HandleDescriptor[]): boolean {
  if (current.length !== next.length) return false;
  for (let index = 0; index < current.length; index++) {
    if (current[index].index !== next[index].index) return false;
    if (Math.abs(current[index].position - next[index].position) > 0.5) return false;
  }
  return true;
}

function findBoundaryPosition(container: HTMLElement, orientation: 'horizontal' | 'vertical', leftPaneId: string, rightPaneId: string): number | null {
  const leftPane = findPaneElement(container, leftPaneId);
  if (leftPane) {
    return orientation === 'horizontal' ? leftPane.offsetLeft + leftPane.offsetWidth : leftPane.offsetTop + leftPane.offsetHeight;
  }

  const rightPane = findPaneElement(container, rightPaneId);
  if (!rightPane) return null;
  return orientation === 'horizontal' ? rightPane.offsetLeft : rightPane.offsetTop;
}

function findPaneElement(container: HTMLElement, paneId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`);
}

export type {
  ResizableSplitResizeStartEvent,
  ResizableSplitResizeMoveEvent,
  ResizableSplitResizeEndEvent,
  ResizableSplitRootProps,
};
