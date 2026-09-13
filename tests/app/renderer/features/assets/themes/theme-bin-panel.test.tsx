import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { ThemeOwnerType } from '@lumacast/composition';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { ThemeBinPanel } from '../../../../../../app/renderer/features/assets/themes/theme-bin-panel';

// Covers the sectioned theme bin: item theme families visible at once from
// `themesByType`, no family selector, and an accessible create drop-zone in
// each empty section that creates the theme and enters the theme editor.

const mocks = vi.hoisted(() => ({
  theme: { value: null as unknown },
  workbench: { value: null as unknown },
  navigation: { value: null as unknown },
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

vi.mock('../../../../../../app/renderer/contexts/asset-editor/asset-editor-context', () => ({
  useThemeEditor: () => mocks.theme.value,
}));

vi.mock('../../../../../../app/renderer/contexts/workbench-context', () => ({
  useWorkbench: () => mocks.workbench.value,
}));

vi.mock('../../../../../../app/renderer/contexts/navigation-context', () => ({
  useNavigation: () => mocks.navigation.value,
}));

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

function renderPanel(options: {
  themesByType?: Record<ThemeOwnerType, EditorThemeSource[]>;
  searchValue?: string;
} = {}) {
  const createTheme = vi.fn();
  const applyThemeToTarget = vi.fn().mockResolvedValue(undefined);
  const setWorkbenchMode = vi.fn();

  mocks.theme.value = {
    themesByType: options.themesByType ?? emptyThemes(),
    applyThemeToTarget,
    createTheme,
  };
  mocks.workbench.value = {
    state: { workbenchMode: 'show' },
    actions: { setWorkbenchMode },
    overlayStack: { rootElement: null, stack: [], baseZIndex: 1, register: vi.fn(), unregister: vi.fn() },
  };
  mocks.navigation.value = { currentItemRef: null };

  render(
    <BinControlsProvider
      searchValue={options.searchValue ?? ''}
      onSearchChange={vi.fn()}
      viewMode="grid"
      onViewModeChange={vi.fn()}
      grid={null}
    >
      <ThemeBinPanel />
    </BinControlsProvider>,
  );

  return { createTheme, applyThemeToTarget, setWorkbenchMode };
}

afterEach(() => {
  cleanup();
});

describe('ThemeBinPanel', () => {
  it('renders two theme family sections with headers instead of a family selector', () => {
    renderPanel();

    expect(screen.queryByLabelText('Theme family')).toBeNull();
    expect(screen.getByText('Presentations')).not.toBeNull();
    expect(screen.getByText('Lyrics')).not.toBeNull();
    // Overlay themes removed from UI
    expect(screen.queryByText('Overlays')).toBeNull();
  });

  it('renders an accessible create drop-zone for each empty section', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Create presentation theme' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create lyric theme' })).not.toBeNull();
    // Overlay theme creation removed
    expect(screen.queryByRole('button', { name: 'Create overlay theme' })).toBeNull();
  });

  it('creates the theme and switches to the theme editor when a drop-zone is activated', () => {
    const { createTheme, setWorkbenchMode } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Create lyric theme' }));

    expect(createTheme).toHaveBeenCalledWith('lyric');
    expect(setWorkbenchMode).toHaveBeenCalledWith('theme-editor');
  });

  it('keeps every section with its drop-zone when search filters all themes out', () => {
    renderPanel({
      searchValue: 'nomatch',
      themesByType: {
        presentation: [makeTheme('p1', 'Summit', 't1')],
        lyric: [],
        overlay: [],
      },
    });

    expect(screen.getByText('Presentations')).not.toBeNull();
    expect(screen.getByText('Lyrics')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create presentation theme' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create lyric theme' })).not.toBeNull();
  });
});
