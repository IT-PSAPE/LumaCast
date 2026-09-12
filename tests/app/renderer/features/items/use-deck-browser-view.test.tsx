import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const fakes = vi.hoisted(() => ({
  navigation: {
    currentItem: { id: 'item-1', title: 'Deck' } as object | null,
    isDetachedDeckBrowser: false,
  },
  deckBrowser: { slideBrowserMode: 'grid' as 'grid' | 'list' },
  workbench: { state: { workbenchMode: 'show' } },
  sequence: { items: [{ entryId: 'entry-1' }] as unknown[] },
}));

vi.mock('../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => fakes.navigation,
}));
vi.mock('../../../../../app/renderer/features/items/deck-browser-context', () => ({
  useDeckBrowser: () => fakes.deckBrowser,
}));
vi.mock('../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => fakes.workbench,
}));
vi.mock('../../../../../app/renderer/features/items/use-playlist-deck-sequence', () => ({
  usePlaylistDeckSequence: () => fakes.sequence,
}));

import { useDeckBrowserView } from '../../../../../app/renderer/features/items/use-deck-browser-view';

beforeEach(() => {
  fakes.navigation.currentItem = { id: 'item-1', title: 'Deck' };
  fakes.navigation.isDetachedDeckBrowser = false;
  fakes.deckBrowser.slideBrowserMode = 'grid';
  fakes.workbench.state.workbenchMode = 'show';
  fakes.sequence.items = [{ entryId: 'entry-1' }];
});

describe('useDeckBrowserView', () => {
  it('always shows playlist tabs above the selected item on the show page', () => {
    const { result } = renderHook(() => useDeckBrowserView());

    expect(result.current.showPlaylistTabs).toBe(true);
    expect(result.current.contentVariant).toBe('single-grid');
  });

  it('preserves the Grid/List choice for the selected item content', () => {
    fakes.deckBrowser.slideBrowserMode = 'list';

    const { result } = renderHook(() => useDeckBrowserView());

    expect(result.current.showPlaylistTabs).toBe(true);
    expect(result.current.contentVariant).toBe('single-list');
  });

  it('hides tabs and renders the empty state when no playlist item is selected', () => {
    fakes.navigation.currentItem = null;

    const { result } = renderHook(() => useDeckBrowserView());

    expect(result.current.showPlaylistTabs).toBe(false);
    expect(result.current.contentVariant).toBe('empty');
  });

  it('hides playlist tabs in a detached deck browser', () => {
    fakes.navigation.isDetachedDeckBrowser = true;

    const { result } = renderHook(() => useDeckBrowserView());

    expect(result.current.showPlaylistTabs).toBe(false);
    expect(result.current.contentVariant).toBe('single-grid');
  });
});
