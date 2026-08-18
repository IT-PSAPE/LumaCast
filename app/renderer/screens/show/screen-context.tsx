import { useMemo, type ReactNode } from 'react';
import { useDeckBrowserView } from '../../features/items/use-deck-browser-view';
import { createScreenContext } from '../../contexts/create-screen-context';

interface ShowScreenContextValue {
  meta: {
    screenId: 'show';
  };
  state: {
    browser: ReturnType<typeof useDeckBrowserView>;
  };
}

const [ShowScreenContextProvider, useShowScreen] = createScreenContext<ShowScreenContextValue>('ShowScreenContext');

function ShowScreenContextBridge({ children }: { children: ReactNode }) {
  const browser = useDeckBrowserView();
  const value = useMemo<ShowScreenContextValue>(() => ({
    meta: { screenId: 'show' },
    state: { browser },
  }), [browser]);

  return <ShowScreenContextProvider value={value}>{children}</ShowScreenContextProvider>;
}

export function ShowScreenProvider({ children }: { children: ReactNode }) {
  return <ShowScreenContextBridge>{children}</ShowScreenContextBridge>;
}

export { useShowScreen };
