import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import type { DeckItem, Id, Lyric, Overlay, Presentation, Talk, Theme, ThemeKind } from '@core/types';
import { DeckItemInspector } from './features/inspector/presentation-inspector';
import { useThemeBin } from './features/assets/themes/use-theme-bin';
import { resolveThemeApplyTargets } from './features/assets/themes/theme-bin-panel';
import { WorkbenchProvider } from './contexts/workbench-context';

// Covers #113: Talk uses the same compatible slide-theme model as
// Presentation, so every apply/reset/detach surface in the write boundary
// must treat it identically instead of maintaining its own UI-specific type
// list. These tests exercise the real production hooks/components — not a
// reimplementation of their logic — so a regression in the capability wiring
// (app/core/themes.ts, theme-bin-panel.tsx, presentation-inspector.tsx,
// use-theme-bin.ts) fails here.

const mocks = vi.hoisted(() => ({
  cast: { value: null as unknown },
  navigation: { value: null as unknown },
  project: { value: null as unknown },
  themeEditor: { value: null as unknown },
  confirm: { fn: null as unknown },
}));

vi.mock('./contexts/app-context', () => ({
  useCast: () => mocks.cast.value,
}));

vi.mock('./contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('./contexts/use-project-content', () => ({
  useProjectContent: () => mocks.project.value,
}));

vi.mock('./contexts/asset-editor/asset-editor-context', () => ({
  useThemeEditor: () => mocks.themeEditor.value,
}));

vi.mock('./components/overlays/confirm-dialog', () => ({
  useConfirm: () => mocks.confirm.fn,
}));

// ─── Fixtures ────────────────────────────────────────────────────────

function makeTheme(id: Id, kind: ThemeKind, name: string): Theme {
  const now = new Date().toISOString();
  return {
    id, slideId: `${id}:slide`, name, kind, width: 1920, height: 1080,
    order: 0, collectionId: 'theme-col', createdAt: now, updatedAt: now, elements: [],
  };
}

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

