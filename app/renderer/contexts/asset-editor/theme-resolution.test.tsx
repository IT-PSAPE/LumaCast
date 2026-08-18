import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Presentation, SlideElement, Theme, ThemeKind } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import type { SnapshotPatch } from '@lumacast/protocol';
import { applyPatch, createEmptyPatch } from '@lumacast/protocol';
import { AssetEditorProvider, useThemeEditor, type ThemeEditorValue } from './asset-editor-context';
import { NavigationProvider, useNavigationActions } from '../navigation-context';
import type { NavigationActionsValue } from '../../types/navigation-context-types';

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

vi.mock('../app-context', () => ({
  useCast: () => ({
    snapshot: mocks.cast.snapshot,
    mutatePatch: mocks.cast.mutatePatch,
    runOperation: mocks.cast.runOperation,
    setStatusText: mocks.cast.setStatusText,
  }),
}));

vi.mock('../use-project-content', () => ({
  useProjectContent: () => mocks.project.value,
}));

vi.mock('../workbench-context', () => ({
  useWorkbench: () => mocks.workbench.state,
}));

// ─── Fixtures ────────────────────────────────────────────────────────

function makeElement(id: Id, text: string): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId: '',
    type: 'text',
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    layer: 'content',
    payload: {
      text,
      fontFamily: 'Avenir Next',
      fontSize: 48,
      color: '#FFFFFF',
      alignment: 'left',
      weight: '400',
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeTheme(id: Id, kind: ThemeKind, name: string): Theme {
  const now = new Date().toISOString();
  return {
    id,
    slideId: `${id}:slide`,
    name,
    kind,
    width: 1920,
    height: 1080,
    order: 0,
    collectionId: 'theme-col',
    createdAt: now,
    updatedAt: now,
    elements: [makeElement(`${id}:title`, name)],
  };
}

function makePresentation(id: Id, title: string, themeId: Id | null): Presentation {
  const now = new Date().toISOString();
  return {
    id,
    title,
    type: 'presentation',
    themeId,
    collectionId: 'deck-col',
    order: 0,
    createdAt: now,
    updatedAt: now,
  };
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

  const slideElementsBySlideId = new Map<Id, SlideElement[]>();
  for (const slide of snapshot.slides) slideElementsBySlideId.set(slide.id, []);
  for (const element of snapshot.slideElements) {
    const existing = slideElementsBySlideId.get(element.slideId) ?? [];
    existing.push(element);
    slideElementsBySlideId.set(element.slideId, existing);
  }

  const slidesByDeckItemId = new Map<Id, unknown[]>();
  for (const item of deckItems) slidesByDeckItemId.set(item.id, []);
  for (const slide of snapshot.slides) {
    const itemId = slide.presentationId ?? slide.lyricId ?? slide.talkId;
    if (!itemId) continue;
    const existing = slidesByDeckItemId.get(itemId) ?? [];
    existing.push(slide);
    slidesByDeckItemId.set(itemId, existing);
  }

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
    slidesByDeckItemId,
    talkScriptBlocksBySlideId: new Map(),
    slideElementsBySlideId,
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
function renderThemeHarness(initial: AppSnapshot): { current: { theme: ThemeEditorValue; navigation: NavigationActionsValue } } {
  let snapshot = initial;
  mocks.cast.snapshot = initial;
  mocks.cast.mutatePatch = async (action: () => Promise<SnapshotPatch>): Promise<AppSnapshot> => {
    const patch = await action();
    snapshot = applyPatch(snapshot, patch);
    return snapshot;
  };
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
      theme: useThemeEditor(),
      navigation: useNavigationActions(),
    }),
    { wrapper },
  );
  return result as { current: { theme: ThemeEditorValue; navigation: NavigationActionsValue } };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCastApi(overrides: Record<string, any>): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    createTheme: vi.fn(),
    updateTheme: vi.fn(),
    deleteTheme: vi.fn(),
    applyThemeToDeckItem: vi.fn(),
    applyThemeToOverlay: vi.fn(),
    createDeckItemWithTheme: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── Theme resolution and application ───────────────────────────────

