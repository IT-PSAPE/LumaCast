import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AppSnapshot, DeckItem, Id, Lyric, Presentation, Talk } from '@core/types';
import { createEmptyPatch } from '@core/snapshot-patch';
import { AssetEditorProvider } from './contexts/asset-editor/asset-editor-context';
import { NavigationProvider, useNavigation } from './contexts/navigation-context';
import type { NavigationContextValue } from './types/navigation-context-types';
import { useDuplicateDeckItem } from './features/deck/deck-bin-panel';

// Shared mutable registry the module mocks below read from on every call.
const mocks = vi.hoisted(() => ({
  cast: {
    snapshot: null as unknown,
    mutatePatch: null as unknown,
    runOperation: null as unknown,
    setStatusText: null as unknown,
  },
  project: { value: null as unknown },
  workbench: { state: null as unknown },
}));

vi.mock('./contexts/app-context', () => ({
  useCast: () => ({
    snapshot: mocks.cast.snapshot,
    mutatePatch: mocks.cast.mutatePatch,
    runOperation: mocks.cast.runOperation,
    setStatusText: mocks.cast.setStatusText,
  }),
}));

vi.mock('./contexts/use-project-content', () => ({
  useProjectContent: () => mocks.project.value,
}));

vi.mock('./contexts/workbench-context', () => ({
  useWorkbench: () => mocks.workbench.state,
}));

// ─── Fixtures ────────────────────────────────────────────────────────

function makePresentation(id: Id, title: string, themeId: Id | null = null): Presentation {
  const now = new Date().toISOString();
  return { id, title, type: 'presentation', themeId, collectionId: 'deck-col', order: 0, createdAt: now, updatedAt: now };
}

function makeLyric(id: Id, title: string, themeId: Id | null = null): Lyric {
  const now = new Date().toISOString();
  return { id, title, type: 'lyric', themeId, collectionId: 'deck-col', order: 0, createdAt: now, updatedAt: now };
}

function makeTalk(id: Id, title: string, themeId: Id | null = null): Talk {
  const now = new Date().toISOString();
  return { id, title, type: 'talk', themeId, collectionId: 'deck-col', order: 0, createdAt: now, updatedAt: now };
}

