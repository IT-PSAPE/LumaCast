import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { useSortableOrder, type SortableOrderCommit } from '../../../../../../../apps/cast/renderer/components/layout/sortable-list/use-sortable-order';

// The point of this hook is that a drop is visible before the snapshot round
// trip completes, and that it is honestly rolled back when the write fails.
// These tests drive the dnd-kit event shape directly — the sensors and DOM are
// dnd-kit's business, the ordering arithmetic and the optimistic window are
// ours.

interface Row { id: string; order: number; }

function rows(...ids: string[]): Row[] {
  return ids.map((id, index) => ({ id, order: index }));
}

const rowId = (row: Row) => row.id;

function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId },
  } as unknown as DragEndEvent;
}

function dragStart(activeId: string): DragStartEvent {
  return {
    active: { id: activeId },
  } as unknown as DragStartEvent;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(initial: Row[], commit: (change: SortableOrderCommit) => Promise<unknown> | unknown) {
  return renderHook(
    ({ items }: { items: Row[] }) => useSortableOrder({ items, getId: rowId, commit }),
    { initialProps: { items: initial } },
  );
}

describe('useSortableOrder', () => {
  it('blocks another gesture until a pending reorder settles, including failure', async () => {
    const pending = deferred();
    const commit = vi.fn(() => pending.promise);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup(rows('a', 'b', 'c'), commit);
    act(() => result.current.dnd.onDragStart(dragStart('a')));
    act(() => result.current.dnd.onDragEnd(dragEnd('a', 'c')));
    expect(result.current.dnd.disabled).toBe(true);
    act(() => result.current.dnd.onDragStart(dragStart('b')));
    act(() => result.current.dnd.onDragEnd(dragEnd('b', 'c')));
    expect(commit).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error('rejected')); await pending.promise.catch(() => {}); });
    expect(result.current.dnd.disabled).toBe(false);
    expect(result.current.items.map(rowId)).toEqual(['a', 'b', 'c']);
    error.mockRestore();
  });

  it('cancels a stale drop if another window reordered the same rows during the gesture', () => {
    const commit = vi.fn();
    const { result, rerender } = setup(rows('a', 'b', 'c'), commit);
    act(() => result.current.dnd.onDragStart(dragStart('a')));
    rerender({ items: rows('c', 'b', 'a') });
    act(() => result.current.dnd.onDragEnd(dragEnd('a', 'c')));
    expect(commit).not.toHaveBeenCalled();
    expect(result.current.items.map(rowId)).toEqual(['c', 'b', 'a']);
  });

  it('moves a discontiguous selection as one ordered block and persists every member', async () => {
    const pending = deferred();
    const commit = vi.fn(() => pending.promise);
    const { result } = renderHook(() => useSortableOrder({
      items: rows('a', 'b', 'c', 'd', 'e'), getId: rowId, commit, selectedIds: new Set(['b', 'd']),
    }));
    act(() => result.current.dnd.onDragStart(dragStart('b')));
    act(() => result.current.dnd.onDragEnd(dragEnd('b', 'e')));
    expect(result.current.items.map(rowId)).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(commit).toHaveBeenCalledWith({ id: 'b', fromIndex: 1, toIndex: 4, movedIds: ['b', 'd'], orderedIds: ['a', 'c', 'e', 'b', 'd'], previousIds: ['a', 'b', 'c', 'd', 'e'] });
    await act(async () => { pending.resolve(); await pending.promise; });
  });

  it('moves only an unselected dragged row and treats a drop within the selected block as a no-op', () => {
    const commit = vi.fn(() => new Promise(() => {}));
    const { result } = renderHook(() => useSortableOrder({ items: rows('a', 'b', 'c', 'd'), getId: rowId, commit, selectedIds: new Set(['a', 'c']) }));
    act(() => result.current.dnd.onDragStart(dragStart('a')));
    act(() => result.current.dnd.onDragEnd(dragEnd('a', 'c')));
    expect(commit).not.toHaveBeenCalled();
    act(() => result.current.dnd.onDragStart(dragStart('b')));
    act(() => result.current.dnd.onDragEnd(dragEnd('b', 'd')));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ movedIds: ['b'], orderedIds: ['a', 'c', 'd', 'b'] }));
  });

  it('keeps group keyboard previews consistent with the final drop and restores on cancel', () => {
    const commit = vi.fn(() => new Promise(() => {}));
    const { result } = renderHook(() => useSortableOrder({ items: rows('a', 'b', 'c', 'd', 'e'), getId: rowId, commit, selectedIds: new Set(['a', 'b']) }));
    act(() => result.current.dnd.onDragStart(dragStart('a')));
    act(() => result.current.dnd.onKeyboardMoveToIndex(2));
    expect(result.current.items.map(rowId)).toEqual(['c', 'a', 'b', 'd', 'e']);
    act(() => result.current.dnd.onKeyboardMoveToIndex(3));
    expect(result.current.items.map(rowId)).toEqual(['c', 'd', 'a', 'b', 'e']);
    act(() => result.current.dnd.onDragCancel());
    expect(result.current.items.map(rowId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(commit).not.toHaveBeenCalled();
    act(() => result.current.dnd.onDragStart(dragStart('a')));
    act(() => result.current.dnd.onKeyboardMoveToIndex(4));
    act(() => result.current.dnd.onDragEnd(dragEnd('a', null)));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ orderedIds: ['c', 'd', 'e', 'a', 'b'], movedIds: ['a', 'b'] }));
  });

  it('omits selected members removed mid-drag and retains newly arriving rows', () => {
    const commit = vi.fn(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ items }) => useSortableOrder({ items, getId: rowId, commit, selectedIds: new Set(['a', 'b']) }), { initialProps: { items: rows('a', 'b', 'c', 'd') } });
    act(() => result.current.dnd.onDragStart(dragStart('a')));
    rerender({ items: rows('a', 'c', 'd', 'e') });
    act(() => result.current.dnd.onDragEnd(dragEnd('a', 'd')));
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ orderedIds: ['c', 'd', 'a', 'e'], movedIds: ['a'] }));
  });

  it('shows the dropped position immediately, before the commit resolves', async () => {
    const pending = deferred();
    const commit = vi.fn(() => pending.promise);
    const { result } = setup(rows('a', 'b', 'c'), commit);

    act(() => { result.current.dnd.onDragEnd(dragEnd('a', 'c')); });

    expect(result.current.items.map(rowId)).toEqual(['b', 'c', 'a']);
    expect(result.current.isCommitting).toBe(true);
    expect(commit).toHaveBeenCalledWith({ id: 'a', fromIndex: 0, toIndex: 2, orderedIds: ['b', 'c', 'a'], movedIds: ['a'], previousIds: ['a', 'b', 'c'] });

    await act(async () => { pending.resolve(); await pending.promise; });
  });

  it('hands back to the snapshot once the commit resolves', async () => {
    const commit = vi.fn(() => Promise.resolve());
    const { result, rerender } = setup(rows('a', 'b', 'c'), commit);

    await act(async () => {
      result.current.dnd.onDragEnd(dragEnd('a', 'b'));
      await Promise.resolve();
    });
    // The snapshot arrives carrying the same order the override was showing.
    rerender({ items: rows('b', 'a', 'c') });

    expect(result.current.items.map(rowId)).toEqual(['b', 'a', 'c']);
    expect(result.current.isCommitting).toBe(false);
  });

  it('reverts to the persisted order when the commit rejects', async () => {
    const commit = vi.fn(() => Promise.reject(new Error('row not found')));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = setup(rows('a', 'b', 'c'), commit);

    await act(async () => {
      result.current.dnd.onDragEnd(dragEnd('c', 'a'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.items.map(rowId)).toEqual(['a', 'b', 'c']);
    expect(result.current.isCommitting).toBe(false);
    consoleError.mockRestore();
  });

  it('keeps the second drop when two drags overlap, and only settles on the last', async () => {
    const first = deferred();
    const second = deferred();
    const calls: SortableOrderCommit[] = [];
    const commit = vi.fn((change: SortableOrderCommit) => {
      calls.push(change);
      return calls.length === 1 ? first.promise : second.promise;
    });
    const { result } = setup(rows('a', 'b', 'c'), commit);

    act(() => { result.current.dnd.onDragEnd(dragEnd('a', 'b')); });
    expect(result.current.items.map(rowId)).toEqual(['b', 'a', 'c']);

    // Second drag indices are computed against the visible (optimistic) order.
    act(() => { result.current.dnd.onDragEnd(dragEnd('c', 'b')); });
    expect(result.current.items.map(rowId)).toEqual(['c', 'b', 'a']);
    expect(calls[1]).toEqual({ id: 'c', fromIndex: 2, toIndex: 0, orderedIds: ['c', 'b', 'a'], movedIds: ['c'], previousIds: ['b', 'a', 'c'] });

    // The first commit landing must not drop the second drag's optimism.
    await act(async () => { first.resolve(); await first.promise; });
    expect(result.current.items.map(rowId)).toEqual(['c', 'b', 'a']);
    expect(result.current.isCommitting).toBe(true);

    await act(async () => { second.resolve(); await second.promise; });
    expect(result.current.isCommitting).toBe(false);
  });

  it('ignores a drop outside the list and a drop back onto itself', () => {
    const commit = vi.fn();
    const { result } = setup(rows('a', 'b'), commit);

    act(() => { result.current.dnd.onDragEnd(dragEnd('a', null)); });
    act(() => { result.current.dnd.onDragEnd(dragEnd('a', 'a')); });

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.items.map(rowId)).toEqual(['a', 'b']);
  });

  it('commits the last keyboard target when the drop ends without an over id', async () => {
    const pending = deferred();
    const commit = vi.fn(() => pending.promise);
    const { result } = setup(rows('a', 'b', 'c', 'd'), commit);

    act(() => {
      result.current.dnd.onDragStart(dragStart('a'));
    });
    act(() => {
      result.current.dnd.onKeyboardMoveToIndex(2);
    });
    await act(async () => {
      result.current.dnd.onDragEnd(dragEnd('a', null));
      await Promise.resolve();
    });

    expect(commit).toHaveBeenCalledWith({
      id: 'a',
      fromIndex: 0,
      toIndex: 2,
      orderedIds: ['b', 'c', 'a', 'd'],
      movedIds: ['a'],
      previousIds: ['a', 'b', 'c', 'd'],
    });
    expect(result.current.items.map(rowId)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('does not commit when the dragged row disappeared mid-gesture', () => {
    const commit = vi.fn();
    const { result, rerender } = setup(rows('a', 'b', 'c'), commit);

    act(() => { result.current.dnd.onDragStart(dragStart('a')); });
    rerender({ items: rows('b', 'c') });
    act(() => { result.current.dnd.onDragEnd(dragEnd('a', 'c')); });

    expect(commit).not.toHaveBeenCalled();
    expect(result.current.items.map(rowId)).toEqual(['b', 'c']);
  });

  it('holds the visible order steady while a drag is in progress', () => {
    const commit = vi.fn();
    const { result, rerender } = setup(rows('a', 'b', 'c'), commit);

    act(() => { result.current.dnd.onDragStart(dragStart('a')); });
    // Another window / an undo reorders the list under the cursor.
    rerender({ items: rows('c', 'b', 'a') });

    expect(result.current.items.map(rowId)).toEqual(['a', 'b', 'c']);

    act(() => { result.current.dnd.onDragCancel(); });
    expect(result.current.items.map(rowId)).toEqual(['c', 'b', 'a']);
  });

  it('surfaces rows added underneath an optimistic order instead of hiding them', () => {
    const pending = deferred();
    const { result, rerender } = setup(rows('a', 'b'), () => pending.promise);

    act(() => { result.current.dnd.onDragEnd(dragEnd('a', 'b')); });
    rerender({ items: rows('a', 'b', 'c') });

    expect(result.current.items.map(rowId)).toEqual(['b', 'a', 'c']);
  });

  it('disables dragging for a list that cannot be reordered', () => {
    const single = setup(rows('a'), vi.fn());
    expect(single.result.current.dnd.disabled).toBe(true);

    const many = renderHook(() => useSortableOrder({
      items: rows('a', 'b'),
      getId: rowId,
      commit: vi.fn(),
      disabled: true,
    }));
    expect(many.result.current.dnd.disabled).toBe(true);
  });
});
