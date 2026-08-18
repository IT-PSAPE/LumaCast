import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { GroupElementPayload, SlideBackground, SlideElement } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import type { SnapshotPatch } from '@lumacast/protocol';
import { applyPatch } from '@lumacast/protocol';
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

// #219 item-model refactor decision D2: the four theme families share one
// structural row shape — there is no `kind` discriminant on the row itself.
interface ThemeFixture {
  id: Id;
  slideId: Id;
  name: string;
  width: number;
  height: number;
  order: number;
  background?: SlideBackground | null;
  elements: SlideElement[];
  createdAt: string;
  updatedAt: string;
}

function makeTheme(id: Id, name: string, partial: Partial<ThemeFixture> = {}): ThemeFixture {
  const now = new Date().toISOString();
  return {
    id,
    slideId: `${id}:slide`,
    name,
    width: 1920,
    height: 1080,
    order: 0,
    createdAt: now,
    updatedAt: now,
    elements: [makeTextElement(`${id}:title`, name, `${id}:slide`)],
    ...partial,
  };
}

function makeSnapshot(partial: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    presentations: [],
    lyrics: [],
    talks: [],
    slides: [],
    talkScriptBlocks: [],
    slideElements: [],
    mediaAssets: [],
    overlays: [],
    presentationThemes: [],
    lyricThemes: [],
    talkThemes: [],
    overlayThemes: [],
    stages: [],
    playlists: [],
    playlistEntries: [],
    cues: [],
    macros: [],
    triggerBindings: [],
    ...partial,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeProjectContent(snapshot: AppSnapshot): any {
  const presentationsById = new Map(snapshot.presentations.map((p) => [p.id, p]));
  const lyricsById = new Map(snapshot.lyrics.map((l) => [l.id, l]));
  const talksById = new Map(snapshot.talks.map((t) => [t.id, t]));

  return {
    presentations: snapshot.presentations,
    lyrics: snapshot.lyrics,
    talks: snapshot.talks,
    slides: snapshot.slides,
    talkScriptBlocks: [],
    slideElements: snapshot.slideElements,
    mediaAssets: [],
    overlays: snapshot.overlays,
    presentationThemes: snapshot.presentationThemes,
    lyricThemes: snapshot.lyricThemes,
    talkThemes: snapshot.talkThemes,
    overlayThemes: snapshot.overlayThemes,
    stages: snapshot.stages,
    cues: [],
    macros: [],
    triggerBindings: [],
    presentationsById,
    lyricsById,
    talksById,
    slidesByItem: new Map(),
    talkScriptBlocksBySlideId: new Map(),
    slideElementsBySlideId: new Map(),
    mediaAssetsById: new Map(),
    overlaysById: new Map(snapshot.overlays.map((o) => [o.id, o])),
    presentationThemesById: new Map(snapshot.presentationThemes.map((t) => [t.id, t])),
    lyricThemesById: new Map(snapshot.lyricThemes.map((t) => [t.id, t])),
    talkThemesById: new Map(snapshot.talkThemes.map((t) => [t.id, t])),
    overlayThemesById: new Map(snapshot.overlayThemes.map((t) => [t.id, t])),
    stagesById: new Map(snapshot.stages.map((s) => [s.id, s])),
    cuesById: new Map(),
    macrosById: new Map(),
    resolveItemRef: (ref: { type: string; id: Id } | null | undefined) => {
      if (!ref) return null;
      if (ref.type === 'presentation') return presentationsById.get(ref.id) ?? null;
      if (ref.type === 'lyric') return lyricsById.get(ref.id) ?? null;
      return talksById.get(ref.id) ?? null;
    },
    slidesForItemRef: () => [],
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
    applyThemeToItem: vi.fn(),
    applyThemeToOverlay: vi.fn(),
    createItem: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

function duplicateOf(themes: ThemeFixture[], sourceId: Id): ThemeFixture {
  const duplicate = themes.find((t) => t.id !== sourceId);
  if (!duplicate) throw new Error('expected a duplicate theme distinct from the source');
  return duplicate as ThemeFixture;
}

// ─── Identity independence ───────────────────────────────────────────

describe('duplicateTheme — identity independence', () => {
  it('assigns a new theme id and a new backing slide id, distinct from the source', () => {
    const source = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    expect(duplicate.id).not.toBe(source.id);
    expect(duplicate.slideId).not.toBe(source.slideId);
    expect(duplicate.slideId).toBe(`${duplicate.id}:slide`);
  });

  it('gives every top-level element a new id owned by the new slide', () => {
    const source = makeTheme('T1', 'Slide Theme', {
      elements: [makeTextElement('e-1', 'One', 'T1:slide'), makeTextElement('e-2', 'Two', 'T1:slide')],
    });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
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
    const source = makeTheme('T1', 'Grouped Theme', { elements: [group] });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
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

  it('retains the source theme dimensions', () => {
    const source = makeTheme('T1', 'Lyric Theme', { width: 1280, height: 720 });
    const harness = renderThemeHarness(makeSnapshot({ lyricThemes: [source] }));

    act(() => harness.current.theme.setThemeType('lyric'));
    act(() => harness.current.theme.duplicateTheme('T1'));

    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    expect(duplicate.width).toBe(1280);
    expect(duplicate.height).toBe(720);
  });

  it('is a no-op when the source theme id does not exist', () => {
    const source = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('does-not-exist'));

    expect(harness.current.theme.themes).toHaveLength(1);
  });
});

// ─── Background deep copy ────────────────────────────────────────────

describe('duplicateTheme — background deep copy', () => {
  it('deep-copies a color background so mutating the duplicate does not affect the source', () => {
    const source = makeTheme('T1', 'Theme', { background: { type: 'color', color: '#123456' } });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    expect(duplicate.background).toEqual({ type: 'color', color: '#123456' });

    act(() => harness.current.theme.updateThemeDraft({ id: duplicate.id, background: { type: 'color', color: '#ffffff' } }));

    const sourceAfter = (harness.current.theme.themes as ThemeFixture[]).find((t) => t.id === 'T1')!;
    expect(sourceAfter.background).toEqual({ type: 'color', color: '#123456' });
  });

  it('deep-copies gradient stops into an independent array', () => {
    const stops = [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }];
    const source = makeTheme('T1', 'Theme', {
      background: { type: 'gradient', gradient: { kind: 'linear', angle: 45, stops } },
    });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    const duplicateBackground = duplicate.background as { type: 'gradient'; gradient: { stops: unknown[] } };
    expect(duplicateBackground.gradient.stops).toEqual(stops);
    expect(duplicateBackground.gradient.stops).not.toBe(stops);
  });

  it('reuses managed media ids for an image background without duplicating them', () => {
    const source = makeTheme('T1', 'Theme', {
      background: { type: 'image', mediaAssetId: 'media-1', src: 'file:///bg.png', fit: 'cover' },
    });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    expect(duplicate.background).toEqual({ type: 'image', mediaAssetId: 'media-1', src: 'file:///bg.png', fit: 'cover' });
  });

  it('reuses managed media ids for a video background without duplicating them', () => {
    const source = makeTheme('T1', 'Theme', {
      background: { type: 'video', mediaAssetId: 'media-2', src: 'file:///bg.mp4', fit: 'contain' },
    });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    expect(duplicate.background).toEqual({ type: 'video', mediaAssetId: 'media-2', src: 'file:///bg.mp4', fit: 'contain' });
  });

  it('produces no background on the duplicate when the source has none', () => {
    const source = makeTheme('T1', 'Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');
    expect(duplicate.background ?? null).toBeNull();
  });
});

// ─── Deterministic, collision-free naming ────────────────────────────

describe('duplicateTheme — deterministic collision-free naming', () => {
  it('names the first duplicate "<name> Copy"', () => {
    const source = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    expect(duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1').name).toBe('Slide Theme Copy');
  });

  it('numbers subsequent duplicates sequentially', () => {
    const source = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    act(() => harness.current.theme.duplicateTheme('T1'));
    act(() => harness.current.theme.duplicateTheme('T1'));

    const names = (harness.current.theme.themes as ThemeFixture[]).map((t) => t.name).sort();
    expect(names).toEqual(['Slide Theme', 'Slide Theme Copy', 'Slide Theme Copy 2', 'Slide Theme Copy 3']);
  });

  it('checks for collisions case-insensitively within the same theme family', () => {
    const source = makeTheme('T1', 'Slide Theme');
    // A theme in the same family already occupies the lowercase form of the
    // name the duplicate would otherwise take.
    const collider = makeTheme('T2', 'slide theme copy');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source, collider] }));

    act(() => harness.current.theme.duplicateTheme('T1'));

    const duplicate = (harness.current.theme.themes as ThemeFixture[]).find((t) => t.id !== 'T1' && t.id !== 'T2')!;
    expect(duplicate.name).toBe('Slide Theme Copy 2');
  });
});

