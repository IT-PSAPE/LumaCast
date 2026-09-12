import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { ItemRef, ThemeOwnerType } from '@lumacast/composition';
import type { BinSort, BinTabSortKey } from '../../../../../../app/renderer/features/workbench/use-bin-sort';
import { useThemeBin } from '../../../../../../app/renderer/features/assets/themes/use-theme-bin';

// Covers the sectioning behaviour: item theme families rendered at once from
// `themesByType`, per-family search/sort, and quick-apply keyed to the family
// of the section the clicked theme lives in.

const mocks = vi.hoisted(() => ({
  theme: { value: null as unknown },
  navigation: { value: null as unknown },
  binControls: { value: null as unknown },
  sort: { value: null as unknown },
}));

vi.mock('../../../../../../app/renderer/contexts/asset-editor/asset-editor-context', () => ({
  useThemeEditor: () => mocks.theme.value,
}));

vi.mock('../../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

vi.mock('@renderer/components/controls/bin-controls', () => ({
  useBinControls: () => mocks.binControls.value,
}));

vi.mock('../../../../../../app/renderer/features/workbench/use-bin-sort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../../app/renderer/features/workbench/use-bin-sort')>();
  return {
    ...actual,
    useThemeBinSort: () => mocks.sort.value,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────

function makeTheme(id: string, name: string, updatedAt: string): EditorThemeSource {
  return {
    id,
    slideId: `${id}:slide`,
    name,
    width: 1920,
    height: 1080,
    order: 0,
    elements: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
  };
}

function emptyThemes(): Record<ThemeOwnerType, EditorThemeSource[]> {
  return { presentation: [], lyric: [], overlay: [] };
}

interface HarnessOptions {
  themesByType?: Record<ThemeOwnerType, EditorThemeSource[]>;
  currentItemRef?: ItemRef | null;
  searchValue?: string;
  sort?: BinSort<BinTabSortKey>;
}

function renderThemeBin(options: HarnessOptions = {}) {
  const applyThemeToTarget = vi.fn().mockResolvedValue(undefined);
  mocks.theme.value = {
    themesByType: options.themesByType ?? emptyThemes(),
    applyThemeToTarget,
  };
  mocks.navigation.value = { currentItemRef: options.currentItemRef ?? null };
  mocks.binControls.value = {
    state: { searchValue: options.searchValue ?? '', viewMode: 'grid', grid: null },
    actions: {},
    meta: {},
  };
  mocks.sort.value = { sort: options.sort ?? { key: 'name', direction: 'asc' }, setSort: vi.fn() };

  const { result } = renderHook(() => useThemeBin());
  return { result, applyThemeToTarget };
}

afterEach(() => {
  cleanup();
});

// ─── Sections ────────────────────────────────────────────────────────

describe('useThemeBin sections', () => {
  it('exposes three theme families as labelled sections in THEME_OWNER_TYPES order (overlay excluded)', () => {
    const { result } = renderThemeBin({
      themesByType: {
        presentation: [makeTheme('p1', 'Alpha', 't1')],
        lyric: [makeTheme('l1', 'Beta', 't2')],
        overlay: [makeTheme('o1', 'Gamma', 't3')],
      },
    });

    expect(result.current.sections.map((s) => s.type)).toEqual(['presentation', 'lyric']);
    expect(result.current.sections.map((s) => s.label)).toEqual(['Presentations', 'Lyrics']);
    expect(result.current.sections[0].themes.map((t) => t.id)).toEqual(['p1']);
    expect(result.current.sections[1].themes.map((t) => t.id)).toEqual(['l1']);
  });

  it('filters each section independently and keeps a fully-filtered section present', () => {
    const { result } = renderThemeBin({
      searchValue: 'summit',
      themesByType: {
        presentation: [makeTheme('p1', 'Summit', 't1'), makeTheme('p2', 'Breeze', 't2')],
        lyric: [makeTheme('l1', 'Summit', 't3')],
        overlay: [],
      },
    });

    expect(result.current.sections).toHaveLength(2);
    expect(result.current.sections[0].themes.map((t) => t.id)).toEqual(['p1']);
    expect(result.current.sections[1].themes.map((t) => t.id)).toEqual(['l1']);
  });

  it('sorts each section by the shared sort key', () => {
    const { result } = renderThemeBin({
      sort: { key: 'name', direction: 'asc' },
      themesByType: {
        presentation: [makeTheme('p2', 'Zulu', 't1'), makeTheme('p1', 'Alpha', 't2')],
        lyric: [makeTheme('l2', 'Yankee', 't3'), makeTheme('l1', 'Bravo', 't4')],
        overlay: [],
      },
    });

    expect(result.current.sections[0].themes.map((t) => t.name)).toEqual(['Alpha', 'Zulu']);
    expect(result.current.sections[1].themes.map((t) => t.name)).toEqual(['Bravo', 'Yankee']);
  });
});

// ─── Quick-apply ─────────────────────────────────────────────────────

describe('useThemeBin quick-apply', () => {
  it('applies a theme when the current item type matches the theme\'s owning family', async () => {
    const { result, applyThemeToTarget } = renderThemeBin({
      themesByType: { presentation: [makeTheme('p1', 'Alpha', 't1')], lyric: [], overlay: [] },
      currentItemRef: { type: 'presentation', id: 'D1' },
    });

    await act(async () => {
      await result.current.handleApplyTheme(result.current.sections[0].themes[0]);
    });

    expect(applyThemeToTarget).toHaveBeenCalledTimes(1);
    expect(applyThemeToTarget).toHaveBeenCalledWith('p1', { type: 'item', itemRef: { type: 'presentation', id: 'D1' } });
  });

  it('does not apply when the current item type differs from the theme\'s owning family', async () => {
    const { result, applyThemeToTarget } = renderThemeBin({
      themesByType: { presentation: [makeTheme('p1', 'Alpha', 't1')], lyric: [], overlay: [] },
      currentItemRef: { type: 'lyric', id: 'L1' },
    });

    await act(async () => {
      await result.current.handleApplyTheme(result.current.sections[0].themes[0]);
    });

    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });

  it('never applies an overlay-family theme since overlay themes are excluded from sections', async () => {
    const { result, applyThemeToTarget } = renderThemeBin({
      themesByType: { presentation: [], lyric: [], overlay: [makeTheme('o1', 'Gamma', 't1')] },
      currentItemRef: { type: 'presentation', id: 'D1' },
    });

    // Overlay themes are not in any section, so there are no themes to apply
    expect(result.current.sections.flatMap((s) => s.themes)).toHaveLength(0);

    await act(async () => {
      await result.current.handleApplyTheme(makeTheme('o1', 'Gamma', 't1'));
    });

    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });

  it('does not apply when there is no current item', async () => {
    const { result, applyThemeToTarget } = renderThemeBin({
      themesByType: { presentation: [makeTheme('p1', 'Alpha', 't1')], lyric: [], overlay: [] },
      currentItemRef: null,
    });

    await act(async () => {
      await result.current.handleApplyTheme(result.current.sections[0].themes[0]);
    });

    expect(applyThemeToTarget).not.toHaveBeenCalled();
  });
});