describe('resolveThemeIdForMutation / applyThemeToTarget', () => {
  it('persists an edited existing theme before applying it', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const updateTheme = vi.fn().mockImplementation(async (input: { name: string; elements: SlideElement[] }) => ({
      version: 1,
      upserts: { themes: [{ ...t1, name: input.name, elements: input.elements, updatedAt: 't+1' }] },
      deletes: {},
    }));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ updateTheme, applyThemeToDeckItem: apply });

    const updated = [makeElement('E-a', 'First'), makeElement('E-b', 'Second')];
    await act(async () => {
      harness.current.theme.updateThemeDraft({ id: 'T1', elements: updated });
    });
    await act(async () => {
      await harness.current.theme.applyThemeToTarget('T1', { type: 'deck-item', itemId: 'D1' });
    });

    expect(updateTheme).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('T1', 'D1');
  });

  it('resolves a newly created staged theme to its persisted id before applying', async () => {
    const harness = renderThemeHarness(makeSnapshot({ themes: [] }));

    const persistedId = 'persisted-theme-1';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        themes: [{ ...makeTheme(persistedId, input.kind, input.name), name: input.name, elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, applyThemeToDeckItem: apply });

    await act(async () => {
      harness.current.theme.createTheme('slides');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await harness.current.theme.applyThemeToTarget(tempId as Id, { type: 'deck-item', itemId: 'D1' });
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(persistedId, 'D1');
    expect(apply.mock.calls[0][0]).not.toBe(tempId);
  });

  it('resolves a duplicated staged theme to its persisted id before applying', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const persistedId = 'persisted-theme-2';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        themes: [{ ...makeTheme(persistedId, input.kind, input.name), name: input.name, elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, applyThemeToDeckItem: apply });

    await act(async () => {
      harness.current.theme.duplicateTheme('T1');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).not.toBe('T1');

    await act(async () => {
      await harness.current.theme.applyThemeToTarget(tempId as Id, { type: 'deck-item', itemId: 'D1' });
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(persistedId, 'D1');
  });

  it('does not run the apply when the theme push fails', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const updateTheme = vi.fn().mockRejectedValue(new Error('persist boom'));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ updateTheme, applyThemeToDeckItem: apply });

    await act(async () => {
      harness.current.theme.updateThemeDraft({ id: 'T1', name: 'Renamed' });
    });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.theme.applyThemeToTarget('T1', { type: 'deck-item', itemId: 'D1' });
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('persist boom');
    expect(apply).not.toHaveBeenCalled();
  });

  it('serializes duplicate apply invocations while one is in flight', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    let releaseApply: (() => void) | null = null;
    const apply = vi.fn().mockImplementation(
      () => new Promise<SnapshotPatch>((resolve) => { releaseApply = () => resolve(createEmptyPatch(2)); }),
    );
    setCastApi({ applyThemeToDeckItem: apply });

    await act(async () => {
      const first = harness.current.theme.applyThemeToTarget('T1', { type: 'deck-item', itemId: 'D1' });
      const second = harness.current.theme.applyThemeToTarget('T1', { type: 'deck-item', itemId: 'D1' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(apply).toHaveBeenCalledTimes(1);
      releaseApply?.();
      await first;
      await second;
    });

    expect(apply).toHaveBeenCalledTimes(1);
  });
});

// ─── Deck creation with a staged theme ──────────────────────────────