// ─── Post-duplication isolation ──────────────────────────────────────

describe('duplicateTheme — source isolation after duplication', () => {
  it('does not mutate the source when the duplicate elements are edited', () => {
    const source = makeTheme('T1', 'Theme', { elements: [makeTextElement('e-1', 'Original', 'T1:slide')] });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');

    act(() => harness.current.theme.updateThemeDraft({
      id: duplicate.id,
      elements: [makeTextElement(duplicate.elements[0].id, 'Edited', duplicate.slideId)],
    }));

    const sourceAfter = (harness.current.theme.themes as ThemeFixture[]).find((t) => t.id === 'T1')!;
    expect(sourceAfter.elements[0].payload).toMatchObject({ text: 'Original' });
  });

  it('does not mutate the source when the duplicate background is edited', () => {
    const source = makeTheme('T1', 'Theme', { background: { type: 'color', color: '#000000' } });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    act(() => harness.current.theme.duplicateTheme('T1'));
    const duplicate = duplicateOf(harness.current.theme.themes as ThemeFixture[], 'T1');

    act(() => harness.current.theme.updateThemeDraft({ id: duplicate.id, background: null }));

    const sourceAfter = (harness.current.theme.themes as ThemeFixture[]).find((t) => t.id === 'T1')!;
    expect(sourceAfter.background).toEqual({ type: 'color', color: '#000000' });
    const duplicateAfter = (harness.current.theme.themes as ThemeFixture[]).find((t) => t.id === duplicate.id)!;
    expect(duplicateAfter.background).toBeNull();
  });
});

