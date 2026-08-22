import { Children, useMemo, type HTMLAttributes, type MutableRefObject, type ReactNode } from 'react';
import { cn } from '@renderer/utils/cn';
import { VirtualizedList } from './virtualized-list';

interface ThumbnailGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style' | 'children'> {
  columns: number;
  children: ReactNode;
  className?: string;
}

export function ThumbnailGrid({ columns, children, className, ...rest }: ThumbnailGridProps) {
  return (
    <div className={cn('grid gap-1.5', className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} {...rest} >
      {children}
    </div>
  );
}

interface VirtualizedThumbnailGridProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'style'> {
  columns: number;
  children: ReactNode;
  getScrollElement: () => HTMLElement | null;
  estimateRowSize: number;
  activeIndex?: number | null;
  retainedIndexes?: number[];
  overscan?: number;
  containerClassName?: string;
  scrollToIndexRef?: MutableRefObject<((index: number) => void) | null>;
}

export function VirtualizedThumbnailGrid({
  columns,
  children,
  getScrollElement,
  estimateRowSize,
  activeIndex = null,
  retainedIndexes = [],
  overscan,
  className,
  containerClassName,
  scrollToIndexRef,
  ...rest
}: VirtualizedThumbnailGridProps) {
  const items = useMemo(() => Children.toArray(children), [children]);

  const rows = useMemo(() => {
    const result: ReactNode[] = [];
    for (let index = 0; index < items.length; index += columns) {
      result.push(
        <ThumbnailGrid key={`row-${index}`} columns={columns} className={className}>
          {items.slice(index, index + columns)}
        </ThumbnailGrid>,
      );
    }
    return result;
  }, [className, columns, items]);

  const activeRowIndex = activeIndex == null || activeIndex < 0 ? null : Math.floor(activeIndex / columns);
  const retainedRowIndexes = useMemo(
    () => retainedIndexes.filter((index) => index >= 0).map((index) => Math.floor(index / columns)),
    [columns, retainedIndexes],
  );

  return (
    <VirtualizedList
      getScrollElement={getScrollElement}
      estimateSize={estimateRowSize}
      overscan={overscan}
      activeIndex={activeRowIndex}
      retainedIndexes={retainedRowIndexes}
      itemGap={6}
      scrollToIndexRef={scrollToIndexRef}
      className={containerClassName}
      {...rest}
    >
      {rows}
    </VirtualizedList>
  );
}
