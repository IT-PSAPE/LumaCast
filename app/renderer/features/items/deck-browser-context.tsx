import { useWorkbench } from '../../contexts/workbench-context';

interface DeckBrowserContextValue {
  gridItemSize: number;
  gridSizeMax: number;
  gridSizeMin: number;
  gridSizeStep: number;
  playlistBrowserMode: ReturnType<typeof useWorkbench>['state']['playlistBrowserMode'];
  setGridItemSize: (size: number) => void;
  setPlaylistBrowserMode: (mode: ReturnType<typeof useWorkbench>['state']['playlistBrowserMode']) => void;
  slideBrowserMode: ReturnType<typeof useWorkbench>['state']['slideBrowserMode'];
  setSlideBrowserMode: (mode: ReturnType<typeof useWorkbench>['state']['slideBrowserMode']) => void;
}

export function useDeckBrowser(): DeckBrowserContextValue {
  const {
    state: {
      deckBrowserGridItemSize,
      deckBrowserGridSizeMax,
      deckBrowserGridSizeMin,
      deckBrowserGridSizeStep,
      playlistBrowserMode,
      slideBrowserMode,
    },
    actions: {
      setDeckBrowserGridItemSize,
      setPlaylistBrowserMode,
      setSlideBrowserMode,
    },
  } = useWorkbench();

  return {
    gridItemSize: deckBrowserGridItemSize,
    gridSizeMax: deckBrowserGridSizeMax,
    gridSizeMin: deckBrowserGridSizeMin,
    gridSizeStep: deckBrowserGridSizeStep,
    playlistBrowserMode,
    setGridItemSize: setDeckBrowserGridItemSize,
    setPlaylistBrowserMode,
    slideBrowserMode,
    setSlideBrowserMode,
  };
}
