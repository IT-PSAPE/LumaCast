import { useMemo } from 'react';
import { useNavigation } from '../../contexts/navigation-context';
import { useDeckBrowser } from './deck-browser-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { usePlaylistDeckSequence, type PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

export type SlideBrowserContentVariant =
  | 'empty'
  | 'single-grid'
  | 'single-list';

interface SlideBrowserView {
  contentVariant: SlideBrowserContentVariant;
  showPlaylistTabs: boolean;
  items: PlaylistDeckSequenceItem[];
}

export function useDeckBrowserView(): SlideBrowserView {
  const { currentItem, isDetachedDeckBrowser } = useNavigation();
  const { slideBrowserMode } = useDeckBrowser();
  const { state: { workbenchMode } } = useWorkbench();
  const { items } = usePlaylistDeckSequence();

  return useMemo(() => {
    const showPlaylistTabs = Boolean(currentItem)
      && workbenchMode === 'show'
      && !isDetachedDeckBrowser
      && items.length > 0;
    const contentVariant: SlideBrowserContentVariant = !currentItem
      ? 'empty'
      : slideBrowserMode === 'grid'
        ? 'single-grid'
        : 'single-list';
    return {
      contentVariant,
      showPlaylistTabs,
      items,
    };
  }, [currentItem, slideBrowserMode, workbenchMode, isDetachedDeckBrowser, items]);
}
