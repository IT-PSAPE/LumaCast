import { forwardRef, type HTMLAttributes } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';

export interface ScrollAreaCornerProps extends HTMLAttributes<HTMLDivElement> {}

export const ScrollAreaCorner = forwardRef<HTMLDivElement, ScrollAreaCornerProps>(function ScrollAreaCorner(
  props,
  forwardedRef,
) {
  return <BaseScrollArea.Corner {...props} ref={forwardedRef} />;
});
