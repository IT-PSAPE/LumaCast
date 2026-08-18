import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Id } from '@lumacast/kernel';
import type { ItemType, PresentationTheme } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import { WorkbenchProvider } from './contexts/workbench-context';
import { CreateItemProvider, useCreateItem } from './features/items/create-item';

// Covers #219 item-model refactor decision D9: the create-dialog flow no
// longer carries a collectionId/groupId — creation is `{type, name, theme,
// optional playlist+position}` only, and this exercises the real dialog
// component (not a reimplementation of its logic), so a regression in the
// picker wiring (create-item.tsx) fails here.

const mocks = vi.hoisted(() => ({
  cast: { value: null as unknown },
  project: { value: null as unknown },
  navigation: { value: null as unknown },
  lyricEditor: { value: null as unknown },
}));

vi.mock('./contexts/app-context', () => ({
  useCast: () => mocks.cast.value,
}));

vi.mock('./contexts/use-project-content', () => ({
  useProjectContent: () => mocks.project.value,
}));

vi.mock('./contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('./features/items/lyric-editor', () => ({
  useLyricEditor: () => mocks.lyricEditor.value,
}));

// ─── Fixtures ────────────────────────────────────────────────────────

function makePresentationTheme(id: Id, name: string): PresentationTheme {
  const now = new Date().toISOString();
  return { id, slideId: `${id}:slide`, name, width: 1920, height: 1080, order: 0, createdAt: now, updatedAt: now, elements: [] };
}

function makeSnapshot(partial: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    presentations: [], lyrics: [], talks: [], slides: [], talkScriptBlocks: [], slideElements: [],
    mediaAssets: [], overlays: [], presentationThemes: [], lyricThemes: [], talkThemes: [], overlayThemes: [],
    stages: [], playlists: [], playlistEntries: [], cues: [], macros: [], triggerBindings: [],
    ...partial,
  };
}

function Harness({ type }: { type: ItemType }) {
  const { open } = useCreateItem();
  useEffect(() => { open(type); }, [open, type]);
  return null;
}

function renderDialog(type: ItemType, options: {
  snapshot?: AppSnapshot;
  presentationThemes?: PresentationTheme[];
  lyricThemes?: PresentationTheme[];
  talkThemes?: PresentationTheme[];
  createItem?: ReturnType<typeof vi.fn>;
} = {}) {
  const createItem = options.createItem ?? vi.fn().mockResolvedValue(undefined);
  const openLyricEditor = vi.fn();

  mocks.cast.value = { snapshot: options.snapshot ?? makeSnapshot() };
  mocks.project.value = {
    presentationThemes: options.presentationThemes ?? [],
    lyricThemes: options.lyricThemes ?? [],
    talkThemes: options.talkThemes ?? [],
    resolveItemRef: () => null,
  };
  mocks.navigation.value = { createItem };
  mocks.lyricEditor.value = { open: openLyricEditor };

  render(
    <WorkbenchProvider>
      <CreateItemProvider>
        <Harness type={type} />
      </CreateItemProvider>
    </WorkbenchProvider>,
  );

  return { createItem, openLyricEditor };
}

async function selectFieldOption(triggerName: RegExp | string, optionName: RegExp | string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: triggerName }), { button: 0 });
  fireEvent.click(screen.getByRole('menuitem', { name: optionName }));
}

afterEach(() => {
  cleanup();
});

describe('create-item dialog', () => {
  it('renders the create-item dialog region with no collection or group picker', () => {
    renderDialog('presentation');

    expect(document.querySelector('[data-ui-region="create-item-dialog"]')).toBeTruthy();
    expect(screen.queryByText(/collection/i)).toBeNull();
    expect(screen.queryByText(/group/i)).toBeNull();
  });

  it('creates an unthemed, unplaylisted presentation from the name field alone', async () => {
    const { createItem } = renderDialog('presentation');

    fireEvent.change(screen.getByPlaceholderText('New Presentation'), { target: { value: 'Deck' } });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await act(async () => {});

    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledWith({ type: 'presentation', name: 'Deck', themeId: undefined, playlistId: undefined, position: undefined });
    expect(document.querySelector('[data-ui-region="create-item-dialog"]')).toBeNull();
  });

  it('passes the selected theme id when a compatible theme is chosen', async () => {
    const theme = makePresentationTheme('theme-1', 'Bold');
    const { createItem } = renderDialog('presentation', { presentationThemes: [theme] });

    fireEvent.change(screen.getByPlaceholderText('New Presentation'), { target: { value: 'Deck' } });
    await selectFieldOption('Theme', 'Bold');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await act(async () => {});

    expect(createItem).toHaveBeenCalledWith({ type: 'presentation', name: 'Deck', themeId: 'theme-1', playlistId: undefined, position: undefined });
  });

  it('passes the selected playlist and an explicitly chosen position', async () => {
    const snapshot = makeSnapshot({
      playlists: [{ id: 'pl-1', name: 'Set List', order: 0, createdAt: '', updatedAt: '' }],
      playlistEntries: [],
    });
    const { createItem } = renderDialog('presentation', { snapshot });

    fireEvent.change(screen.getByPlaceholderText('New Presentation'), { target: { value: 'Deck' } });
    await selectFieldOption('Add to playlist', 'Set List');
    await selectFieldOption('Position', 'At the end');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await act(async () => {});

    expect(createItem).toHaveBeenCalledWith({ type: 'presentation', name: 'Deck', themeId: undefined, playlistId: 'pl-1', position: 0 });
  });

  it('hides the theme and playlist pickers entirely when none are available', () => {
    renderDialog('talk');

    expect(screen.queryByText('Theme')).toBeNull();
    expect(screen.queryByText('Add to playlist')).toBeNull();
    expect(screen.queryByText('Position')).toBeNull();
  });

  it('creates a lyric via "Save and edit" and opens the lyric editor', async () => {
    const { createItem, openLyricEditor } = renderDialog('lyric');

    fireEvent.change(screen.getByPlaceholderText('New Lyric'), { target: { value: 'My Song' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and edit' }));
    await act(async () => {});

    expect(createItem).toHaveBeenCalledWith({ type: 'lyric', name: 'My Song', themeId: undefined, playlistId: undefined, position: undefined });
    expect(openLyricEditor).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-ui-region="create-item-dialog"]')).toBeNull();
  });

  it('keeps the dialog open and reports nothing created when the operation rejects', async () => {
    const createItem = vi.fn().mockRejectedValue(new Error('boom'));
    renderDialog('presentation', { createItem });

    fireEvent.change(screen.getByPlaceholderText('New Presentation'), { target: { value: 'Deck' } });
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await act(async () => {});

    expect(createItem).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-ui-region="create-item-dialog"]')).toBeTruthy();
  });
});
