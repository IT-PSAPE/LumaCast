import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Presentation, SlideElement } from '@lumacast/composition';
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

// #219 item-model refactor decision D2: the four theme families share one
// structural row shape — there is no `kind` discriminant on the row itself.
function makeTheme(id: Id, name: string, partial: Partial<{ elements: SlideElement[] }> = {}) {
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
    elements: [makeElement(`${id}:title`, name)],
    ...partial,
  };
}

function makePresentation(id: Id, title: string, themeId: Id | null): Presentation {
  const now = new Date().toISOString();
  return {
    id,
    title,
    themeId,
    order: 0,
    createdAt: now,
    updatedAt: now,
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
    applyThemeToItem: vi.fn(),
    applyThemeToOverlay: vi.fn(),
    createItem: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── Theme resolution and application ───────────────────────────────

describe('resolveThemeIdForMutation / applyThemeToTarget', () => {
  it('persists an edited existing theme before applying it', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const updateTheme = vi.fn().mockImplementation(async (input: { name: string; elements: SlideElement[] }) => ({
      version: 1,
      upserts: { presentationThemes: [{ ...t1, name: input.name, elements: input.elements, updatedAt: 't+1' }] },
      deletes: {},
    }));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ updateTheme, applyThemeToItem: apply });

    const updated = [makeElement('E-a', 'First'), makeElement('E-b', 'Second')];
    await act(async () => {
      harness.current.theme.updateThemeDraft({ id: 'T1', elements: updated });
    });
    await act(async () => {
      await harness.current.theme.applyThemeToTarget('T1', { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
    });

    expect(updateTheme).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('T1', { type: 'presentation', id: 'D1' });
  });

  it('resolves a newly created staged theme to its persisted id before applying', async () => {
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [] }));

    const persistedId = 'persisted-theme-1';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        presentationThemes: [{ ...makeTheme(persistedId, input.name), elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, applyThemeToItem: apply });

    await act(async () => {
      harness.current.theme.createTheme('presentation');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await harness.current.theme.applyThemeToTarget(tempId as Id, { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(persistedId, { type: 'presentation', id: 'D1' });
    expect(apply.mock.calls[0][0]).not.toBe(tempId);
  });

  it('resolves a duplicated staged theme to its persisted id before applying', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const persistedId = 'persisted-theme-2';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        presentationThemes: [{ ...makeTheme(persistedId, input.name), elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, applyThemeToItem: apply });

    await act(async () => {
      harness.current.theme.duplicateTheme('T1');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).not.toBe('T1');

    await act(async () => {
      await harness.current.theme.applyThemeToTarget(tempId as Id, { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(persistedId, { type: 'presentation', id: 'D1' });
  });

  it('does not run the apply when the theme push fails', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const updateTheme = vi.fn().mockRejectedValue(new Error('persist boom'));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ updateTheme, applyThemeToItem: apply });

    await act(async () => {
      harness.current.theme.updateThemeDraft({ id: 'T1', name: 'Renamed' });
    });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.theme.applyThemeToTarget('T1', { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('persist boom');
    expect(apply).not.toHaveBeenCalled();
  });

  it('serializes duplicate apply invocations while one is in flight', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    let releaseApply: (() => void) | null = null;
    const apply = vi.fn().mockImplementation(
      () => new Promise<SnapshotPatch>((resolve) => { releaseApply = () => resolve(createEmptyPatch(2)); }),
    );
    setCastApi({ applyThemeToItem: apply });

    await act(async () => {
      const itemRef = { type: 'presentation' as const, id: 'D1' };
      const first = harness.current.theme.applyThemeToTarget('T1', { type: 'item', itemRef });
      const second = harness.current.theme.applyThemeToTarget('T1', { type: 'item', itemRef });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(apply).toHaveBeenCalledTimes(1);
      releaseApply?.();
      await first;
      await second;
    });

    expect(apply).toHaveBeenCalledTimes(1);
  });
});

// ─── Item creation with a staged theme ──────────────────────────────

describe('createItem theme resolution', () => {
  it('uses the persisted id of a staged theme when creating an item', async () => {
    const harness = renderThemeHarness(makeSnapshot({ lyricThemes: [] }));

    const persistedId = 'persisted-theme-3';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        lyricThemes: [{ ...makeTheme(persistedId, input.name), elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const createItem = vi.fn().mockImplementation(async (input: { type: string; title: string; themeId: Id | null }) => ({
      itemId: 'NEW-L-1',
      patch: {
        version: 2,
        upserts: { lyrics: [{ id: 'NEW-L-1', title: input.title, themeId: input.themeId, order: 0, createdAt: 't', updatedAt: 't' }] },
        deletes: {},
      },
    }));
    setCastApi({ createTheme, createItem });

    await act(async () => {
      harness.current.theme.setThemeType('lyric');
      harness.current.theme.createTheme('lyric');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await harness.current.navigation.createItem({ type: 'lyric', name: 'Song', themeId: tempId as Id });
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem.mock.calls[0][0].themeId).toBe(persistedId);
    expect(createItem.mock.calls[0][0].themeId).not.toBe(tempId);
  });

  it('persists an edited existing theme before creating an item', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const updateTheme = vi.fn().mockImplementation(async (input: { name: string }) => ({
      version: 1,
      upserts: { presentationThemes: [{ ...t1, name: input.name, updatedAt: 't+1' }] },
      deletes: {},
    }));
    const createItem = vi.fn().mockImplementation(async (input: { type: string; title: string; themeId: Id | null }) => ({
      itemId: 'NEW-P-2',
      patch: {
        version: 2,
        upserts: { presentations: [makePresentation('NEW-P-2', input.title, input.themeId)] },
        deletes: {},
      },
    }));
    setCastApi({ updateTheme, createItem });

    await act(async () => {
      harness.current.theme.updateThemeDraft({ id: 'T1', name: 'Renamed Theme' });
    });

    await act(async () => {
      await harness.current.navigation.createItem({ type: 'presentation', name: 'Deck', themeId: 'T1' });
    });

    expect(updateTheme).toHaveBeenCalledTimes(1);
    expect(createItem).toHaveBeenCalledTimes(1);
    expect(createItem.mock.calls[0][0].themeId).toBe('T1');
  });

  it('does not create an item when the theme push fails', async () => {
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [] }));

    const createTheme = vi.fn().mockRejectedValue(new Error('persist boom'));
    const createItem = vi.fn().mockResolvedValue({ itemId: 'NEW-P-3', patch: createEmptyPatch(2) });
    setCastApi({ createTheme, createItem });

    await act(async () => {
      harness.current.theme.createTheme('presentation');
    });
    const tempId = harness.current.theme.currentThemeId;
    expect(tempId).toBeTruthy();

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.navigation.createItem({ type: 'presentation', name: 'Deck', themeId: tempId as Id });
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('persist boom');
    expect(createItem).not.toHaveBeenCalled();
  });

  it('serializes duplicate item creations while one is in flight', async () => {
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [] }));

    let releaseCreate: ((value: { itemId: Id; patch: SnapshotPatch }) => void) | null = null;
    const createItem = vi.fn().mockImplementation(
      () => new Promise<{ itemId: Id; patch: SnapshotPatch }>((resolve) => { releaseCreate = resolve; }),
    );
    setCastApi({ createItem });

    await act(async () => {
      const first = harness.current.navigation.createItem({ type: 'presentation', name: 'Deck' });
      const second = harness.current.navigation.createItem({ type: 'presentation', name: 'Deck' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(createItem).toHaveBeenCalledTimes(1);
      releaseCreate?.({ itemId: 'NEW-P-4', patch: createEmptyPatch(2) });
      await first;
      await second;
    });

    expect(createItem).toHaveBeenCalledTimes(1);
  });
});

// ─── Family-aware mutations (delete/rename/reorder resolve owner) ──

describe('family-aware theme mutations', () => {
  function makeThemeForFamily(id: string, name: string) {
    return makeTheme(id, name);
  }

  it('deleteTheme resolves owning family even when active differs', () => {
    const p = makeThemeForFamily('P1', 'Pres Theme');
    const l = makeThemeForFamily('L1', 'Lyric Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [p], lyricThemes: [l] }));
    // active is presentation
    harness.current.theme.deleteTheme('L1');
    expect(harness.current.theme.themesByType.lyric).toHaveLength(0);
    expect(harness.current.theme.themesByType.presentation).toHaveLength(1);
  });

  it('renameTheme resolves owning family even when active differs', () => {
    const t = makeThemeForFamily('T1', 'Talk Theme');
    const harness = renderThemeHarness(makeSnapshot({ talkThemes: [t] }));
    harness.current.theme.renameTheme('T1', 'Renamed Talk');
    expect(harness.current.theme.themesByType.talk[0].name).toBe('Renamed Talk');
  });

  it('reorderTheme resolves owning family and passes correct themeType', async () => {
    const o1 = makeThemeForFamily('O1', 'Overlay One');
    const o2 = makeThemeForFamily('O2', 'Overlay Two');
    const harness = renderThemeHarness(makeSnapshot({ overlayThemes: [o1, o2] }));
    const setOrder = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ setThemeOrder: setOrder });
    await act(async () => {
      await harness.current.theme.reorderTheme('O1', 1);
    });
    expect(setOrder).toHaveBeenCalledWith('O1', 'overlay', 1);
  });

  it('openThemeEditor switches active family so staged draft follows selection', () => {
    const p = makeThemeForFamily('P1', 'Pres Theme');
    const l = makeThemeForFamily('L1', 'Lyric Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [p], lyricThemes: [l] }));
    expect(harness.current.theme.themeType).toBe('presentation');
    act(() => harness.current.theme.openThemeEditor('lyric', 'L1'));
    expect(harness.current.theme.themeType).toBe('lyric');
    expect(harness.current.theme.currentThemeId).toBe('L1');
  });

  it('themesByType contains all four families', () => {
    const p = makeThemeForFamily('P1', 'Pres');
    const l = makeThemeForFamily('L1', 'Lyric');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [p], lyricThemes: [l], talkThemes: [], overlayThemes: [] }));
    expect(harness.current.theme.themesByType.presentation).toHaveLength(1);
    expect(harness.current.theme.themesByType.lyric).toHaveLength(1);
    expect(harness.current.theme.themesByType.talk).toHaveLength(0);
    expect(harness.current.theme.themesByType.overlay).toHaveLength(0);
  });
});

// ─── Regression: no direct IPC outside the authoritative command ─────

describe('applyThemeToItem call-site boundary', () => {
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

  it('keeps direct applyThemeToItem calls confined to the authoritative command', () => {
    const rendererRoot = path.resolve(__dirname, '../..');
    const authoritative = path.resolve(rendererRoot, 'contexts/asset-editor/asset-editor-context.tsx');
    const files = walkFiles(rendererRoot);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const occurrences = (source.match(/window\.castApi\.applyThemeToItem/g) ?? []).length;
      const resolved = path.resolve(file);
      if (resolved === authoritative) {
        expect(occurrences).toBe(1);
      } else {
        expect(occurrences).toBe(0);
      }
    }
  });
});
