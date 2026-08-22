import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BinShell } from './bin-shell';
import { BinPanelLayout } from './collection-layout';

const mocks = vi.hoisted(() => ({
  options: null as unknown,
  virtualItems: [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 48 }],
  totalSize: 480,
  measureElement: vi.fn(),
  scrollToIndex: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: vi.fn((options) => {
    mocks.options = options;
    return {
      getVirtualItems: () => mocks.virtualItems,
      getTotalSize: () => mocks.totalSize,
      measureElement: mocks.measureElement,
      scrollToIndex: mocks.scrollToIndex,
    };
  }),
}));

function renderVirtualLayout(node: React.ReactNode) {
  return render(
    <BinShell>
      <BinShell.Content data-testid="bin-scroll-root">{node}</BinShell.Content>
    </BinShell>,
  );
}

afterEach(() => {
  cleanup();
  mocks.options = null;
  mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }, { index: 1, key: 'row-1', start: 48 }];
  mocks.scrollToIndex.mockReset();
  mocks.measureElement.mockReset();
});

describe('BinPanelLayout virtualization seam', () => {
  it('renders only the visible list children when virtualization is enabled', () => {
    const items = Array.from({ length: 6 }, (_, index) => <div key={index}>Item {index}</div>);

    const { rerender } = renderVirtualLayout(
      <BinPanelLayout gridItemSize={1} mode="list" virtualize listItemEstimate={48}>
        {items}
      </BinPanelLayout>,
    );

    expect(screen.getByText('Item 0')).not.toBeNull();
    expect(screen.getByText('Item 1')).not.toBeNull();
    expect(screen.queryByText('Item 2')).toBeNull();
    expect((mocks.options as { getScrollElement: () => HTMLElement | null }).getScrollElement()).toBe(screen.getByTestId('bin-scroll-root'));

    mocks.virtualItems = [{ index: 2, key: 'row-2', start: 96 }, { index: 3, key: 'row-3', start: 144 }];
    rerender(
      <BinShell>
        <BinShell.Content>
          <BinPanelLayout gridItemSize={1} mode="list" virtualize listItemEstimate={48}>
            {items}
          </BinPanelLayout>
        </BinShell.Content>
      </BinShell>,
    );

    expect(screen.queryByText('Item 0')).toBeNull();
    expect(screen.getByText('Item 2')).not.toBeNull();
    expect(screen.getByText('Item 3')).not.toBeNull();
  });

  it('windows grid children by row while preserving the original child order', () => {
    mocks.virtualItems = [{ index: 0, key: 'row-0', start: 0 }];

    renderVirtualLayout(
      <BinPanelLayout gridItemSize={3} mode="grid" virtualize gridRowEstimate={160}>
        {Array.from({ length: 6 }, (_, index) => <div key={index}>Tile {index}</div>)}
      </BinPanelLayout>,
    );

    expect(screen.getByText('Tile 0')).not.toBeNull();
    expect(screen.getByText('Tile 1')).not.toBeNull();
    expect(screen.getByText('Tile 2')).not.toBeNull();
    expect(screen.queryByText('Tile 3')).toBeNull();
    expect(screen.queryByText('Tile 4')).toBeNull();
    expect(screen.queryByText('Tile 5')).toBeNull();
  });
});