function makeOverlay(id: Id, name: string): Overlay {
  const now = new Date().toISOString();
  return {
    id, slideId: `${id}:slide`, name, enabled: true, elements: [],
    animation: { kind: 'none', durationMs: 0 }, collectionId: 'overlay-col', createdAt: now, updatedAt: now,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── theme-bin-panel.tsx: "Apply to" target picker ────────────────────

describe('resolveThemeApplyTargets (theme-bin-panel apply-to picker)', () => {
  it('includes a compatible talk alongside a compatible presentation for a slide theme, excluding lyric', () => {
    const theme = makeTheme('theme-1', 'slides', 'Slide Theme');
    const deckItems: DeckItem[] = [
      makePresentation('p1', 'My Presentation'),
      makeLyric('l1', 'My Lyric'),
      makeTalk('t1', 'My Talk'),
    ];

    const { deckItems: targets, overlays } = resolveThemeApplyTargets(theme, deckItems, []);

    expect(targets.map((item) => item.id)).toEqual(['p1', 't1']);
    expect(overlays).toEqual([]);
  });

  it('excludes talk and presentation for a lyric theme', () => {
    const theme = makeTheme('theme-2', 'lyrics', 'Lyric Theme');
    const deckItems: DeckItem[] = [makePresentation('p1', 'P'), makeTalk('t1', 'T'), makeLyric('l1', 'L')];

    const { deckItems: targets } = resolveThemeApplyTargets(theme, deckItems, []);

    expect(targets.map((item) => item.id)).toEqual(['l1']);
  });

  it('only offers overlays for an overlay theme, never deck items (including talk)', () => {
    const theme = makeTheme('theme-3', 'overlays', 'Overlay Theme');
    const deckItems: DeckItem[] = [makePresentation('p1', 'P'), makeTalk('t1', 'T'), makeLyric('l1', 'L')];
    const overlayList = [makeOverlay('o1', 'Lower Third')];

    const { deckItems: targets, overlays } = resolveThemeApplyTargets(theme, deckItems, overlayList);

    expect(targets).toEqual([]);
    expect(overlays.map((o) => o.id)).toEqual(['o1']);
  });

  it('offers no overlays for a slide theme even when overlays exist', () => {
    const theme = makeTheme('theme-4', 'slides', 'Slide Theme');
    const overlayList = [makeOverlay('o1', 'Lower Third')];

    const { overlays } = resolveThemeApplyTargets(theme, [], overlayList);

    expect(overlays).toEqual([]);
  });
});

// ─── use-theme-bin.ts: click-to-apply gating ──────────────────────────

describe('useThemeBin (click-to-apply gating)', () => {
  function setup(currentDeckItem: DeckItem | null, themes: Theme[], applyThemeToTarget = vi.fn().mockResolvedValue(undefined)) {
    mocks.cast.value = { mutatePatch: vi.fn(), setStatusText: vi.fn() };
    mocks.navigation.value = { currentDeckItem };
    mocks.themeEditor.value = { themes, applyThemeToTarget };
    mocks.project.value = { collectionsByBinKind: new Map() };
    return applyThemeToTarget;
  }

  it('applies a compatible slide theme directly to the current talk', async () => {
    const talk = makeTalk('t1', 'My Talk');
    const theme = makeTheme('theme-1', 'slides', 'Slide Theme');
    const applyThemeToTarget = setup(talk, [theme]);

    const { result } = renderHook(() => useThemeBin());
    await act(async () => {
      await result.current.handleApplyTheme(theme);
    });

    expect(applyThemeToTarget).toHaveBeenCalledWith('theme-1', { type: 'deck-item', itemId: 't1' });
  });

  it('never applies an incompatible lyric theme to the current talk', async () => {
    const talk = makeTalk('t1', 'My Talk');
    const theme = makeTheme('theme-2', 'lyrics', 'Lyric Theme');
    const applyThemeToTarget = setup(talk, [theme]);

    const { result } = renderHook(() => useThemeBin());
    await act(async () => {
      await result.current.handleApplyTheme(theme);
    });

    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });
});

// ─── presentation-inspector.tsx (DeckItemInspector): target picker + ──
// ─── destructive Reset confirmation, extended to talk ─────────────────

describe('DeckItemInspector for talk deck items', () => {
  function renderInspector(options: {
    currentDeckItem: DeckItem | null;
    themes: Theme[];
    applyThemeToTarget?: ReturnType<typeof vi.fn>;
    detachThemeFromDeckItem?: ReturnType<typeof vi.fn>;
    confirmResult?: boolean;
  }) {
    const applyThemeToTarget = options.applyThemeToTarget ?? vi.fn().mockResolvedValue(undefined);
    const detachThemeFromDeckItem = options.detachThemeFromDeckItem ?? vi.fn().mockResolvedValue(undefined);
    const confirmMock = vi.fn().mockResolvedValue(options.confirmResult ?? true);

    mocks.navigation.value = { currentDeckItem: options.currentDeckItem, renameDeckItem: vi.fn() };
    mocks.project.value = {
      themes: options.themes,
      themesById: new Map(options.themes.map((t) => [t.id, t])),
    };
    mocks.themeEditor.value = { applyThemeToTarget, detachThemeFromDeckItem };
    mocks.confirm.fn = confirmMock;

    render(
      <WorkbenchProvider>
        <DeckItemInspector />
      </WorkbenchProvider>,
    );

    return { applyThemeToTarget, detachThemeFromDeckItem, confirmMock };
  }

  it('offers a compatible slide theme as a target for a talk, hiding an incompatible lyric theme', () => {
    const talk = makeTalk('t1', 'My Talk');
    const slideTheme = makeTheme('theme-1', 'slides', 'Slide Theme');
    const lyricTheme = makeTheme('theme-2', 'lyrics', 'Lyric Theme');
    renderInspector({ currentDeckItem: talk, themes: [slideTheme, lyricTheme] });

    expect(screen.queryByText('No compatible themes available.')).toBeNull();

    fireEvent.pointerDown(screen.getByRole('button', { name: /select a theme/i }), { button: 0 });

    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Slide Theme' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Lyric Theme' })).toBeNull();
  });

  it('reports no compatible themes for a talk when only an incompatible lyric theme exists', () => {
    const talk = makeTalk('t1', 'My Talk');
    const lyricTheme = makeTheme('theme-2', 'lyrics', 'Lyric Theme');
    renderInspector({ currentDeckItem: talk, themes: [lyricTheme] });

    expect(screen.getByText('No compatible themes available.')).toBeTruthy();
  });

  it('extends the destructive Reset confirmation to a talk and only resets after confirming', async () => {
    const theme = makeTheme('theme-1', 'slides', 'Slide Theme');
    const talk = makeTalk('t1', 'My Talk', 'theme-1');
    const { applyThemeToTarget, confirmMock } = renderInspector({ currentDeckItem: talk, themes: [theme], confirmResult: true });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset To Theme' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Reset "My Talk" to theme?',
      destructive: true,
    }));
    expect(applyThemeToTarget).toHaveBeenCalledWith('theme-1', { type: 'deck-item', itemId: 't1' });
  });

  it('does not reset a talk when the destructive confirmation is declined', async () => {
    const theme = makeTheme('theme-1', 'slides', 'Slide Theme');
    const talk = makeTalk('t1', 'My Talk', 'theme-1');
    const { applyThemeToTarget, confirmMock } = renderInspector({ currentDeckItem: talk, themes: [theme], confirmResult: false });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset To Theme' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalled();
    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });
});
