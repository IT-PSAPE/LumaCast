import type { SlideBrowserContentVariant } from './use-deck-browser-view';
import { SingleSlideGrid } from './single-slide-grid';
import { SingleSlideList } from './single-slide-list';

type SingleSlideContentVariant = Extract<SlideBrowserContentVariant, 'single-grid' | 'single-list'>;

interface SlideBrowserContentProps {
  variant: SingleSlideContentVariant;
}

export function SlideBrowserContent({ variant }: SlideBrowserContentProps) {
  return variant === 'single-grid' ? <SingleSlideGrid /> : <SingleSlideList />;
}
