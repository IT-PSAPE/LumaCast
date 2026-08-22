import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type HTMLAttributes, type Key, type MutableRefObject, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const DEFAULT_OVERSCAN = 6;

interface VirtualizedListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  getScrollElement: () => HTMLElement | null;
  estimateSize: number | ((index: number) => number);
  overscan?: number;
  activeIndex?: number | null;
  retainedIndexes?: number[];
  itemGap?: number;
  scrollToIndexRef?: MutableRefObject<((index: number) => void) | null>;
}

export function VirtualizedList({
  children,
  getScrollElement,
  estimateSize,
  overscan = DEFAULT_OVERSCAN,
  activeIndex = null,
  retainedIndexes = [],
  itemGap = 0,
  scrollToIndexRef,
  className,
  ...rest
}: VirtualizedListProps) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const previousActiveItemRef = useRef<{ index: number; element: HTMLElement } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);

  useEffect(() => {
    const current = getScrollElement();
    if (current !== scrollElement) {
      setScrollElement(current);
      return;
    }
    if (current) return;

    let frameId = window.requestAnimationFrame(() => {
      const next = getScrollElement();
      if (next !== scrollElement) setScrollElement(next);
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [getScrollElement, scrollElement]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollElement,
    estimateSize: typeof estimateSize === 'function' ? estimateSize : () => estimateSize,
    overscan,
    getItemKey: (index) => getNodeKey(items[index], index),
  });
  const scrollToVirtualIndex = useCallback((index: number) => {
    virtualizer.scrollToIndex(index, { align: 'auto' });
  }, [virtualizer]);

  useEffect(() => {
    if (!scrollToIndexRef) return;
    scrollToIndexRef.current = scrollToVirtualIndex;
    return () => {
      if (scrollToIndexRef.current === scrollToVirtualIndex) scrollToIndexRef.current = null;
    };
  }, [scrollToIndexRef, scrollToVirtualIndex]);

  useEffect(() => {
    if (activeIndex == null || activeIndex < 0 || activeIndex >= items.length) {
      previousActiveItemRef.current = null;
      return;
    }
    if (!scrollElement) return;
    if (previousActiveItemRef.current?.index === activeIndex && previousActiveItemRef.current.element === scrollElement) return;
    previousActiveItemRef.current = { index: activeIndex, element: scrollElement };
    scrollToVirtualIndex(activeIndex);
  }, [activeIndex, items.length, scrollElement, scrollToVirtualIndex]);

  const virtualItems = virtualizer.getVirtualItems();
  const seen = new Set<number>();
  const renderedItems = [...virtualItems];
  const retainedIndexSet = new Set(retainedIndexes);
  if (focusedIndex != null) retainedIndexSet.add(focusedIndex);

  for (const virtualItem of virtualItems) seen.add(virtualItem.index);

  for (const retainedIndex of retainedIndexSet) {
    if (retainedIndex < 0 || retainedIndex >= items.length || seen.has(retainedIndex)) continue;
    const retainedItem = virtualizer.measurementsCache[retainedIndex];
    if (!retainedItem) continue;
    renderedItems.push(retainedItem);
    seen.add(retainedIndex);
  }

  renderedItems.sort((a, b) => a.start - b.start || a.index - b.index);

  function handleFocusCapture(event: FocusEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-index]');
    if (!row) return;
    const index = Number(row.dataset.index);
    if (!Number.isNaN(index)) setFocusedIndex(index);
  }

  function handleBlurCapture() {
    window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (!(activeElement instanceof HTMLElement)) {
        setFocusedIndex(null);
        return;
      }
      const row = activeElement.closest<HTMLElement>('[data-index]');
      if (row && containerRef.current?.contains(row)) {
        const index = Number(row.dataset.index);
        setFocusedIndex(Number.isNaN(index) ? null : index);
        return;
      }
      setFocusedIndex(null);
    });
  }

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      {...rest}
    >
      {renderedItems.map((virtualItem) => {
        const child = items[virtualItem.index];
        const isLast = virtualItem.index === items.length - 1;
        const isRetained = retainedIndexSet.has(virtualItem.index);
        return (
          <div
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            data-index={virtualItem.index}
            data-retained={isRetained || undefined}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`,
              contain: 'layout paint',
              willChange: 'transform',
              paddingBottom: !isLast && itemGap > 0 ? itemGap : undefined,
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}

function getNodeKey(node: ReactNode, index: number): Key {
  if (isValidElement(node) && node.key != null) return node.key;
  return index;
}
