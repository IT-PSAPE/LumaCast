import { ScrollAreaRoot } from './root';
import { ScrollAreaViewport } from './viewport';
import { ScrollAreaScrollbar } from './scrollbar';
import { ScrollAreaThumb } from './thumb';
import { ScrollAreaContent } from './content';
import { ScrollAreaCorner } from './corner';

export const ScrollArea = {
  Root: ScrollAreaRoot,
  Viewport: ScrollAreaViewport,
  Scrollbar: ScrollAreaScrollbar,
  Thumb: ScrollAreaThumb,
  Content: ScrollAreaContent,
  Corner: ScrollAreaCorner,
};

export { ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb, ScrollAreaContent, ScrollAreaCorner };
export { useScrollAreaActiveItem } from './active-item';
export type { ScrollAreaRootProps, ScrollPadding, OverflowEdgeThreshold } from './root';
export type { ScrollAreaViewportProps } from './viewport';
export type { ScrollAreaScrollbarProps } from './scrollbar';
export type { ScrollAreaThumbProps } from './thumb';
export type { ScrollAreaContentProps } from './content';
export type { ScrollAreaCornerProps } from './corner';
