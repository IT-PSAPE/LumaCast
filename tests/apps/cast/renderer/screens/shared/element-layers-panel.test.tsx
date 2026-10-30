import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementLayersPanel } from '../../../../../../apps/cast/renderer/screens/shared/element-layers-panel';

const mocks = vi.hoisted(() => ({
  elements: { effectiveElements: [] as unknown[], selectedElementIds: [] as string[], selectElement: vi.fn(), selectElements: vi.fn(), clearSelection: vi.fn(), reorderElements: vi.fn(), renameElement: vi.fn(), toggleElementVisibility: vi.fn(), toggleElementLock: vi.fn() },
  setInspectorTab: vi.fn(),
  dragKeyDown: vi.fn((event: React.KeyboardEvent) => { if (event.key === ' ') event.preventDefault(); }),
  options: null as null | { selectedIds: Set<string>; commit: (change: { orderedIds: string[] }) => Promise<void> },
}));

vi.mock('@renderer/contexts/canvas/canvas-context', () => ({ useElements: () => mocks.elements }));
vi.mock('@renderer/features/inspector/inspector-context', () => ({ useInspector: () => ({ setInspectorTab: mocks.setInspectorTab }) }));
vi.mock('@renderer/components/layout/sortable-list', () => ({
  SortableList: { Root: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  useSortableOrder: (options: { items: unknown[] }) => { mocks.options = options as never; return { items: options.items, dnd: {} }; },
  useSortableItem: () => ({ containerRef: vi.fn(), containerStyle: {}, handleProps: { role: 'button', tabIndex: 0, onKeyDown: mocks.dragKeyDown } }),
}));

beforeEach(() => {
  mocks.elements.effectiveElements = ['a', 'b', 'c'].map((id) => ({ id, type: 'shape', payload: { name: id } }));
  mocks.elements.selectedElementIds = ['c', 'a'];
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ElementLayersPanel selection', () => {
  it('preserves the keyboard drag activator while reserving modifiers for selection', () => {
    render(<ElementLayersPanel emptyMessage="Empty" />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'a' }), { key: ' ' });
    expect(mocks.dragKeyDown).toHaveBeenCalledOnce();
    expect(mocks.elements.selectElement).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: 'a' }), { key: ' ', ctrlKey: true });
    expect(mocks.dragKeyDown).toHaveBeenCalledOnce();
    expect(mocks.elements.selectElements).toHaveBeenCalledWith(['c']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'Enter' });
    expect(mocks.dragKeyDown).toHaveBeenCalledOnce();
    expect(mocks.elements.selectElement).toHaveBeenCalledWith('b');
  });

  it('highlights every selected layer and toggles with mouse or keyboard modifiers', () => {
    render(<ElementLayersPanel emptyMessage="Empty" />);
    expect(screen.getByRole('button', { name: 'a' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'c' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'a' }), { metaKey: true });
    expect(mocks.elements.selectElements).toHaveBeenLastCalledWith(['c']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'Enter', ctrlKey: true });
    expect(mocks.elements.selectElements).toHaveBeenLastCalledWith(['c', 'a', 'b']);
    expect(mocks.options?.selectedIds).toEqual(new Set(['c', 'a']));
  });

  it('uses the visible layer order for Shift ranges and reverses full group drops for paint order', async () => {
    render(<ElementLayersPanel emptyMessage="Empty" />);
    fireEvent.click(screen.getByRole('button', { name: 'a' }), { shiftKey: true });
    expect(mocks.elements.selectElements).toHaveBeenLastCalledWith(['c', 'b', 'a']);
    await mocks.options?.commit({ orderedIds: ['b', 'c', 'a'] });
    expect(mocks.elements.reorderElements).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('owns select-all and Escape without affecting text editing', () => {
    render(<ElementLayersPanel emptyMessage="Empty" />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'a', ctrlKey: true });
    expect(mocks.elements.selectElements).toHaveBeenLastCalledWith(['c', 'b', 'a']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'b' }), { key: 'Escape' });
    expect(mocks.elements.clearSelection).toHaveBeenCalledOnce();
  });
});
