import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AppSnapshot, GroupElementPayload, Id, SlideElement, Theme, ThemeKind } from '@core/types';
import type { SnapshotPatch } from '@core/snapshot-patch';
import { applyPatch } from '@core/snapshot-patch';
import { AssetEditorProvider, useThemeEditor, type ThemeEditorValue } from './asset-editor-context';

// Covers issue #105: duplicating a theme must construct an independent
// staged draft — new theme id, new backing slide id, collision-free element
// ids (including nested group children), a deep-copied background, and a
// deterministic case-insensitive collision-free name — without mutating the
// source theme before or after the duplicate is edited.

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

function makeTextElement(id: Id, text: string, slideId = ''): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId,
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

function makeGroupElement(id: Id, children: SlideElement[], slideId = ''): SlideElement {
  const now = new Date().toISOString();
  return {
    id,
    slideId,
    type: 'group',
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    layer: 'content',
    payload: { children } satisfies GroupElementPayload,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTheme(id: Id, kind: ThemeKind, name: string, partial: Partial<Theme> = {}): Theme {
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
    elements: [makeTextElement(`${id}:title`, name, `${id}:slide`)],
    ...partial,
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
  return {
    presentations: snapshot.presentations,
    lyrics: snapshot.lyrics,
    talks: snapshot.talks,
    deckItems: [],
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
    deckItemsById: new Map(),
    slidesByDeckItemId: new Map(),
    talkScriptBlocksBySlideId: new Map(),
    slideElementsBySlideId: new Map(),
    mediaAssetsById: new Map(),
    overlaysById: new Map(),
    themesById: new Map(snapshot.themes.map((theme) => [theme.id, theme])),
    stagesById: new Map(),
    collectionsByBinKind: new Map(),
    collectionsById: new Map(),
    cuesById: new Map(),
    macrosById: new Map(),
  };
}

function renderThemeHarness(initial: AppSnapshot): { current: { theme: ThemeEditorValue } } {
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

  const wrapper = ({ children }: { children: ReactNode }) => <AssetEditorProvider>{children}</AssetEditorProvider>;

  // renderHook returns { result, rerender, unmount }; the hook value lives on
  // result.current, so the harness hands back `result` itself.
  const { result } = renderHook(() => ({ theme: useThemeEditor() }), { wrapper });
  return result as { current: { theme: ThemeEditorValue } };
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

function duplicateOf(themes: Theme[], sourceId: Id): Theme {
  const duplicate = themes.find((t) => t.id !== sourceId);
  if (!duplicate) throw new Error('expected a duplicate theme distinct from the source');
  return duplicate;
}

// ─── Identity independence ───────────────────────────────────────────

describe('duplicateTheme — identity independence', () => {
  it('assigns a new theme id and a new backing slide id, distinct from the source', () => {
    const source = makeTheme('T1', 'slides', 'Slide Theme');
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.slideId).not.toBe(source.slideId);
    expect(duplicate.slideId).toBe(`${duplicate.id}:slide`);
  });

  it('gives every top-level element a new id owned by the new slide', () => {
    const source = makeTheme('T1', 'slides', 'Slide Theme', {
      elements: [makeTextElement('e-1', 'One', 'T1:slide'), makeTextElement('e-2', 'Two', 'T1:slide')],
    });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.elements).toHaveLength(2);
    const sourceIds = new Set(source.elements.map((e) => e.id));
    for (const element of duplicate.elements) {
      expect(sourceIds.has(element.id)).toBe(false);
      expect(element.slideId).toBe(duplicate.slideId);
    }
    // Collision-free among themselves too.
    expect(new Set(duplicate.elements.map((e) => e.id)).size).toBe(duplicate.elements.length);
  });

  it('gives nested group children new collision-free ids owned by the new slide', () => {
    const child1 = makeTextElement('child-1', 'Child One', 'T1:slide');
    const child2 = makeTextElement('child-2', 'Child Two', 'T1:slide');
    const group = makeGroupElement('group-1', [child1, child2], 'T1:slide');
    const source = makeTheme('T1', 'slides', 'Grouped Theme', { elements: [group] });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.elements).toHaveLength(1);
    const duplicateGroup = duplicate.elements[0];
    expect(duplicateGroup.id).not.toBe('group-1');
    expect(duplicateGroup.slideId).toBe(duplicate.slideId);

    const duplicateChildren = (duplicateGroup.payload as GroupElementPayload).children;
    expect(duplicateChildren).toHaveLength(2);
    const originalChildIds = new Set([child1.id, child2.id]);
    for (const child of duplicateChildren) {
      expect(originalChildIds.has(child.id)).toBe(false);
      expect(child.slideId).toBe(duplicate.slideId);
    }
    expect(duplicateChildren[0].id).not.toBe(duplicateChildren[1].id);
  });

  it('retains the source theme kind, dimensions, and collection', () => {
    const source = makeTheme('T1', 'lyrics', 'Lyric Theme', { width: 1280, height: 720, collectionId: 'col-123' });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.kind).toBe('lyrics');
    expect(duplicate.width).toBe(1280);
    expect(duplicate.height).toBe(720);
    expect(duplicate.collectionId).toBe('col-123');
  });

  it('is a no-op when the source theme id does not exist', () => {
    const source = makeTheme('T1', 'slides', 'Slide Theme');
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('does-not-exist'));

    expect(current.theme.themes).toHaveLength(1);
  });
});

