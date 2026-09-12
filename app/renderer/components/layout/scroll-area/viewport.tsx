import { forwardRef, useCallback, type HTMLAttributes, type Ref } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';
import { cn } from '@renderer/utils/cn';
import { useScrollAreaActiveItemContext } from './context';

export interface ScrollAreaViewportProps extends HTMLAttributes<HTMLDivElement> {}

export const ScrollAreaViewport = forwardRef<HTMLDivElement, ScrollAreaViewportProps>(function ScrollAreaViewport(
  { className, ...elementProps },
  forwardedRef,
) {
  const { viewportRef } = useScrollAreaActiveItemContext();

  // Stable identity: a fresh ref callback each render would detach/reattach the node,
  // and the virtualized lists poll this element through `getScrollElement()`.
  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef, viewportRef],
  );

  return <BaseScrollArea.Viewport {...elementProps} ref={ref} className={cn('size-full', className)} />;
});

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}
