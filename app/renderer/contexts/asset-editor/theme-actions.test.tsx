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

// Covers #144: Apply/Reset, Sync, and Detach are wired to three distinct
// `castApi` operations from the renderer, none of them reimplementing the
// provenance merge rules that live in app/core/themes.ts and app/database/
// store.ts. This file only exercises the asset-editor-context command
// surface; app/database/theme-sync-integration.test.ts covers what each
// repository call actually does to persisted provenance.

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
  return {
    presentations: snapshot.presentations,
    lyrics: snapshot.lyrics,
    talks: snapshot.talks,
    deckItems: [...snapshot.presentations, ...snapshot.lyrics, ...snapshot.talks],
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
    applyThemeToDeckItem: vi.fn(),
    applyThemeToOverlay: vi.fn(),
    detachThemeFromDeckItem: vi.fn(),
    syncThemeToLinkedDeckItems: vi.fn(),
    createDeckItemWithTheme: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── Detach: distinct from Apply/Reset and Sync ──────────────────────

describe('detachThemeFromDeckItem', () => {
  it('calls the detach command with just the item id, not the apply or sync commands', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const p1 = makePresentation('D1', 'Deck', 'T1');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1], presentations: [p1] }));

    const detach = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ detachThemeFromDeckItem: detach, applyThemeToDeckItem: apply, syncThemeToLinkedDeckItems: sync });

    await act(async () => {
      await harness.current.detachThemeFromDeckItem('D1');
    });

    expect(detach).toHaveBeenCalledTimes(1);
    expect(detach).toHaveBeenCalledWith('D1');
    expect(apply).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('propagates a detach failure instead of reporting a false success', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const p1 = makePresentation('D1', 'Deck', 'T1');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1], presentations: [p1] }));

    const detach = vi.fn().mockRejectedValue(new Error('detach boom'));
    setCastApi({ detachThemeFromDeckItem: detach });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.detachThemeFromDeckItem('D1');
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('detach boom');
  });
});

// ─── Sync: distinct from Apply/Reset and Detach ──────────────────────

describe('syncLinkedDeckItems', () => {
  it('calls the sync command with the resolved theme id, not the apply or detach commands', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const detach = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ syncThemeToLinkedDeckItems: sync, applyThemeToDeckItem: apply, detachThemeFromDeckItem: detach });

    await act(async () => {
      await harness.current.syncLinkedDeckItems('T1');
    });

    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith('T1');
    expect(apply).not.toHaveBeenCalled();
    expect(detach).not.toHaveBeenCalled();
  });

  it('resolves a staged theme to its persisted id before syncing', async () => {
    const harness = renderThemeHarness(makeSnapshot({ themes: [] }));

    const persistedId = 'persisted-theme-1';
    const createTheme = vi.fn().mockImplementation(async (input: { name: string; kind: ThemeKind; elements?: SlideElement[] }) => ({
      version: 1,
      upserts: {
        themes: [{ ...makeTheme(persistedId, input.kind, input.name), name: input.name, elements: input.elements ?? [] }],
      },
      deletes: {},
    }));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, syncThemeToLinkedDeckItems: sync });

    await act(async () => {
      harness.current.createTheme('slides');
    });
    const tempId = harness.current.currentThemeId as Id;
    expect(tempId).toBeTruthy();

    await act(async () => {
      await harness.current.syncLinkedDeckItems(tempId);
    });

    expect(createTheme).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(persistedId);
    expect(sync.mock.calls[0][0]).not.toBe(tempId);
  });

  it('propagates a sync failure instead of reporting a false success', async () => {
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const sync = vi.fn().mockRejectedValue(new Error('sync boom: owner 2 of 3 failed'));
    setCastApi({ syncThemeToLinkedDeckItems: sync });

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.syncLinkedDeckItems('T1');
      } catch (caught) {
        error = caught;
      }
    });

    expect((error as Error)?.message).toContain('sync boom: owner 2 of 3 failed');
  });

  it('does not resolve or sync when persisting the staged theme fails', async () => {
    const harness = renderThemeHarness(makeSnapshot({ themes: [] }));

    const createTheme = vi.fn().mockRejectedValue(new Error('persist boom'));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ createTheme, syncThemeToLinkedDeckItems: sync });

    await act(async () => {
      harness.current.createTheme('slides');
    });
    const tempId = harness.current.currentThemeId as Id;

    let error: unknown = null;
    await act(async () => {
      try {
        await harness.current.syncLinkedDeckItems(tempId);
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
    const t1 = makeTheme('T1', 'slides', 'Slide Theme');
    const harness = renderThemeHarness(makeSnapshot({ themes: [t1] }));

    const apply = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const sync = vi.fn().mockResolvedValue(createEmptyPatch(2));
    const detach = vi.fn().mockResolvedValue(createEmptyPatch(2));
    setCastApi({ applyThemeToDeckItem: apply, syncThemeToLinkedDeckItems: sync, detachThemeFromDeckItem: detach });

    // "Reset to Theme" and "Apply" are both this same call in the renderer —
    // the destructive rebuild is one operation regardless of which UI entry
    // point triggered it.
    await act(async () => {
      await harness.current.applyThemeToTarget('T1', { type: 'deck-item', itemId: 'D1' });
    });

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith('T1', 'D1');
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
    'window.castApi.detachThemeFromDeckItem',
    'window.castApi.syncThemeToLinkedDeckItems',
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