// ─── Background deep copy ────────────────────────────────────────────

describe('duplicateTheme — background deep copy', () => {
  it('deep-copies a color background so mutating the duplicate does not affect the source', () => {
    const source = makeTheme('T1', 'slides', 'Theme', { background: { type: 'color', color: '#123456' } });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.background).toEqual({ type: 'color', color: '#123456' });

    act(() => current.theme.updateThemeDraft({ id: duplicate.id, background: { type: 'color', color: '#ffffff' } }));

    const sourceAfter = current.theme.themes.find((t) => t.id === 'T1')!;
    expect(sourceAfter.background).toEqual({ type: 'color', color: '#123456' });
  });

  it('deep-copies gradient stops into an independent array', () => {
    const stops = [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }];
    const source = makeTheme('T1', 'slides', 'Theme', {
      background: { type: 'gradient', gradient: { kind: 'linear', angle: 45, stops } },
    });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');
    const duplicateBackground = duplicate.background as { type: 'gradient'; gradient: { stops: unknown[] } };
    expect(duplicateBackground.gradient.stops).toEqual(stops);
    expect(duplicateBackground.gradient.stops).not.toBe(stops);
  });

  it('reuses managed media ids for an image background without duplicating them', () => {
    const source = makeTheme('T1', 'slides', 'Theme', {
      background: { type: 'image', mediaAssetId: 'media-1', src: 'file:///bg.png', fit: 'cover' },
    });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.background).toEqual({ type: 'image', mediaAssetId: 'media-1', src: 'file:///bg.png', fit: 'cover' });
  });

  it('reuses managed media ids for a video background without duplicating them', () => {
    const source = makeTheme('T1', 'slides', 'Theme', {
      background: { type: 'video', mediaAssetId: 'media-2', src: 'file:///bg.mp4', fit: 'contain' },
    });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.background).toEqual({ type: 'video', mediaAssetId: 'media-2', src: 'file:///bg.mp4', fit: 'contain' });
  });

  it('produces no background on the duplicate when the source has none', () => {
    const source = makeTheme('T1', 'slides', 'Theme');
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');
    expect(duplicate.background ?? null).toBeNull();
  });
});

// ─── Deterministic, collision-free naming ────────────────────────────

describe('duplicateTheme — deterministic collision-free naming', () => {
  it('names the first duplicate "<name> Copy"', () => {
    const source = makeTheme('T1', 'slides', 'Slide Theme');
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    expect(duplicateOf(current.theme.themes, 'T1').name).toBe('Slide Theme Copy');
  });

  it('numbers subsequent duplicates sequentially', () => {
    const source = makeTheme('T1', 'slides', 'Slide Theme');
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    act(() => current.theme.duplicateTheme('T1'));
    act(() => current.theme.duplicateTheme('T1'));

    const names = current.theme.themes.map((t) => t.name).sort();
    expect(names).toEqual(['Slide Theme', 'Slide Theme Copy', 'Slide Theme Copy 2', 'Slide Theme Copy 3']);
  });

  it('checks for collisions case-insensitively across all themes, regardless of kind or collection', () => {
    const source = makeTheme('T1', 'slides', 'Slide Theme', { collectionId: 'col-a' });
    // A differently-kinded, differently-collectioned theme already occupies the
    // lowercase form of the name the duplicate would otherwise take.
    const collider = makeTheme('T2', 'lyrics', 'slide theme copy', { collectionId: 'col-b' });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source, collider] }));

    act(() => current.theme.duplicateTheme('T1'));

    const duplicate = current.theme.themes.find((t) => t.id !== 'T1' && t.id !== 'T2')!;
    expect(duplicate.name).toBe('Slide Theme Copy 2');
  });
});

