import { useMemo } from 'react';
import { useNavigation } from '../../contexts/navigation-context';
import { useDeckBrowser } from './deck-browser-context';
import { useWorkbench } from '../../contexts/workbench-context';
import { usePlaylistDeckSequence, type PlaylistDeckSequenceItem } from './use-playlist-deck-sequence';

export type SlideBrowserContentVariant =
  | 'continuous-grid'
  | 'continuous-list'
  | 'empty'
  | 'single-grid'
  | 'single-list';

export type SlideBrowserHeaderVariant = 'hidden' | 'current' | 'tabs' | 'continuous';

interface SlideBrowserView {
  contentVariant: SlideBrowserContentVariant;
  headerVariant: SlideBrowserHeaderVariant;
  items: PlaylistDeckSequenceItem[];
}

export function useDeckBrowserView(): SlideBrowserView {
  const { currentItem, isDetachedDeckBrowser } = useNavigation();
  const { slideBrowserMode, playlistBrowserMode } = useDeckBrowser();
  const { state: { workbenchMode } } = useWorkbench();
  const { items } = usePlaylistDeckSequence();

  return useMemo(() => {
    const hasCurrentItem = Boolean(currentItem);
    const showPlaylistBrowserModes = workbenchMode === 'show'
      && !isDetachedDeckBrowser
      && (slideBrowserMode === 'grid' || slideBrowserMode === 'list');
    const hasItems = items.length > 0;
    const isContinuousPlaylist = playlistBrowserMode === 'continuous' && showPlaylistBrowserModes && hasItems;
    const headerVariant: SlideBrowserHeaderVariant = !showPlaylistBrowserModes || !hasItems || (!hasCurrentItem && !isContinuousPlaylist)
      ? 'hidden'
      : playlistBrowserMode === 'tabs'
        ? 'tabs'
        : playlistBrowserMode === 'continuous'
          ? 'continuous'
          : 'current';
    const contentVariant: SlideBrowserContentVariant = isContinuousPlaylist
      ? slideBrowserMode === 'grid' ? 'continuous-grid' : 'continuous-list'
      : !hasCurrentItem
        ? 'empty'
        : slideBrowserMode === 'grid'
          ? 'single-grid'
          : 'single-list';
    return {
      contentVariant,
      headerVariant,
      items,
    };
  }, [currentItem, slideBrowserMode, playlistBrowserMode, workbenchMode, isDetachedDeckBrowser, items]);
}
