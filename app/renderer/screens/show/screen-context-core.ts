import { createScreenContext } from '../../contexts/create-screen-context';
import type { useDeckBrowserView } from '../../features/items/use-deck-browser-view';

export interface ShowScreenContextValue {
  meta: {
    screenId: 'show';
  };
  state: {
    browser: ReturnType<typeof useDeckBrowserView>;
  };
}

export const [ShowScreenContextProvider, useShowScreen] = createScreenContext<ShowScreenContextValue>('ShowScreenContext');
