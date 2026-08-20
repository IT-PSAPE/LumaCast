import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ResourceDrawerViewMode } from '@renderer/types/ui';
import { BinShell, type BinGridConfig } from './bin-shell';
import { WorkbenchProvider } from '@renderer/contexts/workbench-context';
import { BinControlsProvider, BinControlsSearchField, BinControlsViewOptions, useBinControls } from '../controls/bin-controls';
import { Dropdown } from '../../components/form/dropdown';

interface RenderOptions {
  searchValue?: string;
  searchPlaceholder?: string;
  viewMode?: ResourceDrawerViewMode;
  grid?: BinGridConfig | null;
}

function renderControls(options: RenderOptions = {}) {
  const onSearchChange = vi.fn();
  const onViewModeChange = vi.fn();
  const onGridSizeChange = vi.fn();

  const grid =
    options.grid !== undefined
      ? options.grid
      : { value: 6, min: 4, max: 8, step: 1, onChange: onGridSizeChange };

  const utils = render(
    <WorkbenchProvider>
      <BinControlsProvider
        searchValue={options.searchValue ?? ''}
        onSearchChange={onSearchChange}
        searchPlaceholder={options.searchPlaceholder ?? 'Search…'}
        viewMode={options.viewMode ?? 'grid'}
        onViewModeChange={onViewModeChange}
        grid={grid}
      >
        <BinControlsSearchField />
        <Dropdown>
          <Dropdown.Trigger aria-label="More actions">open</Dropdown.Trigger>
          <Dropdown.Panel placement="bottom-end" className="min-w-64">
            <Dropdown.Item onClick={() => {}}>Existing item</Dropdown.Item>
            <BinControlsViewOptions />
          </Dropdown.Panel>
        </Dropdown>
        <BinShell.Content data-ui-marker="bin-content">items</BinShell.Content>
      </BinControlsProvider>
    </WorkbenchProvider>,
  );

  return { ...utils, onSearchChange, onViewModeChange, onGridSizeChange };
}

function renderAudioControls() {
  return render(
    <WorkbenchProvider>
      <BinControlsProvider
        searchValue=""
        onSearchChange={vi.fn()}
        searchPlaceholder="Search audio…"
        viewMode="list"
        onViewModeChange={vi.fn()}
        grid={null}
      >
        <BinControlsSearchField />
        <Dropdown>
          <Dropdown.Trigger aria-label="More actions">open</Dropdown.Trigger>
          <Dropdown.Panel placement="bottom-end" className="min-w-64">
            <BinControlsViewOptions />
          </Dropdown.Panel>
        </Dropdown>
      </BinControlsProvider>
    </WorkbenchProvider>,
  );
}

function openMenu() {
  const button = screen.getByLabelText('More actions');
  fireEvent.pointerDown(button);
}

afterEach(() => {
  cleanup();
  const overlay = document.getElementById('overlay-root');
  if (overlay) overlay.replaceChildren();
});

describe('BinShell', () => {
  it('Root and Content forward className and data-* attributes', () => {
    render(
      <WorkbenchProvider>
        <BinShell className="custom-shell">
          <BinShell.Content data-ui-marker="bin-content" className="custom-content">
            items
          </BinShell.Content>
        </BinShell>
      </WorkbenchProvider>,
    );
    const root = document.querySelector('.custom-shell');
    expect(root?.tagName).toBe('DIV');
    const content = document.querySelector('[data-ui-marker="bin-content"]');
    expect(content?.classList.contains('custom-content')).toBe(true);
  });

  it('does not render its own header row', () => {
    const { container } = render(
      <WorkbenchProvider>
        <BinShell>
          <BinShell.Content>items</BinShell.Content>
        </BinShell>
      </WorkbenchProvider>,
    );
    expect(container.querySelector('[aria-label="Search"]')).toBeNull();
    expect(container.querySelector('[aria-label="View options"]')).toBeNull();
    expect(container.querySelector('[aria-label="More actions"]')).toBeNull();
  });
});

describe('BinControls', () => {
  it('renders search field with placeholder', () => {
    const { getByLabelText } = renderControls();
    expect(getByLabelText('Search')).not.toBeNull();
  });

  it('opens options menu containing Grid and List', () => {
    renderControls();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Grid' })).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'List' })).not.toBeNull();
  });

  it('shows GridSize slider inside options menu when grid config is provided in grid mode', () => {
    renderControls();
    openMenu();
    expect(screen.getByLabelText('Grid size')).not.toBeNull();
  });

  it('omits GridSize slider when no grid config is provided, like the audio bin', () => {
    renderAudioControls();
    openMenu();
    expect(screen.queryByLabelText('Grid size')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Grid' })).not.toBeNull();
  });

  it('hides GridSize slider in list view mode', () => {
    renderControls({ viewMode: 'list' });
    openMenu();
    expect(screen.queryByLabelText('Grid size')).toBeNull();
  });

  it('forwards the search placeholder to the Search input', () => {
    const { getByLabelText } = renderControls({ searchPlaceholder: 'Search stages…' });
    expect(getByLabelText('Search').getAttribute('placeholder')).toBe('Search stages…');
  });

  it('forwards typed search text to onSearchChange', () => {
    const { getByLabelText, onSearchChange } = renderControls();
    fireEvent.change(getByLabelText('Search'), { target: { value: 'lead' } });
    expect(onSearchChange).toHaveBeenCalledWith('lead');
  });

  it('forwards view choices in the options menu to onViewModeChange', () => {
    const { onViewModeChange } = renderControls();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'List' }));
    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('forwards grid slider changes to the grid onChange', () => {
    const { onGridSizeChange } = renderControls();
    openMenu();
    fireEvent.change(screen.getByLabelText('Grid size'), { target: { value: '7' } });
    expect(onGridSizeChange).toHaveBeenCalledWith(7);
  });

  it('throws when controls render outside the provider', () => {
    function Outside() {
      // useBinControls must throw outside provider
      useBinControls();
      return null;
    }
    expect(() => render(<Outside />)).toThrow();
    expect(() => render(<BinControlsSearchField />)).toThrow();
    expect(() => render(<BinControlsViewOptions />)).toThrow();
  });
});
