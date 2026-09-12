import { forwardRef, type HTMLAttributes } from 'react';
import { ScrollArea as BaseScrollArea } from '@base-ui/react/scroll-area';

export interface ScrollAreaContentProps extends HTMLAttributes<HTMLDivElement> {}

export const ScrollAreaContent = forwardRef<HTMLDivElement, ScrollAreaContentProps>(function ScrollAreaContent(
  props,
  forwardedRef,
) {
  return <BaseScrollArea.Content {...props} ref={forwardedRef} />;
});
