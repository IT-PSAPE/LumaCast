import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { Id } from '@lumacast/kernel';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { ItemRef, Lyric, Overlay, Presentation, Talk } from '@lumacast/composition';
import { ItemInspector } from './features/inspector/item-inspector';
import { useThemeBin } from './features/assets/themes/use-theme-bin';
import { ThemeBinPanel } from './features/assets/themes/theme-bin-panel';
import { WorkbenchProvider } from './contexts/workbench-context';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import type { ResourceDrawerViewMode } from './types/ui';

// Covers #219 item-model refactor decision D2: talk themes are their own
// family (`talkThemes`), not a member of a shared `Theme.kind` union — every
// apply/reset/detach surface picks its targets structurally from whichever
// family is active, with no capability matrix left to consult. These tests
// exercise the real production hooks/components (use-theme-bin.ts,
// theme-bin-panel.tsx, item-inspector.tsx) — not a reimplementation of their
// logic — so a regression in the per-family wiring fails here.

const mocks = vi.hoisted(() => ({
  cast: { value: null as unknown },
  navigation: { value: null as unknown },
  project: { value: null as unknown },
  themeEditor: { value: null as unknown },
  confirm: { fn: null as unknown },
}));

const virtualizerMocks = vi.hoisted(() => ({
  virtualItems: Array.from({ length: 8 }, (_, index) => ({ index, key: `row-${index}`, start: index * 40 })),
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => virtualizerMocks.virtualItems,
    getTotalSize: () => 320,
    measureElement: virtualizerMocks.measureElement,
    scrollToIndex: virtualizerMocks.scrollToIndex,
  })),
}));

// ThemeBinPanel's grid view mounts a live scene preview per tile via
// IntersectionObserver, which jsdom doesn't implement. These tests only
// exercise the row + context menu (list view), so a no-op stub is enough to
// let the initial grid-mode mount pass through without ever going visible.
class FakeIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

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
// All four theme families (presentation/lyric/talk/overlay) share one row
// shape with no `kind` discriminant (decision D2) — one fixture builder
// covers every family; which array/map a theme lives in says what it themes.

function makeTheme(id: Id, name: string): EditorThemeSource {
  const now = new Date().toISOString();
  return { id, slideId: `${id}:slide`, name, width: 1920, height: 1080, order: 0, createdAt: now, updatedAt: now, elements: [] };
}

function makePresentation(id: Id, title: string, themeId: Id | null = null): Presentation {
  const now = new Date().toISOString();
  return { id, title, themeId, order: 0, createdAt: now, updatedAt: now };
}

function makeLyric(id: Id, title: string, themeId: Id | null = null): Lyric {
  const now = new Date().toISOString();
  return { id, title, themeId, order: 0, createdAt: now, updatedAt: now };
}

function makeTalk(id: Id, title: string, themeId: Id | null = null): Talk {
  const now = new Date().toISOString();
  return { id, title, themeId, order: 0, createdAt: now, updatedAt: now };
}

function makeOverlay(id: Id, name: string): Overlay {
  const now = new Date().toISOString();
  return { id, slideId: `${id}:slide`, name, enabled: true, order: 0, elements: [], animation: { kind: 'none', durationMs: 0 }, createdAt: now, updatedAt: now };
}

// Search text, view mode and grid size moved out of the bin panels and onto
// whichever host renders the tab row, so exercising a bin means supplying that
// host state — including asking for list mode directly instead of clicking a
// view toggle the panel no longer owns.
function BinHost({ children, viewMode = 'grid' }: { children: React.ReactNode; viewMode?: ResourceDrawerViewMode }) {
  return (
    <WorkbenchProvider>
      <BinControlsProvider
        searchValue=""
        onSearchChange={vi.fn()}
        searchPlaceholder="Search themes…"
        viewMode={viewMode}
        onViewModeChange={vi.fn()}
        grid={{ value: 6, min: 4, max: 8, step: 1, onChange: vi.fn() }}
      >
        {children}
      </BinControlsProvider>
    </WorkbenchProvider>
  );
}

// A theme's family is now expressed purely by which array it lives in — there
// is no active-family selector left to consult.
function themesByType(family: ThemeFamily, themes: EditorThemeSource[]) {
  return { presentation: [], lyric: [], talk: [], overlay: [], [family]: themes };
}

type ThemeFamily = 'presentation' | 'lyric' | 'talk' | 'overlay';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── use-theme-bin.ts: click-to-apply gating ──────────────────────────

