import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AppSnapshot, Id, Lyric, Presentation, Talk, Theme, ThemeKind } from '@core/types';
import { createEmptyPatch } from '@core/snapshot-patch';
import { AssetEditorProvider, useThemeEditor, type ThemeEditorValue } from './contexts/asset-editor/asset-editor-context';
import { NavigationProvider, useNavigationActions, useNavigationState } from './contexts/navigation-context';
import type { NavigationActionsValue, NavigationStateValue } from './types/navigation-context-types';

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

function makeTheme(id: Id, kind: ThemeKind, name: string): Theme {
  const now = new Date().toISOString();
  return { id, slideId: `${id}:slide`, name, kind, width: 1920, height: 1080, order: 0, collectionId: 'theme-col', createdAt: now, updatedAt: now, elements: [] };
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
function renderHarness(initial: AppSnapshot): { current: { actions: NavigationActionsValue; state: NavigationStateValue; theme: ThemeEditorValue } } {
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

  // renderHook returns { result, rerender, unmount }; the hook value lives on
  // result.current, so the harness hands back `result` itself.
  const { result } = renderHook(
    () => ({
      actions: useNavigationActions(),
      state: useNavigationState(),
      theme: useThemeEditor(),
    }),
    { wrapper },
  );
  return result as { current: { actions: NavigationActionsValue; state: NavigationStateValue; theme: ThemeEditorValue } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCastApi(overrides: Record<string, any>): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    createTheme: vi.fn(),
    updateTheme: vi.fn(),
    createDeckItemWithTheme: vi.fn(),
    createSlide: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── Create-dialog flow (createDeckItem) ────────────────────────────

describe('createDeckItem dialog flow', () => {
  it('creates an unthemed presentation with one IPC call, one mutation, and selects the returned itemId directly', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockResolvedValue({
      itemId: 'NEW-1',
      // Deliberately an empty patch (no upserted presentation) to prove the
      // selected id comes from the result's itemId and is never inferred by
      // diffing entity arrays before/after the mutation.
      patch: createEmptyPatch(2),
    });
    setCastApi({ createDeckItemWithTheme });

    await act(async () => {
      await current.actions.createDeckItem({ kind: 'presentation', name: 'Deck' });
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme).toHaveBeenCalledWith({
      type: 'presentation',
      title: 'Deck',
      collectionId: null,
      themeId: null,
      groupId: null,
    });
    expect(current.state.currentDrawerDeckItemId).toBe('NEW-1');
    expect(current.state.recentlyCreatedId).toBe('NEW-1');
  });

  it('creates a lyric via the dialog and selects the returned itemId', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockImplementation(async (input: { type: string; title: string }) => ({
      itemId: 'LYRIC-1',
      patch: { version: 2, upserts: { lyrics: [makeLyric('LYRIC-1', input.title)] }, deletes: {} },
    }));
    setCastApi({ createDeckItemWithTheme });

    await act(async () => {
      await current.actions.createDeckItem({ kind: 'lyric', name: 'My Song' });
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledWith({
      type: 'lyric',
      title: 'My Song',
      collectionId: null,
      themeId: null,
      groupId: null,
    });
    expect(current.state.currentDrawerDeckItemId).toBe('LYRIC-1');
  });

  it('creates a talk via the dialog and selects the returned itemId', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockImplementation(async (input: { type: string; title: string }) => ({
      itemId: 'TALK-1',
      patch: { version: 2, upserts: { talks: [makeTalk('TALK-1', input.title)] }, deletes: {} },
    }));
    setCastApi({ createDeckItemWithTheme });

    await act(async () => {
      await current.actions.createDeckItem({ kind: 'talk', name: 'My Talk' });
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledWith({
      type: 'talk',
      title: 'My Talk',
      collectionId: null,
      themeId: null,
      groupId: null,
    });
    expect(current.state.currentDrawerDeckItemId).toBe('TALK-1');
  });

  it('passes the persisted id of a staged theme, and selects the returned itemId directly', async () => {
    const { current } = renderHarness(makeSnapshot({ themes: [] }));

    const persistedThemeId = 'persisted-theme-1';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind }) => ({
      version: 1,
      upserts: { themes: [makeTheme(persistedThemeId, input.kind, input.name)] },
      deletes: {},
    }));
    const createDeckItemWithTheme = vi.fn().mockImplementation(async (input: { type: string; title: string; themeId: Id | null }) => ({
      itemId: 'NEW-2',
      patch: { version: 2, upserts: { presentations: [makePresentation('NEW-2', input.title, input.themeId)] }, deletes: {} },
    }));
    setCastApi({ createTheme, createDeckItemWithTheme });

    await act(async () => {
      current.theme.createTheme('slides');
    });
    const tempId = current.theme.currentThemeId as Id;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await current.actions.createDeckItem({ kind: 'presentation', name: 'Themed Deck', themeId: tempId });
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme.mock.calls[0][0].themeId).toBe(persistedThemeId);
    expect(createDeckItemWithTheme.mock.calls[0][0].themeId).not.toBe(tempId);
    expect(current.state.currentDrawerDeckItemId).toBe('NEW-2');
  });

  it('does not select or navigate when creation fails', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockRejectedValue(new Error('boom'));
    setCastApi({ createDeckItemWithTheme });

    let error: unknown = null;
    await act(async () => {
      try {
        await current.actions.createDeckItem({ kind: 'presentation', name: 'Deck' });
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toBe('boom');
    expect(current.state.currentDrawerDeckItemId).toBeNull();
    expect(current.state.recentlyCreatedId).toBeNull();
  });
});

// ─── Legacy app-menu creation (createPresentation / createEmptyLyric) ─

describe('legacy app-menu creation', () => {
  it('createPresentation routes through the atomic operation with explicit nulls, one IPC call, and one mutation', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockResolvedValue({
      itemId: 'P-1',
      patch: createEmptyPatch(2),
    });
    setCastApi({ createDeckItemWithTheme });

    await act(async () => {
      await current.actions.createPresentation();
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme).toHaveBeenCalledWith({
      type: 'presentation',
      title: 'New Presentation',
      collectionId: null,
      themeId: null,
      groupId: null,
    });
    expect(current.state.currentDrawerDeckItemId).toBe('P-1');
    expect(current.state.recentlyCreatedId).toBe('P-1');
  });

  it('createEmptyLyric routes through the atomic operation with explicit nulls, one IPC call, and one mutation', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockResolvedValue({
      itemId: 'L-1',
      patch: createEmptyPatch(2),
    });
    setCastApi({ createDeckItemWithTheme });

    await act(async () => {
      await current.actions.createEmptyLyric();
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme).toHaveBeenCalledWith({
      type: 'lyric',
      title: 'New Lyric',
      collectionId: null,
      themeId: null,
      groupId: null,
    });
    expect(current.state.currentDrawerDeckItemId).toBe('L-1');
  });

  it('does not call the legacy two-step owner-then-slide sequence', async () => {
    const { current } = renderHarness(makeSnapshot());
    const createDeckItemWithTheme = vi.fn().mockResolvedValue({ itemId: 'P-2', patch: createEmptyPatch(2) });
    const createPresentation = vi.fn();
    const createSlide = vi.fn();
    setCastApi({ createDeckItemWithTheme, createPresentation, createSlide });

    await act(async () => {
      await current.actions.createPresentation();
    });

    expect(createPresentation).not.toHaveBeenCalled();
    expect(createSlide).not.toHaveBeenCalled();
  });
});
