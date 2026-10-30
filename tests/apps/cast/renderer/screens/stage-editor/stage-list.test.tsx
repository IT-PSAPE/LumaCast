import { fireEvent, render, screen } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StageList } from '../../../../../../apps/cast/renderer/screens/stage-editor/stage-list';

const mocks = vi.hoisted(() => ({
  stages: [] as Array<{ id: string; name: string }>,
  selectStage: vi.fn(),
  sortableOptions: null as null | { selectedIds: ReadonlySet<string> },
}));

vi.mock('@renderer/contexts/asset-editor/asset-editor-context', () => ({
  useStageEditor: () => ({ reorderStage: vi.fn() }),
}));

vi.mock('../../../../../../apps/cast/renderer/screens/stage-editor/screen-context', () => ({
  useStageEditorScreen: () => ({
    state: { stages: mocks.stages, currentStageId: 'stage-a' },
    actions: { selectStage: mocks.selectStage },
  }),
}));

vi.mock('@renderer/components/layout/sortable-list', async () => {
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

vi.mock('../../../../../../apps/cast/renderer/screens/stage-editor/stage-list-item', () => ({
  StageListItem: (props: {
    stage: { id: string; name: string };
    selection: { selectedIds: ReadonlySet<string> };
    onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  }) => (
    <button
      type="button"
      data-testid={`stage-${props.stage.id}`}
      data-selected={props.selection.selectedIds.has(props.stage.id) ? 'true' : 'false'}
      onClick={props.onSelect}
    >
      {props.stage.name}
    </button>
  ),
}));

beforeEach(() => {
  mocks.stages = [
    { id: 'stage-a', name: 'Stage A' },
    { id: 'stage-b', name: 'Stage B' },
    { id: 'stage-c', name: 'Stage C' },
    { id: 'stage-d', name: 'Stage D' },
  ];
  mocks.sortableOptions = null;
  vi.clearAllMocks();
});

describe('StageList selection', () => {
  it('ranges selection without changing the active editor context', () => {
    render(<StageList />);

    fireEvent.click(screen.getByTestId('stage-stage-a'));
    fireEvent.click(screen.getByTestId('stage-stage-c'), { shiftKey: true });

    expect(mocks.selectStage).toHaveBeenCalledOnce();
    expect(mocks.selectStage).toHaveBeenCalledWith('stage-a');
    expect(screen.getByTestId('stage-stage-a').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('stage-stage-b').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('stage-stage-c').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('stage-stage-d').getAttribute('data-selected')).toBe('false');
    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set(['stage-a', 'stage-b', 'stage-c']));
  });

  it('keeps select-all and clear-selection shortcuts inside the resource list', () => {
    const parentKeyDown = vi.fn();
    render(<div onKeyDown={parentKeyDown}><StageList /></div>);

    fireEvent.keyDown(screen.getByTestId('stage-stage-a'), { key: 'a', metaKey: true });

    expect(screen.getByRole('grid').getAttribute('data-shortcuts-scope')).toBe('ignore');
    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set(['stage-a', 'stage-b', 'stage-c', 'stage-d']));
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('stage-stage-a'), { key: 'Escape' });

    expect(mocks.sortableOptions?.selectedIds).toEqual(new Set());
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});
