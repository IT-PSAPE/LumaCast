import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { EditorThemeSource } from '@lumacast/canvas';
import type { ThemeOwnerType } from '@lumacast/composition';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { ThemeBinPanel } from './theme-bin-panel';

// Covers the sectioned theme bin: all four families visible at once from
// `themesByType`, no family selector, and an accessible create drop-zone in
// each empty section that creates the theme and enters the theme editor.

const mocks = vi.hoisted(() => ({
  theme: { value: null as unknown },
  workbench: { value: null as unknown },
  navigation: { value: null as unknown },
}));

vi.mock('../../../contexts/asset-editor/asset-editor-context', () => ({
  useThemeEditor: () => mocks.theme.value,
}));

vi.mock('../../../contexts/workbench-context', () => ({
  useWorkbench: () => mocks.workbench.value,
}));

vi.mock('../../../contexts/navigation-context', () => ({
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
  return { presentation: [], lyric: [], talk: [], overlay: [] };
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
      searchPlaceholder="Search…"
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
  it('renders all four theme family sections with headers instead of a family selector', () => {
    renderPanel();

    expect(screen.queryByLabelText('Theme family')).toBeNull();
    expect(screen.getByText('Presentations')).not.toBeNull();
    expect(screen.getByText('Lyrics')).not.toBeNull();
    expect(screen.getByText('Talks')).not.toBeNull();
    expect(screen.getByText('Overlays')).not.toBeNull();
  });

  it('renders an accessible create drop-zone for each empty section', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Create presentation theme' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create lyric theme' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create talk theme' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create overlay theme' })).not.toBeNull();
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
        talk: [makeTheme('k1', 'Dune', 't2')],
        overlay: [],
      },
    });

    expect(screen.getByText('Presentations')).not.toBeNull();
    expect(screen.getByText('Talks')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create presentation theme' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create talk theme' })).not.toBeNull();
  });
});