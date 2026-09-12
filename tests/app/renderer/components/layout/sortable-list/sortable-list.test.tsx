import { memo, type ReactNode } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { SortableList, useSortableItem } from '../../../../../../app/renderer/components/layout/sortable-list/sortable-list';

const mocks = vi.hoisted(() => {
  const setNodeRef = vi.fn();
  const attributes = { role: 'button', tabIndex: 0 };
  const listeners = { onPointerDown: vi.fn() };
  return {
    setNodeRef,
    sortableState: {
      attributes,
      listeners,
      setNodeRef,
      transform: null,
      transition: 'transform 200ms ease',
      isDragging: false,
    },
  };
});

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable');
  return {
    ...actual,
    useSortable: vi.fn(() => mocks.sortableState),
  };
});

const useRenderStore = create<{ unrelated: number; bump: () => void }>((set) => ({
  unrelated: 0,
  bump: () => set((state) => ({ unrelated: state.unrelated + 1 })),
}));

afterEach(() => {
  useRenderStore.setState({ unrelated: 0 });
  mocks.sortableState.isDragging = false;
});

function listWrapper(dragOverlay: ReactNode) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SortableList.Root
        ids={['row-1']}
        activeId="row-1"
        onDragStart={() => undefined}
        onDragEnd={() => undefined}
        onDragCancel={() => undefined}
        dragOverlay={dragOverlay}
      >
        {children}
      </SortableList.Root>
    );
  };
}

describe('useSortableItem', () => {
  it('hides the source row while a drag overlay carries the floating copy', () => {
    mocks.sortableState.isDragging = true;

    const { result } = renderHook(() => useSortableItem('row-1'), {
      wrapper: listWrapper(<div>Overlay row</div>),
    });

    // One visible copy only: the overlay floats, the slot left behind is a gap.
    expect(result.current.containerStyle.opacity).toBe(0);
    expect(result.current.isDragging).toBe(false);
  });

  it('keeps the row fully opaque when it is the thing being dragged', () => {
    mocks.sortableState.isDragging = true;

    const { result } = renderHook(() => useSortableItem('row-1'), {
      wrapper: listWrapper(null),
    });

    // No overlay: this row is what follows the pointer, so it must not be dimmed.
    expect(result.current.containerStyle.opacity).toBeUndefined();
    expect(result.current.isDragging).toBe(true);
  });

  it('returns stable object references across renders when dnd-kit inputs are unchanged', () => {
    const { result, rerender } = renderHook(() => useSortableItem('row-1'));
    const firstStyle = result.current.containerStyle;
    const firstHandleProps = result.current.handleProps;

    rerender();

    expect(result.current.containerStyle).toBe(firstStyle);
    expect(result.current.handleProps).toBe(firstHandleProps);
  });

  it('lets a memoized row bail out when an unrelated store field rerenders the parent', () => {
    let rowRenderCount = 0;

    const MemoRow = memo(function MemoRow({
      containerStyle,
      handleProps,
    }: {
      containerStyle: ReturnType<typeof useSortableItem>['containerStyle'];
      handleProps: ReturnType<typeof useSortableItem>['handleProps'];
    }) {
      rowRenderCount += 1;
      return <div data-testid="row" style={containerStyle} {...handleProps} />;
    });

    function Harness() {
      useRenderStore((state) => state.unrelated);
      const sortable = useSortableItem('row-1');
      return <MemoRow containerStyle={sortable.containerStyle} handleProps={sortable.handleProps} />;
    }

    render(<Harness />);
    expect(rowRenderCount).toBe(1);

    act(() => {
      useRenderStore.getState().bump();
    });

    expect(rowRenderCount).toBe(1);
  });
});
