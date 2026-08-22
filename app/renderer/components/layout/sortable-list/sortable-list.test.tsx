import { memo } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import { useSortableItem } from './sortable-list';

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
});

describe('useSortableItem', () => {
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
