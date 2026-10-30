import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMultiSelection, useMultiSelectionKeyHandler } from '@lumacast/selection';

function MultiSelectionKeysHarness() {
  const selection = useMultiSelection(['a', 'b'], 'keys');
  const handleKeyDown = useMultiSelectionKeyHandler({
    selectedCount: selection.selectedIds.size,
    selectAll: selection.selectAll,
    clearSelection: selection.clearSelection,
  });
  return (
    <div data-shortcuts-scope="ignore" onKeyDown={handleKeyDown}>
      <button type="button" data-selected={selection.selectedIds.has('a')}>A</button>
      <button type="button" data-selected={selection.selectedIds.has('b')}>B</button>
      <input data-testid="editable" />
    </div>
  );
}

describe('useMultiSelection', () => {
  it('selects discontiguous members with either platform modifier and toggles them off', () => {
    const { result } = renderHook(() => useMultiSelection(['a', 'b', 'c'], 'library'));
    act(() => result.current.select('a'));
    act(() => result.current.select('c', { metaKey: true }));
    expect([...result.current.selectedIds]).toEqual(['a', 'c']);
    expect(result.current.actionIds('a')).toEqual(['a', 'c']);
    expect(result.current.actionIds('b')).toEqual(['b']);
    act(() => result.current.select('a', { ctrlKey: true }));
    expect([...result.current.selectedIds]).toEqual(['c']);
  });

  it('extends a stable range and supports adding a range to discontiguous members', () => {
    const { result } = renderHook(() => useMultiSelection(['a', 'b', 'c', 'd', 'e'], 'library'));
    act(() => result.current.select('b'));
    act(() => result.current.select('e', { shiftKey: true }));
    expect(result.current.actionIds('b')).toEqual(['b', 'c', 'd', 'e']);
    act(() => result.current.select('c', { shiftKey: true }));
    expect(result.current.actionIds('b')).toEqual(['b', 'c']);
    act(() => result.current.select('e', { ctrlKey: true }));
    act(() => result.current.select('d', { metaKey: true, shiftKey: true }));
    expect(result.current.actionIds('b')).toEqual(['b', 'c', 'd', 'e']);
  });

  it('drops removed members, ignores unknown IDs, and never leaks selection across scopes', () => {
    const { result, rerender } = renderHook(({ ids, scope }) => useMultiSelection(ids, scope), {
      initialProps: { ids: ['a', 'b', 'c'], scope: 'one' },
    });
    act(() => result.current.selectAll());
    rerender({ ids: ['b', 'c', 'd'], scope: 'one' });
    expect([...result.current.selectedIds]).toEqual(['b', 'c']);
    act(() => result.current.select('unknown'));
    expect([...result.current.selectedIds]).toEqual(['b', 'c']);
    rerender({ ids: ['b', 'c', 'd'], scope: 'two' });
    expect(result.current.selectedIds.size).toBe(0);
    act(() => result.current.selectAll());
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('keeps valid hidden selection through visible range selection and select-all', () => {
    const { result, rerender } = renderHook(
      ({ visibleIds, selectableIds }) => useMultiSelection(visibleIds, 'filtered', selectableIds),
      { initialProps: { visibleIds: ['a', 'c'], selectableIds: ['a', 'b', 'c'] } },
    );
    act(() => result.current.select('b'));
    // Hidden rows cannot be directly clicked, but controlled state may already
    // contain them; this hook owns only visible interactions.
    expect([...result.current.selectedIds]).toEqual([]);
    rerender({ visibleIds: ['a', 'b', 'c'], selectableIds: ['a', 'b', 'c'] });
    act(() => result.current.select('b'));
    rerender({ visibleIds: ['a', 'c'], selectableIds: ['a', 'b', 'c'] });
    act(() => result.current.select('c', { shiftKey: true }));
    expect([...result.current.selectedIds]).toEqual(['c', 'b']);
    expect(result.current.actionIds('c')).toEqual(['c', 'b']);
    act(() => result.current.selectAll());
    expect([...result.current.selectedIds]).toEqual(['a', 'c', 'b']);
  });

  it('prunes IDs when the selectable scope changes even if visible order does not', () => {
    const { result, rerender } = renderHook(
      ({ selectableIds }) => useMultiSelection(['a', 'b'], 'scope', selectableIds),
      { initialProps: { selectableIds: ['a', 'b'] } },
    );
    act(() => result.current.selectAll());
    rerender({ selectableIds: ['a'] });
    expect([...result.current.selectedIds]).toEqual(['a']);
  });

  it('handles select-all and Escape locally, while leaving editable controls alone', () => {
    const parentKeyDown = vi.fn();
    render(<div onKeyDown={parentKeyDown}><MultiSelectionKeysHarness /></div>);

    fireEvent.keyDown(screen.getByText('A'), { key: 'Escape' });
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByText('A'), { key: 'a', ctrlKey: true });

    expect(screen.getByText('A').getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('B').getAttribute('data-selected')).toBe('true');
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByText('A'), { key: 'Escape' });

    expect(screen.getByText('A').getAttribute('data-selected')).toBe('false');
    expect(screen.getByText('B').getAttribute('data-selected')).toBe('false');
    expect(parentKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('editable'), { key: 'a', metaKey: true });

    expect(screen.getByText('A').getAttribute('data-selected')).toBe('false');
    expect(parentKeyDown).toHaveBeenCalledOnce();
  });
});
