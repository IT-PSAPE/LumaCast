import { useMemo, type ReactNode } from 'react';
import { useDeckBrowserView } from '../../features/items/use-deck-browser-view';
import { ShowScreenContextProvider, type ShowScreenContextValue } from './screen-context-core';

export function ShowScreenContextBridge({ children }: { children: ReactNode }) {
  const browser = useDeckBrowserView();
  const value = useMemo<ShowScreenContextValue>(() => ({
    meta: { screenId: 'show' },
    state: { browser },
  }), [browser]);

  return <ShowScreenContextProvider value={value}>{children}</ShowScreenContextProvider>;
}