describe('useThemeBin (per-family click-to-apply gating)', () => {
  function setup(currentItemRef: ItemRef | null, family: ThemeFamily, theme: EditorThemeSource, applyThemeToTarget = vi.fn().mockResolvedValue(undefined)) {
    mocks.navigation.value = { currentItemRef };
    mocks.themeEditor.value = { themesByType: themesByType(family, [theme]), applyThemeToTarget };
    return applyThemeToTarget;
  }

  function renderThemeBinHook() {
    return renderHook(() => useThemeBin(), { wrapper: ({ children }) => <BinHost>{children}</BinHost> });
  }

  it('applies a talk theme to the current talk when the talk family is active', async () => {
    const talk: ItemRef = { type: 'talk', id: 't1' };
    const theme = makeTheme('theme-1', 'Talk Theme');
    const applyThemeToTarget = setup(talk, 'talk', theme);

    const { result } = renderThemeBinHook();
    await act(async () => {
      await result.current.handleApplyTheme(theme);
    });

    expect(applyThemeToTarget).toHaveBeenCalledWith('theme-1', { type: 'item', itemRef: talk });
  });

  it('never applies a lyric-family theme to the current talk — no cross-family matrix left to consult', async () => {
    const talk: ItemRef = { type: 'talk', id: 't1' };
    const theme = makeTheme('theme-2', 'Lyric Theme');
    const applyThemeToTarget = setup(talk, 'lyric', theme);

    const { result } = renderThemeBinHook();
    await act(async () => {
      await result.current.handleApplyTheme(theme);
    });

    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });

  it('does nothing without a current item', async () => {
    const theme = makeTheme('theme-3', 'Talk Theme');
    const applyThemeToTarget = setup(null, 'talk', theme);

    const { result } = renderThemeBinHook();
    await act(async () => {
      await result.current.handleApplyTheme(theme);
    });

    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });
});

// ─── theme-bin-panel.tsx: "Apply to" target picker ────────────────────

