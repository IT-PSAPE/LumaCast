import { forwardRef, useId, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@renderer/utils/cn';
import {
  ScrollAreaRootContext,
  type ScrollAreaRootContextValue,
  type ScrollAreaRootState,
} from './context';
import {
  contains,
  DEFAULT_COORDS,
  DEFAULT_HIDDEN_STATE,
  DEFAULT_OVERFLOW_EDGES,
  DEFAULT_SIZE,
  getOffset,
  mergeRefs,
  SCROLL_TIMEOUT,
  useStableCallback,
  useTimeout,
  type Coords,
  type Size,
} from './utils';

export type OverflowEdgeThreshold =
  | number
  | Partial<{ xStart: number; xEnd: number; yStart: number; yEnd: number }>;

export type ScrollPadding = number | `${number}%`;

export interface ScrollAreaRootProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Threshold in pixels before the overflow-edge data attributes flip on. */
  overflowEdgeThreshold?: OverflowEdgeThreshold;
  /**
   * Padding (px or '%') applied when useScrollAreaActiveItem scrolls a child into view.
   * Custom to lumacast — Base UI does not ship this.
   */
  scrollPadding?: ScrollPadding;
  children?: React.ReactNode;
}

export const ScrollAreaRoot = forwardRef<HTMLDivElement, ScrollAreaRootProps>(function ScrollAreaRoot(
  { className, overflowEdgeThreshold: overflowEdgeThresholdProp, scrollPadding = 0, style, children, ...elementProps },
  forwardedRef,
) {
  const overflowEdgeThreshold = normalizeOverflowEdgeThreshold(overflowEdgeThresholdProp);
  const rootId = useId();

  const scrollYTimeout = useTimeout();
  const scrollXTimeout = useTimeout();

  const [hovering, setHovering] = useState(false);
  const [scrollingX, setScrollingX] = useState(false);
  const [scrollingY, setScrollingY] = useState(false);
  const [touchModality, setTouchModality] = useState(false);
  const [hasMeasuredScrollbar, setHasMeasuredScrollbar] = useState(false);
  const [cornerSize, setCornerSize] = useState<Size>(DEFAULT_SIZE);
  const [thumbSize, setThumbSize] = useState<Size>(DEFAULT_SIZE);
  const [overflowEdges, setOverflowEdges] = useState(DEFAULT_OVERFLOW_EDGES);
  const [hiddenState, setHiddenState] = useState(DEFAULT_HIDDEN_STATE);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const scrollbarYRef = useRef<HTMLDivElement | null>(null);
  const scrollbarXRef = useRef<HTMLDivElement | null>(null);
  const thumbYRef = useRef<HTMLDivElement | null>(null);
  const thumbXRef = useRef<HTMLDivElement | null>(null);
  const cornerRef = useRef<HTMLDivElement | null>(null);

  const thumbDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const startScrollLeftRef = useRef(0);
  const currentOrientationRef = useRef<'vertical' | 'horizontal'>('vertical');
  const scrollPositionRef = useRef(DEFAULT_COORDS);

  const scrollPaddingRef = useRef<ScrollPadding>(scrollPadding);
  scrollPaddingRef.current = scrollPadding;

  const handleScroll = useStableCallback((scrollPosition: Coords) => {
    const offsetX = scrollPosition.x - scrollPositionRef.current.x;
    const offsetY = scrollPosition.y - scrollPositionRef.current.y;
    scrollPositionRef.current = scrollPosition;

    if (offsetY !== 0) {
      setScrollingY(true);
      scrollYTimeout.start(SCROLL_TIMEOUT, () => setScrollingY(false));
    }
    if (offsetX !== 0) {
      setScrollingX(true);
      scrollXTimeout.start(SCROLL_TIMEOUT, () => setScrollingX(false));
    }
  });

  const handlePointerDown = useStableCallback((event: ReactPointerEvent) => {
    if (event.button !== 0) return;

    thumbDraggingRef.current = true;
    startYRef.current = event.clientY;
    startXRef.current = event.clientX;
    currentOrientationRef.current = event.currentTarget.getAttribute('data-orientation') as
      | 'vertical'
      | 'horizontal';

    if (viewportRef.current) {
      startScrollTopRef.current = viewportRef.current.scrollTop;
      startScrollLeftRef.current = viewportRef.current.scrollLeft;
    }
    if (thumbYRef.current && currentOrientationRef.current === 'vertical') {
      thumbYRef.current.setPointerCapture(event.pointerId);
    }
    if (thumbXRef.current && currentOrientationRef.current === 'horizontal') {
      thumbXRef.current.setPointerCapture(event.pointerId);
    }
  });

  const handlePointerMove = useStableCallback((event: ReactPointerEvent) => {
    if (!thumbDraggingRef.current) return;

    const deltaY = event.clientY - startYRef.current;
    const deltaX = event.clientX - startXRef.current;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const scrollableContentHeight = viewport.scrollHeight;
    const viewportHeight = viewport.clientHeight;
    const scrollableContentWidth = viewport.scrollWidth;
    const viewportWidth = viewport.clientWidth;

    if (thumbYRef.current && scrollbarYRef.current && currentOrientationRef.current === 'vertical') {
      const scrollbarYOffset = getOffset(scrollbarYRef.current, 'padding', 'y');
      const thumbYOffset = getOffset(thumbYRef.current, 'margin', 'y');
      const thumbHeight = thumbYRef.current.offsetHeight;
      const maxThumbOffsetY =
        scrollbarYRef.current.offsetHeight - thumbHeight - scrollbarYOffset - thumbYOffset;
      const scrollRatioY = deltaY / maxThumbOffsetY;
      viewport.scrollTop =
        startScrollTopRef.current + scrollRatioY * (scrollableContentHeight - viewportHeight);
      event.preventDefault();
      setScrollingY(true);
      scrollYTimeout.start(SCROLL_TIMEOUT, () => setScrollingY(false));
    }

    if (thumbXRef.current && scrollbarXRef.current && currentOrientationRef.current === 'horizontal') {
      const scrollbarXOffset = getOffset(scrollbarXRef.current, 'padding', 'x');
      const thumbXOffset = getOffset(thumbXRef.current, 'margin', 'x');
      const thumbWidth = thumbXRef.current.offsetWidth;
      const maxThumbOffsetX =
        scrollbarXRef.current.offsetWidth - thumbWidth - scrollbarXOffset - thumbXOffset;
      const scrollRatioX = deltaX / maxThumbOffsetX;
      viewport.scrollLeft =
        startScrollLeftRef.current + scrollRatioX * (scrollableContentWidth - viewportWidth);
      event.preventDefault();
      setScrollingX(true);
      scrollXTimeout.start(SCROLL_TIMEOUT, () => setScrollingX(false));
    }
  });

  const handlePointerUp = useStableCallback((event: ReactPointerEvent) => {
    thumbDraggingRef.current = false;
    if (thumbYRef.current && currentOrientationRef.current === 'vertical') {
      thumbYRef.current.releasePointerCapture(event.pointerId);
    }
    if (thumbXRef.current && currentOrientationRef.current === 'horizontal') {
      thumbXRef.current.releasePointerCapture(event.pointerId);
    }
  });

  function handleTouchModalityChange(event: ReactPointerEvent) {
    setTouchModality(event.pointerType === 'touch');
  }

  function handlePointerEnterOrMove(event: ReactPointerEvent) {
    handleTouchModalityChange(event);
    if (event.pointerType !== 'touch') {
      const isTargetRootChild = contains(rootRef.current, event.target as Element);
      setHovering(isTargetRootChild);
    }
  }

  const state: ScrollAreaRootState = useMemo(
    () => ({
      scrolling: scrollingX || scrollingY,
      hasOverflowX: !hiddenState.x,
      hasOverflowY: !hiddenState.y,
      overflowXStart: overflowEdges.xStart,
      overflowXEnd: overflowEdges.xEnd,
      overflowYStart: overflowEdges.yStart,
      overflowYEnd: overflowEdges.yEnd,
      cornerHidden: hiddenState.corner,
    }),
    [scrollingX, scrollingY, hiddenState.x, hiddenState.y, hiddenState.corner, overflowEdges],
  );

  const contextValue: ScrollAreaRootContextValue = useMemo(
    () => ({
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleScroll,
      cornerSize,
      setCornerSize,
      thumbSize,
      setThumbSize,
      hasMeasuredScrollbar,
      setHasMeasuredScrollbar,
      touchModality,
      cornerRef,
      scrollingX,
      setScrollingX,
      scrollingY,
      setScrollingY,
      hovering,
      setHovering,
      viewportRef,
      rootRef,
      scrollbarYRef,
      scrollbarXRef,
      thumbYRef,
      thumbXRef,
      rootId,
      hiddenState,
      setHiddenState,
      overflowEdges,
      setOverflowEdges,
      viewportState: state,
      overflowEdgeThreshold,
      scrollPaddingRef,
    }),
    [
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handleScroll,
      cornerSize,
      thumbSize,
      hasMeasuredScrollbar,
      touchModality,
      scrollingX,
      scrollingY,
      hovering,
      rootId,
      hiddenState,
      overflowEdges,
      state,
      overflowEdgeThreshold,
    ],
  );

  const inlineStyle: CSSProperties = {
    position: 'relative',
    '--scroll-area-corner-height': `${cornerSize.height}px`,
    '--scroll-area-corner-width': `${cornerSize.width}px`,
    ...style,
  } as CSSProperties;

  return (
    <ScrollAreaRootContext.Provider value={contextValue}>
      <div
        {...elementProps}
        ref={mergeRefs(forwardedRef, rootRef)}
        role="presentation"
        className={cn('relative size-full min-h-0', className)}
        style={inlineStyle}
        data-scrolling={state.scrolling ? '' : undefined}
        data-has-overflow-x={state.hasOverflowX ? '' : undefined}
        data-has-overflow-y={state.hasOverflowY ? '' : undefined}
        data-overflow-x-start={state.overflowXStart ? '' : undefined}
        data-overflow-x-end={state.overflowXEnd ? '' : undefined}
        data-overflow-y-start={state.overflowYStart ? '' : undefined}
        data-overflow-y-end={state.overflowYEnd ? '' : undefined}
        onPointerEnter={handlePointerEnterOrMove}
        onPointerMove={handlePointerEnterOrMove}
        onPointerDown={handleTouchModalityChange}
        onPointerLeave={() => setHovering(false)}
      >
        {children}
      </div>
    </ScrollAreaRootContext.Provider>
  );
});

function normalizeOverflowEdgeThreshold(
  threshold: OverflowEdgeThreshold | undefined,
): { xStart: number; xEnd: number; yStart: number; yEnd: number } {
  if (typeof threshold === 'number') {
    const value = Math.max(0, threshold);
    return { xStart: value, xEnd: value, yStart: value, yEnd: value };
  }
  return {
    xStart: Math.max(0, threshold?.xStart ?? 0),
    xEnd: Math.max(0, threshold?.xEnd ?? 0),
    yStart: Math.max(0, threshold?.yStart ?? 0),
    yEnd: Math.max(0, threshold?.yEnd ?? 0),
  };
}
