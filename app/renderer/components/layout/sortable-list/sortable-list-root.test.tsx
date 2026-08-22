import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeasuringStrategy } from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { SortableList } from './sortable-list';

const mocks = vi.hoisted(() => ({
  dndProps: null as null | Record<string, unknown>,
  sortableProps: null as null | Record<string, unknown>,
  useSensor: vi.fn((_sensor, options) => ({ options })),
  useSensors: vi.fn((...sensors) => sensors),
}));

vi.mock('@dnd-kit/core', () => ({
  closestCenter: vi.fn(),
  DndContext: ({ children, ...props }: { children: ReactNode }) => {
    mocks.dndProps = props;
    return <div data-testid="dnd-context">{children}</div>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
  KeyboardSensor: class KeyboardSensor {},
  PointerSensor: class PointerSensor {},
  TouchSensor: class TouchSensor {},
  MeasuringStrategy: { Always: 0, BeforeDragging: 1, WhileDragging: 2 },
  useSensor: mocks.useSensor,
  useSensors: mocks.useSensors,
}));

vi.mock('@dnd-kit/sortable', () => ({
  rectSortingStrategy: vi.fn(),
  SortableContext: ({ children, ...props }: { children: ReactNode }) => {
    mocks.sortableProps = props;
    return <div data-testid="sortable-context">{children}</div>;
  },
  sortableKeyboardCoordinates: vi.fn(),
  useSortable: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
}));

afterEach(() => {
  mocks.dndProps = null;
  mocks.sortableProps = null;
  mocks.useSensor.mockClear();
  mocks.useSensors.mockClear();
});

describe('SortableList.Root', () => {
  it('forwards an explicit measuring strategy to dnd-kit when provided', () => {
    render(
      <SortableList.Root
        ids={['row-1']}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      >
        <div>row</div>
      </SortableList.Root>,
    );

    expect(mocks.dndProps?.measuring).toEqual({ droppable: { strategy: MeasuringStrategy.Always } });
  });

  it('adds a drag overlay and virtualized grid strategy when requested', () => {
    render(
      <SortableList.Root
        ids={['row-1', 'row-2']}
        activeId="row-1"
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
        layout="grid"
        virtualizedGrid={{ columns: 3 }}
        dragOverlay={<div>Overlay row</div>}
      >
        <div>row</div>
      </SortableList.Root>,
    );

    expect(screen.getByTestId('drag-overlay').textContent).toContain('Overlay row');
    expect(screen.getByTestId('drag-overlay').firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('drag-overlay').firstElementChild?.hasAttribute('inert')).toBe(true);
    expect(mocks.sortableProps?.strategy).toBeTypeOf('function');
  });

  it('wires pointer, touch, and keyboard sensors for reorder interactions', () => {
    render(
      <SortableList.Root
        ids={['row-1', 'row-2']}
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
      >
        <div>row</div>
      </SortableList.Root>,
    );

    expect(mocks.useSensor).toHaveBeenCalledTimes(3);
    expect(mocks.useSensors).toHaveBeenCalledTimes(1);
    expect(mocks.useSensor).toHaveBeenNthCalledWith(3, expect.any(Function), {
      coordinateGetter: sortableKeyboardCoordinates,
    });
  });

  it('routes keyboard moves through the virtualized fallback when provided', () => {
    const onMoveToIndex = vi.fn();
    const scrollToIndex = vi.fn();
    vi.mocked(sortableKeyboardCoordinates).mockReturnValueOnce(undefined);

    render(
      <SortableList.Root
        ids={['row-1', 'row-2', 'row-3']}
        activeId="row-1"
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
        virtualizedKeyboard={{ onMoveToIndex, scrollToIndex }}
      >
        <div>row</div>
      </SortableList.Root>,
    );

    const keyboardOptions = mocks.useSensor.mock.calls.at(2)?.[1] as {
      coordinateGetter: (event: KeyboardEvent, args: { currentCoordinates: { x: number; y: number }; context: { over: null } }) => unknown;
    };

    expect(keyboardOptions.coordinateGetter(
      { code: 'ArrowDown' } as KeyboardEvent,
      { currentCoordinates: { x: 12, y: 24 }, context: { over: null } },
    )).toEqual({ x: 12, y: 24 });
    expect(onMoveToIndex).toHaveBeenCalledWith(1);
    expect(scrollToIndex).toHaveBeenCalledWith(1);
  });

  it('announces the logical keyboard destination for virtualized moves', () => {
    render(
      <SortableList.Root
        ids={['row-1', 'row-2', 'row-3']}
        activeId="row-1"
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
        virtualizedKeyboard={{ onMoveToIndex: vi.fn(), scrollToIndex: vi.fn() }}
      >
        <div>row</div>
      </SortableList.Root>,
    );

    const keyboardOptions = mocks.useSensor.mock.calls.at(2)?.[1] as {
      coordinateGetter: (event: KeyboardEvent, args: { currentCoordinates: { x: number; y: number }; context: { over: null } }) => unknown;
    };
    const dndProps = mocks.dndProps as {
      onDragStart: (event: { active: { id: string } }) => void;
      accessibility: {
        announcements: {
          onDragOver: (event: { active: { id: string }; over: null }) => string | undefined;
        };
      };
    };

    dndProps.onDragStart({ active: { id: 'row-1' } });
    keyboardOptions.coordinateGetter(
      { code: 'ArrowDown' } as KeyboardEvent,
      { currentCoordinates: { x: 0, y: 0 }, context: { over: null } },
    );

    expect(dndProps.accessibility.announcements.onDragOver({ active: { id: 'row-1' }, over: null })).toBe(
      'Moving row-1 to position 2 of 3, before row-3.',
    );
  });

  it('uses the mounted over target for pointer announcements when no logical keyboard target exists', () => {
    render(
      <SortableList.Root
        ids={['row-1', 'row-2', 'row-3']}
        activeId="row-1"
        onDragStart={vi.fn()}
        onDragEnd={vi.fn()}
        onDragCancel={vi.fn()}
        virtualizedKeyboard={{ onMoveToIndex: vi.fn(), scrollToIndex: vi.fn() }}
      >
        <div>row</div>
      </SortableList.Root>,
    );

    const dndProps = mocks.dndProps as {
      onDragStart: (event: { active: { id: string } }) => void;
      accessibility: {
        announcements: {
          onDragOver: (event: { active: { id: string }; over: { id: string } }) => string | undefined;
        };
      };
    };

    dndProps.onDragStart({ active: { id: 'row-1' } });

    expect(dndProps.accessibility.announcements.onDragOver({
      active: { id: 'row-1' },
      over: { id: 'row-3' },
    })).toBe('Moving row-1 to position 3 of 3, at the end.');
  });
});
