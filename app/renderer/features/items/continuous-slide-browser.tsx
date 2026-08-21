import { EmptyState } from '../../components/display/empty-state';
import type { SlideBrowserContentVariant } from './use-deck-browser-view';
import type { PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';
import { ContinuousSlideGridView } from './continuous-slide-grid-view';
import { ContinuousSlideListView } from './continuous-slide-list-view';

type ContinuousSlideContentVariant = Extract<SlideBrowserContentVariant, 'continuous-grid' | 'continuous-list'>;

interface ContinuousSlideBrowserProps {
  items: PlaylistDeckSequenceItem[];
  variant: ContinuousSlideContentVariant;
}

export function ContinuousSlideBrowser({ items, variant }: ContinuousSlideBrowserProps) {
  if (items.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Title>No playlist items available.</EmptyState.Title>
      </EmptyState.Root>
    );
  }

  return variant === 'continuous-grid'
    ? <ContinuousSlideGridView items={items} />
    : <ContinuousSlideListView items={items} />;
}