// ─── Post-duplication isolation ──────────────────────────────────────

describe('duplicateTheme — source isolation after duplication', () => {
  it('does not mutate the source when the duplicate elements are edited', () => {
    const source = makeTheme('T1', 'slides', 'Theme', { elements: [makeTextElement('e-1', 'Original', 'T1:slide')] });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');

    act(() => current.theme.updateThemeDraft({
      id: duplicate.id,
      elements: [makeTextElement(duplicate.elements[0].id, 'Edited', duplicate.slideId)],
    }));

    const sourceAfter = current.theme.themes.find((t) => t.id === 'T1')!;
    expect(sourceAfter.elements[0].payload).toMatchObject({ text: 'Original' });
  });

  it('does not mutate the source when the duplicate background is edited', () => {
    const source = makeTheme('T1', 'slides', 'Theme', { background: { type: 'color', color: '#000000' } });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    act(() => current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(current.theme.themes, 'T1');

    act(() => current.theme.updateThemeDraft({ id: duplicate.id, background: null }));

    const sourceAfter = current.theme.themes.find((t) => t.id === 'T1')!;
    expect(sourceAfter.background).toEqual({ type: 'color', color: '#000000' });
    const duplicateAfter = current.theme.themes.find((t) => t.id === duplicate.id)!;
    expect(duplicateAfter.background).toBeNull();
  });
});

// ─── Immediate apply through #101 carries the full background ───────

describe('duplicateTheme — persistence includes the full background', () => {
  it('sends the deep-copied background through createTheme when the unsaved duplicate is first pushed', async () => {
    const source = makeTheme('T1', 'slides', 'Theme', { background: { type: 'color', color: '#654321' } });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    const persistedId = 'persisted-duplicate';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind; elements?: SlideElement[]; background?: unknown }) => ({
      version: 1,
      upserts: {
        themes: [{ ...makeTheme(persistedId, input.kind, input.name), elements: input.elements ?? [], background: input.background }],
      },
      deletes: {},
    }));
    setCastApi({ createTheme });

    act(() => current.theme.duplicateTheme('T1'));
    const tempId = current.theme.currentThemeId!;

    await act(async () => {
      await current.theme.pushChanges();
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(createTheme.mock.calls[0][0].background).toEqual({ type: 'color', color: '#654321' });
    expect(createTheme.mock.calls[0][0].name).toBe('Theme Copy');
    expect(tempId).not.toBe(persistedId);
  });

  it('persists the duplicate background before applying the resolved database id', async () => {
    const source = makeTheme('T1', 'slides', 'Theme', {
      background: { type: 'gradient', gradient: { kind: 'linear', angle: 30, stops: [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }] } },
    });
    const { current } = renderThemeHarness(makeSnapshot({ themes: [source] }));

    const persistedId = 'persisted-duplicate';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind; elements?: SlideElement[]; background?: unknown }) => ({
      version: 1,
      upserts: {
        themes: [{ ...makeTheme(persistedId, input.kind, input.name), elements: input.elements ?? [], background: input.background }],
      },
      deletes: {},
    }));
    const applyThemeToDeckItem = vi.fn().mockResolvedValue({ version: 2, upserts: {}, deletes: {} });
    setCastApi({ createTheme, applyThemeToDeckItem });

    act(() => current.theme.duplicateTheme('T1'));
    const temporaryId = current.theme.currentThemeId!;

    await act(async () => {
      await current.theme.applyThemeToTarget(temporaryId, { type: 'deck-item', itemId: 'D1' });
    });

    expect(createTheme).toHaveBeenCalledWith(expect.objectContaining({ background: source.background }));
    expect(applyThemeToDeckItem).toHaveBeenCalledWith(persistedId, 'D1');
  });
});
