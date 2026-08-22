import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BinControlsProvider } from '@renderer/components/controls/bin-controls';
import { ThemeBinPanel } from './theme-bin-panel';

const mocks = vi.hoisted(() => ({
  themeBin: { value: null as unknown },
  themeEditor: { value: null as unknown },
  workbench: { value: null as unknown },
  virtualItems: [
    { index: 0, key: 'row-0', start: 0 },
    { index: 1, key: 'row-1', start: 32 },
    { index: 2, key: 'row-2', start: 64 },
    { index: 3, key: 'row-3', start: 96 },
  ],
  totalSize: 320,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('./use-theme-bin', () => ({
  useThemeBin: () => mocks.themeBin.value,
}));

vi.mock('../../../contexts/asset-editor/asset-editor-context', () => ({
  useThemeEditor: () => mocks.themeEditor.value,
}));

vi.mock('../../../contexts/workbench-context', () => ({
  useWorkbench: () => mocks.workbench.value,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn(() => ({
    getVirtualItems: () => mocks.virtualItems,
    getTotalSize: () => mocks.totalSize,
    measureElement: mocks.measureElement,
    scrollToIndex: mocks.scrollToIndex,
  })),
}));

vi.mock('./theme-bin-item', () => ({
  ThemeBinItem: ({ theme }: { theme: { name: string } }) => <div>{theme.name}</div>,
}));

function renderPanel() {
  mocks.themeBin.value = {
    sections: [
      { type: 'presentation', label: 'Presentations', themes: [{ id: 'p-1', name: 'Summit', width: 1, height: 1, elements: [], createdAt: 't', updatedAt: 't', slideId: 's' }] },
      { type: 'lyric', label: 'Lyrics', themes: [] },
      { type: 'talk', label: 'Talks', themes: [{ id: 't-1', name: 'Dune', width: 1, height: 1, elements: [], createdAt: 't', updatedAt: 't', slideId: 's' }] },
      { type: 'overlay', label: 'Overlays', themes: [] },
    ],
    handleApplyTheme: vi.fn(),
  };
  mocks.themeEditor.value = { createTheme: vi.fn() };
  mocks.workbench.value = {
    state: { workbenchMode: 'show' },
    actions: { setWorkbenchMode: vi.fn() },
    overlayStack: { rootElement: null, stack: [], baseZIndex: 1, register: vi.fn(), unregister: vi.fn() },
  };

  render(
    <BinControlsProvider
      searchValue=""
      onSearchChange={vi.fn()}
      searchPlaceholder="Search…"
      viewMode="list"
      onViewModeChange={vi.fn()}
      grid={null}
    >
      <ThemeBinPanel />
    </BinControlsProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.measureElement.mockReset();
  mocks.scrollToIndex.mockReset();
});

describe('ThemeBinPanel virtualization', () => {
  it('keeps grouped headers and empty family rows while windowing the visible subset', () => {
    renderPanel();

    expect(screen.getByText('Presentations')).not.toBeNull();
    expect(screen.getByText('Summit')).not.toBeNull();
    expect(screen.getByText('Lyrics')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Create lyric theme' })).not.toBeNull();
    expect(screen.queryByText('Dune')).toBeNull();
  });
});