describe('ThemeBinPanel "Apply to" targets (per-family, no capability matrix)', () => {
  function renderPanel(options: {
    themeType: ThemeFamily;
    theme: EditorThemeSource;
    presentations?: Presentation[];
    lyrics?: Lyric[];
    talks?: Talk[];
    overlays?: Overlay[];
  }) {
    mocks.cast.value = { setStatusText: vi.fn() };
    mocks.navigation.value = { currentItemRef: null };
    mocks.themeEditor.value = {
      themesByType: themesByType(options.themeType, [options.theme]),
      applyThemeToTarget: vi.fn().mockResolvedValue(undefined),
      renameTheme: vi.fn(),
      deleteTheme: vi.fn(),
      createTheme: vi.fn(),
    };
    mocks.project.value = {
      presentations: options.presentations ?? [],
      lyrics: options.lyrics ?? [],
      talks: options.talks ?? [],
      overlays: options.overlays ?? [],
    };
    mocks.confirm.fn = vi.fn().mockResolvedValue(true);

    // The grid view's tiles render a live scene preview; list mode keeps this
    // test on the row + context menu, not scene rendering.
    render(
      <BinHost viewMode="list">
        <ThemeBinPanel />
      </BinHost>,
    );

    fireEvent.contextMenu(screen.getByDisplayValue(options.theme.name));
  }

  it('offers only talks as apply targets for the talk theme family, excluding presentations and lyrics', async () => {
    const theme = makeTheme('theme-1', 'Talk Theme');
    renderPanel({
      themeType: 'talk',
      theme,
  presentations: [makePresentation('p1', 'My Presentation')],
      lyrics: [makeLyric('l1', 'My Lyric')],
      talks: [makeTalk('t1', 'My Talk')],
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Apply to' }));
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
    const menus = screen.getAllByRole('menu');
    const submenu = menus[menus.length - 1];

    expect(within(submenu).getByRole('menuitem', { name: 'My Talk' })).toBeTruthy();
    expect(within(submenu).queryByRole('menuitem', { name: 'My Presentation' })).toBeNull();
    expect(within(submenu).queryByRole('menuitem', { name: 'My Lyric' })).toBeNull();
  });

  it('offers only overlays as apply targets for the overlay theme family, never items', async () => {
    const theme = makeTheme('theme-2', 'Overlay Theme');
    renderPanel({
      themeType: 'overlay',
      theme,
      presentations: [makePresentation('p1', 'My Presentation')],
      talks: [makeTalk('t1', 'My Talk')],
      overlays: [makeOverlay('o1', 'Lower Third')],
    });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Apply to' }));
    await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
    const menus = screen.getAllByRole('menu');
    const submenu = menus[menus.length - 1];

    expect(within(submenu).getByRole('menuitem', { name: 'Lower Third' })).toBeTruthy();
    expect(within(submenu).queryByRole('menuitem', { name: 'My Presentation' })).toBeNull();
    expect(within(submenu).queryByRole('menuitem', { name: 'My Talk' })).toBeNull();
  });

  it('disables "Apply to" when its family has no compatible targets, rather than opening an empty submenu', () => {
    const theme = makeTheme('theme-3', 'Talk Theme');
    renderPanel({ themeType: 'talk', theme, talks: [] });

    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Apply to' })); });

    expect(screen.getAllByRole('menu')).toHaveLength(1);
  });
});

// ─── item-inspector.tsx: per-family theme select/reset/detach ─────────

describe('ItemInspector theme surfaces for a talk (its own theme family)', () => {
  function renderInspector(options: {
    currentItemRef: ItemRef | null;
    currentItem: Talk | Presentation | Lyric | null;
    talkThemes?: EditorThemeSource[];
    lyricThemes?: EditorThemeSource[];
    talkThemesById?: Map<Id, EditorThemeSource>;
    applyThemeToTarget?: ReturnType<typeof vi.fn>;
    detachThemeFromItem?: ReturnType<typeof vi.fn>;
    confirmResult?: boolean;
  }) {
    const applyThemeToTarget = options.applyThemeToTarget ?? vi.fn().mockResolvedValue(undefined);
    const detachThemeFromItem = options.detachThemeFromItem ?? vi.fn().mockResolvedValue(undefined);
    const confirmMock = vi.fn().mockResolvedValue(options.confirmResult ?? true);
    const setStatusText = vi.fn();

    mocks.cast.value = { setStatusText };
    mocks.navigation.value = { currentItemRef: options.currentItemRef, currentItem: options.currentItem, renameItem: vi.fn() };
    mocks.project.value = {
      presentationThemes: [],
      lyricThemes: options.lyricThemes ?? [],
      talkThemes: options.talkThemes ?? [],
      presentationThemesById: new Map(),
      lyricThemesById: new Map((options.lyricThemes ?? []).map((t) => [t.id, t])),
      talkThemesById: options.talkThemesById ?? new Map((options.talkThemes ?? []).map((t) => [t.id, t])),
    };
    mocks.themeEditor.value = { applyThemeToTarget, detachThemeFromItem };
    mocks.confirm.fn = confirmMock;

    render(
      <WorkbenchProvider>
        <ItemInspector />
      </WorkbenchProvider>,
    );

    return { applyThemeToTarget, detachThemeFromItem, confirmMock, setStatusText };
  }

  it('offers only talkThemes for a talk, never a lyricThemes entry', () => {
    const talkRef: ItemRef = { type: 'talk', id: 't1' };
    const talk = makeTalk('t1', 'My Talk');
    const talkTheme = makeTheme('theme-1', 'Talk Theme');
    const lyricTheme = makeTheme('theme-2', 'Lyric Theme');
    renderInspector({ currentItemRef: talkRef, currentItem: talk, talkThemes: [talkTheme], lyricThemes: [lyricTheme] });

    expect(screen.queryByText('No compatible themes available.')).toBeNull();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Select a theme…' }), { button: 0 });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Talk Theme' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Lyric Theme' })).toBeNull();
  });

  it('reports no compatible themes for a talk when talkThemes is empty, even with lyricThemes present', () => {
    const talkRef: ItemRef = { type: 'talk', id: 't1' };
    const talk = makeTalk('t1', 'My Talk');
    const lyricTheme = makeTheme('theme-2', 'Lyric Theme');
    renderInspector({ currentItemRef: talkRef, currentItem: talk, talkThemes: [], lyricThemes: [lyricTheme] });

    expect(screen.getByText('No compatible themes available.')).toBeTruthy();
  });

  it('resets a talk to its assigned talk theme only after confirming the destructive action', async () => {
    const theme = makeTheme('theme-1', 'Talk Theme');
    const talkRef: ItemRef = { type: 'talk', id: 't1' };
    const talk = makeTalk('t1', 'My Talk', 'theme-1');
    const { applyThemeToTarget, confirmMock } = renderInspector({
      currentItemRef: talkRef, currentItem: talk, talkThemes: [theme], confirmResult: true,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset To Theme' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Reset "My Talk" to theme?',
      destructive: true,
    }));
    expect(applyThemeToTarget).toHaveBeenCalledWith('theme-1', { type: 'item', itemRef: talkRef });
  });

  it('does not reset a talk when the destructive confirmation is declined', async () => {
    const theme = makeTheme('theme-1', 'Talk Theme');
    const talkRef: ItemRef = { type: 'talk', id: 't1' };
    const talk = makeTalk('t1', 'My Talk', 'theme-1');
    const { applyThemeToTarget, confirmMock } = renderInspector({
      currentItemRef: talkRef, currentItem: talk, talkThemes: [theme], confirmResult: false,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reset To Theme' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmMock).toHaveBeenCalled();
    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });

  it('reports a specific failure when detaching a talk theme rejects, instead of an unhandled rejection', async () => {
    const theme = makeTheme('theme-1', 'Talk Theme');
    const talkRef: ItemRef = { type: 'talk', id: 't1' };
    const talk = makeTalk('t1', 'My Talk', 'theme-1');
    const detachThemeFromItem = vi.fn().mockRejectedValue(new Error('Item not found: t1'));
    const { setStatusText } = renderInspector({
      currentItemRef: talkRef, currentItem: talk, talkThemes: [theme], detachThemeFromItem,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove theme' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(detachThemeFromItem).toHaveBeenCalledWith(talkRef);
    expect(setStatusText).toHaveBeenCalledWith('Failed to detach theme: Item not found: t1');
  });
});
