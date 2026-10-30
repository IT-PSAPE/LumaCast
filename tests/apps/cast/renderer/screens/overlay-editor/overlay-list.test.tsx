import { fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OverlayList } from '../../../../../../apps/cast/renderer/screens/overlay-editor/overlay-list';

const mocks = vi.hoisted(() => ({
  overlays: [] as Array<{ id: string; name: string }>,
  selectOverlay: vi.fn(),
  reorderOverlay: vi.fn(),
  sortableOptions: null as null | { selectedIds: ReadonlySet<string> },
}));

vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useOverlayEditor: () => ({ reorderOverlay: mocks.reorderOverlay }),
}));

vi.mock('../../../../../../apps/cast/renderer/screens/overlay-editor/screen-context', () => ({
  useOverlayEditorScreen: () => ({
    state: { overlays: mocks.overlays, currentOverlayId: 'overlay-a' },
    actions: { selectOverlay: mocks.selectOverlay },
  }),
}));

vi.mock('@renderer/components/layout/sortable-list', () => {
  return {
    SortableList: { Root: ({ children }: { children: ReactNode }) => <>{children}</> },
    useSortableOrder: (options: { items: unknown[]; selectedIds: ReadonlySet<string> }) => {
      mocks.sortableOptions = options;
      return {
        items: options.items,
        dnd: { ids: [], activeId: null, disabled: false, onKeyboardMoveToIndex: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() },
      };
    },
  };
});

vi.mock('../../../../../../apps/cast/renderer/screens/overlay-editor/overlay-list-item', () => ({
  OverlayListItem: (props: {
    overlay: { id: string; name: string };
    selection: { selectedIds: ReadonlySet<string> };
    onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  }) => (
    <button
      type="button"
      data-testid={`overlay-${props.overlay.id}`}
      data-selected={props.selection.selectedIds.has(props.overlay.id) ? 'true' : 'false'}
      onClick={props.onSelect}
      onContextMenu={props.onContextMenu}
    >
      {props.overlay.name}
    </button>
  ),
}));

beforeEach(() => {
  mocks.overlays = [
    { id: 'overlay-a', name: 'Overlay A' },
    { id: 'overlay-b', name: 'Overlay B' },
    { id: 'overlay-c', name: 'Overlay C' },
    { id: 'overlay-d', name: 'Overlay D' },
  ];
  mocks.sortableOptions = null;
  vi.clearAllMocks();
});

describe('OverlayList selection', () => {
  it('toggles and ranges selection without replacing the active editor context', () => {
    render(<OverlayList />);

    fireEvent.click(screen.getByTestId('overlay-overlay-a'));
    fireEvent.click(screen.getByTestId('overlay-overlay-b'), { ctrlKey: true });

    expect(mocks.selectOverlay).toHaveBeenCalledOnce();
    expect(mocks.selectOverlay).toHaveBeenCalledWith('overlay-a');
    expect(screen.getByTestId('overlay-overlay-a').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('overlay-overlay-b').getAttribute('data-selected')).toBe('true');

    fireEvent.click(screen.getByTestId('overlay-overlay-d'), { shiftKey: true });

    expect(mocks.selectOverlay).toHaveBeenCalledOnce();
    expect(screen.getByTestId('overlay-overlay-a').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('overlay-overlay-b').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('overlay-overlay-c').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('overlay-overlay-d').getAttribute('data-selected')).toBe('true');
    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set(['overlay-b', 'overlay-c', 'overlay-d']));
  });

  it('keeps select-all and clear-selection shortcuts inside the resource list', () => {
    const parentKeyDown = vi.fn();
    render(<div onKeyDown={parentKeyDown}><OverlayList /></div>);

    fireEvent.keyDown(screen.getByTestId('overlay-overlay-a'), { key: 'a', ctrlKey: true });

    expect(screen.getByRole('grid').getAttribute('data-shortcuts-scope')).toBe('ignore');
    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set(['overlay-a', 'overlay-b', 'overlay-c', 'overlay-d']));
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('overlay-overlay-a'), { key: 'Escape' });

    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set());
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});
