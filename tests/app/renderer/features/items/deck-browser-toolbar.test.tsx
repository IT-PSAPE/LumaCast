import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeckBrowserToolbar } from '../../../../../app/renderer/features/items/deck-browser-toolbar';

const overlayStack = {
  rootElement: null as HTMLElement | null,
  stack: [] as string[],
  baseZIndex: 1000,
  register: vi.fn(),
  unregister: vi.fn(),
};

const mocks = vi.hoisted(() => ({
  createSlide: vi.fn(),
  openLyricEditor: vi.fn(),
  navigation: { currentItem: null as unknown, currentItemRef: null as unknown },
}));

vi.mock('@renderer/contexts/workbench-context', () => ({
  useWorkbench: () => ({ state: {}, actions: {}, overlayStack }),
}));

vi.mock('../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation,
}));

vi.mock('../../../../../app/renderer/contexts/slide-context', () => ({
  useSlides: () => ({ createSlide: mocks.createSlide }),
}));

vi.mock('../../../../../app/renderer/features/items/deck-browser-context', () => ({
  useDeckBrowser: () => ({
    slideBrowserMode: 'grid',
    setSlideBrowserMode: vi.fn(),
    gridItemSize: 3,
    gridSizeMin: 2,
    gridSizeMax: 4,
    gridSizeStep: 1,
    setGridItemSize: vi.fn(),
  }),
}));

vi.mock('../../../../../app/renderer/features/items/lyric-editor', () => ({
  useLyricEditor: () => ({ open: mocks.openLyricEditor, close: vi.fn() }),
}));

vi.mock('../../../../../app/renderer/features/items/slide-timing-modal', () => ({
  SlideTimingModal: () => null,
}));

async function settle() {
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 50); }); });
}

async function openToolbarMenu() {
  render(<DeckBrowserToolbar items={[]} showPlaylistTabs={false} />);
  await reopenToolbarMenu();
}

async function reopenToolbarMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'View options' }));
  await settle();
}

beforeEach(() => {
  mocks.navigation.currentItem = null;
  mocks.navigation.currentItemRef = null;
  overlayStack.rootElement = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeckBrowserToolbar — item-dependent actions', () => {
  it('disables "Add slide" and "Open lyric editor" with no current item', async () => {
    await openToolbarMenu();

    // A disabled item ignores clicks without closing the menu (Base UI), so
    // both can be checked for disabled-state and inertness in one session.
    expect(screen.getByText('Add slide').getAttribute('data-disabled')).toBe('');
    expect(screen.getByText('Open lyric editor').getAttribute('data-disabled')).toBe('');

    fireEvent.click(screen.getByText('Add slide'));
    fireEvent.click(screen.getByText('Open lyric editor'));
    expect(mocks.createSlide).not.toHaveBeenCalled();
    expect(mocks.openLyricEditor).not.toHaveBeenCalled();
  });

  it('enables "Add slide" for a current presentation but keeps "Open lyric editor" disabled', async () => {
    mocks.navigation.currentItem = { id: 'p1', title: 'Deck' };
    mocks.navigation.currentItemRef = { type: 'presentation', id: 'p1' };
    await openToolbarMenu();

    expect(screen.getByText('Add slide').getAttribute('data-disabled')).toBeNull();
    expect(screen.getByText('Open lyric editor').getAttribute('data-disabled')).toBe('');

    // A real (non-disabled) item closes the menu on click, so the disabled
    // "Open lyric editor" is exercised in a freshly reopened menu.
    fireEvent.click(screen.getByText('Add slide'));
    expect(mocks.createSlide).toHaveBeenCalledTimes(1);

    await reopenToolbarMenu();
    fireEvent.click(screen.getByText('Open lyric editor'));
    expect(mocks.openLyricEditor).not.toHaveBeenCalled();
  });

  it('enables both actions for a current lyric item', async () => {
    mocks.navigation.currentItem = { id: 'l1', title: 'Song' };
    mocks.navigation.currentItemRef = { type: 'lyric', id: 'l1' };
    await openToolbarMenu();

    expect(screen.getByText('Add slide').getAttribute('data-disabled')).toBeNull();
    expect(screen.getByText('Open lyric editor').getAttribute('data-disabled')).toBeNull();

    fireEvent.click(screen.getByText('Open lyric editor'));
    expect(mocks.openLyricEditor).toHaveBeenCalledTimes(1);
  });
});