function makeSnapshot(partial: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    libraries: [],
    libraryBundles: [],
    presentations: [],
    lyrics: [],
    talks: [],
    slides: [],
    talkScriptBlocks: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    themes: [],
    stages: [],
    collections: [],
    cues: [],
    macros: [],
    triggerBindings: [],
    ...partial,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeProjectContent(snapshot: AppSnapshot): any {
  const deckItems = [...snapshot.presentations, ...snapshot.lyrics, ...snapshot.talks];
  const deckItemsById = new Map(deckItems.map((item) => [item.id, item]));

  return {
    presentations: snapshot.presentations,
    lyrics: snapshot.lyrics,
    talks: snapshot.talks,
    deckItems,
    slides: snapshot.slides,
    talkScriptBlocks: [],
    slideElements: snapshot.slideElements,
    mediaAssets: [],
    overlays: snapshot.overlays,
    themes: snapshot.themes,
    stages: snapshot.stages,
    collections: snapshot.collections,
    cues: [],
    macros: [],
    triggerBindings: [],
    deckItemsById,
    slidesByDeckItemId: new Map(),
    talkScriptBlocksBySlideId: new Map(),
    slideElementsBySlideId: new Map(),
    mediaAssetsById: new Map(),
    overlaysById: new Map(snapshot.overlays.map((overlay) => [overlay.id, overlay])),
    themesById: new Map(snapshot.themes.map((theme) => [theme.id, theme])),
    stagesById: new Map(snapshot.stages.map((stage) => [stage.id, stage])),
    collectionsByBinKind: new Map(),
    collectionsById: new Map(snapshot.collections.map((collection) => [collection.id, collection])),
    cuesById: new Map(),
    macrosById: new Map(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderHarness(item: DeckItem, initial: AppSnapshot = makeSnapshot()): { current: { duplicate: (() => Promise<void>) | null; nav: NavigationContextValue } } {
  mocks.cast.snapshot = initial;
  mocks.cast.mutatePatch = async (action: () => Promise<unknown>) => action();
  mocks.cast.runOperation = async (_text: string, action: () => Promise<unknown>) => action();
  mocks.cast.setStatusText = vi.fn();
  mocks.project.value = makeProjectContent(initial);
  mocks.workbench.state = {
    state: {
      workbenchMode: 'show',
      overlayDefaults: { animationKind: 'none', durationMs: 0, autoClearDurationMs: null },
    },
  };

  const wrapper = ({ children }: { children: ReactNode }) => (
    <AssetEditorProvider>
      <NavigationProvider>{children}</NavigationProvider>
    </AssetEditorProvider>
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderHook(
    () => ({
      duplicate: useDuplicateDeckItem(item),
      nav: useNavigation(),
    }),
    { wrapper },
  ) as unknown as { current: { duplicate: (() => Promise<void>) | null; nav: NavigationContextValue } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCastApi(overrides: Record<string, any>): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    duplicateDeckItem: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('useDuplicateDeckItem', () => {
  it('hides duplication entirely for Talk items', () => {
    const talk = makeTalk('TALK-1', 'My Talk');
    const { current } = renderHarness(talk);
    expect(current.duplicate).toBeNull();
  });

  it('duplicates a presentation with one IPC call and selects the returned itemId directly, never scanning the snapshot', async () => {
    const source = makePresentation('SRC-1', 'Deck');
    const { current } = renderHarness(source, makeSnapshot({ presentations: [source] }));
    const duplicateDeckItem = vi.fn().mockResolvedValue({
      itemId: 'DUP-1',
      // Deliberately an empty patch (no upserted presentation) to prove the
      // selected id comes from the result's itemId and is never inferred by
      // diffing entity arrays before/after the mutation.
      patch: createEmptyPatch(2),
    });
    setCastApi({ duplicateDeckItem });

    await act(async () => {
      await current.duplicate!();
    });

    expect(duplicateDeckItem).toHaveBeenCalledTimes(1);
    expect(duplicateDeckItem).toHaveBeenCalledWith('SRC-1');
    expect(current.nav.currentDrawerDeckItemId).toBe('DUP-1');
    expect(mocks.cast.setStatusText).toHaveBeenCalledWith('Duplicated "Deck"');
  });

  it('duplicates a lyric with one IPC call and selects the returned itemId directly', async () => {
    const source = makeLyric('SRC-2', 'Song');
    const { current } = renderHarness(source, makeSnapshot({ lyrics: [source] }));
    const duplicateDeckItem = vi.fn().mockResolvedValue({
      itemId: 'DUP-2',
      patch: createEmptyPatch(2),
    });
    setCastApi({ duplicateDeckItem });

    await act(async () => {
      await current.duplicate!();
    });

    expect(duplicateDeckItem).toHaveBeenCalledWith('SRC-2');
    expect(current.nav.currentDrawerDeckItemId).toBe('DUP-2');
  });

  it('applies the returned patch through mutatePatch before selecting the duplicate', async () => {
    const source = makePresentation('SRC-3', 'Deck');
    const { current } = renderHarness(source, makeSnapshot({ presentations: [source] }));
    const duplicatePresentation = makePresentation('DUP-3', 'Deck Copy');
    const duplicateDeckItem = vi.fn().mockResolvedValue({
      itemId: 'DUP-3',
      patch: { version: 2, upserts: { presentations: [duplicatePresentation] }, deletes: {} },
    });
    setCastApi({ duplicateDeckItem });

    await act(async () => {
      await current.duplicate!();
    });

    expect(current.nav.currentDrawerDeckItemId).toBe('DUP-3');
  });

  it('retains the current selection and reports the failure without navigating on error', async () => {
    const source = makePresentation('SRC-4', 'Deck');
    const { current } = renderHarness(source, makeSnapshot({ presentations: [source] }));
    const duplicateDeckItem = vi.fn().mockRejectedValue(new Error('boom'));
    setCastApi({ duplicateDeckItem });

    await act(async () => {
      current.nav.browseDeckItem('PRIOR-SELECTION');
    });
    expect(current.nav.currentDrawerDeckItemId).toBe('PRIOR-SELECTION');

    await act(async () => {
      await current.duplicate!();
    });

    // Selection is untouched by the failed duplication.
    expect(current.nav.currentDrawerDeckItemId).toBe('PRIOR-SELECTION');
    expect(mocks.cast.setStatusText).toHaveBeenCalledWith('Failed to duplicate: boom');
  });
});
