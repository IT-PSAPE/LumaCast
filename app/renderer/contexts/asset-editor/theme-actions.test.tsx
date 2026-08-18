import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import type { ReactNode } from 'react';
import type { Id } from '@lumacast/kernel';
import type { Presentation, SlideElement, ThemeOwnerType } from '@lumacast/composition';
import type { AppSnapshot } from '@lumacast/protocol';
import type { SnapshotPatch } from '@lumacast/protocol';
import { applyPatch, createEmptyPatch } from '@lumacast/protocol';
import { AssetEditorProvider, useThemeEditor, type ThemeEditorValue } from './asset-editor-context';

// Covers #144: Apply/Reset, Sync, and Detach are wired to three distinct
// `castApi` operations from the renderer, none of them reimplementing the
// provenance merge rules that live in packages/composition/src/themes.ts and
// the persistence store. This file only exercises the asset-editor-context
// command surface.

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

// #219 item-model refactor decision D2: the four theme families
// (presentation/lyric/talk/overlay) share one structural row shape — there
// is no `kind` discriminant on the row itself, only on which of the four
// snapshot arrays it lives in.
function makeTheme(id: Id, name: string, partial: Partial<{
  width: number; height: number; order: number; elements: SlideElement[];
}> = {}) {
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

function themeFieldName(themeType: ThemeOwnerType): 'presentationThemes' | 'lyricThemes' | 'talkThemes' | 'overlayThemes' {
  if (themeType === 'lyric') return 'lyricThemes';
  if (themeType === 'talk') return 'talkThemes';
  if (themeType === 'overlay') return 'overlayThemes';
  return 'presentationThemes';
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

function renderThemeHarness(initial: AppSnapshot): { current: ThemeEditorValue } {
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
  const { result } = renderHook(() => useThemeEditor(), { wrapper });
  return result as { current: ThemeEditorValue };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setCastApi(overrides: Record<string, any>): void {
  (window as unknown as { castApi: Record<string, unknown> }).castApi = {
    createTheme: vi.fn(),
    updateTheme: vi.fn(),
    deleteTheme: vi.fn(),
    applyThemeToItem: vi.fn(),
    applyThemeToOverlay: vi.fn(),
    detachThemeFromItem: vi.fn(),
    syncThemeToLinkedItems: vi.fn(),
    createItem: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── Detach: distinct from Apply/Reset and Sync ──────────────────────

describe('detachThemeFromItem', () => {
  it('calls the detach command with just the item ref, not the apply or sync commands', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const p1 = makePresentation('D1', 'Deck', 'T1');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1], presentations: [p1] }));

    const detach = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ detachThemeFromItem: detach, applyThemeToItem: apply, syncThemeToLinkedItems: sync });

    await act(async () => {
      await harness.current.detachThemeFromItem({ type: 'presentation', id: 'D1' });
    });

    expect(detach).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledWith({ type: 'presentation', id: 'D1' });
    expect(apply).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('propagates a detach failure instead of reporting a false success', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const p1 = makePresentation('D1', 'Deck', 'T1');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1], presentations: [p1] }));

    const detach = vi.fn().mockRejectedValue(new Error('detach boom'));
    setCastApi({ detachThemeFromItem: detach });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.detachThemeFromItem({ type: 'presentation', id: 'D1' });
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('detach boom');
  });
});

// ─── Sync: distinct from Apply/Reset and Detach ──────────────────────

describe('syncLinkedItems', () => {
  it('calls the sync command with the resolved theme id and item type, not apply or detach', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const detach = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ syncThemeToLinkedItems: sync, applyThemeToItem: apply, detachThemeFromItem: detach });

    await act(async () => {
      await harness.current.syncLinkedItems('T1', 'presentation');
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('T1', 'presentation');
    expect(apply).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
  });

  it('resolves a staged theme to its persisted id before syncing', async () => {
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [] }));

    const persistedId = 'persisted-theme-1';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; themeType: ThemeOwnerType; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        [themeFieldName(input.themeType)]: [{ ...makeTheme(persistedId, input.name), elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, syncThemeToLinkedItems: sync });

    await act(async () => {
      harness.current.createTheme('presentation');
    });
    const tempId = harness.current.currentThemeId as Id;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await harness.current.syncLinkedItems(tempId, 'presentation');
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(persistedId, 'presentation');
    expect(sync.mock.calls[0][0]).not.toBe(tempId);
  });

  it('propagates a sync failure instead of reporting a false success', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const sync = vi.fn().mockRejectedValue(new Error('sync boom: owner 2 of 3 failed'));
    setCastApi({ syncThemeToLinkedItems: sync });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.syncLinkedItems('T1', 'presentation');
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('sync boom: owner 2 of 3 failed');
  });

  it('does not resolve or sync when persisting the staged theme fails', async () => {
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [] }));

    const createTheme = vi.fn().mockRejectedValue(new Error('persist boom'));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, syncThemeToLinkedItems: sync });

    await act(async () => {
      harness.current.createTheme('presentation');
    });
    const tempId = harness.current.currentThemeId as Id;

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.syncLinkedItems(tempId, 'presentation');
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('persist boom');
    expect(sync).not.toHaveBeenCalled();
  });
});

// ─── Apply/Reset: the renderer's "Reset to Theme" is the same destructive
//     command as "Apply", per #104's fixed decision that both are the
//     destructive rebuild — never the Sync merge. ─────────────────────

describe('applyThemeToTarget ("Apply" and "Reset to Theme")', () => {
  it('calls only the apply command, never sync or detach', async () => {
    const t1 = makeTheme('T1', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ presentationThemes: [t1] }));

    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const detach = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ applyThemeToItem: apply, syncThemeToLinkedItems: sync, detachThemeFromItem: detach });

    // "Reset to Theme" and "Apply" are both this same call in the renderer —
    // the destructive rebuild is one operation regardless of which UI entry
    // point triggered it.
    await act(async () => {
      await harness.current.applyThemeToTarget('T1', { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('T1', { type: 'presentation', id: 'D1' });
    expect(sync).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
  });
});

// ─── Regression: no direct IPC outside the authoritative command ─────

describe('call-site boundary — no UI module reimplements or bypasses the provenance commands', () => {
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

  it.each([
    'window.castApi.detachThemeFromItem',
    'window.castApi.syncThemeToLinkedItems',
  ])('keeps direct %s calls confined to the authoritative command', (callSite) => {
    const rendererRoot = path.resolve(__dirname, '../..');
    const authoritative = path.resolve(rendererRoot, 'contexts/asset-editor/asset-editor-context.tsx');
    const files = walkFiles(rendererRoot);

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const occurrences = (source.match(new RegExp(callSite.replace(/\./g, '\\.'), 'g')) ?? []).length;
      const resolved = path.resolve(file);
      if (resolved === authoritative) {
        expect(occurrences).toBe(1);
      } else {
        expect(occurrences).toBe(0);
      }
    }
  });
});