describe('createDeckItem theme resolution', () => {
  it('uses the persisted id of a staged theme when creating a deck item', async () => {
    const harness = renderThemeHarness(makeSnapshot({ themes: [] }));

    const persistedId = 'persisted-theme-3';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        themes: [{ ...makeTheme(persistedId, input.kind, input.name), name: input.name, elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const createDeckItemWithTheme = vi.fn().mockImplementation(async (input: { type: string; title: string; themeId: Id | null }) => ({
      itemId: 'NEW-P-1',
      patch: {
        version: 2,
        upserts: { presentations: [makePresentation('NEW-P-1', input.title, input.themeId)] },
        deletes: {},
      },
    }));
    setCastApi({ createTheme, createDeckItemWithTheme });

    await act(async () => {
      harness.current.theme.createTheme('lyrics');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await harness.current.navigation.createDeckItem({ kind: 'lyric', name: 'Song', themeId: tempId as Id });
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme.mock.calls[0][0].themeId).toBe(persistedId);
    expect(createDeckItemWithTheme.mock.calls[0][0].themeId).not.toBe(tempId);
  });

  it('persists an edited existing theme before creating a deck item', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const updateTheme = vi.fn().mockImplementation(async (input: { name: string }) => ({
      version: 1,
      upserts: { themes: [{ ...t1, name: input.name, updatedAt: 't+1' }] },
      deletes: {},
    }));
    const createDeckItemWithTheme = vi.fn().mockImplementation(async (input: { type: string; title: string; themeId: Id | null }) => ({
      itemId: 'NEW-P-2',
      patch: {
        version: 2,
        upserts: { presentations: [makePresentation('NEW-P-2', input.title, input.themeId)] },
        deletes: {},
      },
    }));
    setCastApi({ updateTheme, createDeckItemWithTheme });

    await act(async () => {
      harness.current.theme.updateThemeDraft({ id: 'T1', name: 'Renamed Theme' });
    });

    await act(async () => {
      await harness.current.navigation.createDeckItem({ kind: 'presentation', name: 'Deck', themeId: 'T1' });
    });

    expect(updateTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
    expect(createDeckItemWithTheme.mock.calls[0][0].themeId).toBe('T1');
  });

  it('does not create a deck item when the theme push fails', async () => {
    const harness = renderThemeHarness(makeSnapshot({ themes: [] }));

    const createTheme = vi.fn().mockRejectedValue(new Error('persist boom'));
    const createDeckItemWithTheme = vi.fn().mockResolvedValue({ itemId: 'NEW-P-3', patch: createEmptyPatch(2) });
    setCastApi({ createTheme, createDeckItemWithTheme });

    await act(async () => {
      harness.current.theme.createTheme('slides');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).toBeTruthy();

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.navigation.createDeckItem({ kind: 'presentation', name: 'Deck', themeId: tempId as Id });
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('persist boom');
    expect(createDeckItemWithTheme).not.toHaveBeenCalled();
  });

  it('serializes duplicate deck creations while one is in flight', async () => {
    const harness = renderThemeHarness(makeSnapshot({ themes: [] }));

    let releaseCreate: ((value: { itemId: Id; patch: SnapshotPatch }) => void) | null = null;
    const createDeckItemWithTheme = vi.fn().mockImplementation(
      () => new Promise<{ itemId: Id; patch: SnapshotPatch }>((resolve) => { releaseCreate = resolve; }),
    );
    setCastApi({ createDeckItemWithTheme });

    await act(async () => {
      const first = harness.current.navigation.createDeckItem({ kind: 'presentation', name: 'Deck' });
      const second = harness.current.navigation.createDeckItem({ kind: 'presentation', name: 'Deck' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
      releaseCreate?.({ itemId: 'NEW-P-4', patch: createEmptyPatch(2) });
      await first;
      await second;
    });

    expect(createDeckItemWithTheme).toHaveBeenCalledTimes(1);
  });
});

// ─── Regression: no direct IPC outside the authoritative command ─────

describe('applyThemeToDeckItem call-site boundary', () => {
  function walkFiles(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...walkFiles(full));
      } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !entry.name.includes('.test.')) {
        results.push(full);
      }
    }
    return results;
  }

  it('keeps direct applyThemeToDeckItem calls confined to the authoritative command', () => {
    const rendererRoot = path.resolve(__dirname, '../..');
    const authoritative = path.resolve(rendererRoot, 'contexts/asset-editor/asset-editor-context.tsx');
    const files = walkFiles(rendererRoot);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const occurrences = (source.match(/window\.castApi\.applyThemeToDeckItem/g) ?? []).length;
      const resolved = path.resolve(file);
      if (resolved === authoritative) {
        expect(occurrences).toBe(1);
      } else {
        expect(occurrences).toBe(0);
      }
    }
  });
});