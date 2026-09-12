import { useWorkbench } from '../../contexts/workbench-context';

interface DeckBrowserContextValue {
  gridItemSize: number;
  gridSizeMax: number;
  gridSizeMin: number;
  gridSizeStep: number;
  setGridItemSize: (size: number) => void;
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
      slideBrowserMode,
    },
    actions: {
      setDeckBrowserGridItemSize,
      setSlideBrowserMode,
    },
  } = useWorkbench();

  return {
    gridItemSize: deckBrowserGridItemSize,
    gridSizeMax: deckBrowserGridSizeMax,
    gridSizeMin: deckBrowserGridSizeMin,
    gridSizeStep: deckBrowserGridSizeStep,
    setGridItemSize: setDeckBrowserGridItemSize,
    slideBrowserMode,
    setSlideBrowserMode,
  };
}
