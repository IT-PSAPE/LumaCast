import type { SlideBrowserContentVariant } from './use-deck-browser-view';
import type { SlideBrowserIntegrations } from './slide-browser-integrations';
import { SingleSlideGrid } from './single-slide-grid';
import { SingleSlideList } from './single-slide-list';
import { SlideTagManagerProvider } from './slide-tag-manager';

type SingleSlideContentVariant = Extract<SlideBrowserContentVariant, 'single-grid' | 'single-list'>;

interface SlideBrowserContentProps {
  variant: SingleSlideContentVariant;
  integrations: SlideBrowserIntegrations;
}

export function SlideBrowserContent({ variant, integrations }: SlideBrowserContentProps) {
  return (
    <SlideTagManagerProvider>
      {variant === 'single-grid'
        ? <SingleSlideGrid integrations={integrations} />
        : <SingleSlideList integrations={integrations} />}
    </SlideTagManagerProvider>
  );
}
