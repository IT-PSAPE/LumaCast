import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Id } from '@lumacast/kernel';
import type { useMultiSelection } from '@lumacast/selection';
import { MacroList } from '../../../../../../apps/cast/renderer/screens/macro-editor/macro-list';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  duplicateMacro: vi.fn(),
  deleteMacro: vi.fn(),
  reorderMacro: vi.fn(),
}));

vi.mock('@lumacast/ui', () => ({ useConfirm: () => mocks.confirm }));

vi.mock('@renderer/features/automation/automation-context', () => ({
  useAutomation: () => ({ actions: {
    duplicateMacro: mocks.duplicateMacro,
    deleteMacro: mocks.deleteMacro,
    reorderMacro: mocks.reorderMacro,
  } }),
}));

vi.mock('@renderer/components/layout/sortable-list', async () => {
  return {
    SortableList: { Root: ({ children }: { children: ReactNode }) => <>{children}</> },
    useSortableOrder: (options: { items: unknown[] }) => ({
      items: options.items,
      dnd: { ids: [], activeId: null, disabled: false, onKeyboardMoveToIndex: vi.fn(), onDragStart: vi.fn(), onDragEnd: vi.fn(), onDragCancel: vi.fn() },
    }),
  };
});

vi.mock('../../../../../../apps/cast/renderer/screens/macro-editor/macro-list-item', () => ({
  MacroListItem: (props: {
    macro: { id: Id; name: string };
    selection: ReturnType<typeof useMultiSelection>;
    onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onDuplicateMany: (ids: Id[]) => void;
    onDeleteMany: (ids: Id[]) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid={`macro-${props.macro.id}`}
        data-selected={props.selection.selectedIds.has(props.macro.id) ? 'true' : 'false'}
        onClick={props.onSelect}
      >{props.macro.name}</button>
      <button type="button" data-testid={`duplicate-selected-${props.macro.id}`} onClick={() => props.onDuplicateMany(props.selection.actionIds(props.macro.id))}>
        Duplicate selected
      </button>
      <button type="button" data-testid={`delete-selected-${props.macro.id}`} onClick={() => props.onDeleteMany(props.selection.actionIds(props.macro.id))}>
        Delete selected
      </button>
    </div>
  ),
}));

const macros = [
  { id: 'macro-a' as Id, name: 'Macro A' },
  { id: 'macro-b' as Id, name: 'Macro B' },
  { id: 'macro-c' as Id, name: 'Macro C' },
] as never[];

beforeEach(() => {
  mocks.confirm.mockResolvedValue(true);
  mocks.duplicateMacro.mockResolvedValue(null);
  mocks.deleteMacro.mockResolvedValue(undefined);
  mocks.reorderMacro.mockResolvedValue(undefined);
  vi.clearAllMocks();
  mocks.confirm.mockResolvedValue(true);
});

describe('MacroList bulk actions', () => {
  it('confirms once before deleting the selected macros', async () => {
    render(
      <MacroList
        macros={macros}
        currentMacroId="macro-a"
        onSelect={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('macro-macro-a'));
    fireEvent.click(screen.getByTestId('macro-macro-b'), { metaKey: true });
    fireEvent.click(screen.getByTestId('delete-selected-macro-a'));

    await waitFor(() => {
      expect(mocks.deleteMacro).toHaveBeenNthCalledWith(1, 'macro-a');
      expect(mocks.deleteMacro).toHaveBeenNthCalledWith(2, 'macro-b');
    });
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete 2 macros?' }));
  });

  it('stops deleting after a failure and keeps the failed and pending macros selected', async () => {
    mocks.deleteMacro.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('delete failed'));
    const parentKeyDown = vi.fn();
    const { rerender } = render(
      <div onKeyDown={parentKeyDown}>
        <MacroList
          macros={macros}
          currentMacroId="macro-a"
          onSelect={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>,
    );

    fireEvent.click(screen.getByTestId('macro-macro-a'));
    fireEvent.click(screen.getByTestId('macro-macro-b'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('macro-macro-c'), { ctrlKey: true });
    fireEvent.click(screen.getByTestId('delete-selected-macro-a'));

    await waitFor(() => expect(mocks.deleteMacro).toHaveBeenCalledTimes(2));
    expect(mocks.deleteMacro).toHaveBeenNthCalledWith(1, 'macro-a');
    expect(mocks.deleteMacro).toHaveBeenNthCalledWith(2, 'macro-b');
    expect(mocks.deleteMacro).not.toHaveBeenCalledWith('macro-c');

    rerender(
      <div onKeyDown={parentKeyDown}>
        <MacroList
          macros={macros.slice(1)}
          currentMacroId="macro-b"
          onSelect={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>,
    );
    expect(screen.getByTestId('macro-macro-b').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('macro-macro-c').getAttribute('data-selected')).toBe('true');
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('stops duplicating after the first rejected macro', async () => {
    mocks.duplicateMacro.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('duplicate failed'));
    render(
      <MacroList
        macros={macros}
        currentMacroId="macro-a"
        onSelect={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('macro-macro-a'));
    fireEvent.click(screen.getByTestId('macro-macro-b'), { metaKey: true });
    fireEvent.click(screen.getByTestId('macro-macro-c'), { metaKey: true });
    fireEvent.click(screen.getByTestId('duplicate-selected-macro-a'));

    await waitFor(() => expect(mocks.duplicateMacro).toHaveBeenCalledTimes(2));
    expect(mocks.duplicateMacro).toHaveBeenNthCalledWith(1, 'macro-a');
    expect(mocks.duplicateMacro).toHaveBeenNthCalledWith(2, 'macro-b');
    expect(mocks.duplicateMacro).not.toHaveBeenCalledWith('macro-c');
  });

  it('keeps select-all and clear-selection shortcuts inside the resource list', () => {
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <MacroList
          macros={macros}
          currentMacroId="macro-a"
          onSelect={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      </div>,
    );

    fireEvent.keyDown(screen.getByTestId('macro-macro-a'), { key: 'a', ctrlKey: true });

    expect(screen.getByRole('grid').getAttribute('data-shortcuts-scope')).toBe('ignore');
    expect(screen.getByTestId('macro-macro-a').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('macro-macro-b').getAttribute('data-selected')).toBe('true');
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('macro-macro-a'), { key: 'Escape' });

    expect(screen.getByTestId('macro-macro-a').getAttribute('data-selected')).toBe('false');
    expect(screen.getByTestId('macro-macro-b').getAttribute('data-selected')).toBe('false');
    expect(parentKeyDown).not.toHaveBeenCalled();
  });
});
