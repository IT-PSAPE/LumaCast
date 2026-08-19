import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ResourceDrawerViewMode } from '../../types/ui';
import { BinShell, type BinGridConfig } from './bin-shell';

interface RenderOptions {
  searchValue?: string;
  searchPlaceholder?: string;
  viewMode?: ResourceDrawerViewMode;
  grid?: BinGridConfig;
}

function renderShell(options: RenderOptions = {}) {
  const onSearchChange = vi.fn();
  const onViewModeChange = vi.fn();
  const onGridSizeChange = vi.fn();

  const utils = render(
    <BinShell
      searchValue={options.searchValue ?? ''}
      onSearchChange={onSearchChange}
      searchPlaceholder={options.searchPlaceholder ?? 'Search…'}
      viewMode={options.viewMode ?? 'grid'}
      onViewModeChange={onViewModeChange}
      grid={options.grid ?? { value: 6, min: 4, max: 8, step: 1, onChange: onGridSizeChange }}
    >
      <BinShell.Content data-ui-marker="bin-content">items</BinShell.Content>
      <BinShell.Footer>
        <BinShell.Search />
        <BinShell.GridSize />
        <BinShell.ViewToggle />
      </BinShell.Footer>
    </BinShell>,
  );

  return { ...utils, onSearchChange, onViewModeChange, onGridSizeChange };
}

function renderAudioShell() {
  return render(
    <BinShell
      searchValue=""
      onSearchChange={vi.fn()}
      searchPlaceholder="Search audio…"
      viewMode="list"
      onViewModeChange={vi.fn()}
    >
      <BinShell.Content>items</BinShell.Content>
      <BinShell.Footer>
        <BinShell.Search />
        <BinShell.ViewToggle />
      </BinShell.Footer>
    </BinShell>,
  );
}

afterEach(() => {
  cleanup();
});

describe('BinShell', () => {
  it('Root, Content, and Footer forward className and data-* attributes', () => {
    render(
      <BinShell
        className="custom-shell"
        searchValue=""
        onSearchChange={vi.fn()}
        viewMode="grid"
        onViewModeChange={vi.fn()}
      >
        <BinShell.Content data-ui-marker="bin-content" className="custom-content">items</BinShell.Content>
        <BinShell.Footer data-ui-marker="bin-footer" className="custom-footer">
          <BinShell.ViewToggle />
        </BinShell.Footer>
      </BinShell>,
    );
    const root = document.querySelector('.custom-shell');
    expect(root?.tagName).toBe('DIV');
    const content = document.querySelector('[data-ui-marker="bin-content"]');
    expect(content?.classList.contains('custom-content')).toBe(true);
    const footer = document.querySelector('[data-ui-marker="bin-footer"]');
    expect(footer?.classList.contains('custom-footer')).toBe(true);
  });

  it('composes Search, GridSize, and ViewToggle when grid config is provided in grid mode', () => {
    const { getByLabelText, getByRole } = renderShell();
    expect(getByRole('textbox', { name: 'Search' })).not.toBeNull();
    expect(getByLabelText('Grid columns')).not.toBeNull();
    expect(getByRole('group', { name: 'Bin view mode' })).not.toBeNull();
  });

  it('omits GridSize when no grid config is provided, like the audio bin', () => {
    const { queryByLabelText, getByLabelText, getByRole } = renderAudioShell();
    expect(getByLabelText('Search')).not.toBeNull();
    expect(getByRole('group', { name: 'Bin view mode' })).not.toBeNull();
    expect(queryByLabelText('Grid columns')).toBeNull();
  });

  it('hides GridSize in list view mode', () => {
    const { queryByLabelText } = renderShell({ viewMode: 'list' });
    expect(queryByLabelText('Grid columns')).toBeNull();
  });

  it('forwards the root search placeholder to the Search input', () => {
    const { getByLabelText } = renderShell({ searchPlaceholder: 'Search stages…' });
    expect(getByLabelText('Search').getAttribute('placeholder')).toBe('Search stages…');
  });

  it('forwards typed search text to onSearchChange', () => {
    const { getByLabelText, onSearchChange } = renderShell();
    fireEvent.change(getByLabelText('Search'), { target: { value: 'lead' } });
    expect(onSearchChange).toHaveBeenCalledWith('lead');
  });

  it('forwards view toggle clicks to onViewModeChange', () => {
    const { getByLabelText, onViewModeChange } = renderShell();
    fireEvent.click(getByLabelText('List view'));
    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('forwards grid slider changes to the grid onChange', () => {
    const { getByLabelText, onGridSizeChange } = renderShell();
    fireEvent.change(getByLabelText('Grid columns'), { target: { value: '7' } });
    expect(onGridSizeChange).toHaveBeenCalledWith(7);
  });

  it('throws when footer pieces render outside the BinShell root', () => {
    expect(() => render(<BinShell.ViewToggle />)).toThrow();
    expect(() => render(<BinShell.Search />)).toThrow();
    expect(() => render(<BinShell.GridSize />)).toThrow();
  });
});