// ─── Immediate apply through #101 carries the full background ───────

describe('duplicateTheme — persistence includes the full background', () => {
  it('sends the deep-copied background through createTheme when the unsaved duplicate is first pushed', async () => {
    const source = makeTheme('T1', 'Theme', { background: { type: 'color', color: '#654321' } });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    const persistedId = 'persisted-duplicate';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; themeType: string; elements?: SlideElement[]; background?: unknown }) => ({
      version: 1,
      upserts: {
        presentationThemes: [{ ...makeTheme(persistedId, input.name), elements: input.elements ?? [], background: input.background }],
      },
      deletes: {},
    }));
    setCastApi({ createTheme });

    act(() => harness.current.theme.duplicateTheme('T1'));
    const tempId = harness.current.theme.currentThemeId!;

    await act(async () => {
      await harness.current.theme.pushChanges();
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(createTheme.mock.calls[0][0].background).toEqual({ type: 'color', color: '#654321' });
    expect(createTheme.mock.calls[0][0].name).toBe('Theme Copy');
    expect(tempId).not.toBe(persistedId);
  });

  it('persists the duplicate background before applying the resolved database id', async () => {
    const source = makeTheme('T1', 'Theme', {
      background: { type: 'gradient', gradient: { kind: 'linear', angle: 30, stops: [{ color: '#000000', position: 0 }, { color: '#ffffff', position: 100 }] } },
    });
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [source] }));

    const persistedId = 'persisted-duplicate';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; themeType: string; elements?: SlideElement[]; background?: unknown }) => ({
      version: 1,
      upserts: {
        presentationThemes: [{ ...makeTheme(persistedId, input.name), elements: input.elements ?? [], background: input.background }],
      },
      deletes: {},
    }));
    const applyThemeToItem = vi.fn().mockResolvedValue({ version: 2, upserts: {}, deletes: {} });
    setCastApi({ createTheme, applyThemeToItem });

    act(() => harness.current.theme.duplicateTheme('T1'));
    const temporaryId = harness.current.theme.currentThemeId!;

    await act(async () => {
      await harness.current.theme.applyThemeToTarget(temporaryId, { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
    });

    expect(createTheme).toHaveBeenCalledWith(expect.objectContaining({ background: source.background }));
    expect(applyThemeToItem).toHaveBeenCalledWith(persistedId, { type: 'presentation', id: 'D1' });
  });
});
